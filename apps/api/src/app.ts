import type { NewJob, JobRecord } from "@ts-upload-image/db";
import { ERROR_CODES, type ErrorCode } from "@ts-upload-image/shared";
import type { DownloadedObject } from "@ts-upload-image/storage";
import { Hono, type Context } from "hono";
import { v7 as uuidv7 } from "uuid";
import { errorBody, isPermanentStorageMiss } from "./errors";
import { detectImageMime } from "./upload/detect-image-mime";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface JobStore {
  create(job: NewJob): Promise<void>;
  markEnqueued(jobId: string): Promise<void>;
  get(jobId: string): Promise<JobRecord | null>;
}

export interface JobQueue {
  enqueue(jobId: string): Promise<void>;
}

export interface JobStorage {
  putInput(
    jobId: string,
    data: Buffer,
    contentType: string,
  ): Promise<{ key: string; bytes: number }>;
  getOutput(key: string): Promise<DownloadedObject>;
  delete(key: string): Promise<void>;
}

export interface AppDeps {
  store: JobStore;
  queue: JobQueue;
  storage: JobStorage;
  clock?: { nowMs(): number };
  maxUploadBytes?: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const clock = deps.clock ?? { nowMs: () => Date.now() };
  const maxUploadBytes = deps.maxUploadBytes ?? MAX_UPLOAD_BYTES;

