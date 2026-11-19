import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { ImageDecodeError, ImageDimensionsExceededError } from "./errors";
import { processImage } from "./process-image";

async function makeImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 40, g: 120, b: 200, alpha: 1 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe("processImage", () => {
  test("converts to WebP and fits the longest side to 1280 px", async () => {
    const input = await makeImage(2000, 1000);
    const result = await processImage(input);
    const metadata = await sharp(result.data).metadata();

    expect(result.format).toBe("webp");
    expect(result.width).toBe(1280);
    expect(result.height).toBe(640);
    expect(metadata.format).toBe("webp");
  });

  test("does not enlarge an image smaller than 1280 px", async () => {
    const input = await makeImage(640, 480);
    const result = await processImage(input);

    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
  });

  test("rejects an image above the pixel limit before decoding the full image", async () => {
    const input = await makeImage(100, 100);

    await expect(processImage(input, { maxPixels: 5_000 })).rejects.toBeInstanceOf(
      ImageDimensionsExceededError,
    );
  });

  test("maps a corrupt input to a permanent decode error", async () => {
    await expect(processImage(Buffer.from("not an image"))).rejects.toBeInstanceOf(
      ImageDecodeError,
    );
  });
});
