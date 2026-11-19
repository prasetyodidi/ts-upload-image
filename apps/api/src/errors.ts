import type { ErrorCode } from "@ts-upload-image/shared";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
  };
}

export function errorBody(
  code: ErrorCode,
  message: string,
  retryable: boolean,
): ApiErrorBody {
  return { error: { code, message, retryable } };
}

export function isPermanentStorageMiss(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };

  return (
    candidate.name === "NoSuchKey" ||
    candidate.Code === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}
