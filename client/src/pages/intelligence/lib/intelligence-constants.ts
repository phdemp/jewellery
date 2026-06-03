export const PIE_COLORS = [
  "#C9A84C", "#4A7C59", "#2B5EA7", "#C4862B", "#A63C2A",
  "#6B6458", "#8B5E34", "#D4721E", "#3D5A80", "#98A86F",
  "#5E4F3B", "#B08968",
];

export const AGEING_COLORS: Record<string, string> = {
  Fresh: "#4A7C59",
  Active: "#2B5EA7",
  Moderate: "#C4862B",
  "Slow Moving": "#D4721E",
  Ageing: "#A63C2A",
  "Non-Moving": "#8B1A1A",
};

export const PAGE_TITLES: Record<string, string> = {
  dashboard: "Dashboard Overview",
  inventory: "Inventory Management",
  skuintel: "SKU Intelligence",
  sales: "Sales Analysis",
  clients: "Client Profiles",
  assortment: "Smart Assortment Planner",
  catalogue: "Visual Catalogue",
  dispatch: "Dispatch Planner",
  lonepieces: "Lone Pieces",
  recommendations: "Recommendations",
  reports: "Reports & Analytics",
  inventory_suggestions: "Inventory Suggestions",
};

export const REPORT_DEFS: Record<string, { title: string; icon: string; desc: string }> = {
  bdmperf: { title: "BDM Performance Report", icon: "👤", desc: "Revenue, items sold, and clients by BDM" },
  exhibition: { title: "Exhibition Report", icon: "🎪", desc: "Exhibition-wise revenue and items sold" },
  crossreport: { title: "Cross Analysis Report", icon: "📐", desc: "Margin, working capital, demand correlation" },
  topselling: { title: "Top Selling Report", icon: "🏆", desc: "Best performing SKUs by sales velocity" },
  deadstock: { title: "Dead Stock Report", icon: "🔴", desc: "365+ day aged items needing clearance" },
  ageing: { title: "Inventory Ageing Report", icon: "⏳", desc: "Stock ageing distribution by location" },
  margin: { title: "High Margin Report", icon: "💎", desc: "Items ranked by gross profit percentage" },
  assortment: { title: "Assortment Mix Report", icon: "📊", desc: "Price band × category matrix analysis" },
  client: { title: "Client Performance Report", icon: "👥", desc: "Client spending patterns and segments" },
  channel: { title: "Channel Revenue Report", icon: "📡", desc: "Revenue breakdown by sales channel" },
  monthly: { title: "Monthly Revenue Report", icon: "📅", desc: "Month-by-month FY revenue trend" },
};

export const MONTH_NAMES: Record<string, string> = {
  "2025-04": "April 2025",
  "2025-05": "May 2025",
  "2025-06": "June 2025",
  "2025-07": "July 2025",
  "2025-08": "August 2025",
  "2025-09": "September 2025",
  "2025-10": "October 2025",
  "2025-11": "November 2025",
  "2025-12": "December 2025",
  "2026-01": "January 2026",
  "2026-02": "February 2026",
  "2026-03": "March 2026",
};

export const SHORT_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

export const AGEING_RANGES: Record<string, string> = {
  Fresh: "0–30 days",
  Active: "31–60 days",
  Moderate: "61–90 days",
  "Slow Moving": "91–180 days",
  Ageing: "181–270 days",
  "Non-Moving": "270+ days",
};

export const ORPHAN_PAIRS: Record<string, string> = {
  NLS: "NLSE",
  CHS: "CHSE",
  LNS: "LNSE",
  PNS: "PNSE",
  CNS: "CNSE",
};

export const CAT_SUFFIX_MAP: Record<string, string> = {
  NLS: "Necklace Set",
  NLSE: "Necklace Set Earring",
  CHS: "Choker Set",
  CHSE: "Choker Set Earring",
  LNS: "Long Necklace Set",
  LNSE: "Long Necklace Set Earring",
  PNS: "Pendant Set",
  PNSE: "Pendant Set Earring",
  CNS: "Chain Set",
  CNSE: "Chain Set Earring",
  NL: "Necklace",
  CH: "Choker",
  LN: "Long Necklace",
  PN: "Pendant",
  CN: "Chain",
  ER: "Earring",
  LNE: "Long Necklace Earring",
  BN: "Bangle",
};

export const INV_PER_PAGE = 30;
export const SALES_PER_PAGE = 30;
export const CLIENTS_PER_PAGE = 12;
