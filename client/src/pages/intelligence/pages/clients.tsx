import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSalesData } from "@/lib/api";
import { fmt, fmtN, aggregateClientsFromSales } from "../lib/intelligence-utils";
import { cn } from "@/lib/utils";
import { CLIENTS_PER_PAGE } from "../lib/intelligence-constants";
import { Users, Snowflake, IndianRupee, RotateCcw, Search, Loader2 } from "lucide-react";

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

/* ---------- client card ---------- */

interface ClientCardProps {
  name: string;
  totalSpend: number;
  txnCount: number;
  avgOrder: number;
  topCats: string[];
  lastPurchase: string;
  daysSince: number;
  isCold: boolean;
}

function ClientCard({
  name,
  totalSpend,
  txnCount,
  avgOrder,
  topCats,
  lastPurchase,
  daysSince,
  isCold,
}: ClientCardProps) {
  return (
    <div className="border border-[#D4C9A8] rounded-lg p-4 bg-white hover:shadow transition cursor-pointer">
      {/* header */}
      <div className="flex items-start justify-between mb-2">
        <h4
          className="text-[15px] font-medium text-[#1A1814] leading-tight"
          style={{ fontFamily: "'Jost', sans-serif" }}
        >
          {name}
        </h4>
        {isCold && (
          <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-[#E8F0FE] text-[#1A56CC]">
            <Snowflake className="w-2.5 h-2.5" />
            Cold
          </span>
        )}
      </div>

      {/* spend */}
      <p
        className="text-sm text-[#8B6914] mb-2"
        style={{ fontFamily: "'DM Mono', monospace" }}
      >
        {fmt(totalSpend)}
      </p>

      {/* meta row */}
      <div className="flex items-center gap-3 mb-2.5">
        <span
          className="text-[11.5px] text-[#6B6458]"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          {fmtN(txnCount)} txns
        </span>
        <span className="text-[#D4C9A8]">|</span>
        <span
          className="text-[11.5px] text-[#6B6458]"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          Avg {fmt(avgOrder)}
        </span>
      </div>

      {/* top categories */}
      {topCats.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-2.5">
          {topCats.slice(0, 4).map((cat) => (
            <span
              key={cat}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(201,168,76,0.12)] text-[#8B6914]"
            >
              {cat}
            </span>
          ))}
          {topCats.length > 4 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F5F1E8] text-[#6B6458]">
              +{topCats.length - 4}
            </span>
          )}
        </div>
      )}

      {/* last purchase */}
      <div className="flex items-center justify-between pt-2 border-t border-[#F5F1E8]">
        <span
          className="text-[11.5px] text-[#6B6458]"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          Last: {lastPurchase}
        </span>
        <span
          className={cn(
            "text-[11.5px]",
            daysSince > 180
              ? "text-[#A63C2A]"
              : daysSince > 90
                ? "text-[#C4862B]"
                : "text-[#6B6458]"
          )}
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          {daysSince}d ago
        </span>
      </div>
    </div>
  );
}

/* ---------- main component ---------- */

