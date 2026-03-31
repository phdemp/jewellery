import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pg = require('pg');

// Load .env manually
try {
  const envContent = readFileSync(join(__dirname, '..', '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch {}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const content = readFileSync(join(__dirname, '..', 'database_dump.txt'), 'utf8');
const allLines = content.split('\n');

// Find the line index containing a marker string
function findLine(marker) {
  return allLines.findIndex(l => l.includes(marker));
}

// Parse a psql formatted table section.
// Starts looking from `startIdx`, finds the separator line, then reads rows.
// Returns array of objects keyed by column name.
function parsePsqlTable(startIdx) {
  // Find separator line (only dashes and + chars)
  let sepIdx = -1;
  for (let i = startIdx; i < Math.min(startIdx + 20, allLines.length); i++) {
    if (/^-+(\+-+)+$/.test(allLines[i].trim())) {
      sepIdx = i;
      break;
    }
  }
  if (sepIdx < 0) return [];

  // Column names from the line just above separator
  const headerLine = allLines[sepIdx - 1];
  const colNames = headerLine.split('|').map(s => s.trim());

  // Determine pipe positions in the header line (these are fixed for all rows)
  const pipePositions = [];
  for (let i = 0; i < headerLine.length; i++) {
    if (headerLine[i] === '|') pipePositions.push(i);
  }

  // Extract cell value from a single display line at a given column index
  function getCellAtCol(line, colIdx) {
    const start = colIdx === 0 ? 0 : pipePositions[colIdx - 1] + 1;
    const end = colIdx < pipePositions.length ? pipePositions[colIdx] : line.length;
    return line.slice(start, Math.min(end, line.length)).trim();
  }

  const rows = [];
  // cells[colIdx] accumulates text across continuation lines
  let cells = null;

  for (let i = sepIdx + 1; i < allLines.length; i++) {
    const line = allLines[i];

    // Footer: "(N rows)"
    if (/^\(\d+ rows?\)/.test(line.trim())) {
      if (cells) rows.push(buildObject(cells, colNames));
      break;
    }
    // Next section or blank at start
    if (line.includes('===')) {
      if (cells) rows.push(buildObject(cells, colNames));
      break;
    }
    if (line.trim() === '' && !cells) continue;

    // Continuation if last column wraps (ends with '+') OR a middle column wraps (contains '+|')
    const isCont = line.endsWith('+') || /\+\|/.test(line);
    // Remove continuation markers: replace '+|' with ' |', strip trailing '+'
    let actualLine = line.replace(/\+\|/g, ' |');
    if (actualLine.endsWith('+')) actualLine = actualLine.slice(0, -1);

    if (!cells) {
      // Start of a new row
      cells = colNames.map((_, idx) => getCellAtCol(actualLine, idx));
    } else {
      // Continuation: only non-empty cells extend their column value
      for (let c = 0; c < colNames.length; c++) {
        const part = getCellAtCol(actualLine, c);
        if (part) cells[c] += '\n' + part;
      }
    }

    if (!isCont) {
      rows.push(buildObject(cells, colNames));
      cells = null;
    }
  }

  return rows;
}

function buildObject(cells, colNames) {
  const obj = {};
  colNames.forEach((name, i) => { obj[name] = cells[i]; });
  return obj;
}

// Parse PostgreSQL array literal {a,"b c",d}
function parsePgArray(str) {
  if (!str) return [];
  str = str.trim();
  if (!str.startsWith('{') || !str.endsWith('}')) return str ? [str] : [];
  str = str.slice(1, -1);
  if (!str) return [];
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

async function importReferenceImages(rows) {
  console.log(`\nImporting ${rows.length} reference images...`);
  let ok = 0, skip = 0;
  for (const row of rows) {
    try {
      let metadata = null;
      try { metadata = JSON.parse(row.metadata); } catch {}
      await pool.query(
        `INSERT INTO reference_images (id, filename, filepath, thumbnail_path, theme_code, uploaded_at, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.filename, row.filepath, row.thumbnail_path,
         row.theme_code, row.uploaded_at, metadata ? JSON.stringify(metadata) : null]
      );
      ok++;
    } catch (e) {
      console.error(`  SKIP reference_image ${row.id}: ${e.message}`);
      skip++;
    }
  }
  console.log(`  Inserted: ${ok}, Skipped: ${skip}`);
}

async function importDesignProjects(rows) {
  console.log(`\nImporting ${rows.length} design projects...`);
  let ok = 0, skip = 0;
  for (const row of rows) {
    try {
      const motifs = parsePgArray(row.motifs);
      const stones = parsePgArray(row.stones);
      // clean up Windows carriage returns in custom_notes
      const notes = row.custom_notes ? row.custom_notes.replace(/\r/g, '').trim() : null;
      await pool.query(
        `INSERT INTO design_projects (id, category, theme, motifs, stones, material_ratio, custom_notes, generated_image_url, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.category, row.theme, motifs, stones,
         row.material_ratio, notes || null, row.generated_image_url, row.created_at]
      );
      ok++;
    } catch (e) {
      console.error(`  SKIP design_project ${row.id}: ${e.message}`);
      skip++;
    }
  }
  console.log(`  Inserted: ${ok}, Skipped: ${skip}`);
}

async function importDesignIterations(rows) {
  console.log(`\nImporting ${rows.length} design iterations...`);
  let ok = 0, skip = 0;
  for (const row of rows) {
    try {
      await pool.query(
        `INSERT INTO design_iterations (id, design_project_id, iteration_number, edit_prompt, source_image_url, result_image_url, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.design_project_id, parseInt(row.iteration_number) || null,
         row.edit_prompt || null, row.source_image_url || null,
         row.result_image_url || null, row.created_at]
      );
      ok++;
    } catch (e) {
      console.error(`  SKIP design_iteration ${row.id}: ${e.message}`);
      skip++;
    }
  }
  console.log(`  Inserted: ${ok}, Skipped: ${skip}`);
}

async function main() {
  const refStart  = findLine('=== REFERENCE IMAGES TABLE');
  const projStart = findLine('=== DESIGN PROJECTS TABLE');
  const iterStart = findLine('=== DESIGN ITERATIONS TABLE');

  console.log('Parsing sections...');
  const refRows  = parsePsqlTable(refStart);
  const projRows = parsePsqlTable(projStart);
  const iterRows = parsePsqlTable(iterStart);

  console.log(`Found: ${refRows.length} reference images, ${projRows.length} design projects, ${iterRows.length} design iterations`);

  await importReferenceImages(refRows);
  await importDesignProjects(projRows);
  await importDesignIterations(iterRows);

  await pool.end();
  console.log('\nDone!');
}

main().catch(err => { console.error(err); process.exit(1); });
