import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStockItems, fetchStockSummary } from "@/lib/api";
import type { LiveStockItem, StockSummary } from "@/lib/api";
import { fmt, ageTagClass, downloadCSV } from "../lib/intelligence-utils";
import { INV_PER_PAGE, AGEING_COLORS } from "../lib/intelligence-constants";
import { cn } from "@/lib/utils";

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
  LayoutGrid,
  LayoutList,
  ChevronLeft,
  ChevronRight,
  Plus,
  Eye,
  FileText,
  BarChart3,
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

// ---- Component ----

export default function InventoryPage() {
  // Filter state
  const [search, setSearch] = useState("");
  const [ageingFilter, setAgeingFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [stockTypeFilter, setStockTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // View and pagination
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [page, setPage] = useState(1);

  // Detail modal
  const [selectedItem, setSelectedItem] = useState<LiveStockItem | null>(null);
  const [memoOpen, setMemoOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);

  // ---- Fetch summary for filter dropdown options ----
  const { data: summary } = useQuery({
    queryKey: ["stock-summary"],
    queryFn: fetchStockSummary,
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
      {/* Page header */}
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDashboardOpen(true)}
            className="h-8 text-xs border-[#C9A84C]/40 text-[#8B6914] hover:bg-[#C9A84C]/10"
          >
            <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
            Dashboard
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

      {/* Filter bar */}
      <div
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

        {/* Spacer */}
        <div className="flex-1" />

        {/* View toggle */}
        <div className="flex items-center border rounded-md border-[#D4C9A8] overflow-hidden">
          <button
            onClick={() => setViewMode("table")}
            className={cn(
              "p-1.5 transition-colors",
              viewMode === "table"
                ? "bg-[#C9A84C] text-[#1A1814]"
                : "bg-white text-[#6B6458] hover:bg-[#F5F1E8]"
            )}
          >
            <LayoutList className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={cn(
              "p-1.5 transition-colors",
              viewMode === "grid"
                ? "bg-[#C9A84C] text-[#1A1814]"
                : "bg-white text-[#6B6458] hover:bg-[#F5F1E8]"
            )}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-[#6B6458] text-sm" style={{ fontFamily: MONO }}>Loading data...</div>
        </div>
      ) : (
        <>
          {/* Content: Table or Grid */}
          {viewMode === "table" ? (
            <InventoryTable items={items} onSelect={setSelectedItem} />
          ) : (
            <InventoryGrid items={items} onSelect={setSelectedItem} />
          )}

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
      )}

      {/* Item detail modal */}
      <ItemDetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      <MemoTrackerDialog open={memoOpen} onClose={() => setMemoOpen(false)} />
      <InventoryDashboardSheet
        open={dashboardOpen}
        onClose={() => setDashboardOpen(false)}
        summary={summary ?? null}
      />
    </div>
  );
}

// ---- Table View ----

interface TableProps {
  items: LiveStockItem[];
  onSelect: (item: LiveStockItem) => void;
}

function InventoryTable({ items, onSelect }: TableProps) {
  const THStyle: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: "9.5px",
    letterSpacing: "1.5px",
    color: "#6B6458",
    textTransform: "uppercase",
  };

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "#D4C9A8" }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]" style={{ fontFamily: "'Jost', sans-serif" }}>
          <thead>
            <tr style={{ backgroundColor: "#F5F1E8" }}>
              <th className="px-3 py-2.5 text-left" style={THStyle}>Image</th>
              <th className="px-3 py-2.5 text-left" style={THStyle}>Jewel Code</th>
              <th className="px-3 py-2.5 text-left" style={THStyle}>Style No</th>
              <th className="px-3 py-2.5 text-left" style={THStyle}>Category</th>
              <th className="px-3 py-2.5 text-left" style={THStyle}>Location</th>
              <th className="px-3 py-2.5 text-left" style={THStyle}>Stock Type</th>
              <th className="px-3 py-2.5 text-left" style={THStyle}>Base Metal</th>
              <th className="px-3 py-2.5 text-right" style={THStyle}>Tag Price</th>
              <th className="px-3 py-2.5 text-right" style={THStyle}>Pure Wt</th>
              <th className="px-3 py-2.5 text-center" style={THStyle}>Status</th>
              <th className="px-3 py-2.5 text-right" style={THStyle}>Ageing Days</th>
              <th className="px-3 py-2.5 text-center" style={THStyle}>Ageing Tag</th>
              <th className="px-3 py-2.5 text-center" style={THStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const ageTag = getAgeingTag(item.ageingDays);
              return (
                <tr
                  key={item.id}
                  onClick={() => onSelect(item)}
                  className="border-t border-[#EDE7D8] cursor-pointer transition-colors hover:bg-[#F5F1E8]"
                  style={{ backgroundColor: "#FFFFFF" }}
                >
                  <td className="px-3 py-2">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.jewelCode}
                        className="w-10 h-10 rounded object-cover border border-[#D4C9A8]"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-[#F5F1E8] flex items-center justify-center">
                        <span className="text-[9px] text-[#1A1814]/20" style={{ fontFamily: MONO }}>
                          N/A
                        </span>
                      </div>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-[#1A1814] font-medium"
                    style={{ fontFamily: MONO, fontSize: "11px" }}
                  >
                    {item.jewelCode}
                  </td>
                  <td
                    className="px-3 py-2 text-[#1A1814]/60"
                    style={{ fontFamily: MONO, fontSize: "11px" }}
                  >
                    {item.styleNo ?? "--"}
                  </td>
                  <td className="px-3 py-2 text-[#1A1814]/70">{item.category ?? "--"}</td>
                  <td className="px-3 py-2 text-[#1A1814]/50 text-[11px] max-w-[120px] truncate">
                    {item.location ?? "--"}
                  </td>
                  <td className="px-3 py-2 text-[#1A1814]/60">{item.stockType ?? "--"}</td>
                  <td className="px-3 py-2 text-[#1A1814]/60">{item.baseMetal ?? "--"}</td>
                  <td
                    className="px-3 py-2 text-right text-[#1A1814]"
                    style={{ fontFamily: MONO, fontSize: "11px" }}
                  >
                    {fmt(item.tagPrice)}
                  </td>
                  <td
                    className="px-3 py-2 text-right text-[#1A1814]/60"
                    style={{ fontFamily: MONO, fontSize: "11px" }}
                  >
                    {item.pureWt ? `${parseFloat(item.pureWt).toFixed(2)}g` : "--"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[9px] px-1.5 py-0 h-4 border-0",
                        item.currentStatus === "On Hand"
                          ? "bg-[#E8F5EC] text-[#2D6B42]"
                          : "bg-[#FFF4E0] text-[#8B5E00]"
                      )}
                    >
                      {item.currentStatus ?? "--"}
                    </Badge>
                  </td>
                  <td
                    className="px-3 py-2 text-right text-[#1A1814]/60"
                    style={{ fontFamily: MONO, fontSize: "11px" }}
                  >
                    {item.ageingDays}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={cn(
                        "inline-block text-[9px] px-2 py-0.5 rounded-full font-medium",
                        ageTagClass(ageTag)
                      )}
                    >
                      {ageTag}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-[#C9A84C] hover:text-[#8B6914] hover:bg-[#C9A84C]/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(item);
                      }}
                    >
                      <Plus className="w-3 h-3 mr-0.5" />
                      Kit
                    </Button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-12 text-center">
                  <p className="text-sm text-[#1A1814]/30">No items match the current filters.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Grid View ----

function InventoryGrid({ items, onSelect }: TableProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {items.map((item) => {
        const ageTag = getAgeingTag(item.ageingDays);
        return (
          <div
            key={item.id}
            onClick={() => onSelect(item)}
            className="rounded-lg border border-[#D4C9A8] bg-white cursor-pointer transition-all hover:shadow-md hover:border-[#C9A84C]/40 overflow-hidden group"
          >
            {/* Image */}
            <div className="aspect-square bg-[#F5F1E8] overflow-hidden relative">
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
              {/* View icon overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                <Eye className="w-5 h-5 text-white drop-shadow-md" />
              </div>
            </div>

            {/* Info */}
            <div className="p-2.5 space-y-1">
              <p
                className="text-[10px] font-medium text-[#1A1814] truncate"
                style={{ fontFamily: MONO }}
              >
                {item.jewelCode}
              </p>
              <p className="text-[10px] text-[#1A1814]/50 truncate">{item.category ?? "--"}</p>
              <div className="flex items-center justify-between">
                <span
                  className="text-[11px] text-[#1A1814] font-medium"
                  style={{ fontFamily: MONO }}
                >
                  {fmt(item.tagPrice)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[9px] text-[#1A1814]/40" style={{ fontFamily: MONO }}>
                <span>{item.pureWt ? `${parseFloat(item.pureWt).toFixed(1)}g` : "--"}</span>
                <span>{item.ageingDays}d</span>
              </div>
            </div>
          </div>
        );
      })}
      {items.length === 0 && (
        <div className="col-span-full py-16 text-center">
          <p className="text-sm text-[#1A1814]/30">No items match the current filters.</p>
        </div>
      )}
    </div>
  );
}

// ---- Item Detail Modal ----

interface ModalProps {
  item: LiveStockItem | null;
  onClose: () => void;
}

function ItemDetailModal({ item, onClose }: ModalProps) {
  if (!item) return null;

  const ageTag = getAgeingTag(item.ageingDays);

  const detailRows: Array<{ label: string; value: string | number }> = [
    { label: "Jewel Code", value: item.jewelCode },
    { label: "Style No", value: item.styleNo ?? "--" },
    { label: "Category", value: item.category ?? "--" },
    { label: "Sub Category", value: item.subCategory ?? "--" },
    { label: "Location", value: item.location ?? "--" },
    { label: "Stock Type", value: item.stockType ?? "--" },
    { label: "Make Type", value: item.makeType ?? "--" },
    { label: "Base Metal", value: item.baseMetal ?? "--" },
    { label: "Cost Price", value: fmt(item.costPrice) },
    { label: "Tag Price", value: fmt(item.tagPrice) },
    { label: "Gross Weight", value: item.grossWt ? `${parseFloat(item.grossWt).toFixed(2)}g` : "--" },
    { label: "Pure Weight", value: item.pureWt ? `${parseFloat(item.pureWt).toFixed(2)}g` : "--" },
    { label: "Diamond Weight", value: item.totDiaWt ? `${parseFloat(item.totDiaWt).toFixed(2)} ct` : "--" },
    { label: "Status", value: item.currentStatus ?? "--" },
    { label: "Ageing Days", value: item.ageingDays },
  ];

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl bg-white border-[#D4C9A8]">
        <DialogHeader>
          <DialogTitle
            className="text-lg text-[#1A1814]"
            style={{ fontFamily: SERIF, fontWeight: 600 }}
          >
            Item Detail
          </DialogTitle>
          <DialogDescription className="sr-only">
            Detailed view of inventory item {item.jewelCode}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-5">
          {/* Image */}
          <div className="shrink-0">
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={item.jewelCode}
                className="w-36 h-36 rounded-lg object-cover border border-[#D4C9A8]"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="w-36 h-36 rounded-lg bg-[#F5F1E8] flex items-center justify-center">
                <span className="text-xs text-[#1A1814]/20" style={{ fontFamily: MONO }}>
                  NO IMAGE
                </span>
              </div>
            )}
            {/* Tags below image */}
            <div className="flex gap-1.5 mt-2.5">
              <span
                className={cn(
                  "text-[9px] px-2 py-0.5 rounded-full font-medium",
                  ageTagClass(ageTag)
                )}
              >
                {ageTag}
              </span>
            </div>
          </div>

          {/* Detail rows */}
          <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2">
            {detailRows.map((row) => (
              <div key={row.label}>
                <p
                  className="text-[9px] uppercase tracking-[1px] text-[#6B6458] mb-0.5"
                  style={{ fontFamily: MONO }}
                >
                  {row.label}
                </p>
                <p
                  className="text-[12px] text-[#1A1814]"
                  style={{ fontFamily: MONO }}
                >
                  {row.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Memo info */}
        {item.currentStatus === "Memo" && item.memoClientName && (
          <div className="mt-3 p-2.5 rounded-md bg-[#FFF4E0]/50 border border-[#FFF4E0]">
            <p className="text-[10px] text-[#8B5E00]" style={{ fontFamily: MONO }}>
              MEMO TO: {item.memoClientName}
              {item.memoSalesPersonName ? ` | BDM: ${item.memoSalesPersonName}` : ""}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
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

  const allMemoItems = memoData?.items ?? [];

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
}

function InventoryDashboardSheet({ open, onClose, summary }: DashboardPanelProps) {
  const kpis = useMemo(() => {
    if (!summary) return [];
    return [
      { label: "On Hand", value: summary.onHandCount.toLocaleString("en-IN"), color: "#4A7C59" },
      { label: "Memo", value: summary.memoCount.toLocaleString("en-IN"), color: "#8B5E00" },
      { label: "On-Hand Cost Value", value: fmt(summary.onHandCostValue), color: "#6B6458" },
      { label: "Pure Weight", value: `${(summary.onHandPureWt ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}g`, color: "#C9A84C" },
    ];
  }, [summary]);

  const ageingData = useMemo(() => {
    const bucketOrder = ["Fresh", "Active", "Moderate", "Slow Moving", "Ageing", "Non-Moving"];
    const data = summary?.ageingBreakdown ?? [];
    return bucketOrder.map((label) => {
      const found = data.find((d) => d.label === label);
      return { label, count: found?.count ?? 0, tagValue: found?.tagValue ?? 0 };
    });
  }, [summary]);

  const categoryData = useMemo(
    () => (summary?.categoryBreakdown ?? []).slice(0, 10),
    [summary],
  );

  const locationData = useMemo(
    () => (summary?.locationBreakdown ?? []).slice(0, 10),
    [summary],
  );

  const locationStockData = useMemo(
    () =>
      (summary?.locationBreakdown ?? [])
        .filter((l) => l.location.toLowerCase() !== "client repair")
        .sort((a, b) => b.count - a.count),
    [summary],
  );

  const bdmStockData = useMemo(
    () =>
      (summary?.bdmBreakdown ?? [])
        .filter((b) => b.salesPerson !== "HQRJP" && b.salesPerson !== "SHREEJA")
        .sort((a, b) => b.grossWt - a.grossWt),
    [summary],
  );

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
          className="absolute inset-0 z-40 overflow-y-auto"
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
              className="h-8 text-xs border-[#D4C9A8] text-[#1A1814]/60 hover:bg-[#F5F1E8]"
            >
              <X className="w-3.5 h-3.5 mr-1.5" />
              Close Dashboard
            </Button>
          </div>

          <div className="py-5 space-y-6">
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

            {/* Ageing Distribution — pie chart */}
            <div>
              <p style={SECTION_TITLE} className="mb-3">Ageing Distribution</p>
              <div className="rounded-lg border border-[#EDE7D8] bg-white p-5 flex flex-col items-center">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={ageingData}
                      dataKey="count"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      innerRadius={0}
                      paddingAngle={2}
                      label={({ label, count }: { label: string; count: number }) => `${label} (${count})`}
                      labelLine={{ stroke: "#D4C9A8", strokeWidth: 1 }}
                      style={{ fontSize: 10, fontFamily: MONO }}
                    >
                      {ageingData.map((entry) => (
                        <Cell key={entry.label} fill={AGEING_COLORS[entry.label] || "#C9A84C"} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        fontFamily: MONO,
                        fontSize: "11px",
                        borderRadius: "8px",
                        border: "1px solid #EDE7D8",
                        backgroundColor: "#FDFBF7",
                      }}
                      formatter={(value: number, name: string) => [
                        value.toLocaleString("en-IN"),
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Legend row */}
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-1">
                  {ageingData.map((a) => (
                    <div key={a.label} className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-3 h-3 rounded-sm"
                        style={{ backgroundColor: AGEING_COLORS[a.label] || "#C9A84C" }}
                      />
                      <span className="text-[10px] text-[#6B6458]" style={{ fontFamily: MONO }}>
                        {a.label} ({a.count})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Category + Location side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Category Breakdown */}
              <div>
                <p style={SECTION_TITLE} className="mb-3">Category Breakdown (Top 10)</p>
                <div className="rounded-lg border border-[#EDE7D8] bg-white p-5">
                  {categoryData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={Math.max(220, categoryData.length * 30)}>
                      <BarChart data={categoryData} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EDE7D8" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fontFamily: MONO, fill: "#6B6458" }} />
                        <YAxis
                          type="category"
                          dataKey="category"
                          width={110}
                          tick={{ fontSize: 10, fontFamily: MONO, fill: "#1A1814" }}
                        />
                        <Tooltip
                          contentStyle={{
                            fontFamily: MONO,
                            fontSize: "11px",
                            borderRadius: "8px",
                            border: "1px solid #EDE7D8",
                            backgroundColor: "#FDFBF7",
                          }}
                          formatter={(value: number, name: string) => [
                            name === "tagValue" ? fmt(value) : value.toLocaleString("en-IN"),
                            name === "tagValue" ? "Tag Value" : "Count",
                          ]}
                        />
                        <Bar dataKey="count" fill="#C9A84C" radius={[0, 4, 4, 0]} barSize={18} />
                        <Bar dataKey="tagValue" fill="#4A7C59" radius={[0, 4, 4, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs text-[#1A1814]/30 text-center py-8" style={{ fontFamily: MONO }}>
                      No category data
                    </p>
                  )}
                </div>
              </div>

              {/* Location Breakdown */}
              <div>
                <p style={SECTION_TITLE} className="mb-3">Location Breakdown</p>
                <div className="rounded-lg border border-[#EDE7D8] bg-white p-5">
                  {locationData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={Math.max(220, locationData.length * 30)}>
                      <BarChart data={locationData} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EDE7D8" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fontFamily: MONO, fill: "#6B6458" }} />
                        <YAxis
                          type="category"
                          dataKey="location"
                          width={120}
                          tick={{ fontSize: 10, fontFamily: MONO, fill: "#1A1814" }}
                        />
                        <Tooltip
                          contentStyle={{
                            fontFamily: MONO,
                            fontSize: "11px",
                            borderRadius: "8px",
                            border: "1px solid #EDE7D8",
                            backgroundColor: "#FDFBF7",
                          }}
                          formatter={(value: number, name: string) => [
                            name === "tagValue" || name === "costValue" ? fmt(value) : value.toLocaleString("en-IN"),
                            name === "tagValue" ? "Tag Value" : name === "costValue" ? "Cost Value" : "Count",
                          ]}
                        />
                        <Bar dataKey="count" fill="#2B5EA7" radius={[0, 4, 4, 0]} barSize={18} />
                        <Bar dataKey="tagValue" fill="#C9A84C" radius={[0, 4, 4, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs text-[#1A1814]/30 text-center py-8" style={{ fontFamily: MONO }}>
                      No location data
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Location + BDM composed charts side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Location On-Hand Stock — vertical bar + cost line */}
              <div>
                <p style={SECTION_TITLE} className="mb-3">Location-wise On-Hand Stock</p>
                <div className="rounded-lg border border-[#EDE7D8] bg-white p-5">
                  {locationStockData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={340}>
                      <ComposedChart data={locationStockData} margin={{ left: 10, right: 10, top: 8, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EDE7D8" vertical={false} />
                        <XAxis
                          dataKey="location"
                          tick={{ fontSize: 9, fontFamily: MONO, fill: "#1A1814" }}
                          angle={-35}
                          textAnchor="end"
                          interval={0}
                          height={60}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 10, fontFamily: MONO, fill: "#6B6458" }}
                          label={{ value: "On Hand Count", angle: -90, position: "insideLeft", style: { fontSize: 10, fontFamily: MONO, fill: "#6B6458" }, offset: -5 }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fontSize: 10, fontFamily: MONO, fill: "#C9A84C" }}
                          tickFormatter={(v: number) => fmt(v)}
                          label={{ value: "Cost Value (\u20B9)", angle: 90, position: "insideRight", style: { fontSize: 10, fontFamily: MONO, fill: "#C9A84C" }, offset: -5 }}
                        />
                        <Tooltip
                          contentStyle={{
                            fontFamily: MONO,
                            fontSize: "11px",
                            borderRadius: "8px",
                            border: "1px solid #EDE7D8",
                            backgroundColor: "#FDFBF7",
                          }}
                          formatter={(value: number, name: string) => [
                            name === "costValue" ? fmt(value) : value.toLocaleString("en-IN"),
                            name === "costValue" ? "Cost Value" : "On Hand",
                          ]}
                        />
                        <Legend
                          wrapperStyle={{ fontFamily: MONO, fontSize: "10px" }}
                          formatter={(value: string) => (value === "count" ? "On Hand" : "Cost Value")}
                        />
                        <Bar yAxisId="left" dataKey="count" fill="#2B5EA7" radius={[4, 4, 0, 0]} barSize={24} />
                        <Line yAxisId="right" dataKey="costValue" stroke="#C9A84C" strokeWidth={2} dot={{ r: 3, fill: "#C9A84C" }} />
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
                <p style={SECTION_TITLE} className="mb-3">Sales Person Memo Holdings</p>
                <div className="rounded-lg border border-[#EDE7D8] bg-white p-5">
                  {bdmStockData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={340}>
                      <ComposedChart data={bdmStockData} margin={{ left: 10, right: 10, top: 8, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EDE7D8" vertical={false} />
                        <XAxis
                          dataKey="salesPerson"
                          tick={{ fontSize: 9, fontFamily: MONO, fill: "#1A1814" }}
                          angle={-35}
                          textAnchor="end"
                          interval={0}
                          height={60}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 10, fontFamily: MONO, fill: "#6B6458" }}
                          label={{ value: "Gross Weight (g)", angle: -90, position: "insideLeft", style: { fontSize: 10, fontFamily: MONO, fill: "#6B6458" }, offset: -5 }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fontSize: 10, fontFamily: MONO, fill: "#A63C2A" }}
                          tickFormatter={(v: number) => fmt(v)}
                          label={{ value: "Cost Value (\u20B9)", angle: 90, position: "insideRight", style: { fontSize: 10, fontFamily: MONO, fill: "#A63C2A" }, offset: -5 }}
                        />
                        <Tooltip
                          contentStyle={{
                            fontFamily: MONO,
                            fontSize: "11px",
                            borderRadius: "8px",
                            border: "1px solid #EDE7D8",
                            backgroundColor: "#FDFBF7",
                          }}
                          formatter={(value: number, name: string) => [
                            name === "costValue" ? fmt(value) : `${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}g`,
                            name === "costValue" ? "Cost Value" : "Gross Weight",
                          ]}
                        />
                        <Legend
                          wrapperStyle={{ fontFamily: MONO, fontSize: "10px" }}
                          formatter={(value: string) => (value === "grossWt" ? "Gross Weight" : "Cost Value")}
                        />
                        <Bar yAxisId="left" dataKey="grossWt" fill="#4A7C59" radius={[4, 4, 0, 0]} barSize={24} />
                        <Line yAxisId="right" dataKey="costValue" stroke="#A63C2A" strokeWidth={2} dot={{ r: 3, fill: "#A63C2A" }} />
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
        </motion.div>
      )}
    </AnimatePresence>
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
