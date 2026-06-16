import { CAT_SUFFIX_MAP } from "./intelligence-constants";
import type { InventoryItem, SalesTransaction } from "./intelligence-types";
import type { SalesDataTransaction, LiveStockItem } from "@/lib/api";

export function fmt(n: number): string {
  if (Math.abs(n) >= 10_000_000) return "₹" + (n / 10_000_000).toFixed(1) + " Cr";
  if (Math.abs(n) >= 100_000) return "₹" + (n / 100_000).toFixed(1) + " L";
  return "₹" + n.toLocaleString("en-IN");
}

export function fmtN(n: number | null | undefined): string {
  return n ? n.toLocaleString("en-IN") : "—";
}

export function getDriveImgUrl(url: string): string {
  if (!url) return "";
  if (!url.includes("drive.google")) return url;
  const match = url.match(/[?&]id=([^&]+)/);
  if (!match) return url;
  return "https://drive.google.com/thumbnail?id=" + match[1] + "&sz=w400";
}

export function ageTagClass(tag: string): string {
  const cls: Record<string, string> = {
    Fresh: "bg-[#E8F5EC] text-[#2D6B42]",
    Active: "bg-[#E8F5EC] text-[#2D6B42]",
    Moderate: "bg-[#FFF4E0] text-[#8B5E00]",
    "Slow Moving": "bg-[#FFE8D6] text-[#8B3A00]",
    Ageing: "bg-[#FDEAEA] text-[#8B1A1A]",
    "Non-Moving": "bg-[#FDEAEA] text-[#8B1A1A]",
  };
  return cls[tag] || "bg-[#F5F5F5] text-[#555]";
}

export function perfTagClass(tag: string): string {
  const cls: Record<string, string> = {
    "Top Seller": "bg-[#E8F0FE] text-[#1A56CC]",
    "Fast Moving": "bg-[#EAF4E8] text-[#276520]",
    Average: "bg-[#F5F5F5] text-[#555]",
    Slow: "bg-[#FFF9F0] text-[#8B5500]",
  };
  return cls[tag] || "bg-[#F5F5F5] text-[#555]";
}

export function recTagClass(tag: string): string {
  const cls: Record<string, string> = {
    Clearance: "bg-[#FDEAEA] text-[#8B1A1A]",
    "Top Seller": "bg-[#E8F0FE] text-[#1A56CC]",
    "Slow Mover": "bg-[#FFE8D6] text-[#8B3A00]",
    Watch: "bg-[#FFF4E0] text-[#8B5E00]",
    "High Margin": "bg-[#EAF4E8] text-[#276520]",
    "Demand Gap": "bg-[#FEF3C7] text-[#92400E]",
    "Repeat Buyer": "bg-[#EDE9FE] text-[#5B21B6]",
  };
  return cls[tag] || "bg-[rgba(201,168,76,0.15)] text-[#8B6914]";
}

export function prettyCatForItem(item: InventoryItem): string {
  const sn = item.styleNo || "";
  const m = sn.match(/^[A-Z]+\d+([A-Z]+)$/);
  if (m && CAT_SUFFIX_MAP[m[1]]) return CAT_SUFFIX_MAP[m[1]];
  return item.catSimple || item.category || "—";
}

