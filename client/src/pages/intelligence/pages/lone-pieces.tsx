import { useState, useMemo } from "react";
import { DATA } from "../lib/intelligence-data";
import { ORPHAN_PAIRS, CAT_SUFFIX_MAP } from "../lib/intelligence-constants";
import { fmt, getDriveImgUrl, prettyCatForItem } from "../lib/intelligence-utils";
import { cn } from "@/lib/utils";
import type { InventoryItem } from "../lib/intelligence-types";
import { useQuery } from "@tanstack/react-query";
import { fetchStockItems } from "@/lib/api";
import type { LiveStockItem } from "@/lib/api";

type InvItem = (typeof DATA.inventory)[number];
type ViewMode = "all" | "sets" | "earrings";
type SortMode = "ageing" | "value" | "family";

interface OrphanCard {
  item: InventoryItem;
  family: string;
  suffix: string;
  missingCompanion: string;
  isSet: boolean;
}

// All suffixes that participate in pairing
const ALL_SET_SUFFIXES = Object.keys(ORPHAN_PAIRS);
const ALL_EAR_SUFFIXES = Object.values(ORPHAN_PAIRS);
const ALL_PAIR_SUFFIXES = [...ALL_SET_SUFFIXES, ...ALL_EAR_SUFFIXES];

function parseSuffix(styleNo: string): { prefix: string; suffix: string } | null {
  // Style codes look like OCLO19327NLS -- alpha prefix + digits + alpha suffix
  const m = styleNo.match(/^([A-Z]+\d+)([A-Z]+)$/);
  if (!m) return null;
  return { prefix: m[1], suffix: m[2] };
}

function toInventoryItem(item: InvItem): InventoryItem {
  return {
    jewelCode: item.jewelCode as string,
    styleNo: item.styleNo as string,
    category: item.category as string,
    catSimple: item.catSimple as string,
    location: item.location as string,
    stockType: item.stockType as string,
    subCat: item.subCat as string,
    makeType: item.makeType as string,
    baseMetal: item.baseMetal as string,
    costPrice: item.costPrice as number,
    tagPrice: item.tagPrice as number,
    gp: item.gp as number,
    ageingDays: item.ageingDays as number,
    ageingTag: item.ageingTag as InventoryItem["ageingTag"],
    perfTag: item.perfTag as InventoryItem["perfTag"],
    grossWt: item.grossWt as number,
    pureWt: item.pureWt as number,
    diaWt: item.diaWt as number,
    imageUrl: item.imageUrl as string,
    status: item.status as InventoryItem["status"],
    clientName: item.clientName as string,
    salesPerson: item.salesPerson as string,
  };
}

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

function computeOrphans(inventoryItems: InventoryItem[]): OrphanCard[] {
  // Group items by family prefix, only considering pair-eligible suffixes
  const familyMap: Record<string, Record<string, InventoryItem[]>> = {};

  for (let i = 0; i < inventoryItems.length; i++) {
    const raw = inventoryItems[i];
    if (raw.status !== "On Hand") continue;
    const parsed = parseSuffix(raw.styleNo);
    if (!parsed) continue;
    if (!ALL_PAIR_SUFFIXES.includes(parsed.suffix)) continue;

    const { prefix, suffix } = parsed;
    if (!familyMap[prefix]) {
      familyMap[prefix] = {};
    }
    if (!familyMap[prefix][suffix]) {
      familyMap[prefix][suffix] = [];
    }
    familyMap[prefix][suffix].push(raw);
  }

  const orphans: OrphanCard[] = [];

  const familyKeys = Object.keys(familyMap);
  for (let fi = 0; fi < familyKeys.length; fi++) {
    const prefix = familyKeys[fi];
    const suffixMap = familyMap[prefix];

    // Check each set suffix -- if set exists but earring doesn't (or vice versa)
    const pairEntries = Object.entries(ORPHAN_PAIRS);
    for (let pi = 0; pi < pairEntries.length; pi++) {
      const [setSuffix, earSuffix] = pairEntries[pi];
      const hasSet = !!suffixMap[setSuffix];
      const hasEar = !!suffixMap[earSuffix];

      if (hasSet && !hasEar) {
        // Set piece exists, earring is missing (sold or never existed)
        const items = suffixMap[setSuffix];
        for (let ii = 0; ii < items.length; ii++) {
          orphans.push({
            item: items[ii],
            family: prefix,
            suffix: setSuffix,
            missingCompanion: CAT_SUFFIX_MAP[earSuffix] || earSuffix,
            isSet: true,
          });
        }
      } else if (hasEar && !hasSet) {
        // Earring exists, set piece is missing
        const items = suffixMap[earSuffix];
        for (let ii = 0; ii < items.length; ii++) {
          orphans.push({
            item: items[ii],
            family: prefix,
            suffix: earSuffix,
            missingCompanion: CAT_SUFFIX_MAP[setSuffix] || setSuffix,
            isSet: false,
          });
        }
      }
    }
  }

  return orphans;
}

