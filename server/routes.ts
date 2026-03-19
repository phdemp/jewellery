import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { referenceImages } from "@shared/schema";
import { eq } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import sharp from "sharp";
import { modifyImageWithOpenAI, generateCADImageWithOpenAI, generateMarketingVisualOpenAI } from "./openai-client";
import {
  analyzeReferenceImage,
  analyzeDesignMaterials,
  generateTextEmbedding,
  generateImageEmbedding,
  generateJewellerySketch,
  editJewellerySketch,
  modifyJewelleryImage,
  buildDesignContext,
  buildImagePrompt,
  type DesignContext,
  buildMarketingPrompt,
  generateMarketingVisualGemini,
} from "./google-client";
import {
  generateCostingReport,
  type GoldPurity,
  type CostingReport,
  GOLD_PURITY,
} from "./costing";
import { addVector, searchSimilarVectors, clearVectorStore, migrateJsonToVector } from "./vector-store";
import { insertDesignProjectSchema, insertReferenceImageSchema, driveImportRequestSchema, designProjectInputSchema, THEME_CODES } from "@shared/schema";
import { extractFolderId, listImagesInFolder, downloadImage } from "./google-drive";

// Configure multer for file uploads (disk storage for reference images)
const diskStorage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  }
});

// Configure multer for memory storage (for style override processing)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  }
});

// Portrait-oriented jewellery categories for CAD image size selection
const PORTRAIT_CATEGORIES = [
  "Necklace", "Choker", "Long Necklace Set", "Kantha",
  "Hathphool", "Maangtika", "Sheesh Patti", "Nath",
  "Ear Extensions", "Necklace / Necklace Set",
  "Choker / Choker Set", "Long Pendant", "Long Necklace",
];

// Price band → budget mapping for AI costing
const PRICE_BAND_BUDGET: Record<string, { min: number; max: number }> = {
  "0-5 Lakh":       { min: 0,       max: 500000 },
  "5-10 Lakh":      { min: 500000,  max: 1000000 },
  "10-15 Lakh":     { min: 1000000, max: 1500000 },
  "15-25 Lakh":     { min: 1500000, max: 2500000 },
  "25-50 Lakh":     { min: 2500000, max: 5000000 },
  "50 Lakh - 1Cr":  { min: 5000000, max: 10000000 },
};

const BRAND_RULES = `You are an Expert Jewellery Designer AI specialising in hand-sketched concept art for Polki, Bridal and Contemporary luxury jewellery.

BRAND CONTEXT:
The jewellery brand focuses on luxury Polki, Bridal and wearable collections inspired by Indian heritage, nature, motifs and contemporary forms.

MANDATORY VIEW ANGLE:
- ALWAYS generate a FLAT FRONT-VIEW (straight-on, facing the viewer)
- NEVER show side views, 3/4 angles, perspective, or tilted angles
- The jewellery must appear as if laid flat on a surface and photographed from directly above, or as a technical front-facing elevation drawing
- Pure 2D jewellery drafting style — no depth, no foreshortening

STYLE RULES (VERY IMPORTANT):
- Thin, clean pencil-like outlines in soft brown or gold
- White polki stones drawn as soft rounded bubbles
- Pastel pink or soft pastel gemstones with gentle colored-pencil shading
- Smooth interior gradients in gems, no sharp edges
- Pure 2D jewellery drafting style (front view)
- Very clean and elegant aesthetic
- No dark outlines, no black cartoon lines
- No realism, no metallic reflections, no photographic lighting
- No background or shadows
- White or beige sketch-paper background
- Rendering should match hand-drawn jewellery design sheets

CATEGORIES:
Long Necklace Set, Choker, Necklace, Bangle, Hathphool, Bracelet, Ring, Kantha, Brooch, Kalangi, Ear Extensions, Maangtika, Sheesh Patti, Buttons, Nath, Lapel Pin

PURPOSE/SEGMENT CODES:
- WRD: Wearable Daily
- WRO: Wearable Occasion
- CLO: Contemporary Luxury Occasion
- SOLD: Solitaire Daily
- SOLO: Solitaire Occasion
- BRC: Bridal Classic
- BRP: Bridal Premium
- BRU: Bridal Ultimate

MOTIF CATEGORIES:
1. Nature Inspired: Lotus, Leaves, Cluster Flowers, Paisley, Paan
2. Animal & Birds: Peacock, Swan, Parrot, Butterfly, Elephant
3. Contemporary Forms: Geometric, Domes, Marquise, Arches, Scallops
4. Celestial: Crescent Moon

FUSION REQUIREMENT: BRU/BRP categories require fusion of 2+ motifs

STONE PREFERENCES:
Emerald, Ruby, Sapphire, Pink Tourmaline, Navratna, Amethyst, Polki-intensive layouts

GOLD-TO-STONE RATIO:
Use 50-55% gold for high-value sets

DESIGN RULES:
1. CLO RULE: No animals or birds in CLO designs - use abstract interpretations only
2. Indian heritage proportions must be maintained
3. Clean outlines with accurate stone placements
4. Realistic gold structure with balanced layout based on category
5. Layered long necklaces with scallops + lotus + emerald drops
6. Big-look rings with central Polki + geometric frame
7. Chokers with paisley + peacock motifs fusing seamlessly
8. Modern scallop-based Polki layouts with Jaali interiors`;

