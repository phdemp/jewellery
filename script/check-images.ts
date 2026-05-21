import pg from "pg";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // Check total with images
  const countRes = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN image_url IS NOT NULL AND image_url != '' THEN 1 END) as with_images FROM live_stock_items`);
  console.log("Counts:", countRes.rows[0]);

  // Sample image URLs
  const sampleRes = await pool.query(`SELECT jewel_code, image_url FROM live_stock_items WHERE image_url IS NOT NULL AND image_url != '' LIMIT 5`);
  console.log("Sample URLs:", JSON.stringify(sampleRes.rows, null, 2));

  // Sample null/empty
  const nullRes = await pool.query(`SELECT jewel_code, image_url FROM live_stock_items LIMIT 3`);
  console.log("First 3 rows:", JSON.stringify(nullRes.rows, null, 2));

  await pool.end();
}

main();
