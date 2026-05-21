import pg from "pg";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS live_stock_items (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        jewel_id INTEGER NOT NULL,
        jewel_code VARCHAR(20) NOT NULL,
        style_no VARCHAR(50),
        make_type VARCHAR(50),
        sub_category VARCHAR(50),
        stock_type VARCHAR(30),
        category VARCHAR(80),
        base_metal VARCHAR(20),
        location VARCHAR(100),
        manufacturer_name VARCHAR(200),
        tag_price INTEGER DEFAULT 0,
        image_url TEXT,
        current_status VARCHAR(20),
        pure_wt TEXT,
        pure_wt_clarity TEXT,
        tot_netwt TEXT,
        gross_wt TEXT,
        tot_dia_wt TEXT,
        tot_polki_wt TEXT,
        tot_color_stone_wt TEXT,
        qty INTEGER DEFAULT 1,
        item_pieces INTEGER DEFAULT 1,
        cost_price INTEGER DEFAULT 0,
        collection_name VARCHAR(100),
        make_date VARCHAR(20),
        ageing_days INTEGER DEFAULT 0,
        memo_client_name VARCHAR(200),
        memo_sales_person_name VARCHAR(200),
        memo_date VARCHAR(20),
        synced_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("live_stock_items table created successfully");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
