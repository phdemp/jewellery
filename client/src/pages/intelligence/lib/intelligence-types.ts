export interface InventoryItem {
  jewelCode: string;
  styleNo: string;
  category: string;
  catSimple: string;
  location: string;
  stockType: string;
  subCat: string;
  makeType: string;
  baseMetal: string;
  costPrice: number;
  tagPrice: number;
  gp: number;
  ageingDays: number;
  ageingTag: "Fresh" | "Active" | "Moderate" | "Slow Moving" | "Ageing" | "Non-Moving";
  perfTag: "Top Seller" | "Fast Moving" | "Average" | "Slow";
  grossWt: number;
  pureWt: number;
  diaWt: number;
  imageUrl: string;
  status: "On Hand" | "Memo";
  clientName: string;
  salesPerson: string;
}

export interface SalesTransaction {
  clientName: string;
  state: string;
  styleCode: string;
  category: string;
  transPrice: number;
  tagPrice: number;
  salesPerson: string;
  transDate: string;
  stock: string;
}

export interface ClientProfile {
  ClientName: string;
  total_spend: number;
  txn_count: number;
  categories: string[];
}

export interface ClientDetail {
  name: string;
  totalSpend: number;
  txnCount: number;
  avgOrder: number;
  lastPurchase: string;
  daysSince: number;
  avgFreqDays: number;
  avgGP: number;
  topCats: string[];
  topCatRevenue: Record<string, number>;
  history: Array<{ date: string; amount: number; category: string }>;
  stateName: string;
  city: string;
  isCold: boolean;
  isVeryOld: boolean;
}

export interface TopSku {
  styleCode: string;
  soldCount: number;
  avgMakeDays: number;
  clientCount: number;
  gpPct: number;
  totalRevenue: number;
  scoreQty: number;
  scoreClients: number;
  scoreGP: number;
  scoreTurnAround: number;
  compositeScore: number;
  imageUrl: string;
}

export interface AgeingBucket {
  "Ageing Tag": string;
  count: number;
  cost_val: number;
  tag_val: number;
}

export interface CategoryRevenue {
  CategoryGroup: string;
  revenue: number;
  count: number;
}

export interface LocationStock {
  "Location Name": string;
  count: number;
  cost_val: number;
  tag_val: number;
}

export interface MonthlyData {
  month_str: string;
  revenue: number;
}

export interface SalesChannel {
  SalesPersonName: string;
  revenue: number;
  count: number;
}

export interface DeadStockItem {
  "Jewel Code": string;
  "Style No": string;
  Category: string;
  "Cat Simple": string;
  "Location Name": string;
  "Tag Price": number;
  "Pure Wt": number;
  "Ageing Days": number;
  imageUrl: string;
}

export interface PriceBand {
  price_band: string;
  count: number;
  cost: number;
}

export interface StockType {
  "Stock Type": string;
  count: number;
  cost: number;
}

export interface LocUtilization {
  "Location Name": string;
  total_items: number;
  total_cost: number;
  total_tag: number;
  dead_items: number;
  slow_items: number;
  fresh_items: number;
  watch_items: number;
  avg_ageing: number;
  dead_cost: number;
  dead_pct: number;
  utilization_score: number;
}

export interface TransferSuggestion {
  category: string;
  fromLocation: string;
  toLocation: string;
  reason: string;
  suggestQty: number;
  fromDeadItems: number;
  toWeeklyVelocity: number;
  toWeeksOfStock: number;
  priority: "HIGH" | "MEDIUM";
  rationale: string;
  status: string;
  items: string[];
}

export interface BdmPerformance {
  SalesPersonName: string;
  revenue: number;
  sold_count: number;
  avg_order: number;
  clients: number;
}

export interface MemoItem {
  jewelCode: string;
  styleNo: string;
  category: string;
  catSimple: string;
  location: string;
  stockType: string;
  baseMetal: string;
  tagPrice: number;
  pureWt: number;
  grossWt: number;
  diaWt: number;
  ageingDays: number;
  ageingTag: string;
  imageUrl: string;
  bdm: string;
  salesPerson: string;
}

export interface BdmSummary {
  bdm: string;
  count: number;
  tagValue: number;
  cats: string[];
}

