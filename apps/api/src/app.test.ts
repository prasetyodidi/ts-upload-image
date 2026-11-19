import { describe, expect, test } from "bun:test";
import type { JobRecord, NewJob } from "@ts-upload-image/db";
import { ERROR_CODES } from "@ts-upload-image/shared";
import type { DownloadedObject } from "@ts-upload-image/storage";
import { createApp, type AppDeps, type JobStorage } from "./app";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=",
  "base64",
);

function makeStorage(overrides: Partial<JobStorage> = {}): JobStorage {
  return {
    putInput: async (jobId, data) => ({
      key: `inputs/${jobId}`,
      bytes: data.byteLength,
    }),
    getOutput: async (): Promise<DownloadedObject> => ({
      body: new Blob([Buffer.from("webp")]).stream() as ReadableStream,
      contentLength: 4,
      contentType: "image/webp",
    }),
    delete: async () => {},
    ...overrides,
  };
}

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "0193a2f4-8b12-7c90-a1b2-3c4d5e6f7a8b",
    status: "pending",
    createdAtMs: Date.UTC(2026, 10, 19, 9, 30, 0),
    updatedAtMs: Date.UTC(2026, 10, 19, 9, 30, 0),
    startedAtMs: null,
    completedAtMs: null,
    failedAtMs: null,
    inputKey: "inputs/job",
    inputBytes: PNG.byteLength,
    inputMime: "image/png",
    outputKey: null,
    outputBytes: null,
    outputWidth: null,
    outputHeight: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    store: {
      create: async () => {},
      markEnqueued: async () => {},
      get: async () => null,
    },
    queue: {
      enqueue: async () => {},
    },
    storage: makeStorage(),
    clock: { nowMs: () => Date.UTC(2026, 10, 19, 9, 30, 0) },
    ...overrides,
  };
}

function uploadForm(): FormData {
  const form = new FormData();
  form.set("image", new File([PNG], "test.png", { type: "image/png" }));
  return form;
}

describe("POST /api/jobs", () => {
  test("accepts a valid PNG, stores it, creates the job, and enqueues it", async () => {
    const created: NewJob[] = [];
    let enqueued = "";
    const deps = makeDeps({
      store: {
        create: async (job) => {
          created.push(job);
        },
        markEnqueued: async () => {},
        get: async () => null,
      },
      queue: {
        enqueue: async (jobId) => {
          enqueued = jobId;
        },
      },
    });
    const app = createApp(deps);

    const response = await app.request("/api/jobs", {
      method: "POST",
      body: uploadForm(),
    });
    const body = (await response.json()) as {
      job_id: string;
      status: string;
      created_at: string;
    };

    expect(response.status).toBe(202);
    expect(response.headers.get("Location")).toBe(`/api/jobs/${body.job_id}`);
    expect(body.status).toBe("pending");
    expect(body.created_at).toBe("2026-11-19T09:30:00.000Z");
    expect(created[0]?.inputMime).toBe("image/png");
    expect(created[0]?.inputBytes).toBe(PNG.byteLength);
    expect(enqueued).toBe(body.job_id);
  });

  test("rejects a missing file field", async () => {
    const app = createApp(makeDeps());
    const response = await app.request("/api/jobs", {
      method: "POST",
      body: new FormData(),
    });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe(ERROR_CODES.MISSING_FILE);
  });

  test("rejects an empty file", async () => {
    const form = new FormData();
    form.set("image", new File([], "empty.png", { type: "image/png" }));
    const app = createApp(makeDeps());
    const response = await app.request("/api/jobs", {
      method: "POST",
      body: form,
    });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe(ERROR_CODES.EMPTY_FILE);
  });

  test("rejects a file above the configured byte limit", async () => {
    const app = createApp(makeDeps({ maxUploadBytes: 10 }));
    const response = await app.request("/api/jobs", {
      method: "POST",
      body: uploadForm(),
    });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(413);
    expect(body.error.code).toBe(ERROR_CODES.FILE_TOO_LARGE);
  });

  test("rejects spoofed MIME with an unsupported magic-byte payload", async () => {
    const form = new FormData();
    form.set(
      "image",
      new File([Buffer.from("not an image")], "fake.png", { type: "image/png" }),
    );
    const app = createApp(makeDeps());
    const response = await app.request("/api/jobs", {
      method: "POST",
      body: form,
    });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(415);
    expect(body.error.code).toBe(ERROR_CODES.UNSUPPORTED_FILE_TYPE);
  });

  test("returns 202 when queue publish fails, because the DB record is durable", async () => {
    const app = createApp(
      makeDeps({
        queue: {
          enqueue: async () => {
            throw new Error("Redis unavailable");
          },
        },
      }),
    );

    const response = await app.request("/api/jobs", {
      method: "POST",
      body: uploadForm(),
    });

    expect(response.status).toBe(202);
  });

  test("cleans up storage and returns 503 when the DB insert fails", async () => {
    let deleted = "";
    const app = createApp(
      makeDeps({
        store: {
          create: async () => {
            throw new Error("Postgres down");
          },
          markEnqueued: async () => {},
          get: async () => null,
        },
        storage: makeStorage({
          delete: async (key) => {
            deleted = key;
          },
        }),
      }),
    );

    const response = await app.request("/api/jobs", {
      method: "POST",
      body: uploadForm(),
    });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(503);
    expect(body.error.code).toBe(ERROR_CODES.DATABASE_UNAVAILABLE);
    expect(deleted).toStartWith("inputs/");
  });
});

