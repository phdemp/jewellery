# Jewellery Design Brain

## Overview

Jewellery Design Brain is an AI-powered web application that generates jewellery design sketches based on user-defined parameters. The application allows designers to specify categories (chokers, necklaces, earrings, etc.), themes (bridal, modern, festive), motifs (lotus, peacock, geometric), and material ratios to generate custom jewellery sketches in a specific hand-drawn artistic style.

The system uses Google AI services for vision analysis, multimodal embeddings for RAG-based similarity search, and Gemini for generating new sketches that follow strict brand design rules and artistic style guidelines.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state and caching
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with a custom jewellery-themed design system featuring antique gold, pastel pink, and soft sage green colors
- **Typography**: Cormorant Garamond (serif) and Montserrat (sans-serif) fonts

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Structure**: RESTful endpoints under `/api/` prefix
- **File Uploads**: Multer middleware for handling image uploads (10MB limit, JPEG/PNG only)
- **Build Process**: Custom esbuild script that bundles server dependencies for faster cold starts

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM with pgvector extension for vector similarity search
- **Schema**: Three main tables - users, reference_images, and design_projects
- **Vector Storage**: PostgreSQL with pgvector extension for 3072-dimension Gemini embeddings (stored in `embedding_vector` column on reference_images table)
- **File Storage**: Uploaded images stored in `uploads/` directory

### AI Integration (Google AI Services)
- **Gemini Vision (gemini-2.5-flash)**: Analyzes reference images to extract design descriptions, style elements, motifs, and structural patterns
- **Gemini Embeddings (gemini-embedding-001)**: Generates 3072-dimension vectors from text for RAG-based similarity search. Images are first analyzed by Gemini Vision, then the description is embedded. (Upgraded from deprecated text-embedding-004)
- **Gemini 3 Pro Image Preview**: Generates jewellery design sketches with high-quality text rendering
- **RAG System**: Uses pgvector cosine similarity search (`<=>` operator) to find similar reference designs from the library, filtered by theme code

### External Integrations
- **Google Drive**: Integration via Replit Connectors for importing reference images from Drive folders
- **Token Management**: Automatic OAuth token refresh every 30 minutes

### Key Design Patterns
- **Shared Schema**: Database schema and Zod validation schemas shared between frontend and backend via `@shared/` path alias
- **Multimodal RAG**: Embeddings generated directly from images enable image-to-image similarity search
- **Brand Rules Enforcement**: Strict design rules encoded in prompts (e.g., no animals in CLO designs, specific artistic style requirements)
- **Style Override**: Users can optionally upload a reference image during generation to override automatic RAG search

## External Dependencies

### Third-Party Services
- **Google Gemini API**: Vision analysis, text embeddings, and image generation via @google/genai SDK
- **Google Drive API**: For importing reference images from Google Drive folders via Replit Connectors

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **Drizzle ORM**: Type-safe database queries with automatic schema migrations via `drizzle-kit push`

### Key NPM Packages
- `@tanstack/react-query`: Server state management
- `drizzle-orm` / `drizzle-zod`: Database ORM and schema validation
- `@google/genai`: Google Gemini AI client
- `@google-cloud/aiplatform`: Google Cloud AI Platform SDK
- `google-auth-library`: Authentication for Vertex AI
- `googleapis`: Google Drive API access
- `multer`: File upload handling
- `framer-motion`: Animation library for result display

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string
- `GEMINI_API_KEY`: Google Gemini API key (from AI Studio - https://aistudio.google.com/apikey)
- Replit-specific variables for Google Drive connector (`REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`)

### API Endpoints
- `POST /api/reference-images`: Upload and analyze a reference image
- `GET /api/reference-images`: Get all reference images
- `DELETE /api/reference-images/:id`: Delete a reference image
- `POST /api/generate-design`: Generate a new jewellery design sketch
- `GET /api/design-projects`: Get all design projects
- `POST /api/import-from-drive`: Bulk import images from Google Drive
- `POST /api/reembed-references`: Re-embed all reference images with Google multimodal embeddings
- `POST /api/migrate-vectors`: Migrate existing JSON embeddings to pgvector column

## Recent Changes

- **January 2025**: Reference Library performance optimizations
  - Added thumbnail generation using sharp library (300x300 JPEG thumbnails)
  - Grid uses thumbnails for faster loading, detail dialog shows full images
  - Excluded embedding vectors from API response (reduces payload from ~300KB to ~60KB)
  - Thumbnails generated on upload and Google Drive import
  - Delete endpoint cleans up both original and thumbnail files
  - Added `/api/generate-thumbnails` endpoint for generating thumbnails for existing images

- **January 2025**: Upgraded to gemini-embedding-001 (3072 dimensions)
  - Replaced deprecated text-embedding-004 with gemini-embedding-001 (shutdown Jan 14, 2026)
  - Updated pgvector column to 3072 dimensions for higher quality embeddings
  - Re-embedded all reference images with the new model

- **January 2025**: Migrated vector storage from JSON file to PostgreSQL with pgvector
  - Added pgvector extension for native vector similarity search in PostgreSQL
  - Added `embedding_vector` column to reference_images table
  - Replaced in-memory cosine similarity with pgvector's `<=>` operator for faster searches
  - Added `/api/migrate-vectors` endpoint for migrating JSON embeddings to pgvector

- **January 2025**: Enhanced design generation prompts
  - Added safe-zone constraints (12% margins) to prevent cropped/cutoff designs
  - Added layout anchoring zones for necklace sets (top/middle/bottom positioning)
  - Enhanced gold minimization rule ("invisible gold" aesthetic with hairline-thin bezels)

- **December 2024**: Migrated from OpenAI to Google AI services
  - Replaced OpenAI Vision with Gemini 2.5 Flash for image analysis
  - Replaced OpenAI embeddings with Gemini text-embedding-004 (768 dimensions)
  - Replaced DALL-E 3 with Gemini 3 Pro Image Preview for image generation
  - Added `/api/reembed-references` endpoint for migrating existing vectors
  - Updated design form with grouped motif categories (Nature Inspired, Animal & Birds, Contemporary Forms, Celestial)
  - Enhanced design prompt with full brand design brief including segment codes (WRD, CLO, BRU, etc.)
