/**
 * Import VA (Visual Analysis) data from stock_with_VA.xlsx into stock_items.
 * - Matches rows by jewel_code
 * - Derives theme_code from Sub Category + Stock Type (e.g. BRIDAL/CLASSIC → BRC)
 * - Builds a rich text label for embedding
 * - Updates all 17 VA fields + theme_code + label
 *
 * Usage: npx tsx --env-file=.env server/import-va-data.ts
 */

import XLSX from "xlsx";
import { Pool } from "pg";

const THEME_CODE_MAP: Record<string, string> = {
  "BRIDAL/CLASSIC": "BRC",
  "BRIDAL/PREMIUM": "BRP",
  "BRIDAL/UNIQUE": "BRU",
  "BRIDAL/DAILY": "BRD",
  "BRIDAL/OCCASIONABLE": "BRO",
  "WEARABLE/DAILY": "WRD",
  "WEARABLE/OCCASIONABLE": "WRO",
  "WEARABLE/CLASSIC": "WRC",
  "WEARABLE/PREMIUM": "WRP",
  "COLLECTABLE/OCCASIONABLE": "CLO",
  "COLLECTABLE/CLASSIC": "CLC",
  "COLLECTABLE/DAILY": "CLD",
  "COLLECTABLE/PREMIUM": "CLP",
  "SOLITAIRE/DAILY": "SOD",
  "SOLITAIRE/OCCASIONABLE": "SOO",
  "SOLITAIRE/PREMIUM": "SOP",
};

const THEME_CODE_LABELS: Record<string, string> = {
  BRC: "Bridal Classic",
  BRP: "Bridal Premium",
  BRU: "Bridal Unique",
  BRD: "Bridal Daily",
  BRO: "Bridal Occasional",
  WRD: "Wearable Daily",
  WRO: "Wearable Occasional",
  WRC: "Wearable Classic",
  WRP: "Wearable Premium",
  CLO: "Collectable Occasional",
  CLC: "Collectable Classic",
  CLD: "Collectable Daily",
  CLP: "Collectable Premium",
  SOD: "Solitaire Daily",
  SOO: "Solitaire Occasional",
  SOP: "Solitaire Premium",
};

interface ExcelRow {
  "Jewel Code": string | number;
  "Style Code": string;
  "Sub Category": string;
  "Stock Type": string;
  "Category": string;
  "VA_Category": string;
  "Brand Name": string;
  "Design Shape": string;
  "Enamel": string;
  "Finish": string;
  "Material Ratio": string;
  "Motif": string;
  "Motif category": string;
  "Piroi Colour": string;
  "Piroi Placement": string;
  "Polki Size": string;
  "Price-band": string;
  "Product Segment": string;
  "Set-Cateogry": string;
  "Stone Colour": string;
  "Talaf": string;
  "Theme": string;
  "Base Metal": string;
  "Dia Wt": number;
  "CS Wt": number;
  "Gross Wt": number;
  "Tag Price": number;
}

function deriveThemeCode(subCategory: string | undefined, stockType: string | undefined): string | null {
  if (!subCategory || !stockType) return null;
  const key = `${subCategory.trim().toUpperCase()}/${stockType.trim().toUpperCase()}`;
  return THEME_CODE_MAP[key] || null;
}

function buildLabel(row: ExcelRow, themeCode: string | null): string {
  const parts: string[] = [];

  // Category / VA Category
  const cat = row["VA_Category"] || row["Category"];
  if (cat) parts.push(cat);

  // Theme code with full label
  if (themeCode) {
    const label = THEME_CODE_LABELS[themeCode];
    parts.push(label ? `${label} (${themeCode})` : themeCode);
  }

  // Brand
  if (row["Brand Name"]) parts.push(`${row["Brand Name"]} brand`);

  // Design shape
  if (row["Design Shape"]) parts.push(`${row["Design Shape"]} shape`);

  // Finish
  if (row["Finish"]) parts.push(row["Finish"]);

  // Material ratio
  if (row["Material Ratio"]) parts.push(row["Material Ratio"]);

  // Motif + category
  if (row["Motif"]) {
    const motifCat = row["Motif category"];
    parts.push(motifCat ? `${row["Motif"]} motif (${motifCat})` : `${row["Motif"]} motif`);
  }

  // Stone colour
  if (row["Stone Colour"]) parts.push(row["Stone Colour"]);

  // Enamel
  if (row["Enamel"]) parts.push(row["Enamel"] === "Yes" ? "with enamel" : "no enamel");

  // Polki size
  if (row["Polki Size"]) parts.push(`${row["Polki Size"]} polki`);

  // Product segment
  if (row["Product Segment"]) parts.push(`${row["Product Segment"]} segment`);

  // Price band
  if (row["Price-band"]) parts.push(`${row["Price-band"]} price band`);

  // Theme (descriptive)
  if (row["Theme"]) parts.push(`${row["Theme"]} theme`);

  // Piroi
  if (row["Piroi Colour"]) parts.push(`${row["Piroi Colour"]} piroi`);
  if (row["Piroi Placement"]) parts.push(`piroi placement: ${row["Piroi Placement"]}`);

  // Talaf
  if (row["Talaf"]) parts.push(row["Talaf"]);

  // Set category
  if (row["Set-Cateogry"]) parts.push(`set: ${row["Set-Cateogry"]}`);

  // Base metal (readable)
  if (row["Base Metal"]) parts.push(`${row["Base Metal"]} metal`);

  // Weight context
  const grossWt = row["Gross Wt"];
  if (grossWt) parts.push(`${grossWt}g gross weight`);

  return parts.join(", ");
}

