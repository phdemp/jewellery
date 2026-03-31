# CLAUDE.md — Raniwala 1881: Design Brain

> This file gives Claude Code permanent context about this project. Read it fully before making any changes.

---

## Project Identity

**Design Brain** is an AI-powered jewellery design sketch generator for **Raniwala 1881**, a luxury Indian jewellery house. It is NOT a generic image generator — every output must conform to the brand's hand-drawn sketch aesthetic.

- **Hosted on:** Replit (Express + Vite, single port 5000)
- **Monorepo structure:** `client/` (React SPA) + `server/` (Express API) + `shared/` (shared schema)
- **Primary AI:** Google Gemini 2.5 Flash via `@google/genai` — used for Vision, Embeddings, and Image Generation
- **Vector search:** pgvector (3072-dim cosine similarity) in PostgreSQL

---

## Tech Stack — Quick Reference

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite 7 |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Routing | Wouter 3 |
| Forms | React Hook Form + Zod |
| Data Fetching | TanStack React Query 5 |
| Animations | Framer Motion 12 |
| Backend | Express.js 4 + TypeScript |
| ORM | Drizzle ORM 0.39 + PostgreSQL |
| Vector Search | pgvector extension (3072-dim) |
| AI | Google Gemini 2.5 Flash (`@google/genai`) |
| Image Processing | Sharp 0.34 |
| File Upload | Multer 2 |
| Google Drive | googleapis 148 + google-auth-library 10 |
| Notifications | Sonner 2 |

---

## File Structure — What Lives Where

```
jewellery-main/
├── client/src/
│   ├── App.tsx                  # Wouter router — ADD NEW ROUTES HERE
│   ├── pages/                   # One file per page/route
│   ├── components/
│   │   ├── layout.tsx           # App shell + nav — ADD NAV LINKS HERE
│   │   ├── design-form.tsx      # Main design input form
│   │   ├── result-display.tsx   # Generated sketch viewer + iteration controls
│   │   └── ui/                  # shadcn/ui components (do not modify)
│   ├── hooks/
│   │   ├── use-mobile.tsx       # Responsive breakpoint hook
│   │   └── use-toast.ts         # Sonner toast hook
│   └── lib/
│       ├── api.ts               # ALL typed fetch wrappers — ADD NEW API CALLS HERE
│       ├── jewellery-logic.ts   # Domain constants (categories, motifs, stones, etc.)
│       ├── queryClient.ts       # TanStack Query client config
│       └── utils.ts             # cn() utility (clsx + tailwind-merge)
│
├── server/
│   ├── index.ts                 # Express app init — do not modify unless adding middleware
│   ├── routes.ts                # ALL API endpoints + BRAND_RULES — ADD NEW ROUTES HERE
│   ├── google-client.ts         # Gemini API wrappers — core AI functions
│   ├── google-drive.ts          # Google Drive integration
│   ├── db.ts                    # Drizzle ORM + pg Pool — do not modify
│   ├── storage.ts               # DatabaseStorage class — CRUD operations
│   ├── vector-store.ts          # pgvector abstraction
│   └── vite.ts                  # Vite dev middleware — do not modify
│
└── shared/
    └── schema.ts                # DB tables + Zod validators — SINGLE SOURCE OF TRUTH
```

---

## Core AI Functions (server/google-client.ts)

These are the key functions. Use them — do not reimplement AI calls elsewhere.

| Function | Purpose |
|----------|---------|
| `analyzeReferenceImage(base64)` | Gemini Vision → extracts motifs, style, line style, gemstone rendering |
| `generateTextEmbedding(text)` | Text → 3072-dim vector |
| `generateImageEmbedding(base64)` | Image → 3072-dim vector |
| `generateJewellerySketch(prompt, contextImages?)` | Text prompt → base64 PNG sketch |
| `editJewellerySketch(sourceImageBase64, editPrompt)` | Edit existing image → base64 PNG |
| `buildDesignContext(params, similarDesigns)` | Assemble full prompt from design params + RAG results |
| `buildImagePrompt(context)` | Format final image generation prompt string |

---

## API Endpoints (server/routes.ts)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/reference-images` | Upload + analyze + embed reference image |
| GET | `/api/reference-images` | List all reference images |
| DELETE | `/api/reference-images/:id` | Delete reference image + disk files |
| POST | `/api/generate-design` | RAG pipeline → generate jewellery sketch |
| POST | `/api/generate-comparison` | Side-by-side RAG vs no-RAG generation |
| GET | `/api/design-projects` | List all design projects |
| GET | `/api/design-projects/:id` | Single design project details |
| POST | `/api/design-projects/:id/edit` | Edit an existing design with a new prompt |
| GET | `/api/design-projects/:id/iterations` | Iteration history for a project |
| POST | `/api/design-projects/:id/save` | Save design PNG to disk |
| POST | `/api/import-from-drive` | Bulk import references from Google Drive folder |
| POST | `/api/reembed-references` | Re-analyze + re-embed all reference images |
| POST | `/api/migrate-vectors` | One-time migration: JSONB → pgvector |
| POST | `/api/generate-thumbnails` | Generate missing 300px thumbnails via Sharp |
| POST | `/api/modify-design` | Upload image + params → Gemini edit → save as project |

