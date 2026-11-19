import { ERROR_CODES, type ErrorCode } from "@ts-upload-image/shared";

export class ImageProcessingError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ImageDimensionsExceededError extends ImageProcessingError {
  constructor(maxPixels: number) {
    super(
      ERROR_CODES.IMAGE_DIMENSIONS_EXCEEDED,
      `Image exceeds the maximum of ${maxPixels} pixels.`,
    );
  }
}

export class ImageDecodeError extends ImageProcessingError {
  constructor(message = "The image could not be decoded.", options?: ErrorOptions) {
    super(ERROR_CODES.IMAGE_DECODE_FAILED, message, options);
  }
}
