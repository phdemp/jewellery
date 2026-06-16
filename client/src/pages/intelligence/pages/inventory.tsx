import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStockItems, fetchStockSummary, fetchClientRecommendations } from "@/lib/api";
import type { LiveStockItem, StockSummary } from "@/lib/api";
import { fmt, ageTagClass, downloadCSV } from "../lib/intelligence-utils";
import { INV_PER_PAGE, AGEING_COLORS, PIE_COLORS } from "../lib/intelligence-constants";
import { cn } from "@/lib/utils";
import { useIntelligence } from "../intelligence-context";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AnimatePresence, motion } from "framer-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  FileText,
  BarChart3,
  Users,
  MapPin,
  Loader2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ComposedChart,
  Line,
  Legend,
  PieChart,
  Pie,
} from "recharts";

// ---- Ageing tag computation from ageingDays ----

const AGEING_OPTIONS = ["Fresh", "Active", "Moderate", "Slow Moving", "Ageing", "Non-Moving"] as const;

// Derive product segment from style_no theme codes + category (mirrors server SQL logic)
function deriveProductSegment(styleNo: string | null, category: string | null): string {
  const sn = (styleNo || "").toUpperCase();
  const cat = (category || "").toLowerCase();
  if (sn.includes("BRP") || sn.includes("BRU")) return "Bridal";
  if (sn.includes("BRC")) return "Bridal Lite";
  if (sn.includes("SOP") || sn.includes("SOLP")) return "Exclusive - Grandeur";
  if (sn.includes("WRD") || sn.includes("SOO") || sn.includes("SOD")) {
    if (cat.includes("chain") || cat.includes("pendant")) return "RTW";
    if (cat.includes("earring") || cat.includes("stud") || cat.includes("drop") || cat.includes("hoop")) return "Ear Essentials";
    if (cat.includes("bracelet") || cat.includes("bangle") || cat.includes("hathphool") || cat.includes("ring")) return "Handwear";
    if (cat.includes("nosepin") || cat.includes("nath") || cat.includes("mangtika") || cat.includes("brooch") || cat.includes("button") || cat.includes("kalingi") || cat.includes("kanauti") || cat.includes("mala")) return "Add-ons";
    return "Modern";
  }
  if (sn.includes("CLO") || sn.includes("CLP") || sn.includes("WRO")) return "Traditional";
  return "Traditional";
}
const STATUS_OPTIONS = ["On Hand", "Memo"] as const;

function getAgeingTag(days: number): string {
  if (days <= 30) return "Fresh";
  if (days <= 60) return "Active";
  if (days <= 90) return "Moderate";
  if (days <= 180) return "Slow Moving";
  if (days <= 270) return "Ageing";
  return "Non-Moving";
}

const MONO = "'DM Mono', monospace";
const SERIF = "'Cormorant Garamond', serif";

// ---- Set pairing logic ----

// Matches set suffixes (NLS/NLSE/CHS/CHSE...) AND individual piece suffixes (ER/BN/BR/RN/CN/NL/HP/PN/BCH/MI)
// Longer suffixes listed first so regex is greedy-correct
const PIECE_SUFFIX_RE = /^(.+?)(NLSE|LNSE|CHSE|PNSE|CNSE|NSE|NLS|LNS|CHS|PNS|CNS|BCH|NS|CS|NL|ER|BN|BR|RN|CN|HP|PN|MI)(-\d+)?$/;

function parseStyle(styleNo: string | null | undefined): { prefix: string; suffix: string } | null {
  if (!styleNo) return null;
  const m = styleNo.toUpperCase().trim().match(PIECE_SUFFIX_RE);
  // Include variant suffix in prefix: "OWRD46272" + "-1" → "OWRD46272-1"
  // So NLS-1 pairs only with NLSE-1, not with NLS or NLS-2
  return m ? { prefix: m[1] + (m[3] || ""), suffix: m[2] } : null;
}

function getSetPrefix(styleNo: string | null | undefined): string | null {
  const p = parseStyle(styleNo);
  return p ? p.prefix : null;
}

type GridSegment =
  | { type: "single"; item: LiveStockItem }
  | { type: "set"; prefix: string; items: LiveStockItem[] };

function buildGridSegments(items: LiveStockItem[]): GridSegment[] {
  const segments: GridSegment[] = [];
  const used = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    used.add(i);

    const parsed = parseStyle(items[i].styleNo);
    if (parsed) {
      const group: LiveStockItem[] = [items[i]];
      const suffixes = new Set([parsed.suffix]);
      for (let j = i + 1; j < items.length; j++) {
        if (used.has(j)) continue;
        const pj = parseStyle(items[j].styleNo);
        if (pj && pj.prefix === parsed.prefix) {
          suffixes.add(pj.suffix);
          used.add(j);
          group.push(items[j]);
        }
      }
      // Only treat as a set if there are different piece types (e.g. NLS + NLSE)
      if (group.length > 1 && suffixes.size > 1) {
        segments.push({ type: "set", prefix: parsed.prefix, items: group });
      } else {
        // Same suffix duplicates or single — emit as individual cards
        for (const item of group) {
          segments.push({ type: "single", item });
        }
        // Un-mark extras so they keep original order
        for (let k = 1; k < group.length; k++) {
          // Already marked used, that's fine — they're in segments now
        }
      }
    } else {
      segments.push({ type: "single", item: items[i] });
    }
  }
  return segments;
}

// ---- Component ----

