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

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Design Brain — Feedback & Prompt Learning**

A feedback system for the Raniwala 1881 Design Brain application that lets designers give structured text feedback on generated jewellery sketches. Feedback is stored, embedded, and injected into future generation prompts (RAG-style) to continuously improve output quality based on designer preferences.

**Core Value:** Every piece of designer feedback makes the next generation better — the system learns what the designer likes and dislikes, producing increasingly aligned results over time.

### Constraints

- **Tech stack**: Must use existing stack (React + Express + Drizzle + pgvector + Gemini embeddings)
- **Hosting**: Replit, single port 5000
- **AI provider**: Gemini text-embedding-004 for feedback embeddings (same as reference images)
- **No new dependencies**: Use existing libraries (shadcn/ui, React Hook Form, Zod, TanStack Query)
- **Brand aesthetic**: Feedback UI must match existing Raniwala 1881 design language (ornamental dividers, gold/jewel tones)
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.6.3 - Full-stack development (React + Express)
- JavaScript (ES2020+) - Runtime and build tools
- SQL - Database queries via Drizzle ORM and raw SQL for vector operations
## Runtime
- Node.js 24.14.0 (via tsx for TypeScript execution)
- npm 10.x
- Lockfile: package-lock.json (present)
## Frameworks
- Express.js 4.21.2 - HTTP API server
- React 19.2.0 - Frontend SPA with JSX preservation (`jsx: "preserve"`)
- Vite 7.1.9 - Frontend build tool and dev server
- Wouter 3.3.5 - Lightweight React router for client-side navigation
- React Hook Form 7.66.0 - Form state management
- Zod 3.25.76 - TypeScript-first schema validation
- drizzle-zod 0.7.0 - Auto-generate Zod schemas from Drizzle tables
- Tailwind CSS 4.1.14 - Utility-first CSS framework with Vite plugin
- shadcn/ui - Headless React component library (radix-ui based)
- PostCSS 8.5.6 - CSS transformation
- Autoprefixer 10.4.21 - CSS vendor prefixing
- Framer Motion 12.23.24 - React component animations (used in result display cards)
- TanStack React Query 5.60.5 - Server state and caching (QueryClient configured in `lib/queryClient.ts`)
- Native Fetch API - All API calls via typed wrappers in `client/src/lib/api.ts`
- Lucide React 0.545.0 - Icon library
- Embla Carousel React 8.6.0 - Carousel component
- Recharts 2.15.4 - Chart library (for costing reports)
- Sonner 2.0.7 - Toast notifications
- Next Themes 0.4.6 - Dark/light mode management
## Database
- PostgreSQL (via DATABASE_URL in .env)
- Drizzle ORM 0.39.3 - TypeScript-safe query builder
- pg 8.16.3 - Node.js PostgreSQL driver with connection pooling
- pgvector - PostgreSQL extension for 3072-dimensional vector similarity
- Drizzle Kit 0.31.4 - Schema management and migrations
## AI & Image Processing
- Google Gemini 2.5 Flash - Vision (reference image analysis) and Embeddings
- Google Gemini 3 Pro Image Preview - Image generation (sketch generation + editing + marketing visuals)
- OpenAI gpt-image-1 - CAD renders, design modification, marketing visuals
- xAI Grok (`grok-imagine-image`) - Text-to-image generation and image editing
- Google Text-Embedding-004 - 3072-dimensional embeddings for text and images
- Sharp 0.34.5 - Image manipulation (resize, format conversion, quality control)
- `@google/genai` 1.32.0 - Google AI API client
- `@google-cloud/aiplatform` 6.0.0 - GCP AI Platform (for potential Vertex AI usage)
- google-auth-library 10.5.0 - Authentication for Google APIs
- googleapis 148.0.0 - Google Drive API for bulk reference imports
## File Upload & Storage
- Multer 2.0.2 - File upload middleware
- JPEG for reference images and thumbnails
- PNG for generated sketches
- Supported input formats: JPEG, PNG (via Sharp)
## Error Tracking & Monitoring
- Sentry Node 10.46.0 - Backend error capture (DSN: `process.env.SENTRY_BACKEND_DSN`)
- Sentry React 10.46.0 - Frontend error capture (DSN: `import.meta.env.VITE_SENTRY_DSN`)
## Data Export & Processing
- xlsx 0.18.5 - Excel file parsing (for stock item import)
- ws 8.18.0 - WebSocket implementation (optional dependency: bufferutil 4.0.8)
## Build & Development
- esbuild 0.25.0 - JavaScript bundler (production build via `script/build.ts`)
- tsx 4.20.5 - TypeScript execution for Node.js scripts
- Vite plugins (Replit-specific for dev experience)
- cross-env 10.1.0 - Cross-platform environment variable handling
- Playwright 1.58.2 - Browser automation for testing (dev dependency)
## Configuration
- `DATABASE_URL` - PostgreSQL connection string
- `GEMINI_API_KEY` - Google AI Studio API key
- `GOOGLE_CLOUD_PROJECT_ID` - GCP project ID
- `OPENAI_API_KEY` - OpenAI API key (currently billing-limited)
- `GROK_API_KEY` - xAI Grok API key
- `VITE_SENTRY_DSN` - Frontend error tracking (optional, client-side)
- `SENTRY_BACKEND_DSN` - Backend error tracking (optional)
- `SESSION_SECRET` - Express session secret (recommended)
- `PORT` - Server port (default 5000)
- Target: ESNext module system
- Strict mode enabled
- Path aliases:
- Production: `dist/` (served as static files)
- Frontend compiled to: `dist/public/`
- Source maps: enabled via `tsx` for debugging
## Platform Requirements
- Node.js 24.14.0+ (with npm)
- PostgreSQL 12+ with pgvector extension
- Environment: Windows 10 Pro, macOS, or Linux
- Shell: Bash (Unix syntax, forward slashes)
- Deployment: Replit (single port 5000 for both API and frontend)
- PostgreSQL database with pgvector extension
- API key access to: Google (Gemini), OpenAI, xAI Grok
- Sentry project for error tracking (optional)
## Port & Networking
- Vite dev server: Port 5000 (full-stack via tsx + Vite middleware)
- Frontend: Served from `client/` root with Vite plugins
- Backend: Express.js on same port via http module
- Single port 5000 (HTTP/Express serving both API and static frontend)
- Firewall: Only port 5000 is accessible on Replit
## Package Lock & Dependencies
- Total production dependencies: 83
- Total dev dependencies: 17
- Optional dependencies: 1 (bufferutil for WebSocket optimization)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- **React components:** PascalCase (e.g., `design-form.tsx`, `result-display.tsx`, `layout.tsx`)
- **Utilities and hooks:** kebab-case (e.g., `use-toast.ts`, `use-mobile.tsx`, `jewellery-logic.ts`)
- **API module:** single file `api.ts` (e.g., `client/src/lib/api.ts`)
- **Server routes/logic:** single file `routes.ts` (e.g., `server/routes.ts`)
- **Specialized services:** single-purpose files (e.g., `google-client.ts`, `openai-client.ts`, `grok-client.ts`, `costing.ts`, `vector-store.ts`)
- **Async functions:** camelCase (e.g., `generateDesign()`, `uploadReferenceImage()`, `editDesign()`, `handleGenerate()`)
- **Handler functions:** prefix with `handle` (e.g., `handleGenerate()`, `handleEdit()`, `handleSave()`)
- **Toggle/state functions:** prefix with `toggle` (e.g., `togglePolkiSize()`, `toggleMotifCategory()`, `toggleTechnique()`)
- **Helper functions:** descriptive camelCase (e.g., `withRetry()`, `toModelResult()`, `firstSuccessfulUrl()`)
- **State variables:** camelCase (e.g., `isGenerating`, `editPrompt`, `styleOverride`, `currentImageIndex`)
- **Watched form fields:** prefix with `watched` (e.g., `watchedSegment`, `watchedMotifCats`, `watchedStoneNames`)
- **Constants (module-level):** CONSTANT_CASE or camelCase if exported (e.g., `POLKI_SIZES`, `DESIGN_SHAPES`, `THEME_CODES`, `diskStorage`)
- **Ref variables:** suffix with `Ref` (e.g., `costReportRef`)
- **Props interfaces:** suffix with `Props` (e.g., `ResultDisplayProps`, `DesignFormProps`)
- **Interfaces (API/data models):** PascalCase (e.g., `ReferenceImage`, `DesignGenerationResponse`, `ModelResult`, `CostingReportData`)
- **Type aliases:** PascalCase (e.g., `DesignRequest`, `GoldPurity`, `GrokAspectRatio`)
- **Exported constants as const:** PascalCase (e.g., `THEME_CODES`, `REFERENCE_SEGMENTS`)
## Code Style
- **No explicit formatter configured** — rely on TypeScript's `strict` mode and code consistency
- **Indentation:** 2 spaces (inferred from codebase)
- **Quote style:** double quotes for strings and JSX attributes
- **Semicolons:** required at statement end
- **Line length:** no strict limit enforced, but code remains readable
- **TypeScript Strict Mode:** `"strict": true` in `tsconfig.json`
- **No ESLint/Prettier configured** — project uses manual convention adherence
- **Type checking:** Run `npm run check` (TypeScript noEmit check) after every change
- **No `any` types allowed** — always define proper TypeScript interfaces
## Import Organization
- `@/*` → `./client/src/*` (client-side)
- `@shared/*` → `./shared/*` (shared types/schemas)
- `@assets` → `./attached_assets` (static assets)
## Error Handling
- Use `error: any` in catch blocks (TypeScript best practice for unknown errors)
- Check `error instanceof Error` before accessing `.message`
- Log error context with Sentry for API errors
## Logging
- `console.warn()` — for recoverable errors or warnings (e.g., retry attempts)
- `console.error()` — for unhandled errors passed to catch chains
- Use labels for context (e.g., `"[Gemini] Transient error..."`)
- No logging in production code paths unless debugging critical features
- Use Sentry for exception tracking in error handlers
## Comments
- **Section dividers:** Use multi-dash separator comments to group related code
- **Intentional empty cases:** Explain why something is absent
- **Cascading logic:** Explain conditional computed values
- **Non-obvious behavior:** Explain constraint handling or special rules
- Not used in this codebase — rely on TypeScript types and interface definitions for documentation
- Function signatures are self-documenting via type definitions
## Function Design
- Keep functions under 50 lines when possible
- Complex logic (e.g., form state management) can reach 100-200 lines
- Extract helpers for repeated patterns
- Use composition over inheritance
- Named parameters preferred over positional for clarity
- Use destructuring for objects (e.g., `{ result, category }`)
- Optional parameters marked with `?` in TypeScript
- Async functions clearly marked with `async` keyword
- Explicit return types always specified (no implicit `any`)
- Promises wrapped as `Promise<T>` for async functions
- Union types used when multiple return paths possible (e.g., `ModelResult | null`)
- Early returns preferred for guards and error cases
## Module Design
- **Named exports** preferred (easier to refactor and trace)
- **Default exports** used only for page components (`export default function Home() { ... }`)
- **Interface exports** prefixed with `export interface` (not in separate block)
- **Type aliases** with `export type`
- **Constants** with `export const`
- Not used — direct imports from modules (e.g., `import { cn } from "@/lib/utils"`, not from index file)
## React Patterns
- **React Hook Form:** All forms use `useForm()` with Zod validation
- **State Management:** `useState()` for local component state
- **Effects:** `useEffect()` for side effects (data fetching, subscriptions)
- **Custom Hooks:** Prefix with `use` (e.g., `useToast()`, `useMobile()`)
- **No prop drilling:** Use hooks or context (toast hook for notifications)
- Always use React Hook Form + Zod
- No uncontrolled inputs
- Cascading dropdowns use `watch()` to observe field changes
- Array fields (checkboxes) managed with `setValue()` and `getValues()`
- Form submission via `handleSubmit()` wrapper
- Always define `Props` interface for destructured props
- Optional props marked with `?`
- Children passed as `children?: ReactNode`
- Event handlers prefixed with `on` (e.g., `onSubmit()`)
## Tailwind CSS
- Use `cn()` from `@/lib/utils` for conditional classes (clsx + tailwind-merge)
- No hardcoded hex colors — use Tailwind theme tokens (primary, secondary, muted-foreground, etc.)
- Theme colors defined in `client/src/index.css` as CSS custom properties
- Grid for multi-column layouts (e.g., `grid grid-cols-1 lg:grid-cols-12 gap-8`)
- Flex for linear layouts
- Responsive prefixes (sm, md, lg, xl) for breakpoints
- Gap utilities for spacing between elements
## Shared Patterns
- All API calls wrapped in async functions
- Return typed responses via TypeScript interfaces
- Error handling with `.ok()` check and Sentry capture
- FormData for multipart requests
- JSON for simple POST/GET
- Use `DesignRequest` type from `@/lib/jewellery-logic`
- Optional fields marked with `?`
- Categories, motifs, stones defined as string arrays
- Gold rate, percentage as numbers
- `CostingReportData` interface returned in `DesignGenerationResponse`
- Rendered via `<CostReport>` component when present
- Triggered when `priceBand` + `goldRatePerGram` provided
- Three models run in parallel: Gemini, OpenAI (gpt-image-1), Grok
- Response includes `gemini`, `openai`, `grok` ModelResult objects
- `firstSuccessfulUrl()` used to pick first non-null result for backward compatibility
- Displayed via `<MultiModelResult>` component showing all three
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Monorepo structure: `client/` (React SPA), `server/` (Express API), `shared/` (Zod schemas + TypeScript types)
- RAG pipeline driven by pgvector embeddings (3072-dim Gemini embeddings)
- 3-model parallel AI generation (Gemini + OpenAI + Grok) via `Promise.allSettled`
- Server-side image processing via Sharp (thumbnails, conversions)
- Drizzle ORM with PostgreSQL + pgvector extension
- Wouter-based client-side routing (lightweight, minimal overhead)
- Server port: 5000 (unified API + static asset serving)
## Layers
- Purpose: React 19 UI with Wouter routing, form state via React Hook Form + Zod, data fetching via TanStack React Query
- Location: `client/src/`
- Contains: 7 pages, 15+ reusable components, 4 lib files (api, jewellery-logic, queryClient, utils), 2 custom hooks
- Depends on: `server/routes.ts` (API), `shared/schema.ts` (types), shadcn/ui (styled components), Tailwind CSS
- Used by: End users (design studio, references, modify, CAD comparison, marketing, assortment planning)
- Purpose: Handle HTTP requests, orchestrate AI calls, manage file uploads, database operations
- Location: `server/routes.ts` (2523 lines, 17 endpoints + 1 debug endpoint)
- Contains: Multer config, endpoint handlers, helper functions (`firstSuccessfulUrl`, `toModelResult`, `buildCADPromptJSON`, `buildImagePromptJSON`, etc.)
- Depends on: Google Gemini client, OpenAI client, Grok client, Drizzle ORM, pgvector vector store, file system, Sharp
- Used by: All client pages
- Purpose: Interface with external AI providers (Gemini 2.5 Flash for vision/embeddings, Gemini 3 Pro Image for generation, OpenAI gpt-image-1, xAI Grok)
- Location: `server/google-client.ts`, `server/openai-client.ts`, `server/grok-client.ts`
- Contains: 14 Gemini functions, 3 OpenAI functions, 3 Grok functions
- Depends on: `@google/genai` SDK, `openai` SDK, raw `fetch` for Grok JSON edits
- Used by: `server/routes.ts`
- Purpose: Semantic similarity search via pgvector cosine distance (1 - distance = similarity)
- Location: `server/vector-store.ts` (6 functions)
- Contains: `addVector`, `searchSimilarVectors`, `getAllVectors`, `deleteVector`, `clearVectorStore`, `migrateJsonToVector`
- Depends on: PostgreSQL with pgvector extension
- Used by: RAG pipeline in `/api/generate-design`
- Purpose: CRUD operations for all entities (reference images, design projects, iterations, B2C sales, stock items, assortment plans)
- Location: `server/storage.ts` (DatabaseStorage class implementing IStorage)
- Contains: 18 methods (reference images, design projects, design iterations, B2C sales, stock items, recommendations, assortment plans)
- Depends on: Drizzle ORM, PostgreSQL schema (`shared/schema.ts`)
- Used by: `server/routes.ts`
- Purpose: Zod validators + Drizzle table definitions for all database entities
- Location: `shared/schema.ts`
- Contains: 6 tables (referenceImages, designProjects, designIterations, b2cSales, stockItems, assortmentPlans), Zod insertion schemas, theme codes
- Depends on: Drizzle ORM, Zod
- Used by: Both frontend (type safety) and backend (validation, ORM)
## Data Flow
- **Client State:** React Hook Form (form values), Framer Motion (animations), TanStack React Query (server state caching)
- **Server State:** PostgreSQL (persistent), in-memory design import job state (`designImportJob` object in routes.ts)
- **Transient State:** Multer memory uploads, Sharp processing buffers, API response objects
## Key Abstractions
- Purpose: Abstract all database operations behind typed interface
- Examples: `server/storage.ts` (DatabaseStorage class)
- Pattern: Data Access Object (DAO) with method-per-operation (no query builders exposed)
- Key methods: `createReferenceImage`, `getDesignProject`, `getStockItemsForRecommendation`, `createAssortmentPlan`
- Purpose: Strongly-typed structures for RAG pipeline intermediate results
- Examples: Defined in `server/google-client.ts`
- Pattern: TypeScript interfaces with optional fields for flexibility
- Usage: `analyzeReferenceImage()` returns VisionAnalysisResult; `buildDesignContext()` combines user input + analysis
- Purpose: Unified shape for multi-model generation results
- Examples: Defined in `client/src/lib/api.ts`
- Pattern: `{ imageUrl: string | null, error: string | null, model: string }`
- Usage: All 4 image-generation endpoints return results for Gemini, OpenAI, Grok
- Purpose: Complete user design form input
- Examples: Defined in `client/src/lib/jewellery-logic.ts`
- Pattern: Union of optional string fields, arrays, numbers (covers all form fields across 3 generation pages)
- Usage: Passed from form to `generateDesign()` API call
- Purpose: Single source of truth for data validation
- Examples: `insertReferenceImageSchema`, `insertDesignProjectSchema`, `driveImportRequestSchema` in `shared/schema.ts`
- Pattern: Derived from Drizzle table definitions using `createInsertSchema`, then extended with `.omit()` / `.extend()`
- Usage: Server-side validation before database insert; client-side form validation
## Entry Points
- Location: `server/index.ts` (106 lines)
- Triggers: `npm run dev` or `npm start`
- Responsibilities:
- Location: `client/src/main.tsx` (13 lines)
- Triggers: Browser loads `index.html`
- Responsibilities:
- Location: `client/src/App.tsx` (59 lines)
- Triggers: Page load or route navigation
- Responsibilities:
- Location: `client/src/components/layout.tsx` (123 lines)
- Triggers: Every page via Layout component import
- Responsibilities:
- Location: `server/routes.ts` → `registerRoutes(httpServer, app)` async function
- Triggers: Server startup (called from `server/index.ts`)
- Responsibilities:
## Error Handling
- Validation errors return 400 with Zod error details
- Database errors return 500 with sanitized message (never expose DB schema details)
- File upload errors caught by Multer filters (size, mime type) → return 400
## Cross-Cutting Concerns
- Server: `log(message, source)` function in `server/index.ts` formats time + source
- Middleware: Logs all `/api/*` requests with method, path, status code, duration (ms)
- Client: Console logs in dev mode (browser DevTools)
- Production: Sentry captures all errors automatically
- Server-side: Zod schemas in `shared/schema.ts` validate all inputs before DB insert
- Client-side: React Hook Form + Zod validate form before submission
- File uploads: Multer fileFilter checks mime types (JPEG, PNG, WebP)
- Current: None (open API, no auth middleware)
- Note: Sentry DSN configured but no user identification (should add in future)
- Current: Not configured (single-origin, both API and static served on same port)
- Assumption: Served on same domain (Replit)
- Reference uploads: `uploads/{timestamp}-{random}.{ext}` (disk, persistent)
- Reference thumbnails: `uploads/thumb_{timestamp}-{random}.jpg` (disk, 300x300)
- Generated sketches: `uploads/generated_{timestamp}.png` (disk, temp until moved to designs/)
- CAD renders: `uploads/cad_{timestamp}.png` (disk)
- Grok outputs: `uploads/grok_{timestamp}.png` (disk)
- Saved designs: `designs/{category}/{theme}/{timestamp}.png` (organized by user choice)
- All paths served statically via `app.use('/uploads', express.static(...))` and `app.use('/designs', ...)`
- Sharp used for thumbnail generation (300x300, center crop, 80% JPEG quality)
- Base64 encoding used for AI Vision API inputs (Gemini, OpenAI, Grok)
- PNG format for all AI-generated outputs (no compression, preserve quality)
## Deployment Architecture
- Express server serves both API (`/api/*`) and static assets (`/uploads`, `/designs`, `/`, `/index.html`)
- Vite dev server integrated in dev mode via `setupVite()` middleware
- Production build: Vite generates `dist/` bundle, esbuild produces `dist/index.cjs`
- Port: 5000 (only non-firewalled port on Replit)
- `.env` file contains: `DATABASE_URL`, `GEMINI_API_KEY`, `GOOGLE_CLOUD_PROJECT_ID`, `OPENAI_API_KEY`, `GROK_API_KEY`, `SESSION_SECRET`, `SENTRY_BACKEND_DSN`, `SENTRY_FRONTEND_DSN`
- Development: `NODE_ENV=development` loads `.env` and enables hot-reload
- Production: `NODE_ENV=production` disables Vite dev middleware, serves static only
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
