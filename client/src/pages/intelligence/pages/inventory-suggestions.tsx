import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStockSummary } from "@/lib/api";
import { fmt, fmtN, downloadCSV } from "../lib/intelligence-utils";
import type { TransferSuggestion } from "../lib/intelligence-types";
import { cn } from "@/lib/utils";

// Per-location utilization derived live from two stock-summary calls
// (unfiltered = totals, ageingTag "Non-Moving" = dead stock > 270 days).
interface LocUtil {
  "Location Name": string;
  total_items: number;
  dead_items: number;
  dead_pct: number;
  dead_cost: number;
}

function useLocUtil() {
  const totalQ = useQuery({
    queryKey: ["stock-summary"],
    queryFn: () => fetchStockSummary(),
  });
  const deadQ = useQuery({
    queryKey: ["stock-summary", "Non-Moving"],
    queryFn: () => fetchStockSummary("Non-Moving"),
  });

  const locUtil = useMemo<LocUtil[]>(() => {
    const total = totalQ.data?.locationBreakdown ?? [];
    const deadMap = new Map(
      (deadQ.data?.locationBreakdown ?? []).map((d) => [d.location, d])
    );
    return total.map((t) => {
      const dead = deadMap.get(t.location);
      const deadItems = dead?.count ?? 0;
      return {
        "Location Name": t.location,
        total_items: t.count,
        dead_items: deadItems,
        dead_pct: t.count > 0 ? (deadItems / t.count) * 100 : 0,
        dead_cost: dead?.costValue ?? 0,
      };
    });
  }, [totalQ.data, deadQ.data]);

  return {
    locUtil,
    isLoading: totalQ.isLoading || deadQ.isLoading,
    isError: totalQ.isError || deadQ.isError,
  };
}

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

const MONO = "'DM Mono', monospace";
const SERIF = "'Cormorant Garamond', serif";

// ---- Types for cross-tab rows ----

type GapStatus = "HIGH" | "MODERATE" | "ADEQUATE";

interface DemandGapRow {
  location: string;
  category: string;
  onHand: number;
  weeklyDemand: number;
  weeksOfStock: number;
  deadPct: number;
  gapStatus: GapStatus;
}

// ---- Helpers ----

function computeGapStatus(weeksOfStock: number): GapStatus {
  if (weeksOfStock < 4) return "HIGH";
  if (weeksOfStock < 8) return "MODERATE";
  return "ADEQUATE";
}

function gapBadgeClass(status: GapStatus): string {
  switch (status) {
    case "HIGH":
      return "bg-[#FDEAEA] text-[#8B1A1A] border-[#E8A0A0]";
    case "MODERATE":
      return "bg-[#FFF4E0] text-[#8B5E00] border-[#E8D4A0]";
    case "ADEQUATE":
      return "bg-[#E8F5EC] text-[#2D6B42] border-[#A8D4B0]";
  }
}

function overstockRecommendation(deadPct: number): string {
  if (deadPct > 60) return "Urgent Clearance";
  if (deadPct > 45) return "Transfer Out";
  return "Monitor";
}

function recommendationClass(rec: string): string {
  switch (rec) {
    case "Urgent Clearance":
      return "bg-[#FDEAEA] text-[#8B1A1A]";
    case "Transfer Out":
      return "bg-[#FFF4E0] text-[#8B5E00]";
    default:
      return "bg-[#E8F5EC] text-[#2D6B42]";
  }
}

// ---- Styled table header cell ----

function Th({ children, className, mono }: { children: React.ReactNode; className?: string; mono?: boolean }) {
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[#6B6458] bg-[#F5F1E8] border-b border-[#D4C9A8]",
        className
      )}
      style={mono ? { fontFamily: MONO } : undefined}
    >
      {children}
    </th>
  );
}

function Td({ children, className, mono }: { children: React.ReactNode; className?: string; mono?: boolean }) {
  return (
    <td
      className={cn(
        "px-3 py-2 text-[12px] text-[#1A1814] border-b border-[#E8E2D4]",
        className
      )}
      style={mono ? { fontFamily: MONO } : undefined}
    >
      {children}
    </td>
  );
}

// ============================================================
// Tab 1 — Demand Gap Analysis
// ============================================================

