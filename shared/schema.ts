import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, integer, customType } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// Custom type for pgvector (3072 dimensions for gemini-embedding-001)
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(3072)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    // Parse the PostgreSQL vector format: [1,2,3,...]
    const str = value.replace(/[\[\]]/g, "");
    return str.split(",").map(Number);
  },
});

// Theme codes for organizing reference images
export const THEME_CODES = [
  { code: "WRD", name: "Wearable Daily" },
  { code: "WRO", name: "Wearable Occasional" },
  { code: "CLO", name: "Collectable Occasional" },
  { code: "SOD", name: "Solitaire Daily" },
  { code: "SOO", name: "Solitaire Occasional" },
  { code: "SOP", name: "Solitaire Premium" },
  { code: "BRC", name: "Bridal Classic" },
  { code: "BRP", name: "Bridal Premium" },
  { code: "BRU", name: "Bridal Unique" },
] as const;

export type ThemeCode = typeof THEME_CODES[number]["code"];

// Reference Images table - stores uploaded design references
export const referenceImages = pgTable("reference_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull(),
  filepath: text("filepath").notNull(),
  thumbnailPath: text("thumbnail_path"), // smaller image for grid display
  themeCode: text("theme_code"), // folder/theme code like WRO, CLO, etc. (legacy)
  productSegment: text("product_segment"), // e.g. "Bridal", "Modern", "RTW"
  category: text("category"),              // e.g. "Necklace Set", "Choker"
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  metadata: jsonb("metadata"), // stores vision analysis results
  embedding: jsonb("embedding"), // legacy - stores embedding as JSON (for migration)
  embeddingVector: vector("embedding_vector"), // pgvector column for fast similarity search
});

export const insertReferenceImageSchema = createInsertSchema(referenceImages).omit({
  id: true,
  uploadedAt: true,
}).extend({
  embeddingVector: z.array(z.number()).nullable().optional(),
});

export type InsertReferenceImage = z.infer<typeof insertReferenceImageSchema>;
export type ReferenceImage = typeof referenceImages.$inferSelect;

// Design Projects table - stores user design requests and results
export const designProjects = pgTable("design_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: text("category").notNull(),
  theme: text("theme").notNull(),
  motifs: text("motifs").array().notNull(),
  stones: text("stones").array(),
  materialRatio: text("material_ratio").notNull(),
  customNotes: text("custom_notes"),
  referenceImageIds: text("reference_image_ids").array(), // links to reference images
  sketchPlan: text("sketch_plan"),
  imagePrompt: text("image_prompt"),
  generatedImageUrl: text("generated_image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDesignProjectSchema = createInsertSchema(designProjects).omit({
  id: true,
  createdAt: true,
});

// Schema for validating user input only (without generated fields)
export const designProjectInputSchema = createInsertSchema(designProjects).omit({
  id: true,
  createdAt: true,
  sketchPlan: true,
  imagePrompt: true,
  generatedImageUrl: true,
});

export type InsertDesignProject = z.infer<typeof insertDesignProjectSchema>;
export type DesignProject = typeof designProjects.$inferSelect;

// Design Iterations table - stores edit history for designs
export const designIterations = pgTable("design_iterations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  designProjectId: varchar("design_project_id").notNull().references(() => designProjects.id),
  iterationNumber: integer("iteration_number").notNull(),
  editPrompt: text("edit_prompt").notNull(),
  sourceImageUrl: text("source_image_url").notNull(),
  resultImageUrl: text("result_image_url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDesignIterationSchema = createInsertSchema(designIterations).omit({
  id: true,
  createdAt: true,
});

export type InsertDesignIteration = z.infer<typeof insertDesignIterationSchema>;
export type DesignIteration = typeof designIterations.$inferSelect;

// Google Drive import request schema
export const driveImportRequestSchema = z.object({
  folderUrl: z.string().min(1, "Folder URL is required"),
  themeCode: z.string().optional(),
});

export type DriveImportRequest = z.infer<typeof driveImportRequestSchema>;

// ── Assortment Planning tables ──────────────────────────────────────────────