export interface AssortClient {
  name: string;
  spend: number;
  txns: number;
  avgOrder: number;
  topCats: string[];
  priceBand: string;
}

export interface NetSalesByCat {
  CategoryGroup: string;
  grossRevenue: number;
  returnValue: number;
  netRevenue: number;
  returnPct: number;
  grossCount: number;
  returnCount: number;
}

export interface ReturnsData {
  totalValue: number;
  totalCount: number;
  totalTagValue: number;
  byCategory: Array<{ cat: string; val: number; count: number }>;
  byBDM: Array<{ bdm: string; val: number; count: number }>;
  byState: Array<{ state: string; val: number; count: number }>;
  byMonth: Array<{ month: string; val: number; count: number }>;
  byStockType: Array<{ stockType: string; val: number; count: number }>;
  topReturnedSkus: Array<{ code: string; count: number }>;
  table: unknown[];
  byBdmCat: Record<string, Array<{ cat: string; val: number; count: number }>>;
  byCatBdm: Record<string, Array<{ bdm: string; val: number; count: number }>>;
}

export interface SummaryData {
  totalStock: number;
  onHand: number;
  sold: number;
  memo: number;
  onHandCostVal: number;
  onHandTagVal: number;
  deadStockCount: number;
  deadStockCostVal: number;
  totalRevenue: number;
  totalTxns: number;
  uniqueClients: number;
  peakMonth: string;
  peakRevenue: number;
  topChannel: string;
  topChannelRevenue: number;
  topCategory: string;
  topCategoryRevenue: number;
  topClientName: string;
  topClientSpend: number;
  topState: string;
  topStateTxns: number;
  avgOrderValue: number;
  totalReturns: number;
  returnCount: number;
  netRevenue: number;
  returnRate: number;
}

export interface ExhibitionEntry {
  name: string;
  type: string;
  interestCount: number;
  uniqueSkuCount: number;
  totalTagValue: number;
  topCustomers: [string, number][];
  topCats: [string, number][];
  topBdms: [string, number][];
  topMakeTypes: [string, number][];
}

export interface ExhibitionSku {
  jc: string;
  ps: string;
  cat: string;
  mt: string;
  mtl: string;
  tp: number;
  n: number;
  ex: string[];
  cust: number;
  bdm: string[];
}

export type PageId = "dashboard" | "inventory" | "inventory_suggestions" | "skuintel" | "sales" | "clients" | "assortment" | "catalogue" | "dispatch" | "lonepieces" | "recommendations" | "reports";

export interface DashFilter {
  type: string | null;
  value: string | null;
}

export interface KitItem extends InventoryItem {
  _source?: string;
}

export interface DispatchKit {
  id: string;
  kind: "bdm" | "exhibition" | "transfer" | "location";
  bdm: string;
  state: string | null;
  targetClient: string | null;
  items: KitItem[];
  aiRecommended: number;
  manuallyAdded: number;
  totalValue: number;
  avgGP: number;
  deadStockCleared: number;
  status: "pending_approval" | "prepared" | "rejected";
  createdAt: string;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string;
  timeline: Array<{ ts: string; event: string; actor: string; detail: string }>;
}

export interface HighMarginItem {
  "Jewel Code": string;
  "Style No": string;
  Category: string;
  "Cat Simple": string;
  "Location Name": string;
  "Tag Price": number;
  "Pure Wt": number;
  GP_pct: number;
  "Ageing Days": number;
  "Ageing Tag": string;
  imageUrl: string;
}

export interface AssortReason {
  tag: string;
  text: string;
}

export interface AssortSuggestion {
  jc: string;
  styleNo: string;
  cat: string;
  costPrice: number;
  tagPrice: number;
  gp: number;
  ageingDays: number;
  ageTag: string;
  baseMetal: string;
  grossWt: number;
  diaWt: number;
  imageUrl: string;
  stockType: string;
  score: number;
  reasons: AssortReason[];
  thumbUrl: string;
  perfTag?: string;
  tier?: "MUST INCLUDE" | "RECOMMENDED" | "OPTIONAL";
  pureWt?: number;
  location?: string;
  catSimple?: string;
  targetClient?: string;
}