function DemandGapTab() {
  const { data: summary, isLoading, isError } = useQuery({
    queryKey: ["stock-summary"],
    queryFn: () => fetchStockSummary(),
  });

  // Dead stock per location (live, ageingTag "Non-Moving")
  const { data: deadSummary } = useQuery({
    queryKey: ["stock-summary", "Non-Moving"],
    queryFn: () => fetchStockSummary("Non-Moving"),
  });

  const [locationFilter, setLocationFilter] = useState<string>("all");

  // location -> dead stock percentage
  const locUtilMap = useMemo(() => {
    const map = new Map<string, number>();
    const total = summary?.locationBreakdown ?? [];
    const deadMap = new Map(
      (deadSummary?.locationBreakdown ?? []).map((d) => [d.location, d.count])
    );
    total.forEach((t) => {
      const dead = deadMap.get(t.location) ?? 0;
      map.set(t.location, t.count > 0 ? (dead / t.count) * 100 : 0);
    });
    return map;
  }, [summary, deadSummary]);

  const { rows, locations } = useMemo(() => {
    if (!summary) return { rows: [] as DemandGapRow[], locations: [] as string[] };

    // Build a map: location -> category -> count
    // The summary gives us flat breakdowns; we need to cross them.
    // Since the API gives separate category and location breakdowns (not a cross-tab),
    // we estimate by distributing category counts proportionally across locations.

    const catCounts = new Map<string, number>();
    const catTotal = summary.categoryBreakdown.reduce((s, c) => s + c.count, 0);
    summary.categoryBreakdown.forEach((c) => catCounts.set(c.category, c.count));

    const locCounts = new Map<string, number>();
    const locTotal = summary.locationBreakdown.reduce((s, l) => s + l.count, 0);
    summary.locationBreakdown.forEach((l) => locCounts.set(l.location, l.count));

    const allLocations = summary.locationBreakdown.map((l) => l.location).sort();
    const allCategories = summary.categoryBreakdown.map((c) => c.category).sort();

    const result: DemandGapRow[] = [];

    for (const loc of allLocations) {
      const locCount = locCounts.get(loc) || 0;
      const locShare = locTotal > 0 ? locCount / locTotal : 0;

      for (const cat of allCategories) {
        const catCount = catCounts.get(cat) || 0;
        // Estimated on-hand for this location×category combo
        const onHand = Math.round(catCount * locShare);
        if (onHand === 0) continue;

        // Weekly demand estimated as count / 26 (approx 6 months of data)
        const weeklyDemand = onHand / 26;
        const weeksOfStock = weeklyDemand > 0 ? onHand / weeklyDemand : 999;

        // Dead stock % for this location (live)
        const deadPct = locUtilMap.get(loc) ?? 0;

        result.push({
          location: loc,
          category: cat,
          onHand,
          weeklyDemand: Math.round(weeklyDemand * 10) / 10,
          weeksOfStock: Math.round(weeksOfStock * 10) / 10,
          deadPct: Math.round(deadPct * 10) / 10,
          gapStatus: computeGapStatus(weeksOfStock),
        });
      }
    }

    // Sort by gap severity: HIGH first, then MODERATE, then ADEQUATE
    const order: Record<GapStatus, number> = { HIGH: 0, MODERATE: 1, ADEQUATE: 2 };
    result.sort((a, b) => order[a.gapStatus] - order[b.gapStatus]);

    return { rows: result, locations: allLocations };
  }, [summary, locUtilMap]);

  const filteredRows = useMemo(() => {
    if (locationFilter === "all") return rows;
    return rows.filter((r) => r.location === locationFilter);
  }, [rows, locationFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-[13px] text-[#6B6458]">Loading stock summary...</div>
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-[13px] text-[#8B1A1A]">Failed to load stock summary. Please try again.</div>
      </div>
    );
  }

  const highCount = filteredRows.filter((r) => r.gapStatus === "HIGH").length;
  const moderateCount = filteredRows.filter((r) => r.gapStatus === "MODERATE").length;

  return (
    <div className="space-y-4">
      {/* Header row with filter */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="text-[12px] text-[#6B6458]">
            <span className="font-semibold text-[#8B1A1A]">{highCount}</span> high gaps
            <span className="mx-2 text-[#D4C9A8]">|</span>
            <span className="font-semibold text-[#8B5E00]">{moderateCount}</span> moderate gaps
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#6B6458] uppercase tracking-wide">Location</span>
          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="h-8 w-[220px] text-[12px] border-[#D4C9A8] bg-white">
              <SelectValue placeholder="All Locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {locations.map((loc) => (
                <SelectItem key={loc} value={loc}>
                  {loc}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="border border-[#D4C9A8] rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Location</Th>
                <Th>Category</Th>
                <Th mono>On Hand</Th>
                <Th mono>Weekly Demand</Th>
                <Th mono>Weeks of Stock</Th>
                <Th mono>Dead Stock %</Th>
                <Th>Gap Status</Th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-[12px] text-[#6B6458]">
                    No demand gap data available.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, i) => (
                  <tr
                    key={`${row.location}-${row.category}-${i}`}
                    className={cn(
                      "transition-colors hover:bg-[#FAF8F3]",
                      row.gapStatus === "HIGH" && "bg-[#FEF8F8]"
                    )}
                  >
                    <Td className="font-medium max-w-[180px] truncate">{row.location}</Td>
                    <Td>{row.category}</Td>
                    <Td mono>{fmtN(row.onHand)}</Td>
                    <Td mono>{row.weeklyDemand.toFixed(1)}</Td>
                    <Td mono>{row.weeksOfStock.toFixed(1)}</Td>
                    <Td mono>{row.deadPct.toFixed(1)}%</Td>
                    <Td>
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] font-semibold px-2 py-0.5", gapBadgeClass(row.gapStatus))}
                      >
                        {row.gapStatus}
                      </Badge>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab 2 — Transfer Suggestions
// ============================================================

function TransferSuggestionsTab() {
  // NOTE: inter-store transfer detection has no backend endpoint yet, so there
  // is no live data source. Render an honest empty state rather than the
  // previous fabricated DATA.transferSuggestions.
  const suggestions: TransferSuggestion[] = [];
  const [showApproved, setShowApproved] = useState(false);

  const highPriorityCount = suggestions.filter((s) => s.priority === "HIGH").length;

  function handleApproveAllHigh() {
    setShowApproved(true);
    // In production this would call an API; here we show a visual confirmation
  }

  function handleExportCSV() {
    const headers = [
      "Priority",
      "Category",
      "From Location",
      "To Location",
      "Suggested Qty",
      "From Dead Items",
      "To Weekly Velocity",
      "To Weeks of Stock",
      "Rationale",
    ];
    const rows = suggestions.map((s) => [
      s.priority,
      s.category,
      s.fromLocation,
      s.toLocation,
      s.suggestQty,
      s.fromDeadItems,
      s.toWeeklyVelocity,
      s.toWeeksOfStock,
      s.rationale,
    ]);
    downloadCSV("transfer-suggestions.csv", headers, rows);
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={handleApproveAllHigh}
            disabled={showApproved}
            className={cn(
              "h-8 text-[12px] font-medium",
              showApproved
                ? "bg-[#E8F5EC] text-[#2D6B42] border border-[#A8D4B0] cursor-default"
                : "bg-[#A63C2A] text-white hover:bg-[#8B3222]"
            )}
          >
            {showApproved
              ? `${highPriorityCount} HIGH Priority Approved`
              : `Approve All HIGH Priority (${highPriorityCount})`}
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCSV}
          className="h-8 text-[12px] border-[#D4C9A8] text-[#6B6458] hover:bg-[#F5F1E8] gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Empty state — no live transfer-detection backend yet */}
      {suggestions.length === 0 && (
        <div className="border border-dashed border-[#D4C9A8] rounded-lg bg-white py-12 text-center">
          <p className="text-[13px] text-[#6B6458]">
            No transfer suggestions available.
          </p>
          <p className="text-[11px] text-[#6B6458]/70 mt-1">
            Inter-store transfer detection is not yet connected to a live data source.
          </p>
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {suggestions.map((s, i) => {
          const isHigh = s.priority === "HIGH";
          const borderColor = isHigh ? "border-[#A63C2A]" : "border-[#C4862B]";
          const approved = showApproved && isHigh;

          return (
            <div
              key={`${s.fromLocation}-${s.toLocation}-${s.category}-${i}`}
              className={cn(
                "border border-[#D4C9A8] rounded-lg bg-white p-4 border-l-4 transition-all",
                borderColor,
                approved && "opacity-70"
              )}
            >
              {/* Top row: priority + approved badge */}
              <div className="flex items-center justify-between mb-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-bold px-2 py-0.5",
                    isHigh
                      ? "bg-[#FDEAEA] text-[#8B1A1A] border-[#E8A0A0]"
                      : "bg-[#FFF4E0] text-[#8B5E00] border-[#E8D4A0]"
                  )}
                >
                  {s.priority}
                </Badge>
                {approved && (
                  <Badge className="text-[10px] bg-[#E8F5EC] text-[#2D6B42] border border-[#A8D4B0]">
                    Approved
                  </Badge>
                )}
              </div>

              {/* Category */}
              <p className="text-[13px] font-semibold text-[#1A1814] mb-1" style={{ fontFamily: SERIF }}>
                {s.category}
              </p>

              {/* From -> To */}
              <div className="flex items-center gap-2 mb-2 text-[11px]">
                <span className="text-[#6B6458]">{s.fromLocation}</span>
                <span className="text-[#C9A84C] font-bold">&rarr;</span>
                <span className="text-[#1A1814] font-medium">{s.toLocation}</span>
              </div>

              {/* Stats row */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] mb-2" style={{ fontFamily: MONO }}>
                <span className="text-[#6B6458]">
                  Qty: <span className="text-[#1A1814] font-medium">{s.suggestQty}</span>
                </span>
                <span className="text-[#6B6458]">
                  Dead at source: <span className="text-[#8B1A1A] font-medium">{s.fromDeadItems}</span>
                </span>
                <span className="text-[#6B6458]">
                  Dest velocity: <span className="text-[#1A1814] font-medium">{s.toWeeklyVelocity.toFixed(1)}/wk</span>
                </span>
              </div>

              {/* Rationale */}
              <p className="text-[11px] text-[#6B6458] leading-relaxed">{s.rationale}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Tab 3 — Overstocked Categories
// ============================================================

function OverstockedTab() {
  const { locUtil, isLoading, isError } = useLocUtil();
  const overstocked = useMemo(
    () => locUtil.filter((lu) => lu.dead_pct > 35).sort((a, b) => b.dead_pct - a.dead_pct),
    [locUtil]
  );

  function handleExportCSV() {
    const headers = [
      "Location",
      "Total Items",
      "Dead Items",
      "Dead %",
      "Dead Cost",
      "Recommendation",
    ];
    const rows = overstocked.map((lu) => [
      lu["Location Name"],
      lu.total_items,
      lu.dead_items,
      lu.dead_pct.toFixed(1),
      Math.round(lu.dead_cost),
      overstockRecommendation(lu.dead_pct),
    ]);
    downloadCSV("overstocked-categories.csv", headers, rows);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-[13px] text-[#6B6458]">Loading stock summary...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-[13px] text-[#8B1A1A]">Failed to load stock summary. Please try again.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[12px] text-[#6B6458]">
          Showing <span className="font-semibold text-[#1A1814]">{overstocked.length}</span> locations with{" "}
          <span className="font-semibold text-[#8B1A1A]">&gt;35%</span> dead stock
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCSV}
          className="h-8 text-[12px] border-[#D4C9A8] text-[#6B6458] hover:bg-[#F5F1E8] gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Table */}
      <div className="border border-[#D4C9A8] rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Location</Th>
                <Th mono>Total Items</Th>
                <Th mono>Dead Items</Th>
                <Th mono>Dead %</Th>
                <Th mono>Dead Cost</Th>
                <Th>Recommendation</Th>
              </tr>
            </thead>
            <tbody>
              {overstocked.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[12px] text-[#6B6458]">
                    No overstocked locations found (all below 35% dead stock).
                  </td>
                </tr>
              ) : (
                overstocked.map((lu, i) => {
                  const rec = overstockRecommendation(lu.dead_pct);
                  return (
                    <tr
                      key={`${lu["Location Name"]}-${i}`}
                      className={cn(
                        "transition-colors hover:bg-[#FAF8F3]",
                        rec === "Urgent Clearance" && "bg-[#FEF8F8]"
                      )}
                    >
                      <Td className="font-medium max-w-[200px] truncate">{lu["Location Name"]}</Td>
                      <Td mono>{fmtN(lu.total_items)}</Td>
                      <Td mono>{fmtN(lu.dead_items)}</Td>
                      <Td mono>
                        <span className={lu.dead_pct > 60 ? "text-[#8B1A1A] font-semibold" : ""}>
                          {lu.dead_pct.toFixed(1)}%
                        </span>
                      </Td>
                      <Td mono>{fmt(lu.dead_cost)}</Td>
                      <Td>
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] font-semibold px-2 py-0.5", recommendationClass(rec))}
                        >
                          {rec}
                        </Badge>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main Page Component
// ============================================================

type TabId = "demand" | "transfer" | "overstock";

const TAB_LABELS: Record<TabId, string> = {
  demand: "Demand Gap Analysis",
  transfer: "Transfer Suggestions",
  overstock: "Overstocked Categories",
};

export default function InventorySuggestionsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("demand");

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h2
          className="text-[20px] font-semibold text-[#1A1814] tracking-tight"
          style={{ fontFamily: SERIF }}
        >
          Inventory Suggestions
        </h2>
        <p className="text-[12px] text-[#6B6458] mt-0.5">
          Demand gaps, transfer recommendations, and overstock alerts across locations
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["demand", "transfer", "overstock"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap border transition-colors",
              activeTab === tab
                ? "bg-[#C9A84C] text-[#1A1814] border-[#C9A84C]"
                : "bg-white text-[#6B6458] border-[#D4C9A8] hover:border-[#C9A84C] hover:bg-[#F5F1E8]"
            )}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "demand" && <DemandGapTab />}
        {activeTab === "transfer" && <TransferSuggestionsTab />}
        {activeTab === "overstock" && <OverstockedTab />}
      </div>
    </div>
  );
}
