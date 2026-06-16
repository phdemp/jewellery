import { db } from "./db";
import { sql } from "drizzle-orm";
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

  // Paginated fetch — API returns max 500 items per page
  const allData: StockApiItem[] = [];
  const PAGE_SIZE = 500;
  const MAX_PAGES = 100;
  let pageNumber = 1;

  while (pageNumber <= MAX_PAGES) {
    const response = await fetch(STOCK_API_URL, {
      headers: {
        "AuthorizationToken": AUTH_TOKEN,
        "Content-Type": "application/json",
        "DataFor": "All",
        "PageNumber": String(pageNumber),
        "PageSize": String(PAGE_SIZE),
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Stock API returned ${response.status}`);
    }

    const json: StockApiResponse = await response.json();
    if (!json.status || !json.data || json.data.length === 0) {
      break; // No more pages
    }

    allData.push(...json.data);
    console.log(`[stock-sync] Page ${pageNumber}: ${json.data.length} items (total: ${allData.length})`);

    if (json.data.length < PAGE_SIZE) break;
    pageNumber++;
  }

  console.log(`[stock-sync] Fetched ${allData.length} items from API`);

  // Upsert by jewel_id — preserves embedding_vector on existing rows
  // Step 1: Mark all as stale, then upsert incoming, then remove truly gone items
  const incomingJewelIds = new Set(allData.map(item => item.JewelId));

  const BATCH_SIZE = 500;
  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < allData.length; i += BATCH_SIZE) {
    const batch = allData.slice(i, i + BATCH_SIZE);

    for (const item of batch) {
      const jewelCode = String(item.JewelCode || "");
      const values = {
        jewelId: item.JewelId,
        jewelCode,
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
      };

      // Check if exists by jewel_id
      const existing = await db.execute(
        sql`SELECT id FROM live_stock_items WHERE jewel_id = ${item.JewelId} LIMIT 1`
      );

      if (existing.rows.length > 0) {
        // Update metadata but keep embedding_vector and embedding_status
        await db.execute(sql`
          UPDATE live_stock_items SET
            jewel_code = ${jewelCode}, style_no = ${values.styleNo},
            make_type = ${values.makeType}, sub_category = ${values.subCategory},
            stock_type = ${values.stockType}, category = ${values.category},
            base_metal = ${values.baseMetal}, location = ${values.location},
            manufacturer_name = ${values.manufacturerName}, tag_price = ${values.tagPrice},
            image_url = ${values.imageUrl}, current_status = ${values.currentStatus},
            pure_wt = ${values.pureWt}, pure_wt_clarity = ${values.pureWtClarity},
            tot_netwt = ${values.totNetwt}, gross_wt = ${values.grossWt},
            tot_dia_wt = ${values.totDiaWt}, tot_polki_wt = ${values.totPolkiWt},
            tot_color_stone_wt = ${values.totColorStoneWt}, qty = ${values.qty},
            item_pieces = ${values.itemPieces}, cost_price = ${values.costPrice},
            collection_name = ${values.collectionName}, make_date = ${values.makeDate},
            ageing_days = ${values.ageingDays}, memo_client_name = ${values.memoClientName},
            memo_sales_person_name = ${values.memoSalesPersonName}, memo_date = ${values.memoDate},
            synced_at = NOW()
          WHERE jewel_id = ${item.JewelId}
        `);
        updated++;
      } else {
        await db.insert(liveStockItems).values(values);
        inserted++;
      }
    }
  }

  // Remove items no longer in the API (sold/transferred)
  const allExisting = await db.execute(sql`SELECT jewel_id FROM live_stock_items`);
  let removed = 0;
  for (const row of allExisting.rows as { jewel_id: number }[]) {
    if (!incomingJewelIds.has(row.jewel_id)) {
      await db.execute(sql`DELETE FROM live_stock_items WHERE jewel_id = ${row.jewel_id}`);
      removed++;
    }
  }

  console.log(`[stock-sync] Sync complete: ${inserted} new, ${updated} updated, ${removed} removed`);
  return { inserted, updated, total: allData.length };
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
