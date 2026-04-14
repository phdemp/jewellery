# Coding Conventions

**Analysis Date:** 2025-04-14

## Naming Patterns

**Files:**
- **React components:** PascalCase (e.g., `design-form.tsx`, `result-display.tsx`, `layout.tsx`)
- **Utilities and hooks:** kebab-case (e.g., `use-toast.ts`, `use-mobile.tsx`, `jewellery-logic.ts`)
- **API module:** single file `api.ts` (e.g., `client/src/lib/api.ts`)
- **Server routes/logic:** single file `routes.ts` (e.g., `server/routes.ts`)
- **Specialized services:** single-purpose files (e.g., `google-client.ts`, `openai-client.ts`, `grok-client.ts`, `costing.ts`, `vector-store.ts`)

**Functions:**
- **Async functions:** camelCase (e.g., `generateDesign()`, `uploadReferenceImage()`, `editDesign()`, `handleGenerate()`)
- **Handler functions:** prefix with `handle` (e.g., `handleGenerate()`, `handleEdit()`, `handleSave()`)
- **Toggle/state functions:** prefix with `toggle` (e.g., `togglePolkiSize()`, `toggleMotifCategory()`, `toggleTechnique()`)
- **Helper functions:** descriptive camelCase (e.g., `withRetry()`, `toModelResult()`, `firstSuccessfulUrl()`)

**Variables:**
- **State variables:** camelCase (e.g., `isGenerating`, `editPrompt`, `styleOverride`, `currentImageIndex`)
- **Watched form fields:** prefix with `watched` (e.g., `watchedSegment`, `watchedMotifCats`, `watchedStoneNames`)
- **Constants (module-level):** CONSTANT_CASE or camelCase if exported (e.g., `POLKI_SIZES`, `DESIGN_SHAPES`, `THEME_CODES`, `diskStorage`)
- **Ref variables:** suffix with `Ref` (e.g., `costReportRef`)
- **Props interfaces:** suffix with `Props` (e.g., `ResultDisplayProps`, `DesignFormProps`)

**Types:**
- **Interfaces (API/data models):** PascalCase (e.g., `ReferenceImage`, `DesignGenerationResponse`, `ModelResult`, `CostingReportData`)
- **Type aliases:** PascalCase (e.g., `DesignRequest`, `GoldPurity`, `GrokAspectRatio`)
- **Exported constants as const:** PascalCase (e.g., `THEME_CODES`, `REFERENCE_SEGMENTS`)

## Code Style

**Formatting:**
- **No explicit formatter configured** — rely on TypeScript's `strict` mode and code consistency
- **Indentation:** 2 spaces (inferred from codebase)
- **Quote style:** double quotes for strings and JSX attributes
- **Semicolons:** required at statement end
- **Line length:** no strict limit enforced, but code remains readable

**Linting:**
- **TypeScript Strict Mode:** `"strict": true` in `tsconfig.json`
- **No ESLint/Prettier configured** — project uses manual convention adherence
- **Type checking:** Run `npm run check` (TypeScript noEmit check) after every change
- **No `any` types allowed** — always define proper TypeScript interfaces

## Import Organization

**Order (both client and server):**
1. External packages (`react`, `@google/genai`, `express`, etc.)
2. Sentry error tracking (`@sentry/react` or `@sentry/node`)
3. Type imports (`type` keyword used explicitly)
4. Project utilities from `@/lib` or `./lib`
5. Project components from `@/components` or `./components`
6. Shared types from `@shared/*`
7. Assets/images (with `@assets` alias)

**Example (client):**
```typescript
import { useState, useRef } from "react";
import * as Sentry from "@sentry/react";
import { Layout } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import { generateDesign, type DesignGenerationResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
```

**Example (server):**
```typescript
import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { referenceImages } from "@shared/schema";
```

**Path Aliases:**
- `@/*` → `./client/src/*` (client-side)
- `@shared/*` → `./shared/*` (shared types/schemas)
- `@assets` → `./attached_assets` (static assets)

