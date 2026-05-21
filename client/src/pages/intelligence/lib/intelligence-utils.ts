import { CAT_SUFFIX_MAP } from "./intelligence-constants";
import type { InventoryItem } from "./intelligence-types";

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
    Watch: "bg-[#FFF4E0] text-[#8B5E00]",
    Slow: "bg-[#FFE8D6] text-[#8B3A00]",
    "Dead Stock": "bg-[#FDEAEA] text-[#8B1A1A]",
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