// B2C Sales history (imported from Excel)
export const b2cSales = pgTable("b2c_sales", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  styleCode: text("style_code").notNull(),
  bdmName: text("bdm_name").notNull(),
  jewelSoce: text("jewel_soce"),
  tag: text("tag"),
  transPrice: integer("trans_price"),
  stateName: text("state_name"),
  pureWt: text("pure_wt"),
  category: text("category"),
  makeDays: integer("make_days"),
  billingType: text("billing_type"),
  transactionDate: text("transaction_date"),
  stock: text("stock"),
  cost: integer("cost"),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
});

export const insertB2cSaleSchema = createInsertSchema(b2cSales).omit({
  id: true,
  importedAt: true,
});

export type InsertB2cSale = z.infer<typeof insertB2cSaleSchema>;
export type B2cSale = typeof b2cSales.$inferSelect;

// Stock Items inventory (imported from Excel)
export const stockItems = pgTable("stock_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jewelCode: text("jewel_code").notNull(),
  styleNo: text("style_no").notNull(),
  imageUrl: text("image_url"),
  localImagePath: text("local_image_path"),
  thumbnailPath: text("thumbnail_path"),
  manufacturer: text("manufacturer"),
  makeType: text("make_type"),
  subCategory: text("sub_category"),
  stockType: text("stock_type"),
  category: text("category"),
  collectionGroupName: text("collection_group_name"),
  collectionName: text("collection_name"),
  baseMetal: text("base_metal"),
  locationName: text("location_name"),
  status: text("status").notNull(),
  quantity: integer("quantity"),
  diaWt: text("dia_wt"),
  csWt: text("cs_wt"),
  pureWt: text("pure_wt"),
  totalNetWt: text("total_net_wt"),
  grossWt: text("gross_wt"),
  costPrice: integer("cost_price"),
  tagPrice: integer("tag_price"),
  ageingDays: integer("ageing_days"),
  sketchDesigner: text("sketch_designer"),
  labName: text("lab_name"),
  certificateNo: text("certificate_no"),
  // VA (Visual Analysis) fields from Excel
  vaCategory: text("va_category"),
  brandName: text("brand_name"),
  designShape: text("design_shape"),
  enamel: text("enamel"),
  finish: text("finish"),
  materialRatio: text("material_ratio"),
  motif: text("motif"),
  motifCategory: text("motif_category"),
  piroiColour: text("piroi_colour"),
  piroiPlacement: text("piroi_placement"),
  polkiSize: text("polki_size"),
  priceBand: text("price_band"),
  productSegment: text("product_segment"),
  setCategory: text("set_category"),
  stoneColour: text("stone_colour"),
  talaf: text("talaf"),
  theme: text("theme"),
  themeCode: text("theme_code"),
  label: text("label"),
  // Embedding
  embeddingVector: vector("embedding_vector"),
  embeddingStatus: text("embedding_status").default("pending"),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
});

export const insertStockItemSchema = createInsertSchema(stockItems).omit({
  id: true,
  importedAt: true,
}).extend({
  embeddingVector: z.array(z.number()).nullable().optional(),
});

export type InsertStockItem = z.infer<typeof insertStockItemSchema>;
export type StockItem = typeof stockItems.$inferSelect;

