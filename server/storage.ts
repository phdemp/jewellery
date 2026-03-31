import {
  type ReferenceImage,
  type InsertReferenceImage,
  type DesignProject,
  type InsertDesignProject,
  type DesignIteration,
  type InsertDesignIteration,
  referenceImages,
  designProjects,
  designIterations
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Reference Image methods
  createReferenceImage(data: InsertReferenceImage): Promise<ReferenceImage>;
  getReferenceImage(id: string): Promise<ReferenceImage | undefined>;
  getAllReferenceImages(): Promise<ReferenceImage[]>;
  deleteReferenceImage(id: string): Promise<void>;
  
  // Design Project methods
  createDesignProject(data: InsertDesignProject): Promise<DesignProject>;
  getDesignProject(id: string): Promise<DesignProject | undefined>;
  getAllDesignProjects(): Promise<DesignProject[]>;
  updateDesignProject(id: string, data: Partial<DesignProject>): Promise<DesignProject | undefined>;
  
  // Design Iteration methods
  createDesignIteration(data: InsertDesignIteration): Promise<DesignIteration>;
  getDesignIterations(designProjectId: string): Promise<DesignIteration[]>;
  getLatestIteration(designProjectId: string): Promise<DesignIteration | undefined>;
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
}

export const storage = new DatabaseStorage();