> **IMPORTANT:** Always register new routes BEFORE the wildcard static file handler at the bottom of `routes.ts`.

---

## Database Schema

### `reference_images`
- `id` varchar PK (UUID)
- `filename` text
- `filepath` text (absolute path in `uploads/`)
- `thumbnail_path` text (300×300 JPEG)
- `theme_code` text (one of 9 THEME_CODES)
- `uploaded_at` timestamp
- `metadata` jsonb (VisionAnalysisResult)
- `embedding` jsonb (legacy — do not use)
- `embedding_vector` vector(3072) ← **pgvector column, use this**

### `design_projects`
- `id` varchar PK (UUID)
- `category` text
- `theme` text
- `motifs` text[]
- `stones` text[]
- `material_ratio` text
- `custom_notes` text
- `reference_image_ids` text[]
- `sketch_plan` text
- `image_prompt` text
- `generated_image_url` text
- `created_at` timestamp

### `design_iterations`
- `id` varchar PK (UUID)
- `design_project_id` varchar FK → `design_projects.id`
- `iteration_number` integer
- `edit_prompt` text
- `source_image_url` text
- `result_image_url` text
- `created_at` timestamp

---

## Domain Constants

### Theme Codes (9)
`WRD` Wearable Daily · `WRO` Wearable Occasional · `CLO` Collectable Occasional
`SOD` Solitaire Daily · `SOO` Solitaire Occasional · `SOP` Solitaire Premium
`BRC` Bridal Classic · `BRP` Bridal Premium · `BRU` Bridal Unique

### Design Categories (16)
Long Necklace Set, Choker, Necklace, Bangle, Hathphool, Bracelet, Ring, Kantha, Brooch, Kalangi, Ear Extensions, Maangtika, Sheesh Patti, Buttons, Nath, Lapel Pin

### Modifier Categories (extended, used in /modify page)
Necklace Set, Only Necklace, Necklace Set Earring, Long Necklace Set, Only Long Necklace, Long Necklace Set Earring, Chokar Set, Only Chokar, Choker Set Earring, Earrings, Bracelet, Bangle, Pendant Set, Only Pendant, Pendant Set Earring, Long Pendent, Long Pendent Set, Long Pendent Set Earrings, Nosepin/Nath, Mangtika, Hathphool, Brooch, Ring, Mens Item - Buttons, Kalingi, Kanauti, Mala, Accessories - Linking kadi etc, Chain Necklace, Chain Necklace Set, Chain Necklace Set Earrings

### Product Segments (9)
Bridal, Bridal Lite, Traditional, Modern, RTW, Ear Essentials, Handwear, Add-ons, Exclusive - Grandeur

### Motif Groups
| Group | Motifs |
|-------|--------|
| Animal & Bird | Bird, Horse, Parrot, Peacock, Elephant, Butterfly, Tiger/Panther, Swan, Lion |
| Celestial & Spiritual | Sun, Crescent Moon, Stars |
| Contemporary Luxury | Art Deco, Victorian Art, Scallop, Ribbons |
| Forms & Shapes | Domes & Arches, Geometric, Abstract, Asymmetrical, Ovals, Marquise, Pears, Curves, Jaali Patterns |
| Nature - Inspired | Lotus, Rose, Tulip, Paan, Paisley, Leaves, Cluster Flowers |

> **Constraint:** Animal & Bird motifs are blocked for `CLO` theme.

### Stones (7 core)
Polki, Emerald, Rubies, Sapphires, Pink Tourmaline, Navratna, Amethyst

### Stone Colours (modifier)
Red Stone, Green Stone, Blue Stone, Pink Stone, White Stone, Coral Stone, Multicolour Stone, Navratna Stone, Violet Stone, Yellow Stone

### Finish Options
Yellow Gold Finish, Light Antique, Dark Antique, Matte, Hammered, Dual Tone, White Rhodium, Rose Gold Finish

### Design Shapes
Classic Choker, Dog Band Choker, Choker With Jhaalar, Semi Chokar, T-Shape, Round, Oval, Studs, Drops, Hoops, Earcuff, Basic, U-Shape, Y-Shape, V-Shape, Layered, Hasli

### Material Ratios
Polki Intensive, Diamond Intensive, Stone Intensive, Gold Intensive, Piroi Intensive

---

## BRAND_RULES — The Aesthetic System Prompt

Every Gemini image generation call is prepended with `BRAND_RULES` from `server/routes.ts`. It enforces:
- **Hand-drawn sketch style** — thin pencil outlines in soft brown/gold
- **Polki stones** — soft white rounded bubbles, no sparkle/facets
- **Gemstones** — pastel coloring, colored-pencil shading, smooth gradients
- **2D frontal drafting** — no perspective, no shadows, no black outlines, no realism
- **Background** — white or off-white sketch-paper texture
- **Category-specific rules** — necklace symmetry, ring proportions, etc.
- **Theme constraints** — WRD = lightweight, BRP = maximum polki coverage

