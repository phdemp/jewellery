import { useState, useMemo } from "react";
import { DATA } from "../lib/intelligence-data";
import { fmt, getDriveImgUrl, ageTagClass, generateKitId, downloadCSV } from "../lib/intelligence-utils";
import { useIntelligence } from "../intelligence-context";
import { cn } from "@/lib/utils";
import type { AssortSuggestion, DispatchKit, KitItem } from "../lib/intelligence-types";
import { useQuery } from "@tanstack/react-query";
import { fetchStockItems } from "@/lib/api";
import type { LiveStockItem } from "@/lib/api";

type Mode = "exhibition" | "location" | "bdm";

const REASON_COLORS: Record<string, string> = {
  match: "bg-[#E8F0FE] text-[#1A56CC]",
  band: "bg-[rgba(201,168,76,0.15)] text-[#8B6914]",
  clearance: "bg-[#FDEAEA] text-[#8B1A1A]",
  margin: "bg-[#E8F5EC] text-[#2D6B42]",
  new: "bg-[#F0FDF4] text-[#166534]",
  pref: "bg-[#EDE9FE] text-[#5B21B6]",
  slow: "bg-[#FFE8D6] text-[#8B3A00]",
  gp: "bg-[#E8F5EC] text-[#2D6B42]",
};

interface DecisionState {
  [jc: string]: "accepted" | "rejected" | undefined;
}

