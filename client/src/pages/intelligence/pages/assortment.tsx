import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { DATA } from "../lib/intelligence-data";
import { fmt, getDriveImgUrl, downloadCSV, generateKitId } from "../lib/intelligence-utils";
import { useIntelligence } from "../intelligence-context";
import { cn } from "@/lib/utils";
import type { AssortSuggestion, AssortReason, DispatchKit, KitItem } from "../lib/intelligence-types";
import { useQuery } from "@tanstack/react-query";
import {
  generateAiAssortmentScore,
  fetchB2bBdmList,
  fetchB2bStatesForBdm,
  fetchB2bClientsForBdm,
} from "@/lib/api";
import type { AiScoredItem, AiScoreProfile, AiScoreBreakdown } from "@/lib/api";

/* ── Modes matching the live HTML reference ── */
type Mode = "client" | "location" | "bdmstate";

/* ── Reason pill colors + emoji icons (matching live .rp-* classes) ── */
const REASON_PILL: Record<string, { cls: string; ico: string }> = {
  match:     { cls: "bg-[#E8F0FE] text-[#1A56CC]",           ico: "\uD83C\uDFAF" },
  pref:      { cls: "bg-[#EDE9FE] text-[#5B21B6]",           ico: "\u2728" },
  band:      { cls: "bg-[rgba(201,168,76,0.15)] text-[#8B6914]", ico: "\uD83D\uDCB0" },
  clearance: { cls: "bg-[#FDEAEA] text-[#8B1A1A]",           ico: "\uD83D\uDD34" },
  new:       { cls: "bg-[#F0FDF4] text-[#166534]",           ico: "\uD83C\uDD95" },
  slow:      { cls: "bg-[#FFE8D6] text-[#8B3A00]",           ico: "\uD83D\uDFE0" },
  seen:      { cls: "bg-[#F5F5F5] text-[#555]",              ico: "\uD83D\uDC41\uFE0F" },
};

/* ── Tier config matching live HTML (.tier-must, .tier-rec, .tier-opt) ── */
const TIER_CONFIG = {
  "MUST INCLUDE": {
    cls: "bg-[#FDEAEA] text-[#8B1A1A] border border-[#f5c6c6]",
    label: "\uD83C\uDFAF Must Include",
    sub: "These items best match the client\u2019s history, price band & are aged \u2014 include all",
  },
  RECOMMENDED: {
    cls: "bg-[#E8F0FE] text-[#1A56CC] border border-[#c5d8f8]",
    label: "\u2728 Recommended",
    sub: "Strong match \u2014 good conversion probability",
  },
  OPTIONAL: {
    cls: "bg-[#F5F5F5] text-[#555] border border-[#ddd]",
    label: "\uD83D\uDCA1 Optional",
    sub: "Lower match score \u2014 include for variety if kit has space",
  },
} as const;

function getTier(score: number): "MUST INCLUDE" | "RECOMMENDED" | "OPTIONAL" | null {
  if (score >= 70) return "MUST INCLUDE";
  if (score >= 45) return "RECOMMENDED";
  if (score >= 20) return "OPTIONAL";
  return null;
}

/* ── Set pairing: group necklace + earring by shared style root ── */
// Earring suffixes end in E (e.g. NSE, LNSE, CHSE). Strip trailing E to get root.
function pairRoot(styleCode: string | undefined): string | null {
  if (!styleCode) return null;
  const s = styleCode.toUpperCase().trim();
  const m = s.match(/^(.+?)(NLSE|LNSE|CHSE|PNSE|CNSE|NSE|LNS|NLS|CHS|PNS|CNS|NS|CS)(-\d+)?$/);
  if (!m) return null;
  const prefix = m[1];
  let suffix = m[2];
  if (/E$/.test(suffix)) suffix = suffix.slice(0, -1);
  return prefix + suffix + (m[3] || "");
}

function isEarringHalf(styleCode: string | undefined): boolean {
  if (!styleCode) return false;
  return /(NLSE|LNSE|CHSE|PNSE|CNSE|NSE)(-\d+)?$/.test(styleCode.toUpperCase().trim());
}

interface SetGroup {
  type: "single" | "set";
  items: AssortSuggestion[];
}

interface DecisionState {
  [jc: string]: "accepted" | "rejected" | undefined;
}

