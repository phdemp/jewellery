import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSalesData } from "@/lib/api";
import { fmt, fmtN } from "../lib/intelligence-utils";
import { cn } from "@/lib/utils";
import { SALES_PER_PAGE } from "../lib/intelligence-constants";
import { Search, IndianRupee, CalendarDays, Store, Tag, Loader2 } from "lucide-react";

/* ---------- helpers ---------- */

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse "YYYY-MM" to short month name, e.g. "2025-04" -> "Apr" */
function monthLabel(monthStr: string): string {
  const parts = monthStr.split("-");
  const moNum = parseInt(parts[1], 10);
  return MONTH_SHORT[moNum - 1] || monthStr;
}

function pct(value: number, max: number): number {
  return max > 0 ? (value / max) * 100 : 0;
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/* ---------- stat card ---------- */

interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
}

function StatCard({ label, value, sub, icon }: StatCardProps) {
  return (
    <div className="rounded-lg border border-[#D4C9A8] bg-white p-5">
      <div className="flex items-start justify-between">
        <div>
          <p
            className="text-[9px] tracking-[1.8px] text-[#6B6458] mb-1"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            {label}
          </p>
          <p
            className="text-[30px] font-medium text-[#1A1814]"
            style={{ fontFamily: "'Jost', sans-serif" }}
          >
            {value}
          </p>
          <p
            className="text-[11px] text-[#6B6458] mt-0.5"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            {sub}
          </p>
        </div>
        <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-[#C9A84C]">
          {icon}
        </div>
      </div>
    </div>
  );
}

/* ---------- horizontal bar list ---------- */

interface BarItem {
  label: string;
  value: number;
  count: number;
}

function HorizontalBarList({
  title,
  items,
  color,
}: {
  title: string;
  items: BarItem[];
  color: string;
}) {
  const maxVal = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="rounded-lg border border-[#D4C9A8] bg-white p-5">
      <h3
        className="text-[15px] font-semibold text-[#1A1814] mb-4"
        style={{ fontFamily: "'Jost', sans-serif" }}
      >
        {title}
      </h3>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] text-[#3D3830] truncate max-w-[55%]">
                {titleCase(item.label)}
              </span>
              <span
                className="text-[11.5px] text-[#8B6914]"
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                {fmt(item.value)} ({fmtN(item.count)})
              </span>
            </div>
            <div className="h-[7px] rounded-[4px] bg-[#F5F1E8] overflow-hidden">
              <div
                className="h-full rounded-[4px] transition-all"
                style={{
                  width: `${pct(item.value, maxVal)}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- main component ---------- */

export default function SalesAnalysis() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-data"],
    queryFn: fetchSalesData,
    staleTime: 15 * 60 * 1000,
  });

  const sales = data?.sales;

  /* sales table — useMemo must be called before any early return */
  const filtered = useMemo(() => {
    if (!sales) return [];
    const q = search.toLowerCase().trim();
    if (!q) return sales;
    return sales.filter(
      (s) =>
        s.clientName.toLowerCase().includes(q) ||
        s.styleCode.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.salesPerson.toLowerCase().includes(q) ||
        s.state.toLowerCase().includes(q)
    );
  }, [sales, search]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-[#C9A84C]" />
        <p className="text-[13px] text-[#6B6458]" style={{ fontFamily: "'DM Mono', monospace" }}>
          Loading live sales data...
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-[14px] text-red-600 font-medium">
          Failed to load sales data
        </p>
        <p className="text-[12px] text-[#6B6458]">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  const { summary, salesChannel, catRevenue, monthly } = data;

  /* channel bars */
  const channelBars: BarItem[] = salesChannel.map((ch) => ({
    label: ch.SalesPersonName,
    value: ch.revenue,
    count: ch.count,
  }));

  /* category bars */
  const categoryBars: BarItem[] = catRevenue.map((cr) => ({
    label: cr.CategoryGroup,
    value: cr.revenue,
    count: cr.count,
  }));

  /* monthly bars */
  const maxMonthly = Math.max(...monthly.map((m) => m.revenue), 1);

  const totalPages = Math.max(1, Math.ceil(filtered.length / SALES_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (safePage - 1) * SALES_PER_PAGE,
    safePage * SALES_PER_PAGE
  );

  /* B2B count = total sold - B2C txns */
  const b2cCount = summary.totalTxns;
  const totalSold = summary.totalRevenue;

  return (
    <div className="space-y-6">
      <div style={{ height: 2, background: "linear-gradient(90deg, #C9A84C, transparent)", marginBottom: 20, borderRadius: 1 }} />
      {/* ---------- stat cards ---------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="TOTAL REVENUE"
          value={fmt(summary.totalRevenue)}
          sub={`${fmtN(b2cCount)} B2C transactions`}
          icon={<IndianRupee className="w-4 h-4" />}
        />
        <StatCard
          label="PEAK MONTH"
          value={summary.peakMonth}
          sub={fmt(summary.peakRevenue)}
          icon={<CalendarDays className="w-4 h-4" />}
        />
        <StatCard
          label="TOP CHANNEL"
          value={summary.topChannel}
          sub={`${fmt(summary.topChannelRevenue)} (${((summary.topChannelRevenue / totalSold) * 100).toFixed(1)}%)`}
          icon={<Store className="w-4 h-4" />}
        />
        <StatCard
          label="TOP CATEGORY"
          value={summary.topCategory}
          sub={`${fmt(summary.topCategoryRevenue)} (${((summary.topCategoryRevenue / totalSold) * 100).toFixed(1)}%)`}
          icon={<Tag className="w-4 h-4" />}
        />
      </div>

      {/* ---------- 2-column: channel + category bars ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HorizontalBarList
          title="Revenue by Sales Channel"
          items={channelBars}
          color="#C9A84C"
        />
        <HorizontalBarList
          title="Revenue by Category"
          items={categoryBars}
          color="#4A7C59"
        />
      </div>

      {/* ---------- monthly revenue trend ---------- */}
      <div className="rounded-lg border border-[#D4C9A8] bg-white p-5">
        <h3
          className="text-[15px] font-semibold text-[#1A1814] mb-4"
          style={{ fontFamily: "'Jost', sans-serif" }}
        >
          Monthly Revenue Trend (FY 2025-26)
        </h3>
        <div className="flex items-end gap-2" style={{ height: 180 }}>
          {monthly.map((m) => {
            const h = pct(m.revenue, maxMonthly);
            const label = monthLabel(m.month_str);
            return (
              <div
                key={m.month_str}
                className="flex-1 flex flex-col items-center gap-1"
              >
                <span
                  className="text-[9px] text-[#6B6458]"
                  style={{ fontFamily: "'DM Mono', monospace" }}
                >
                  {fmt(m.revenue).replace("₹", "")}
                </span>
                <div className="w-full flex justify-center">
                  <div
                    className="w-full max-w-[40px] rounded-t"
                    style={{
                      height: `${Math.max(h * 1.4, 4)}px`,
                      backgroundColor: "#C9A84C",
                      opacity: 0.85,
                    }}
                  />
                </div>
                <span
                  className="text-[10px] text-[#6B6458]"
                  style={{ fontFamily: "'DM Mono', monospace" }}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------- sales transactions table ---------- */}
      <div className="rounded-lg border border-[#D4C9A8] bg-white">
        <div className="flex items-center justify-between p-4 border-b border-[#D4C9A8]">
          <h3
            className="text-[15px] font-semibold text-[#1A1814]"
            style={{ fontFamily: "'Jost', sans-serif" }}
          >
            Sales Transactions
          </h3>

          {/* search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6B6458]/50" />
            <input
              type="text"
              placeholder="Search client, style, category..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className={cn(
                "h-8 w-64 pl-8 pr-3 rounded-md border border-[#D4C9A8] bg-white",
                "text-[12px] text-[#3D3830] placeholder:text-[#6B6458]/40",
                "focus:outline-none focus:ring-1 focus:ring-[#C9A84C]/40"
              )}
            />
          </div>
        </div>

        {/* table */}
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#D4C9A8] bg-[#F5F1E8]">
                {[
                  "Date",
                  "Client Name",
                  "State",
                  "Style Code",
                  "Category",
                  "Channel",
                  "Trans Price",
                  "Tag Price",
                  "Stock",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left font-medium text-[#6B6458] whitespace-nowrap"
                    style={{ fontFamily: "'DM Mono', monospace", fontSize: 10.5, letterSpacing: "1.5px", textTransform: "uppercase" as const }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, idx) => (
                <tr
                  key={`${row.styleCode}-${row.transDate}-${idx}`}
                  className="border-b border-[#F5F1E8] hover:bg-[#F5F1E8] transition-colors"
                >
                  <td className="px-3 py-2 whitespace-nowrap text-[#6B6458]">
                    {row.transDate}
                  </td>
                  <td className="px-3 py-2 text-[#3D3830] font-medium max-w-[160px] truncate">
                    {row.clientName}
                  </td>
                  <td className="px-3 py-2 text-[#6B6458]">{row.state}</td>
                  <td
                    className="px-3 py-2 text-[#3D3830]"
                    style={{ fontFamily: "'DM Mono', monospace", fontSize: 11 }}
                  >
                    {row.styleCode}
                  </td>
                  <td className="px-3 py-2 text-[#6B6458]">
                    {titleCase(row.category)}
                  </td>
                  <td className="px-3 py-2 text-[#6B6458]">
                    {row.salesPerson}
                  </td>
                  <td
                    className="px-3 py-2 text-[#8B6914] text-right"
                    style={{ fontFamily: "'DM Mono', monospace" }}
                  >
                    {fmt(row.transPrice)}
                  </td>
                  <td
                    className="px-3 py-2 text-[#6B6458] text-right"
                    style={{ fontFamily: "'DM Mono', monospace" }}
                  >
                    {fmt(row.tagPrice)}
                  </td>
                  <td className="px-3 py-2 text-[#6B6458]">{row.stock}</td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-8 text-center text-[#6B6458]/50"
                  >
                    No transactions found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#D4C9A8]">
            <span
              className="text-[11px] text-[#6B6458]"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              Showing {(safePage - 1) * SALES_PER_PAGE + 1}--
              {Math.min(safePage * SALES_PER_PAGE, filtered.length)} of{" "}
              {fmtN(filtered.length)}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className={cn(
                  "h-7 px-2.5 rounded text-[11px] border border-[#D4C9A8]",
                  safePage <= 1
                    ? "text-[#6B6458]/30 cursor-not-allowed"
                    : "text-[#3D3830] hover:bg-[#F5F1E8]"
                )}
              >
                Prev
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i + 1;
                } else if (safePage <= 4) {
                  pageNum = i + 1;
                } else if (safePage >= totalPages - 3) {
                  pageNum = totalPages - 6 + i;
                } else {
                  pageNum = safePage - 3 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={cn(
                      "h-7 w-7 rounded text-[11px] border",
                      safePage === pageNum
                        ? "bg-[#C9A84C] text-[#1A1814] border-[#C9A84C]"
                        : "border-[#D4C9A8] text-[#3D3830] hover:bg-[#F5F1E8]"
                    )}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className={cn(
                  "h-7 px-2.5 rounded text-[11px] border border-[#D4C9A8]",
                  safePage >= totalPages
                    ? "text-[#6B6458]/30 cursor-not-allowed"
                    : "text-[#3D3830] hover:bg-[#F5F1E8]"
                )}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
