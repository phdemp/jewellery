import {
  type ReferenceImage,
  type InsertReferenceImage,
  type DesignProject,
  type InsertDesignProject,
  type DesignIteration,
  type InsertDesignIteration,
  type B2cSale,
  type InsertB2cSale,
  type StockItem,
  type InsertStockItem,
  type AssortmentPlan,
  type InsertAssortmentPlan,
  referenceImages,
  designProjects,
  designIterations,
  b2cSales,
  stockItems,
  assortmentPlans,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";

export interface IStorage {
  // Reference Image methods
  createReferenceImage(data: InsertReferenceImage): Promise<ReferenceImage>;
  getReferenceImage(id: string): Promise<ReferenceImage | undefined>;
  getAllReferenceImages(): Promise<ReferenceImage[]>;
  deleteReferenceImage(id: string): Promise<void>;
  updateReferenceImage(id: string, data: Partial<ReferenceImage>): Promise<void>;

  // Design Project methods
  createDesignProject(data: InsertDesignProject): Promise<DesignProject>;
  getDesignProject(id: string): Promise<DesignProject | undefined>;
  getAllDesignProjects(): Promise<DesignProject[]>;
  updateDesignProject(id: string, data: Partial<DesignProject>): Promise<DesignProject | undefined>;
  
  // Design Iteration methods
  createDesignIteration(data: InsertDesignIteration): Promise<DesignIteration>;
  getDesignIterations(designProjectId: string): Promise<DesignIteration[]>;
  getLatestIteration(designProjectId: string): Promise<DesignIteration | undefined>;

  // B2C Sales methods
  bulkCreateB2cSales(data: InsertB2cSale[]): Promise<void>;
  getSalesByBdm(bdmName: string): Promise<B2cSale[]>;
  getDistinctBdmNames(): Promise<string[]>;
  clearB2cSales(): Promise<void>;

  // Stock Items methods
  bulkCreateStockItems(data: InsertStockItem[]): Promise<void>;
  getStockItemsByCategory(category: string, status?: string): Promise<StockItem[]>;
  getStockItemsByStyleNos(styleNos: string[]): Promise<StockItem[]>;
  updateStockItem(id: string, data: Partial<StockItem>): Promise<void>;
  getStockItemsPendingEmbedding(limit: number): Promise<StockItem[]>;
  clearStockItems(): Promise<void>;

  // Recommendation helper
  getStockItemsForRecommendation(category: string, avgPrice: number, limit: number): Promise<StockItem[]>;

  // Assortment Plan methods
  createAssortmentPlan(data: InsertAssortmentPlan): Promise<AssortmentPlan>;
}

export class DatabaseStorage implements IStorage {
  // Reference Image methods
  async createReferenceImage(data: InsertReferenceImage): Promise<ReferenceImage> {
    const result = await db.insert(referenceImages).values(data).returning();
    return result[0];
  }

  async getReferenceImage(id: string): Promise<ReferenceImage | undefined> {
    const result = await db.select().from(referenceImages).where(eq(referenceImages.id, id));
    return result[0];
  }

  async getAllReferenceImages(): Promise<ReferenceImage[]> {
    return await db.select().from(referenceImages);
  }

  async deleteReferenceImage(id: string): Promise<void> {
    await db.delete(referenceImages).where(eq(referenceImages.id, id));
  }

  async updateReferenceImage(id: string, data: Partial<ReferenceImage>): Promise<void> {
    await db.update(referenceImages).set(data).where(eq(referenceImages.id, id));
  }

  // Design Project methods
  async createDesignProject(data: InsertDesignProject): Promise<DesignProject> {
    const result = await db.insert(designProjects).values(data).returning();
    return result[0];
  }

  async getDesignProject(id: string): Promise<DesignProject | undefined> {
    const result = await db.select().from(designProjects).where(eq(designProjects.id, id));
    return result[0];
  }

  async getAllDesignProjects(): Promise<DesignProject[]> {
    return await db.select().from(designProjects).orderBy(designProjects.createdAt);
  }

  async updateDesignProject(id: string, data: Partial<DesignProject>): Promise<DesignProject | undefined> {
    const result = await db
      .update(designProjects)
      .set(data)
      .where(eq(designProjects.id, id))
      .returning();
    return result[0];
  }

  // Design Iteration methods
  async createDesignIteration(data: InsertDesignIteration): Promise<DesignIteration> {
    const result = await db.insert(designIterations).values(data).returning();
    return result[0];
  }

  async getDesignIterations(designProjectId: string): Promise<DesignIteration[]> {
    return await db
      .select()
      .from(designIterations)
      .where(eq(designIterations.designProjectId, designProjectId))
      .orderBy(designIterations.iterationNumber);
  }

  async getLatestIteration(designProjectId: string): Promise<DesignIteration | undefined> {
    const result = await db
      .select()
      .from(designIterations)
      .where(eq(designIterations.designProjectId, designProjectId))
      .orderBy(desc(designIterations.iterationNumber))
      .limit(1);
    return result[0];
  }
  // ── B2C Sales methods ────────────────────────────────────────────────────

  async bulkCreateB2cSales(data: InsertB2cSale[]): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < data.length; i += CHUNK) {
      await db.insert(b2cSales).values(data.slice(i, i + CHUNK));
    }
  }

  async getSalesByBdm(bdmName: string): Promise<B2cSale[]> {
    return await db.select().from(b2cSales).where(eq(b2cSales.bdmName, bdmName));
  }

  async getDistinctBdmNames(): Promise<string[]> {
    const rows = await db.execute(sql`SELECT DISTINCT bdm_name FROM b2c_sales ORDER BY bdm_name`);
    return (rows.rows as { bdm_name: string }[]).map(r => r.bdm_name);
  }

  async clearB2cSales(): Promise<void> {
    await db.delete(b2cSales);
  }

  // ── Stock Items methods ─────────────────────────────────────────────────

  async bulkCreateStockItems(data: InsertStockItem[]): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < data.length; i += CHUNK) {
      await db.insert(stockItems).values(data.slice(i, i + CHUNK));
    }
  }

  async getStockItemsByCategory(category: string, status?: string): Promise<StockItem[]> {
    if (status) {
      return await db.select().from(stockItems)
        .where(sql`${stockItems.category} = ${category} AND ${stockItems.status} = ${status}`);
    }
    return await db.select().from(stockItems).where(eq(stockItems.category, category));
  }

  async getStockItemsByStyleNos(styleNos: string[]): Promise<StockItem[]> {
    if (styleNos.length === 0) return [];
    return await db.select().from(stockItems)
      .where(sql`${stockItems.styleNo} = ANY(${styleNos})`);
  }

  async updateStockItem(id: string, data: Partial<StockItem>): Promise<void> {
    await db.update(stockItems).set(data).where(eq(stockItems.id, id));
  }

  async getStockItemsPendingEmbedding(limit: number): Promise<StockItem[]> {
    return await db.select().from(stockItems)
      .where(eq(stockItems.embeddingStatus, "pending"))
      .limit(limit);
  }

  async clearStockItems(): Promise<void> {
    await db.delete(stockItems);
  }

  // ── Recommendation helper ──────────────────────────────────────────────

  async getStockItemsForRecommendation(category: string, avgPrice: number, limit: number): Promise<StockItem[]> {
    return await db.select().from(stockItems)
      .where(sql`${stockItems.category} = ${category} AND ${stockItems.status} = 'On Hand' AND TRIM(${stockItems.imageUrl}) <> '' AND ${stockItems.imageUrl} IS NOT NULL`)
      .orderBy(sql`ABS(${stockItems.tagPrice} - ${avgPrice})`)
      .limit(limit);
  }

  // ── Assortment Plan methods ─────────────────────────────────────────────

  async createAssortmentPlan(data: InsertAssortmentPlan): Promise<AssortmentPlan> {
    const result = await db.insert(assortmentPlans).values(data).returning();
    return result[0];
  }
}

export const storage = new DatabaseStorage();