export default function ClientProfiles() {
  const [activeTab, setActiveTab] = useState<"all" | "cold">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-data"],
    queryFn: fetchSalesData,
    staleTime: 15 * 60 * 1000,
  });

  const clients = useMemo(
    () => (data?.sales ? aggregateClientsFromSales(data.sales) : []),
    [data]
  );

  const coldClients = useMemo(
    () => clients.filter((c) => c.isCold),
    [clients]
  );

  const totalClients = clients.length;
  const coldCount = coldClients.length;
  /* avg order value across all transactions, from live summary */
  const avgOrderValue =
    data && data.summary.totalTxns > 0
      ? Math.round(data.summary.totalRevenue / data.summary.totalTxns)
      : 0;

  /* re-engage: cold clients that were previously high spenders (above avg order) */
  const reEngageCount = useMemo(
    () => coldClients.filter((c) => c.avgOrder >= avgOrderValue).length,
    [coldClients, avgOrderValue]
  );

  /* filter + search */
  const baseList = activeTab === "cold" ? coldClients : clients;

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return baseList;
    return baseList.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.topCats.some((cat) => cat.toLowerCase().includes(q)) ||
        (c.stateName && c.stateName.toLowerCase().includes(q)) ||
        (c.city && c.city.toLowerCase().includes(q))
    );
  }, [baseList, search]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-[#C9A84C]" />
        <p className="text-[13px] text-[#6B6458]" style={{ fontFamily: "'DM Mono', monospace" }}>
          Loading live client data...
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-[14px] text-red-600 font-medium">
          Failed to load client data
        </p>
        <p className="text-[12px] text-[#6B6458]">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / CLIENTS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageClients = filtered.slice(
    (safePage - 1) * CLIENTS_PER_PAGE,
    safePage * CLIENTS_PER_PAGE
  );

  return (
    <div className="space-y-6">
      <div style={{ height: 2, background: "linear-gradient(90deg, #C9A84C, transparent)", marginBottom: 20, borderRadius: 1 }} />
      {/* ---------- stat cards ---------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="TOTAL CLIENTS"
          value={fmtN(totalClients)}
          sub="Unique buyers FY 25-26"
          icon={<Users className="w-4 h-4" />}
        />
        <StatCard
          label="COLD CLIENTS (90+ DAYS)"
          value={fmtN(coldCount)}
          sub={`${((coldCount / Math.max(totalClients, 1)) * 100).toFixed(1)}% of total`}
          icon={<Snowflake className="w-4 h-4" />}
        />
        <StatCard
          label="AVG ORDER VALUE"
          value={fmt(avgOrderValue)}
          sub="Across all transactions"
          icon={<IndianRupee className="w-4 h-4" />}
        />
        <StatCard
          label="RE-ENGAGE OPPORTUNITY"
          value={fmtN(reEngageCount)}
          sub="Cold clients above avg order"
          icon={<RotateCcw className="w-4 h-4" />}
        />
      </div>

      {/* ---------- tabs + search ---------- */}
      <div className="flex items-center justify-between">
        {/* tabs */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F5F1E8] border border-[#D4C9A8]">
          <button
            onClick={() => {
              setActiveTab("all");
              setPage(1);
            }}
            className={cn(
              "px-4 py-1.5 rounded-md text-[12px] transition-colors",
              activeTab === "all"
                ? "bg-white text-[#1A1814] shadow-sm font-medium"
                : "text-[#6B6458] hover:text-[#3D3830]"
            )}
          >
            All Clients
          </button>
          <button
            onClick={() => {
              setActiveTab("cold");
              setPage(1);
            }}
            className={cn(
              "px-4 py-1.5 rounded-md text-[12px] transition-colors flex items-center gap-1.5",
              activeTab === "cold"
                ? "bg-white text-[#1A1814] shadow-sm font-medium"
                : "text-[#6B6458] hover:text-[#3D3830]"
            )}
          >
            Cold Clients
            <span
              className={cn(
                "text-[10px] px-1.5 py-0 rounded-full",
                activeTab === "cold"
                  ? "bg-[#E8F0FE] text-[#1A56CC]"
                  : "bg-[#D4C9A8] text-[#6B6458]"
              )}
            >
              {coldCount}
            </span>
          </button>
        </div>

        {/* search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6B6458]/50" />
          <input
            type="text"
            placeholder="Search client, category, state..."
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

      {/* ---------- client grid ---------- */}
      {pageClients.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pageClients.map((c) => (
            <ClientCard
              key={c.name}
              name={c.name}
              totalSpend={c.totalSpend}
              txnCount={c.txnCount}
              avgOrder={c.avgOrder}
              topCats={[...c.topCats]}
              lastPurchase={c.lastPurchase}
              daysSince={c.daysSince}
              isCold={c.isCold}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center h-40 rounded-lg border border-dashed border-[#D4C9A8] bg-white">
          <p className="text-[13px] text-[#6B6458]/50">No clients match your search</p>
        </div>
      )}

      {/* ---------- pagination ---------- */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span
            className="text-[11px] text-[#6B6458]"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            Showing {(safePage - 1) * CLIENTS_PER_PAGE + 1}--
            {Math.min(safePage * CLIENTS_PER_PAGE, filtered.length)} of{" "}
            {fmtN(filtered.length)} clients
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
  );
}