// Assortment Plans — saved shipment recommendations
export const assortmentPlans = pgTable("assortment_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bdmName: text("bdm_name").notNull(),
  selectedItemIds: text("selected_item_ids").array().notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAssortmentPlanSchema = createInsertSchema(assortmentPlans).omit({
  id: true,
  createdAt: true,
});

export type InsertAssortmentPlan = z.infer<typeof insertAssortmentPlanSchema>;
export type AssortmentPlan = typeof assortmentPlans.$inferSelect;

// ── Live Stock Items (synced from external API) ─────────────────────────────

export const liveStockItems = pgTable("live_stock_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jewelId: integer("jewel_id").notNull(),
  jewelCode: varchar("jewel_code", { length: 20 }).notNull(),
  styleNo: varchar("style_no", { length: 50 }),
  makeType: varchar("make_type", { length: 50 }),
  subCategory: varchar("sub_category", { length: 50 }),
  stockType: varchar("stock_type", { length: 30 }),
  category: varchar("category", { length: 80 }),
  baseMetal: varchar("base_metal", { length: 20 }),
  location: varchar("location", { length: 100 }),
  manufacturerName: varchar("manufacturer_name", { length: 200 }),
  tagPrice: integer("tag_price").default(0),
  imageUrl: text("image_url"),
  currentStatus: varchar("current_status", { length: 20 }),
  pureWt: text("pure_wt"),
  pureWtClarity: text("pure_wt_clarity"),
  totNetwt: text("tot_netwt"),
  grossWt: text("gross_wt"),
  totDiaWt: text("tot_dia_wt"),
  totPolkiWt: text("tot_polki_wt"),
  totColorStoneWt: text("tot_color_stone_wt"),
  qty: integer("qty").default(1),
  itemPieces: integer("item_pieces").default(1),
  costPrice: integer("cost_price").default(0),
  collectionName: varchar("collection_name", { length: 100 }),
  makeDate: varchar("make_date", { length: 20 }),
  ageingDays: integer("ageing_days").default(0),
  memoClientName: varchar("memo_client_name", { length: 200 }),
  memoSalesPersonName: varchar("memo_sales_person_name", { length: 200 }),
  memoDate: varchar("memo_date", { length: 20 }),
  syncedAt: timestamp("synced_at").defaultNow(),
  embeddingVector: vector("embedding_vector", { dimensions: 3072 }),
  embeddingStatus: text("embedding_status").default("pending"),
});

export const insertLiveStockItemSchema = createInsertSchema(liveStockItems).omit({
  id: true,
  embeddingVector: true,
  embeddingStatus: true,
});

export type InsertLiveStockItem = z.infer<typeof insertLiveStockItemSchema>;
export type LiveStockItem = typeof liveStockItems.$inferSelect;

// ── Feedback & Prompt Learning ───────────────────────────────────────────────

// Design Feedback table - stores designer feedback on generated images
// for use in prompt enrichment (RAG-based learning loop)
export const designFeedback = pgTable("design_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Nullable FK — ON DELETE SET NULL preserves feedback when a project is deleted
  designProjectId: varchar("design_project_id")
    .references(() => designProjects.id, { onDelete: "set null" }),
  feedbackText: text("feedback_text").notNull(),
  category: text("category").notNull(),       // e.g. "Necklace Set" — hard filter key
  theme: text("theme").notNull(),             // e.g. "BRP" — hard filter key
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  // Valid values: "positive" | "corrective" — enforced by Zod, not DB enum
  sentiment: text("sentiment").notNull().default("corrective"),
  // Populated after Gemini text-embedding-004 call; null until embedded
  embeddingVector: vector("embedding_vector"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // NOTE: updatedAt must be set explicitly on every UPDATE — Drizzle has no $onUpdate trigger
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Insert schema — omit server-set fields; add sentiment enum and optional vector
export const insertDesignFeedbackSchema = createInsertSchema(designFeedback).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  embeddingVector: z.array(z.number()).nullable().optional(),
  sentiment: z.enum(["positive", "corrective"]).default("corrective"),
});

// Select schema — Zod runtime schema for validating rows returned from the DB
export const selectDesignFeedbackSchema = createSelectSchema(designFeedback).extend({
  embeddingVector: z.array(z.number()).nullable().optional(),
});

export type InsertDesignFeedback = z.infer<typeof insertDesignFeedbackSchema>;
// Full row type — used by storage.ts return types and API response shapes
export type DesignFeedback = typeof designFeedback.$inferSelect;

// ── Self-Improving Image Generation ──────────────────────────────────────────