**Never bypass or override BRAND_RULES.** Always prepend it to generation prompts.

---

## Multer Configuration (server/routes.ts)

Two Multer instances already exist — **do not create new ones**:

```typescript
// diskStorage — for reference image uploads (saves to uploads/)
const diskUpload = multer({ storage: diskStorage });

// memStorage — for ephemeral files (style overrides, modify uploads)
const memUpload = multer({ storage: memoryStorage });
```

Use `memUpload` for any endpoint that needs an image buffer without persisting the original.

---

## Adding a New Page — Checklist

1. Create `client/src/pages/your-page.tsx`
2. Add route in `client/src/App.tsx`:
   ```tsx
   <Route path="/your-path" component={YourPage} />
   ```
3. Add nav link in `client/src/components/layout.tsx` in the nav section
4. Add any new API fetch functions to `client/src/lib/api.ts`
5. Add any new server endpoint to `server/routes.ts` (before the static wildcard)

---

## Adding a New API Endpoint — Checklist

1. Add the route handler in `server/routes.ts`
2. Register it **before** the wildcard `app.use(serveStatic)` call at the bottom
3. Add the typed fetch wrapper in `client/src/lib/api.ts`
4. If it needs new DB operations, add them to `server/storage.ts` as methods on `DatabaseStorage`
5. If it changes the DB schema, update `shared/schema.ts` and run `npm run db:push`

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | ✅ Yes | PostgreSQL connection string (must have pgvector) |
| `GEMINI_API_KEY` | ✅ Yes | Google AI Studio key for Gemini 2.5 Flash |
| `GOOGLE_CLOUD_PROJECT_ID` | ✅ Yes | GCP project ID |
| `SESSION_SECRET` | Recommended | Express session secret |
| `OPENAI_API_KEY` | Optional | Fallback AI provider (not in primary flow) |

---

## NPM Scripts

| Script | Command |
|--------|---------|
| `npm run dev` | Full-stack dev server on port 5000 |
| `npm run build` | Production build (Vite + esbuild) |
| `npm run start` | Run production bundle |
| `npm run check` | TypeScript type check (run this after every change) |
| `npm run db:push` | Push schema changes to DB (dev only) |

---

## Design Data Flow — RAG Pipeline

```
User Input
  → generateTextEmbedding() [Gemini, 3072-dim]
  → searchSimilarVectors(topK=3) [pgvector cosine <=>]
  → analyzeReferenceImage() on top-3 refs [Gemini Vision]
  → buildDesignContext() + buildImagePrompt() + BRAND_RULES
  → generateJewellerySketch() [Gemini image gen]
  → Save PNG to disk + createDesignProject() in DB
  → Return { projectId, imageUrl, sketchPlan, imagePrompt, usedReferences }
```

## Design Modify Flow

```
User uploads image + selects parameters
  → POST /api/modify-design (multipart/form-data, memStorage)
  → Build edit prompt from parameters
  → editJewellerySketch(sourceBase64, editPrompt) [Gemini]
  → Save PNG to designs/modifications/
  → createDesignProject() in DB
  → Return { projectId, imageUrl, sketchPlan, imagePrompt }
```

---

## Code Style Rules

- **No `any` types** — always define proper TypeScript interfaces
- **Reuse existing components** — especially `ResultDisplay`, `OrnamentalDivider`, and all shadcn/ui components
- **Use `cn()` from `lib/utils.ts`** for conditional Tailwind classes
- **Use the existing toast hook** (`use-toast.ts`) for all notifications
- **Forms must use React Hook Form + Zod** — do not use uncontrolled inputs
- **API calls must go through `lib/api.ts`** — no raw fetch calls in page components
- **Color tokens from `index.css`** — use Tailwind theme tokens, not hardcoded hex values
- **Match `home.tsx` visual patterns** for any new pages — same hero strip, same card style, same column layout

---

## Files — Do Not Modify

Unless explicitly required by the task:
- `server/db.ts` — database connection
- `server/google-client.ts` — AI function implementations
- `server/vector-store.ts` — pgvector abstraction
- `shared/schema.ts` — only modify if adding new DB tables or columns
- `client/src/components/ui/` — shadcn/ui components
- `vite.config.ts`, `tsconfig.json`, `drizzle.config.ts`

---

## Disk Storage Paths

| Purpose | Path |
|---------|------|
| Reference image uploads | `uploads/{timestamp}-{random}.jpg` |
| Reference thumbnails | `uploads/{timestamp}-{random}-thumb.jpg` |
| Generated designs | `designs/{category}/{theme}/{timestamp}.png` |
| Modifier output designs | `designs/modifications/{timestamp}.png` |
