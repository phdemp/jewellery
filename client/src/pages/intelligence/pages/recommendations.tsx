import { useState, useMemo } from "react";
import { DATA } from "../lib/intelligence-data";
import { fmt, fmtN, ageTagClass, perfTagClass, recTagClass, getDriveImgUrl, generateKitId } from "../lib/intelligence-utils";
import { useIntelligence } from "../intelligence-context";
import { cn } from "@/lib/utils";
import { Plus, Check } from "lucide-react";
import type { InventoryItem, DispatchKit, KitItem } from "../lib/intelligence-types";
import { useQuery } from "@tanstack/react-query";
import { fetchStockItems } from "@/lib/api";
import type { LiveStockItem } from "@/lib/api";

/* ---------- types ---------- */

interface Recommendation {
  rank: number;
  jewelCode: string;
  styleNo: string;
  category: string;
  location: string;
  ageingDays: number;
  ageingTag: string;
  perfTag: string;
  tagPrice: number;
  costPrice: number;
  gp: number;
  tags: string[];
  imageUrl: string;
}

/* ---------- tag derivation ---------- */

function deriveRecommendationTags(item: InventoryItem): string[] {
  const tags: string[] = [];

  /* clearance: non-moving, ageing, or slow moving */
  if (item.ageingTag === "Non-Moving" || item.ageingTag === "Ageing" || item.ageingTag === "Slow Moving" || item.ageingDays > 270) {
    tags.push("Clearance");
  }

  /* top seller */
  if (item.perfTag === "Top Seller") {
    tags.push("Top Seller");
  }

  /* slow mover */
  if (item.perfTag === "Slow" && item.ageingTag !== "Non-Moving") {
    tags.push("Slow Mover");
  }

  /* slow moving */
  if (item.ageingTag === "Slow Moving") {
    tags.push("Slow Moving");
  }

  /* high margin: GP >= 45% */
  if (item.gp >= 45) {
    tags.push("High Margin");
  }

  /* demand gap: fresh stock with low performance */
  if (item.ageingTag === "Fresh" && item.perfTag === "Average") {
    tags.push("Demand Gap");
  }

  /* repeat buyer: has a real client name attached */
  if (
    item.clientName &&
    item.clientName !== "nan" &&
    item.clientName.trim() !== ""
  ) {
    tags.push("Repeat Buyer");
  }

  return tags;
}

/* ---------- build recommendations ---------- */

function buildRecommendations(inventory: InventoryItem[]): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const item of inventory) {
    const tags = deriveRecommendationTags(item);
    if (tags.length === 0) continue;

    recs.push({
      rank: 0,
      jewelCode: item.jewelCode,
      styleNo: item.styleNo,
      category: item.category,
      location: item.location,
      ageingDays: item.ageingDays,
      ageingTag: item.ageingTag,
      perfTag: item.perfTag,
      tagPrice: item.tagPrice,
      costPrice: item.costPrice,
      gp: item.gp,
      tags,
      imageUrl: item.imageUrl,
    });
  }

  /* sort by: number of tags desc, then ageing desc, then GP desc */
  recs.sort((a, b) => {
    if (b.tags.length !== a.tags.length) return b.tags.length - a.tags.length;
    if (b.ageingDays !== a.ageingDays) return b.ageingDays - a.ageingDays;
    return b.gp - a.gp;
  });

  /* assign ranks */
  recs.forEach((r, i) => {
    r.rank = i + 1;
  });

  return recs;
}

/* ---------- filter types ---------- */

type FilterType =
  | "All"
  | "Clearance"
  | "Top Seller"
  | "Slow Mover"
  | "Demand Gap"
  | "Repeat Buyer"
  | "Slow Moving"
  | "High Margin";

type SortType = "Ageing" | "GP%" | "Value";

const FILTER_OPTIONS: FilterType[] = [
  "All",
  "Clearance",
  "Top Seller",
  "Slow Mover",
  "Demand Gap",
  "Repeat Buyer",
];

const SORT_OPTIONS: SortType[] = ["Ageing", "GP%", "Value"];

const MAX_DISPLAY = 40;

/* ---------- recommendation card ---------- */

