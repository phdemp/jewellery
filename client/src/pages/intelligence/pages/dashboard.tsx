import { useMemo } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { AlertTriangle, ArrowRight, Package, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt, fmtN } from "../lib/intelligence-utils";
import { PIE_COLORS, AGEING_COLORS } from "../lib/intelligence-constants";
import { useIntelligence } from "../intelligence-context";
import { useQuery } from "@tanstack/react-query";
import { fetchStockSummary, fetchSalesData } from "@/lib/api";

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------------------
// Color tokens
// ---------------------------------------------------------------------------
const GOLD = "#C9A84C";
const GOLD_LIGHT = "#E8D5A3";
const GOLD_DARK = "#8B6914";
const CHARCOAL = "#1A1814";
const WARM_GREY = "#6B6458";
const SURFACE = "#F5F1E8";
const BORDER = "#D4C9A8";
const GREEN = "#4A7C59";
const RED = "#A63C2A";
const AMBER = "#C4862B";
const BLUE = "#2B5EA7";

// ---------------------------------------------------------------------------
// Reusable IntelPieChart
// ---------------------------------------------------------------------------
interface PieSlice {
  name: string;
  value: number;
}

interface IntelPieChartProps {
  title: string;
  data: PieSlice[];
  colors?: string[];
  valueFormatter?: (v: number) => string;
  onSliceClick?: (name: string) => void;
  height?: number;
}

