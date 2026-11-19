import type { ErrorCode, JobStatus } from "@ts-upload-image/shared";

export interface UploadResponse {
  job_id: string;
  status: "pending";
  created_at: string;
}

export interface JobError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  failed_at?: string;
  download_url?: string;
  error?: JobError;
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function apiBase(): string {
  return import.meta.env?.VITE_API_BASE_URL ?? "";
}

export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}

async function readError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as {
      error?: { code?: ErrorCode; message?: string; retryable?: boolean };
    };
    return new ApiError(
      body.error?.code ?? "INTERNAL_ERROR",
      body.error?.message ?? "Terjadi kesalahan.",
      response.status,
      body.error?.retryable ?? false,
    );
  } catch {
    return new ApiError(
      "INTERNAL_ERROR",
      "Terjadi kesalahan.",
      response.status,
      response.status >= 500,
    );
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    throw await readError(response);
  }
  return (await response.json()) as T;
}

export async function uploadImage(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.set("image", file);
  return request<UploadResponse>("/api/jobs", {
    method: "POST",
    body: form,
  });
}

export async function getJobStatus(
  jobId: string,
  signal?: AbortSignal,
): Promise<JobStatusResponse> {
  return request<JobStatusResponse>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    signal: signal ?? null,
  });
}