## Error Handling

**Pattern (client):**
```typescript
try {
  const generated = await generateDesign({ ...data, mode }, styleOverride);
  setResult(generated);
  toast({ title: "Design Generated", description: "..." });
} catch (error: any) {
  toast({
    title: "Error",
    description: error.message || "Failed to generate design. Please try again.",
    variant: "destructive",
  });
}
```

**Pattern (API calls):**
```typescript
if (!response.ok) {
  const error = await response.json();
  const err = new Error(error.error || 'Failed to upload reference image');
  Sentry.captureException(err, { extra: { endpoint: '/api/reference-images', status: response.status } });
  throw err;
}
```

**Pattern (retries — server only):**
```typescript
/** Retry once on transient Gemini errors (DEADLINE_EXCEEDED / UNAVAILABLE). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("DEADLINE_EXCEEDED") || msg.includes("UNAVAILABLE") || msg.includes("503")) {
      console.warn("[Gemini] Transient error, retrying once:", msg);
      await new Promise(r => setTimeout(r, 3000));
      return fn();
    }
    throw err;
  }
}
```

**Error Type Casting:**
- Use `error: any` in catch blocks (TypeScript best practice for unknown errors)
- Check `error instanceof Error` before accessing `.message`
- Log error context with Sentry for API errors

## Logging

**Framework:** `console.*` (no dedicated logging library)

**Patterns:**
- `console.warn()` — for recoverable errors or warnings (e.g., retry attempts)
- `console.error()` — for unhandled errors passed to catch chains
- Use labels for context (e.g., `"[Gemini] Transient error..."`)
- No logging in production code paths unless debugging critical features
- Use Sentry for exception tracking in error handlers

**Example:**
```typescript
console.warn("[Gemini] Transient error, retrying once:", msg);
getDesignIterations(result.id).then(setIterations).catch(console.error);
```

## Comments

**When to Comment:**
- **Section dividers:** Use multi-dash separator comments to group related code
  ```typescript
  // ─── Constants ────────────────────────────────────────────────────────────────
  // ── Toggle helpers ────────────────────────────────────────────────────────────
  // ── Submit ─────────────────────────────────────────────────────────────────────
  ```
- **Intentional empty cases:** Explain why something is absent
  ```typescript
  "No Motifs": // "No Motifs" intentionally has no entry
  ```
- **Cascading logic:** Explain conditional computed values
  ```typescript
  // Cascading dropdown options
  const availableCategories = watchedSegment ? ... : [];
  ```
- **Non-obvious behavior:** Explain constraint handling or special rules
  ```typescript
  // When motif categories change, clear motifs that are no longer available
  useEffect(() => { ... }, [watchedMotifCats]);
  ```

**JSDoc/TSDoc:**
- Not used in this codebase — rely on TypeScript types and interface definitions for documentation
- Function signatures are self-documenting via type definitions

## Function Design

**Size Guidelines:**
- Keep functions under 50 lines when possible
- Complex logic (e.g., form state management) can reach 100-200 lines
- Extract helpers for repeated patterns
- Use composition over inheritance

**Parameters:**
- Named parameters preferred over positional for clarity
- Use destructuring for objects (e.g., `{ result, category }`)
- Optional parameters marked with `?` in TypeScript
- Async functions clearly marked with `async` keyword

**Return Values:**
- Explicit return types always specified (no implicit `any`)
- Promises wrapped as `Promise<T>` for async functions
- Union types used when multiple return paths possible (e.g., `ModelResult | null`)
- Early returns preferred for guards and error cases

**Example:**
```typescript
export async function generateDesign(
  request: DesignRequest,
  styleOverride?: File
): Promise<DesignGenerationResponse> {
  const formData = new FormData();
  formData.append('category', request.category);

  if (!response.ok) {
    throw new Error('Failed to generate design');
  }

  return response.json();
}
```

## Module Design

