import { Pool } from "pg";

const THEME_TO_SEGMENT: Record<string, string> = {
  BRP: "Bridal", BRC: "Bridal", BRU: "Bridal", BRD: "Bridal", BRO: "Bridal",
  CLO: "Traditional", CLC: "Traditional", CLD: "Traditional", CLP: "Exclusive - Grandeur",
  WRO: "Traditional", WRD: "Modern", WRC: "Traditional", WRP: "Traditional",
  SOP: "Exclusive - Grandeur", SOO: "Modern", SOD: "Modern",
};

function extractThemeCode(filename: string): string | null {
  const name = filename.replace(/\.\w+$/, "").toUpperCase();
  const m = name.match(/(?:^|[_\s])(?:MALA|FQ|OQ|[ADFGJOS])?(BRC|BRP|BRU|BRD|BRO|WRD|WRO|WRC|WRP|CLO|CLC|CLD|CLP|SOLD|SOLO|SOLP|SOD|SOO|SOP)/);
  if (m) {
    const raw = m[1];
    if (raw === "SOLD") return "SOD";
    if (raw === "SOLO") return "SOO";
    if (raw === "SOLP") return "SOP";
    return raw;
  }
  if (/COLLET?ABLE.*OCCASION/i.test(name)) return "CLO";
  if (/BRIDAL.*CLASSIC/i.test(name)) return "BRC";
  return null;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const rows = await pool.query(
    "SELECT id, filename FROM reference_images WHERE theme_code IS NULL OR theme_code = ''"
  );
  console.log(`Untagged: ${rows.rows.length}`);

  let fixed = 0;
  for (const row of rows.rows) {
    const code = extractThemeCode(row.filename);
    if (code) {
      const seg = THEME_TO_SEGMENT[code] || "Traditional";
      await pool.query(
        "UPDATE reference_images SET theme_code = $1, product_segment = COALESCE(product_segment, $2) WHERE id = $3",
        [code, seg, row.id]
      );
      console.log(`  ${row.filename} → ${code} (${seg})`);
      fixed++;
    } else {
      console.log(`  ${row.filename} → SKIP`);
    }
  }

  console.log(`\nFixed: ${fixed}`);
  const remaining = await pool.query("SELECT COUNT(*) as c FROM reference_images WHERE theme_code IS NULL");
  console.log(`Still untagged: ${remaining.rows[0].c}`);
  const nullSeg = await pool.query("SELECT COUNT(*) as c FROM reference_images WHERE product_segment IS NULL");
  console.log(`Still no segment: ${nullSeg.rows[0].c}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
