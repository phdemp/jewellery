import OpenAI, { toFile } from "openai";
import * as fs from "fs";
import * as path from "path";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

export async function generateCADImageWithOpenAI(
  prompt: string,
  size: "1024x1024" | "1024x1536" | "1536x1024" = "1024x1536"
): Promise<string> {
  try {
    const response = await getOpenAI().images.generate({
      model: "gpt-image-1",
      prompt,
      quality: "high",
      size,
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image data in OpenAI response");

    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const filename = `cad_${timestamp}_${rand}.png`;
    const filepath = path.join("uploads", filename);
    fs.writeFileSync(filepath, Buffer.from(b64, "base64"));
    return `/uploads/${filename}`;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to generate CAD image with OpenAI: ${msg}`);
  }
}

export async function generateMarketingVisualOpenAI(
  jewelleryImageBase64: string,
  prompt: string
): Promise<string> {
  try {
    const imageFile = await toFile(
      Buffer.from(jewelleryImageBase64, "base64"),
      "jewellery.jpg",
      { type: "image/jpeg" }
    );

    const response = await getOpenAI().images.edit({
      model: "gpt-image-1",
      image: imageFile,
      prompt,
      size: "1024x1024",
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image data in OpenAI marketing visual response");

    return b64;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenAI marketing visual failed: ${msg}`);
  }
}

export async function modifyImageWithOpenAI(
  sourceImagePath: string,
  editPrompt: string,
): Promise<string> {
  try {
    if (!fs.existsSync(sourceImagePath)) {
      throw new Error(`Source image not found: ${sourceImagePath}`);
    }

    const imageStream = fs.createReadStream(sourceImagePath);
    const imageFile = await toFile(imageStream, "image.png", { type: "image/png" });

    const response = await getOpenAI().images.edit({
      model: "gpt-image-1",
      image: imageFile,
      prompt: editPrompt,
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image data in OpenAI response");

    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const filename = `modified_${timestamp}_${rand}.png`;
    const filepath = path.join("uploads", filename);
    fs.writeFileSync(filepath, Buffer.from(b64, "base64"));
    return `/uploads/${filename}`;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to modify image with OpenAI: ${msg}`);
  }
}
