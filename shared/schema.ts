import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, integer, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
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