**Exports:**
- **Named exports** preferred (easier to refactor and trace)
- **Default exports** used only for page components (`export default function Home() { ... }`)
- **Interface exports** prefixed with `export interface` (not in separate block)
- **Type aliases** with `export type`
- **Constants** with `export const`

**Barrel Files:**
- Not used — direct imports from modules (e.g., `import { cn } from "@/lib/utils"`, not from index file)

**Module Organization (within file):**
1. Imports
2. Type definitions / interfaces
3. Constants
4. Helper functions (private, no export)
5. Main exported functions
6. Component exports (if React)

**Example:**
```typescript
import { useState } from "react";
import type { ReferenceImage } from "@/lib/api";

export interface FormValues {
  productSegment: string;
  category: string;
}

const POLKI_SIZES = ["Any", "Far", "Big", "Medium", "Small"];

function togglePolkiSize(size: string) {
  // Helper logic
}

export function DesignForm({ onSubmit, isGenerating }: DesignFormProps) {
  // Component logic
}
```

## React Patterns

**Hooks Usage:**
- **React Hook Form:** All forms use `useForm()` with Zod validation
  ```typescript
  const { watch, setValue, getValues, handleSubmit } = useForm<FormValues>({
    defaultValues: { /* initial state */ },
  });
  ```
- **State Management:** `useState()` for local component state
- **Effects:** `useEffect()` for side effects (data fetching, subscriptions)
- **Custom Hooks:** Prefix with `use` (e.g., `useToast()`, `useMobile()`)
- **No prop drilling:** Use hooks or context (toast hook for notifications)

**Form Patterns:**
- Always use React Hook Form + Zod
- No uncontrolled inputs
- Cascading dropdowns use `watch()` to observe field changes
- Array fields (checkboxes) managed with `setValue()` and `getValues()`
- Form submission via `handleSubmit()` wrapper

**Component Props:**
- Always define `Props` interface for destructured props
- Optional props marked with `?`
- Children passed as `children?: ReactNode`
- Event handlers prefixed with `on` (e.g., `onSubmit()`)

## Tailwind CSS

**Utility Classes:**
- Use `cn()` from `@/lib/utils` for conditional classes (clsx + tailwind-merge)
  ```typescript
  className={cn(
    "px-4 py-2 rounded-full text-sm font-medium border transition-colors",
    mode === "sketch"
      ? "bg-primary text-primary-foreground border-primary"
      : "border-border text-muted-foreground hover:bg-secondary/40"
  )}
  ```
- No hardcoded hex colors — use Tailwind theme tokens (primary, secondary, muted-foreground, etc.)
- Theme colors defined in `client/src/index.css` as CSS custom properties

**Grid/Layout:**
- Grid for multi-column layouts (e.g., `grid grid-cols-1 lg:grid-cols-12 gap-8`)
- Flex for linear layouts
- Responsive prefixes (sm, md, lg, xl) for breakpoints
- Gap utilities for spacing between elements

## Shared Patterns

**API Call Pattern (client/src/lib/api.ts):**
- All API calls wrapped in async functions
- Return typed responses via TypeScript interfaces
- Error handling with `.ok()` check and Sentry capture
- FormData for multipart requests
- JSON for simple POST/GET

**Design Request Validation (forms):**
- Use `DesignRequest` type from `@/lib/jewellery-logic`
- Optional fields marked with `?`
- Categories, motifs, stones defined as string arrays
- Gold rate, percentage as numbers

**Cost Report Pattern:**
- `CostingReportData` interface returned in `DesignGenerationResponse`
- Rendered via `<CostReport>` component when present
- Triggered when `priceBand` + `goldRatePerGram` provided

**Multi-Model Results:**
- Three models run in parallel: Gemini, OpenAI (gpt-image-1), Grok
- Response includes `gemini`, `openai`, `grok` ModelResult objects
- `firstSuccessfulUrl()` used to pick first non-null result for backward compatibility
- Displayed via `<MultiModelResult>` component showing all three

---

*Convention analysis: 2025-04-14*
