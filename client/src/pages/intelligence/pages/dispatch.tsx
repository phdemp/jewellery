import { useState, useMemo } from "react";
import { DATA } from "../lib/intelligence-data";
import { fmt, getDriveImgUrl, ageTagClass, generateKitId, downloadCSV } from "../lib/intelligence-utils";
import { useIntelligence } from "../intelligence-context";
import { cn } from "@/lib/utils";
import type { DispatchKit, TransferSuggestion } from "../lib/intelligence-types";
import { useQuery } from "@tanstack/react-query";
import { fetchStockSummary } from "@/lib/api";

type Tab = "exhibition" | "bdm" | "store" | "approval";

const STATUS_DOT: Record<string, string> = {
  pending_approval: "bg-[#C9A84C]",
  prepared: "bg-[#4A7C59]",
  rejected: "bg-[#A63C2A]",
};

export default function DispatchPlanner() {
  const { kitQueue, setKitQueue, logAudit } = useIntelligence();

  const [activeTab, setActiveTab] = useState<Tab>("exhibition");

  // Store Transfer state
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [transferCatFilter, setTransferCatFilter] = useState("");
  const [transferSort, setTransferSort] = useState("priority");

  // Kit Approval state
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [typeFilter, setTypeFilter] = useState<string>("All");

  // BDM filter
  const [bdmFilter, setBdmFilter] = useState("");

  // Use live locations from summary if available
  const { data: liveSummary } = useQuery({
    queryKey: ["stock-summary"],
    queryFn: fetchStockSummary,
  });

  const locations = useMemo(() => {
    if (liveSummary?.locationBreakdown?.length) {
      return liveSummary.locationBreakdown
        .map((l) => l.location)
        .filter(Boolean)
        .sort();
    }
    return (DATA.locationStock || []).map((l) => l["Location Name"]);
  }, [liveSummary]);

  const bdmKeys = useMemo(() => Object.keys(DATA.bdmStates || {}), []);

  // ---- Exhibition Tab ----
  const exhibitionKits = useMemo(
    () =>
      kitQueue.filter(
        (k) => k.kind === "exhibition" && k.status === "prepared",
      ),
    [kitQueue],
  );

  // ---- BDM Tab ----
  const bdmKits = useMemo(() => {
    let kits = kitQueue.filter((k) => k.kind === "bdm");
    if (bdmFilter) kits = kits.filter((k) => k.bdm === bdmFilter);
    return kits;
  }, [kitQueue, bdmFilter]);

  const bdmPerformance = useMemo(() => DATA.bdmPerformance || [], []);

  // ---- Store Transfer Tab ----
  const transferSuggestions = useMemo(() => {
    let items = ([...(DATA.transferSuggestions || [])] as unknown) as TransferSuggestion[];
    if (fromLocation)
      items = items.filter((t) => t.fromLocation === fromLocation);
    if (toLocation) items = items.filter((t) => t.toLocation === toLocation);
    if (transferCatFilter)
      items = items.filter((t) => t.category === transferCatFilter);
    if (transferSort === "priority") {
      items.sort((a, b) => {
        const p = { HIGH: 0, MEDIUM: 1 };
        return (p[a.priority] ?? 2) - (p[b.priority] ?? 2);
      });
    } else if (transferSort === "qty") {
      items.sort((a, b) => b.suggestQty - a.suggestQty);
    }
    return items;
  }, [fromLocation, toLocation, transferCatFilter, transferSort]);

  const transferKits = useMemo(
    () => kitQueue.filter((k) => k.kind === "transfer" && k.status === "prepared"),
    [kitQueue],
  );

  const transferCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const t of DATA.transferSuggestions || []) {
      cats.add(t.category);
    }
    return Array.from(cats).sort();
  }, []);

  // ---- Kit Approval Tab ----
  const approvalQueue = useMemo(() => {
    let kits = [...kitQueue];
    if (statusFilter !== "All") {
      const statusMap: Record<string, string> = {
        Pending: "pending_approval",
        Approved: "prepared",
        Rejected: "rejected",
      };
      kits = kits.filter((k) => k.status === statusMap[statusFilter]);
    }
    if (typeFilter !== "All") {
      const kindMap: Record<string, string> = {
        BDM: "bdm",
        Exhibition: "exhibition",
        Transfer: "transfer",
      };
      kits = kits.filter((k) => k.kind === kindMap[typeFilter]);
    }
    return kits;
  }, [kitQueue, statusFilter, typeFilter]);

  const queueSummary = useMemo(() => {
    const pending = kitQueue.filter((k) => k.status === "pending_approval").length;
    const approved = kitQueue.filter((k) => k.status === "prepared").length;
    const rejected = kitQueue.filter((k) => k.status === "rejected").length;
    return { pending, approved, rejected, total: kitQueue.length };
  }, [kitQueue]);

  function handleApproveKit(kitId: string) {
    setKitQueue(
      kitQueue.map((k) =>
        k.id === kitId
          ? {
              ...k,
              status: "prepared" as const,
              approvedBy: "Merchandiser",
              approvedAt: new Date().toISOString(),
            }
          : k,
      ),
    );
    logAudit("kit_approved", kitId, "Kit approved for dispatch");
  }

  function handleRejectKit(kitId: string) {
    setKitQueue(
      kitQueue.map((k) =>
        k.id === kitId
          ? { ...k, status: "rejected" as const }
          : k,
      ),
    );
    logAudit("kit_rejected", kitId, "Kit rejected");
  }

  // ---- Render Tabs ----

  const tabs: { key: Tab; label: string }[] = [
    { key: "exhibition", label: "Exhibition Dispatch" },
    { key: "bdm", label: "BDM Dispatch" },
    { key: "store", label: "Store Transfer" },
    { key: "approval", label: "Kit Approval" },
  ];

  function renderKitRow(kit: DispatchKit) {
    return (
      <div
        key={kit.id}
        className="flex items-center justify-between p-3 border border-[#D4C9A8] rounded mb-2 bg-white hover:border-[#C9A84C] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              STATUS_DOT[kit.status] || "bg-[#999]",
            )}
          />
          <div>
            <div className="text-[13px] font-semibold text-[#2C2520]">
              {kit.id}
            </div>
            <div className="text-[11px] text-[#6B6458]">
              {kit.kind.toUpperCase()}
              {kit.bdm ? ` - ${kit.bdm}` : ""}
              {kit.targetClient ? ` - ${kit.targetClient}` : ""}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[13px] font-medium text-[#2C2520]">
              {kit.items.length} items
            </div>
            <div className="text-[12px] text-[#C9A84C] font-medium">
              {fmt(kit.totalValue)}
            </div>
          </div>

          <span
            className={cn(
              "text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider",
              kit.status === "prepared"
                ? "bg-[#E8F5EC] text-[#2D6B42]"
                : kit.status === "rejected"
                  ? "bg-[#FDEAEA] text-[#8B1A1A]"
                  : "bg-[#FFF4E0] text-[#8B5E00]",
            )}
          >
            {kit.status.replace("_", " ")}
          </span>
        </div>
      </div>
    );
  }

  function renderExhibitionTab() {
    if (exhibitionKits.length === 0) {
      return (
        <div className="text-center py-16 text-[#6B6458]">
          <div className="text-[16px] font-medium mb-2">
            No exhibition kits prepared yet
          </div>
          <div className="text-[13px]">
            Use the Smart Assortment Planner to build and approve exhibition kits.
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {exhibitionKits.map(renderKitRow)}
      </div>
    );
  }

  function renderBdmTab() {
    return (
      <div className="space-y-4">
        {/* BDM Filter */}
        <div className="flex items-center gap-3">
          <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
            Filter by BDM
          </label>
          <select
            value={bdmFilter}
            onChange={(e) => setBdmFilter(e.target.value)}
            className="text-[13px] px-3 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
          >
            <option value="">All BDMs</option>
            {bdmKeys.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        {/* BDM Performance Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {bdmPerformance.slice(0, 6).map((bdm) => (
            <div
              key={bdm.SalesPersonName}
              className="p-4 border border-[#D4C9A8] rounded-lg bg-white"
            >
              <div className="text-[14px] font-semibold text-[#2C2520] mb-2">
                {bdm.SalesPersonName}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <div>
                  <span className="text-[#6B6458]">Revenue:</span>{" "}
                  <span className="font-medium text-[#8B6914]">
                    {fmt(bdm.revenue)}
                  </span>
                </div>
                <div>
                  <span className="text-[#6B6458]">Sold:</span>{" "}
                  <span className="font-medium">{bdm.sold_count}</span>
                </div>
                <div>
                  <span className="text-[#6B6458]">Avg Order:</span>{" "}
                  <span className="font-medium">{fmt(bdm.avg_order)}</span>
                </div>
                <div>
                  <span className="text-[#6B6458]">Clients:</span>{" "}
                  <span className="font-medium">{bdm.clients}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* BDM Kits */}
        <div>
          <h3 className="text-[14px] font-semibold text-[#2C2520] mb-2">
            Approved BDM Kits ({bdmKits.length})
          </h3>
          {bdmKits.length === 0 ? (
            <div className="text-[13px] text-[#6B6458] py-6 text-center">
              No BDM kits found. Create kits from the Assortment Planner.
            </div>
          ) : (
            <div className="space-y-2">{bdmKits.map(renderKitRow)}</div>
          )}
        </div>
      </div>
    );
  }

  function renderStoreTransferTab() {
    return (
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
              From
            </label>
            <select
              value={fromLocation}
              onChange={(e) => setFromLocation(e.target.value)}
              className="block text-[13px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
            >
              <option value="">All Locations</option>
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
              To
            </label>
            <select
              value={toLocation}
              onChange={(e) => setToLocation(e.target.value)}
              className="block text-[13px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
            >
              <option value="">All Locations</option>
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
              Category
            </label>
            <select
              value={transferCatFilter}
              onChange={(e) => setTransferCatFilter(e.target.value)}
              className="block text-[13px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
            >
              <option value="">All Categories</option>
              {transferCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
              Sort
            </label>
            <select
              value={transferSort}
              onChange={(e) => setTransferSort(e.target.value)}
              className="block text-[13px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
            >
              <option value="priority">Priority</option>
              <option value="qty">Quantity</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
              &nbsp;
            </label>
            <button className="block px-4 py-1.5 bg-[#C9A84C] text-white text-[13px] font-medium rounded hover:bg-[#8B6914] transition-colors">
              Detect Gaps
            </button>
          </div>
        </div>

        {/* Transfer Candidate Table */}
        <div className="border border-[#D4C9A8] rounded-lg overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[#F5F1E8] border-b border-[#D4C9A8]">
                <th className="text-left px-3 py-2 font-medium text-[#6B6458]">
                  Category
                </th>
                <th className="text-left px-3 py-2 font-medium text-[#6B6458]">
                  From
                </th>
                <th className="text-left px-3 py-2 font-medium text-[#6B6458]">
                  To
                </th>
                <th className="text-center px-3 py-2 font-medium text-[#6B6458]">
                  Qty
                </th>
                <th className="text-center px-3 py-2 font-medium text-[#6B6458]">
                  Priority
                </th>
                <th className="text-left px-3 py-2 font-medium text-[#6B6458]">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody>
              {transferSuggestions.map((t, idx) => (
                <tr
                  key={idx}
                  className="border-b border-[#EDE7D8] hover:bg-[#F5F1E8]"
                >
                  <td className="px-3 py-2 font-medium text-[#2C2520]">
                    {t.category}
                  </td>
                  <td className="px-3 py-2 text-[#6B6458]">{t.fromLocation}</td>
                  <td className="px-3 py-2 text-[#6B6458]">{t.toLocation}</td>
                  <td className="px-3 py-2 text-center font-medium">
                    {t.suggestQty}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-medium uppercase",
                        t.priority === "HIGH"
                          ? "bg-[#FDEAEA] text-[#8B1A1A]"
                          : "bg-[#FFF4E0] text-[#8B5E00]",
                      )}
                    >
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[12px] text-[#6B6458]">
                    {t.reason}
                  </td>
                </tr>
              ))}
              {transferSuggestions.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-[#6B6458]"
                  >
                    No transfer suggestions match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Approved Transfer Kits */}
        {transferKits.length > 0 && (
          <div>
            <h3 className="text-[14px] font-semibold text-[#2C2520] mb-2">
              Approved Transfer Kits ({transferKits.length})
            </h3>
            <div className="space-y-2">{transferKits.map(renderKitRow)}</div>
          </div>
        )}
      </div>
    );
  }

  function renderApprovalTab() {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Main Queue */}
        <div className="lg:col-span-3 space-y-3">
          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-[13px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
              >
                {["All", "Pending", "Approved", "Rejected"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-medium text-[#6B6458] uppercase tracking-wider">
                Type
              </label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="text-[13px] px-2 py-1.5 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
              >
                {["All", "BDM", "Exhibition", "Transfer"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Kit Queue */}
          {approvalQueue.length === 0 ? (
            <div className="text-center py-12 text-[#6B6458] text-[14px]">
              No kits in the approval queue matching the current filters.
            </div>
          ) : (
            <div className="space-y-2">
              {approvalQueue.map((kit) => (
                <div
                  key={kit.id}
                  className="flex items-center justify-between p-3 border border-[#D4C9A8] rounded mb-2 bg-white hover:border-[#C9A84C] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full",
                        STATUS_DOT[kit.status] || "bg-[#999]",
                      )}
                    />
                    <div>
                      <div className="text-[13px] font-semibold text-[#2C2520]">
                        {kit.id}
                      </div>
                      <div className="text-[11px] text-[#6B6458]">
                        {kit.kind.toUpperCase()}
                        {kit.bdm ? ` - ${kit.bdm}` : ""}
                        {kit.targetClient ? ` for ${kit.targetClient}` : ""}
                        {" | "}
                        {kit.items.length} items | {fmt(kit.totalValue)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {kit.status === "pending_approval" && (
                      <>
                        <button
                          onClick={() => handleApproveKit(kit.id)}
                          className="px-3 py-1.5 bg-[#4A7C59] text-white text-[12px] font-medium rounded hover:bg-[#3D6B4C] transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectKit(kit.id)}
                          className="px-3 py-1.5 bg-[#A63C2A] text-white text-[12px] font-medium rounded hover:bg-[#8B2F22] transition-colors"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    <span
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider",
                        kit.status === "prepared"
                          ? "bg-[#E8F5EC] text-[#2D6B42]"
                          : kit.status === "rejected"
                            ? "bg-[#FDEAEA] text-[#8B1A1A]"
                            : "bg-[#FFF4E0] text-[#8B5E00]",
                      )}
                    >
                      {kit.status.replace("_", " ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Queue Summary Sidebar */}
        <div className="space-y-3">
          <div className="p-4 border border-[#D4C9A8] rounded-lg bg-white">
            <h3 className="text-[14px] font-semibold text-[#2C2520] mb-3">
              Queue Summary
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-[#6B6458]">Total Kits</span>
                <span className="font-semibold text-[#2C2520]">
                  {queueSummary.total}
                </span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#C9A84C]" />
                  <span className="text-[#6B6458]">Pending</span>
                </div>
                <span className="font-semibold text-[#8B5E00]">
                  {queueSummary.pending}
                </span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#4A7C59]" />
                  <span className="text-[#6B6458]">Approved</span>
                </div>
                <span className="font-semibold text-[#2D6B42]">
                  {queueSummary.approved}
                </span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#A63C2A]" />
                  <span className="text-[#6B6458]">Rejected</span>
                </div>
                <span className="font-semibold text-[#8B1A1A]">
                  {queueSummary.rejected}
                </span>
              </div>
            </div>
          </div>

          {/* Kit type breakdown */}
          <div className="p-4 border border-[#D4C9A8] rounded-lg bg-white">
            <h3 className="text-[13px] font-semibold text-[#2C2520] mb-2">
              By Type
            </h3>
            <div className="space-y-1.5 text-[12px]">
              {(["bdm", "exhibition", "transfer"] as const).map((kind) => {
                const count = kitQueue.filter((k) => k.kind === kind).length;
                return (
                  <div
                    key={kind}
                    className="flex items-center justify-between"
                  >
                    <span className="text-[#6B6458] uppercase">{kind}</span>
                    <span className="font-medium text-[#2C2520]">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div style={{ height: 2, background: "linear-gradient(90deg, #C9A84C, transparent)", marginBottom: 20, borderRadius: 1 }} />
      {/* Tab Selector */}
      <div className="flex items-center gap-0">
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-5 py-[10px] text-[13px] font-medium border transition-colors",
              i === 0 && "rounded-l-[4px]",
              i === tabs.length - 1 && "rounded-r-[4px]",
              i > 0 && "border-l-0",
              activeTab === tab.key
                ? "bg-[#C9A84C] text-[#1A1814] border-[#C9A84C]"
                : "bg-white text-[#6B6458] border-[#D4C9A8] hover:bg-[#F5F1E8]",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "exhibition" && renderExhibitionTab()}
      {activeTab === "bdm" && renderBdmTab()}
      {activeTab === "store" && renderStoreTransferTab()}
      {activeTab === "approval" && renderApprovalTab()}
    </div>
  );
}
