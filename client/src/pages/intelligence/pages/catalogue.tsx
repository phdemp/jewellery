import { useState, useMemo } from "react";
import { DATA } from "../lib/intelligence-data";
import { fmt, getDriveImgUrl, generateKitId, downloadCSV } from "../lib/intelligence-utils";
import { useIntelligence } from "../intelligence-context";
import { cn } from "@/lib/utils";
import type { InventoryItem, DispatchKit, KitItem } from "../lib/intelligence-types";
import { useQuery } from "@tanstack/react-query";
import { fetchStockItems, fetchStockSummary } from "@/lib/api";
import type { LiveStockItem } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Printer } from "lucide-react";

const ITEMS_PER_PAGE = 48;

export default function VisualCatalogue() {
  const { goldPrice, setGoldPrice, addToKitQueue, logAudit, setActivePage, catalogueClient, setCatalogueClient } = useIntelligence();

  const [activeCat, setActiveCat] = useState<string>("All");
  const [localGoldPrice, setLocalGoldPrice] = useState(goldPrice || 0);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [ageingFilter, setAgeingFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");

  // Live API: fetch categories from summary
  const { data: summary } = useQuery({
    queryKey: ["stock-summary"],
    queryFn: fetchStockSummary,
  });

  const categories = useMemo(() => {
    if (summary?.categoryBreakdown?.length) {
      const cats = summary.categoryBreakdown
        .map((c) => c.category)
        .filter(Boolean)
        .sort();
      return ["All", ...cats];
    }
    const cats = new Set<string>();
    for (const item of DATA.inventory || []) {
      if (item.catSimple) cats.add(item.catSimple);
    }
    return ["All", ...Array.from(cats).sort()];
  }, [summary]);

  const locationOptions = useMemo(
    () => (summary?.locationBreakdown ?? []).map((l: { location: string }) => l.location).filter(Boolean).sort(),
    [summary],
  );

  // Live API: fetch stock items for catalogue
  const { data: stockData, isLoading } = useQuery({
    queryKey: ["stock-items-catalogue", activeCat, page, ageingFilter, locationFilter],
    queryFn: () => fetchStockItems({
      status: "On Hand",
      limit: ITEMS_PER_PAGE,
      page,
      sortBy: "tagPrice",
      sortDir: "desc",
      ...(activeCat !== "All" ? { category: activeCat } : {}),
      ...(ageingFilter !== "all" ? { ageingTag: ageingFilter } : {}),
      ...(locationFilter !== "all" ? { location: locationFilter } : {}),
    }),
  });

  const liveItems = stockData?.items ?? [];
  const totalItems = stockData?.total ?? 0;
  const totalPages = stockData?.totalPages ?? 1;

  // Map LiveStockItem to display format
  const pagedItems = useMemo(() => {
    return liveItems.map((item) => ({
      jewelCode: item.jewelCode,
      styleNo: item.styleNo ?? "",
      catSimple: item.category ?? "",
      tagPrice: item.tagPrice,
      grossWt: item.grossWt ? parseFloat(item.grossWt) : 0,
      baseMetal: item.baseMetal ?? "",
      diaWt: item.totDiaWt ? parseFloat(item.totDiaWt) : 0,
      imageUrl: item.imageUrl ?? "",
    }));
  }, [liveItems]);

  // For selected items, we need to track from the live items
  const selectedDetails = useMemo(() => {
    return liveItems.filter((i) => selectedItems.has(i.jewelCode));
  }, [liveItems, selectedItems]);

  const totalValue = useMemo(() => {
    return selectedDetails.reduce((sum, i) => sum + i.tagPrice, 0);
  }, [selectedDetails]);

  const totalPureWt = useMemo(() => {
    return selectedDetails.reduce((sum, i) => sum + (i.pureWt ? parseFloat(i.pureWt) : 0), 0);
  }, [selectedDetails]);

  const totalSellingPrice = useMemo(() => {
    if (goldPrice <= 0) return 0;
    return selectedDetails.reduce((sum, i) => {
      const pw = i.pureWt ? parseFloat(i.pureWt) : 0;
      return sum + (i.tagPrice / 2 + pw * goldPrice);
    }, 0);
  }, [selectedDetails, goldPrice]);

  function toggleItem(jc: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(jc)) next.delete(jc);
      else next.add(jc);
      return next;
    });
  }

  function handleGoldPriceChange(val: number) {
    setLocalGoldPrice(val);
    if (val > 0) setGoldPrice(val);
  }

  function handleExportCSV() {
    const headers = ["Jewel Code", "Style No", "Category", "Tag Price", "Gross Wt", "Base Metal", "Diamond Wt"];
    const rows = pagedItems.map((i) => [
      i.jewelCode, i.styleNo, i.catSimple, i.tagPrice, i.grossWt.toFixed(1), i.baseMetal, i.diaWt.toFixed(2),
    ]);
    downloadCSV("catalogue-export.csv", headers, rows);
  }

  function handlePrint() {
    window.print();
  }

  function handleSendForApproval() {
    if (selectedDetails.length === 0) return;

    const kitId = generateKitId();

    const kitItems: KitItem[] = selectedDetails.map((item) => ({
      jewelCode: item.jewelCode,
      styleNo: item.styleNo ?? "",
      category: item.category ?? "",
      catSimple: item.category ?? "",
      location: item.location ?? "",
      stockType: item.stockType ?? "",
      subCat: item.subCategory ?? "",
      makeType: item.makeType ?? "",
      baseMetal: item.baseMetal ?? "",
      costPrice: item.costPrice,
      tagPrice: item.tagPrice,
      gp: item.tagPrice > 0 ? ((item.tagPrice - item.costPrice) / item.tagPrice) * 100 : 0,
      ageingDays: item.ageingDays,
      ageingTag: (item.ageingDays <= 30 ? "Fresh" : item.ageingDays <= 60 ? "Active" : item.ageingDays <= 90 ? "Moderate" : item.ageingDays <= 180 ? "Slow Moving" : item.ageingDays <= 270 ? "Ageing" : "Non-Moving") as "Fresh" | "Active" | "Moderate" | "Slow Moving" | "Ageing" | "Non-Moving",
      perfTag: "Average" as const,
      grossWt: item.grossWt ? parseFloat(item.grossWt) : 0,
      pureWt: item.pureWt ? parseFloat(item.pureWt) : 0,
      diaWt: item.totDiaWt ? parseFloat(item.totDiaWt) : 0,
      imageUrl: item.imageUrl ?? "",
      status: (item.currentStatus === "Memo" ? "Memo" : "On Hand") as "On Hand" | "Memo",
      clientName: item.memoClientName ?? "",
      salesPerson: item.memoSalesPersonName ?? "",
      _source: "catalogue",
    }));

    const avgGP = kitItems.length > 0
      ? kitItems.reduce((sum, i) => sum + i.gp, 0) / kitItems.length
      : 0;

    const deadStockCleared = kitItems.filter((i) => i.ageingTag === "Slow Moving" || i.ageingTag === "Ageing" || i.ageingTag === "Non-Moving").length;

    const kit: DispatchKit = {
      id: kitId,
      kind: "exhibition",
      bdm: "Unassigned",
      state: null,
      targetClient: null,
      items: kitItems,
      aiRecommended: 0,
      manuallyAdded: kitItems.length,
      totalValue,
      avgGP,
      deadStockCleared,
      status: "pending_approval",
      createdAt: new Date().toISOString(),
      createdBy: "Merchandiser",
      approvedBy: null,
      approvedAt: null,
      notes: `Catalogue selection: ${kitItems.length} items from ${activeCat === "All" ? "all categories" : activeCat}`,
      timeline: [{
        ts: new Date().toISOString(),
        event: "kit_created",
        actor: "Merchandiser",
        detail: `Created catalogue kit with ${kitItems.length} items, total value ${fmt(totalValue)}`,
      }],
    };

    addToKitQueue(kit);
    logAudit("catalogue_kit_sent", kitId, `${kitItems.length} items, ${fmt(totalValue)} sent for approval`);

    // Clear selection after sending
    setSelectedItems(new Set());

    // Navigate to dispatch approval
    setActivePage("dispatch");
  }

  return (
    <div className="space-y-4">
      <div style={{ height: 2, background: "linear-gradient(90deg, #C9A84C, transparent)", marginBottom: 20, borderRadius: 1 }} />
      {catalogueClient && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-[#C9A84C]/30 bg-[rgba(201,168,76,0.06)]">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-[#8B6914] uppercase tracking-wider" style={{ fontFamily: "'DM Mono', monospace" }}>
              Client Selection
            </span>
            <span className="text-[13px] font-semibold text-[#2C2520]">{catalogueClient}</span>
          </div>
          <button
            onClick={() => setCatalogueClient(null)}
            className="text-[11px] text-[#6B6458] hover:text-[#A63C2A] transition-colors"
          >
            Clear
          </button>
        </div>
      )}
      {/* Top Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Category Filter Pills */}
        <div className="flex-1 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setActiveCat(cat);
                setPage(1);
              }}
              className={cn(
                "px-4 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap border transition-colors",
                activeCat === cat
                  ? "bg-[#C9A84C] text-[#1A1814] border-[#C9A84C]"
                  : "bg-white text-[#6B6458] border-[#D4C9A8] hover:border-[#C9A84C] hover:bg-[#F5F1E8]",
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Gold Price Input */}
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
            Gold/g
          </label>
          <input
            type="number"
            placeholder="7500"
            value={localGoldPrice || ""}
            onChange={(e) => handleGoldPriceChange(Number(e.target.value))}
            className="w-[90px] text-[13px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
          />
        </div>

        {/* Ageing Filter */}
        <Select value={ageingFilter} onValueChange={(v) => { setAgeingFilter(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-[130px] text-xs border-[#D4C9A8] bg-white shrink-0" style={{ fontFamily: "'DM Mono', monospace", fontSize: "11px" }}>
            <SelectValue placeholder="Ageing" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Ageing</SelectItem>
            <SelectItem value="Fresh">Fresh</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="Moderate">Moderate</SelectItem>
            <SelectItem value="Slow Moving">Slow Moving</SelectItem>
            <SelectItem value="Ageing">Ageing</SelectItem>
            <SelectItem value="Non-Moving">Non-Moving</SelectItem>
          </SelectContent>
        </Select>

        {/* Location Filter */}
        <Select value={locationFilter} onValueChange={(v) => { setLocationFilter(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-[150px] text-xs border-[#D4C9A8] bg-white shrink-0" style={{ fontFamily: "'DM Mono', monospace", fontSize: "11px" }}>
            <SelectValue placeholder="Location" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {locationOptions.map((l: string) => (
              <SelectItem key={l} value={l}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Export & Print */}
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] border border-[#D4C9A8] rounded bg-white text-[#3D3830] hover:bg-[#F5F1E8] transition-colors shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          CSV
        </button>
        <button
          onClick={handlePrint}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] border border-[#D4C9A8] rounded bg-white text-[#3D3830] hover:bg-[#F5F1E8] transition-colors shrink-0"
        >
          <Printer className="w-3.5 h-3.5" />
          Print
        </button>
      </div>

      {/* Items count */}
      <div className="text-[12px] text-[#6B6458]">
        Showing {pagedItems.length} of {totalItems} items
        {activeCat !== "All" && ` in ${activeCat}`}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-[#6B6458] text-sm" style={{ fontFamily: "'DM Mono', monospace" }}>Loading catalogue...</div>
        </div>
      ) : (
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
      >
        {pagedItems.map((item) => {
          const isSelected = selectedItems.has(item.jewelCode);

          return (
            <div
              key={item.jewelCode}
              onClick={() => toggleItem(item.jewelCode)}
              className={cn(
                "relative border rounded-[10px] overflow-hidden cursor-pointer transition-all",
                "hover:shadow-lg hover:-translate-y-0.5",
                isSelected
                  ? "border-2 border-[#C9A84C] ring-[3px] ring-[rgba(201,168,76,0.2)]"
                  : "border border-[#D4C9A8]",
              )}
            >
              {/* Selection checkmark */}
              {isSelected && (
                <div className="absolute top-2 right-2 w-[22px] h-[22px] rounded-full bg-[#C9A84C] text-white flex items-center justify-center z-10 text-[12px] font-bold">
                  &#10003;
                </div>
              )}

              {/* Image */}
              <div className="h-[180px] bg-[#F5F1E8] overflow-hidden">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.styleNo}
                    className="w-full h-full object-contain"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#B8A97E] text-[13px]">
                    No Image
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="p-3">
                <div
                  className="text-[10px] font-mono text-[#6B6458] truncate mb-0.5"
                  style={{ fontFamily: "'DM Mono', monospace" }}
                >
                  {item.styleNo}
                </div>

                <div className="text-[11px] text-[#6B6458] mb-1">{item.catSimple}</div>

                <div className="text-[18px] font-semibold text-[#8B6914] mb-1.5">
                  {fmt(item.tagPrice)}
                </div>

                {/* Meta tags */}
                <div className="flex flex-wrap gap-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F5F1E8] text-[#6B6458]">
                    {item.grossWt.toFixed(1)}g
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F5F1E8] text-[#6B6458]">
                    {item.baseMetal}
                  </span>
                  {item.diaWt > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E8F0FE] text-[#1A56CC]">
                      Dia {item.diaWt.toFixed(1)}ct
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-[12px] border border-[#D4C9A8] rounded hover:bg-[#F5F1E8] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <span className="text-[12px] text-[#6B6458]">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-[12px] border border-[#D4C9A8] rounded hover:bg-[#F5F1E8] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && totalItems === 0 && (
        <div className="text-center py-16 text-[#6B6458]">
          <div className="text-[16px] font-medium mb-1">No items found</div>
          <div className="text-[13px]">Try selecting a different category.</div>
        </div>
      )}

      {/* Kit Panel (sticky bottom) */}
      {selectedItems.size > 0 && (
        <div className="sticky bottom-0 z-20 bg-white border-t border-[#D4C9A8] shadow-[0_-2px_8px_rgba(0,0,0,0.06)] px-5 py-3 -mx-5">
          <div className="flex items-center gap-4">
            {/* Thumbnails */}
            <div className="flex items-center gap-1 overflow-x-auto flex-1 pb-1">
              {selectedDetails.slice(0, 12).map((item) => (
                  <div
                    key={item.jewelCode}
                    className="w-10 h-10 rounded border border-[#D4C9A8] bg-[#F5F1E8] flex-shrink-0 overflow-hidden"
                  >
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full bg-[#EDEDED]" />
                    )}
                  </div>
                ))}
              {selectedItems.size > 12 && (
                <span className="text-[11px] text-[#6B6458] ml-1 whitespace-nowrap">
                  +{selectedItems.size - 12} more
                </span>
              )}
            </div>

            {/* Summary */}
            <div className="flex items-center gap-4 shrink-0">
              <div className="text-right">
                <div className="text-[13px] font-semibold text-[#2C2520]">
                  {selectedItems.size} items
                </div>
                <div className="text-[14px] font-semibold text-[#C9A84C]">
                  {fmt(totalValue)}
                </div>
                <div className="text-[11px] text-[#6B6458]">
                  Pure Wt: {totalPureWt.toFixed(2)}g
                  {goldPrice > 0 && ` · Selling: ${fmt(Math.round(totalSellingPrice))}`}
                </div>
              </div>
              <button
                onClick={handleSendForApproval}
                className="px-5 py-2.5 bg-[#C9A84C] text-white text-[13px] font-semibold rounded-lg hover:bg-[#8B6914] transition-colors"
              >
                Send for Approval
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