export function getPriceBand(price: number): string {
  if (price < 25000) return "Under ₹25K";
  if (price < 75000) return "₹25K–75K";
  if (price < 200000) return "₹75K–2L";
  return "Above ₹2L";
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]): void {
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function generateKitId(): string {
  return "KIT-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();
}

/* ---------- live client aggregation ---------- */

export interface ClientProfile {
  name: string;
  totalSpend: number;
  txnCount: number;
  avgOrder: number;
  topCats: string[];
  lastPurchase: string;
  daysSince: number;
  isCold: boolean;
  stateName?: string;
  city?: string;
}

/** Minimal sale shape needed for client aggregation (satisfied by both
 *  SalesDataTransaction and the lighter SalesTransaction). */
type SaleLike = {
  clientName: string;
  state: string;
  category: string;
  transPrice: number;
  transDate: string;
};

/**
 * Aggregate live B2C sales transactions (from /api/sales-data) into per-client
 * profiles. Replaces the stale DATA.clientDetail snapshot.
 */
export function aggregateClientsFromSales(sales: SaleLike[]): ClientProfile[] {
  const now = Date.now();
  interface Acc {
    totalSpend: number;
    txnCount: number;
    catCounts: Map<string, number>;
    stateCounts: Map<string, number>;
    lastTs: number;
    lastDateStr: string;
  }
  const map = new Map<string, Acc>();

  for (const s of sales) {
    const name = (s.clientName || "").trim();
    if (!name) continue;
    let e = map.get(name);
    if (!e) {
      e = { totalSpend: 0, txnCount: 0, catCounts: new Map(), stateCounts: new Map(), lastTs: 0, lastDateStr: "" };
      map.set(name, e);
    }
    e.totalSpend += s.transPrice || 0;
    e.txnCount += 1;
    if (s.category) e.catCounts.set(s.category, (e.catCounts.get(s.category) || 0) + 1);
    if (s.state) e.stateCounts.set(s.state, (e.stateCounts.get(s.state) || 0) + 1);
    const ts = s.transDate ? Date.parse(s.transDate) : NaN;
    if (!Number.isNaN(ts) && ts > e.lastTs) {
      e.lastTs = ts;
      e.lastDateStr = s.transDate;
    }
  }

  const profiles: ClientProfile[] = [];
  Array.from(map.entries()).forEach(([name, e]) => {
    const topCats = Array.from(e.catCounts.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const topState = Array.from(e.stateCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    const daysSince = e.lastTs ? Math.floor((now - e.lastTs) / 86_400_000) : 0;
    profiles.push({
      name,
      totalSpend: e.totalSpend,
      txnCount: e.txnCount,
      avgOrder: e.txnCount ? Math.round(e.totalSpend / e.txnCount) : 0,
      topCats,
      lastPurchase: e.lastDateStr || "—",
      daysSince,
      isCold: daysSince > 90,
      stateName: topState,
    });
  });
  profiles.sort((a, b) => b.totalSpend - a.totalSpend);
  return profiles;
}

/* ---------- live stock / sales mappers ---------- */

/** Map a live stock item (from /api/stock-items) to the intelligence InventoryItem shape. */
export function liveToInventoryItem(item: LiveStockItem): InventoryItem {
  const ageingDays = item.ageingDays;
  const ageingTag: InventoryItem["ageingTag"] =
    ageingDays <= 30 ? "Fresh" : ageingDays <= 60 ? "Active" : ageingDays <= 90 ? "Moderate" : ageingDays <= 180 ? "Slow Moving" : ageingDays <= 270 ? "Ageing" : "Non-Moving";
  return {
    jewelCode: item.jewelCode,
    styleNo: item.styleNo ?? "",
    category: item.category ?? "",
    catSimple: item.category ?? "",
    location: item.location ?? "",
    stockType: item.stockType ?? "",
    subCat: item.subCategory ?? "",
    makeType: item.makeType ?? "",
    baseMetal: item.baseMetal ?? "",
    costPrice: item.costPrice,
    tagPrice: item.tagPrice,
    gp: item.tagPrice > 0 ? ((item.tagPrice - item.costPrice) / item.tagPrice) * 100 : 0,
    ageingDays,
    ageingTag,
    perfTag: "Average",
    grossWt: item.grossWt ? parseFloat(item.grossWt) : 0,
    pureWt: item.pureWt ? parseFloat(item.pureWt) : 0,
    diaWt: item.totDiaWt ? parseFloat(item.totDiaWt) : 0,
    imageUrl: item.imageUrl ?? "",
    status: (item.currentStatus === "Memo" ? "Memo" : "On Hand") as "On Hand" | "Memo",
    clientName: item.memoClientName ?? "",
    salesPerson: item.memoSalesPersonName ?? "",
  };
}

/** Map live sales rows to SalesTransaction[], excluding returns (Sales Return / negative). */
export function liveToSalesTransactions(rows: SalesDataTransaction[]): SalesTransaction[] {
  return rows
    .filter((r) => r.saleType !== "Sales Return" && r.transPrice >= 0)
    .map((r) => ({
      clientName: r.clientName,
      state: r.state,
      styleCode: r.styleCode,
      category: r.category,
      transPrice: r.transPrice,
      tagPrice: r.tagPrice,
      salesPerson: r.salesPerson,
      transDate: r.transDate,
      stock: r.stock,
    }));
}
