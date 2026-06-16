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
  fetchStockCategories,
  fetchExhibitionList,
  generateExhibitionScore,
  fetchLocations,
  generateLocationScore,
  fetchAssortmentSalesPeriods,
} from "@/lib/api";
import type { AiScoredItem, AiScoreProfile, AiScoreBreakdown, ScoringWeights } from "@/lib/api";

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

function getTier(score: number): "MUST INCLUDE" | "RECOMMENDED" | "OPTIONAL" | null {
  if (score >= 65) return "MUST INCLUDE";
  if (score >= 40) return "RECOMMENDED";
  if (score >= 20) return "OPTIONAL";
  return null;
}

/* ── Product segment from style code ── */
const PRODUCT_SEGMENTS = [
  "Bridal", "Bridal Lite", "Traditional", "Modern", "RTW",
  "Ear Essentials", "Handwear", "Add-ons", "Exclusive - Grandeur",
] as const;
function getSegmentFromStyle(styleNo: string | undefined, cat?: string): string {
  if (!styleNo) return "Traditional";
  const u = styleNo.toUpperCase();
  const c = (cat || "").toLowerCase();
  // Theme-code based mapping
  if (u.includes("BRP") || u.includes("BRU")) return "Bridal";
  if (u.includes("BRC")) return "Bridal Lite";
  if (u.includes("SOP") || u.includes("SOLP")) return "Exclusive - Grandeur";
  if (u.includes("WRD") || u.includes("SOO") || u.includes("SOD")) {
    // Subcategorize Modern by category
    if (c.includes("chain") || c.includes("pendant")) return "RTW";
    if (c.includes("earring") || c.includes("stud") || c.includes("drop") || c.includes("hoop")) return "Ear Essentials";
    if (c.includes("bracelet") || c.includes("bangle") || c.includes("hathphool") || c.includes("ring")) return "Handwear";
    if (c.includes("nosepin") || c.includes("nath") || c.includes("mangtika") || c.includes("brooch") || c.includes("button") || c.includes("kalingi") || c.includes("kanauti") || c.includes("mala")) return "Add-ons";
    return "Modern";
  }
  if (u.includes("CLO") || u.includes("CLP") || u.includes("WRO")) return "Traditional";
  return "Traditional";
}

/* ── Clearance detection ── */
function isClearance(i: { ageTag: string; ageingDays: number }): boolean {
  return i.ageTag === "Slow Moving" || i.ageTag === "Ageing" || i.ageTag === "Non-Moving" ||
    i.ageTag === "Slow" || i.ageTag === "Dead Stock" || i.ageingDays > 90;
}

/* ── Set pairing: group necklace + earring by shared design prefix ── */
// Set suffixes: LNS/LNSE, NS/NSE, CHS/CHSE, PNS/PNSE, CNS/CNSE.
// Variant suffixes (-1, -2) are kept as part of the root so that
// LNS-1 pairs only with LNSE-1, NOT with LNS-2 or LNSE-2.
const SET_SUFFIX_RE = /^(.*?)(NLSE|LNSE|CHSE|PNSE|CNSE|NSE|NLS|LNS|CHS|PNS|CNS|NS|CS)(-\d+)?$/;

function pairRoot(styleCode: string | undefined): string | null {
  if (!styleCode) return null;
  const s = styleCode.toUpperCase().trim();
  const m = s.match(SET_SUFFIX_RE);
  if (!m) return null;
  // Include variant in root: "OQCLO47111" + "-1" → "OQCLO47111-1"
  return m[1] + (m[3] || "");
}

function isEarringHalf(styleCode: string | undefined): boolean {
  if (!styleCode) return false;
  return /(NLSE|LNSE|CHSE|PNSE|CNSE|NSE)(-\d+)?$/.test(styleCode.toUpperCase().trim());
}

interface SetGroup {
  type: "single" | "set";
  items: AssortSuggestion[];
  standaloneFromSet?: boolean;
}

interface DecisionState {
  [jc: string]: "accepted" | "rejected" | undefined;
}