const CAD_RULES = `You are generating a PHOTOREALISTIC JEWELRY CAD RENDER for Raniwala 1881.

RENDER STYLE:
- Photorealistic 3D product render of the jewellery piece — clean studio product shot
- Render ONLY the jewellery product itself. Do NOT render any software interface, UI elements, menus, toolbars, panels, buttons, axes, grids, or viewport frames
- Metallic gold surfaces: warm 18k yellow gold with accurate specular highlights and reflections
- Gemstones: realistic facets, refractive brilliance, correct transparency and fire
- Studio photography lighting: soft overhead key light, gentle fill, neutral grey-white gradient background
- Sharp clean edges on metal settings; visible prong tips, bezels, wire textures, granulation detail
- NO hand-drawn lines, NO sketchy textures, NO illustration or watercolor style
- Output quality suitable for client presentation and production approval

COMPOSITION:
- CRITICAL: The ENTIRE jewellery piece must be fully visible — every chain, clasp, hook, dangling element, and extension must be COMPLETELY within the frame
- Center the product with at least 15% safe margin on ALL sides
- Scale the product DOWN if needed to ensure nothing is cropped or cut off at any edge
- Slight 3/4 perspective or straight-front view appropriate to the category
- Product only — no background props, models, or lifestyle context

GEMSTONE RULES:
- Polki: irregular rounded cabochon, slight translucency, set in kundan gold bezels
- Faceted stones (emerald, ruby, sapphire): visible internal reflections and facet lines
- All stone settings visible and precisely rendered

OUTPUT: White or light grey gradient background. Single image. No text overlays, no software UI, no menus, no panels, no watermarks. ONLY the jewellery product on a clean background.`;