// Design Evaluations — AI-scored quality assessments of generated images
export const designEvaluations = pgTable("design_evaluations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  designProjectId: varchar("design_project_id")
    .references(() => designProjects.id, { onDelete: "set null" }),
  modelProvider: text("model_provider").notNull(), // "gemini" | "openai" | "grok"
  imageUrl: text("image_url").notNull(),
  // 7 scoring dimensions (1-5 each)
  brandCompliance: integer("brand_compliance").notNull(),
  viewAngle: integer("view_angle").notNull(),
  composition: integer("composition").notNull(),
  motifAccuracy: integer("motif_accuracy").notNull(),
  stoneRendering: integer("stone_rendering").notNull(),
  goldBalance: integer("gold_balance").notNull(),
  overallQuality: integer("overall_quality").notNull(),
  reasoning: text("reasoning"), // Gemini's explanation for the scores
  promptVersionId: varchar("prompt_version_id"),
  evaluatedAt: timestamp("evaluated_at").defaultNow().notNull(),
});

export const insertDesignEvaluationSchema = createInsertSchema(designEvaluations).omit({
  id: true,
  evaluatedAt: true,
});

export type InsertDesignEvaluation = z.infer<typeof insertDesignEvaluationSchema>;
export type DesignEvaluation = typeof designEvaluations.$inferSelect;

// Prompt Versions — versioned prompt templates for self-improvement
export const promptVersions = pgTable("prompt_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  versionNumber: integer("version_number").notNull(),
  scope: text("scope").notNull(), // "brand_rules" | "sketch_json" | "cad_rules" | "grok_preamble"
  templateText: text("template_text").notNull(),
  avgOverallScore: integer("avg_overall_score"), // stored as score x 100 for int precision
  generationCount: integer("generation_count").default(0),
  isActive: integer("is_active").default(0), // 1 = active, 0 = inactive (no boolean in drizzle pg)
  parentVersionId: varchar("parent_version_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPromptVersionSchema = createInsertSchema(promptVersions).omit({
  id: true,
  createdAt: true,
});

export type InsertPromptVersion = z.infer<typeof insertPromptVersionSchema>;
export type PromptVersion = typeof promptVersions.$inferSelect;

// Optimization Runs — tracks before/after scores per optimization run
export const optimizationRuns = pgTable("optimization_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scope: text("scope").notNull(),
  beforeVersionId: varchar("before_version_id"),
  afterVersionId: varchar("after_version_id"),
  beforeAvgScore: integer("before_avg_score"), // x100
  afterAvgScore: integer("after_avg_score"), // x100
  weakDimensions: text("weak_dimensions").array(),
  candidatesTested: integer("candidates_tested").default(0),
  status: text("status").notNull().default("running"), // "running" | "completed" | "failed"
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// ── B2B Sales History (imported from b2b_sales_VA_and_FinalPrice.xlsx) ──────

export const b2bSalesHistory = pgTable("b2b_sales_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  salesPersonName: text("sales_person_name").notNull(),
  clientName: text("client_name"),
  stateName: text("state_name"),
  clientCity: text("client_city"),
  imageLink: text("image_link"),
  jewelCode: text("jewel_code"),
  styleCode: text("style_code"),
  category: text("category"),
  categoryGroup: text("category_group"),
  tagPrice: integer("tag_price"),
  finalPrice: integer("final_price"),
  transPrice: integer("trans_price"),
  grossWt: text("gross_wt"),
  pureWt: text("pure_wt"),
  totDiaWt: text("tot_dia_wt"),
  baseMetalQuality: text("base_metal_quality"),
  stockType: text("stock_type"),
  subCategory: text("sub_category"),
  makeType: text("make_type"),
  // VA-style fields for scoring context
  motif: text("motif"),
  motifCategory: text("motif_category"),
  productSegment: text("product_segment"),
  designShape: text("design_shape"),
  finish: text("finish"),
  stoneColour: text("stone_colour"),
  materialRatio: text("material_ratio"),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
  embeddingVector: vector("embedding_vector", { dimensions: 3072 }),
  embeddingStatus: text("embedding_status").default("pending"),
});

export const insertB2bSalesHistorySchema = createInsertSchema(b2bSalesHistory).omit({
  id: true,
  importedAt: true,
  embeddingVector: true,
  embeddingStatus: true,
});

export type InsertB2bSalesHistory = z.infer<typeof insertB2bSalesHistorySchema>;
export type B2bSalesHistory = typeof b2bSalesHistory.$inferSelect;
