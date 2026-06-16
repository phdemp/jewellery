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
  type DesignFeedback,
  type InsertDesignFeedback,
  type DesignEvaluation,
  type InsertDesignEvaluation,
  type PromptVersion,
  type InsertPromptVersion,
  type B2bSalesHistory,
  type InsertB2bSalesHistory,
  type ExhibitionSkuInterest,
  type InsertExhibitionSkuInterest,
  exhibitionSkuInterests,
  referenceImages,
  designProjects,
  designIterations,
  b2cSales,
  stockItems,
  assortmentPlans,
  designFeedback,
  designEvaluations,
  promptVersions,
  optimizationRuns,
  b2bSalesHistory,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, inArray, and, count } from "drizzle-orm";

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
  findMatchingEarring(setStyleNo: string, earringCategory: string): Promise<StockItem | null>;

  // State helpers
  getDistinctStates(): Promise<string[]>;
  getStockCandidatePool(category: string, limit: number): Promise<StockItem[]>;

  // Assortment Plan methods
  createAssortmentPlan(data: InsertAssortmentPlan): Promise<AssortmentPlan>;

  // Feedback methods
  createFeedback(data: InsertDesignFeedback): Promise<DesignFeedback>;
  getFeedback(id: string): Promise<DesignFeedback | undefined>;
  getAllFeedback(page: number, limit: number, category?: string, theme?: string): Promise<DesignFeedback[]>;
  countFeedback(category?: string, theme?: string): Promise<number>;
  updateFeedback(id: string, data: Partial<DesignFeedback>): Promise<DesignFeedback | undefined>;
  deleteFeedback(id: string): Promise<void>;

  // B2B Sales History methods
  bulkCreateB2bSalesHistory(data: InsertB2bSalesHistory[]): Promise<void>;
  getB2bSalesByBdm(bdmName: string, stateName?: string, clientName?: string): Promise<B2bSalesHistory[]>;
  // Live-sales (ERP, dated) variant — scopes a BDM's sales by month/year for period-filtered profiling
  getLiveSalesByBdm(bdmName: string, opts: { months?: string[]; years?: number[]; stateName?: string; clientName?: string }): Promise<B2bSalesHistory[]>;
  getLiveSalesPeriods(bdmName: string, stateName?: string, clientName?: string): Promise<{ months: string[]; years: number[] }>;
  getDistinctB2bBdmNames(): Promise<string[]>;
  getB2bClientsForBdm(bdmName: string, stateName?: string): Promise<Array<{ name: string; spend: number; count: number }>>;
  getB2bStatesForBdm(bdmName: string): Promise<string[]>;

  // Evaluation methods
  createEvaluation(data: InsertDesignEvaluation): Promise<DesignEvaluation>;
  getEvaluationsByProject(designProjectId: string): Promise<DesignEvaluation[]>;
  getEvaluations(page: number, limit: number, model?: string, promptVersionId?: string): Promise<DesignEvaluation[]>;
  countEvaluations(model?: string, promptVersionId?: string): Promise<number>;

  // Prompt Version methods
  createPromptVersion(data: InsertPromptVersion): Promise<PromptVersion>;
  getPromptVersions(scope?: string): Promise<PromptVersion[]>;
  getActivePromptVersion(scope: string): Promise<PromptVersion | undefined>;

  // Exhibition methods
  getExhibitionList(): Promise<Array<{ name: string; interestCount: number; uniqueSkuCount: number; customerCount: number }>>;
  getExhibitionSignals(exhibition?: string): Promise<Array<{ parentStyle: string; category: string; makeType: string; interestCount: number; customerCount: number; exhibitions: string[] }>>;

  // Location methods
  getDistinctLocations(): Promise<string[]>;
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
    const rows = await db.execute(sql`SELECT DISTINCT bdm_name FROM b2c_sales WHERE bdm_name IS NOT NULL AND TRIM(bdm_name) <> '' AND UPPER(TRIM(bdm_name)) NOT IN ('BLANK', 'RJPL DIRECTORS', 'GANESH SHARMA', 'RETAIL', 'FINISH GOODS', 'FINISHED GOODS', 'FINISHED GOODS VENDORS') ORDER BY bdm_name`);
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
      .where(inArray(stockItems.styleNo, styleNos));
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

  // ── State helpers ──────────────────────────────────────────────────────

  async getDistinctStates(): Promise<string[]> {
    const rows = await db.execute(sql`SELECT DISTINCT state_name FROM b2c_sales WHERE state_name IS NOT NULL AND TRIM(state_name) <> '' AND state_name <> 'None' ORDER BY state_name`);
    return (rows.rows as { state_name: string }[]).map(r => r.state_name);
  }

  async getStockCandidatePool(category: string, limit: number): Promise<StockItem[]> {
    return await db.select().from(stockItems)
      .where(sql`${stockItems.category} = ${category} AND ${stockItems.status} = 'On Hand' AND TRIM(${stockItems.imageUrl}) <> '' AND ${stockItems.imageUrl} IS NOT NULL`)
      .limit(limit);
  }

  // ── Matching earring lookup ────────────────────────────────────────────

  async findMatchingEarring(setStyleNo: string, earringCategory: string): Promise<StockItem | null> {
    const baseStyle = setStyleNo.replace(/-\d+$/, "");
    const earringPattern = baseStyle + "E";
    const rows = await db.select().from(stockItems)
      .where(sql`${stockItems.styleNo} LIKE ${earringPattern + "%"} AND ${stockItems.category} = ${earringCategory} AND ${stockItems.status} = 'On Hand' AND TRIM(${stockItems.imageUrl}) <> '' AND ${stockItems.imageUrl} IS NOT NULL`)
      .limit(1);
    return rows[0] ?? null;
  }

  // ── Assortment Plan methods ─────────────────────────────────────────────

  async createAssortmentPlan(data: InsertAssortmentPlan): Promise<AssortmentPlan> {
    const result = await db.insert(assortmentPlans).values(data).returning();
    return result[0];
  }

  // -- Feedback methods --------------------------------------------------------

  async createFeedback(data: InsertDesignFeedback): Promise<DesignFeedback> {
    const result = await db.insert(designFeedback).values(data).returning();
    return result[0];
  }

  async getFeedback(id: string): Promise<DesignFeedback | undefined> {
    const result = await db.select().from(designFeedback).where(eq(designFeedback.id, id));
    return result[0];
  }

  async getAllFeedback(
    page: number,
    limit: number,
    category?: string,
    theme?: string
  ): Promise<DesignFeedback[]> {
    const conditions = [];
    if (category) conditions.push(eq(designFeedback.category, category));
    if (theme) conditions.push(eq(designFeedback.theme, theme));

    const query = db.select().from(designFeedback);
    const filtered = conditions.length > 0
      ? query.where(and(...conditions))
      : query;

    return await filtered
      .orderBy(desc(designFeedback.createdAt))
      .offset((page - 1) * limit)
      .limit(limit);
  }

  async countFeedback(category?: string, theme?: string): Promise<number> {
    const conditions = [];
    if (category) conditions.push(eq(designFeedback.category, category));
    if (theme) conditions.push(eq(designFeedback.theme, theme));

    const query = db.select({ count: count() }).from(designFeedback);
    const filtered = conditions.length > 0
      ? query.where(and(...conditions))
      : query;

    const result = await filtered;
    return result[0].count;
  }

  // NOTE: updatedAt must be set explicitly — Drizzle has no $onUpdate trigger (Phase 1 decision)
  async updateFeedback(id: string, data: Partial<DesignFeedback>): Promise<DesignFeedback | undefined> {
    const result = await db
      .update(designFeedback)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(designFeedback.id, id))
      .returning();
    return result[0];
  }

  async deleteFeedback(id: string): Promise<void> {
    await db.delete(designFeedback).where(eq(designFeedback.id, id));
  }

  // ── B2B Sales History methods ──────────────────────────────────────────

  async bulkCreateB2bSalesHistory(data: InsertB2bSalesHistory[]): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < data.length; i += CHUNK) {
      await db.insert(b2bSalesHistory).values(data.slice(i, i + CHUNK));
    }
  }

  async getB2bSalesByBdm(bdmName: string, stateName?: string, clientName?: string): Promise<B2bSalesHistory[]> {
    const conditions = [sql`${b2bSalesHistory.salesPersonName} = ${bdmName}`];
    if (stateName) conditions.push(sql`${b2bSalesHistory.stateName} = ${stateName}`);
    if (clientName) conditions.push(sql`${b2bSalesHistory.clientName} = ${clientName}`);

    return await db.select().from(b2bSalesHistory)
      .where(sql.join(conditions, sql` AND `))
      .orderBy(desc(b2bSalesHistory.finalPrice));
  }

  // Derive product segment from a style/theme code (server-side mirror of the
  // client getSegmentFromStyle helper) so live-sales profiles carry segments.
  private deriveSegmentFromStyle(styleCode: string | null, category: string | null): string | null {
    if (!styleCode) return null;
    const u = styleCode.toUpperCase();
    const c = (category || "").toLowerCase();
    if (u.includes("BRP") || u.includes("BRU")) return "Bridal";
    if (u.includes("BRC")) return "Bridal Lite";
    if (u.includes("SOP") || u.includes("SOLP")) return "Exclusive - Grandeur";
    if (u.includes("WRD") || u.includes("SOO") || u.includes("SOD")) {
      if (c.includes("chain") || c.includes("pendant")) return "RTW";
      if (c.includes("earring") || c.includes("stud") || c.includes("drop") || c.includes("hoop")) return "Ear Essentials";
      if (c.includes("bracelet") || c.includes("bangle") || c.includes("hathphool") || c.includes("ring")) return "Handwear";
      if (c.includes("nosepin") || c.includes("nath") || c.includes("mangtika") || c.includes("brooch") || c.includes("button") || c.includes("kalingi") || c.includes("kanauti") || c.includes("mala")) return "Add-ons";
      return "Modern";
    }
    if (u.includes("CLO") || u.includes("CLP") || u.includes("WRO")) return "Traditional";
    return "Traditional";
  }

  async getLiveSalesByBdm(
    bdmName: string,
    opts: { months?: string[]; years?: number[]; stateName?: string; clientName?: string },
  ): Promise<B2bSalesHistory[]> {
    const conditions = [sql`sales_person_name = ${bdmName}`];
    if (opts.stateName) conditions.push(sql`state_name = ${opts.stateName}`);
    if (opts.clientName) conditions.push(sql`client_name = ${opts.clientName}`);
    if (opts.months && opts.months.length > 0) {
      conditions.push(sql`transaction_month IN (${sql.join(opts.months.map((m) => sql`${m}`), sql`, `)})`);
    }
    if (opts.years && opts.years.length > 0) {
      conditions.push(sql`transaction_year IN (${sql.join(opts.years.map((y) => sql`${y}`), sql`, `)})`);
    }

    const result = await db.execute(sql`
      SELECT jewel_code, style_code, client_name, state_name, category,
             transaction_amt, tag_price, pure_weight, stock_type, image_url
      FROM live_sales
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY transaction_amt DESC NULLS LAST
    `);

    interface LiveSalesRow {
      jewel_code: string | null;
      style_code: string | null;
      client_name: string | null;
      state_name: string | null;
      category: string | null;
      transaction_amt: number | null;
      tag_price: number | null;
      pure_weight: string | null;
      stock_type: string | null;
      image_url: string | null;
    }

    // Map live_sales rows into B2bSalesHistory shape so the existing scorer
    // (buildMetadataProfile / extractClientPreferences) consumes them unchanged.
    // Fields live_sales lacks (motif, finish, gross/diamond weight, embeddings)
    // are null; gross weight uses pure weight as a proxy.
    return (result.rows as unknown as LiveSalesRow[]).map((r) => ({
      id: "",
      salesPersonName: bdmName,
      clientName: r.client_name,
      stateName: r.state_name,
      clientCity: null,
      imageLink: r.image_url,
      jewelCode: r.jewel_code,
      styleCode: r.style_code,
      category: r.category,
      categoryGroup: r.category,
      tagPrice: r.tag_price,
      finalPrice: r.transaction_amt,
      transPrice: r.transaction_amt,
      grossWt: r.pure_weight,
      pureWt: r.pure_weight,
      totDiaWt: null,
      baseMetalQuality: null,
      stockType: r.stock_type,
      subCategory: null,
      makeType: null,
      motif: null,
      motifCategory: null,
      productSegment: this.deriveSegmentFromStyle(r.style_code, r.category),
      designShape: null,
      finish: null,
      stoneColour: null,
      materialRatio: null,
      importedAt: new Date(),
      embeddingVector: null,
      embeddingStatus: null,
    }));
  }

  async getLiveSalesPeriods(
    bdmName: string,
    stateName?: string,
    clientName?: string,
  ): Promise<{ months: string[]; years: number[] }> {
    const conditions = [sql`sales_person_name = ${bdmName}`];
    if (stateName) conditions.push(sql`state_name = ${stateName}`);
    if (clientName) conditions.push(sql`client_name = ${clientName}`);

    const result = await db.execute(sql`
      SELECT DISTINCT transaction_month, transaction_year
      FROM live_sales
      WHERE ${sql.join(conditions, sql` AND `)}
        AND transaction_month IS NOT NULL
        AND transaction_year IS NOT NULL
    `);

    const rows = result.rows as unknown as { transaction_month: string; transaction_year: number }[];
    const MONTH_ORDER: Record<string, number> = {
      January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
      July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
    };
    const monthSet = new Set<string>();
    const yearSet = new Set<number>();
    for (const r of rows) {
      if (r.transaction_month) monthSet.add(r.transaction_month);
      if (r.transaction_year != null) yearSet.add(r.transaction_year);
    }
    const months = Array.from(monthSet).sort((a, b) => (MONTH_ORDER[a] ?? 99) - (MONTH_ORDER[b] ?? 99));
    const years = Array.from(yearSet).sort((a, b) => b - a);
    return { months, years };
  }

  async getDistinctB2bBdmNames(): Promise<string[]> {
    const rows = await db.execute(sql`
      SELECT DISTINCT sales_person_name FROM b2b_sales_history
      WHERE sales_person_name IS NOT NULL AND TRIM(sales_person_name) <> ''
        AND UPPER(TRIM(sales_person_name)) NOT IN ('GANESH SHARMA', 'RJPL DIRECTORS', 'RETAIL', 'FINISHED GOODS', 'FINISHED GOODS VENDORS')
      ORDER BY sales_person_name
    `);
    return (rows.rows as { sales_person_name: string }[]).map(r => r.sales_person_name);
  }

  async getB2bClientsForBdm(bdmName: string, stateName?: string): Promise<Array<{ name: string; spend: number; count: number }>> {
    const rows = stateName
      ? await db.execute(sql`
          SELECT client_name as name, SUM(COALESCE(final_price, 0)) as spend, COUNT(*) as count
          FROM b2b_sales_history
          WHERE sales_person_name = ${bdmName}
            AND state_name = ${stateName}
            AND client_name IS NOT NULL AND TRIM(client_name) <> ''
          GROUP BY client_name
          ORDER BY spend DESC
        `)
      : await db.execute(sql`
          SELECT client_name as name, SUM(COALESCE(final_price, 0)) as spend, COUNT(*) as count
          FROM b2b_sales_history
          WHERE sales_person_name = ${bdmName}
            AND client_name IS NOT NULL AND TRIM(client_name) <> ''
          GROUP BY client_name
          ORDER BY spend DESC
        `);
    return (rows.rows as Array<{ name: string; spend: string; count: string }>).map(r => ({
      name: r.name,
      spend: Number(r.spend),
      count: Number(r.count),
    }));
  }

  async getB2bStatesForBdm(bdmName: string): Promise<string[]> {
    const rows = await db.execute(sql`
      SELECT DISTINCT state_name FROM b2b_sales_history
      WHERE sales_person_name = ${bdmName}
        AND state_name IS NOT NULL AND TRIM(state_name) <> ''
      ORDER BY state_name
    `);
    return (rows.rows as { state_name: string }[]).map(r => r.state_name);
  }

  // ── Evaluation methods ──────────────────────────────────────────────────

  async createEvaluation(data: InsertDesignEvaluation): Promise<DesignEvaluation> {
    const result = await db.insert(designEvaluations).values(data).returning();
    return result[0];
  }

  async getEvaluationsByProject(designProjectId: string): Promise<DesignEvaluation[]> {
    return await db.select().from(designEvaluations)
      .where(eq(designEvaluations.designProjectId, designProjectId))
      .orderBy(desc(designEvaluations.evaluatedAt));
  }

  async getEvaluations(
    page: number,
    limit: number,
    model?: string,
    promptVersionId?: string
  ): Promise<DesignEvaluation[]> {
    const conditions = [];
    if (model) conditions.push(eq(designEvaluations.modelProvider, model));
    if (promptVersionId) conditions.push(eq(designEvaluations.promptVersionId, promptVersionId));

    const query = db.select().from(designEvaluations);
    const filtered = conditions.length > 0
      ? query.where(and(...conditions))
      : query;

    return await filtered
      .orderBy(desc(designEvaluations.evaluatedAt))
      .offset((page - 1) * limit)
      .limit(limit);
  }

  async countEvaluations(model?: string, promptVersionId?: string): Promise<number> {
    const conditions = [];
    if (model) conditions.push(eq(designEvaluations.modelProvider, model));
    if (promptVersionId) conditions.push(eq(designEvaluations.promptVersionId, promptVersionId));

    const query = db.select({ count: count() }).from(designEvaluations);
    const filtered = conditions.length > 0
      ? query.where(and(...conditions))
      : query;

    const result = await filtered;
    return result[0].count;
  }

  // ── Prompt Version methods ──────────────────────────────────────────────

  async createPromptVersion(data: InsertPromptVersion): Promise<PromptVersion> {
    const result = await db.insert(promptVersions).values(data).returning();
    return result[0];
  }

  async getPromptVersions(scope?: string): Promise<PromptVersion[]> {
    if (scope) {
      return await db.select().from(promptVersions)
        .where(eq(promptVersions.scope, scope))
        .orderBy(desc(promptVersions.versionNumber));
    }
    return await db.select().from(promptVersions)
      .orderBy(desc(promptVersions.createdAt));
  }

  async getActivePromptVersion(scope: string): Promise<PromptVersion | undefined> {
    const result = await db.select().from(promptVersions)
      .where(and(eq(promptVersions.scope, scope), eq(promptVersions.isActive, 1)))
      .orderBy(desc(promptVersions.versionNumber))
      .limit(1);
    return result[0];
  }

  // ── Exhibition methods ──────────────────────────────────────────────────

  async getExhibitionList(): Promise<Array<{ name: string; interestCount: number; uniqueSkuCount: number; customerCount: number }>> {
    const rows = await db.execute(sql`
      SELECT
        exhibition_name as name,
        COUNT(*) as interest_count,
        COUNT(DISTINCT style_code) as unique_sku_count,
        COUNT(DISTINCT customer_name) as customer_count
      FROM exhibition_sku_interests
      GROUP BY exhibition_name
      ORDER BY interest_count DESC
    `);
    return (rows.rows as Array<{ name: string; interest_count: string; unique_sku_count: string; customer_count: string }>).map(r => ({
      name: r.name,
      interestCount: Number(r.interest_count),
      uniqueSkuCount: Number(r.unique_sku_count),
      customerCount: Number(r.customer_count),
    }));
  }

  async getExhibitionSignals(exhibition?: string): Promise<Array<{ parentStyle: string; category: string; makeType: string; interestCount: number; customerCount: number; exhibitions: string[] }>> {
    const whereClause = exhibition && exhibition !== "all"
      ? sql`WHERE exhibition_name = ${exhibition}`
      : sql``;
    const rows = await db.execute(sql`
      SELECT
        COALESCE(parent_style_code, style_code) as parent_style,
        category,
        make_type,
        COUNT(*) as interest_count,
        COUNT(DISTINCT customer_name) as customer_count,
        ARRAY_AGG(DISTINCT exhibition_name) as exhibitions
      FROM exhibition_sku_interests
      ${whereClause}
      GROUP BY COALESCE(parent_style_code, style_code), category, make_type
      ORDER BY interest_count DESC
    `);
    return (rows.rows as Array<{ parent_style: string; category: string; make_type: string; interest_count: string; customer_count: string; exhibitions: string[] }>).map(r => ({
      parentStyle: r.parent_style || "",
      category: r.category || "",
      makeType: r.make_type || "",
      interestCount: Number(r.interest_count),
      customerCount: Number(r.customer_count),
      exhibitions: r.exhibitions || [],
    }));
  }

  // ── Location methods ────────────────────────────────────────────────────

  async getDistinctLocations(): Promise<string[]> {
    const rows = await db.execute(sql`
      SELECT DISTINCT location FROM live_stock_items
      WHERE location IS NOT NULL AND TRIM(location) <> ''
        AND current_status = 'On Hand'
      ORDER BY location
    `);
    return (rows.rows as { location: string }[]).map(r => r.location);
  }
}

export const storage = new DatabaseStorage();
