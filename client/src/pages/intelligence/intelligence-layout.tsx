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
        zIndex: 50,
      }}
    >
      {/* Brand header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/10">
        <h1
          className="text-white text-lg tracking-wide"
          style={{ fontFamily: "'Cormorant Garamond', serif" }}
        >
          Raniwala 1881
        </h1>
        <p
          className="text-[10px] tracking-[0.2em] mt-0.5"
          style={{
            fontFamily: "'DM Mono', monospace",
            color: "#C9A96E",
          }}
        >
          INTELLIGENCE PLATFORM
        </p>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-4">
            <p
              className="px-3 mb-1.5 text-[10px] tracking-[0.15em]"
              style={{
                fontFamily: "'DM Mono', monospace",
                color: "rgba(255,255,255,0.35)",
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
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors",
                    "hover:bg-white/5",
                    isActive
                      ? "text-[#C9A96E] bg-[#C9A96E]/8"
                      : "text-white/60"
                  )}
                  style={{
                    borderLeft: isActive ? "3px solid #C9A96E" : "3px solid transparent",
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  <span className={cn(isActive ? "text-[#C9A96E]" : "text-white/40")}>
                    {item.icon}
                  </span>
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 h-4 bg-white/10 text-white/50 border-0"
                    >
                      {item.badge}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Sidebar footer */}
      <div className="px-4 py-3 border-t border-white/10">
        <p
          className="text-[10px] tracking-wide"
          style={{
            fontFamily: "'DM Mono', monospace",
            color: "rgba(255,255,255,0.3)",
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
      className="sticky top-0 flex items-center justify-between px-6 border-b bg-white"
      style={{
        height: 56,
        zIndex: 40,
        borderColor: "#E8E0D0",
      }}
    >
      {/* Left: page title */}
      <h2
        className="text-xl text-[#1A1814]"
        style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 600 }}
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
          className="h-8 text-xs border-[#E8E0D0] text-[#1A1814]/60 hover:bg-[#FAF7F0]"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", syncMutation.isPending && "animate-spin")} />
          {syncMutation.isPending ? "Syncing..." : "Sync Now"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs border-[#E8E0D0] text-[#1A1814]/60 hover:bg-[#FAF7F0]"
        >
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Export CSV
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs border-[#E8E0D0] text-[#1A1814]/60 hover:bg-[#FAF7F0] relative"
        >
          <ScrollText className="w-3.5 h-3.5 mr-1.5" />
          Audit Trail
          {auditLog.length > 0 && (
            <Badge
              className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 text-[9px] bg-[#C9A96E] text-white border-0"
            >
              {auditLog.length}
            </Badge>
          )}
        </Button>

        <Button
          size="sm"
          className="h-8 text-xs bg-[#C9A96E] hover:bg-[#B8964E] text-white"
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