export default function LonePiecesPage() {
  const [view, setView] = useState<ViewMode>("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortMode>("ageing");

  // Fetch all on-hand items for orphan computation
  const { data: stockData, isLoading } = useQuery({
    queryKey: ["stock-items-lone-pieces"],
    queryFn: () => fetchStockItems({ status: "On Hand", limit: 5000 }),
  });

  const inventoryItems = useMemo(() => {
    if (stockData?.items?.length) {
      return stockData.items.map(liveToInventoryItem);
    }
    // Fallback to static data
    return (DATA.inventory || []).map(toInventoryItem);
  }, [stockData]);

  const allOrphans = useMemo(() => computeOrphans(inventoryItems), [inventoryItems]);

  // Derive unique categories from orphans
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const o of allOrphans) {
      cats.add(prettyCatForItem(o.item));
    }
    return Array.from(cats).sort();
  }, [allOrphans]);

  // Apply filters
  const filtered = useMemo(() => {
    let result = allOrphans;

    if (view === "sets") {
      result = result.filter((o) => o.isSet);
    } else if (view === "earrings") {
      result = result.filter((o) => !o.isSet);
    }

    if (catFilter !== "all") {
      result = result.filter((o) => prettyCatForItem(o.item) === catFilter);
    }

    // Sort
    if (sort === "ageing") {
      result = [...result].sort((a, b) => b.item.ageingDays - a.item.ageingDays);
    } else if (sort === "value") {
      result = [...result].sort((a, b) => b.item.tagPrice - a.item.tagPrice);
    } else {
      result = [...result].sort((a, b) => a.family.localeCompare(b.family));
    }

    return result;
  }, [allOrphans, view, catFilter, sort]);

  // Summary stats
  const totalValue = useMemo(
    () => filtered.reduce((s, o) => s + o.item.tagPrice, 0),
    [filtered]
  );
  const deadCount = useMemo(
    () => filtered.filter((o) => o.item.ageingTag === "Slow Moving" || o.item.ageingTag === "Ageing" || o.item.ageingTag === "Non-Moving").length,
    [filtered]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#6B6458] text-sm" style={{ fontFamily: "'DM Mono', monospace" }}>Loading inventory for orphan analysis...</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ height: 2, background: "linear-gradient(90deg, #C9A84C, transparent)", marginBottom: 20, borderRadius: 1 }} />
      {/* Header summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-[#D4C9A8] rounded-lg p-4">
          <p
            className="text-[9px] tracking-[1.5px] uppercase mb-1"
            style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
          >
            ORPHAN PIECES
          </p>
          <p className="text-xl tabular-nums" style={{ fontFamily: "'Cormorant Garamond', serif", color: "#1A1814" }}>
            {filtered.length}
          </p>
        </div>
        <div className="bg-white border border-[#D4C9A8] rounded-lg p-4">
          <p
            className="text-[9px] tracking-[1.5px] uppercase mb-1"
            style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
          >
            TOTAL VALUE
          </p>
          <p className="text-xl tabular-nums" style={{ fontFamily: "'Cormorant Garamond', serif", color: "#1A1814" }}>
            {fmt(totalValue)}
          </p>
        </div>
        <div className="bg-white border border-[#D4C9A8] rounded-lg p-4">
          <p
            className="text-[9px] tracking-[1.5px] uppercase mb-1"
            style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
          >
            DEAD STOCK
          </p>
          <p className="text-xl tabular-nums" style={{ fontFamily: "'Cormorant Garamond', serif", color: "#A63C2A" }}>
            {deadCount}
          </p>
        </div>
        <div className="bg-white border border-[#D4C9A8] rounded-lg p-4">
          <p
            className="text-[9px] tracking-[1.5px] uppercase mb-1"
            style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
          >
            UNIQUE FAMILIES
          </p>
          <p className="text-xl tabular-nums" style={{ fontFamily: "'Cormorant Garamond', serif", color: "#1A1814" }}>
            {new Set(filtered.map((o) => o.family)).size}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="flex items-center gap-4 mb-5 p-3 bg-white border border-[#D4C9A8] rounded-lg"
      >
        {/* View toggle */}
        <div className="flex items-center gap-1 border border-[#D4C9A8] rounded-md overflow-hidden">
          {(["all", "sets", "earrings"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-3 py-1.5 text-[12px] capitalize transition-colors",
                view === v
                  ? "bg-[#C9A84C] text-[#1A1814]"
                  : "bg-white text-[#3D3830] hover:bg-[#F5F1E8]"
              )}
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Category filter */}
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="px-3 py-1.5 text-[12px] border border-[#D4C9A8] rounded-md bg-white text-[#3D3830] outline-none"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          <option value="all">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className="px-3 py-1.5 text-[12px] border border-[#D4C9A8] rounded-md bg-white text-[#3D3830] outline-none"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          <option value="ageing">Sort: Ageing</option>
          <option value="value">Sort: Value</option>
          <option value="family">Sort: Style Family</option>
        </select>

        <span
          className="ml-auto text-[11px]"
          style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
        >
          {filtered.length} items
        </span>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex items-center justify-center h-40 rounded-lg border border-dashed border-[#D4C9A8]">
          <p
            className="text-[#1A1814]/40 text-sm"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            No orphan pieces found with current filters
          </p>
        </div>
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
        >
          {filtered.map((orphan) => (
            <OrphanCardComponent key={orphan.item.jewelCode} orphan={orphan} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrphanCardComponent({ orphan }: { orphan: OrphanCard }) {
  const { item, missingCompanion } = orphan;
  const imgUrl = getDriveImgUrl(item.imageUrl);
  const category = prettyCatForItem(item);

  const ageBadgeCls =
    item.ageingTag === "Non-Moving" || item.ageingTag === "Ageing"
      ? "bg-[#FDEAEA] text-[#8B1A1A]"
      : item.ageingTag === "Slow Moving"
        ? "bg-[#FFF4E0] text-[#8B5E00]"
        : "bg-[#F5F1E8] text-[#3D3830]";

  return (
    <div className="bg-white border border-[#D4C9A8] rounded-lg overflow-hidden hover:shadow-md transition-shadow">
      {/* Image */}
      <div
        className="w-full flex items-center justify-center bg-[#F5F1E8] overflow-hidden"
        style={{ height: 170 }}
      >
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={item.styleNo}
            className="w-full h-full object-contain"
            loading="lazy"
          />
        ) : (
          <span
            className="text-[11px] text-[#6B6458]"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            No Image
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-3">
        <p
          className="font-bold text-[13px] text-[#1A1814] truncate"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          {item.styleNo}
        </p>
        <p
          className="text-[11px] text-[#6B6458] mt-0.5"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          {item.jewelCode}
        </p>
        <p className="text-[12px] text-[#3D3830] mt-1">{category}</p>

        {/* Missing companion label */}
        <p className="text-[10px] text-[#A63C2A] mt-1" style={{ fontFamily: "'DM Mono', monospace" }}>
          Missing: {missingCompanion}
        </p>

        {/* Price + age badge */}
        <div className="flex items-center justify-between mt-2">
          <span
            className="text-[17px] tabular-nums"
            style={{ fontFamily: "'Cormorant Garamond', serif", color: "#8B6914", fontWeight: 600 }}
          >
            {fmt(item.tagPrice)}
          </span>
          <span
            className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium", ageBadgeCls)}
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            {item.ageingTag} ({item.ageingDays}d)
          </span>
        </div>
      </div>
    </div>
  );
}