/* ─────────────────────────────────────────────── */
export default function AssortmentPlanner() {
  const { goldPrice, setGoldPrice, addToKitQueue, logAudit, setActivePage } = useIntelligence();

  const [mode, setMode] = useState<Mode>("bdmstate");
  const [selectedBdm, setSelectedBdm] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const [selectedClient, setSelectedClient] = useState("");
  const [kitSize, setKitSize] = useState(100);
  const [clearancePct, setClearancePct] = useState(30);
  const [weightMin, setWeightMin] = useState("");
  const [weightMax, setWeightMax] = useState("");
  const [localGoldPrice, setLocalGoldPrice] = useState(goldPrice || 0);
  const [generated, setGenerated] = useState(false);
  const [decisions, setDecisions] = useState<DecisionState>({});
  const [detailItem, setDetailItem] = useState<AssortSuggestion | null>(null);

  /* ── AI scoring state ── */
  const [isScoring, setIsScoring] = useState(false);
  const [scoringError, setScoringError] = useState<string | null>(null);
  const [aiItems, setAiItems] = useState<AiScoredItem[]>([]);
  const [aiProfile, setAiProfile] = useState<AiScoreProfile | null>(null);
  const [aiTiming, setAiTiming] = useState<{ totalMs: number; method: "vector" | "formula" } | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Live BDM data from B2B sales ── */
  const { data: bdmListData } = useQuery({
    queryKey: ["b2b-bdm-list"],
    queryFn: fetchB2bBdmList,
  });
  const bdmKeys = bdmListData?.bdms || [];

  const { data: statesData } = useQuery({
    queryKey: ["b2b-bdm-states", selectedBdm],
    queryFn: () => fetchB2bStatesForBdm(selectedBdm),
    enabled: !!selectedBdm,
  });
  const statesForBdm = statesData?.states || [];

  const { data: clientsData } = useQuery({
    queryKey: ["b2b-bdm-clients", selectedBdm],
    queryFn: () => fetchB2bClientsForBdm(selectedBdm),
    enabled: !!selectedBdm,
  });
  const clientsForBdm = clientsData?.clients || [];

  /* ── Fallback to static DATA when B2B not yet imported ── */
  const bdmStatesMap = DATA.bdmStates as Record<string, { name: string; states: readonly string[]; totalRevenue: number; txnCount: number }>;
  const fallbackBdmKeys = useMemo(() => Object.keys(bdmStatesMap), []);
  const effectiveBdmKeys = bdmKeys.length > 0 ? bdmKeys : fallbackBdmKeys;
  const effectiveStates = statesForBdm.length > 0 ? statesForBdm : (selectedBdm && bdmStatesMap[selectedBdm] ? [...bdmStatesMap[selectedBdm].states] : []);
  const effectiveClients = clientsForBdm.length > 0 ? clientsForBdm : (DATA.assortClients || []).map(c => ({ name: c.name, spend: c.spend || 0, count: c.txns || 0 }));

  /* ── Convert AI items to AssortSuggestion ── */
  const suggestions = useMemo((): AssortSuggestion[] => {
    if (!generated || aiItems.length === 0) return [];

    let items: AssortSuggestion[] = aiItems.map((item) => ({
      jc: item.jewelCode,
      styleNo: item.styleNo,
      cat: item.category,
      catSimple: item.category,
      costPrice: item.costPrice,
      tagPrice: item.tagPrice,
      gp: item.tagPrice > 0 ? ((item.tagPrice - item.costPrice) / item.tagPrice) * 100 : 0,
      ageingDays: item.ageingDays,
      ageTag: item.ageTag,
      baseMetal: item.baseMetal,
      grossWt: parseFloat(item.grossWt) || 0,
      pureWt: parseFloat(item.pureWt) || 0,
      diaWt: parseFloat(item.totDiaWt) || 0,
      imageUrl: item.imageUrl,
      stockType: item.stockType,
      score: item.score,
      reasons: item.reasons,
      thumbUrl: item.imageUrl,
      tier: item.tier || getTier(item.score) || undefined,
      location: item.location,
      scoreBreakdown: item.scoreBreakdown,
    }));

    if (weightMin) {
      const min = parseFloat(weightMin);
      if (!isNaN(min)) items = items.filter((i) => i.grossWt >= min);
    }
    if (weightMax) {
      const max = parseFloat(weightMax);
      if (!isNaN(max)) items = items.filter((i) => i.grossWt <= max);
    }

    return items.slice(0, kitSize * 3);
  }, [generated, aiItems, kitSize, weightMin, weightMax]);

  /* ── Tier buckets ── */
  const tiers = useMemo(() => {
    const RANIWALA_LOCS = ["RANIWALA", "JAIPUR STORE", "DELHI STORE"];
    const isRaniwala = (loc: string | undefined) =>
      loc ? RANIWALA_LOCS.some((r) => loc.toUpperCase().includes(r)) : false;

    // Sort: Raniwala locations first, then by score descending
    const sortByLocation = (items: AssortSuggestion[]) =>
      items.sort((a, b) => {
        const aR = isRaniwala(a.location) ? 0 : 1;
        const bR = isRaniwala(b.location) ? 0 : 1;
        if (aR !== bR) return aR - bR;
        return b.score - a.score;
      });

    const must: AssortSuggestion[] = [];
    const recommended: AssortSuggestion[] = [];
    const optional: AssortSuggestion[] = [];
    for (const item of suggestions) {
      const tier = item.tier || getTier(item.score);
      if (tier === "MUST INCLUDE") must.push(item);
      else if (tier === "RECOMMENDED") recommended.push(item);
      else if (tier === "OPTIONAL") optional.push(item);
    }
    return { must: sortByLocation(must), recommended: sortByLocation(recommended), optional: sortByLocation(optional) };
  }, [suggestions]);

  /* ── Decision stats ── */
  const acceptedCount = Object.values(decisions).filter((d) => d === "accepted").length;
  const rejectedCount = Object.values(decisions).filter((d) => d === "rejected").length;

  const acceptedItems = useMemo(() => {
    return suggestions.filter((s) => decisions[s.jc] === "accepted");
  }, [suggestions, decisions]);

  const totalTagValue = useMemo(() => {
    return acceptedItems.reduce((sum, item) => sum + item.tagPrice, 0);
  }, [acceptedItems]);

  const deadStockCleared = useMemo(() => {
    return acceptedItems.filter((i) => i.ageTag === "Dead Stock").length;
  }, [acceptedItems]);

  /* ── Elapsed timer cleanup ── */
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  /* ── Actions ── */
  async function handleGenerate() {
    setDecisions({});
    setScoringError(null);
    if (localGoldPrice > 0) setGoldPrice(localGoldPrice);

    // Start elapsed timer
    setElapsedSec(0);
    setIsScoring(true);
    timerRef.current = setInterval(() => {
      setElapsedSec(prev => prev + 1);
    }, 1000);

    try {
      const result = await generateAiAssortmentScore({
        bdmName: selectedBdm || "ALL",
        stateName: selectedState || undefined,
        clientName: selectedClient || undefined,
        kitSize,
        weightMin: weightMin ? Number(weightMin) : undefined,
        weightMax: weightMax ? Number(weightMax) : undefined,
      });

      setAiItems(result.items);
      setAiProfile(result.profile);
      setAiTiming(result.timing);
      setGenerated(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setScoringError(msg);
      console.error("[assortment] AI scoring failed:", msg);
    } finally {
      setIsScoring(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }

  function handleDecision(jc: string, decision: "accepted" | "rejected") {
    setDecisions((prev) => ({
      ...prev,
      [jc]: prev[jc] === decision ? undefined : decision,
    }));
  }

  const handleAcceptAll = useCallback(() => {
    const newDecisions: DecisionState = {};
    suggestions.forEach((s) => { newDecisions[s.jc] = "accepted"; });
    setDecisions(newDecisions);
  }, [suggestions]);

  function handleExportCSV() {
    const headers = ["Jewel Code", "Style No", "Category", "Tag Price", "Cost Price", "Ageing Days", "Ageing Tag", "Score", "Tier", "Status"];
    const rows = suggestions.map((s) => [
      s.jc, s.styleNo, s.cat, s.tagPrice, s.costPrice,
      s.ageingDays, s.ageTag, s.score, s.tier || getTier(s.score) || "", decisions[s.jc] || "pending",
    ]);
    downloadCSV("raniwala_smart_assortment_kit.csv", headers, rows);
  }

  function handleFinalizeKit() {
    const kitId = generateKitId();
    const kitItems: KitItem[] = acceptedItems.map((item) => ({
      jewelCode: item.jc,
      styleNo: item.styleNo,
      category: item.cat,
      catSimple: item.catSimple || item.cat,
      location: item.location || "",
      stockType: item.stockType,
      subCat: "",
      makeType: "",
      baseMetal: item.baseMetal,
      costPrice: item.costPrice,
      tagPrice: item.tagPrice,
      gp: item.gp,
      ageingDays: item.ageingDays,
      ageingTag: item.ageTag as "Fresh" | "Watch" | "Slow" | "Dead Stock",
      perfTag: (item.perfTag || "Average") as "Top Seller" | "Fast Moving" | "Average" | "Slow",
      grossWt: item.grossWt,
      pureWt: item.pureWt || 0,
      diaWt: item.diaWt,
      imageUrl: item.imageUrl,
      status: "On Hand" as const,
      clientName: "",
      salesPerson: "",
      _source: "assortment",
    }));

    const kit: DispatchKit = {
      id: kitId,
      kind: mode === "client" ? "exhibition" : "bdm",
      bdm: selectedBdm || "Unassigned",
      state: selectedState || null,
      targetClient: selectedClient || null,
      items: kitItems,
      aiRecommended: kitItems.length,
      manuallyAdded: 0,
      totalValue: totalTagValue,
      avgGP: 0,
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
    setDecisions({});
    setGenerated(false);
    setAiItems([]);
    setAiProfile(null);
    setActivePage("dispatch");
  }

  /* ── Render: BDM Profile Banner ── */
  function renderProfileBanner() {
    if (!aiProfile || !generated) return null;
    return (
      <div
        className="border border-[#D4C9A8] border-t-0 px-5 py-3.5"
        style={{ background: "linear-gradient(135deg, #F5F1E8 0%, #FDFAF4 100%)" }}
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-[#C9A84C] flex items-center justify-center text-white text-[14px] font-bold shrink-0">
            {aiProfile.bdmName.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[9px] tracking-[1.5px] text-[#6B6458] uppercase">AI Profile</span>
              <span className="text-[14px] font-bold text-[#1A1814]">{aiProfile.bdmName}</span>
            </div>
            <div className="text-[12px] text-[#3D3830] mb-2 leading-relaxed">
              &quot;{aiProfile.summary}&quot;
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {aiProfile.preferredCategories.slice(0, 4).map((cat) => (
                <span key={cat} className="bg-white border border-[#D4C9A8] rounded-full px-2.5 py-0.5 text-[10px] font-medium text-[#3A3530]">
                  {cat}
                </span>
              ))}
              {aiProfile.priceRange.sweet_spot > 0 && (
                <span className="bg-[rgba(201,168,76,0.15)] text-[#8B6914] rounded-full px-2.5 py-0.5 text-[10px] font-medium">
                  Sweet spot: {fmt(aiProfile.priceRange.sweet_spot)}
                </span>
              )}
              <span className="text-[10px] text-[#6B6458] ml-auto">
                {aiProfile.totalSalesAnalyzed} sales analyzed
                {aiProfile.embeddedSalesUsed > 0 ? ` \u00B7 ${aiProfile.embeddedSalesUsed} embedded` : ""}
                {aiTiming ? ` \u00B7 ${(aiTiming.totalMs / 1000).toFixed(1)}s (${aiTiming.method})` : ""}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Render: Tier Section ── */
  function groupBySet(items: AssortSuggestion[]): SetGroup[] {
    const roots = new Map<string, AssortSuggestion[]>();
    const noRoot: AssortSuggestion[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const root = pairRoot(item.styleNo);
      if (root) {
        if (!roots.has(root)) roots.set(root, []);
        roots.get(root)!.push(item);
      } else {
        noRoot.push(item);
      }
    }

    const groups: SetGroup[] = [];
    for (const item of items) {
      if (seen.has(item.jc)) continue;
      const root = pairRoot(item.styleNo);
      const siblings = root ? roots.get(root) : null;
      if (siblings && siblings.length >= 2) {
        // Necklace first, earring second
        const sorted = [...siblings].sort((a, b) => {
          const aIsEarring = isEarringHalf(a.styleNo) ? 1 : 0;
          const bIsEarring = isEarringHalf(b.styleNo) ? 1 : 0;
          return aIsEarring - bIsEarring;
        });
        groups.push({ type: "set", items: sorted });
        for (const s of sorted) seen.add(s.jc);
      } else {
        groups.push({ type: "single", items: [item] });
        seen.add(item.jc);
      }
    }
    return groups;
  }

  function renderTierSection(tierKey: "MUST INCLUDE" | "RECOMMENDED" | "OPTIONAL", items: AssortSuggestion[]) {
    if (items.length === 0) return null;
    const cfg = TIER_CONFIG[tierKey];
    const groups = groupBySet(items);
    const accent = tierKey === "MUST INCLUDE" ? "#8B1A1A" : tierKey === "RECOMMENDED" ? "#1A56CC" : "#555";
    return (
      <div className="mb-5">
        {/* Tier header */}
        <div className={cn(
          "flex items-center gap-2.5 px-3.5 py-2.5 rounded-t-md",
          "font-mono text-[10px] tracking-[1.5px] font-medium",
          cfg.cls,
        )}>
          <span>{cfg.label}</span>
          <span className="font-normal opacity-80 text-[11px] ml-1">({items.length} items)</span>
          <span className="ml-auto text-[10px] font-normal opacity-75 hidden md:inline">{cfg.sub}</span>
        </div>
        {/* Card grid with set grouping */}
        <div className="grid gap-3 py-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))" }}>
          {groups.map((group, gi) => {
            if (group.type === "set") {
              return (
                <div
                  key={`set-${gi}`}
                  className="relative flex gap-2 p-2 rounded-lg"
                  style={{
                    gridColumn: "span 2",
                    border: `1.5px dashed ${accent}`,
                    background: `${accent}0A`,
                    marginBottom: 4,
                  }}
                >
                  {/* SET badge */}
                  <div
                    className="absolute -top-2.5 left-3.5 z-10 text-white font-mono text-[9px] font-bold tracking-[1.2px] px-2 py-0.5 rounded"
                    style={{ background: accent }}
                  >
                    SET
                  </div>
                  {group.items.map((item) => (
                    <div key={item.jc} className="flex-1 min-w-0">
                      {renderCard(item)}
                    </div>
                  ))}
                </div>
              );
            }
            return renderCard(group.items[0]);
          })}
        </div>
      </div>
    );
  }

  /* ── Render: Single Card ── */
  function renderCard(item: AssortSuggestion) {
    const state = decisions[item.jc];
    const imgSrc = getDriveImgUrl(item.imageUrl || item.thumbUrl);
    // AI scores are already 0-100
    const score100 = Math.min(100, item.score);
    const reasons: AssortReason[] = Array.isArray(item.reasons)
      ? item.reasons.map((r) => typeof r === "string" ? { tag: r, text: r } : r)
      : [];
    const breakdown = (item as AssortSuggestion & { scoreBreakdown?: AiScoreBreakdown }).scoreBreakdown;

    return (
      <div
        key={item.jc}
        className={cn(
          "relative border rounded-lg overflow-hidden bg-white cursor-pointer transition-all group flex flex-col",
          state === "accepted"
            ? "border-2 border-[#4A7C59] bg-[#E8F5EC]"
            : state === "rejected"
              ? "opacity-40 border-2 border-[#A63C2A]"
              : "border-[#D4C9A8] hover:shadow-[0_2px_12px_rgba(26,24,20,0.08)] hover:-translate-y-px",
        )}
      >
        {/* Image — 140px matching live .assort-card-img */}
        <div className="relative h-[140px] bg-[#F5F1E8] overflow-hidden flex items-center justify-center">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={item.styleNo}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="text-[36px] text-[#D4C9A8]">{"\uD83D\uDC8E"}</div>
          )}

          {/* Location + match badge — top-right */}
          <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1">
            {item.location && (
              <span className="bg-[rgba(74,124,89,0.85)] text-white text-[8.5px] font-medium px-1.5 py-0.5 rounded-full backdrop-blur-sm">
                {item.location}
              </span>
            )}
            <span className="bg-[rgba(74,124,89,0.45)] text-white text-[8px] font-medium px-1.5 py-0.5 rounded-full backdrop-blur-sm">
              {score100}% Match
            </span>
          </div>

          {/* Score breakdown tooltip — top-left */}
          {breakdown && (
            <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="bg-white/95 backdrop-blur-sm rounded px-1.5 py-1 text-[8px] font-mono text-[#3A3530] shadow-sm border border-[#EDE8DC]">
                <div>V:{breakdown.visual} C:{breakdown.category} P:{breakdown.price}</div>
                <div>A:{breakdown.ageing} U:{breakdown.uniqueness}</div>
              </div>
            </div>
          )}

          {/* Accept/Reject overlay — bottom gradient matching live .assort-actions */}
          <div className="absolute bottom-0 left-0 right-0 flex opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }}>
            <button
              onClick={(e) => { e.stopPropagation(); handleDecision(item.jc, "accepted"); }}
              className="flex-1 bg-[rgba(74,124,89,0.9)] text-white border-none cursor-pointer text-[13px] py-2 font-[Jost,sans-serif] hover:bg-[rgba(74,124,89,1)]"
            >
              {"\u2713"} Accept
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDecision(item.jc, "rejected"); }}
              className="flex-1 bg-[rgba(166,60,42,0.9)] text-white border-none cursor-pointer text-[13px] py-2 font-[Jost,sans-serif] hover:bg-[rgba(166,60,42,1)]"
            >
              {"\u2715"} Reject
            </button>
          </div>
        </div>

        {/* Recommended For — client strip matching live .clientStrip */}
        {selectedClient && (
          <div
            className="flex items-center gap-2 px-[11px] py-[7px] shrink-0"
            style={{ background: "#FEF9EE", borderBottom: "2px solid var(--gold, #C9A84C)", minHeight: 44 }}
            title={selectedClient}
          >
            <div className="w-[26px] h-[26px] rounded-full bg-[#C9A84C] flex items-center justify-center text-[10px] font-bold text-white shrink-0">
              {selectedClient.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[7.5px] tracking-[1.5px] text-[#8B6914] uppercase leading-none">Recommended for</div>
              <div className="text-[12px] font-bold text-[#1A1814] leading-tight mt-px truncate">
                {selectedClient.length > 28 ? selectedClient.substring(0, 26) + "\u2026" : selectedClient}
              </div>
            </div>
          </div>
        )}

        {/* Body — matching live .assort-body */}
        <div className="p-[9px] flex flex-col flex-1" onClick={() => setDetailItem(item)}>
          {/* Fixed content */}
          <div>
            {/* Style code + metal pill */}
            {(() => {
              const bm = (item.baseMetal || "").toUpperCase().trim();
              const m = bm.match(/(\d{2})\s*KT?([YWR]?)/);
              const kt = m ? m[1] + "KT" : "";
              const colorMap: Record<string, string> = { Y: "Yellow", W: "White", R: "Rose" };
              const colorName = m && m[2] ? colorMap[m[2]] || "" : "";
              return (
                <>
                  <div className="flex items-center justify-between gap-1.5 mb-0.5">
                    <div className="font-mono text-[10.5px] font-bold text-[#3A3530] tracking-[0.3px] overflow-hidden text-ellipsis whitespace-nowrap" title={item.styleNo || item.jc}>
                      {item.styleNo || item.jc}
                    </div>
                    {kt && (
                      <span className="font-mono text-[9px] font-bold text-white bg-[#4A7C59] px-1.5 py-0.5 rounded tracking-[0.5px] shrink-0">
                        {kt}
                      </span>
                    )}
                  </div>
                  {/* JC code + karat color */}
                  <div className="font-mono text-[9px] text-[#9A9490] tracking-[0.5px] mb-1.5">
                    JC {item.jc}{kt ? ` \u00B7 ${kt}${colorName ? ` ${colorName}` : ""}` : (bm ? ` \u00B7 ${bm}` : "")}
                  </div>
                </>
              );
            })()}
            {/* Divider */}
            <div className="h-px bg-[#EDE8DC] mb-[7px]" />
            {/* Category with label */}
            <div className="mb-[7px]">
              <div className="font-mono text-[7px] tracking-[1.5px] text-[#9A9490] uppercase mb-px">Category</div>
              <div className="text-[14px] font-bold text-[#1A1814] leading-tight">
                {item.cat}
              </div>
            </div>
            {/* Tag Price + Pure Weight — 2-col grid boxes */}
            <div className="grid grid-cols-2 gap-1.5 mb-[7px]">
              <div className="bg-[#FAF7F0] border border-[#EDE8DC] rounded-[5px] px-2 py-[5px]">
                <div className="font-mono text-[7px] tracking-[1.5px] text-[#9A9490] uppercase mb-0.5">Tag Price</div>
                <div className="text-[17px] font-bold text-[#8B6914] leading-none" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {fmt(item.tagPrice)}
                </div>
              </div>
              {item.pureWt ? (
                <div className="bg-[#FAF7F0] border border-[#EDE8DC] rounded-[5px] px-2 py-[5px]">
                  <div className="font-mono text-[7px] tracking-[1.5px] text-[#9A9490] uppercase mb-0.5">Pure Weight</div>
                  <div className="font-mono text-[13px] font-bold text-[#3A3530] leading-none">
                    {item.pureWt.toFixed(2)}g
                  </div>
                </div>
              ) : <div />}
            </div>
          </div>
          {/* Variable content — pushes score bar to bottom */}
          <div className="flex-1 flex flex-col justify-end">
            {/* Score bar — 4px gradient gold->green matching live .score-bar */}
            <div className="h-1 rounded-sm bg-[#EDE7D8] mt-1 overflow-hidden">
              <div
                className="h-full rounded-sm"
                style={{
                  width: `${score100}%`,
                  background: "linear-gradient(90deg, #C9A84C, #4A7C59)",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Main Render ── */
  return (
    <div className="space-y-0">
      {/* Gold line */}
      <div style={{ height: 2, background: "linear-gradient(90deg, #C9A84C, transparent)", marginBottom: 0, borderRadius: 1 }} />

      {/* TOP BAR — mode toggle + stats + gold price + actions */}
      <div className="bg-white border border-[#D4C9A8] rounded-t-lg px-4 py-2.5 flex items-center gap-2.5 flex-wrap"
        style={{ borderBottom: "2px solid #C9A84C" }}>
        {/* Mode Toggle — matching live .view-toggle */}
        <div className="flex border border-[#D4C9A8] rounded overflow-hidden">
          {([
            { key: "client" as Mode, label: "\uD83C\uDFAA Exhibition" },
            { key: "location" as Mode, label: "\uD83D\uDCCD By Location" },
            { key: "bdmstate" as Mode, label: "\uD83D\uDC64 BDM" },
          ]).map((m, i) => (
            <button
              key={m.key}
              onClick={() => { setMode(m.key); setGenerated(false); setDecisions({}); setAiItems([]); setAiProfile(null); }}
              className={cn(
                "px-3.5 py-2 text-[12.5px] border-none cursor-pointer transition-colors",
                i > 0 && "border-l border-l-[#D4C9A8]",
                mode === m.key
                  ? "bg-[#C9A84C] text-[#1A1814] font-medium"
                  : "bg-white text-[#6B6458] hover:bg-[#F5F1E8]",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Kit stat pills — matching live .kit-stat-pill */}
        <div className="bg-[#F5F1E8] border border-[#D4C9A8] rounded-md px-3.5 py-1.5 text-center">
          <div className="text-[20px] text-[#1A1814]" style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.3px" }}>
            {acceptedCount}
          </div>
          <div className="font-mono text-[8.5px] text-[#6B6458] tracking-wider uppercase">Accepted</div>
        </div>
        <div className="bg-[#F5F1E8] border border-[#D4C9A8] rounded-md px-3.5 py-1.5 text-center">
          <div className="text-[20px] text-[#1A1814]" style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.3px" }}>
            {rejectedCount}
          </div>
          <div className="font-mono text-[8.5px] text-[#6B6458] tracking-wider uppercase">Rejected</div>
        </div>

        {/* Gold price input — matching live gold price control */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 border border-[#C9A84C] bg-[#FDFAF4] rounded"
          title="Selling Price = (Tag Price / 2) + (Pure Wt x Gold Price)">
          <span className="font-mono text-[9.5px] tracking-wider text-[#6B5314]">{"\uD83D\uDCB0"} GOLD {"\u20B9"}</span>
          <input
            type="number"
            min={0}
            step={100}
            placeholder="0"
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

        {/* Action buttons — right side */}
        <div className="ml-auto flex gap-2">
          {generated && (
            <button
              onClick={handleAcceptAll}
              className="px-3 py-1.5 border border-[#D4C9A8] rounded text-[11.5px] text-[#6B6458] bg-transparent hover:border-[#C9A84C] hover:text-[#C9A84C] transition-colors"
            >
              {"\u2713"} Accept All
            </button>
          )}
          {generated && (
            <button
              onClick={handleExportCSV}
              className="px-3 py-1.5 border border-[#D4C9A8] rounded text-[11.5px] text-[#6B6458] bg-transparent hover:border-[#C9A84C] hover:text-[#C9A84C] transition-colors"
            >
              {"\u2B07"} CSV
            </button>
          )}
        </div>
      </div>

      {/* CONFIG ROW — mode-specific panels */}
      <div className="bg-[#F5F1E8] border border-[#D4C9A8] border-t-0 px-4 py-3 flex gap-3 items-start flex-wrap">
        {/* BDM + State mode panel */}
        {mode === "bdmstate" && (
          <div className="flex gap-2.5 items-center flex-wrap">
            <select
              value={selectedBdm}
              onChange={(e) => { setSelectedBdm(e.target.value); setSelectedState(""); setSelectedClient(""); }}
              className="min-w-[180px] px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none"
            >
              <option value="">{"\u2014"} Select BDM {"\u2014"}</option>
              {effectiveBdmKeys.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              disabled={!selectedBdm}
              className="min-w-[200px] px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none disabled:opacity-50"
            >
              <option value="">{"\u2014"} Select State {"\u2014"}</option>
              {effectiveStates.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              disabled={!selectedBdm}
              className="min-w-[200px] px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none disabled:opacity-50"
            >
              <option value="">{"\u2014"} Target Client (optional) {"\u2014"}</option>
              {effectiveClients.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} {"\u2014"} {fmt(c.spend || 0)} ({c.count} txns)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Exhibition mode panel */}
        {mode === "client" && (
          <div className="flex gap-2.5 items-center flex-wrap">
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="min-w-[200px] px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none"
            >
              <option value="">{"\u2014"} Select Client {"\u2014"}</option>
              {(DATA.assortClients || []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} {"\u2014"} {fmt(c.spend || 0)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Location mode panel */}
        {mode === "location" && (
          <div className="flex gap-2.5 items-center flex-wrap">
            <select
              className="min-w-[180px] px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none"
            >
              <option value="">{"\u2014"} Select Destination {"\u2014"}</option>
              <option value="DELHI STORE">DELHI STORE</option>
              <option value="JAIPUR STORE L3">JAIPUR STORE L3</option>
            </select>
            <select className="min-w-[180px] px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none">
              <option>Source: Main Store (Jaipur)</option>
            </select>
          </div>
        )}

        {/* Right-side sliders + weight — matching live controls */}
        <div className="flex gap-3.5 items-center flex-wrap ml-auto">
          <div className="text-[12px] text-[#3D3830]">
            Kit size: <strong>{kitSize}</strong>{" "}
            <input
              type="range"
              min={20}
              max={200}
              value={kitSize}
              onChange={(e) => setKitSize(Number(e.target.value))}
              className="w-[120px] align-middle"
              style={{ accentColor: "#C9A84C" }}
            />
          </div>
          <div className="text-[12px] text-[#3D3830]">
            Clearance: <strong>{clearancePct}%</strong>{" "}
            <input
              type="range"
              min={0}
              max={70}
              value={clearancePct}
              onChange={(e) => setClearancePct(Number(e.target.value))}
              className="w-[80px] align-middle"
              style={{ accentColor: "#C9A84C" }}
            />
          </div>
          {/* Weight filter — DM Mono matching live */}
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 border border-[#D4C9A8] bg-[#F5F1E8] rounded"
            title="Filter by Pure Weight (grams)">
            <span className="font-mono text-[9px] tracking-wider text-[#6B6458]">{"\u2696"} WT (g)</span>
            <input
              type="number"
              placeholder="Min"
              value={weightMin}
              onChange={(e) => setWeightMin(e.target.value)}
              className="w-[52px] px-1.5 py-0.5 border border-[#D4C9A8] rounded font-mono text-[11px] bg-white focus:border-[#C9A84C] outline-none"
            />
            <span className="text-[10px] text-[#6B6458]">{"\u2013"}</span>
            <input
              type="number"
              placeholder="Max"
              value={weightMax}
              onChange={(e) => setWeightMax(e.target.value)}
              className="w-[52px] px-1.5 py-0.5 border border-[#D4C9A8] rounded font-mono text-[11px] bg-white focus:border-[#C9A84C] outline-none"
            />
          </div>
        </div>
      </div>

      {/* AI Profile Banner */}
      {renderProfileBanner()}

      {/* GENERATE BUTTON / LOADING STATE */}
      {!generated && !isScoring && (
        <div className="bg-white border border-[#D4C9A8] border-t-0 min-h-[400px] flex flex-col items-center justify-center p-12">
          {mode === "bdmstate" && (
            <>
              <div className="text-[40px] mb-3">{"\uD83E\uDDE0"}</div>
              <div className="text-[15px] font-medium text-[#1A1814] mb-2">AI-Powered BDM Assortment</div>
              <div className="text-[12.5px] text-[#6B6458] max-w-[500px] text-center mb-6">
                Select a BDM and state {"\u2014"} Gemini Vision will analyse their past sales images, build a style profile, and score every inventory item against it
              </div>
            </>
          )}
          {mode === "client" && (
            <>
              <div className="text-[40px] mb-3">{"\uD83C\uDFAA"}</div>
              <div className="text-[15px] font-medium text-[#1A1814] mb-2">Select a client for exhibition kit</div>
              <div className="text-[12.5px] text-[#6B6458] max-w-[500px] text-center mb-6">
                The engine will score every item against the client's purchase history, price band, categories and ageing urgency
              </div>
            </>
          )}
          {mode === "location" && (
            <>
              <div className="text-[40px] mb-3">{"\uD83D\uDCCD"}</div>
              <div className="text-[15px] font-medium text-[#1A1814] mb-2">Select a destination store</div>
              <div className="text-[12.5px] text-[#6B6458] max-w-[500px] text-center mb-6">
                The engine analyses the store's sales velocity by category and suggests which items from the main store to dispatch
              </div>
            </>
          )}

          {scoringError && (
            <div className="bg-[#FDEAEA] border border-[#f5c6c6] text-[#8B1A1A] rounded px-4 py-2.5 text-[12px] mb-4 max-w-[500px] text-center">
              AI scoring failed: {scoringError}. Try again or adjust filters.
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={isScoring}
            className="px-5 py-2.5 bg-[#C9A84C] text-[#1A1814] text-[12.5px] font-medium rounded hover:bg-[#8B6914] hover:text-white transition-colors disabled:opacity-50"
          >
            Generate AI Assortment
          </button>
        </div>
      )}

      {/* AI SCORING LOADING STATE */}
      {isScoring && (
        <div className="bg-white border border-[#D4C9A8] border-t-0 min-h-[400px] flex flex-col items-center justify-center p-12">
          {/* Animated spinner */}
          <div className="relative w-16 h-16 mb-6">
            <div className="absolute inset-0 border-4 border-[#EDE8DC] rounded-full" />
            <div className="absolute inset-0 border-4 border-transparent border-t-[#C9A84C] rounded-full animate-spin" />
          </div>
          <div className="text-[15px] font-medium text-[#1A1814] mb-2">AI is analyzing and scoring inventory...</div>
          <div className="text-[12.5px] text-[#6B6458] max-w-[500px] text-center mb-3">
            {selectedBdm
              ? `Building style profile from ${selectedBdm}'s past B2B sales${selectedState ? ` in ${selectedState}` : ""}, then scoring each inventory item against it`
              : "Scoring inventory items..."}
          </div>
          <div className="font-mono text-[24px] text-[#C9A84C] font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>
            {elapsedSec}s
          </div>
          <div className="font-mono text-[9px] text-[#9A9490] tracking-wider mt-1">ELAPSED</div>
        </div>
      )}

      {/* RESULTS — tier sections */}
      {generated && !isScoring && (
        <div className="bg-white border border-[#D4C9A8] border-t-0 min-h-[400px] p-5 pb-4">
          {renderTierSection("MUST INCLUDE", tiers.must)}
          {renderTierSection("RECOMMENDED", tiers.recommended)}
          {renderTierSection("OPTIONAL", tiers.optional)}

          {suggestions.length === 0 && (
            <div className="text-center py-12 text-[#6B6458] text-[14px]">
              No items found for this filter combination. Adjust weight range or kit size.
            </div>
          )}
        </div>
      )}

      {/* STICKY FOOTER — matching live #ap-footer */}
      {generated && !isScoring && (
        <div
          className="sticky bottom-0 z-10 border border-[#D4C9A8] rounded-b-lg px-5 py-3.5 flex items-center gap-3.5 flex-wrap"
          style={{
            background: "linear-gradient(to top, #FDFAF4 0%, rgba(253,250,244,0.95) 100%)",
            borderTop: "2px solid #C9A84C",
            boxShadow: "0 -4px 12px rgba(26,24,20,0.05)",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9.5px] tracking-[1.5px] text-[#6B6458]">READY FOR CATALOGUE</span>
          </div>
          <div className="flex gap-2.5">
            <div className="bg-white border border-[#D4C9A8] rounded-md px-2.5 py-1">
              <span className="font-mono text-[8.5px] tracking-wider text-[#6B6458]">ACCEPTED</span>
              <strong className="text-[17px] text-[#4A7C59] ml-1" style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.3px" }}>
                {acceptedCount}
              </strong>
            </div>
            <div className="bg-white border border-[#D4C9A8] rounded-md px-2.5 py-1">
              <span className="font-mono text-[8.5px] tracking-wider text-[#6B6458]">TAG VALUE</span>
              <strong className="text-[17px] text-[#8B6914] ml-1" style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.3px" }}>
                {fmt(totalTagValue)}
              </strong>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11.5px] text-[#3D3830]">Review the recommendations above, then proceed {"\u2192"}</span>
            <button
              onClick={handleFinalizeKit}
              disabled={acceptedCount === 0}
              className={cn(
                "px-5 py-2.5 rounded text-[13.5px] font-semibold transition-colors",
                acceptedCount > 0
                  ? "bg-[#C9A84C] text-[#1A1814] hover:bg-[#8B6914] hover:text-white"
                  : "bg-[#D4C9A8] text-[#6B6458] cursor-not-allowed",
              )}
            >
              Next: Visual Catalogue {"\u2192"}
            </button>
          </div>
        </div>
      )}

      {/* ITEM DETAIL MODAL — matching live showAssortItemDetail */}
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
              {getDriveImgUrl(detailItem.imageUrl || detailItem.thumbUrl) ? (
                <img
                  src={getDriveImgUrl(detailItem.imageUrl || detailItem.thumbUrl)}
                  alt={detailItem.styleNo}
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
                  {detailItem.styleNo || detailItem.jc}
                </div>
                <div className="text-[20px] font-medium" style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.3px" }}>
                  {detailItem.catSimple || detailItem.cat}
                </div>
                <div className="text-[26px] text-[#8B6914]" style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.3px" }}>
                  {fmt(detailItem.tagPrice)}
                </div>
              </div>

              {/* AI SCORE BREAKDOWN */}
              {(detailItem as AssortSuggestion & { scoreBreakdown?: AiScoreBreakdown }).scoreBreakdown && (
                <div className="bg-[#FDFAF4] border border-[#EDE8DC] rounded-md p-2.5 mb-3">
                  <div className="font-mono text-[9px] text-[#6B6458] tracking-[1.5px] mb-2">AI SCORE BREAKDOWN</div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[24px] font-bold text-[#C9A84C]" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {detailItem.score}
                    </span>
                    <span className="text-[11px] text-[#6B6458]">/ 100</span>
                  </div>
                  {(() => {
                    const bd = (detailItem as AssortSuggestion & { scoreBreakdown?: AiScoreBreakdown }).scoreBreakdown!;
                    const dims = [
                      { label: "Visual Style", val: bd.visual, max: 35, color: "#1A56CC" },
                      { label: "Category Fit", val: bd.category, max: 20, color: "#5B21B6" },
                      { label: "Price Fit", val: bd.price, max: 15, color: "#8B6914" },
                      { label: "Ageing Urgency", val: bd.ageing, max: 20, color: "#8B1A1A" },
                      { label: "Uniqueness", val: bd.uniqueness, max: 10, color: "#166534" },
                    ];
                    return dims.map((d) => (
                      <div key={d.label} className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-[8px] text-[#6B6458] w-[75px] shrink-0">{d.label}</span>
                        <div className="flex-1 h-1.5 bg-[#EDE8DC] rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(d.val / d.max) * 100}%`, background: d.color }} />
                        </div>
                        <span className="font-mono text-[9px] text-[#3A3530] w-[28px] text-right">{d.val}/{d.max}</span>
                      </div>
                    ));
                  })()}
                </div>
              )}

              {/* WHY RECOMMENDED */}
              {detailItem.reasons.length > 0 && (
                <div className="bg-[#F5F1E8] rounded-md p-2.5 mb-3">
                  <div className="font-mono text-[9px] text-[#6B6458] tracking-[1.5px] mb-1.5">WHY RECOMMENDED</div>
                  {detailItem.reasons.map((r, i) => {
                    const reason = typeof r === "string" ? { tag: r, text: r } : r;
                    const pill = REASON_PILL[reason.tag] || REASON_PILL.new;
                    return (
                      <div key={i} className="flex items-start gap-1.5 mb-1">
                        <span className={cn("text-[9px] px-1.5 py-px rounded-[10px] font-medium shrink-0", pill.cls)}>
                          {reason.tag}
                        </span>
                        <span className="text-[12px] text-[#3D3830]">{reason.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-2.5 mb-3.5">
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">TAG PRICE</div>
                  <div className="text-[#8B6914]" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(detailItem.tagPrice)}</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">BASE METAL</div>
                  <div>{detailItem.baseMetal || "\u2014"}</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">PURE WT</div>
                  <div>{detailItem.pureWt != null ? Number(detailItem.pureWt).toFixed(2) : "\u2014"} gm</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">GROSS WT</div>
                  <div>{detailItem.grossWt || 0} gm</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">DIAMOND WT</div>
                  <div>{detailItem.diaWt || 0} cts</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] tracking-wider text-[#6B6458]">JEWEL CODE</div>
                  <div className="font-mono text-[11px]">{detailItem.jc}</div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => { handleDecision(detailItem.jc, "accepted"); setDetailItem(null); }}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-[#C9A84C] text-[#1A1814] rounded text-[12.5px] font-medium hover:bg-[#8B6914] hover:text-white transition-colors"
                >
                  {"\u2713"} Accept
                </button>
                <button
                  onClick={() => { handleDecision(detailItem.jc, "rejected"); setDetailItem(null); }}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-[#FDEAEA] text-[#A63C2A] border border-[#f5c6c6] rounded text-[12.5px] font-medium hover:bg-[#A63C2A] hover:text-white transition-colors"
                >
                  {"\u2715"} Reject
                </button>
                <button
                  onClick={() => setDetailItem(null)}
                  className="px-3 py-2 border border-[#D4C9A8] rounded text-[12.5px] text-[#6B6458] hover:border-[#C9A84C] hover:text-[#C9A84C] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
