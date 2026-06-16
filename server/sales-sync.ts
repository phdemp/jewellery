import { db } from "./db";
import { sql } from "drizzle-orm";
import { liveSales } from "@shared/schema";

const SALES_API_URL = "http://183.83.176.221:94/api/Raniwala/GetSalesData";
const AUTH_TOKEN = "C1FA8F01-51FF-4464-8ED6-975BC50EF6D2";

// "All" = full history (first sync). "Add / Update" = incremental delta from ERP.
export type SalesSyncMode = "All" | "Add / Update";

interface SalesApiItem {
  JewelTransId: number;
  JewelTransDate: string;
  ClientName: string;
  StateName: string;
  JewelCode: string;
  StyleCode: string;
  PureWeight: number;
  Categoty: string; // typo preserved from API
  TransactionAmt: number;
  TagPrice: number;
  StockType: string;
  SalesPersonName: string;
  BillingType: string;
  TransactionMonth: string;
  TransactionYear: number;
  ImageUrl: string;
  SaleType: string;
}

interface SalesApiResponse {
  status: boolean;
  message: string;
  data: SalesApiItem[];
}

export interface SalesSyncResult {
  inserted: number;
  updated: number;
  total: number;
}

// Fetch all pages from the ERP API for the given DataFor mode.
async function fetchSalesPages(mode: SalesSyncMode): Promise<SalesApiItem[]> {
  const allData: SalesApiItem[] = [];
  const PAGE_SIZE = 500;
  const MAX_PAGES = 100;
  let pageNumber = 1;

  while (pageNumber <= MAX_PAGES) {
    const response = await fetch(SALES_API_URL, {
      method: "GET",
      headers: {
        "AuthorizationToken": AUTH_TOKEN,
        "Content-Type": "application/json",
        "DataFor": mode,
        "PageNumber": String(pageNumber),
        "PageSize": String(PAGE_SIZE),
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Sales API returned ${response.status}`);
    }

    const json: SalesApiResponse = await response.json();
    if (!json.status || !json.data || json.data.length === 0) {
      break; // No more pages
    }

    allData.push(...json.data);
    console.log(`[sales-sync] Page ${pageNumber}: ${json.data.length} items (total: ${allData.length})`);

    if (json.data.length < PAGE_SIZE) break;
    pageNumber++;
  }

  return allData;
}

// Sync sales transactions from the ERP API into the live_sales table.
// Sales are append-mostly: we upsert by jewel_trans_id and never delete.
export async function syncSalesData(mode?: SalesSyncMode): Promise<SalesSyncResult> {
  // Auto-detect mode: empty table → full history, otherwise incremental
  let effectiveMode = mode;
  if (!effectiveMode) {
    const countResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM live_sales`);
    const existingCount = (countResult.rows[0] as { count: number } | undefined)?.count ?? 0;
    effectiveMode = existingCount === 0 ? "All" : "Add / Update";
  }

  console.log(`[sales-sync] Starting sync (DataFor: "${effectiveMode}")...`);

  const allData = await fetchSalesPages(effectiveMode);
  console.log(`[sales-sync] Fetched ${allData.length} transactions from API`);

  let inserted = 0;
  let updated = 0;

  for (const item of allData) {
    const values = {
      jewelTransId: item.JewelTransId,
      jewelTransDate: item.JewelTransDate || null,
      clientName: item.ClientName || null,
      stateName: item.StateName || null,
      jewelCode: item.JewelCode || "", // part of composite unique key; never null
      styleCode: item.StyleCode || null,
      pureWeight: item.PureWeight != null ? String(item.PureWeight) : null,
      category: item.Categoty || null,
      // ERP returns these with paise decimals (e.g. 34083.35); the column is integer
      transactionAmt: Math.round(Number(item.TransactionAmt) || 0),
      tagPrice: Math.round(Number(item.TagPrice) || 0),
      stockType: item.StockType || null,
      salesPersonName: item.SalesPersonName || null,
      billingType: item.BillingType || null,
      transactionMonth: item.TransactionMonth || null,
      transactionYear: item.TransactionYear || null,
      imageUrl: item.ImageUrl || null,
      saleType: item.SaleType || null,
    };

    // Upsert by jewel_trans_id (unique per transaction from ERP)
    const result = await db.execute(sql`
      INSERT INTO live_sales (
        jewel_trans_id, jewel_trans_date, client_name, state_name,
        jewel_code, style_code, pure_weight, category,
        transaction_amt, tag_price, stock_type, sales_person_name,
        billing_type, transaction_month, transaction_year, image_url,
        sale_type, synced_at
      ) VALUES (
        ${values.jewelTransId}, ${values.jewelTransDate}, ${values.clientName}, ${values.stateName},
        ${values.jewelCode}, ${values.styleCode}, ${values.pureWeight}, ${values.category},
        ${values.transactionAmt}, ${values.tagPrice}, ${values.stockType}, ${values.salesPersonName},
        ${values.billingType}, ${values.transactionMonth}, ${values.transactionYear}, ${values.imageUrl},
        ${values.saleType}, NOW()
      )
      ON CONFLICT (jewel_trans_id, jewel_code) DO UPDATE SET
        jewel_trans_date = EXCLUDED.jewel_trans_date,
        client_name = EXCLUDED.client_name,
        state_name = EXCLUDED.state_name,
        style_code = EXCLUDED.style_code,
        pure_weight = EXCLUDED.pure_weight,
        category = EXCLUDED.category,
        transaction_amt = EXCLUDED.transaction_amt,
        tag_price = EXCLUDED.tag_price,
        stock_type = EXCLUDED.stock_type,
        sales_person_name = EXCLUDED.sales_person_name,
        billing_type = EXCLUDED.billing_type,
        transaction_month = EXCLUDED.transaction_month,
        transaction_year = EXCLUDED.transaction_year,
        image_url = EXCLUDED.image_url,
        sale_type = EXCLUDED.sale_type,
        synced_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `);

    // xmax = 0 on the returned row means the row was freshly inserted (not updated)
    const wasInserted = (result.rows[0] as { inserted: boolean } | undefined)?.inserted ?? true;
    if (wasInserted) {
      inserted++;
    } else {
      updated++;
    }
  }

  console.log(`[sales-sync] Sync complete: ${inserted} new, ${updated} updated, ${allData.length} total fetched`);
  return { inserted, updated, total: allData.length };
}

// Cron: run daily
let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startSalesSyncCron(): void {
  // Run initial sync after 15 seconds (give DB time to be ready)
  setTimeout(async () => {
    try {
      const result = await syncSalesData();
      console.log(`[sales-sync] Initial sync complete: ${result.total} items`);
    } catch (err) {
      console.error("[sales-sync] Initial sync failed:", err instanceof Error ? err.message : String(err));
    }
  }, 15000);

  // Run every 24 hours (incremental)
  syncInterval = setInterval(async () => {
    try {
      const result = await syncSalesData("Add / Update");
      console.log(`[sales-sync] Daily sync complete: ${result.inserted} new, ${result.updated} updated`);
    } catch (err) {
      console.error("[sales-sync] Daily sync failed:", err instanceof Error ? err.message : String(err));
    }
  }, 24 * 60 * 60 * 1000);
}

export function stopSalesSyncCron(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