export default function InventoryPage() {
  const { goldPrice, setGoldPrice } = useIntelligence();
  const [localGoldPrice, setLocalGoldPrice] = useState(goldPrice || 0);

  // Filter state
  const [search, setSearch] = useState("");
  const [ageingFilter, setAgeingFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [stockTypeFilter, setStockTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Pagination
  const [page, setPage] = useState(1);

  const [memoOpen, setMemoOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(true);
  const [detailItem, setDetailItem] = useState<LiveStockItem | null>(null);

  // ---- Fetch summary for filter dropdown options ----
  const { data: summary } = useQuery({
    queryKey: ["stock-summary"],
    queryFn: () => fetchStockSummary(),
  });

  // Build filter params for API call
  const filterParams = useMemo(() => {
    const params: Record<string, string | number> = {
      page,
      limit: INV_PER_PAGE,
    };
    if (search.trim()) params.search = search.trim();
    if (statusFilter !== "all") params.status = statusFilter;
    if (categoryFilter !== "all") params.category = categoryFilter;
    if (locationFilter !== "all") params.location = locationFilter;
    if (stockTypeFilter !== "all") params.stockType = stockTypeFilter;
    if (ageingFilter !== "all") params.ageingTag = ageingFilter;
    params.sortBy = "ageingDays";
    params.sortDir = "desc";
    return params;
  }, [page, search, statusFilter, categoryFilter, locationFilter, stockTypeFilter, ageingFilter]);

  // ---- Fetch stock items with server-side filtering ----
  const { data: stockData, isLoading } = useQuery({
    queryKey: ["stock-items", filterParams],
    queryFn: () => fetchStockItems(filterParams),
  });

  const items = stockData?.items ?? [];
  const gridSegments = useMemo(() => buildGridSegments(items), [items]);
  const totalItems = stockData?.total ?? 0;
  const totalPages = stockData?.totalPages ?? 1;

  // Derive filter options from summary
  const categoryOptions = useMemo(
    () => (summary?.categoryBreakdown ?? []).map((c) => c.category).filter(Boolean).sort(),
    [summary],
  );
  const locationOptions = useMemo(
    () => (summary?.locationBreakdown ?? []).map((l) => l.location).filter(Boolean).sort(),
    [summary],
  );

  const hasActiveFilters =
    search.trim() !== "" ||
    ageingFilter !== "all" ||
    categoryFilter !== "all" ||
    locationFilter !== "all" ||
    stockTypeFilter !== "all" ||
    statusFilter !== "all";

  function clearFilters() {
    setSearch("");
    setAgeingFilter("all");
    setCategoryFilter("all");
    setLocationFilter("all");
    setStockTypeFilter("all");
    setStatusFilter("all");
    setPage(1);
  }

  function handleExportCSV() {
    const headers = [
      "Jewel Code", "Style No", "Category", "Location", "Stock Type",
      "Base Metal", "Tag Price", "Pure Wt", "Status", "Ageing Days",
      "Ageing Tag",
    ];
    const rows = items.map((i) => [
      i.jewelCode, i.styleNo ?? "", i.category ?? "", i.location ?? "", i.stockType ?? "",
      i.baseMetal ?? "", i.tagPrice, i.pureWt ?? "", i.currentStatus ?? "", i.ageingDays,
      getAgeingTag(i.ageingDays),
    ]);
    downloadCSV("inventory-export.csv", headers, rows);
  }

  // Reset page when filters change
  function handleFilterChange<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  return (
    <div className="space-y-5 relative">
      <div style={{ height: 2, background: "linear-gradient(90deg, #C9A84C, transparent)", marginBottom: 20, borderRadius: 1 }} />
      {/* Page header — only shown when grid is active */}
      {!dashboardOpen && (
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-2xl text-[#1A1814]"
            style={{ fontFamily: SERIF, fontWeight: 600 }}
          >
            Inventory Management
          </h2>
          <p
            className="text-xs text-[#1A1814]/50 mt-0.5"
            style={{ fontFamily: MONO }}
          >
            {totalItems.toLocaleString("en-IN")} items
            {hasActiveFilters ? " (filtered)" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 border border-[#C9A84C] bg-[#FDFAF4] rounded"
            title="Selling Price = (Tag Price / 2) + (Pure Wt × Gold Price)"
          >
            <span className="font-mono text-[9.5px] tracking-wider text-[#6B5314]">💰 GOLD ₹</span>
            <input
              type="number" min={0} step={100} placeholder="0"
              value={localGoldPrice || ""}
              onChange={(e) => {
                const val = Number(e.target.value);
                setLocalGoldPrice(val);
                if (val > 0) setGoldPrice(val);
              }}
              className="w-[80px] px-1.5 py-0.5 border border-[#D4C9A8] rounded text-[12px] font-semibold"
              style={{ fontVariantNumeric: "tabular-nums" }}
            />
            <span className="text-[10px] text-[#6B6458]">/gm</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDashboardOpen(true)}
            className="h-8 text-xs border-[#C9A84C]/40 text-[#8B6914] hover:bg-[#C9A84C]/10"
          >
            <BarChart3 className="w-3.5 h-3.5 mr-1.5" />Dashboard
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMemoOpen(true)}
            className="h-8 text-xs border-[#D4C9A8] text-[#1A1814]/60 hover:bg-[#F5F1E8]"
          >
            <FileText className="w-3.5 h-3.5 mr-1.5" />
            Memo Tracker
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="h-8 text-xs border-[#D4C9A8] text-[#1A1814]/60 hover:bg-[#F5F1E8]"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </div>
      )}

      {/* Filter bar */}
      {!dashboardOpen && (<div
        className="rounded-lg border p-3 flex flex-wrap items-center gap-2.5"
        style={{ backgroundColor: "#FFFFFF", borderColor: "#D4C9A8" }}
      >
        {/* Search */}
        <div className="relative w-52">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#1A1814]/30" />
          <Input
            value={search}
            onChange={(e) => handleFilterChange(setSearch)(e.target.value)}
            placeholder="Search jewel code, style..."
            className="h-8 pl-8 text-xs border-[#D4C9A8] bg-white placeholder:text-[#1A1814]/30"
            style={{ fontFamily: MONO, fontSize: "11px" }}
          />
        </div>

        {/* Ageing */}
        <Select value={ageingFilter} onValueChange={handleFilterChange(setAgeingFilter)}>
          <SelectTrigger
            className="h-8 w-[130px] text-xs border-[#D4C9A8] bg-white"
            style={{ fontFamily: MONO, fontSize: "11px" }}
          >
            <SelectValue placeholder="Ageing" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Ageing</SelectItem>
            {AGEING_OPTIONS.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Category */}
        <Select value={categoryFilter} onValueChange={handleFilterChange(setCategoryFilter)}>
          <SelectTrigger
            className="h-8 w-[150px] text-xs border-[#D4C9A8] bg-white"
            style={{ fontFamily: MONO, fontSize: "11px" }}
          >
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categoryOptions.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Location */}
        <Select value={locationFilter} onValueChange={handleFilterChange(setLocationFilter)}>
          <SelectTrigger
            className="h-8 w-[160px] text-xs border-[#D4C9A8] bg-white"
            style={{ fontFamily: MONO, fontSize: "11px" }}
          >
            <SelectValue placeholder="Location" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {locationOptions.map((l) => (
              <SelectItem key={l} value={l}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Stock Type */}
        <Select value={stockTypeFilter} onValueChange={handleFilterChange(setStockTypeFilter)}>
          <SelectTrigger
            className="h-8 w-[140px] text-xs border-[#D4C9A8] bg-white"
            style={{ fontFamily: MONO, fontSize: "11px" }}
          >
            <SelectValue placeholder="Stock Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stock Types</SelectItem>
            <SelectItem value="DAILY">DAILY</SelectItem>
            <SelectItem value="OCCASIONABLE">OCCASIONABLE</SelectItem>
            <SelectItem value="PREMIUM">PREMIUM</SelectItem>
            <SelectItem value="CLASSIC">CLASSIC</SelectItem>
            <SelectItem value="UNIQUE">UNIQUE</SelectItem>
          </SelectContent>
        </Select>

        {/* Status */}
        <Select value={statusFilter} onValueChange={handleFilterChange(setStatusFilter)}>
          <SelectTrigger
            className="h-8 w-[110px] text-xs border-[#D4C9A8] bg-white"
            style={{ fontFamily: MONO, fontSize: "11px" }}
          >
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 text-xs text-[#A63C2A] hover:text-[#A63C2A]/80 hover:bg-[#FDEAEA]/40 px-2"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Clear
          </Button>
        )}

      </div>)}

      {/* Loading state + Grid + Pagination */}
      {!dashboardOpen && (isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-[#6B6458] text-sm" style={{ fontFamily: MONO }}>Loading data...</div>
        </div>
      ) : (
        <>
          <InventoryGrid segments={gridSegments} onSelect={setDetailItem} goldPrice={localGoldPrice} />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p
                className="text-[11px] text-[#1A1814]/40"
                style={{ fontFamily: MONO }}
              >
                Page {page} of {totalPages} &middot; {totalItems.toLocaleString("en-IN")} items
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-7 w-7 p-0 border-[#D4C9A8]"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                {buildPageNumbers(page, totalPages).map((pn, idx) =>
                  pn === "..." ? (
                    <span
                      key={`ellipsis-${idx}`}
                      className="text-[11px] text-[#1A1814]/30 px-1"
                      style={{ fontFamily: MONO }}
                    >
                      ...
                    </span>
                  ) : (
                    <Button
                      key={pn}
                      variant={pn === page ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPage(pn as number)}
                      className={cn(
                        "h-7 min-w-7 px-2 text-xs border-[#D4C9A8]",
                        pn === page
                          ? "bg-[#C9A84C] text-[#1A1814] hover:bg-[#8B6914] border-[#C9A84C]"
                          : "hover:bg-[#F5F1E8]"
                      )}
                      style={{ fontFamily: MONO }}
                    >
                      {pn}
                    </Button>
                  )
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="h-7 w-7 p-0 border-[#D4C9A8]"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      ))}

      <MemoTrackerDialog open={memoOpen} onClose={() => setMemoOpen(false)} />
      <InventoryDashboardSheet
        open={dashboardOpen}
        onClose={() => setDashboardOpen(false)}
        summary={summary ?? null}
        goldPrice={localGoldPrice}
      />

      {/* ITEM DETAIL MODAL */}
      {detailItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDetailItem(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-[720px] w-full mx-4 overflow-hidden flex"
            style={{ maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Image side */}
            <div className="w-1/2 bg-[#F5F1E8] flex items-center justify-center min-h-[400px]">
              {detailItem.imageUrl ? (
                <img
                  src={detailItem.imageUrl}
                  alt={detailItem.jewelCode}
                  className="w-full h-full object-cover min-h-[400px]"
                />
              ) : (
                <div className="text-[72px]">{"\uD83D\uDC8E"}</div>
              )}
            </div>
            {/* Detail side */}
            <div className="w-1/2 p-5 overflow-y-auto">
              <div className="mb-3">
                <div className="font-mono text-[9.5px] text-[#6B6458] tracking-[1.5px] mb-0.5">
                  {detailItem.jewelCode}
                </div>
                <div className="text-[20px] font-medium" style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.3px" }}>
                  {detailItem.category || "—"}
                </div>
                <div className="text-[26px] text-[#8B6914]" style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.3px" }}>
                  {fmt(detailItem.tagPrice)}
                </div>
              </div>

              {/* Selling Price — full-width green banner when gold rate is set */}
              {localGoldPrice > 0 && detailItem.pureWt != null && parseFloat(detailItem.pureWt) > 0 && (
                <div className="bg-[#F0FAF3] border border-[#B8D4BE] rounded-md px-3 py-2 mb-3 flex items-center justify-between">
                  <div className="font-mono text-[9px] tracking-[1.5px] text-[#4A7C59] uppercase">Selling Price</div>
                  <div className="text-[20px] font-bold text-[#4A7C59]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmt(Math.round(detailItem.tagPrice / 2 + localGoldPrice * parseFloat(detailItem.pureWt!)))}
                  </div>
                </div>
              )}

              {/* Ageing badge */}
              <div className="mb-3">
                <span
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full font-medium",
                    ageTagClass(getAgeingTag(detailItem.ageingDays))
                  )}
                >
                  {getAgeingTag(detailItem.ageingDays)} — {detailItem.ageingDays}d
                </span>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-2.5 mb-3.5">
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">TAG PRICE</div>
                  <div className="text-[#8B6914]" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(detailItem.tagPrice)}</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">COST PRICE</div>
                  <div style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(detailItem.costPrice)}</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">BASE METAL</div>
                  <div>{detailItem.baseMetal || "—"}</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">PURE WT</div>
                  <div>{detailItem.pureWt ? `${parseFloat(detailItem.pureWt).toFixed(2)} gm` : "—"}</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">GROSS WT</div>
                  <div>{detailItem.grossWt ? `${parseFloat(detailItem.grossWt).toFixed(2)} gm` : "—"}</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">DIAMOND WT</div>
                  <div>{detailItem.totDiaWt ? `${parseFloat(detailItem.totDiaWt).toFixed(2)} cts` : "—"}</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">STYLE NO</div>
                  <div className="font-mono text-[11px]">{detailItem.styleNo || "—"}</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">LOCATION</div>
                  <div className="font-mono text-[11px]">{detailItem.location || "—"}</div>
                </div>
                {detailItem.collectionName && (
                  <div>
                    <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">COLLECTION</div>
                    <div className="text-[11px]">{detailItem.collectionName}</div>
                  </div>
                )}
                {detailItem.productSegment && (
                  <div>
                    <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">SEGMENT</div>
                    <div className="text-[11px]">{detailItem.productSegment}</div>
                  </div>
                )}
              </div>

              {/* Close button */}
              <button
                onClick={() => setDetailItem(null)}
                className="w-full px-3 py-2 border border-[#D4C9A8] rounded text-[12.5px] text-[#6B6458] hover:border-[#C9A84C] hover:text-[#C9A84C] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Grid View ----

interface GridProps {
  segments: GridSegment[];
  onSelect: (item: LiveStockItem) => void;
  goldPrice: number;
}

function InventoryGrid({ segments, onSelect, goldPrice }: GridProps) {
  const hasItems = segments.length > 0;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {segments.map((seg) => {
        if (seg.type === "single") {
          return (
            <InventoryCardWithReco key={seg.item.id} item={seg.item} onSelect={onSelect} goldPrice={goldPrice} />
          );
        }
        // Set group — spans 2 grid columns, items side-by-side (matches assortment pattern)
        return (
          <div
            key={`set-${seg.prefix}`}
            className="relative flex gap-2 p-2 rounded-lg"
            style={{
              gridColumn: `span ${Math.min(seg.items.length, 2)}`,
              border: "1.5px dashed #9B7FCC",
              background: "rgba(155,127,204,0.04)",
              marginBottom: 4,
            }}
          >
            <div
              className="absolute -top-2.5 left-3.5 z-10 text-white font-bold tracking-[1.2px] px-2 py-0.5 rounded"
              style={{ background: "#9B7FCC", fontFamily: MONO, fontSize: "9px" }}
            >
              SET
            </div>
            {seg.items.map((item) => (
              <div key={item.id} className="flex-1 min-w-0">
                <InventoryCardWithReco item={item} onSelect={onSelect} isSetMember goldPrice={goldPrice} />
              </div>
            ))}
          </div>
        );
      })}
      {!hasItems && (
        <div className="col-span-full py-16 text-center">
          <p className="text-sm text-[#1A1814]/30">No items match the current filters.</p>
        </div>
      )}
    </div>
  );
}

// ---- Grid Card with Inline Recommendations ----

function InventoryCardWithReco({ item, onSelect, isSetMember, goldPrice = 0 }: { item: LiveStockItem; onSelect: (item: LiveStockItem) => void; isSetMember?: boolean; goldPrice?: number }) {
  const [expanded, setExpanded] = useState(false);
  const ageTag = getAgeingTag(item.ageingDays);

  const { data: recoData, isLoading: recoLoading } = useQuery({
    queryKey: ["client-recommendations", item.id],
    queryFn: () => fetchClientRecommendations(item.id),
    enabled: expanded,
  });

  const recommendations = recoData?.recommendations ?? [];

  return (
    <div
      className={cn(
        "rounded-lg border bg-white transition-all hover:shadow-md overflow-hidden group",
        isSetMember
          ? "border-[#9B7FCC]/50 hover:border-[#9B7FCC]/80"
          : "border-[#D4C9A8] hover:border-[#C9A84C]/40"
      )}
    >
      {/* Image */}
      <div className="aspect-square bg-[#F5F1E8] overflow-hidden relative cursor-pointer" onClick={() => onSelect(item)}>
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.jewelCode}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-xs text-[#1A1814]/15" style={{ fontFamily: MONO }}>
              NO IMAGE
            </span>
          </div>
        )}
        {/* Ageing tag overlay */}
        <span
          className={cn(
            "absolute top-1.5 right-1.5 text-[8px] px-1.5 py-0.5 rounded-full font-medium",
            ageTagClass(ageTag)
          )}
        >
          {ageTag}
        </span>
        {/* Status overlay */}
        <Badge
          variant="secondary"
          className={cn(
            "absolute top-1.5 left-1.5 text-[8px] px-1.5 py-0 h-4 border-0",
            item.currentStatus === "On Hand"
              ? "bg-[#E8F5EC] text-[#2D6B42]"
              : "bg-[#FFF4E0] text-[#8B5E00]"
          )}
        >
          {item.currentStatus ?? "--"}
        </Badge>
        {isSetMember && (
          <Badge className="absolute bottom-1.5 right-1.5 text-[7px] px-1 py-0 h-3.5 bg-[#E8E0F0] text-[#6B4C9A] border-0">
            SET
          </Badge>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 space-y-1.5">
        <div>
          <p className="text-[8px] uppercase tracking-[1px] text-[#6B6458]" style={{ fontFamily: MONO }}>Jewel Code</p>
          <p className="text-[11px] font-medium text-[#1A1814] truncate" style={{ fontFamily: MONO }}>{item.jewelCode}</p>
        </div>
        {item.styleNo && (
          <div>
            <p className="text-[8px] uppercase tracking-[1px] text-[#6B6458]" style={{ fontFamily: MONO }}>Style No</p>
            <p className="text-[10px] text-[#1A1814]/70 truncate" style={{ fontFamily: MONO }}>{item.styleNo}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-2">
          <div>
            <p className="text-[8px] uppercase tracking-[1px] text-[#6B6458]" style={{ fontFamily: MONO }}>Category</p>
            <p className="text-[10px] text-[#1A1814]/70 truncate">{item.category ?? "--"}</p>
          </div>
          <div>
            <p className="text-[8px] uppercase tracking-[1px] text-[#6B6458]" style={{ fontFamily: MONO }}>Tag Price</p>
            <p className="text-[11px] text-[#1A1814] font-medium" style={{ fontFamily: MONO }}>{fmt(item.tagPrice)}</p>
          </div>
        </div>
        {goldPrice > 0 && item.pureWt != null && parseFloat(item.pureWt) > 0 && (
          <div className="bg-[#F0FAF3] border border-[#B8D4BE] rounded-[5px] px-2 py-[5px]">
            <p className="text-[8px] uppercase tracking-[1px] text-[#4A7C59]" style={{ fontFamily: MONO }}>Selling Price</p>
            <p className="text-[11px] font-bold text-[#4A7C59]" style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
              {fmt(Math.round(item.tagPrice / 2 + goldPrice * parseFloat(item.pureWt!)))}
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-2">
          <div>
            <p className="text-[8px] uppercase tracking-[1px] text-[#6B6458]" style={{ fontFamily: MONO }}>Location</p>
            <p className="text-[10px] text-[#1A1814]/60 truncate">{item.location ?? "--"}</p>
          </div>
          <div>
            <p className="text-[8px] uppercase tracking-[1px] text-[#6B6458]" style={{ fontFamily: MONO }}>Base Metal</p>
            <p className="text-[10px] text-[#1A1814]/60" style={{ fontFamily: MONO }}>{item.baseMetal ?? "--"}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-2">
          <div>
            <p className="text-[8px] uppercase tracking-[1px] text-[#6B6458]" style={{ fontFamily: MONO }}>Pure Wt</p>
            <p className="text-[10px] text-[#1A1814]/60" style={{ fontFamily: MONO }}>{item.pureWt ? `${parseFloat(item.pureWt).toFixed(1)}g` : "--"}</p>
          </div>
          <div>
            <p className="text-[8px] uppercase tracking-[1px] text-[#6B6458]" style={{ fontFamily: MONO }}>Ageing</p>
            <p className="text-[10px] text-[#1A1814]/60" style={{ fontFamily: MONO }}>{item.ageingDays}d</p>
          </div>
        </div>
      </div>

      {/* Suggest Clients toggle */}
      <div className="border-t border-[#EDE7D8]">
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[9px] font-medium text-[#8B6914] hover:bg-[#C9A84C]/8 transition-colors"
          style={{ fontFamily: MONO }}
        >
          <Users className="w-3 h-3" />
          {expanded ? "Hide Suggestions" : "Suggest Clients"}
        </button>

        {/* Expanded recommendations */}
        {expanded && (
          <div className="px-2.5 pb-2.5 space-y-1">
            {recoLoading ? (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="w-3 h-3 animate-spin text-[#C9A84C] mr-1.5" />
                <span className="text-[9px] text-[#6B6458]" style={{ fontFamily: MONO }}>
                  Finding similar designs...
                </span>
              </div>
            ) : recommendations.length === 0 ? (
              <p className="text-[9px] text-[#1A1814]/30 text-center py-2" style={{ fontFamily: MONO }}>
                No matches found
              </p>
            ) : (
              recommendations.map((rec, idx) => (
                <div
                  key={rec.clientName}
                  className={cn(
                    "flex items-start gap-2 p-1.5 rounded-md",
                    idx === 0 ? "bg-[#C9A84C]/8" : "bg-[#F5F1E8]/50"
                  )}
                >
                  <div
                    className={cn(
                      "shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold mt-0.5",
                      idx === 0 ? "bg-[#C9A84C]/20 text-[#8B6914]" : "bg-[#EDE7D8] text-[#6B6458]"
                    )}
                    style={{ fontFamily: MONO }}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-medium text-[#1A1814] truncate leading-tight">
                      {rec.clientName}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {rec.state && (
                        <span className="flex items-center gap-0.5 text-[8px] text-[#6B6458]">
                          <MapPin className="w-2 h-2" />
                          {rec.state}
                        </span>
                      )}
                      <span className="text-[8px] text-[#4A7C59] font-medium" style={{ fontFamily: MONO }}>
                        {Math.round(rec.topSimilarity * 100)}% match
                      </span>
                      <span className="text-[8px] text-[#6B6458]" style={{ fontFamily: MONO }}>
                        {rec.matchCount} similar
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Memo Tracker Dialog ----

function MemoTrackerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [bdmFilter, setBdmFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [memoPage, setMemoPage] = useState(1);

  const { data: memoData } = useQuery({
    queryKey: ["stock-items-memo"],
    queryFn: () => fetchStockItems({ status: "Memo", limit: 500 }),
    enabled: open,
  });

  // Filter out internal/test entries (HQRJP location, Shreeja Mahasani salesperson)
  const allMemoItems = useMemo(() => {
    const raw = memoData?.items ?? [];
    return raw.filter((item) => {
      if (item.location && item.location.toUpperCase().includes("HQRJP")) return false;
      if (item.memoSalesPersonName && item.memoSalesPersonName.toLowerCase().includes("shreeja")) return false;
      return true;
    });
  }, [memoData]);

  // BDM summary cards
  const bdmSummary = useMemo(() => {
    const map = new Map<string, { count: number; tagValue: number }>();
    for (const item of allMemoItems) {
      const bdm = item.memoSalesPersonName || "Unassigned";
      const existing = map.get(bdm) || { count: 0, tagValue: 0 };
      existing.count += 1;
      existing.tagValue += item.tagPrice;
      map.set(bdm, existing);
    }
    return Array.from(map.entries()).map(([bdm, data]) => ({ bdm, ...data })).sort((a, b) => b.tagValue - a.tagValue);
  }, [allMemoItems]);

  const bdmOptions = useMemo(() => bdmSummary.map((b) => b.bdm), [bdmSummary]);
  const catOptions = useMemo(() => {
    const cats = new Set<string>();
    for (const item of allMemoItems) if (item.category) cats.add(item.category);
    return Array.from(cats).sort();
  }, [allMemoItems]);

  // Filter items
  const filtered = useMemo(() => {
    return allMemoItems.filter((item) => {
      if (bdmFilter !== "all" && (item.memoSalesPersonName || "Unassigned") !== bdmFilter) return false;
      if (catFilter !== "all" && item.category !== catFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!item.jewelCode.toLowerCase().includes(q) && !(item.styleNo ?? "").toLowerCase().includes(q) && !(item.memoClientName ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allMemoItems, bdmFilter, catFilter, search]);

  const MEMO_PER_PAGE = 30;
  const totalMemoPages = Math.max(1, Math.ceil(filtered.length / MEMO_PER_PAGE));
  const pagedMemo = filtered.slice((memoPage - 1) * MEMO_PER_PAGE, memoPage * MEMO_PER_PAGE);

  function handleMemoExport() {
    const headers = ["Jewel Code", "Style No", "Category", "BDM", "Client", "Tag Price", "Pure Wt", "Ageing Days"];
    const rows = filtered.map((i) => [
      i.jewelCode, i.styleNo ?? "", i.category ?? "", i.memoSalesPersonName ?? "", i.memoClientName ?? "",
      i.tagPrice, i.pureWt ?? "", i.ageingDays,
    ]);
    downloadCSV("memo-tracker-export.csv", headers, rows);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto bg-white border-[#D4C9A8]">
        <DialogHeader>
          <DialogTitle className="text-lg text-[#1A1814]" style={{ fontFamily: SERIF, fontWeight: 600 }}>
            Memo Stock Tracker
          </DialogTitle>
          <DialogDescription className="text-xs text-[#6B6458]">
            {allMemoItems.length} items currently on memo
          </DialogDescription>
        </DialogHeader>

        {/* BDM Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-4">
          {bdmSummary.slice(0, 8).map((b) => (
            <div
              key={b.bdm}
              onClick={() => { setBdmFilter(bdmFilter === b.bdm ? "all" : b.bdm); setMemoPage(1); }}
              className={cn(
                "p-2.5 rounded-lg border cursor-pointer transition-colors",
                bdmFilter === b.bdm ? "border-[#C9A84C] bg-[rgba(201,168,76,0.06)]" : "border-[#D4C9A8] bg-white hover:bg-[#F5F1E8]"
              )}
            >
              <p className="text-[10px] font-medium text-[#1A1814] truncate" style={{ fontFamily: MONO }}>{b.bdm}</p>
              <p className="text-[12px] font-semibold text-[#8B6914]">{b.count} items</p>
              <p className="text-[10px] text-[#6B6458]" style={{ fontFamily: MONO }}>{fmt(b.tagValue)}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="relative w-44">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#1A1814]/30" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setMemoPage(1); }}
              placeholder="Search..."
              className="h-8 pl-8 text-xs border-[#D4C9A8] bg-white"
              style={{ fontFamily: MONO, fontSize: "11px" }}
            />
          </div>
          <Select value={catFilter} onValueChange={(v) => { setCatFilter(v); setMemoPage(1); }}>
            <SelectTrigger className="h-8 w-[140px] text-xs border-[#D4C9A8] bg-white" style={{ fontFamily: MONO, fontSize: "11px" }}>
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {catOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={handleMemoExport} className="h-8 text-xs border-[#D4C9A8] text-[#1A1814]/60 hover:bg-[#F5F1E8]">
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
          </Button>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-[#D4C9A8] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]" style={{ fontFamily: "'Jost', sans-serif" }}>
              <thead>
                <tr style={{ backgroundColor: "#F5F1E8" }}>
                  {["Image", "BDM / Holder", "Jewel Code", "Style No", "Category", "Tag \u20B9", "Pure Wt", "Ageing", "Status"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[9.5px] tracking-[1.5px] uppercase text-[#6B6458]" style={{ fontFamily: MONO }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedMemo.map((item) => (
                  <tr key={item.id} className="border-t border-[#EDE7D8] hover:bg-[#F5F1E8] transition-colors">
                    <td className="px-3 py-2">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" className="w-9 h-9 rounded object-cover border border-[#D4C9A8]" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div className="w-9 h-9 rounded bg-[#F5F1E8] flex items-center justify-center">
                          <span className="text-[8px] text-[#1A1814]/20" style={{ fontFamily: MONO }}>N/A</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-[11px] font-medium text-[#1A1814]">{item.memoSalesPersonName || "\u2014"}</p>
                      <p className="text-[10px] text-[#6B6458]">{item.memoClientName || "\u2014"}</p>
                    </td>
                    <td className="px-3 py-2 text-[#1A1814] font-medium" style={{ fontFamily: MONO, fontSize: "11px" }}>{item.jewelCode}</td>
                    <td className="px-3 py-2 text-[#1A1814]/60" style={{ fontFamily: MONO, fontSize: "11px" }}>{item.styleNo ?? "\u2014"}</td>
                    <td className="px-3 py-2 text-[#1A1814]/70">{item.category ?? "\u2014"}</td>
                    <td className="px-3 py-2 text-right" style={{ fontFamily: MONO, fontSize: "11px" }}>{fmt(item.tagPrice)}</td>
                    <td className="px-3 py-2 text-right text-[#1A1814]/60" style={{ fontFamily: MONO, fontSize: "11px" }}>{item.pureWt ? `${parseFloat(item.pureWt).toFixed(2)}g` : "\u2014"}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn("inline-block text-[9px] px-2 py-0.5 rounded-full font-medium", ageTagClass(getAgeingTag(item.ageingDays)))}>{item.ageingDays}d</span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 border-0 bg-[#FFF4E0] text-[#8B5E00]">Memo</Badge>
                    </td>
                  </tr>
                ))}
                {pagedMemo.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-[#1A1814]/30">No memo items found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {totalMemoPages > 1 && (
          <div className="flex items-center justify-between mt-3">
            <p className="text-[11px] text-[#1A1814]/40" style={{ fontFamily: MONO }}>
              Page {memoPage} of {totalMemoPages} &middot; {filtered.length} items
            </p>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" disabled={memoPage <= 1} onClick={() => setMemoPage((p) => p - 1)} className="h-7 w-7 p-0 border-[#D4C9A8]">
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button variant="outline" size="sm" disabled={memoPage >= totalMemoPages} onClick={() => setMemoPage((p) => p + 1)} className="h-7 w-7 p-0 border-[#D4C9A8]">
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- Inventory Dashboard Sheet ----

interface DashboardPanelProps {
  open: boolean;
  onClose: () => void;
  summary: StockSummary | null;
  goldPrice: number;
}

function InventoryDashboardSheet({ open, onClose, summary, goldPrice }: DashboardPanelProps) {
  const [selectedAgeingTag, setSelectedAgeingTag] = useState<string | null>(null);
  const [selectedSegmentFilter, setSelectedSegmentFilter] = useState<string | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string | null>(null);

  // Reset segment/category filters when ageing bucket changes
  useEffect(() => {
    setSelectedSegmentFilter(null);
    setSelectedCategoryFilter(null);
  }, [selectedAgeingTag]);

  // Reset category filter when segment changes
  useEffect(() => {
    setSelectedCategoryFilter(null);
  }, [selectedSegmentFilter]);

  // Filtered summary query — only fires when an ageing bucket is selected
  const { data: filteredSummary, isFetching: isFilterLoading } = useQuery({
    queryKey: ["stock-summary", selectedAgeingTag],
    queryFn: () => fetchStockSummary(selectedAgeingTag!),
    enabled: selectedAgeingTag !== null,
  });

  // Fetch actual stock items for the selected ageing bucket
  const { data: ageingStockData, isFetching: isAgeingStockLoading } = useQuery({
    queryKey: ["ageing-stock-items", selectedAgeingTag],
    queryFn: () => fetchStockItems({ status: "On Hand", ageingTag: selectedAgeingTag!, limit: 200, sortBy: "tagPrice", sortDir: "desc" }),
    enabled: selectedAgeingTag !== null,
  });

  // Use filtered data for all charts except ageing pie
  const chartSource = selectedAgeingTag && filteredSummary ? filteredSummary : summary;

  const kpis = useMemo(() => {
    if (!chartSource) return [];
    return [
      { label: "On Hand", value: chartSource.onHandCount.toLocaleString("en-IN"), color: "#4A7C59" },
      { label: "Memo", value: chartSource.memoCount.toLocaleString("en-IN"), color: "#8B5E00" },
      { label: "On-Hand Cost Value", value: fmt(chartSource.onHandCostValue), color: "#6B6458" },
      { label: "Pure Weight", value: `${(chartSource.onHandPureWt ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}g`, color: "#C9A84C" },
    ];
  }, [chartSource]);

  // Ageing pie always uses unfiltered summary (it's the control, not a target)
  const ageingData = useMemo(() => {
    const bucketOrder = ["Fresh", "Active", "Moderate", "Slow Moving", "Ageing", "Non-Moving"];
    const data = summary?.ageingBreakdown ?? [];
    return bucketOrder.map((label) => {
      const found = data.find((d) => d.label === label);
      return { label, count: found?.count ?? 0, tagValue: found?.tagValue ?? 0 };
    });
  }, [summary]);

  const categoryData = useMemo(
    () => (chartSource?.categoryBreakdown ?? []).filter((c) => c.count > 0),
    [chartSource],
  );

  const locationData = useMemo(
    () => (chartSource?.locationBreakdown ?? []).slice(0, 10),
    [chartSource],
  );

  const locationStockData = useMemo(
    () =>
      (chartSource?.locationBreakdown ?? [])
        .filter((l) => l.location.toLowerCase() !== "client repair")
        .sort((a, b) => b.count - a.count),
    [chartSource],
  );

  const bdmStockData = useMemo(
    () =>
      (chartSource?.bdmBreakdown ?? [])
        .filter((b) => {
          const name = b.salesPerson.toLowerCase();
          return !name.includes("hqrjp") && !name.includes("shreeja") && !name.includes("sold but not delivered");
        })
        .sort((a, b) => b.grossWt - a.grossWt),
    [chartSource],
  );

  const segmentData = useMemo(
    () => (chartSource?.segmentBreakdown ?? []).filter((s) => s.count > 0),
    [chartSource],
  );

  // Derive available segments from ageing stock items (with counts)
  const availableSegments = useMemo(() => {
    const items = ageingStockData?.items ?? [];
    const counts: Record<string, number> = {};
    for (const item of items) {
      const seg = deriveProductSegment(item.styleNo, item.category);
      counts[seg] = (counts[seg] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));
  }, [ageingStockData]);

  // Derive available categories from (segment-filtered) items (with counts)
  const availableCategories = useMemo(() => {
    let items = ageingStockData?.items ?? [];
    if (selectedSegmentFilter) {
      items = items.filter((item) => deriveProductSegment(item.styleNo, item.category) === selectedSegmentFilter);
    }
    const counts: Record<string, number> = {};
    for (const item of items) {
      const cat = item.category || "Unknown";
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));
  }, [ageingStockData, selectedSegmentFilter]);

  // Apply segment + category filters to ageing stock items
  const filteredAgeingItems = useMemo(() => {
    let items = ageingStockData?.items ?? [];
    if (selectedSegmentFilter) {
      items = items.filter((item) => deriveProductSegment(item.styleNo, item.category) === selectedSegmentFilter);
    }
    if (selectedCategoryFilter) {
      items = items.filter((item) => item.category === selectedCategoryFilter);
    }
    return items;
  }, [ageingStockData, selectedSegmentFilter, selectedCategoryFilter]);

  const [selectedBdm, setSelectedBdm] = useState<string | null>(null);

  const SECTION_TITLE: React.CSSProperties = {
    fontFamily: SERIF,
    fontWeight: 600,
    fontSize: "14px",
    color: "#1A1814",
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.25 }}
          className="relative z-40"
          style={{ backgroundColor: "#FAF7F0" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-0 pt-0 pb-4 border-b border-[#EDE7D8]">
            <div>
              <h2
                className="text-2xl text-[#1A1814]"
                style={{ fontFamily: SERIF, fontWeight: 600 }}
              >
                Inventory Dashboard
              </h2>
              <p className="text-xs text-[#6B6458] mt-0.5" style={{ fontFamily: MONO }}>
                On-hand stock overview &middot; KPIs, ageing &amp; breakdowns
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="h-8 text-xs border-[#C9A84C]/40 text-[#8B6914] hover:bg-[#C9A84C]/10"
            >
              <Search className="w-3.5 h-3.5 mr-1.5" />
              View Items
            </Button>
          </div>

          <div className="py-5 space-y-6">
            {/* Active filter badge */}
            {selectedAgeingTag && (
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-[#C9A84C] bg-[#FBF8EF] text-[#8B5E00] text-xs gap-1.5 pr-1.5 cursor-pointer"
                  onClick={() => setSelectedAgeingTag(null)}
                  style={{ fontFamily: MONO }}
                >
                  Filtered: {selectedAgeingTag}
                  <X className="w-3 h-3 ml-1" />
                </Badge>
                {isFilterLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A84C]" />}
              </div>
            )}

            {/* KPI Cards — 6 across */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {kpis.map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-lg border border-[#EDE7D8] bg-white p-4"
                >
                  <p
                    className="text-[9px] uppercase tracking-[1.5px] text-[#6B6458] mb-1.5"
                    style={{ fontFamily: MONO }}
                  >
                    {kpi.label}
                  </p>
                  <p
                    className="text-xl font-semibold"
                    style={{ fontFamily: MONO, color: kpi.color }}
                  >
                    {kpi.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Ageing Distribution — donut chart */}
            <div>
              <p style={SECTION_TITLE} className="mb-3">Ageing Distribution</p>
              <div className="rounded-xl border border-[#EDE7D8] bg-gradient-to-b from-white to-[#FDFBF7] p-5 flex flex-col items-center shadow-sm">
                <div className="relative w-full">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <defs>
                        {ageingData.map((entry) => {
                          const base = AGEING_COLORS[entry.label] || "#C9A84C";
                          return (
                            <linearGradient key={`ag-${entry.label}`} id={`ag-${entry.label.replace(/\s/g, "")}`} x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor={base} stopOpacity={0.9} />
                              <stop offset="100%" stopColor={base} stopOpacity={0.65} />
                            </linearGradient>
                          );
                        })}
                      </defs>
                      <Pie
                        data={ageingData}
                        dataKey="count"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        outerRadius={105}
                        innerRadius={58}
                        paddingAngle={3}
                        cornerRadius={4}
                        label={({ label, count }: { label: string; count: number }) => `${label} (${count})`}
                        labelLine={{ stroke: "#D4C9A8", strokeWidth: 1 }}
                        style={{ fontSize: 10, fontFamily: MONO, cursor: "pointer" }}
                        animationDuration={800}
                        animationEasing="ease-out"
                        onClick={(_: unknown, index: number) => {
                          const clicked = ageingData[index]?.label;
                          if (clicked) setSelectedAgeingTag(selectedAgeingTag === clicked ? null : clicked);
                        }}
                      >
                        {ageingData.map((entry) => (
                          <Cell
                            key={entry.label}
                            fill={`url(#ag-${entry.label.replace(/\s/g, "")})`}
                            opacity={selectedAgeingTag && selectedAgeingTag !== entry.label ? 0.25 : 1}
                            stroke={selectedAgeingTag === entry.label ? "#1A1814" : "#fff"}
                            strokeWidth={selectedAgeingTag === entry.label ? 2.5 : 1.5}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          fontFamily: MONO,
                          fontSize: "11px",
                          borderRadius: "10px",
                          border: "1px solid #EDE7D8",
                          backgroundColor: "rgba(253,251,247,0.95)",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                          padding: "8px 12px",
                        }}
                        formatter={(value: number, name: string) => [
                          value.toLocaleString("en-IN"),
                          name,
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center stat */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ top: "-4px" }}>
                    <div className="text-center">
                      <p className="text-xl font-bold text-[#1A1814]" style={{ fontFamily: MONO }}>
                        {ageingData.reduce((s, d) => s + d.count, 0).toLocaleString("en-IN")}
                      </p>
                      <p className="text-[9px] text-[#6B6458]/70 uppercase tracking-wider" style={{ fontFamily: MONO }}>Total</p>
                    </div>
                  </div>
                </div>
                {/* Legend row — clickable */}
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
                  {ageingData.map((a) => (
                    <div
                      key={a.label}
                      className="flex items-center gap-1.5 cursor-pointer transition-opacity duration-200"
                      style={{ opacity: selectedAgeingTag && selectedAgeingTag !== a.label ? 0.3 : 1 }}
                      onClick={() => setSelectedAgeingTag(selectedAgeingTag === a.label ? null : a.label)}
                    >
                      <span
                        className="inline-block w-3 h-3 rounded-full"
                        style={{
                          backgroundColor: AGEING_COLORS[a.label] || "#C9A84C",
                          outline: selectedAgeingTag === a.label ? "2px solid #1A1814" : "none",
                          outlineOffset: "2px",
                        }}
                      />
                      <span className="text-[10px] text-[#6B6458]" style={{ fontFamily: MONO }}>
                        {a.label} ({a.count})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Product Segment + Category donut charts side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Product Segment */}
              <div>
                <p style={SECTION_TITLE} className="mb-3">Product Segment</p>
                <div className="rounded-xl border border-[#EDE7D8] bg-gradient-to-b from-white to-[#FDFBF7] p-5 flex flex-col items-center shadow-sm">
                  {segmentData.length > 0 ? (
                    <>
                      <div className="relative w-full">
                        <ResponsiveContainer width="100%" height={260}>
                          <PieChart>
                            <defs>
                              {segmentData.map((_, i) => {
                                const base = PIE_COLORS[i % PIE_COLORS.length];
                                return (
                                  <linearGradient key={`seg-${i}`} id={`seg-${i}`} x1="0" y1="0" x2="1" y2="1">
                                    <stop offset="0%" stopColor={base} stopOpacity={0.9} />
                                    <stop offset="100%" stopColor={base} stopOpacity={0.6} />
                                  </linearGradient>
                                );
                              })}
                            </defs>
                            <Pie
                              data={segmentData}
                              dataKey="count"
                              nameKey="segment"
                              cx="50%"
                              cy="50%"
                              outerRadius={95}
                              innerRadius={50}
                              paddingAngle={3}
                              cornerRadius={3}
                              label={({ segment, count }: { segment: string; count: number }) => `${segment} (${count})`}
                              labelLine={{ stroke: "#D4C9A8", strokeWidth: 1 }}
                              style={{ fontSize: 9, fontFamily: MONO }}
                              animationDuration={800}
                              animationEasing="ease-out"
                            >
                              {segmentData.map((_, i) => (
                                <Cell key={i} fill={`url(#seg-${i})`} stroke="#fff" strokeWidth={1.5} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ fontFamily: MONO, fontSize: "11px", borderRadius: "10px", border: "1px solid #EDE7D8", backgroundColor: "rgba(253,251,247,0.95)", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", padding: "8px 12px" }}
                              formatter={(value: number) => [value.toLocaleString("en-IN"), "Count"]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="text-center">
                            <p className="text-lg font-bold text-[#1A1814]" style={{ fontFamily: MONO }}>
                              {segmentData.reduce((s, d) => s + d.count, 0).toLocaleString("en-IN")}
                            </p>
                            <p className="text-[8px] text-[#6B6458]/70 uppercase tracking-wider" style={{ fontFamily: MONO }}>Items</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5 mt-2">
                        {segmentData.map((s, i) => (
                          <div key={s.segment} className="flex items-center gap-1.5">
                            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                            <span className="text-[9px] text-[#6B6458]" style={{ fontFamily: MONO }}>{s.segment}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-[#1A1814]/30 text-center py-8" style={{ fontFamily: MONO }}>No segment data</p>
                  )}
                </div>
              </div>

              {/* Category — horizontal bar chart */}
              <div>
                <p style={SECTION_TITLE} className="mb-3">Category Breakdown</p>
                <div className="rounded-xl border border-[#EDE7D8] bg-gradient-to-b from-white to-[#FDFBF7] p-5 shadow-sm">
                  {categoryData.length > 0 ? (
                    <>
                      <div className="flex items-baseline gap-2 mb-4">
                        <span className="text-lg font-bold text-[#1A1814]" style={{ fontFamily: MONO }}>
                          {categoryData.reduce((s, d) => s + d.count, 0).toLocaleString("en-IN")}
                        </span>
                        <span className="text-[10px] text-[#6B6458]/70 uppercase tracking-wider" style={{ fontFamily: MONO }}>Total Items</span>
                      </div>
                      <ResponsiveContainer width="100%" height={Math.max(260, categoryData.length * 26)}>
                        <BarChart layout="vertical" data={categoryData} margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barSize={16}>
                          <defs>
                            {categoryData.map((_, i) => {
                              const base = PIE_COLORS[i % PIE_COLORS.length];
                              return (
                                <linearGradient key={`catBar-${i}`} id={`catBar-${i}`} x1="0" y1="0" x2="1" y2="0">
                                  <stop offset="0%" stopColor={base} stopOpacity={0.85} />
                                  <stop offset="100%" stopColor={base} stopOpacity={0.5} />
                                </linearGradient>
                              );
                            })}
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#EDE7D8" horizontal={false} strokeOpacity={0.6} />
                          <YAxis
                            dataKey="category"
                            type="category"
                            width={130}
                            tick={{ fontSize: 10, fontFamily: MONO, fill: "#6B6458" }}
                            tickLine={false}
                            axisLine={false}
                            interval={0}
                          />
                          <XAxis type="number" hide />
                          <Tooltip
                            contentStyle={{ fontFamily: MONO, fontSize: "11px", borderRadius: "10px", border: "1px solid #EDE7D8", backgroundColor: "rgba(253,251,247,0.95)", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", padding: "8px 12px" }}
                            formatter={(value: number) => [value.toLocaleString("en-IN"), "Count"]}
                          />
                          <Bar
                            dataKey="count"
                            radius={[0, 4, 4, 0]}
                            animationDuration={800}
                            animationEasing="ease-out"
                            label={({ x, y, width: w, height: h, value }: { x: number; y: number; width: number; height: number; value: number }) => (
                              <text x={x + w + 4} y={y + h / 2} dy={3} fontSize={9} fontFamily={MONO} fill="#6B6458">
                                {value.toLocaleString("en-IN")}
                              </text>
                            )}
                          >
                            {categoryData.map((_, i) => (
                              <Cell key={i} fill={`url(#catBar-${i})`} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </>
                  ) : (
                    <p className="text-xs text-[#1A1814]/30 text-center py-8" style={{ fontFamily: MONO }}>No category data</p>
                  )}
                </div>
              </div>
            </div>

            {/* Location + BDM composed charts side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Location On-Hand Stock — vertical bar + cost line */}
              <div>
                <p style={SECTION_TITLE} className="mb-3">Location-wise On-Hand Stock</p>
                <div className="rounded-xl border border-[#EDE7D8] bg-gradient-to-b from-white to-[#FDFBF7] p-5 shadow-sm">
                  {locationStockData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={340}>
                      <ComposedChart data={locationStockData} margin={{ left: 10, right: 10, top: 8, bottom: 40 }}>
                        <defs>
                          <linearGradient id="locBarGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#2B5EA7" stopOpacity={0.9} />
                            <stop offset="100%" stopColor="#2B5EA7" stopOpacity={0.5} />
                          </linearGradient>
                          <linearGradient id="locLineGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#C9A84C" stopOpacity={0.6} />
                            <stop offset="50%" stopColor="#C9A84C" stopOpacity={1} />
                            <stop offset="100%" stopColor="#C9A84C" stopOpacity={0.6} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EDE7D8" vertical={false} strokeOpacity={0.6} />
                        <XAxis
                          dataKey="location"
                          tick={{ fontSize: 9, fontFamily: MONO, fill: "#6B6458" }}
                          angle={-35}
                          textAnchor="end"
                          interval={0}
                          height={60}
                          axisLine={{ stroke: "#EDE7D8" }}
                          tickLine={false}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 10, fontFamily: MONO, fill: "#6B6458" }}
                          label={{ value: "On Hand Count", angle: -90, position: "insideLeft", style: { fontSize: 10, fontFamily: MONO, fill: "#6B6458" }, offset: -5 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fontSize: 10, fontFamily: MONO, fill: "#C9A84C" }}
                          tickFormatter={(v: number) => fmt(v)}
                          label={{ value: "Cost Value (\u20B9)", angle: 90, position: "insideRight", style: { fontSize: 10, fontFamily: MONO, fill: "#C9A84C" }, offset: -5 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            fontFamily: MONO,
                            fontSize: "11px",
                            borderRadius: "10px",
                            border: "1px solid #EDE7D8",
                            backgroundColor: "rgba(253,251,247,0.95)",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                            padding: "8px 12px",
                          }}
                          cursor={{ fill: "rgba(201,168,76,0.06)" }}
                          formatter={(value: number, name: string) => [
                            name === "costValue" ? fmt(value) : value.toLocaleString("en-IN"),
                            name === "costValue" ? "Cost Value" : "On Hand",
                          ]}
                        />
                        <Legend
                          wrapperStyle={{ fontFamily: MONO, fontSize: "10px", paddingTop: "4px" }}
                          iconType="circle"
                          iconSize={8}
                          formatter={(value: string) => (value === "count" ? "On Hand" : "Cost Value")}
                        />
                        <Bar yAxisId="left" dataKey="count" fill="url(#locBarGrad)" radius={[5, 5, 0, 0]} barSize={22} animationDuration={800} />
                        <Line yAxisId="right" dataKey="costValue" stroke="url(#locLineGrad)" strokeWidth={2.5} dot={{ r: 4, fill: "#C9A84C", stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#C9A84C", stroke: "#fff", strokeWidth: 2 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs text-[#1A1814]/30 text-center py-8" style={{ fontFamily: MONO }}>
                      No location data
                    </p>
                  )}
                </div>
              </div>

              {/* BDM Memo Stock — gross weight bar + cost line */}
              <div>
                <p style={SECTION_TITLE} className="mb-3">Client Memo Holdings</p>
                <div className="rounded-xl border border-[#EDE7D8] bg-gradient-to-b from-white to-[#FDFBF7] p-5 shadow-sm">
                  {bdmStockData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={340}>
                      <ComposedChart data={bdmStockData} margin={{ left: 10, right: 10, top: 8, bottom: 40 }} onClick={(e) => { if (e?.activeLabel) setSelectedBdm(e.activeLabel); }} style={{ cursor: "pointer" }}>
                        <defs>
                          <linearGradient id="bdmBarGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#4A7C59" stopOpacity={0.9} />
                            <stop offset="100%" stopColor="#4A7C59" stopOpacity={0.5} />
                          </linearGradient>
                          <linearGradient id="bdmLineGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#A63C2A" stopOpacity={0.6} />
                            <stop offset="50%" stopColor="#A63C2A" stopOpacity={1} />
                            <stop offset="100%" stopColor="#A63C2A" stopOpacity={0.6} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EDE7D8" vertical={false} strokeOpacity={0.6} />
                        <XAxis
                          dataKey="salesPerson"
                          tick={{ fontSize: 9, fontFamily: MONO, fill: "#6B6458" }}
                          angle={-35}
                          textAnchor="end"
                          interval={0}
                          height={60}
                          axisLine={{ stroke: "#EDE7D8" }}
                          tickLine={false}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 10, fontFamily: MONO, fill: "#6B6458" }}
                          label={{ value: "Gross Weight (g)", angle: -90, position: "insideLeft", style: { fontSize: 10, fontFamily: MONO, fill: "#6B6458" }, offset: -5 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fontSize: 10, fontFamily: MONO, fill: "#A63C2A" }}
                          tickFormatter={(v: number) => fmt(v)}
                          label={{ value: "Cost Value (\u20B9)", angle: 90, position: "insideRight", style: { fontSize: 10, fontFamily: MONO, fill: "#A63C2A" }, offset: -5 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            fontFamily: MONO,
                            fontSize: "11px",
                            borderRadius: "10px",
                            border: "1px solid #EDE7D8",
                            backgroundColor: "rgba(253,251,247,0.95)",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                            padding: "8px 12px",
                          }}
                          cursor={{ fill: "rgba(74,124,89,0.06)" }}
                          formatter={(value: number, name: string) => [
                            name === "costValue" ? fmt(value) : `${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}g`,
                            name === "costValue" ? "Cost Value" : "Gross Weight",
                          ]}
                        />
                        <Legend
                          wrapperStyle={{ fontFamily: MONO, fontSize: "10px", paddingTop: "4px" }}
                          iconType="circle"
                          iconSize={8}
                          formatter={(value: string) => (value === "grossWt" ? "Gross Weight" : "Cost Value")}
                        />
                        <Bar yAxisId="left" dataKey="grossWt" fill="url(#bdmBarGrad)" radius={[5, 5, 0, 0]} barSize={22} animationDuration={800} />
                        <Line yAxisId="right" dataKey="costValue" stroke="url(#bdmLineGrad)" strokeWidth={2.5} dot={{ r: 4, fill: "#A63C2A", stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#A63C2A", stroke: "#fff", strokeWidth: 2 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs text-[#1A1814]/30 text-center py-8" style={{ fontFamily: MONO }}>
                      No sales person data
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Ageing Bucket Stock Items — grouped by Product Segment */}
          {selectedAgeingTag && (
            <div className="px-5 pb-5 space-y-3">
              <div className="flex items-center gap-2">
                <h3 style={SECTION_TITLE}>{selectedAgeingTag} Items — On Hand</h3>
                {ageingStockData && (
                  <Badge variant="secondary" className="text-[10px] px-2 py-0 h-5 bg-[#F5F1E8] text-[#6B6458] border-0" style={{ fontFamily: MONO }}>
                    {filteredAgeingItems.length}{filteredAgeingItems.length !== ageingStockData.items.length ? ` / ${ageingStockData.items.length}` : ""} items
                  </Badge>
                )}
              </div>

              {/* Segment & Category filter dropdowns */}
              {ageingStockData && availableSegments.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Select
                    value={selectedSegmentFilter ?? "__all__"}
                    onValueChange={(v) => setSelectedSegmentFilter(v === "__all__" ? null : v)}
                  >
                    <SelectTrigger
                      className="h-7 w-auto min-w-[140px] text-[11px] border-[#E8E0D0] bg-[#F5F1E8] text-[#6B6458] focus:ring-[#C9A84C]/30"
                      style={{ fontFamily: MONO }}
                    >
                      <SelectValue placeholder="All Segments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__" style={{ fontFamily: MONO }} className="text-[11px]">All Segments</SelectItem>
                      {availableSegments.map(({ label, count }) => (
                        <SelectItem key={label} value={label} style={{ fontFamily: MONO }} className="text-[11px]">
                          {label} ({count})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {availableCategories.length > 1 && (
                    <Select
                      value={selectedCategoryFilter ?? "__all__"}
                      onValueChange={(v) => setSelectedCategoryFilter(v === "__all__" ? null : v)}
                    >
                      <SelectTrigger
                        className="h-7 w-auto min-w-[140px] text-[11px] border-[#E8E0D0] bg-white text-[#6B6458] focus:ring-[#8B5E00]/30"
                        style={{ fontFamily: MONO }}
                      >
                        <SelectValue placeholder="All Categories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__" style={{ fontFamily: MONO }} className="text-[11px]">All Categories</SelectItem>
                        {availableCategories.map(({ label, count }) => (
                          <SelectItem key={label} value={label} style={{ fontFamily: MONO }} className="text-[11px]">
                            {label} ({count})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {isAgeingStockLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-[#C9A84C] mr-2" />
                  <span className="text-sm text-[#6B6458]" style={{ fontFamily: MONO }}>Loading items...</span>
                </div>
              ) : filteredAgeingItems.length > 0 ? (
                <div className="space-y-5">
                  {selectedSegmentFilter ? (
                    /* Flat grid when a specific segment is selected */
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {filteredAgeingItems.map((item) => (
                        <InventoryCardWithReco key={item.id} item={item} onSelect={() => {}} goldPrice={goldPrice} />
                      ))}
                    </div>
                  ) : (
                    /* Grouped by segment when no segment filter */
                    Object.entries(
                      filteredAgeingItems.reduce<Record<string, LiveStockItem[]>>((acc, item) => {
                        const seg = deriveProductSegment(item.styleNo, item.category);
                        if (!acc[seg]) acc[seg] = [];
                        acc[seg].push(item);
                        return acc;
                      }, {})
                    )
                      .sort((a, b) => b[1].length - a[1].length)
                      .map(([segment, items]) => (
                        <div key={segment} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <p className="text-[13px] font-semibold text-[#1A1814]" style={{ fontFamily: SERIF }}>{segment}</p>
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 bg-[#F5F1E8] text-[#6B6458] border-0" style={{ fontFamily: MONO }}>
                              {items.length}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                            {items.map((item) => (
                              <InventoryCardWithReco key={item.id} item={item} onSelect={() => {}} goldPrice={goldPrice} />
                            ))}
                          </div>
                        </div>
                      ))
                  )}
                </div>
              ) : ageingStockData && ageingStockData.items.length > 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-[#1A1814]/30" style={{ fontFamily: MONO }}>No items match the selected filters.</p>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-xs text-[#1A1814]/30" style={{ fontFamily: MONO }}>No on-hand items in this ageing bucket.</p>
                </div>
              )}
            </div>
          )}

          {/* BDM Stock Detail Dialog */}
          {selectedBdm && (
            <BdmStockDialog salesPerson={selectedBdm} onClose={() => setSelectedBdm(null)} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---- BDM Stock Detail Dialog ----

function BdmStockDialog({ salesPerson, onClose }: { salesPerson: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["bdm-stock-detail", salesPerson],
    queryFn: () => fetchStockItems({ status: "Memo", clientName: salesPerson, limit: 200, sortBy: "ageingDays", sortDir: "desc" }),
  });

  const items = data?.items ?? [];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto bg-white border-[#D4C9A8]">
        <DialogHeader>
          <DialogTitle className="text-lg text-[#1A1814]" style={{ fontFamily: SERIF, fontWeight: 600 }}>
            Memo Holdings — {salesPerson}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#6B6458]" style={{ fontFamily: MONO }}>
            {isLoading ? "Loading..." : `${items.length} items on memo`}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-sm text-[#6B6458]" style={{ fontFamily: MONO }}>Loading items...</span>
          </div>
        ) : (
          <div className="rounded-lg border border-[#D4C9A8] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]" style={{ fontFamily: "'Jost', sans-serif" }}>
                <thead>
                  <tr style={{ backgroundColor: "#F5F1E8" }}>
                    {["Image", "Jewel Code", "Style No", "Category", "Tag \u20B9", "Pure Wt", "Ageing"].map((h) => (
                      <th
                        key={h}
                        className={cn("px-3 py-2.5", h === "Tag \u20B9" || h === "Pure Wt" || h === "Ageing" ? "text-right" : "text-left")}
                        style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: "1.5px", color: "#6B6458", textTransform: "uppercase" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const ageTag = getAgeingTag(item.ageingDays);
                    return (
                      <tr key={item.id} className="border-t border-[#EDE7D8] hover:bg-[#F5F1E8] transition-colors">
                        <td className="px-3 py-2">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.jewelCode}
                              className="w-10 h-10 rounded object-cover border border-[#D4C9A8]"
                              loading="lazy"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <div className="w-10 h-10 rounded bg-[#F5F1E8] flex items-center justify-center">
                              <span className="text-[9px] text-[#1A1814]/20" style={{ fontFamily: MONO }}>N/A</span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[#1A1814] font-medium" style={{ fontFamily: MONO, fontSize: "11px" }}>
                          {item.jewelCode}
                        </td>
                        <td className="px-3 py-2 text-[#1A1814]/60" style={{ fontFamily: MONO, fontSize: "11px" }}>
                          {item.styleNo ?? "--"}
                        </td>
                        <td className="px-3 py-2 text-[#1A1814]/70">{item.category ?? "--"}</td>
                        <td className="px-3 py-2 text-right text-[#1A1814]" style={{ fontFamily: MONO, fontSize: "11px" }}>
                          {fmt(item.tagPrice)}
                        </td>
                        <td className="px-3 py-2 text-right text-[#1A1814]/60" style={{ fontFamily: MONO, fontSize: "11px" }}>
                          {item.pureWt ? `${parseFloat(item.pureWt).toFixed(2)}g` : "--"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={cn("inline-block text-[9px] px-2 py-0.5 rounded-full font-medium", ageTagClass(ageTag))}>
                            {item.ageingDays}d &middot; {ageTag}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-[#1A1814]/30">No items found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- Pagination helper ----

function buildPageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "...")[] = [1];

  if (current > 3) pages.push("...");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) pages.push("...");

  pages.push(total);

  return pages;
}