function IntelPieChart({
  title,
  data,
  colors = PIE_COLORS,
  valueFormatter = fmt,
  onSliceClick,
  height = 260,
}: IntelPieChartProps) {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

  return (
    <div className="bg-white border border-[#D4C9A8] rounded-lg p-5 shadow-sm">
      <h3
        className="text-[16px] font-medium mb-4"
        style={{ color: CHARCOAL, fontFamily: "'Cormorant Garamond', serif" }}
      >
        {title}
      </h3>

      <div className="flex items-start gap-4">
        {/* Donut */}
        <div style={{ width: height, minWidth: height, height }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={2}
                dataKey="value"
                cursor={onSliceClick ? "pointer" : undefined}
                onClick={(entry) => {
                  if (onSliceClick && entry?.name) onSliceClick(entry.name);
                }}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => valueFormatter(value)}
                contentStyle={{
                  backgroundColor: "#fff",
                  border: `1px solid ${BORDER}`,
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: "'DM Mono', monospace",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-1.5 pt-2 flex-1 min-w-0">
          {data.map((d, i) => {
            const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0.0";
            return (
              <button
                key={d.name}
                className={cn(
                  "flex items-center gap-2 text-left text-[12px] leading-tight rounded px-1.5 py-1 transition-colors",
                  onSliceClick ? "hover:bg-[#F5F1E8] cursor-pointer" : "cursor-default"
                )}
                onClick={() => onSliceClick?.(d.name)}
                type="button"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: colors[i % colors.length] }}
                />
                <span className="truncate flex-1" style={{ color: CHARCOAL }}>
                  {d.name}
                </span>
                <span className="tabular-nums shrink-0" style={{ color: WARM_GREY, fontFamily: "'DM Mono', monospace", fontSize: 11 }}>
                  {valueFormatter(d.value)}
                </span>
                <span className="tabular-nums shrink-0 w-[42px] text-right" style={{ color: WARM_GREY, fontFamily: "'DM Mono', monospace", fontSize: 10 }}>
                  {pct}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------
interface StatCardProps {
  label: string;
  value: string;
  meta?: string;
  accentColor?: string;
  onClick?: () => void;
}

function StatCard({ label, value, meta, accentColor = GOLD, onClick }: StatCardProps) {
  return (
    <div
      className={cn(
        "bg-white border border-[#D4C9A8] rounded-lg p-5 relative overflow-hidden shadow-sm",
        onClick && "cursor-pointer hover:shadow-md transition-shadow"
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg"
        style={{ backgroundColor: accentColor }}
      />
      <div
        className="text-[9px] tracking-[1.8px] uppercase mb-2"
        style={{ fontFamily: "'DM Mono', monospace", color: WARM_GREY }}
      >
        {label}
      </div>
      <div
        className="text-[30px] font-medium leading-none tabular-nums tracking-tight"
        style={{ color: accentColor === RED ? RED : CHARCOAL }}
      >
        {value}
      </div>
      {meta && (
        <div className="text-[11.5px] mt-1" style={{ color: WARM_GREY }}>
          {meta}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Bar Tooltip
// ---------------------------------------------------------------------------
function BarTooltipContent({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="bg-white border rounded-md px-3 py-2 shadow-md"
      style={{ borderColor: BORDER, fontFamily: "'DM Mono', monospace", fontSize: 12 }}
    >
      <p className="text-[11px] mb-0.5" style={{ color: WARM_GREY }}>{label}</p>
      <p className="font-medium" style={{ color: CHARCOAL }}>{fmt(payload[0].value)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action Alert Card
// ---------------------------------------------------------------------------
interface AlertCardProps {
  title: string;
  count: number;
  description: string;
  color: string;
  icon: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
}

function AlertCard({ title, count, description, color, icon, actionLabel, onAction }: AlertCardProps) {
  return (
    <div className="bg-white border border-[#D4C9A8] rounded-lg p-5 shadow-sm flex flex-col">
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: color + "18" }}
        >
          <span style={{ color }}>{icon}</span>
        </div>
        <div>
          <h4 className="text-[14px] font-semibold" style={{ color: CHARCOAL }}>{title}</h4>
          <p
            className="text-[11px]"
            style={{ fontFamily: "'DM Mono', monospace", color: WARM_GREY }}
          >
            {description}
          </p>
        </div>
      </div>
      <div
        className="text-[28px] font-medium tabular-nums mb-3"
        style={{ color }}
      >
        {fmtN(count)}{" "}
        <span className="text-[13px] font-normal" style={{ color: WARM_GREY }}>items</span>
      </div>
      <button
        onClick={onAction}
        className="mt-auto flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-md transition-colors"
        style={{
          color,
          backgroundColor: color + "10",
          border: `1px solid ${color}30`,
        }}
      >
        {actionLabel}
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const { setActivePage, setDashFilter } = useIntelligence();

  // Live stock summary from API
  const { data: liveSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ["stock-summary"],
    queryFn: () => fetchStockSummary(),
  });

  // Live sales/returns data from API
  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ["sales-data"],
    queryFn: fetchSalesData,
    staleTime: 15 * 60 * 1000,
  });

  // Live stock stats
  const onHandCount = liveSummary?.onHandCount ?? 0;
  const totalStockCount = liveSummary?.totalCount ?? 0;
  const deadStockCount = liveSummary?.deadStockCount ?? 0;
  const deadStockCostVal = liveSummary?.deadStockCostValue ?? 0;
  const onHandTagVal = liveSummary?.onHandTagValue ?? 0;
  const onHandCostVal = liveSummary?.onHandCostValue ?? 0;
  const memoCount = liveSummary?.memoCount ?? 0;

  // Single pass over live sales rows → gross / returns / net + breakdowns.
  // Returns are rows with saleType "Sales Return" (negative transaction_amt).
  const salesAgg = useMemo(() => {
    const rows = salesData?.sales ?? [];
    let gross = 0;
    let returns = 0;
    let salesTxns = 0;
    const catGross = new Map<string, number>();
    const catRet = new Map<string, number>();
    const chanRet = new Map<string, number>();
    const monthGross = new Map<string, number>();
    for (const r of rows) {
      const isReturn = r.saleType === "Sales Return" || r.transPrice < 0;
      if (isReturn) {
        const v = Math.abs(r.transPrice);
        returns += v;
        catRet.set(r.category, (catRet.get(r.category) || 0) + v);
        chanRet.set(r.salesPerson, (chanRet.get(r.salesPerson) || 0) + v);
      } else {
        gross += r.transPrice;
        salesTxns++;
        catGross.set(r.category, (catGross.get(r.category) || 0) + r.transPrice);
        const month = r.transDate ? r.transDate.slice(0, 7) : "";
        if (month) monthGross.set(month, (monthGross.get(month) || 0) + r.transPrice);
      }
    }
    return {
      gross,
      returns,
      salesTxns,
      net: gross - returns,
      returnRate: gross > 0 ? (returns / gross) * 100 : 0,
      catGross,
      catRet,
      chanRet,
      monthGross,
    };
  }, [salesData]);

  // Net sales strip values (live)
  const grossSales = salesAgg.gross;
  const totalReturns = salesAgg.returns;
  const returnRate = salesAgg.returnRate;
  const netSales = salesAgg.net;

  // Ageing pie data (live, On Hand)
  const ageingPieData = useMemo(
    () =>
      (liveSummary?.ageingBreakdown ?? []).map((a) => ({
        name: a.label,
        value: a.count,
      })),
    [liveSummary]
  );
  const ageingColors = useMemo(
    () => (liveSummary?.ageingBreakdown ?? []).map((a) => AGEING_COLORS[a.label] || WARM_GREY),
    [liveSummary]
  );

  // Monthly gross revenue bar (live, fiscal order via YYYY-MM sort)
  const monthlyBarData = useMemo(() => {
    return Array.from(salesAgg.monthGross.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([monthStr, revenue]) => {
        const mo = parseInt(monthStr.split("-")[1] || "0", 10);
        return { month: MONTH_ABBR[mo] || monthStr, revenue };
      });
  }, [salesAgg]);

  // Category pie -- live stock tag value by category
  const catPieData = useMemo(() => {
    return (liveSummary?.categoryBreakdown ?? [])
      .filter((c) => c.category)
      .sort((a, b) => b.tagValue - a.tagValue)
      .slice(0, 12)
      .map((c) => ({ name: c.category, value: c.tagValue }));
  }, [liveSummary]);

  // Location stock pie -- live stock count by location
  const locPieData = useMemo(() => {
    return (liveSummary?.locationBreakdown ?? [])
      .filter((l) => l.location)
      .sort((a, b) => b.count - a.count)
      .map((l) => ({ name: l.location, value: l.count }));
  }, [liveSummary]);

  // Returns by category (live)
  const returnsByCatData = useMemo(() => {
    return Array.from(salesAgg.catRet.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));
  }, [salesAgg]);

  // Returns by channel (live)
  const returnsByBdmData = useMemo(() => {
    return Array.from(salesAgg.chanRet.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }));
  }, [salesAgg]);

  // Net sales by category table (live: gross − returns per category)
  const netSalesTable = useMemo(() => {
    const cats = new Set<string>([
      ...Array.from(salesAgg.catGross.keys()),
      ...Array.from(salesAgg.catRet.keys()),
    ]);
    return Array.from(cats)
      .map((category) => {
        const gross = salesAgg.catGross.get(category) || 0;
        const returns = salesAgg.catRet.get(category) || 0;
        return {
          category,
          gross,
          returns,
          returnPct: gross > 0 ? (returns / gross) * 100 : 0,
          net: gross - returns,
        };
      })
      .sort((a, b) => b.gross - a.gross);
  }, [salesAgg]);

  const slowMovingCount =
    liveSummary?.ageingBreakdown?.find((a) => a.label === "Slow Moving")?.count ?? 0;

  const handleCatClick = (name: string) => {
    setDashFilter({ type: "category", value: name });
    setActivePage("inventory");
  };

  const handleLocClick = (name: string) => {
    setDashFilter({ type: "location", value: name });
    setActivePage("inventory");
  };

  return (
    <div className="space-y-6">
      <div style={{ height: 2, background: "linear-gradient(90deg, #C9A84C, transparent)", marginBottom: 20, borderRadius: 1 }} />
      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="On Hand Stock"
          value={summaryLoading ? "..." : fmtN(onHandCount)}
          meta={`${fmtN(totalStockCount)} total items`}
        />
        <StatCard
          label="Dead Stock Value"
          value={summaryLoading ? "..." : fmt(deadStockCostVal)}
          meta={`${fmtN(deadStockCount)} items > 365 days`}
          accentColor={RED}
          onClick={() => {
            setActivePage("skuintel");
          }}
        />
        <StatCard
          label="FY Revenue"
          value={salesLoading ? "..." : fmt(grossSales)}
          meta={`${fmtN(salesAgg.salesTxns)} transactions`}
        />
        <StatCard
          label="On Hand Tag Value"
          value={summaryLoading ? "..." : fmt(onHandTagVal)}
          meta={`Cost: ${fmt(onHandCostVal)}`}
        />
      </div>

      {/* ── Net Sales Strip ── */}
      <div
        className="rounded-lg p-5 shadow-sm"
        style={{
          background: `linear-gradient(135deg, ${GOLD} 0%, ${GOLD_DARK} 100%)`,
        }}
      >
        <h3
          className="text-white/80 text-[10px] tracking-[1.8px] uppercase mb-4"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          Net Sales Summary - FY 2025-26
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <div
              className="text-[9px] tracking-[1.5px] uppercase mb-1"
              style={{ fontFamily: "'DM Mono', monospace", color: "rgba(255,255,255,0.6)" }}
            >
              Gross Sales
            </div>
            <div className="text-[26px] font-medium text-white tabular-nums tracking-tight leading-none">
              {fmt(grossSales)}
            </div>
          </div>
          <div>
            <div
              className="text-[9px] tracking-[1.5px] uppercase mb-1"
              style={{ fontFamily: "'DM Mono', monospace", color: "rgba(255,255,255,0.6)" }}
            >
              Returns
            </div>
            <div className="text-[26px] font-medium text-white tabular-nums tracking-tight leading-none">
              {fmt(totalReturns)}
            </div>
          </div>
          <div>
            <div
              className="text-[9px] tracking-[1.5px] uppercase mb-1"
              style={{ fontFamily: "'DM Mono', monospace", color: "rgba(255,255,255,0.6)" }}
            >
              Return Rate
            </div>
            <div className="text-[26px] font-medium text-white tabular-nums tracking-tight leading-none">
              {returnRate.toFixed(1)}%
            </div>
          </div>
          <div>
            <div
              className="text-[9px] tracking-[1.5px] uppercase mb-1"
              style={{ fontFamily: "'DM Mono', monospace", color: "rgba(255,255,255,0.6)" }}
            >
              Net Sales
            </div>
            <div className="text-[26px] font-medium text-white tabular-nums tracking-tight leading-none">
              {fmt(netSales)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Ageing Pie + Monthly Revenue Bar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <IntelPieChart
          title="Stock Ageing Distribution"
          data={ageingPieData}
          colors={ageingColors}
          valueFormatter={(v) => fmtN(v) + " items"}
        />

        <div className="bg-white border border-[#D4C9A8] rounded-lg p-5 shadow-sm">
          <h3
            className="text-[16px] font-medium mb-4"
            style={{ color: CHARCOAL, fontFamily: "'Cormorant Garamond', serif" }}
          >
            Monthly Revenue (FY 2025-26)
          </h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={monthlyBarData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: WARM_GREY, fontFamily: "'DM Mono', monospace" }}
                tickLine={false}
                axisLine={{ stroke: BORDER }}
              />
              <YAxis
                tickFormatter={(v: number) => {
                  if (v >= 10_000_000) return (v / 10_000_000).toFixed(0) + "Cr";
                  if (v >= 100_000) return (v / 100_000).toFixed(0) + "L";
                  return v.toString();
                }}
                tick={{ fontSize: 10, fill: WARM_GREY, fontFamily: "'DM Mono', monospace" }}
                tickLine={false}
                axisLine={false}
                width={45}
              />
              <Tooltip content={<BarTooltipContent />} />
              <Bar dataKey="revenue" fill={GOLD} radius={[3, 3, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Category Revenue Pie + Location Stock Pie ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <IntelPieChart
          title="Revenue by Category"
          data={catPieData}
          onSliceClick={handleCatClick}
        />
        <IntelPieChart
          title="Stock by Location"
          data={locPieData}
          valueFormatter={(v) => fmtN(v) + " items"}
          onSliceClick={handleLocClick}
        />
      </div>

      {/* ── Returns Section ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <IntelPieChart
          title="Returns by Category"
          data={returnsByCatData}
          colors={PIE_COLORS}
        />
        <IntelPieChart
          title="Returns by Channel"
          data={returnsByBdmData}
          colors={PIE_COLORS.slice(3)}
        />
      </div>

      {/* Net Sales by Category Table */}
      <div className="bg-white border border-[#D4C9A8] rounded-lg p-5 shadow-sm">
        <h3
          className="text-[16px] font-medium mb-4"
          style={{ color: CHARCOAL, fontFamily: "'Cormorant Garamond', serif" }}
        >
          Net Sales by Category
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ fontFamily: "'DM Mono', monospace" }}>
            <thead>
              <tr className="border-b" style={{ borderColor: BORDER, backgroundColor: "#F5F1E8" }}>
                <th className="text-left py-2 pr-4 font-medium text-[9.5px] tracking-[1.5px] uppercase" style={{ color: WARM_GREY }}>
                  Category
                </th>
                <th className="text-right py-2 px-3 font-medium text-[9.5px] tracking-[1.5px] uppercase" style={{ color: WARM_GREY }}>
                  Gross Sales
                </th>
                <th className="text-right py-2 px-3 font-medium text-[9.5px] tracking-[1.5px] uppercase" style={{ color: WARM_GREY }}>
                  Returns
                </th>
                <th className="text-right py-2 px-3 font-medium text-[9.5px] tracking-[1.5px] uppercase" style={{ color: WARM_GREY }}>
                  Return %
                </th>
                <th className="text-right py-2 pl-3 font-medium text-[9.5px] tracking-[1.5px] uppercase" style={{ color: WARM_GREY }}>
                  Net Sales
                </th>
              </tr>
            </thead>
            <tbody>
              {netSalesTable.map((row) => (
                <tr
                  key={row.category}
                  className="border-b last:border-0 hover:bg-[#F5F1E8] transition-colors"
                  style={{ borderColor: "#EDE7D8" }}
                >
                  <td className="py-2.5 pr-4" style={{ color: CHARCOAL, fontFamily: "'Jost', sans-serif", fontSize: 12 }}>
                    {row.category}
                  </td>
                  <td className="text-right py-2.5 px-3 tabular-nums" style={{ color: CHARCOAL }}>
                    {fmt(row.gross)}
                  </td>
                  <td className="text-right py-2.5 px-3 tabular-nums" style={{ color: RED }}>
                    {fmt(row.returns)}
                  </td>
                  <td className="text-right py-2.5 px-3 tabular-nums" style={{ color: row.returnPct > 30 ? RED : WARM_GREY }}>
                    {row.returnPct.toFixed(1)}%
                  </td>
                  <td className="text-right py-2.5 pl-3 tabular-nums font-medium" style={{ color: GREEN }}>
                    {fmt(row.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Action Alerts ── */}
      <div>
        <h3
          className="text-[16px] font-medium mb-3"
          style={{ color: CHARCOAL, fontFamily: "'Cormorant Garamond', serif" }}
        >
          Action Alerts
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <AlertCard
            title="Non-Moving"
            count={deadStockCount}
            description="Items aged 270+ days"
            color={RED}
            icon={<AlertTriangle className="w-5 h-5" />}
            actionLabel="Review Non-Moving"
            onAction={() => setActivePage("skuintel")}
          />
          <AlertCard
            title="Slow Moving"
            count={slowMovingCount}
            description="Items aged 91-180 days"
            color={AMBER}
            icon={<TrendingDown className="w-5 h-5" />}
            actionLabel="View Slow Moving"
            onAction={() => setActivePage("inventory")}
          />
          <AlertCard
            title="Memo Stock"
            count={memoCount}
            description="Items currently on memo"
            color={BLUE}
            icon={<Package className="w-5 h-5" />}
            actionLabel="Track Memo Items"
            onAction={() => setActivePage("dispatch")}
          />
        </div>
      </div>
    </div>
  );
}
