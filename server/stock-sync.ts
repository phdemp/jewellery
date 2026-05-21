import { db } from "./db";
import { liveStockItems } from "@shared/schema";

const STOCK_API_URL = "http://183.83.176.221:94/api/Raniwala/GetStockMaster";
const AUTH_TOKEN = "C1FA8F01-51FF-4464-8ED6-975BC50EF6D2";

interface StockApiItem {
  JewelId: number;
  JewelCode: string;
  StyleNo: string;
  MakeType: string;
  SubCategory: string;
  StockType: string;
  Category: string;
  BaseMetal: string;
  Location: string;
  ManuFacturerName: string;
  TagPrice: number;
  ImageUrl: string;
  CurrentStatus: string;
  PureWt: number;
  PureWtClarity: number;
  TotNetwt: number;
  GrossWt: number;
  TotDiaWt: number;
  TotPolkiWt: number;
  TotColorStoneWt: number;
  Qty: number;
  ItemPieces: number;
  CostPrice: number;
  CollectionName: string;
  MakeDate: string;
  AgeingDays: number;
  MemoClientName: string;
  MemoSalesPersonName: string;
  MemoDate: string | null;
}

interface StockApiResponse {
  status: boolean;
  message: string;
  data: StockApiItem[];
}

export interface SyncResult {
  inserted: number;
  updated: number;
  total: number;
}

export async function syncStockData(): Promise<SyncResult> {
  console.log("[stock-sync] Starting sync from external API...");

  const response = await fetch(STOCK_API_URL, {
    headers: { "AuthorizationToken": AUTH_TOKEN },
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    throw new Error(`Stock API returned ${response.status}`);
  }

  const json: StockApiResponse = await response.json();
  if (!json.status || !json.data) {
    throw new Error("Stock API returned error: " + json.message);
  }

  console.log(`[stock-sync] Fetched ${json.data.length} items from API`);

  // Clear and re-insert (full sync) - faster than upserting 16k rows
  await db.delete(liveStockItems);

  // Batch insert in chunks of 500
  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < json.data.length; i += BATCH_SIZE) {
    const batch = json.data.slice(i, i + BATCH_SIZE).map(item => ({
      jewelId: item.JewelId,
      jewelCode: String(item.JewelCode || ""),
      styleNo: item.StyleNo || null,
      makeType: item.MakeType || null,
      subCategory: item.SubCategory || null,
      stockType: item.StockType || null,
      category: item.Category || null,
      baseMetal: item.BaseMetal || null,
      location: item.Location || null,
      manufacturerName: item.ManuFacturerName || null,
      tagPrice: item.TagPrice || 0,
      imageUrl: item.ImageUrl || null,
      currentStatus: item.CurrentStatus || null,
      pureWt: item.PureWt != null ? String(item.PureWt) : null,
      pureWtClarity: item.PureWtClarity != null ? String(item.PureWtClarity) : null,
      totNetwt: item.TotNetwt != null ? String(item.TotNetwt) : null,
      grossWt: item.GrossWt != null ? String(item.GrossWt) : null,
      totDiaWt: item.TotDiaWt != null ? String(item.TotDiaWt) : null,
      totPolkiWt: item.TotPolkiWt != null ? String(item.TotPolkiWt) : null,
      totColorStoneWt: item.TotColorStoneWt != null ? String(item.TotColorStoneWt) : null,
      qty: item.Qty || 1,
      itemPieces: item.ItemPieces || 1,
      costPrice: item.CostPrice || 0,
      collectionName: item.CollectionName || null,
      makeDate: item.MakeDate || null,
      ageingDays: item.AgeingDays || 0,
      memoClientName: item.MemoClientName || null,
      memoSalesPersonName: item.MemoSalesPersonName || null,
      memoDate: item.MemoDate || null,
    }));
    await db.insert(liveStockItems).values(batch);
    inserted += batch.length;
  }

  console.log(`[stock-sync] Sync complete: ${inserted} items inserted`);
  return { inserted, updated: 0, total: json.data.length };
}

// Cron: run daily
let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startStockSyncCron(): void {
  // Run initial sync after 10 seconds (give DB time to be ready)
  setTimeout(async () => {
    try {
      const result = await syncStockData();
      console.log(`[stock-sync] Initial sync complete: ${result.total} items`);
    } catch (err) {
      console.error("[stock-sync] Initial sync failed:", err instanceof Error ? err.message : String(err));
    }
  }, 10000);

  // Run every 24 hours
  syncInterval = setInterval(async () => {
    try {
      const result = await syncStockData();
      console.log(`[stock-sync] Daily sync complete: ${result.total} items`);
    } catch (err) {
      console.error("[stock-sync] Daily sync failed:", err instanceof Error ? err.message : String(err));
    }
  }, 24 * 60 * 60 * 1000);
}

export function stopStockSyncCron(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