export default function AssortmentPlanner() {
  const { goldPrice, setGoldPrice, addToKitQueue, logAudit, setActivePage } = useIntelligence();

  const [mode, setMode] = useState<Mode>("exhibition");
  const [selectedBdm, setSelectedBdm] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const [selectedClient, setSelectedClient] = useState("");
  const [kitSize, setKitSize] = useState(25);
  const [clearancePct, setClearancePct] = useState(30);
  const [weightMin, setWeightMin] = useState("");
  const [weightMax, setWeightMax] = useState("");
  const [localGoldPrice, setLocalGoldPrice] = useState(goldPrice || 0);
  const [generated, setGenerated] = useState(false);
  const [decisions, setDecisions] = useState<DecisionState>({});

  const bdmStatesMap = DATA.bdmStates as Record<string, { name: string; states: readonly string[]; totalRevenue: number; txnCount: number }>;
  const bdmKeys = useMemo(() => Object.keys(bdmStatesMap), []);
  const statesForBdm = useMemo((): readonly string[] => {
    if (!selectedBdm || !bdmStatesMap[selectedBdm]) return [];
    return bdmStatesMap[selectedBdm].states || [];
  }, [selectedBdm]);

  // Fetch live stock items for assortment suggestions
  const { data: stockData } = useQuery({
    queryKey: ["stock-items-assortment"],
    queryFn: () => fetchStockItems({ status: "On Hand", limit: 200, sortBy: "tagPrice", sortDir: "desc" }),
    enabled: generated,
  });

  // Convert live items to AssortSuggestion format
  const liveAssortSuggestions = useMemo((): AssortSuggestion[] => {
    if (!stockData?.items?.length) return [];
    return stockData.items.map((item: LiveStockItem) => {
      const ageingDays = item.ageingDays;
      const ageTag = ageingDays <= 90 ? "Fresh" : ageingDays <= 180 ? "Watch" : ageingDays <= 365 ? "Slow" : "Dead Stock";
      const gp = item.tagPrice > 0 ? ((item.tagPrice - item.costPrice) / item.tagPrice) * 100 : 0;

      // Compute score and reasons
      const reasons: string[] = [];
      let score = 50;
      if (ageTag === "Dead Stock") { reasons.push("clearance"); score += 15; }
      if (ageTag === "Slow") { reasons.push("slow"); score += 5; }
      if (gp >= 40) { reasons.push("margin"); score += 10; }
      if (ageTag === "Fresh") { reasons.push("new"); score -= 5; }

      return {
        jc: item.jewelCode,
        styleNo: item.styleNo ?? "",
        cat: item.category ?? "",
        costPrice: item.costPrice,
        tagPrice: item.tagPrice,
        gp,
        ageingDays,
        ageTag,
        baseMetal: item.baseMetal ?? "",
        grossWt: item.grossWt ? parseFloat(item.grossWt) : 0,
        diaWt: item.totDiaWt ? parseFloat(item.totDiaWt) : 0,
        imageUrl: item.imageUrl ?? "",
        stockType: item.stockType ?? "",
        score: Math.min(score, 100),
        reasons,
        thumbUrl: item.imageUrl ?? "",
      };
    });
  }, [stockData]);

  const suggestions = useMemo(() => {
    if (!generated) return [];
    // Use live data if available, else fallback to static
    let items = liveAssortSuggestions.length > 0
      ? [...liveAssortSuggestions]
      : ([...(DATA.assortSuggestions || [])] as unknown) as AssortSuggestion[];

    if (weightMin) {
      const min = parseFloat(weightMin);
      if (!isNaN(min)) items = items.filter((i) => i.grossWt >= min);
    }
    if (weightMax) {
      const max = parseFloat(weightMax);
      if (!isNaN(max)) items = items.filter((i) => i.grossWt <= max);
    }

    items.sort((a, b) => b.score - a.score);
    return items.slice(0, kitSize * 3);
  }, [generated, kitSize, weightMin, weightMax, liveAssortSuggestions]);

  const tiers = useMemo(() => {
    const must: AssortSuggestion[] = [];
    const recommended: AssortSuggestion[] = [];
    const optional: AssortSuggestion[] = [];
    for (const item of suggestions) {
      if (item.score > 70) must.push(item);
      else if (item.score >= 50) recommended.push(item);
      else optional.push(item);
    }
    return { must, recommended, optional };
  }, [suggestions]);

  const acceptedCount = Object.values(decisions).filter((d) => d === "accepted").length;
  const rejectedCount = Object.values(decisions).filter((d) => d === "rejected").length;

  const acceptedItems = useMemo(() => {
    return suggestions.filter((s) => decisions[s.jc] === "accepted");
  }, [suggestions, decisions]);

  const totalTagValue = useMemo(() => {
    return acceptedItems.reduce((sum, item) => sum + item.tagPrice, 0);
  }, [acceptedItems]);

  function handleGenerate() {
    setGenerated(true);
    setDecisions({});
    if (localGoldPrice > 0) setGoldPrice(localGoldPrice);
  }

  function handleDecision(jc: string, decision: "accepted" | "rejected") {
    setDecisions((prev) => ({
      ...prev,
      [jc]: prev[jc] === decision ? undefined : decision,
    }));
  }

  function handleExportCSV() {
    const headers = ["JC", "Style No", "Category", "Tag Price", "GP%", "Score", "Status"];
    const rows = suggestions.map((s) => [
      s.jc,
      s.styleNo,
      s.cat,
      s.tagPrice,
      s.gp,
      s.score,
      decisions[s.jc] || "pending",
    ]);
    downloadCSV("assortment-plan.csv", headers, rows);
  }

  function handleFinalizeKit() {
    const kitId = generateKitId();

    // Convert accepted AssortSuggestion items to KitItem format
    const kitItems: KitItem[] = acceptedItems.map((item) => ({
      jewelCode: item.jc,
      styleNo: item.styleNo,
      category: item.cat,
      catSimple: item.cat,
      location: "",
      stockType: item.stockType,
      subCat: "",
      makeType: "",
      baseMetal: item.baseMetal,
      costPrice: item.costPrice,
      tagPrice: item.tagPrice,
      gp: item.gp,
      ageingDays: item.ageingDays,
      ageingTag: item.ageTag as "Fresh" | "Watch" | "Slow" | "Dead Stock",
      perfTag: "Average" as const,
      grossWt: item.grossWt,
      pureWt: 0,
      diaWt: item.diaWt,
      imageUrl: item.imageUrl,
      status: "On Hand" as const,
      clientName: "",
      salesPerson: "",
      _source: "assortment",
    }));

    const avgGP = kitItems.length > 0
      ? kitItems.reduce((sum, i) => sum + i.gp, 0) / kitItems.length
      : 0;

    const deadStockCleared = kitItems.filter((i) => i.ageingTag === "Dead Stock").length;

    const kit: DispatchKit = {
      id: kitId,
      kind: mode === "exhibition" ? "exhibition" : mode === "bdm" ? "bdm" : "bdm",
      bdm: selectedBdm || "Unassigned",
      state: selectedState || null,
      targetClient: selectedClient || null,
      items: kitItems,
      aiRecommended: kitItems.length,
      manuallyAdded: 0,
      totalValue: totalTagValue,
      avgGP,
      deadStockCleared,
      status: "pending_approval",
      createdAt: new Date().toISOString(),
      createdBy: "Merchandiser",
      approvedBy: null,
      approvedAt: null,
      notes: `${mode} kit with ${kitItems.length} items`,
      timeline: [{
        ts: new Date().toISOString(),
        event: "kit_created",
        actor: "Merchandiser",
        detail: `Created ${mode} kit with ${kitItems.length} items, total value ${fmt(totalTagValue)}`,
      }],
    };

    addToKitQueue(kit);
    logAudit("kit_created", kitId, `${acceptedCount} items, ${fmt(totalTagValue)}`);

    // Reset decisions after finalizing
    setDecisions({});
    setGenerated(false);

    // Navigate to dispatch page to see the kit in approval queue
    setActivePage("dispatch");
  }

  function renderTierSection(
    title: string,
    items: AssortSuggestion[],
    borderColor: string,
    bgColor: string,
  ) {
    if (items.length === 0) return null;
    return (
      <div className="mb-6">
        <div className={cn("flex items-center gap-2 mb-3 px-3 py-2 rounded-lg", bgColor)}>
          <div className={cn("w-3 h-3 rounded-full", borderColor)} />
          <h3 className="text-[15px] font-semibold text-[#2C2520]">
            {title}
          </h3>
          <span className="text-[13px] text-[#6B6458] ml-1">({items.length} items)</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {items.map((item) => renderCard(item))}
        </div>
      </div>
    );
  }

  function renderCard(item: AssortSuggestion) {
    const state = decisions[item.jc];
    const imgSrc = getDriveImgUrl(item.imageUrl || item.thumbUrl);
    const reasons: Array<{ tag: string; text: string }> =
      Array.isArray(item.reasons)
        ? item.reasons.map((r) =>
            typeof r === "string" ? { tag: r, text: r } : r,
          )
        : [];

    return (
      <div
        key={item.jc}
        className={cn(
          "relative border rounded-lg overflow-hidden bg-white transition-all group",
          state === "accepted"
            ? "border-[#4A7C59] ring-2 ring-[rgba(74,124,89,0.25)]"
            : state === "rejected"
              ? "border-[#A63C2A] ring-2 ring-[rgba(166,60,42,0.15)] opacity-60"
              : "border-[#D4C9A8] hover:border-[#C9A84C] hover:shadow-md",
        )}
      >
        {/* Image */}
        <div className="relative h-[140px] bg-[#FAF8F5] overflow-hidden">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={item.styleNo}
              className="w-full h-full object-contain"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#B8A97E] text-[13px]">
              No Image
            </div>
          )}

          {/* Accept/reject overlay on hover */}
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <button
              onClick={() => handleDecision(item.jc, "accepted")}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-white text-[18px] font-bold transition-transform hover:scale-110",
                state === "accepted" ? "bg-[#4A7C59]" : "bg-[#4A7C59]/80",
              )}
              title="Accept"
            >
              &#10003;
            </button>
            <button
              onClick={() => handleDecision(item.jc, "rejected")}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-white text-[18px] font-bold transition-transform hover:scale-110",
                state === "rejected" ? "bg-[#A63C2A]" : "bg-[#A63C2A]/80",
              )}
              title="Reject"
            >
              &#10007;
            </button>
          </div>

          {/* State badge */}
          {state && (
            <div
              className={cn(
                "absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                state === "accepted"
                  ? "bg-[#4A7C59] text-white"
                  : "bg-[#A63C2A] text-white",
              )}
            >
              {state}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-3">
          <div className="flex items-start justify-between mb-1">
            <span className="text-[12px] font-mono text-[#6B6458]">{item.styleNo}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#F5F0E8] text-[#6B6458]">
              {item.cat}
            </span>
          </div>

          <div className="text-[16px] font-semibold text-[#8B6914] mb-1">
            {fmt(item.tagPrice)}
          </div>

          <div className="flex items-center gap-3 mb-2 text-[12px] text-[#6B6458]">
            <span>
              GP: <strong className="text-[#2D6B42]">{item.gp.toFixed(1)}%</strong>
            </span>
            <div className="flex-1 h-1.5 bg-[#EDEDED] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(item.score, 100)}%`,
                  backgroundColor:
                    item.score > 70
                      ? "#4A7C59"
                      : item.score >= 50
                        ? "#C9A84C"
                        : "#C4862B",
                }}
              />
            </div>
            <span className="text-[11px] font-medium">{item.score.toFixed(0)}</span>
          </div>

          {/* Reason pills */}
          <div className="flex flex-wrap gap-1">
            {reasons.map((r, i) => (
              <span
                key={i}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                  REASON_COLORS[r.tag] || "bg-[#F5F0E8] text-[#6B6458]",
                )}
              >
                {r.text}
              </span>
            ))}
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", ageTagClass(item.ageTag))}>
              {item.ageTag}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Mode Selector */}
      <div className="flex items-center gap-0">
        {(["exhibition", "location", "bdm"] as Mode[]).map((m, i, arr) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "px-5 py-2 text-[13px] font-medium border transition-colors capitalize",
              i === 0 && "rounded-l-lg",
              i === arr.length - 1 && "rounded-r-lg",
              i > 0 && "border-l-0",
              mode === m
                ? "bg-[#C9A84C] text-white border-[#C9A84C]"
                : "bg-white text-[#6B6458] border-[#D4C9A8] hover:bg-[#FAF8F5]",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Config Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 p-4 bg-white border border-[#D4C9A8] rounded-lg">
        {/* BDM Select */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
            BDM
          </label>
          <select
            value={selectedBdm}
            onChange={(e) => {
              setSelectedBdm(e.target.value);
              setSelectedState("");
            }}
            className="w-full text-[13px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
          >
            <option value="">All BDMs</option>
            {bdmKeys.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        {/* State Select */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
            State
          </label>
          <select
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            className="w-full text-[13px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
            disabled={!selectedBdm}
          >
            <option value="">All States</option>
            {statesForBdm.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Client Select */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
            Client
          </label>
          <select
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
            className="w-full text-[13px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
          >
            <option value="">All Clients</option>
            {(DATA.assortClients || []).map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Kit Size */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
            Kit Size: {kitSize}
          </label>
          <input
            type="range"
            min={10}
            max={50}
            value={kitSize}
            onChange={(e) => setKitSize(Number(e.target.value))}
            className="w-full accent-[#C9A84C]"
          />
        </div>

        {/* Clearance % */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
            Clearance %: {clearancePct}
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={clearancePct}
            onChange={(e) => setClearancePct(Number(e.target.value))}
            className="w-full accent-[#C9A84C]"
          />
        </div>

        {/* Weight Range */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
            Weight (g)
          </label>
          <div className="flex gap-1">
            <input
              type="number"
              placeholder="Min"
              value={weightMin}
              onChange={(e) => setWeightMin(e.target.value)}
              className="w-1/2 text-[12px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
            />
            <input
              type="number"
              placeholder="Max"
              value={weightMax}
              onChange={(e) => setWeightMax(e.target.value)}
              className="w-1/2 text-[12px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
            />
          </div>
        </div>

        {/* Gold Price */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
            Gold Price/g
          </label>
          <input
            type="number"
            placeholder="e.g. 7500"
            value={localGoldPrice || ""}
            onChange={(e) => setLocalGoldPrice(Number(e.target.value))}
            className="w-full text-[12px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
          />
        </div>
      </div>

      {/* Generate Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleGenerate}
          className="px-6 py-2.5 bg-[#C9A84C] text-white text-[14px] font-semibold rounded-lg hover:bg-[#B8972F] transition-colors"
        >
          Generate Assortment
        </button>
        {generated && (
          <button
            onClick={handleExportCSV}
            className="px-4 py-2.5 border border-[#D4C9A8] text-[13px] text-[#6B6458] rounded-lg hover:bg-[#FAF8F5] transition-colors"
          >
            Export CSV
          </button>
        )}
      </div>

      {generated && (
        <>
          {/* Stats Pills */}
          <div className="flex items-center gap-3">
            <div className="px-4 py-2 rounded-full bg-[#E8F5EC] text-[#2D6B42] text-[13px] font-medium">
              Accepted: {acceptedCount}
            </div>
            <div className="px-4 py-2 rounded-full bg-[#FDEAEA] text-[#8B1A1A] text-[13px] font-medium">
              Rejected: {rejectedCount}
            </div>
            <div className="px-4 py-2 rounded-full bg-[#F5F0E8] text-[#6B6458] text-[13px] font-medium">
              Pending: {suggestions.length - acceptedCount - rejectedCount}
            </div>
          </div>

          {/* Tier Sections */}
          {renderTierSection(
            "Must Include",
            tiers.must,
            "bg-[#4A7C59]",
            "bg-[#E8F5EC]",
          )}
          {renderTierSection(
            "Recommended",
            tiers.recommended,
            "bg-[#C9A84C]",
            "bg-[rgba(201,168,76,0.1)]",
          )}
          {renderTierSection(
            "Optional",
            tiers.optional,
            "bg-[#C4862B]",
            "bg-[#FFF4E0]",
          )}

          {suggestions.length === 0 && (
            <div className="text-center py-12 text-[#6B6458] text-[14px]">
              No suggestions match the current filters. Adjust weight range or kit size.
            </div>
          )}
        </>
      )}

      {!generated && (
        <div className="text-center py-16 text-[#6B6458]">
          <div className="text-[18px] font-medium mb-2">Configure your assortment parameters</div>
          <div className="text-[13px]">
            Select a mode, choose filters, and click Generate Assortment to build a recommended kit.
          </div>
        </div>
      )}

      {/* Kit Summary Footer */}
      {generated && acceptedCount > 0 && (
        <div className="sticky bottom-0 z-20 bg-white border-t border-[#D4C9A8] shadow-[0_-2px_8px_rgba(0,0,0,0.06)] px-5 py-3 -mx-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-[14px] font-semibold text-[#2C2520]">
              Kit: {acceptedCount} items
            </span>
            <span className="text-[14px] text-[#C9A84C] font-semibold">
              Total Tag Value: {fmt(totalTagValue)}
            </span>
          </div>
          <button
            onClick={handleFinalizeKit}
            className="px-5 py-2 bg-[#C9A84C] text-white text-[13px] font-semibold rounded-lg hover:bg-[#B8972F] transition-colors"
          >
            Finalize Kit
          </button>
        </div>
      )}
    </div>
  );
}
