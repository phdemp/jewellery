import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStockItems, fetchStockSummary } from "@/lib/api";
import type { LiveStockItem } from "@/lib/api";
import { fmt, ageTagClass, downloadCSV } from "../lib/intelligence-utils";
import { INV_PER_PAGE } from "../lib/intelligence-constants";
import { cn } from "@/lib/utils";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
} from "lucide-react";

// ---- Ageing tag computation from ageingDays ----

const AGEING_OPTIONS = ["Fresh", "Watch", "Slow", "Dead Stock"] as const;
const STATUS_OPTIONS = ["On Hand", "Memo"] as const;

function getAgeingTag(days: number): string {
  if (days <= 90) return "Fresh";
  if (days <= 180) return "Watch";
  if (days <= 365) return "Slow";
  return "Dead Stock";
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
    <div className="space-y-5">
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
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCSV}
          className="h-8 text-xs border-[#E8E0D0] text-[#1A1814]/60 hover:bg-[#FAF7F0]"
        >
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {/* Filter bar */}
      <div
        className="rounded-lg border p-3 flex flex-wrap items-center gap-2.5"
        style={{ backgroundColor: "#FFFFFF", borderColor: "#E8E0D0" }}
      >
        {/* Search */}
        <div className="relative w-52">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#1A1814]/30" />
          <Input
            value={search}
            onChange={(e) => handleFilterChange(setSearch)(e.target.value)}
            placeholder="Search jewel code, style..."
            className="h-8 pl-8 text-xs border-[#E8E0D0] bg-[#FAF7F0] placeholder:text-[#1A1814]/30"
            style={{ fontFamily: MONO, fontSize: "11px" }}
          />
        </div>

        {/* Ageing */}
        <Select value={ageingFilter} onValueChange={handleFilterChange(setAgeingFilter)}>
          <SelectTrigger
            className="h-8 w-[130px] text-xs border-[#E8E0D0] bg-[#FAF7F0]"
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
            className="h-8 w-[150px] text-xs border-[#E8E0D0] bg-[#FAF7F0]"
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
            className="h-8 w-[160px] text-xs border-[#E8E0D0] bg-[#FAF7F0]"
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
            className="h-8 w-[140px] text-xs border-[#E8E0D0] bg-[#FAF7F0]"
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
            className="h-8 w-[110px] text-xs border-[#E8E0D0] bg-[#FAF7F0]"
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
        <div className="flex items-center border rounded-md border-[#E8E0D0] overflow-hidden">
          <button
            onClick={() => setViewMode("table")}
            className={cn(
              "p-1.5 transition-colors",
              viewMode === "table"
                ? "bg-[#C9A84C]/15 text-[#8B6914]"
                : "bg-white text-[#1A1814]/30 hover:bg-[#FAF7F0]"
            )}
          >
            <LayoutList className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={cn(
              "p-1.5 transition-colors",
              viewMode === "grid"
                ? "bg-[#C9A84C]/15 text-[#8B6914]"
                : "bg-white text-[#1A1814]/30 hover:bg-[#FAF7F0]"
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
                  className="h-7 w-7 p-0 border-[#E8E0D0]"
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
                        "h-7 min-w-7 px-2 text-xs border-[#E8E0D0]",
                        pn === page
                          ? "bg-[#C9A84C] text-white hover:bg-[#B8964E] border-[#C9A84C]"
                          : "hover:bg-[#FAF7F0]"
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
                  className="h-7 w-7 p-0 border-[#E8E0D0]"
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
    color: "#8B8178",
    textTransform: "uppercase",
  };

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "#E8E0D0" }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]" style={{ fontFamily: "'Inter', sans-serif" }}>
          <thead>
            <tr style={{ backgroundColor: "#F5F0E8" }}>
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
                  className="border-t border-[#E8E0D0]/60 cursor-pointer transition-colors hover:bg-[#FAF7F0]"
                  style={{ backgroundColor: "#FFFFFF" }}
                >
                  <td className="px-3 py-2">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.jewelCode}
                        className="w-10 h-10 rounded object-cover border border-[#E8E0D0]"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-[#F5F0E8] flex items-center justify-center">
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
            className="rounded-lg border border-[#E8E0D0] bg-white cursor-pointer transition-all hover:shadow-md hover:border-[#C9A84C]/40 overflow-hidden group"
          >
            {/* Image */}
            <div className="aspect-square bg-[#F5F0E8] overflow-hidden relative">
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
      <DialogContent className="max-w-xl bg-white border-[#E8E0D0]">
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
                className="w-36 h-36 rounded-lg object-cover border border-[#E8E0D0]"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="w-36 h-36 rounded-lg bg-[#F5F0E8] flex items-center justify-center">
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
                  className="text-[9px] uppercase tracking-[1px] text-[#8B8178] mb-0.5"
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