describe("GET /api/jobs/:jobId", () => {
  const jobId = "0193a2f4-8b12-7c90-a1b2-3c4d5e6f7a8b";

  test("returns 200 with completed download URL", async () => {
    const app = createApp(
      makeDeps({
        store: {
          create: async () => {},
          markEnqueued: async () => {},
          get: async () =>
            makeJob({
              status: "completed",
              completedAtMs: Date.UTC(2026, 10, 19, 9, 30, 5),
              outputKey: `outputs/${jobId}.webp`,
            }),
        },
      }),
    );

    const response = await app.request(`/api/jobs/${jobId}`);
    const body = (await response.json()) as {
      status: string;
      download_url: string;
      completed_at: string;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("completed");
    expect(body.download_url).toBe(`/api/jobs/${jobId}/download`);
    expect(body.completed_at).toBe("2026-11-19T09:30:05.000Z");
  });

  test("returns 200 with a domain error when failed", async () => {
    const app = createApp(
      makeDeps({
        store: {
          create: async () => {},
          markEnqueued: async () => {},
          get: async () =>
            makeJob({
              status: "failed",
              failedAtMs: Date.UTC(2026, 10, 19, 9, 30, 4),
              errorCode: ERROR_CODES.IMAGE_DIMENSIONS_EXCEEDED,
              errorMessage: "Image exceeds the maximum of 25000000 pixels.",
            }),
        },
      }),
    );

    const response = await app.request(`/api/jobs/${jobId}`);
    const body = (await response.json()) as {
      status: string;
      error: { code: string; retryable: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("failed");
    expect(body.error.code).toBe(ERROR_CODES.IMAGE_DIMENSIONS_EXCEEDED);
    expect(body.error.retryable).toBe(false);
  });

  test("returns 404 for an invalid or unknown job id", async () => {
    const app = createApp(makeDeps());
    const response = await app.request("/api/jobs/not-a-uuid");
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe(ERROR_CODES.JOB_NOT_FOUND);
  });
});

describe("GET /api/jobs/:jobId/download", () => {
  const jobId = "0193a2f4-8b12-7c90-a1b2-3c4d5e6f7a8b";

  test("returns 409 with Retry-After while the job is not ready", async () => {
    const app = createApp(
      makeDeps({
        store: {
          create: async () => {},
          markEnqueued: async () => {},
          get: async () => makeJob({ status: "processing" }),
        },
      }),
    );

    const response = await app.request(`/api/jobs/${jobId}/download`);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(body.error.code).toBe(ERROR_CODES.JOB_NOT_READY);
  });

  test("returns 410 for a failed job", async () => {
    const app = createApp(
      makeDeps({
        store: {
          create: async () => {},
          markEnqueued: async () => {},
          get: async () =>
            makeJob({
              status: "failed",
              errorCode: ERROR_CODES.IMAGE_DECODE_FAILED,
            }),
        },
      }),
    );

    const response = await app.request(`/api/jobs/${jobId}/download`);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(410);
    expect(body.error.code).toBe(ERROR_CODES.JOB_FAILED);
  });

  test("streams the WebP with download headers", async () => {
    const app = createApp(
      makeDeps({
        store: {
          create: async () => {},
          markEnqueued: async () => {},
          get: async () =>
            makeJob({
              status: "completed",
              outputKey: `outputs/${jobId}.webp`,
            }),
        },
      }),
    );

    const response = await app.request(`/api/jobs/${jobId}/download`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Content-Disposition")).toContain(jobId);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("webp");
  });

  test("returns 410 when the object is permanently missing", async () => {
    const error = Object.assign(new Error("missing"), { name: "NoSuchKey" });
    const app = createApp(
      makeDeps({
        store: {
          create: async () => {},
          markEnqueued: async () => {},
          get: async () =>
            makeJob({
              status: "completed",
              outputKey: `outputs/${jobId}.webp`,
            }),
        },
        storage: makeStorage({
          getOutput: async () => {
            throw error;
          },
        }),
      }),
    );

    const response = await app.request(`/api/jobs/${jobId}/download`);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(410);
    expect(body.error.code).toBe(ERROR_CODES.OUTPUT_UNAVAILABLE);
  });
});
