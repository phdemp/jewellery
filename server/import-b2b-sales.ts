/**
 * Import B2B sales history from b2b_sales_VA_and_FinalPrice.xlsx into b2b_sales_history.
 * Maps Excel columns → DB columns, bulk inserts in chunks of 500.
 *
 * Usage: npx tsx --env-file=.env server/import-b2b-sales.ts
 */

import XLSX from "xlsx";
import { Pool } from "pg";

interface ExcelRow {
  SalesPersonName: string;
  ClientName: string;
  StateName: string;
  ClientCity: string;
  ImageLink: string;
  JewelCode: string | number;
  "Style Code": string;
  Category: string;
  CategoryGroup: string;
  TagPrice: number;
  FinalPrice: number;
  TransPrice: number;
  GrossWt: number;
  PureWt: number;
  TotDiaWt: number;
  BaseMetalQuality: string;
  StockType: string;
  SubCategory: string;
  MakeType: string;
}

function str(val: unknown): string | null {
  if (val === undefined || val === null || val === "") return null;
  return String(val).trim();
}

function int(val: unknown): number | null {
  const n = Number(val);
  return isNaN(n) ? null : Math.round(n);
}

async function main() {
  console.log("Reading b2b_sales_VA_and_FinalPrice.xlsx...");
  const wb = XLSX.readFile("b2b_sales_VA_and_FinalPrice.xlsx");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(ws);
  console.log(`Read ${rows.length} rows from Excel`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Create table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS b2b_sales_history (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      sales_person_name TEXT NOT NULL,
      client_name TEXT,
      state_name TEXT,
      client_city TEXT,
      image_link TEXT,
      jewel_code TEXT,
      style_code TEXT,
      category TEXT,
      category_group TEXT,
      tag_price INTEGER,
      final_price INTEGER,
      trans_price INTEGER,
      gross_wt TEXT,
      pure_wt TEXT,
      tot_dia_wt TEXT,
      base_metal_quality TEXT,
      stock_type TEXT,
      sub_category TEXT,
      make_type TEXT,
      motif TEXT,
      motif_category TEXT,
      product_segment TEXT,
      design_shape TEXT,
      finish TEXT,
      stone_colour TEXT,
      material_ratio TEXT,
      imported_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);

  // Clear existing data
  const existing = await pool.query("SELECT COUNT(*) as c FROM b2b_sales_history");
  if (Number(existing.rows[0].c) > 0) {
    console.log(`Clearing ${existing.rows[0].c} existing rows...`);
    await pool.query("DELETE FROM b2b_sales_history");
  }

  // Bulk insert in chunks
  const CHUNK = 500;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: (string | number | null)[] = [];
    let paramIdx = 1;

    for (const row of chunk) {
      const salesPerson = str(row.SalesPersonName);
      if (!salesPerson) { errors++; continue; }

      values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
      params.push(
        salesPerson,
        str(row.ClientName),
        str(row.StateName),
        str(row.ClientCity),
        str(row.ImageLink),
        str(row.JewelCode),
        str(row["Style Code"]),
        str(row.Category),
        str(row.CategoryGroup),
        int(row.TagPrice),
        int(row.FinalPrice),
        int(row.TransPrice),
        str(row.GrossWt),
        str(row.PureWt),
        str(row.TotDiaWt),
        str(row.BaseMetalQuality),
        str(row.StockType),
        str(row.SubCategory),
      );
    }

    if (values.length === 0) continue;

    try {
      await pool.query(
        `INSERT INTO b2b_sales_history (
          sales_person_name, client_name, state_name, client_city, image_link,
          jewel_code, style_code, category, category_group,
          tag_price, final_price, trans_price, gross_wt, pure_wt, tot_dia_wt,
          base_metal_quality, stock_type, sub_category
        ) VALUES ${values.join(", ")}`,
        params
      );
      inserted += values.length;
    } catch (err) {
      errors += chunk.length;
      console.error(`Error inserting chunk at row ${i}:`, err instanceof Error ? err.message : err);
    }

    if ((i + CHUNK) % 1000 === 0 || i + CHUNK >= rows.length) {
      console.log(`Progress: ${Math.min(i + CHUNK, rows.length)}/${rows.length} (inserted: ${inserted})`);
    }
  }

  // Summary stats
  const bdmStats = await pool.query(
    "SELECT sales_person_name, COUNT(*) as c, SUM(final_price) as total FROM b2b_sales_history GROUP BY sales_person_name ORDER BY total DESC LIMIT 15"
  );
  console.log("\n=== Top BDMs by Revenue ===");
  for (const row of bdmStats.rows) {
    console.log(`  ${row.sales_person_name}: ${row.c} sales, ₹${Number(row.total).toLocaleString()}`);
  }

  const stateStats = await pool.query(
    "SELECT state_name, COUNT(*) as c FROM b2b_sales_history WHERE state_name IS NOT NULL GROUP BY state_name ORDER BY c DESC LIMIT 10"
  );
  console.log("\n=== Top States ===");
  for (const row of stateStats.rows) {
    console.log(`  ${row.state_name}: ${row.c} sales`);
  }

  const imgStats = await pool.query(
    "SELECT COUNT(*) as with_img FROM b2b_sales_history WHERE image_link IS NOT NULL AND TRIM(image_link) <> ''"
  );
  console.log(`\nRows with images: ${imgStats.rows[0].with_img}`);

  console.log(`\n=== Final ===`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Errors/skipped: ${errors}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