function buildCADPrompt(context: DesignContext): string {
  const parts: string[] = [
    `Category: ${context.category}`,
    `Theme: ${context.theme}`,
  ];
  if (context.motifs?.length) parts.push(`Motifs: ${context.motifs.join(", ")}`);
  if (context.stones?.length) parts.push(`Gemstones: ${context.stones.join(", ")}`);
  if (context.materialRatio) parts.push(`Material ratio: ${context.materialRatio}`);
  if (context.customNotes) parts.push(`Special instructions: ${context.customNotes}`);

  return `${CAD_RULES}\n\nDESIGN SPECIFICATIONS:\n${parts.join("\n")}`;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Upload reference image
  app.post("/api/reference-images", upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file uploaded" });
      }

      const themeCode = req.body.themeCode || null;

      // Read the uploaded file as base64
      const fileBuffer = await fs.readFile(req.file.path);
      const base64Image = fileBuffer.toString('base64');

      // Generate thumbnail (300px width for grid display)
      const thumbnailFilename = `thumb_${path.basename(req.file.path)}`;
      const thumbnailPath = path.join('uploads', thumbnailFilename);
      await sharp(fileBuffer)
        .resize(300, 300, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 80 })
        .toFile(thumbnailPath);

      // Analyze the image using Gemini Vision
      const analysis = await analyzeReferenceImage(base64Image);

      // Generate multimodal embedding for similarity search (using image directly)
      const embedding = await generateImageEmbedding(base64Image);

      // Store in database with theme code and thumbnail path
      const referenceImage = await storage.createReferenceImage({
        filename: req.file.originalname,
        filepath: req.file.path,
        thumbnailPath: thumbnailPath,
        themeCode,
        metadata: analysis,
        embedding: embedding as any,
      });

      // Add to vector store for similarity search (include themeCode in metadata)
      await addVector(referenceImage.id, embedding, { ...analysis, themeCode });

      res.json({
        id: referenceImage.id,
        filename: referenceImage.filename,
        filepath: referenceImage.filepath,
        thumbnailPath: referenceImage.thumbnailPath,
        themeCode: referenceImage.themeCode,
        imageUrl: `/${referenceImage.filepath}`,
        thumbnailUrl: `/${referenceImage.thumbnailPath}`,
        analysis
      });
    } catch (error: any) {
      console.error("Error uploading reference image:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all reference images (exclude large embedding data for faster loading)
  app.get("/api/reference-images", async (req, res) => {
    try {
      const images = await storage.getAllReferenceImages();
      // Exclude embedding fields to speed up response - embeddings are only used server-side
      const imagesWithUrls = images.map(({ embedding, embeddingVector, ...img }) => ({
        ...img,
        imageUrl: `/${img.filepath}`,
        thumbnailUrl: img.thumbnailPath ? `/${img.thumbnailPath}` : `/${img.filepath}`,
        analysis: img.metadata
      }));
      res.json(imagesWithUrls);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete reference image
  app.delete("/api/reference-images/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const image = await storage.getReferenceImage(id);
      
      if (!image) {
        return res.status(404).json({ error: "Reference image not found" });
      }

      // Delete files from filesystem (original and thumbnail)
      try {
        await fs.unlink(image.filepath);
      } catch (error) {
        console.error("Error deleting file:", error);
      }
      
      // Delete thumbnail if exists
      if (image.thumbnailPath) {
        try {
          await fs.unlink(image.thumbnailPath);
        } catch (error) {
          console.error("Error deleting thumbnail:", error);
        }
      }

      await storage.deleteReferenceImage(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate design sketch
  app.post("/api/generate-design", memoryUpload.single('styleOverride'), async (req, res) => {
    try {
      // Parse form data — new extended fields
      const category = req.body.category;
      const productSegment = req.body.productSegment || "";
      const priceBand = req.body.priceBand || "";
      const polkiSize = req.body.polkiSize || "";
      const motifCategory = req.body.motifCategory || "";
      let motifs: string[] = [];
      try {
        motifs = req.body.motifs ? JSON.parse(req.body.motifs) : [];
      } catch {
        motifs = [];
      }
      let stoneColour: string[] = [];
      try {
        stoneColour = req.body.stoneColour ? JSON.parse(req.body.stoneColour) : [];
      } catch {
        stoneColour = [];
      }
      const enamel = req.body.enamel || "";
      const finish = req.body.finish || "";
      const designShape = req.body.designShape || "";
      const materialRatio = req.body.materialRatio || "Gold Intensive";
      const talaf = req.body.talaf || "";
      const piroiPlacement = req.body.piroiPlacement || "";
      const piroiColour = req.body.piroiColour || "";
      const customNotes = req.body.customNotes || undefined;
      const styleOverrideFile = req.file;
      const mode = (req.body.mode as string) === "cad" ? "cad" : "sketch";

      // Map new fields to DB schema (theme = productSegment, stones = stoneColour)
      const validatedData = designProjectInputSchema.parse({
        category,
        theme: productSegment || "Modern",
        motifs,
        stones: stoneColour,
        materialRatio,
        customNotes
      });

      let similarDesigns: any[] = [];
      let styleOverrideAnalysis: any = null;

      // If style override is provided, analyze it and use it as the primary style reference
      if (styleOverrideFile) {
        const base64Image = styleOverrideFile.buffer.toString('base64');
        styleOverrideAnalysis = await analyzeReferenceImage(base64Image);
      } else {
        // Search for similar designs from Reference Library (no theme filtering — product segments don't map to THEME_CODES)
        const queryText = `${category} ${productSegment} ${motifs.join(' ')} ${customNotes || ''}`;
        const queryEmbedding = await generateTextEmbedding(queryText);
        const similarResults = await searchSimilarVectors(queryEmbedding, 3);
        similarDesigns = similarResults.map(result => result.metadata);
      }

      // Build extra specs string from extended fields (same approach as CAD comparison endpoint)
      const extraSpecs: string[] = [];
      if (priceBand) extraSpecs.push(`Price Band: ${priceBand}`);
      if (polkiSize) extraSpecs.push(`Polki Size: ${polkiSize}`);
      if (motifCategory) extraSpecs.push(`Motif Category: ${motifCategory}`);
      if (enamel) extraSpecs.push(`Enamel: ${enamel}`);
      if (finish) extraSpecs.push(`Finish: ${finish}`);
      if (designShape) extraSpecs.push(`Design Shape: ${designShape}`);
      if (talaf && talaf !== "None") extraSpecs.push(`Talaf: ${talaf}`);
      if (piroiPlacement && piroiPlacement !== "None") extraSpecs.push(`Piroi Placement: ${piroiPlacement}`);
      if (piroiColour && piroiColour !== "None") extraSpecs.push(`Piroi Colour: ${piroiColour}`);
      const extraSpecsStr = extraSpecs.length > 0 ? "\n\nAdditional Specifications:\n" + extraSpecs.join("\n") : "";

      // Build context with brand rules and similar designs
      const context: DesignContext = {
        category: validatedData.category,
        theme: productSegment || "Modern",
        motifs: validatedData.motifs,
        stones: stoneColour,
        materialRatio: validatedData.materialRatio,
        customNotes: validatedData.customNotes ?? undefined,
        similarDesigns: styleOverrideAnalysis ? [styleOverrideAnalysis] : similarDesigns
      };

      const fullContext = buildDesignContext(context, BRAND_RULES);

      // Generate sketch plan (detailed, for display)
      let sketchPlan = `Create a design for a **${category}** in the **${productSegment || "Modern"}** segment.\n\n`;
      sketchPlan += `**Structure & Layout:**\n`;
      if (category.toLowerCase().includes('necklace') || category.toLowerCase().includes('choker')) {
        sketchPlan += `- Ensure the piece sits naturally on the neck curve (2D front view).\n`;
        sketchPlan += `- Maintain symmetry unless specified otherwise.\n`;
      }
      sketchPlan += `- Use ${materialRatio} layout style.\n`;
      if (extraSpecs.length > 0) {
        sketchPlan += `\n**Specifications:**\n`;
        extraSpecs.forEach(s => { sketchPlan += `- ${s}\n`; });
      }
      sketchPlan += `\n**Motifs & Elements:**\n`;
      sketchPlan += `- Integrate the following motifs: ${motifs.join(', ') || 'None specified'}.\n`;
      if (stoneColour.length > 0) {
        sketchPlan += `- Stone colours: ${stoneColour.join(', ')}.\n`;
      }

      if (styleOverrideAnalysis) {
        sketchPlan += `\n**Using user-provided style override reference**\n`;
        sketchPlan += `Style reference: ${styleOverrideAnalysis.description}\n`;
      } else if (similarDesigns.length > 0) {
        sketchPlan += `\n**Informed by ${similarDesigns.length} similar reference design(s) from library**\n`;
      }

      // Generate condensed image prompt for Gemini (under 4000 chars)
      const imagePrompt = buildImagePrompt(context) + extraSpecsStr;

      // Generate the actual image — Gemini for sketch, OpenAI for CAD render (Gemini fallback)
      let generatedImageUrl: string;
      if (mode === "cad") {
        const cadPrompt = buildCADPrompt(context) + extraSpecsStr;
        const isPortrait = PORTRAIT_CATEGORIES.some(c =>
          validatedData.category.toLowerCase().includes(c.toLowerCase())
        );
        const cadSize = isPortrait ? "1024x1536" as const : "1024x1024" as const;
        try {
          generatedImageUrl = await generateCADImageWithOpenAI(cadPrompt, cadSize);
        } catch (openaiError: any) {
          console.warn(`OpenAI CAD generation failed (${openaiError.message}), falling back to Gemini`);
          generatedImageUrl = await generateJewellerySketch(cadPrompt);
        }
      } else {
        generatedImageUrl = await generateJewellerySketch(BRAND_RULES + "\n\n" + imagePrompt);
      }

      // Save to database
      const designProject = await storage.createDesignProject({
        ...validatedData,
        sketchPlan,
        imagePrompt,
        generatedImageUrl,
      });

      res.json({
        id: designProject.id,
        sketchPlan,
        imagePrompt,
        generatedImageUrl,
        usedReferences: styleOverrideAnalysis ? 1 : similarDesigns.length
      });
    } catch (error: any) {
      console.error("Error generating design:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate comparison - two designs: with references and without references
  app.post("/api/generate-comparison", async (req, res) => {
    try {
      const { category, theme, motifs, stones, materialRatio, customNotes } = req.body;

      const validatedData = designProjectInputSchema.parse({
        category,
        theme,
        motifs: motifs || [],
        stones: stones || [],
        materialRatio,
        customNotes
      });

      // Extract theme code for filtering
      const themeMapping = THEME_CODES.find(t => t.name === validatedData.theme);
      const themeCode = themeMapping?.code || null;

      // Search for similar designs from Reference Library
      const queryText = `${validatedData.category} ${validatedData.theme} ${validatedData.motifs.join(' ')} ${validatedData.customNotes || ''}`;
      const queryEmbedding = await generateTextEmbedding(queryText);
      const similarResults = await searchSimilarVectors(queryEmbedding, 3, themeCode || undefined);
      const similarDesigns = similarResults.map(result => ({
        ...result.metadata,
        similarity: Math.round(result.similarity * 100)
      }));

      // Context WITH references
      const contextWithRefs: DesignContext = {
        category: validatedData.category,
        theme: validatedData.theme,
        motifs: validatedData.motifs,
        stones: validatedData.stones || [],
        materialRatio: validatedData.materialRatio,
        customNotes: validatedData.customNotes ?? undefined,
        similarDesigns: similarDesigns
      };

      // Context WITHOUT references (empty similarDesigns = uses defaults)
      const contextWithoutRefs: DesignContext = {
        category: validatedData.category,
        theme: validatedData.theme,
        motifs: validatedData.motifs,
        stones: validatedData.stones || [],
        materialRatio: validatedData.materialRatio,
        customNotes: validatedData.customNotes ?? undefined,
        similarDesigns: []
      };

      // Build prompts for both
      const promptWithRefs = buildImagePrompt(contextWithRefs);
      const promptWithoutRefs = buildImagePrompt(contextWithoutRefs);

      // Generate both images in parallel
      const [imageWithRefs, imageWithoutRefs] = await Promise.all([
        generateJewellerySketch(BRAND_RULES + "\n\n" + promptWithRefs),
        generateJewellerySketch(BRAND_RULES + "\n\n" + promptWithoutRefs)
      ]);

      res.json({
        withReferences: {
          imageUrl: imageWithRefs,
          prompt: promptWithRefs,
          referencesUsed: similarDesigns.length,
          references: similarDesigns.map(ref => ({
            description: ref.description?.substring(0, 100) + '...',
            similarity: ref.similarity,
            lineStyle: ref.lineStyle,
            coloringTechnique: ref.coloringTechnique
          }))
        },
        withoutReferences: {
          imageUrl: imageWithoutRefs,
          prompt: promptWithoutRefs,
          referencesUsed: 0
        }
      });
    } catch (error: any) {
      console.error("Error generating comparison:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all design projects
  app.get("/api/design-projects", async (req, res) => {
    try {
      const projects = await storage.getAllDesignProjects();
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single design project
  app.get("/api/design-projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const project = await storage.getDesignProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Design project not found" });
      }

      res.json(project);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Edit a design - create new iteration with edits
  app.post("/api/design-projects/:id/edit", async (req, res) => {
    try {
      const { id } = req.params;
      const { editPrompt } = req.body;

      if (!editPrompt || typeof editPrompt !== 'string' || editPrompt.trim().length === 0) {
        return res.status(400).json({ error: "Edit prompt is required" });
      }

      // Get the design project
      const project = await storage.getDesignProject(id);
      if (!project) {
        return res.status(404).json({ error: "Design project not found" });
      }

      // Get the latest iteration or use original image
      const iterations = await storage.getDesignIterations(id);
      const sourceImageUrl = iterations.length > 0 
        ? iterations[iterations.length - 1].resultImageUrl 
        : project.generatedImageUrl;

      if (!sourceImageUrl) {
        return res.status(400).json({ error: "No source image available for editing" });
      }

      // Generate edited image — Gemini preferred, OpenAI fallback
      let editedImageUrl: string;
      try {
        editedImageUrl = await editJewellerySketch(sourceImageUrl, editPrompt.trim());
      } catch (geminiError: any) {
        console.warn(`Gemini sketch edit failed (${geminiError.message}), falling back to OpenAI`);
        const absoluteSourcePath = path.resolve(sourceImageUrl.startsWith('/') ? '.' + sourceImageUrl : sourceImageUrl);
        editedImageUrl = await modifyImageWithOpenAI(absoluteSourcePath, editPrompt.trim());
      }

      // Save the iteration
      const iteration = await storage.createDesignIteration({
        designProjectId: id,
        iterationNumber: iterations.length + 1,
        editPrompt: editPrompt.trim(),
        sourceImageUrl,
        resultImageUrl: editedImageUrl,
      });

      res.json({
        id: iteration.id,
        iterationNumber: iteration.iterationNumber,
        editPrompt: iteration.editPrompt,
        sourceImageUrl: iteration.sourceImageUrl,
        resultImageUrl: iteration.resultImageUrl,
      });
    } catch (error: any) {
      console.error("Error editing design:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get design iterations
  app.get("/api/design-projects/:id/iterations", async (req, res) => {
    try {
      const { id } = req.params;
      const iterations = await storage.getDesignIterations(id);
      res.json(iterations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Save design to organized folder structure: designs/{category}/{theme}/
  app.post("/api/design-projects/:id/save", async (req, res) => {
    try {
      const { id } = req.params;
      const { iterationIndex } = req.body; // Optional: which iteration to save (0 = original)
      
      // Get the design project to get category and theme
      const project = await storage.getDesignProject(id);
      if (!project) {
        return res.status(404).json({ error: "Design project not found" });
      }

      // Get the correct image URL from server-side data (not from client)
      let sourceUrl = project.generatedImageUrl;
      if (typeof iterationIndex === 'number' && iterationIndex > 0) {
        const iterations = await storage.getDesignIterations(id);
        const iteration = iterations[iterationIndex - 1]; // iterationIndex 1 = first edit
        if (iteration) {
          sourceUrl = iteration.resultImageUrl;
        }
      }

      if (!sourceUrl) {
        return res.status(400).json({ error: "No image to save" });
      }

      // Security: Validate that source is within uploads directory
      const normalizedSource = path.normalize(sourceUrl.startsWith('/') ? `.${sourceUrl}` : sourceUrl);
      if (!normalizedSource.startsWith('uploads/') && !normalizedSource.startsWith('./uploads/')) {
        return res.status(400).json({ error: "Invalid image path" });
      }

      // Sanitize category and theme for folder names (remove special chars, replace spaces)
      const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
      const categoryFolder = sanitize(project.category);
      const themeFolder = sanitize(project.theme);

      // Create folder structure: designs/{category}/{theme}/
      const designsDir = path.join("designs", categoryFolder, themeFolder);
      await fs.mkdir(designsDir, { recursive: true });

      // Generate unique filename
      const timestamp = Date.now();
      const filename = `design_${timestamp}.png`;
      const destPath = path.join(designsDir, filename);

      // Copy the image from uploads to designs folder
      await fs.copyFile(normalizedSource, destPath);

      res.json({
        success: true,
        savedPath: `/${destPath}`,
        folder: `designs/${categoryFolder}/${themeFolder}`,
        filename
      });
    } catch (error: any) {
      console.error("Error saving design:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Import images from Google Drive folder
  app.post("/api/import-from-drive", async (req, res) => {
    try {
      // Validate request body
      const parseResult = driveImportRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: parseResult.error.errors[0]?.message || "Invalid request" });
      }
      
      const { folderUrl, themeCode } = parseResult.data;

      // Extract folder ID from URL
      const folderId = extractFolderId(folderUrl);

      // List images in folder
      const files = await listImagesInFolder(folderId);
      
      if (files.length === 0) {
        return res.status(400).json({ error: "No images found in the folder" });
      }

      const results: { filename: string; success: boolean; error?: string }[] = [];
      let processed = 0;

      // Process each image
      for (const file of files) {
        try {
          // Download image from Drive
          const imageBuffer = await downloadImage(file.id);
          const base64Image = imageBuffer.toString('base64');

          // Analyze the image using Gemini Vision
          const analysis = await analyzeReferenceImage(base64Image);

          // Generate multimodal embedding for similarity search (using image directly)
          const embedding = await generateImageEmbedding(base64Image);

          // Save to uploads folder
          const uploadPath = `uploads/${Date.now()}_${file.name}`;
          await fs.writeFile(uploadPath, imageBuffer);

          // Generate thumbnail
          const thumbnailFilename = `thumb_${path.basename(uploadPath)}`;
          const thumbnailPath = path.join('uploads', thumbnailFilename);
          await sharp(imageBuffer)
            .resize(300, 300, { fit: 'cover', position: 'center' })
            .jpeg({ quality: 80 })
            .toFile(thumbnailPath);

          // Store in database
          const referenceImage = await storage.createReferenceImage({
            filename: file.name,
            filepath: uploadPath,
            thumbnailPath: thumbnailPath,
            metadata: analysis,
            embedding: embedding as any,
            themeCode: themeCode,
          });

          // Add to vector store for similarity search (include themeCode in metadata)
          await addVector(referenceImage.id, embedding, { ...analysis, themeCode });

          results.push({ filename: file.name, success: true });
        } catch (error: any) {
          console.error(`Error processing ${file.name}:`, error);
          results.push({ filename: file.name, success: false, error: error.message });
        }
        processed++;
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        total: files.length,
        success: successCount,
        failed: failCount,
        results
      });
    } catch (error: any) {
      console.error("Error importing from Drive:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Re-analyze and re-embed all reference images with enhanced style metadata
  app.post("/api/reembed-references", async (req, res) => {
    try {
      // Get all reference images
      const images = await storage.getAllReferenceImages();
      
      if (images.length === 0) {
        return res.json({ message: "No reference images to re-embed", total: 0, success: 0, failed: 0 });
      }

      // Clear existing vectors
      await clearVectorStore();

      const results: { id: string; filename: string; success: boolean; error?: string }[] = [];

      // Re-analyze and re-embed each image with enhanced style extraction
      for (const image of images) {
        try {
          // Read the image file
          const fileBuffer = await fs.readFile(image.filepath);
          const base64Image = fileBuffer.toString('base64');

          // Re-analyze image with enhanced style metadata extraction
          const analysis = await analyzeReferenceImage(base64Image);
          
          // Generate new embedding from the analysis description
          const embedding = await generateImageEmbedding(base64Image);

          // Merge new analysis into existing metadata to preserve any custom fields
          // Also ensure themeCode is set (from column or existing metadata)
          const existingMetadata = (image.metadata as Record<string, any>) || {};
          const themeCode = image.themeCode || existingMetadata.themeCode || null;
          const updatedMetadata = { 
            ...existingMetadata, // preserve any existing custom fields
            ...analysis, // add/update with new vision analysis
            themeCode // ensure themeCode is preserved
          };

          // Update the reference image metadata in database (including pgvector column)
          await db.update(referenceImages)
            .set({ 
              metadata: updatedMetadata,
              embedding: embedding as any,
              embeddingVector: embedding // pgvector column
            })
            .where(eq(referenceImages.id, image.id));

          results.push({ id: image.id, filename: image.filename, success: true });
        } catch (error: any) {
          console.error(`Error re-embedding ${image.filename}:`, error);
          results.push({ id: image.id, filename: image.filename, success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        message: "Re-embedding complete with enhanced style metadata",
        total: images.length,
        success: successCount,
        failed: failCount,
        results
      });
    } catch (error: any) {
      console.error("Error re-embedding references:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Migrate existing JSON embeddings to pgvector column
  app.post("/api/migrate-vectors", async (req, res) => {
    try {
      const migrated = await migrateJsonToVector();
      res.json({
        message: `Migrated ${migrated} embeddings from JSON to pgvector`,
        migrated
      });
    } catch (error: any) {
      console.error("Error migrating vectors:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate thumbnails for existing images that don't have them
  app.post("/api/generate-thumbnails", async (req, res) => {
    try {
      const images = await storage.getAllReferenceImages();
      const results: { id: string; filename: string; success: boolean; error?: string }[] = [];

      for (const image of images) {
        try {
          // Skip if already has thumbnail
          if (image.thumbnailPath) {
            results.push({ id: image.id, filename: image.filename, success: true });
            continue;
          }

          // Check if original file exists
          try {
            await fs.access(image.filepath);
          } catch {
            results.push({ id: image.id, filename: image.filename, success: false, error: 'Original file not found' });
            continue;
          }

          // Generate thumbnail
          const fileBuffer = await fs.readFile(image.filepath);
          const thumbnailFilename = `thumb_${path.basename(image.filepath)}`;
          const thumbnailPath = path.join('uploads', thumbnailFilename);
          
          await sharp(fileBuffer)
            .resize(300, 300, { fit: 'cover', position: 'center' })
            .jpeg({ quality: 80 })
            .toFile(thumbnailPath);

          // Update database with thumbnail path
          await db.update(referenceImages)
            .set({ thumbnailPath })
            .where(eq(referenceImages.id, image.id));

          console.log(`Generated thumbnail for ${image.filename}`);
          results.push({ id: image.id, filename: image.filename, success: true });
        } catch (error: any) {
          console.error(`Error generating thumbnail for ${image.filename}:`, error);
          results.push({ id: image.id, filename: image.filename, success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        message: "Thumbnail generation complete",
        total: images.length,
        success: successCount,
        failed: failCount,
        results
      });
    } catch (error: any) {
      console.error("Error generating thumbnails:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Modify an uploaded jewellery image with design parameters
  app.post("/api/modify-design", memoryUpload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Image file is required" });
      }

      // Convert upload to PNG (ensures correct MIME type for Gemini) and save to disk
      const inputFilename = `modify_input_${Date.now()}.png`;
      const inputPath = path.join("uploads", inputFilename);
      const pngBuffer = await sharp(req.file.buffer).png().toBuffer();
      await fs.writeFile(inputPath, pngBuffer);

      // Parse array fields
      let motifs: string[] = [];
      try { motifs = req.body.motifs ? JSON.parse(req.body.motifs) : []; } catch { motifs = []; }
      let stoneColour: string[] = [];
      try { stoneColour = req.body.stoneColour ? JSON.parse(req.body.stoneColour) : []; } catch { stoneColour = []; }

      // Parse gold rate and purity for costing
      const goldRatePerGram = Number(req.body.goldRatePerGram) || 0;
      const goldPurityRaw = req.body.goldPurity as string;
      const goldPurity: GoldPurity = (goldPurityRaw && goldPurityRaw in GOLD_PURITY)
        ? goldPurityRaw as GoldPurity : "18k";

      // Build edit prompt — only include non-empty fields
      const lines: string[] = ["Modify this jewellery design according to the following specifications:\n"];
      if (req.body.productSegment) lines.push(`Product Segment: ${req.body.productSegment}`);
      if (req.body.category) lines.push(`Category: ${req.body.category}`);
      if (req.body.priceBand) lines.push(`Price Band: ${req.body.priceBand}`);
      if (req.body.polkiSize) lines.push(`Polki Size: ${req.body.polkiSize}`);
      if (req.body.motifCategory) lines.push(`Motif Category: ${req.body.motifCategory}`);
      if (motifs.length > 0) lines.push(`Motifs: ${motifs.join(", ")}`);
      if (stoneColour.length > 0) lines.push(`Stone Colours: ${stoneColour.join(", ")}`);
      if (req.body.enamel) lines.push(`Enamel: ${req.body.enamel}`);
      if (req.body.finish) lines.push(`Finish: ${req.body.finish}`);
      if (req.body.designShape) lines.push(`Design Shape: ${req.body.designShape}`);
      if (req.body.materialRatio) lines.push(`Material Ratio: ${req.body.materialRatio}`);
      if (req.body.talaf && req.body.talaf !== "None") lines.push(`Talaf: ${req.body.talaf}`);
      if (req.body.piroiPlacement && req.body.piroiPlacement !== "None") lines.push(`Piroi Placement: ${req.body.piroiPlacement}`);
      if (req.body.piroiColour && req.body.piroiColour !== "None") lines.push(`Piroi Colour: ${req.body.piroiColour}`);
      if (req.body.customNotes) lines.push(`\nAdditional Instructions: ${req.body.customNotes}`);

      const editPrompt = lines.join("\n");

      // Modify the image — OpenAI preferred, Gemini fallback
      let generatedImageUrl: string;
      try {
        try {
          generatedImageUrl = await modifyImageWithOpenAI(path.resolve(inputPath), editPrompt);
        } catch (openaiError: any) {
          console.warn(`OpenAI modify failed (${openaiError.message}), falling back to Gemini`);
          generatedImageUrl = await modifyJewelleryImage(path.resolve(inputPath), editPrompt);
        }
      } finally {
        try { await fs.unlink(inputPath); } catch { /* ignore cleanup errors */ }
      }

      // ── AI Costing: analyze materials + compute cost report ──
      let costReport: CostingReport | null = null;
      const priceBand = req.body.priceBand as string | undefined;
      const budgetRange = priceBand ? PRICE_BAND_BUDGET[priceBand] : undefined;

      if (budgetRange && goldRatePerGram > 0) {
        try {
          // Read the generated image as base64 for Gemini Vision analysis
          const generatedPath = generatedImageUrl.startsWith("/")
            ? path.join(".", generatedImageUrl)
            : generatedImageUrl;
          const generatedBuffer = await fs.readFile(generatedPath);
          const imageBase64 = generatedBuffer.toString("base64");

          const breakdown = await analyzeDesignMaterials(imageBase64, {
            category: req.body.category || "Modification",
            budget: budgetRange.max,
            materialRatio: req.body.materialRatio || "",
            stones: stoneColour,
          });

          // Use user-provided gold percentage (slider), or fallback to 40
          const goldPercentage = Math.max(5, Math.min(95,
            parseInt(req.body.goldPercentage as string, 10) || 40
          ));

          costReport = generateCostingReport({
            totalBudget: budgetRange.max,
            goldPercentage,
            goldRatePerGram,
            goldPurity,
            polki: breakdown.polki.map(p => ({ sieve: p.sieve, count: p.count })),
            diamond: breakdown.diamond.map(d => ({ sieve: d.sieve, count: d.count })),
            colorStones: breakdown.colorStones.map(c => ({ type: c.type, carats: c.carats })),
            emeralds: breakdown.emeralds.map(e => ({ size_mm: e.size_mm, count: e.count })),
          });

          console.log(`AI costing complete — total estimated: ₹${costReport.totalEstimatedCost.toLocaleString("en-IN")}`);
        } catch (costError: any) {
          console.warn(`AI costing failed (${costError.message}), returning design without cost report`);
        }
      }

      // Save as a design project for iteration support
      const designProject = await storage.createDesignProject({
        category: req.body.category || "Modification",
        theme: req.body.productSegment || "Custom",
        motifs,
        stones: stoneColour,
        materialRatio: req.body.materialRatio || "",
        customNotes: req.body.customNotes || "",
        sketchPlan: editPrompt,
        imagePrompt: editPrompt,
        generatedImageUrl,
      });

      res.json({
        id: designProject.id,
        sketchPlan: editPrompt,
        imagePrompt: editPrompt,
        generatedImageUrl,
        usedReferences: 0,
        costReport,
      });
    } catch (error: any) {
      console.error("Error modifying design:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate CAD comparison - same prompt rendered by Gemini and OpenAI side-by-side
  app.post("/api/generate-cad-comparison", async (req, res) => {
    try {
      const {
        productSegment, category, priceBand, polkiSize, motifCategory,
        motifs, stoneColour, enamel, finish, designShape,
        talaf, piroiPlacement, piroiColour, customNotes,
        // Legacy fields for backward compatibility
        theme, stones,
      } = req.body;

      const resolvedCategory = category || "Necklace";
      const resolvedTheme = productSegment || theme || "Modern";
      const resolvedStones = stoneColour || stones || [];

      const validatedData = designProjectInputSchema.parse({
        category: resolvedCategory,
        theme: resolvedTheme,
        motifs: motifs || [],
        stones: resolvedStones,
        materialRatio: "Gold Intensive",
        customNotes,
      });

      const context: DesignContext = {
        category: validatedData.category,
        theme: validatedData.theme,
        motifs: validatedData.motifs,
        stones: validatedData.stones || [],
        materialRatio: validatedData.materialRatio,
        customNotes: validatedData.customNotes ?? undefined,
        similarDesigns: [],
      };

      let cadPrompt = buildCADPrompt(context);

      // Append additional specifications from modify-style parameters
      const extraSpecs: string[] = [];
      if (priceBand) extraSpecs.push(`Price band: ${priceBand}`);
      if (polkiSize) extraSpecs.push(`Polki size: ${polkiSize}`);
      if (motifCategory) extraSpecs.push(`Motif category: ${motifCategory}`);
      if (enamel) extraSpecs.push(`Enamel: ${enamel}`);
      if (finish) extraSpecs.push(`Finish: ${finish}`);
      if (designShape) extraSpecs.push(`Design shape: ${designShape}`);
      if (talaf) extraSpecs.push(`Talaf: ${talaf}`);
      if (piroiPlacement) extraSpecs.push(`Piroi placement: ${piroiPlacement}`);
      if (piroiColour) extraSpecs.push(`Piroi colour: ${piroiColour}`);

      if (extraSpecs.length > 0) {
        cadPrompt += "\n" + extraSpecs.join("\n");
      }

      // Generate both models in parallel — same prompt, different engines
      // OpenAI failure falls back to Gemini automatically (reuses already-generated Gemini image)
      // Compute aspect ratio based on category
      const cadIsPortrait = PORTRAIT_CATEGORIES.some(c =>
        resolvedCategory.toLowerCase().includes(c.toLowerCase())
      );
      const cadSize = cadIsPortrait ? "1024x1536" as const : "1024x1024" as const;

      const [geminiResult, openaiResult] = await Promise.allSettled([
        generateJewellerySketch(cadPrompt),
        generateCADImageWithOpenAI(cadPrompt, cadSize),
      ]);

      if (geminiResult.status === "rejected") throw geminiResult.reason;

      let openaiUrl: string;
      let openaiModel: string;
      if (openaiResult.status === "fulfilled") {
        openaiUrl = openaiResult.value;
        openaiModel = "gpt-image-1";
      } else {
        console.warn(`OpenAI CAD comparison failed (${openaiResult.reason?.message}), using Gemini fallback`);
        openaiUrl = geminiResult.value;
        openaiModel = "gemini-3-pro-image-preview (OpenAI fallback)";
      }

      res.json({
        gemini: { imageUrl: geminiResult.value, model: "gemini-3-pro-image-preview" },
        openai: { imageUrl: openaiUrl, model: openaiModel },
        prompt: cadPrompt,
      });
    } catch (error: any) {
      console.error("Error generating CAD comparison:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/generate-marketing — Generate marketing visuals with Gemini + OpenAI side-by-side
  app.post("/api/generate-marketing", memoryUpload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Jewellery image is required" });
      }

      // Pre-process image with Sharp for consistent quality
      const processedBuffer = await sharp(req.file.buffer)
        .resize(1024, 1024, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 90 })
        .toBuffer();

      const base64Image = processedBuffer.toString("base64");

      const {
        jewelleryCategory,
        modelEthnicity,
        modelStyle,
        backgroundSetting,
        lightingMood,
        outfitStyle,
        composition,
        customNotes,
      } = req.body;

      if (!jewelleryCategory || !modelEthnicity || !modelStyle || !backgroundSetting || !lightingMood || !outfitStyle || !composition) {
        return res.status(400).json({ error: "All styling parameters are required" });
      }

      const prompt = buildMarketingPrompt({
        jewelleryCategory,
        modelEthnicity,
        modelStyle,
        backgroundSetting,
        lightingMood,
        outfitStyle,
        composition,
        customNotes: customNotes || undefined,
      });

      // Run both AI models in parallel — allSettled so one failure doesn't block the other
      const [geminiResult, openaiResult] = await Promise.allSettled([
        generateMarketingVisualGemini(base64Image, prompt),
        generateMarketingVisualOpenAI(base64Image, prompt),
      ]);

      // Ensure designs/marketing directory exists
      const marketingDir = path.join("designs", "marketing");
      await fs.mkdir(marketingDir, { recursive: true });

      let geminiUrl: string | null = null;
      let geminiError: string | null = null;
      let openaiUrl: string | null = null;
      let openaiError: string | null = null;

      if (geminiResult.status === "fulfilled") {
        const filename = `${Date.now()}-gemini.png`;
        const filepath = path.join(marketingDir, filename);
        await fs.writeFile(filepath, Buffer.from(geminiResult.value, "base64"));
        geminiUrl = `/designs/marketing/${filename}`;
      } else {
        geminiError = geminiResult.reason?.message || "Gemini generation failed";
        console.error("Gemini marketing visual failed:", geminiError);
      }

      if (openaiResult.status === "fulfilled") {
        const filename = `${Date.now()}-openai.png`;
        const filepath = path.join(marketingDir, filename);
        await fs.writeFile(filepath, Buffer.from(openaiResult.value, "base64"));
        openaiUrl = `/designs/marketing/${filename}`;
      } else {
        openaiError = openaiResult.reason?.message || "OpenAI generation failed";
        console.error("OpenAI marketing visual failed:", openaiError);
      }

      // Save to database using the first successful result
      const primaryImageUrl = geminiUrl || openaiUrl;
      let projectId: string | null = null;

      if (primaryImageUrl) {
        const designProject = await storage.createDesignProject({
          category: jewelleryCategory,
          theme: "Marketing",
          motifs: [],
          stones: [],
          materialRatio: "",
          customNotes: customNotes || "",
          sketchPlan: prompt,
          imagePrompt: prompt,
          generatedImageUrl: primaryImageUrl,
        });
        projectId = designProject.id;
      }

      res.json({
        projectId,
        prompt,
        gemini: { imageUrl: geminiUrl, error: geminiError },
        openai: { imageUrl: openaiUrl, error: openaiError },
      });
    } catch (error: any) {
      console.error("Error generating marketing visual:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