/* ── Reusable checkbox multiselect dropdown (page-styled) ── */
function MultiSelectDropdown({
  label, options, selected, onChange, disabled, emptyText,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const toggle = (val: string) =>
    onChange(selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val]);

  const summary = selected.length === 0 ? label : `${label}: ${selected.length}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "px-2.5 py-1.5 border rounded bg-white text-[12.5px] outline-none flex items-center gap-1.5 min-w-[110px] disabled:opacity-50",
          selected.length > 0 ? "border-[#C9A84C]" : "border-[#D4C9A8]",
        )}
      >
        <span className={selected.length > 0 ? "font-medium text-[#1A1814]" : "text-[#6B6458]"}>{summary}</span>
        <span className="ml-auto text-[8px] text-[#9A9490]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 min-w-[170px] max-h-[260px] overflow-auto bg-white border border-[#D4C9A8] rounded shadow-lg p-1">
          {options.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-[#9A9490]">{emptyText || "No options"}</div>
          ) : (
            <>
              <div className="flex justify-between px-1.5 py-1 border-b border-[#EDE8DC] mb-1">
                <button type="button" className="text-[10px] text-[#8B6914] hover:underline" onClick={() => onChange(options.map((o) => o.value))}>
                  Select all
                </button>
                <button type="button" className="text-[10px] text-[#6B6458] hover:underline" onClick={() => onChange([])}>
                  Clear
                </button>
              </div>
              {options.map((o) => (
                <label key={o.value} className="flex items-center gap-2 px-2 py-1 hover:bg-[#F5F1E8] rounded cursor-pointer text-[12px] text-[#3A3530]">
                  <input
                    type="checkbox"
                    checked={selected.includes(o.value)}
                    onChange={() => toggle(o.value)}
                    style={{ accentColor: "#C9A84C" }}
                  />
                  {o.label}
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
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
  const [scoringWeights, setScoringWeights] = useState<ScoringWeights>({ segment: 30, category: 25, visual: 25, price: 20 });
  const [metalWtMax, setMetalWtMax] = useState(100);
  const [selectedSegment, setSelectedSegment] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  /* ── Sales-period scope (Month/Year multiselect) — BDM mode only ── */
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [weightMin, setWeightMin] = useState("");
  const [weightMax, setWeightMax] = useState("");
  const [localGoldPrice, setLocalGoldPrice] = useState(goldPrice || 0);
  /* ── Exhibition state ── */
  const [selectedExhibition, setSelectedExhibition] = useState("all");
  /* ── Location state ── */
  const [selectedDestination, setSelectedDestination] = useState("");
  const [generated, setGenerated] = useState(false);
  const [decisions, setDecisions] = useState<DecisionState>({});
  const [detailItem, setDetailItem] = useState<AssortSuggestion | null>(null);

  /* ── AI scoring state ── */
  const [isScoring, setIsScoring] = useState(false);
  const [scoringError, setScoringError] = useState<string | null>(null);
  const [aiItems, setAiItems] = useState<AiScoredItem[]>([]);
  const [aiProfile, setAiProfile] = useState<AiScoreProfile | null>(null);
  const [aiTiming, setAiTiming] = useState<{ totalMs: number; method: "vector" | "formula" } | null>(null);

  /** Reset results when any filter changes — shows generate button again */
  const resetResults = useCallback(() => {
    if (generated) {
      setGenerated(false);
      setDecisions({});
      setAiItems([]);
      setAiProfile(null);
      setAiTiming(null);
      setScoringError(null);
    }
  }, [generated]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Auto-switch weights when client selected/deselected ── */
  useEffect(() => {
    if (selectedClient) {
      setScoringWeights({ segment: 25, category: 20, visual: 25, price: 30 });
    } else {
      setScoringWeights({ segment: 30, category: 25, visual: 25, price: 20 });
    }
  }, [selectedClient]);

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
    queryKey: ["b2b-bdm-clients", selectedBdm, selectedState],
    queryFn: () => fetchB2bClientsForBdm(selectedBdm, selectedState || undefined),
    enabled: !!selectedBdm && !!selectedState,
  });
  const clientsForBdm = clientsData?.clients || [];

  /* ── Available sale periods (months/years) for the selected BDM ── */
  const { data: salesPeriodsData } = useQuery({
    queryKey: ["assortment-sales-periods", selectedBdm, selectedState, selectedClient],
    queryFn: () => fetchAssortmentSalesPeriods(selectedBdm, selectedState || undefined, selectedClient || undefined),
    enabled: mode === "bdmstate" && !!selectedBdm,
  });
  const availableMonths = salesPeriodsData?.months || [];
  const availableYears = salesPeriodsData?.years || [];

  /* ── Exhibition list ── */
  const { data: exhibitionListData } = useQuery({
    queryKey: ["exhibition-list"],
    queryFn: fetchExhibitionList,
    enabled: mode === "client",
  });
  const exhibitions = exhibitionListData?.exhibitions || [];

  /* ── Location list ── */
  const { data: locationListData } = useQuery({
    queryKey: ["location-list"],
    queryFn: fetchLocations,
    enabled: mode === "location",
  });
  const locations = locationListData?.locations || [];

  /* ── Fallback to static DATA when B2B not yet imported ── */
  const bdmStatesMap = DATA.bdmStates as Record<string, { name: string; states: readonly string[]; totalRevenue: number; txnCount: number }>;
  const fallbackBdmKeys = useMemo(() => Object.keys(bdmStatesMap), []);
  const effectiveBdmKeys = bdmKeys.length > 0 ? bdmKeys : fallbackBdmKeys;
  const effectiveStates = statesForBdm.length > 0 ? statesForBdm : (selectedBdm && bdmStatesMap[selectedBdm] ? [...bdmStatesMap[selectedBdm].states] : []);
  const effectiveClients = clientsForBdm.length > 0 ? clientsForBdm : (DATA.assortClients || []).map(c => ({ name: c.name, spend: c.spend || 0, count: c.txns || 0 }));

  /* ── Convert AI items to AssortSuggestion ── */
  const suggestions = useMemo((): AssortSuggestion[] => {
    if (!generated || aiItems.length === 0) return [];

    let items: AssortSuggestion[] = aiItems.map((item) => {
      // Client-side re-score: breakdown values are raw 0-1 norms from server.
      // Multiply each by the user's weight slider to get weighted total (0-100).
      // Skip re-weighting for exhibition mode (breakdowns are zeroed, score is pre-computed).
      const bd = item.scoreBreakdown;
      let reweightedScore = item.score;
      if (bd && mode === "bdmstate") {
        reweightedScore = Math.round(
          bd.segment * scoringWeights.segment +
          bd.category * scoringWeights.category +
          bd.visual * scoringWeights.visual +
          bd.price * scoringWeights.price
        + (bd.bonus || 0)
        );
        reweightedScore = Math.max(0, Math.min(100, reweightedScore));
      }
      return {
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
        score: reweightedScore,
        reasons: item.reasons,
        thumbUrl: item.imageUrl,
        tier: getTier(reweightedScore) || undefined,
        location: item.location,
        scoreBreakdown: item.scoreBreakdown,
        targetClient: item.targetClient,
      };
    });

    if (weightMin) {
      const min = parseFloat(weightMin);
      if (!isNaN(min)) items = items.filter((i) => i.grossWt >= min);
    }
    if (weightMax) {
      const max = parseFloat(weightMax);
      if (!isNaN(max)) items = items.filter((i) => i.grossWt <= max);
    }

    // Filter by pure metal weight (grams)
    if (metalWtMax < 100) {
      items = items.filter((i) => (i.pureWt || 0) <= metalWtMax);
    }

    // Filter by product segment (derived from style code)
    if (selectedSegment) {
      items = items.filter((i) => getSegmentFromStyle(i.styleNo, i.cat) === selectedSegment);
    }

    // Filter by category
    if (selectedCategory) {
      items = items.filter((i) => i.cat === selectedCategory);
    }

    // Cap clearance items to clearancePct% of kitSize
    if (clearancePct < 70) {
      const maxClearance = Math.ceil((kitSize * clearancePct) / 100);
      const clearanceItems: typeof items = [];
      const freshItems: typeof items = [];
      for (const i of items) {
        if (isClearance(i)) {
          clearanceItems.push(i);
        } else {
          freshItems.push(i);
        }
      }
      const cappedClearance = clearanceItems.slice(0, maxClearance);
      const freshNeeded = kitSize - cappedClearance.length;
      // Merge: fresh first (higher priority), then clearance, maintaining score order
      items = [...freshItems.slice(0, freshNeeded), ...cappedClearance];
      // Re-sort by score descending so tier bucketing stays correct
      items.sort((a, b) => b.score - a.score);
    }

    return items.slice(0, kitSize);
  }, [generated, aiItems, kitSize, weightMin, weightMax, clearancePct, metalWtMax, selectedSegment, selectedCategory, scoringWeights]);

  /* ── Stock categories (pre-populated from live stock) ── */
  const { data: stockCatsData } = useQuery({
    queryKey: ["stock-categories"],
    queryFn: fetchStockCategories,
  });

  /* ── Available categories: merge stock categories + scored item categories ── */
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const c of stockCatsData?.categories || []) cats.add(c);
    for (const i of aiItems) { if (i.category) cats.add(i.category); }
    return Array.from(cats).sort();
  }, [aiItems, stockCatsData]);

  /* ── Section layout: Best Matches, Clearance, Segment Clusters ── */
  const sections = useMemo(() => {
    // 1. BEST MATCHES: top-1 item per product segment, score >= 75
    const segmentBest = new Map<string, AssortSuggestion>();
    for (const item of suggestions) {
      const seg = getSegmentFromStyle(item.styleNo, item.cat);
      const existing = segmentBest.get(seg);
      if (!existing || item.score > existing.score) {
        segmentBest.set(seg, item);
      }
    }
    const bestMatchesBase = Array.from(segmentBest.values())
      .filter(i => i.score >= 55)
      .sort((a, b) => b.score - a.score);

    // Build a lookup: pairRoot → all suggestions with that root
    const rootToItems = new Map<string, AssortSuggestion[]>();
    for (const item of suggestions) {
      const root = pairRoot(item.styleNo);
      if (root) {
        if (!rootToItems.has(root)) rootToItems.set(root, []);
        rootToItems.get(root)!.push(item);
      }
    }

    // Pull set partners into Best Matches
    const bestIds = new Set(bestMatchesBase.map(i => i.jc));
    const bestMatches = [...bestMatchesBase];
    for (const item of bestMatchesBase) {
      const root = pairRoot(item.styleNo);
      if (!root) continue;
      const partners = rootToItems.get(root);
      if (!partners) continue;
      for (const p of partners) {
        if (!bestIds.has(p.jc)) {
          bestMatches.push(p);
          bestIds.add(p.jc);
        }
      }
    }

    // 2. CLEARANCE: aged items excluding best matches
    const clearanceBase = suggestions
      .filter(i => !bestIds.has(i.jc) && isClearance(i))
      .sort((a, b) => b.score - a.score);

    // Pull set partners into Clearance
    const clearanceIds = new Set(clearanceBase.map(i => i.jc));
    const clearanceItems = [...clearanceBase];
    for (const item of clearanceBase) {
      const root = pairRoot(item.styleNo);
      if (!root) continue;
      const partners = rootToItems.get(root);
      if (!partners) continue;
      for (const p of partners) {
        if (!bestIds.has(p.jc) && !clearanceIds.has(p.jc)) {
          clearanceItems.push(p);
          clearanceIds.add(p.jc);
        }
      }
    }
    clearanceItems.sort((a, b) => b.score - a.score);

    // 3. SEGMENT CLUSTERS: remaining items grouped by product segment
    const usedIds = new Set(Array.from(bestIds).concat(Array.from(clearanceIds)));
    const remaining = suggestions.filter(i => !usedIds.has(i.jc));

    const segGroups = new Map<string, AssortSuggestion[]>();
    for (const item of remaining) {
      const seg = getSegmentFromStyle(item.styleNo, item.cat);
      if (!segGroups.has(seg)) segGroups.set(seg, []);
      segGroups.get(seg)!.push(item);
    }
    Array.from(segGroups.values()).forEach(items => {
      items.sort((a, b) => b.score - a.score);
    });
    const segments: [string, AssortSuggestion[]][] = Array.from(segGroups.entries())
      .sort((a, b) => b[1].length - a[1].length);

    return { bestMatches, clearanceItems, segments };
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
    return acceptedItems.filter((i) => i.ageTag === "Slow Moving" || i.ageTag === "Ageing" || i.ageTag === "Non-Moving").length;
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
      if (mode === "client") {
        // Exhibition mode: use exhibition scoring endpoint
        const result = await generateExhibitionScore(selectedExhibition, kitSize);
        setAiItems(result.items);
        setAiProfile(null);
        setAiTiming(null);
        setGenerated(true);
      } else if (mode === "location") {
        // Location mode: dedicated location scoring endpoint
        const result = await generateLocationScore(selectedDestination, kitSize);
        setAiItems(result.items);
        setAiProfile(result.profile);
        setAiTiming(result.timing);
        setGenerated(true);
      } else {
        // BDM mode: existing flow
        const result = await generateAiAssortmentScore({
          bdmName: selectedBdm || "ALL",
          stateName: selectedState || undefined,
          clientName: selectedClient || undefined,
          kitSize,
          weightMin: weightMin ? Number(weightMin) : undefined,
          weightMax: weightMax ? Number(weightMax) : undefined,
          weights: scoringWeights,
          months: selectedMonths.length > 0 ? selectedMonths : undefined,
          years: selectedYears.length > 0 ? selectedYears.map(Number) : undefined,
        });
        setAiItems(result.items);
        setAiProfile(result.profile);
        setAiTiming(result.timing);
        setGenerated(true);
      }
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
      ageingTag: item.ageTag as "Fresh" | "Active" | "Moderate" | "Slow Moving" | "Ageing" | "Non-Moving",
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
      kind: mode === "client" ? "exhibition" : mode === "location" ? "location" : "bdm",
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
      notes: mode === "client"
        ? `Exhibition kit (${selectedExhibition}) with ${kitItems.length} items`
        : mode === "location"
        ? `Location kit (${selectedDestination}) with ${kitItems.length} items`
        : `BDM kit with ${kitItems.length} items`,
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
        {/* Client preferences sub-banner */}
        {aiProfile.clientPreferences && (
          <div className="border border-[#D4C9A8] border-t-0 px-5 py-3" style={{ background: "linear-gradient(135deg, #F0EDE4 0%, #FAF8F2 100%)" }}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-mono text-[9px] tracking-[1.5px] text-[#6B6458] uppercase">Client Profile</span>
              <span className="text-[13px] font-bold text-[#1A1814]">{aiProfile.clientPreferences.clientName}</span>
              <span className="text-[10px] text-[#6B6458]">{aiProfile.clientPreferences.totalTransactions} transactions</span>
            </div>
            <div className="flex flex-wrap gap-1.5 items-center mb-1.5">
              <span className="text-[9px] text-[#6B6458] font-mono mr-1">SEGMENTS</span>
              {aiProfile.clientPreferences.primarySegments.map(seg => (
                <span key={seg} className="bg-[#E8F0FE] text-[#1A56CC] rounded-full px-2 py-0.5 text-[9px] font-medium">{seg}</span>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-[10px] text-[#3D3830]">
              <span>Price: {fmt(aiProfile.clientPreferences.priceRange.min)} – {fmt(aiProfile.clientPreferences.priceRange.max)} (median {fmt(aiProfile.clientPreferences.priceRange.median)})</span>
              <span>Weight: {aiProfile.clientPreferences.weightRange.min.toFixed(1)}g – {aiProfile.clientPreferences.weightRange.max.toFixed(1)}g</span>
              {aiProfile.clientPreferences.stoneProfile.materialRatioPreference && (
                <span>Material: {aiProfile.clientPreferences.stoneProfile.materialRatioPreference}</span>
              )}
              {aiProfile.clientPreferences.stoneProfile.preferredColours.length > 0 && (
                <span>Colours: {aiProfile.clientPreferences.stoneProfile.preferredColours.slice(0, 3).join(", ")}</span>
              )}
            </div>
          </div>
        )}
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
        // Necklace/choker first, earring second
        const sorted = [...siblings].sort((a, b) => {
          const aIsEarring = isEarringHalf(a.styleNo) ? 1 : 0;
          const bIsEarring = isEarringHalf(b.styleNo) ? 1 : 0;
          return aIsEarring - bIsEarring;
        });
        // Unify score: all items in a set get the highest score
        const maxScore = Math.max(...sorted.map((s) => s.score));
        const unified = sorted.map((s) => ({ ...s, score: maxScore }));
        groups.push({ type: "set", items: unified });
        for (const s of sorted) seen.add(s.jc);
      } else {
        groups.push({ type: "single", items: [item], standaloneFromSet: root !== null });
        seen.add(item.jc);
      }
    }
    return groups;
  }

  function renderGroupedGrid(items: AssortSuggestion[], accent: string) {
    const groups = groupBySet(items);
    return (
      <div className="grid gap-3 py-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))" }}>
        {groups.map((group, gi) => {
          if (group.type === "set") {
            return (
              <div
                key={`set-${gi}`}
                className="relative flex gap-2 p-2 rounded-lg"
                style={{ gridColumn: "span 2", border: `1.5px dashed ${accent}`, background: `${accent}0A`, marginBottom: 4 }}
              >
                <div className="absolute -top-2.5 left-3.5 z-10 text-white font-mono text-[9px] font-bold tracking-[1.2px] px-2 py-0.5 rounded" style={{ background: accent }}>
                  SET
                </div>
                {group.items.map((item) => (
                  <div key={item.jc} className="flex-1 min-w-0">{renderCard(item)}</div>
                ))}
              </div>
            );
          }
          if (group.standaloneFromSet) {
            return (
              <div key={`solo-${gi}`} className="relative">
                <div
                  className="absolute -top-2 -left-1.5 z-10 text-white font-mono text-[8px] font-bold w-[18px] h-[18px] rounded-full flex items-center justify-center"
                  style={{ background: accent }}
                  title="Part of a set \u2014 only this piece is in stock"
                >
                  S
                </div>
                {renderCard(group.items[0])}
              </div>
            );
          }
          return renderCard(group.items[0]);
        })}
      </div>
    );
  }

  function renderBestMatches(items: AssortSuggestion[]) {
    const maxScore = Math.max(...items.map(i => i.score));
    return (
      <div className="mb-5">
        <div
          className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-t-md font-mono text-[10px] tracking-[1.5px] font-medium text-[#6B5314]"
          style={{ background: "linear-gradient(90deg, #FEF6D9, #FDFAF4)", borderLeft: "3px solid #C9A84C" }}
        >
          <span>{"\uD83C\uDFC6"} BEST MATCHES</span>
          <span className="font-normal opacity-80 text-[11px] ml-1">
            Top match in {items.length} segments {"\u00B7"} highest score {maxScore}/100
          </span>
        </div>
        {renderGroupedGrid(items, "#C9A84C")}
      </div>
    );
  }

  function renderClearance(items: AssortSuggestion[]) {
    return (
      <div className="mb-5">
        <div
          className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-t-md font-mono text-[10px] tracking-[1.5px] font-medium text-[#8B1A1A]"
          style={{ background: "#FDEAEA", borderLeft: "3px solid #A63C2A" }}
        >
          <span>{"\uD83D\uDD34"} CLEARANCE {"\u2014"} HIGH PRIORITY</span>
          <span className="font-normal opacity-80 text-[11px] ml-1">
            {items.length} items {"\u00B7"} Aged stock to move first
          </span>
        </div>
        {renderGroupedGrid(items, "#A63C2A")}
      </div>
    );
  }

  function renderSegmentCluster(segName: string, items: AssortSuggestion[]) {
    const catCountMap = new Map<string, number>();
    for (const item of items) {
      const cat = item.cat || "Other";
      catCountMap.set(cat, (catCountMap.get(cat) || 0) + 1);
    }
    const catCounts = Array.from(catCountMap.entries()).sort((a, b) => b[1] - a[1]);

    return (
      <div key={segName} className="mb-5">
        <div className="px-3.5 py-2.5 rounded-t-md" style={{ background: "#F5F1E8", borderLeft: "3px solid #C9A84C" }}>
          <div className="flex items-center gap-2.5">
            <span className="text-[17px] font-bold text-[#1A1814]">{"\uD83D\uDC8E"} {segName}</span>
            <span className="font-mono text-[10px] tracking-[1.5px] text-[#6B6458] font-medium">
              {items.length} items
            </span>
          </div>
          <span className="inline-flex gap-1 flex-wrap mt-1">
            {catCounts.map(([cat, count]) => (
              <span key={cat} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[rgba(201,168,76,0.1)] text-[#6B5314]">
                {cat} {"\u00D7"}{count}
              </span>
            ))}
          </span>
        </div>
        {renderGroupedGrid(items, "#C9A84C")}
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
            {(item.ageTag === "Slow Moving" || item.ageTag === "Ageing" || item.ageTag === "Non-Moving" || item.ageTag === "Slow" || item.ageTag === "Dead Stock" || item.ageingDays > 90) && (
              <span className="bg-[rgba(166,60,42,0.85)] text-white text-[8px] font-bold w-[18px] h-[18px] rounded-full flex items-center justify-center backdrop-blur-sm" title="Clearance Stock">
                C
              </span>
            )}
          </div>

          {/* Score breakdown tooltip — top-left */}
          <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="bg-white/95 backdrop-blur-sm rounded px-1.5 py-1 text-[8px] font-mono text-[#3A3530] shadow-sm border border-[#EDE8DC] max-w-[140px]">
              {mode === "bdmstate" && breakdown ? (
                <>
                  <div>Seg:{Math.round(breakdown.segment * 100)}% Cat:{Math.round(breakdown.category * 100)}%</div>
                  <div>Vis:{Math.round(breakdown.visual * 100)}% Pri:{Math.round(breakdown.price * 100)}%</div>
                </>
              ) : (
                reasons.slice(0, 2).map((r, i) => (
                  <div key={i} className="truncate">{r.text.length > 30 ? r.text.slice(0, 30) + "\u2026" : r.text}</div>
                ))
              )}
            </div>
          </div>

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

        {/* Recommended For — per-item target client from AI scoring */}
        {item.targetClient && (
          <div
            className="flex items-center gap-2 px-[11px] py-[7px] shrink-0"
            style={{ background: "#FEF9EE", borderBottom: "2px solid var(--gold, #C9A84C)", minHeight: 44 }}
            title={item.targetClient}
          >
            <div className="w-[26px] h-[26px] rounded-full bg-[#C9A84C] flex items-center justify-center text-[10px] font-bold text-white shrink-0">
              {item.targetClient.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[7.5px] tracking-[1.5px] text-[#8B6914] uppercase leading-none">Recommended for</div>
              <div className="text-[12px] font-bold text-[#1A1814] leading-tight mt-px truncate">
                {item.targetClient.length > 28 ? item.targetClient.substring(0, 26) + "\u2026" : item.targetClient}
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
            {/* Selling Price — visible only when gold rate is set */}
            {localGoldPrice > 0 && item.pureWt != null && item.pureWt > 0 && (
              <div className="bg-[#F0FAF3] border border-[#B8D4BE] rounded-[5px] px-2 py-[5px] mb-[7px]">
                <div className="font-mono text-[7px] tracking-[1.5px] text-[#4A7C59] uppercase mb-0.5">Selling Price</div>
                <div className="text-[15px] font-bold text-[#4A7C59] leading-none" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {fmt(Math.round(item.tagPrice / 2 + localGoldPrice * item.pureWt!))}
                </div>
              </div>
            )}
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
              onChange={(e) => { setSelectedBdm(e.target.value); setSelectedState(""); setSelectedClient(""); setSelectedMonths([]); setSelectedYears([]); resetResults(); }}
              className="min-w-[180px] px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none"
            >
              <option value="">{"\u2014"} Select BDM {"\u2014"}</option>
              {effectiveBdmKeys.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <select
              value={selectedState}
              onChange={(e) => { setSelectedState(e.target.value); setSelectedClient(""); setSelectedMonths([]); setSelectedYears([]); resetResults(); }}
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
              onChange={(e) => { setSelectedClient(e.target.value); resetResults(); }}
              disabled={!selectedBdm || !selectedState}
              className="min-w-[200px] px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none disabled:opacity-50"
            >
              <option value="">{!selectedState ? "\u2014 Select State first \u2014" : "\u2014 Target Client (optional) \u2014"}</option>
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
              value={selectedExhibition}
              onChange={(e) => { setSelectedExhibition(e.target.value); resetResults(); }}
              className="min-w-[250px] px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none"
            >
              <option value="all">{"\uD83C\uDFAA"} All Exhibitions (combined)</option>
              {exhibitions.map((exh) => (
                <option key={exh.name} value={exh.name}>
                  {exh.name} {"\u2014"} {exh.interestCount} interests, {exh.customerCount} customers
                </option>
              ))}
            </select>
            {/* Exhibition summary cards */}
            {exhibitions.length > 0 && (
              <div className="flex gap-2">
                <div className="bg-white border border-[#D4C9A8] rounded px-2.5 py-1 text-center">
                  <div className="text-[14px] font-bold text-[#C9A84C]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {exhibitions.reduce((s, e) => s + e.interestCount, 0).toLocaleString()}
                  </div>
                  <div className="font-mono text-[7px] tracking-wider text-[#6B6458]">TOTAL INTERESTS</div>
                </div>
                <div className="bg-white border border-[#D4C9A8] rounded px-2.5 py-1 text-center">
                  <div className="text-[14px] font-bold text-[#1A1814]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {exhibitions.reduce((s, e) => s + e.uniqueSkuCount, 0).toLocaleString()}
                  </div>
                  <div className="font-mono text-[7px] tracking-wider text-[#6B6458]">UNIQUE SKUs</div>
                </div>
                <div className="bg-white border border-[#D4C9A8] rounded px-2.5 py-1 text-center">
                  <div className="text-[14px] font-bold text-[#1A1814]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {exhibitions.length}
                  </div>
                  <div className="font-mono text-[7px] tracking-wider text-[#6B6458]">EXHIBITIONS</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Location mode panel */}
        {mode === "location" && (
          <div className="flex gap-2.5 items-center flex-wrap">
            <select
              value={selectedDestination}
              onChange={(e) => { setSelectedDestination(e.target.value); resetResults(); }}
              className="min-w-[220px] px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none"
            >
              <option value="">{"\u2014"} Select Destination {"\u2014"}</option>
              {locations.map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
            <select className="min-w-[220px] px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none" disabled>
              <option>Source: RANIWALA JEWELLERS PVT LTD</option>
            </select>
          </div>
        )}

        {/* Product Segment filter */}
        <select
          value={selectedSegment}
          onChange={(e) => setSelectedSegment(e.target.value)}
          className="px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none"
        >
          <option value="">All Segments</option>
          {PRODUCT_SEGMENTS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Category filter */}
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-2.5 py-1.5 border border-[#D4C9A8] rounded bg-white text-[12.5px] text-[#1A1814] focus:border-[#C9A84C] outline-none"
        >
          <option value="">All Categories</option>
          {availableCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Sales-period scope — Month + Year multiselect (BDM mode) */}
        {mode === "bdmstate" && (
          <div className="flex gap-2 items-center" title="Scope the BDM's sales profile to selected sale month(s)/year(s)">
            <MultiSelectDropdown
              label="Months"
              options={availableMonths.map((m) => ({ value: m, label: m }))}
              selected={selectedMonths}
              onChange={(next) => { setSelectedMonths(next); resetResults(); }}
              disabled={!selectedBdm}
              emptyText={selectedBdm ? "No dated sales for this BDM" : "Select a BDM first"}
            />
            <MultiSelectDropdown
              label="Years"
              options={availableYears.map((y) => ({ value: String(y), label: String(y) }))}
              selected={selectedYears}
              onChange={(next) => { setSelectedYears(next); resetResults(); }}
              disabled={!selectedBdm}
              emptyText={selectedBdm ? "No dated sales for this BDM" : "Select a BDM first"}
            />
          </div>
        )}

        {/* Scoring weight inputs — only for BDM mode (exhibition/location use pre-computed scores) */}
        {mode === "bdmstate" && <div className="flex items-center gap-1.5 border border-[#D4C9A8] rounded px-2 py-1 bg-white flex-wrap">
          <span className="font-mono text-[8.5px] tracking-wider text-[#6B6458] mr-1">WEIGHTS</span>
          {([
            { key: "segment" as const, label: "Segment" },
            { key: "category" as const, label: "Category" },
            { key: "visual" as const, label: "Visual" },
            { key: "price" as const, label: "Price" },
          ] as const).map(({ key, label }) => (
            <div key={key} className="flex items-center gap-0.5">
              <span className="text-[10px] text-[#6B6458]">{label}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={scoringWeights[key]}
                onChange={(e) => {
                  const val = Math.max(0, Number(e.target.value) || 0);
                  setScoringWeights(prev => {
                    const otherSum = prev.segment + prev.category + prev.visual + prev.price - prev[key];
                    const capped = Math.min(val, 100 - otherSum);
                    return { ...prev, [key]: Math.max(0, capped) };
                  });
                }}
                className="w-[44px] px-1 py-1 border border-[#D4C9A8] rounded text-[11px] font-semibold text-center"
                style={{ fontVariantNumeric: "tabular-nums" }}
              />
              <span className="text-[9px] text-[#9A9490]">%</span>
            </div>
          ))}
          {(() => {
            const total = scoringWeights.segment + scoringWeights.category + scoringWeights.visual + scoringWeights.price;
            return (
              <span className={cn("font-mono text-[10px] font-bold ml-1", total === 100 ? "text-[#4A7C59]" : "text-[#A63C2A]")}>
                ={total}%
              </span>
            );
          })()}
        </div>}

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
          <div className="text-[12px] text-[#3D3830]">
            Metal: <strong>{"\u2264"}{metalWtMax}g</strong>{" "}
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={metalWtMax}
              onChange={(e) => setMetalWtMax(Number(e.target.value))}
              className="w-[80px] align-middle"
              style={{ accentColor: "#C9A84C" }}
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
              <div className="text-[15px] font-medium text-[#1A1814] mb-2">Exhibition Assortment Engine</div>
              <div className="text-[12.5px] text-[#6B6458] max-w-[500px] text-center mb-6">
                Select an exhibition {"\u2014"} the engine matches exhibition interest signals against live inventory, scoring by family match, category, make type, and customer demand
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
            disabled={isScoring || (mode === "bdmstate" && !selectedBdm) || (mode === "location" && !selectedDestination)}
            title={
              mode === "bdmstate" && !selectedBdm
                ? "Select a BDM first"
                : mode === "location" && !selectedDestination
                ? "Select a destination store first"
                : undefined
            }
            className="px-5 py-2.5 bg-[#C9A84C] text-[#1A1814] text-[12.5px] font-medium rounded hover:bg-[#8B6914] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* RESULTS — Best Matches + Clearance + Segment Clusters */}
      {generated && !isScoring && (
        <div className="bg-white border border-[#D4C9A8] border-t-0 min-h-[400px] p-5 pb-4">
          {sections.bestMatches.length > 0 && renderBestMatches(sections.bestMatches)}
          {sections.clearanceItems.length > 0 && renderClearance(sections.clearanceItems)}
          {sections.segments.map(([segName, items]) =>
            renderSegmentCluster(segName, items)
          )}

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

              {/* AI SCORE BREAKDOWN — mode-aware dimensions */}
              <div className="bg-[#FDFAF4] border border-[#EDE8DC] rounded-md p-2.5 mb-3">
                <div className="font-mono text-[9px] text-[#6B6458] tracking-[1.5px] mb-2">
                  {mode === "client" ? "EXHIBITION MATCH BREAKDOWN" : mode === "location" ? "DISPATCH SCORE BREAKDOWN" : "AI SCORE BREAKDOWN"}
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[24px] font-bold text-[#C9A84C]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {detailItem.score}
                  </span>
                  <span className="text-[11px] text-[#6B6458]">/ 100</span>
                </div>
                {(() => {
                  if (mode === "bdmstate") {
                    // BDM mode: 4-dimension weighted breakdown
                    const bd = (detailItem as AssortSuggestion & { scoreBreakdown?: AiScoreBreakdown }).scoreBreakdown;
                    if (!bd) return null;
                    const dims = [
                      { label: "Segment", val: bd.segment, weight: scoringWeights.segment, color: "#C9A84C" },
                      { label: "Category", val: bd.category, weight: scoringWeights.category, color: "#5B21B6" },
                      { label: "Visual", val: bd.visual, weight: scoringWeights.visual, color: "#1A56CC" },
                      { label: "Price", val: bd.price, weight: scoringWeights.price, color: "#8B6914" },
                    ];
                    return dims.map((d) => {
                      const pct = Math.round(Math.min(1, Math.max(0, d.val)) * 100);
                      const earned = Math.round(d.val * d.weight);
                      return (
                        <div key={d.label} className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-[8px] text-[#6B6458] w-[55px] shrink-0">{d.label}</span>
                          <div className="flex-1 h-1.5 bg-[#EDE8DC] rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: d.color }} />
                          </div>
                          <span className="font-mono text-[9px] text-[#3A3530] w-[38px] text-right">{earned}/{d.weight}</span>
                        </div>
                      );
                    });
                  }
                  // Exhibition & Location: derive bars from reasons
                  const score = detailItem.score;
                  const reasons = detailItem.reasons || [];
                  const bars: Array<{ label: string; pct: number; color: string }> = [];
                  for (const r of reasons) {
                    const reason = typeof r === "string" ? { tag: r, text: r } : r;
                    let color = "#8B6914";
                    if (reason.tag === "match") color = "#1A56CC";
                    else if (reason.tag === "pref") color = "#5B21B6";
                    else if (reason.tag === "clearance" || reason.tag === "slow") color = "#8B1A1A";
                    else if (reason.tag === "band") color = "#8B6914";
                    else if (reason.tag === "new") color = "#166534";
                    // Distribute score proportionally across reasons
                    const share = reasons.length > 0 ? score / reasons.length : 0;
                    bars.push({ label: reason.text.length > 25 ? reason.text.slice(0, 25) + "\u2026" : reason.text, pct: Math.min(100, Math.round(share)), color });
                  }
                  if (bars.length === 0) bars.push({ label: "Base score", pct: score, color: "#8B6914" });
                  return bars.map((b, i) => (
                    <div key={i} className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[7.5px] text-[#6B6458] w-[120px] shrink-0 truncate" title={b.label}>{b.label}</span>
                      <div className="flex-1 h-1.5 bg-[#EDE8DC] rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${b.pct}%`, background: b.color }} />
                      </div>
                      <span className="font-mono text-[9px] text-[#3A3530] w-[28px] text-right">{b.pct}</span>
                    </div>
                  ));
                })()}
              </div>

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

              {/* Selling Price — full-width green banner when gold rate is set */}
              {localGoldPrice > 0 && detailItem.pureWt != null && detailItem.pureWt > 0 && (
                <div className="bg-[#F0FAF3] border border-[#B8D4BE] rounded-md px-3 py-2 mb-3 flex items-center justify-between">
                  <div className="font-mono text-[9px] tracking-[1.5px] text-[#4A7C59] uppercase">Selling Price</div>
                  <div className="text-[20px] font-bold text-[#4A7C59]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmt(Math.round(detailItem.tagPrice / 2 + localGoldPrice * detailItem.pureWt!))}
                  </div>
                </div>
              )}

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