  const fail = (
    c: Context,
    status: 400 | 404 | 409 | 410 | 413 | 415 | 500 | 503,
    code: ErrorCode,
    message: string,
    retryable = false,
  ) => {
    c.header("Cache-Control", "no-store");
    c.header("Content-Type", "application/json; charset=UTF-8");
    return c.json(errorBody(code, message, retryable), status);
  };

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post("/api/jobs", async (c) => {
    const contentLength = c.req.header("content-length");
    if (contentLength) {
      const declared = Number(contentLength);
      if (Number.isFinite(declared) && declared > maxUploadBytes + 1_048_576) {
        return fail(
          c,
          413,
          ERROR_CODES.FILE_TOO_LARGE,
          "Ukuran file melebihi batas 20 MB.",
        );
      }
    }

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return fail(
        c,
        400,
        ERROR_CODES.MISSING_FILE,
        "Request harus berupa multipart/form-data dengan field image.",
      );
    }

    const file = form.get("image");
    if (!(file instanceof File)) {
      return fail(
        c,
        400,
        ERROR_CODES.MISSING_FILE,
        "Field image tidak ditemukan.",
      );
    }

    if (file.size === 0) {
      return fail(c, 400, ERROR_CODES.EMPTY_FILE, "File gambar kosong.");
    }

    if (file.size > maxUploadBytes) {
      return fail(
        c,
        413,
        ERROR_CODES.FILE_TOO_LARGE,
        "Ukuran file melebihi batas 20 MB.",
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = detectImageMime(bytes);
    if (!mime) {
      return fail(
        c,
        415,
        ERROR_CODES.UNSUPPORTED_FILE_TYPE,
        "Format file harus JPG, PNG, atau WebP.",
      );
    }

    const jobId = uuidv7();
    const createdAtMs = clock.nowMs();

    let inputKey: string;
    try {
      const stored = await deps.storage.putInput(jobId, bytes, mime);
      inputKey = stored.key;
    } catch (error) {
      console.error(`[api] failed to store input for ${jobId}`, error);
      return fail(
        c,
        503,
        ERROR_CODES.STORAGE_UNAVAILABLE,
        "Penyimpanan sedang tidak tersedia.",
        true,
      );
    }

    try {
      await deps.store.create({
        id: jobId,
        inputKey,
        inputBytes: bytes.byteLength,
        inputMime: mime,
        createdAtMs,
      });
    } catch (error) {
      console.error(`[api] failed to create job ${jobId}`, error);
      await deps.storage.delete(inputKey).catch((deleteError: unknown) => {
        console.error(`[api] failed to clean up input for ${jobId}`, deleteError);
      });
      return fail(
        c,
        503,
        ERROR_CODES.DATABASE_UNAVAILABLE,
        "Database sedang tidak tersedia.",
        true,
      );
    }

    try {
      await deps.queue.enqueue(jobId);
    } catch (error) {
      console.error(`[api] failed to enqueue job ${jobId}`, error);
    }

    try {
      await deps.store.markEnqueued(jobId);
    } catch (error) {
      console.error(`[api] failed to mark job ${jobId} as enqueued`, error);
    }

    c.header("Location", `/api/jobs/${jobId}`);
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        job_id: jobId,
        status: "pending" as const,
        created_at: iso(createdAtMs),
      },
      202,
    );
  });

  app.get("/api/jobs/:jobId", async (c) => {
    const jobId = c.req.param("jobId");
    if (!isUuid(jobId)) {
      return fail(c, 404, ERROR_CODES.JOB_NOT_FOUND, "Job tidak ditemukan.");
    }

    const job = await deps.store.get(jobId);
    if (!job) {
      return fail(c, 404, ERROR_CODES.JOB_NOT_FOUND, "Job tidak ditemukan.");
    }

    const body: Record<string, unknown> = {
      job_id: job.id,
      status: job.status,
      created_at: iso(job.createdAtMs),
      updated_at: iso(job.updatedAtMs),
    };

    if (job.status === "completed") {
      body.completed_at =
        job.completedAtMs === null ? null : iso(job.completedAtMs);
      body.download_url = `/api/jobs/${job.id}/download`;
    }

    if (job.status === "failed") {
      body.failed_at = job.failedAtMs === null ? null : iso(job.failedAtMs);
      body.error = {
        code: (job.errorCode ?? ERROR_CODES.INTERNAL_ERROR) as ErrorCode,
        message: job.errorMessage ?? "Pemrosesan gambar gagal.",
        retryable: false,
      };
    }

    c.header("Cache-Control", "no-store");
    return c.json(body, 200);
  });

  app.get("/api/jobs/:jobId/download", async (c) => {
    const jobId = c.req.param("jobId");
    if (!isUuid(jobId)) {
      return fail(c, 404, ERROR_CODES.JOB_NOT_FOUND, "Job tidak ditemukan.");
    }

    const job = await deps.store.get(jobId);
    if (!job) {
      return fail(c, 404, ERROR_CODES.JOB_NOT_FOUND, "Job tidak ditemukan.");
    }

    if (job.status === "pending" || job.status === "processing") {
      c.header("Retry-After", "1");
      return fail(
        c,
        409,
        ERROR_CODES.JOB_NOT_READY,
        "Job belum selesai diproses.",
        true,
      );
    }

    if (job.status === "failed") {
      return fail(
        c,
        410,
        ERROR_CODES.JOB_FAILED,
        "Job gagal; hasil tidak tersedia.",
      );
    }

    if (!job.outputKey) {
      return fail(
        c,
        410,
        ERROR_CODES.OUTPUT_UNAVAILABLE,
        "Hasil tidak tersedia.",
      );
    }

    let output: DownloadedObject;
    try {
      output = await deps.storage.getOutput(job.outputKey);
    } catch (error) {
      if (isPermanentStorageMiss(error)) {
        return fail(
          c,
          410,
          ERROR_CODES.OUTPUT_UNAVAILABLE,
          "Hasil tidak tersedia.",
        );
      }
      console.error(`[api] failed to read output for ${jobId}`, error);
      return fail(
        c,
        503,
        ERROR_CODES.STORAGE_UNAVAILABLE,
        "Penyimpanan sedang tidak tersedia.",
        true,
      );
    }

    const headers = new Headers({
      "Content-Type": "image/webp",
      "Content-Disposition": `attachment; filename="${job.id}.webp"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (output.contentLength !== undefined) {
      headers.set("Content-Length", String(output.contentLength));
    }

    return new Response(output.body, { status: 200, headers });
  });

  app.onError((error, c) => {
    console.error("[api] unhandled error", error);
    c.header("Cache-Control", "no-store");
    return c.json(
      errorBody(
        ERROR_CODES.INTERNAL_ERROR,
        "Terjadi kesalahan internal.",
        false,
      ),
      500,
    );
  });

  return app;
}
