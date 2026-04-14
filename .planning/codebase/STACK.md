# Technology Stack

**Analysis Date:** 2025-04-14

## Languages

**Primary:**
- TypeScript 5.6.3 - Full-stack development (React + Express)

**Secondary:**
- JavaScript (ES2020+) - Runtime and build tools
- SQL - Database queries via Drizzle ORM and raw SQL for vector operations

## Runtime

**Environment:**
- Node.js 24.14.0 (via tsx for TypeScript execution)

**Package Manager:**
- npm 10.x
- Lockfile: package-lock.json (present)

## Frameworks

**Core:**
- Express.js 4.21.2 - HTTP API server
- React 19.2.0 - Frontend SPA with JSX preservation (`jsx: "preserve"`)
- Vite 7.1.9 - Frontend build tool and dev server

**Routing:**
- Wouter 3.3.5 - Lightweight React router for client-side navigation

**Forms & Validation:**
- React Hook Form 7.66.0 - Form state management
- Zod 3.25.76 - TypeScript-first schema validation
- drizzle-zod 0.7.0 - Auto-generate Zod schemas from Drizzle tables

**Styling:**
- Tailwind CSS 4.1.14 - Utility-first CSS framework with Vite plugin
- shadcn/ui - Headless React component library (radix-ui based)
  - 15+ Radix UI primitives (@radix-ui/*) for accessible components
- PostCSS 8.5.6 - CSS transformation
- Autoprefixer 10.4.21 - CSS vendor prefixing

**Animation:**
- Framer Motion 12.23.24 - React component animations (used in result display cards)

**State Management:**
- TanStack React Query 5.60.5 - Server state and caching (QueryClient configured in `lib/queryClient.ts`)

**Data Fetching & HTTP:**
- Native Fetch API - All API calls via typed wrappers in `client/src/lib/api.ts`

**UI Components:**
- Lucide React 0.545.0 - Icon library
- Embla Carousel React 8.6.0 - Carousel component
- Recharts 2.15.4 - Chart library (for costing reports)
- Sonner 2.0.7 - Toast notifications
- Next Themes 0.4.6 - Dark/light mode management

## Database

**Primary:**
- PostgreSQL (via DATABASE_URL in .env)
- Drizzle ORM 0.39.3 - TypeScript-safe query builder
- pg 8.16.3 - Node.js PostgreSQL driver with connection pooling

**Vector Search:**
- pgvector - PostgreSQL extension for 3072-dimensional vector similarity
  - Custom type defined in `shared/schema.ts` mapping to `vector(3072)`
  - Cosine similarity search via `<=>` operator
  - Used for RAG pipeline: embeddings → similarity search → top-3 reference images

**Migrations:**
- Drizzle Kit 0.31.4 - Schema management and migrations

## AI & Image Processing

**Primary AI Models:**
- Google Gemini 2.5 Flash - Vision (reference image analysis) and Embeddings
- Google Gemini 3 Pro Image Preview - Image generation (sketch generation + editing + marketing visuals)
  - SDK: `@google/genai` 1.32.0
  - Timeout: 180,000 ms (3 min) for image generation; 30,000 ms for vision
  - Retry: Once on `DEADLINE_EXCEEDED`, `UNAVAILABLE`, or `503` after 3s delay

**Secondary AI Models:**
- OpenAI gpt-image-1 - CAD renders, design modification, marketing visuals
  - SDK: `openai` 6.10.0
  - Note: Billing hard limit reached as of 2026-03-27

**Tertiary AI Models:**
- xAI Grok (`grok-imagine-image`) - Text-to-image generation and image editing
  - Accessed via OpenAI SDK with `baseURL: "https://api.x.ai/v1"`
  - Custom content filter to replace animal/bird motif names with "motif" (avoids content moderation)

**Embeddings:**
- Google Text-Embedding-004 - 3072-dimensional embeddings for text and images
  - Used for design input text and reference image analysis
  - Stored in pgvector column `embedding_vector`

**Image Processing:**
- Sharp 0.34.5 - Image manipulation (resize, format conversion, quality control)
  - Thumbnail generation: 300×300 JPEG for reference images
  - Buffer processing for multipart form uploads

**GCP Integration:**
- `@google/genai` 1.32.0 - Google AI API client
- `@google-cloud/aiplatform` 6.0.0 - GCP AI Platform (for potential Vertex AI usage)
- google-auth-library 10.5.0 - Authentication for Google APIs
- googleapis 148.0.0 - Google Drive API for bulk reference imports

## File Upload & Storage

**Upload Handling:**
- Multer 2.0.2 - File upload middleware
  - Disk storage: Reference images → `uploads/` directory
  - Memory storage: Ephemeral files (style overrides, design modifications)

**File Types:**
- JPEG for reference images and thumbnails
- PNG for generated sketches
- Supported input formats: JPEG, PNG (via Sharp)

## Error Tracking & Monitoring

**Error Tracking:**
- Sentry Node 10.46.0 - Backend error capture (DSN: `process.env.SENTRY_BACKEND_DSN`)
- Sentry React 10.46.0 - Frontend error capture (DSN: `import.meta.env.VITE_SENTRY_DSN`)
  - Integrated at app startup in `client/src/main.tsx` and `server/index.ts`

## Data Export & Processing

**Excel/Spreadsheet:**
- xlsx 0.18.5 - Excel file parsing (for stock item import)

**WebSocket Support:**
- ws 8.18.0 - WebSocket implementation (optional dependency: bufferutil 4.0.8)

## Build & Development

**Build Tools:**
- esbuild 0.25.0 - JavaScript bundler (production build via `script/build.ts`)
- tsx 4.20.5 - TypeScript execution for Node.js scripts
- Vite plugins (Replit-specific for dev experience)
  - `@replit/vite-plugin-cartographer` - Code navigation
  - `@replit/vite-plugin-dev-banner` - Dev server banner
  - `@replit/vite-plugin-runtime-error-modal` - Error overlay
  - `@tailwindcss/vite` - Tailwind CSS integration

**Development:**
- cross-env 10.1.0 - Cross-platform environment variable handling
- Playwright 1.58.2 - Browser automation for testing (dev dependency)

## Configuration

**Environment:**
Required environment variables (in `.env`):
- `DATABASE_URL` - PostgreSQL connection string
- `GEMINI_API_KEY` - Google AI Studio API key
- `GOOGLE_CLOUD_PROJECT_ID` - GCP project ID
- `OPENAI_API_KEY` - OpenAI API key (currently billing-limited)
- `GROK_API_KEY` - xAI Grok API key
- `VITE_SENTRY_DSN` - Frontend error tracking (optional, client-side)
- `SENTRY_BACKEND_DSN` - Backend error tracking (optional)
- `SESSION_SECRET` - Express session secret (recommended)
- `PORT` - Server port (default 5000)

**TypeScript:**
- Target: ESNext module system
- Strict mode enabled
- Path aliases:
  - `@/*` → `client/src/*`
  - `@shared/*` → `shared/*`
  - `@assets` → `attached_assets/`

**Build Output:**
- Production: `dist/` (served as static files)
- Frontend compiled to: `dist/public/`
- Source maps: enabled via `tsx` for debugging

## Platform Requirements

**Development:**
- Node.js 24.14.0+ (with npm)
- PostgreSQL 12+ with pgvector extension
- Environment: Windows 10 Pro, macOS, or Linux
- Shell: Bash (Unix syntax, forward slashes)

**Production:**
- Deployment: Replit (single port 5000 for both API and frontend)
- PostgreSQL database with pgvector extension
- API key access to: Google (Gemini), OpenAI, xAI Grok
- Sentry project for error tracking (optional)

## Port & Networking

**Development:**
- Vite dev server: Port 5000 (full-stack via tsx + Vite middleware)
- Frontend: Served from `client/` root with Vite plugins
- Backend: Express.js on same port via http module

**Production:**
- Single port 5000 (HTTP/Express serving both API and static frontend)
- Firewall: Only port 5000 is accessible on Replit

## Package Lock & Dependencies

- Total production dependencies: 83
- Total dev dependencies: 17
- Optional dependencies: 1 (bufferutil for WebSocket optimization)

---

*Stack analysis: 2025-04-14*