async function main() {
  console.log("Reading stock_with_VA.xlsx...");
  const wb = XLSX.readFile("stock_with_VA.xlsx");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(ws);
  console.log(`Read ${rows.length} rows from Excel`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Build a lookup of jewel_code → excel row
  const excelMap = new Map<string, ExcelRow>();
  for (const row of rows) {
    const code = String(row["Jewel Code"]).trim();
    if (code) excelMap.set(code, row);
  }
  console.log(`Unique jewel codes in Excel: ${excelMap.size}`);

  // Get all stock_items jewel_codes from DB
  const dbResult = await pool.query("SELECT id, jewel_code FROM stock_items");
  console.log(`Stock items in DB: ${dbResult.rows.length}`);

  let updated = 0;
  let notFound = 0;
  let errors = 0;
  const batchSize = 100;
  const dbRows = dbResult.rows;

  for (let i = 0; i < dbRows.length; i += batchSize) {
    const batch = dbRows.slice(i, i + batchSize);
    const promises = batch.map(async (dbRow: { id: string; jewel_code: string }) => {
      const excelRow = excelMap.get(dbRow.jewel_code);
      if (!excelRow) {
        notFound++;
        return;
      }

      const themeCode = deriveThemeCode(excelRow["Sub Category"], excelRow["Stock Type"]);
      const label = buildLabel(excelRow, themeCode);

      try {
        await pool.query(
          `UPDATE stock_items SET
            va_category = $1,
            brand_name = $2,
            design_shape = $3,
            enamel = $4,
            finish = $5,
            material_ratio = $6,
            motif = $7,
            motif_category = $8,
            piroi_colour = $9,
            piroi_placement = $10,
            polki_size = $11,
            price_band = $12,
            product_segment = $13,
            set_category = $14,
            stone_colour = $15,
            talaf = $16,
            theme = $17,
            theme_code = $18,
            label = $19
          WHERE id = $20`,
          [
            excelRow["VA_Category"] || null,
            excelRow["Brand Name"] || null,
            excelRow["Design Shape"] || null,
            excelRow["Enamel"] || null,
            excelRow["Finish"] || null,
            excelRow["Material Ratio"] || null,
            excelRow["Motif"] || null,
            excelRow["Motif category"] || null,
            excelRow["Piroi Colour"] || null,
            excelRow["Piroi Placement"] || null,
            excelRow["Polki Size"] || null,
            excelRow["Price-band"] || null,
            excelRow["Product Segment"] || null,
            excelRow["Set-Cateogry"] || null,
            excelRow["Stone Colour"] || null,
            excelRow["Talaf"] || null,
            excelRow["Theme"] || null,
            themeCode,
            label,
            dbRow.id,
          ]
        );
        updated++;
      } catch (err) {
        errors++;
        if (errors <= 3) console.error(`Error updating ${dbRow.jewel_code}:`, err);
      }
    });
    await Promise.all(promises);

    if ((i + batchSize) % 1000 === 0 || i + batchSize >= dbRows.length) {
      console.log(`Progress: ${Math.min(i + batchSize, dbRows.length)}/${dbRows.length} (updated: ${updated}, not found: ${notFound})`);
    }
  }

  // Summary stats
  const themeStats = await pool.query(
    "SELECT theme_code, COUNT(*) as c FROM stock_items WHERE theme_code IS NOT NULL GROUP BY theme_code ORDER BY c DESC"
  );
  console.log("\n=== Theme Code Distribution ===");
  for (const row of themeStats.rows) {
    const label = THEME_CODE_LABELS[row.theme_code] || row.theme_code;
    console.log(`  ${row.theme_code} (${label}): ${row.c}`);
  }

  const labelStats = await pool.query(
    "SELECT COUNT(*) as with_label FROM stock_items WHERE label IS NOT NULL"
  );
  console.log(`\nItems with labels: ${labelStats.rows[0].with_label}`);

  // Show sample label
  const sample = await pool.query(
    "SELECT jewel_code, label FROM stock_items WHERE label IS NOT NULL LIMIT 3"
  );
  console.log("\n=== Sample Labels ===");
  for (const row of sample.rows) {
    console.log(`[${row.jewel_code}] ${row.label}`);
  }

  console.log(`\n=== Final ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Not found in Excel: ${notFound}`);
  console.log(`Errors: ${errors}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