function RecCard({ rec, isInKit, onAddToKit }: { rec: Recommendation; isInKit: boolean; onAddToKit: (rec: Recommendation) => void }) {
  const thumbUrl = getDriveImgUrl(rec.imageUrl);

  return (
    <div className="flex gap-3 border border-[#D4C9A8] rounded-lg p-4 bg-white hover:shadow transition">
      {/* rank */}
      <div
        className="text-[22px] text-[#C9A84C] w-7 text-center flex-shrink-0 pt-0.5"
        style={{ fontFamily: "'Jost', sans-serif", fontWeight: 400 }}
      >
        {rec.rank}
      </div>

      {/* thumbnail (if available) */}
      {thumbUrl && (
        <div className="w-14 h-14 rounded border border-[#D4C9A8] overflow-hidden flex-shrink-0 bg-white">
          <img
            src={thumbUrl}
            alt={rec.styleNo}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      {/* content */}
      <div className="flex-1 min-w-0">
        {/* style code */}
        <p
          className="text-[11.5px] font-medium text-[#3D3830] mb-0.5"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          {rec.styleNo}
        </p>

        {/* description line */}
        <p className="text-[12.5px] text-[#3D3830] mb-2 truncate">
          {titleCase(rec.category)} &middot;{" "}
          {shortenLocation(rec.location)} &middot; {rec.ageingDays}d aged
        </p>

        {/* recommendation tags */}
        <div className="flex gap-1 flex-wrap mb-2">
          {rec.tags.map((tag) => (
            <span
              key={tag}
              className={cn(
                "text-[10.5px] px-2 py-[2px] rounded-[20px] font-medium",
                recTagClass(tag)
              )}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* meta row */}
        <div className="flex items-center gap-3">
          <span
            className="text-[11px] text-[#6B6458]"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            Tag: {fmt(rec.tagPrice)}
          </span>
          <span
            className="text-[11px] text-[#6B6458]"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            Cost: {fmt(rec.costPrice)}
          </span>
          <span
            className={cn(
              "text-[11px]",
              rec.gp >= 45 ? "text-[#276520]" : "text-[#6B6458]"
            )}
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            GP: {rec.gp.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* kit button */}
      <div className="flex-shrink-0 flex items-start">
        <button
          onClick={() => onAddToKit(rec)}
          className={cn(
            "h-7 px-2.5 rounded text-[11px] border transition-colors",
            "flex items-center gap-1",
            isInKit
              ? "border-[#4A7C59] bg-[#E8F5EC] text-[#2D6B42]"
              : "border-[#D4C9A8] text-[#8B6914] hover:bg-[#F5F1E8]"
          )}
          title={isInKit ? "Added to kit" : "Add to dispatch kit"}
        >
          {isInKit ? (
            <>
              <Check className="w-3 h-3" />
              Added
            </>
          ) : (
            <>
              <Plus className="w-3 h-3" />
              Kit
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function shortenLocation(loc: string): string {
  if (loc.length <= 20) return loc;
  return loc.replace("RANIWALA JEWELLERS PVT LTD", "HQ").replace("STORE", "").trim();
}

/* ---------- LiveStockItem to InventoryItem ---------- */

function liveToInventoryItem(item: LiveStockItem): InventoryItem {
  const ageingDays = item.ageingDays;
  const ageingTag: InventoryItem["ageingTag"] =
    ageingDays <= 30 ? "Fresh" : ageingDays <= 60 ? "Active" : ageingDays <= 90 ? "Moderate" : ageingDays <= 180 ? "Slow Moving" : ageingDays <= 270 ? "Ageing" : "Non-Moving";
  return {
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
    ageingDays,
    ageingTag,
    perfTag: "Average",
    grossWt: item.grossWt ? parseFloat(item.grossWt) : 0,
    pureWt: item.pureWt ? parseFloat(item.pureWt) : 0,
    diaWt: item.totDiaWt ? parseFloat(item.totDiaWt) : 0,
    imageUrl: item.imageUrl ?? "",
    status: (item.currentStatus === "Memo" ? "Memo" : "On Hand") as "On Hand" | "Memo",
    clientName: item.memoClientName ?? "",
    salesPerson: item.memoSalesPersonName ?? "",
  };
}

/* ---------- main component ---------- */

export default function Recommendations() {
  const { addToKitQueue, logAudit, setActivePage } = useIntelligence();
  const [filterType, setFilterType] = useState<FilterType>("All");
  const [sortBy, setSortBy] = useState<SortType>("Ageing");
  const [kitItems, setKitItems] = useState<Set<string>>(new Set());

  // Fetch live inventory for recommendation building
  const { data: stockData, isLoading } = useQuery({
    queryKey: ["stock-items-recommendations"],
    queryFn: () => fetchStockItems({ status: "On Hand", limit: 500 }),
  });

  const inventoryItems = useMemo(() => {
    if (stockData?.items?.length) {
      return stockData.items.map(liveToInventoryItem);
    }
    return [...(DATA.inventory || [])] as InventoryItem[];
  }, [stockData]);

  const allRecs = useMemo(
    () => buildRecommendations(inventoryItems),
    [inventoryItems]
  );

  /* filtered */
  const filtered = useMemo(() => {
    let list =
      filterType === "All"
        ? allRecs
        : allRecs.filter((r) => r.tags.includes(filterType));

    /* sort */
    const sorted = [...list];
    switch (sortBy) {
      case "Ageing":
        sorted.sort((a, b) => b.ageingDays - a.ageingDays);
        break;
      case "GP%":
        sorted.sort((a, b) => b.gp - a.gp);
        break;
      case "Value":
        sorted.sort((a, b) => b.tagPrice - a.tagPrice);
        break;
    }

    /* re-rank after sort */
    sorted.forEach((r, i) => {
      r.rank = i + 1;
    });

    return sorted.slice(0, MAX_DISPLAY);
  }, [allRecs, filterType, sortBy]);

  /* counts per type for the filter display */
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of allRecs) {
      for (const t of r.tags) {
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    return counts;
  }, [allRecs]);

  /* selected items for kit summary */
  const selectedRecs = useMemo(() => {
    return allRecs.filter((r) => kitItems.has(r.jewelCode));
  }, [allRecs, kitItems]);

  const kitTotalValue = useMemo(() => {
    return selectedRecs.reduce((sum, r) => sum + r.tagPrice, 0);
  }, [selectedRecs]);

  function handleAddToKit(rec: Recommendation) {
    setKitItems((prev) => {
      const next = new Set(prev);
      if (next.has(rec.jewelCode)) {
        next.delete(rec.jewelCode);
      } else {
        next.add(rec.jewelCode);
      }
      return next;
    });
  }

  function handleSendKit() {
    if (selectedRecs.length === 0) return;

    const kitId = generateKitId();

    const items: KitItem[] = selectedRecs.map((rec) => {
      // Find the full inventory item to get all fields
      const inv = inventoryItems.find((i) => i.jewelCode === rec.jewelCode);
      if (inv) {
        const item: KitItem = { ...inv, _source: "recommendation" }; return item;
      }
      // Fallback if not found in inventory
      return {
        jewelCode: rec.jewelCode,
        styleNo: rec.styleNo,
        category: rec.category,
        catSimple: rec.category,
        location: rec.location,
        stockType: "",
        subCat: "",
        makeType: "",
        baseMetal: "",
        costPrice: rec.costPrice,
        tagPrice: rec.tagPrice,
        gp: rec.gp,
        ageingDays: rec.ageingDays,
        ageingTag: rec.ageingTag as "Fresh" | "Active" | "Moderate" | "Slow Moving" | "Ageing" | "Non-Moving",
        perfTag: rec.perfTag as "Top Seller" | "Fast Moving" | "Average" | "Slow",
        grossWt: 0,
        pureWt: 0,
        diaWt: 0,
        imageUrl: rec.imageUrl,
        status: "On Hand" as const,
        clientName: "",
        salesPerson: "",
        _source: "recommendation",
      };
    });

    const avgGP = items.length > 0
      ? items.reduce((sum, i) => sum + i.gp, 0) / items.length
      : 0;

    const deadStockCleared = items.filter((i) => i.ageingTag === "Slow Moving" || i.ageingTag === "Ageing" || i.ageingTag === "Non-Moving").length;

    const kit: DispatchKit = {
      id: kitId,
      kind: "bdm",
      bdm: "Unassigned",
      state: null,
      targetClient: null,
      items,
      aiRecommended: items.length,
      manuallyAdded: 0,
      totalValue: kitTotalValue,
      avgGP,
      deadStockCleared,
      status: "pending_approval",
      createdAt: new Date().toISOString(),
      createdBy: "Merchandiser",
      approvedBy: null,
      approvedAt: null,
      notes: `Recommendation kit: ${items.length} items (${filterType} filter)`,
      timeline: [{
        ts: new Date().toISOString(),
        event: "kit_created",
        actor: "Merchandiser",
        detail: `Created recommendation kit with ${items.length} items, total value ${fmt(kitTotalValue)}`,
      }],
    };

    addToKitQueue(kit);
    logAudit("rec_kit_created", kitId, `${items.length} recommended items, ${fmt(kitTotalValue)}`);

    // Clear selection
    setKitItems(new Set());

    // Navigate to dispatch
    setActivePage("dispatch");
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#6B6458] text-sm" style={{ fontFamily: "'DM Mono', monospace" }}>Loading recommendations...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div style={{ height: 2, background: "linear-gradient(90deg, #C9A84C, transparent)", marginBottom: 20, borderRadius: 1 }} />
      {/* ---------- filter bar ---------- */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* type filter */}
        <div className="flex items-center gap-2">
          <label
            className="text-[11px] text-[#6B6458]"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            Type:
          </label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as FilterType)}
            className={cn(
              "h-8 px-2.5 rounded-md border border-[#D4C9A8] bg-white",
              "text-[12px] text-[#3D3830]",
              "focus:outline-none focus:ring-1 focus:ring-[#C9A84C]/40"
            )}
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
                {opt !== "All" && typeCounts[opt]
                  ? ` (${typeCounts[opt]})`
                  : opt === "All"
                    ? ` (${allRecs.length})`
                    : ""}
              </option>
            ))}
          </select>
        </div>

        {/* sort */}
        <div className="flex items-center gap-2">
          <label
            className="text-[11px] text-[#6B6458]"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            Sort:
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortType)}
            className={cn(
              "h-8 px-2.5 rounded-md border border-[#D4C9A8] bg-white",
              "text-[12px] text-[#3D3830]",
              "focus:outline-none focus:ring-1 focus:ring-[#C9A84C]/40"
            )}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        {/* result count */}
        <span
          className="text-[11px] text-[#6B6458] ml-auto"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          Showing {filtered.length} of {fmtN(allRecs.length)} recommendations
        </span>
      </div>

      {/* ---------- recommendation cards ---------- */}
      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((rec) => (
            <RecCard
              key={`${rec.jewelCode}-${rec.rank}`}
              rec={rec}
              isInKit={kitItems.has(rec.jewelCode)}
              onAddToKit={handleAddToKit}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center h-40 rounded-lg border border-dashed border-[#D4C9A8] bg-white">
          <p className="text-[13px] text-[#6B6458]/50">
            No recommendations for this filter
          </p>
        </div>
      )}

      {/* ---------- kit summary footer ---------- */}
      {kitItems.size > 0 && (
        <div className="sticky bottom-0 z-20 bg-white border-t border-[#D4C9A8] shadow-[0_-2px_8px_rgba(0,0,0,0.06)] px-5 py-3 -mx-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-[14px] font-semibold text-[#2C2520]">
              Kit: {kitItems.size} items
            </span>
            <span className="text-[14px] text-[#C9A84C] font-semibold">
              Total: {fmt(kitTotalValue)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setKitItems(new Set())}
              className="px-4 py-2 border border-[#D4C9A8] text-[13px] text-[#6B6458] rounded-lg hover:bg-[#F5F1E8] transition-colors"
            >
              Clear
            </button>
            <button
              onClick={handleSendKit}
              className="px-5 py-2 bg-[#C9A84C] text-white text-[13px] font-semibold rounded-lg hover:bg-[#8B6914] transition-colors"
            >
              Send Kit for Approval
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
