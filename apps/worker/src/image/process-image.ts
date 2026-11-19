import sharp from "sharp";
import { MAX_INPUT_PIXELS, MAX_OUTPUT_DIMENSION, WEBP_QUALITY } from "./constants";
import {
  ImageDecodeError,
  ImageDimensionsExceededError,
  ImageProcessingError,
} from "./errors";

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
  format: "webp";
}

export interface ProcessImageOptions {
  maxPixels?: number;
}

let sharpConfigured = false;

export function configureSharpForWorker(): void {
  if (sharpConfigured) {
    return;
  }

  sharp.concurrency(1);
  sharp.cache(false);
  sharpConfigured = true;
}

export async function processImage(
  input: Buffer | Uint8Array,
  options: ProcessImageOptions = {},
): Promise<ProcessedImage> {
  configureSharpForWorker();

  const maxPixels = options.maxPixels ?? MAX_INPUT_PIXELS;
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer, {
      animated: false,
      limitInputPixels: maxPixels,
    }).metadata();
  } catch (error) {
    throw mapSharpError(error, maxPixels);
  }

  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  if (!width || !height) {
    throw new ImageDecodeError("Image dimensions could not be read.");
  }

  if (width * height > maxPixels) {
    throw new ImageDimensionsExceededError(maxPixels);
  }

  try {
    const { data, info } = await sharp(buffer, {
      animated: false,
      failOn: "error",
      limitInputPixels: maxPixels,
    })
      .rotate()
      .resize({
        width: MAX_OUTPUT_DIMENSION,
        height: MAX_OUTPUT_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return {
      data,
      width: info.width,
      height: info.height,
      format: "webp",
    };
  } catch (error) {
    throw mapSharpError(error, maxPixels);
  }
}

function mapSharpError(error: unknown, maxPixels: number): ImageProcessingError {
  if (error instanceof ImageProcessingError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/pixel limit|exceeds.*pixels|input image exceeds/i.test(message)) {
    return new ImageDimensionsExceededError(maxPixels);
  }

  return new ImageDecodeError("The image could not be decoded.", {
    cause: error,
  });
}
