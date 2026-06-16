import { useState, useMemo } from "react";
import { DATA } from "../lib/intelligence-data";
import { fmt, getDriveImgUrl } from "../lib/intelligence-utils";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Trophy,
  AlertCircle,
  PieChart,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchStockItems, fetchStockSummary, fetchSkuPerformance } from "@/lib/api";
import type { LiveStockItem } from "@/lib/api";

const MONO = "'DM Mono', monospace";
const SERIF = "'Cormorant Garamond', serif";

const DEAD_PER_PAGE = 30;
const TOP_PER_PAGE = 30;

type TabId = "top-sellers" | "dead-stock" | "assortment-mix";

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "top-sellers", label: "Top Sellers", icon: <Trophy className="w-3.5 h-3.5" /> },
  { id: "dead-stock", label: "Non-Moving", icon: <AlertCircle className="w-3.5 h-3.5" /> },
  { id: "assortment-mix", label: "Assortment Mix", icon: <PieChart className="w-3.5 h-3.5" /> },
];

type SortKey = "composite" | "units" | "revenue" | "clients";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "composite", label: "Units + Revenue" },
  { value: "units", label: "Units Sold" },
  { value: "revenue", label: "Total Revenue" },
  { value: "clients", label: "Distinct Clients" },
];

export default function SkuIntelPage() {
  const [activeTab, setActiveTab] = useState<TabId>("top-sellers");

  const { data: liveSummary } = useQuery({
    queryKey: ["stock-summary"],
    queryFn: () => fetchStockSummary(),
  });
  const deadStockBadgeCount = liveSummary?.deadStockCount ?? 427;

  return (
    <div className="space-y-5">
      <div style={{ height: 2, background: "linear-gradient(90deg, #C9A84C, transparent)", marginBottom: 20, borderRadius: 1 }} />
      {/* Page header */}
      <div>
        <h2
          className="text-2xl text-[#1A1814]"
          style={{ fontFamily: SERIF, fontWeight: 600 }}
        >
          SKU Intelligence
        </h2>
        <p
          className="text-xs text-[#1A1814]/50 mt-0.5"
          style={{ fontFamily: MONO }}
        >
          Performance analytics, dead stock identification, and assortment mix
        </p>
      </div>

      {/* Tab bar */}
      <div
        className="flex border-b"
        style={{ borderColor: "#D4C9A8" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-[13px] transition-colors border-b-2 -mb-px",
              activeTab === tab.id
                ? "border-[#C9A84C] text-[#8B6914] font-medium"
                : "border-transparent text-[#1A1814]/40 hover:text-[#1A1814]/60"
            )}
            style={{ fontFamily: "'Jost', sans-serif" }}
          >
            <span className={cn(activeTab === tab.id ? "text-[#C9A84C]" : "text-[#1A1814]/30")}>
              {tab.icon}
            </span>
            {tab.label}
            {tab.id === "dead-stock" && (
              <Badge
                variant="secondary"
                className="text-[9px] px-1.5 py-0 h-4 border-0 bg-[#FDEAEA] text-[#8B1A1A] ml-1"
              >
                {deadStockBadgeCount}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "top-sellers" && <TopSellersTab />}
      {activeTab === "dead-stock" && <DeadStockTab />}
      {activeTab === "assortment-mix" && <AssortmentMixTab />}
    </div>
  );
}

// ============================================================
// Tab 1: Top Sellers
// ============================================================

function TopSellersTab() {
  const [sortBy, setSortBy] = useState<SortKey>("composite");
  const [page, setPage] = useState(1);

  // Reset to first page whenever the sort changes
  const onSortChange = (v: SortKey) => {
    setSortBy(v);
    setPage(1);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["sku-performance", sortBy, page],
    queryFn: () => fetchSkuPerformance({
      sortBy,
      page,
      limit: TOP_PER_PAGE,
    }),
  });

  const items = data?.items ?? [];
  const totalItems = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const THStyle: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: "9.5px",
    letterSpacing: "1.5px",
    color: "#6B6458",
    textTransform: "uppercase",
  };

  return (
    <div className="space-y-4">
      {/* Sort control */}
      <div className="flex items-center justify-between">
        <p
          className="text-xs text-[#1A1814]/50"
          style={{ fontFamily: MONO }}
        >
          {totalItems.toLocaleString("en-IN")} style codes ranked
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#1A1814]/40" style={{ fontFamily: MONO }}>
            Sort by:
          </span>
          <Select value={sortBy} onValueChange={(v) => onSortChange(v as SortKey)}>
            <SelectTrigger
              className="h-8 w-[180px] text-xs border-[#D4C9A8] bg-white"
              style={{ fontFamily: MONO, fontSize: "11px" }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-[#6B6458] text-sm" style={{ fontFamily: MONO }}>Loading top sellers...</div>
        </div>
      ) : (
      <>
      {/* Table */}
      <div
        className="rounded-lg border overflow-hidden"
        style={{ borderColor: "#D4C9A8" }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ fontFamily: "'Jost', sans-serif" }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F1E8" }}>
                <th className="px-3 py-2.5 text-left" style={THStyle}>Image</th>
                <th className="px-3 py-2.5 text-center" style={THStyle}>Rank</th>
                <th className="px-3 py-2.5 text-left" style={THStyle}>Style Code</th>
                <th className="px-3 py-2.5 text-left" style={THStyle}>Category</th>
                <th className="px-3 py-2.5 text-right" style={THStyle}>Units Sold</th>
                <th className="px-3 py-2.5 text-right" style={THStyle}>Revenue</th>
                <th className="px-3 py-2.5 text-right" style={THStyle}>Avg Sale Price</th>
                <th className="px-3 py-2.5 text-right" style={THStyle}>Distinct Clients</th>
                <th className="px-3 py-2.5 text-center" style={THStyle}>Tag</th>
              </tr>
            </thead>
            <tbody>
              {items.map((sku, idx) => {
                const imgSrc = getDriveImgUrl(sku.imageUrl ?? "");
                const rank = (page - 1) * TOP_PER_PAGE + idx + 1;
                const rankColor =
                  rank === 1 ? "text-[#C9A84C]" :
                  rank === 2 ? "text-[#6B6458]" :
                  rank === 3 ? "text-[#B87333]" :
                  "text-[#1A1814]/40";

                return (
                  <tr
                    key={sku.styleCode}
                    className="border-t border-[#EDE7D8] transition-colors hover:bg-[#F5F1E8]"
                    style={{ backgroundColor: "#FFFFFF" }}
                  >
                    <td className="px-3 py-2">
                      {imgSrc ? (
                        <img
                          src={imgSrc}
                          alt={sku.styleCode}
                          className="w-10 h-10 rounded object-cover border border-[#D4C9A8]"
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded bg-[#F5F1E8] flex items-center justify-center">
                          <span className="text-[9px] text-[#1A1814]/20" style={{ fontFamily: MONO }}>N/A</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={cn("text-sm font-semibold", rankColor)}
                        style={{ fontFamily: MONO }}
                      >
                        #{rank}
                      </span>
                    </td>
                    <td
                      className="px-3 py-2 font-medium text-[#1A1814]"
                      style={{ fontFamily: MONO, fontSize: "11px" }}
                    >
                      {sku.styleCode}
                    </td>
                    <td className="px-3 py-2 text-[#1A1814]/70">{sku.category ?? "--"}</td>
                    <td
                      className="px-3 py-2 text-right text-[#1A1814]"
                      style={{ fontFamily: MONO, fontSize: "11px" }}
                    >
                      {sku.soldCount}
                    </td>
                    <td
                      className="px-3 py-2 text-right text-[#1A1814]"
                      style={{ fontFamily: MONO, fontSize: "11px" }}
                    >
                      {fmt(sku.totalRevenue)}
                    </td>
                    <td
                      className="px-3 py-2 text-right text-[#1A1814]/60"
                      style={{ fontFamily: MONO, fontSize: "11px" }}
                    >
                      {fmt(sku.avgSalePrice)}
                    </td>
                    <td
                      className="px-3 py-2 text-right text-[#1A1814]/70"
                      style={{ fontFamily: MONO, fontSize: "11px" }}
                    >
                      {sku.distinctClients}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {rank <= 5 ? (
                        <span className="text-[9px] px-2 py-0.5 rounded-full font-medium bg-[#E8F0FE] text-[#1A56CC]">
                          Top Seller
                        </span>
                      ) : rank <= 15 ? (
                        <span className="text-[9px] px-2 py-0.5 rounded-full font-medium bg-[#EAF4E8] text-[#276520]">
                          Fast Moving
                        </span>
                      ) : (
                        <span className="text-[9px] px-2 py-0.5 rounded-full font-medium bg-[#F5F5F5] text-[#555]">
                          Average
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p
            className="text-[11px] text-[#1A1814]/40"
            style={{ fontFamily: MONO }}
          >
            Page {page} of {totalPages} &middot; {totalItems.toLocaleString("en-IN")} style codes
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
    </div>
  );
}

// ============================================================
// Tab 2: Dead Stock
// ============================================================

function DeadStockTab() {
  const [page, setPage] = useState(1);

  const { data: stockData, isLoading } = useQuery({
    queryKey: ["stock-items-dead", page],
    queryFn: () => fetchStockItems({
      status: "On Hand",
      ageingTag: "Non-Moving",
      page,
      limit: DEAD_PER_PAGE,
      sortBy: "ageingDays",
      sortDir: "desc",
    }),
  });

  const items = stockData?.items ?? [];
  const totalItems = stockData?.total ?? 0;
  const totalPages = stockData?.totalPages ?? 1;

  const totalValue = useMemo(() => {
    return items.reduce((sum, i) => sum + i.tagPrice, 0);
  }, [items]);

  const THStyle: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: "9.5px",
    letterSpacing: "1.5px",
    color: "#6B6458",
    textTransform: "uppercase",
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#6B6458] text-sm" style={{ fontFamily: MONO }}>Loading dead stock...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header badge */}
      <div className="flex items-center gap-3">
        <Badge
          variant="secondary"
          className="text-xs px-3 py-1 h-auto border-0 bg-[#FDEAEA] text-[#8B1A1A]"
          style={{ fontFamily: MONO }}
        >
          {totalItems} items &middot; {fmt(totalValue)}
        </Badge>
        <p className="text-[11px] text-[#1A1814]/40" style={{ fontFamily: MONO }}>
          Items aged 365+ days requiring clearance action
        </p>
      </div>

      {/* Table */}
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
                <th className="px-3 py-2.5 text-right" style={THStyle}>Ageing Days</th>
                <th className="px-3 py-2.5 text-right" style={THStyle}>Tag Price</th>
                <th className="px-3 py-2.5 text-right" style={THStyle}>Pure Wt</th>
                <th className="px-3 py-2.5 text-center" style={THStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: LiveStockItem) => (
                  <tr
                    key={item.id}
                    className="border-t border-[#EDE7D8] transition-colors hover:bg-[#F5F1E8]"
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
                          <span className="text-[9px] text-[#1A1814]/20" style={{ fontFamily: MONO }}>N/A</span>
                        </div>
                      )}
                    </td>
                    <td
                      className="px-3 py-2 font-medium text-[#1A1814]"
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
                    <td
                      className="px-3 py-2 text-right"
                      style={{ fontFamily: MONO, fontSize: "11px" }}
                    >
                      <span className="text-[#8B1A1A] font-medium">
                        {item.ageingDays}
                      </span>
                    </td>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-[#A63C2A] hover:text-[#8B1A1A] hover:bg-[#FDEAEA]/40"
                      >
                        Clearance
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p
            className="text-[11px] text-[#1A1814]/40"
            style={{ fontFamily: MONO }}
          >
            Page {page} of {totalPages} &middot; {totalItems} items
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
    </div>
  );
}

// ============================================================
// Tab 3: Assortment Mix
// ============================================================

function AssortmentMixTab() {
  const { data: liveSummary, isLoading } = useQuery({
    queryKey: ["stock-summary"],
    queryFn: () => fetchStockSummary(),
  });

  // Fallback to static data if live is not available
  const priceBands = DATA.priceBand;
  const stockTypes = DATA.stockType;

  // Use live location/category breakdowns if available
  const locationItems = useMemo(() => {
    if (liveSummary?.locationBreakdown?.length) {
      return liveSummary.locationBreakdown
        .filter((l) => l.location)
        .sort((a, b) => b.count - a.count)
        .map((l) => ({ label: l.location, count: l.count, value: l.tagValue }));
    }
    return DATA.locationStock.map((ls) => ({
      label: ls["Location Name"],
      count: ls.count,
      value: ls.tag_val,
    }));
  }, [liveSummary]);

  const categoryItems = useMemo(() => {
    if (liveSummary?.categoryBreakdown?.length) {
      return liveSummary.categoryBreakdown
        .filter((c) => c.category)
        .sort((a, b) => b.count - a.count)
        .map((c) => ({ label: c.category, count: c.count, value: c.tagValue }));
    }
    return [];
  }, [liveSummary]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#6B6458] text-sm" style={{ fontFamily: MONO }}>Loading assortment data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Category Distribution (live) */}
      {categoryItems.length > 0 && (
        <BarSection
          title="Category Distribution"
          items={categoryItems}
        />
      )}

      {/* Price Band Distribution (static -- not in stock API) */}
      <BarSection
        title="Price Band Distribution"
        items={priceBands.map((pb) => ({
          label: pb.price_band,
          count: pb.count,
          value: pb.cost,
        }))}
      />

      {/* Stock Type Distribution (static) */}
      <BarSection
        title="Stock Type Distribution"
        items={stockTypes.map((st) => ({
          label: st["Stock Type"],
          count: st.count,
          value: st.cost,
        }))}
      />

      {/* Location-wise Stock (live) */}
      <BarSection
        title="Location-wise Stock"
        items={locationItems}
      />
    </div>
  );
}

// ---- Bar Section Component ----

interface BarItem {
  label: string;
  count: number;
  value: number;
}

interface BarSectionProps {
  title: string;
  items: BarItem[];
}

function BarSection({ title, items }: BarSectionProps) {
  const maxCount = Math.max(...items.map((i) => i.count), 1);

  return (
    <div
      className="rounded-lg border p-4"
      style={{ backgroundColor: "#FFFFFF", borderColor: "#D4C9A8" }}
    >
      <h3
        className="text-base text-[#1A1814] mb-4"
        style={{ fontFamily: SERIF, fontWeight: 600 }}
      >
        {title}
      </h3>

      <div className="space-y-3">
        {items.map((item) => {
          const pct = (item.count / maxCount) * 100;
          return (
            <div key={item.label} className="flex items-center gap-3">
              {/* Label */}
              <div
                className="w-[180px] shrink-0 text-[11px] text-[#1A1814]/70 truncate text-right"
                style={{ fontFamily: MONO }}
                title={item.label}
              >
                {item.label}
              </div>

              {/* Bar */}
              <div className="flex-1 h-[7px] bg-[#EDE7D8] rounded-[4px] overflow-hidden relative">
                <div
                  className="h-full rounded-[4px] transition-all duration-500"
                  style={{
                    width: `${Math.max(pct, 2)}%`,
                    background: "linear-gradient(90deg, #C9A84C, #E0C882)",
                  }}
                />
                {/* Count inside bar */}
                <span
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-medium"
                  style={{
                    fontFamily: MONO,
                    color: pct > 15 ? "#5E4100" : "#6B6458",
                  }}
                >
                  {item.count.toLocaleString("en-IN")}
                </span>
              </div>

              {/* Value */}
              <div
                className="w-[80px] shrink-0 text-right text-[11px] text-[#1A1814]/50"
                style={{ fontFamily: MONO }}
              >
                {fmt(item.value)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Pagination helper (shared pattern) ----

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
