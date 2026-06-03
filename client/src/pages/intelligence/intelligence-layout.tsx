import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useIntelligence } from "./intelligence-context";
import { PAGE_TITLES } from "./lib/intelligence-constants";
import type { PageId } from "./lib/intelligence-types";
import {
  LayoutDashboard, Package, BarChart3, TrendingUp, Users,
  ClipboardList, Grid3X3, ArrowRight, Scissors, FileBarChart,
  Download, ScrollText, Plus, Lightbulb, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchLastSync, triggerStockSync } from "@/lib/api";

interface NavItem {
  id: PageId;
  label: string;
  icon: ReactNode;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "OVERVIEW",
    items: [
      { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
    ],
  },
  {
    title: "INVENTORY",
    items: [
      { id: "inventory", label: "Inventory", icon: <Package className="w-4 h-4" /> },
      { id: "skuintel", label: "SKU Intelligence", icon: <BarChart3 className="w-4 h-4" />, badge: "427" },
      { id: "inventory_suggestions", label: "Suggestions", icon: <Lightbulb className="w-4 h-4" /> },
    ],
  },
  {
    title: "SALES",
    items: [
      { id: "sales", label: "Sales Analysis", icon: <TrendingUp className="w-4 h-4" /> },
      { id: "clients", label: "Client Profiles", icon: <Users className="w-4 h-4" /> },
    ],
  },
  {
    title: "DISPATCH",
    items: [
      { id: "assortment", label: "Assortment Planner", icon: <ClipboardList className="w-4 h-4" /> },
      { id: "catalogue", label: "Visual Catalogue", icon: <Grid3X3 className="w-4 h-4" /> },
      { id: "dispatch", label: "Dispatch Planner", icon: <ArrowRight className="w-4 h-4" /> },
      { id: "lonepieces", label: "Lone Pieces", icon: <Scissors className="w-4 h-4" /> },
      { id: "recommendations", label: "Recommendations", icon: <Lightbulb className="w-4 h-4" /> },
    ],
  },
  {
    title: "REPORTS",
    items: [
      { id: "reports", label: "Reports", icon: <FileBarChart className="w-4 h-4" /> },
    ],
  },
];

function Sidebar() {
  const { activePage, setActivePage } = useIntelligence();

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 flex flex-col"
      style={{
        width: 220,
        backgroundColor: "#1A1814",
        zIndex: 100,
      }}
    >
      {/* Brand header */}
      <div style={{ padding: "24px 20px 18px", borderBottom: "1px solid rgba(201,168,76,0.2)" }}>
        <h1
          className="uppercase"
          style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, fontWeight: 500, color: "#E8D5A3", letterSpacing: 2 }}
        >
          Raniwala 1881
        </h1>
        <p
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: "8.5px",
            color: "#6B6458",
            letterSpacing: 2,
            textTransform: "uppercase",
            marginTop: 3,
          }}
        >
          Intelligence Platform
        </p>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto" style={{ padding: "12px 0" }}>
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: "8.5px",
                color: "rgba(201,168,76,0.4)",
                letterSpacing: "2.5px",
                textTransform: "uppercase",
                padding: "12px 20px 5px",
              }}
            >
              {section.title}
            </p>
            {section.items.map((item) => {
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActivePage(item.id)}
                  className="w-full flex items-center relative"
                  style={{
                    gap: 9,
                    padding: "9px 20px",
                    color: isActive ? "#C9A84C" : "rgba(250,247,240,0.5)",
                    background: isActive ? "rgba(201,168,76,0.1)" : "transparent",
                    fontFamily: "'Jost', sans-serif",
                    fontSize: "12.5px",
                    fontWeight: 300,
                    letterSpacing: "0.3px",
                    transition: "all 0.18s",
                    cursor: "pointer",
                    border: "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = "#E8D5A3";
                      e.currentTarget.style.background = "rgba(201,168,76,0.06)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = "rgba(250,247,240,0.5)";
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  {isActive && (
                    <span className="absolute left-0 top-0 bottom-0" style={{ width: 3, background: "#C9A84C" }} />
                  )}
                  <span style={{ width: 15, height: 15, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {item.icon}
                  </span>
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge && (
                    <span
                      style={{
                        background: "#A63C2A",
                        color: "white",
                        borderRadius: 10,
                        fontSize: "9px",
                        padding: "1px 5px",
                        fontWeight: 500,
                        marginLeft: "auto",
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Sidebar footer */}
      <div style={{ padding: "14px 20px", borderTop: "1px solid rgba(201,168,76,0.1)" }}>
        <p
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: "8.5px",
            color: "rgba(107,100,88,0.5)",
            letterSpacing: "1.5px",
          }}
        >
          FY 2025-26 &middot; LIVE DATA
        </p>
      </div>
    </aside>
  );
}

function Topbar() {
  const { activePage, auditLog, kitQueue } = useIntelligence();
  const title = PAGE_TITLES[activePage] || "Dashboard";
  const queryClient = useQueryClient();

  const { data: syncData } = useQuery({
    queryKey: ["last-sync"],
    queryFn: fetchLastSync,
    refetchInterval: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: triggerStockSync,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-items"] });
      queryClient.invalidateQueries({ queryKey: ["stock-summary"] });
      queryClient.invalidateQueries({ queryKey: ["last-sync"] });
    },
  });

  const lastSyncLabel = syncData?.lastSync
    ? "Synced " + new Date(syncData.lastSync).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "Not synced";

  return (
    <header
      className="sticky top-0 flex items-center justify-between bg-white"
      style={{
        height: 56,
        zIndex: 50,
        padding: "0 28px",
        borderBottom: "1px solid #D4C9A8",
      }}
    >
      {/* Left: page title */}
      <h2
        className="text-xl text-[#1A1814]"
        style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 500 }}
      >
        {title}
      </h2>

      {/* Right: actions */}
      <div className="flex items-center gap-3">
        <span
          className="text-[11px] text-[#1A1814]/40 mr-1"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          {lastSyncLabel}
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={syncMutation.isPending}
          onClick={() => syncMutation.mutate()}
          className="h-8 text-xs border-[#D4C9A8] text-[#1A1814]/60 hover:bg-[#FAF7F0]"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", syncMutation.isPending && "animate-spin")} />
          {syncMutation.isPending ? "Syncing..." : "Sync Now"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs border-[#D4C9A8] text-[#1A1814]/60 hover:bg-[#FAF7F0]"
        >
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Export CSV
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs border-[#D4C9A8] text-[#1A1814]/60 hover:bg-[#FAF7F0] relative"
        >
          <ScrollText className="w-3.5 h-3.5 mr-1.5" />
          Audit Trail
          {auditLog.length > 0 && (
            <Badge
              className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 text-[9px] bg-[#C9A84C] text-white border-0"
            >
              {auditLog.length}
            </Badge>
          )}
        </Button>

        <Button
          size="sm"
          className="h-8 text-xs bg-[#C9A84C] hover:bg-[#8B6914] text-white"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Dispatch
          {kitQueue.length > 0 && (
            <Badge
              className="ml-1.5 h-4 min-w-4 px-1 text-[9px] bg-white/20 text-white border-0"
            >
              {kitQueue.length}
            </Badge>
          )}
        </Button>
      </div>
    </header>
  );
}

export function IntelligenceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "#FAF7F0" }}>
      <Sidebar />
      <div className="flex-1 flex flex-col" style={{ marginLeft: 220 }}>
        <Topbar />
        <main className="flex-1" style={{ padding: "24px 28px" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
