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
