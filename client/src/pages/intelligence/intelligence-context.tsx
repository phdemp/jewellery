import { createContext, useContext, useState, ReactNode } from "react";
import type { PageId, DashFilter, DispatchKit } from "./lib/intelligence-types";

interface AuditEntry {
  ts: string;
  action: string;
  code: string;
  detail: string;
  actor: string;
}

interface IntelligenceState {
  activePage: PageId;
  setActivePage: (page: PageId) => void;
  goldPrice: number;
  setGoldPrice: (price: number) => void;
  dashFilter: DashFilter;
  setDashFilter: (filter: DashFilter) => void;
  kitQueue: DispatchKit[];
  setKitQueue: (kits: DispatchKit[]) => void;
  addToKitQueue: (kit: DispatchKit) => void;
  auditLog: AuditEntry[];
  logAudit: (action: string, code: string, detail: string) => void;
  catalogueClient: string | null;
  setCatalogueClient: (client: string | null) => void;
}

const IntelligenceContext = createContext<IntelligenceState | null>(null);

export function IntelligenceProvider({ children }: { children: ReactNode }) {
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [goldPrice, setGoldPrice] = useState(0);
  const [dashFilter, setDashFilter] = useState<DashFilter>({ type: null, value: null });
  const [kitQueue, setKitQueue] = useState<DispatchKit[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [catalogueClient, setCatalogueClient] = useState<string | null>(null);

  const addToKitQueue = (kit: DispatchKit) => {
    setKitQueue(prev => [kit, ...prev]);
  };

  const logAudit = (action: string, code: string, detail: string) => {
    setAuditLog(prev => [{
      ts: new Date().toISOString(),
      action,
      code,
      detail,
      actor: "Merchandiser",
    }, ...prev]);
  };

  return (
    <IntelligenceContext.Provider value={{
      activePage, setActivePage,
      goldPrice, setGoldPrice,
      dashFilter, setDashFilter,
      kitQueue, setKitQueue, addToKitQueue,
      auditLog, logAudit,
      catalogueClient, setCatalogueClient,
    }}>
      {children}
    </IntelligenceContext.Provider>
  );
}

export function useIntelligence() {
  const ctx = useContext(IntelligenceContext);
  if (!ctx) throw new Error("useIntelligence must be used within IntelligenceProvider");
  return ctx;
}
