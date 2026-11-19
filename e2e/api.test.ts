import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { S3ObjectStorage } from "@ts-upload-image/storage";
import postgres from "postgres";
import sharp from "sharp";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:8080";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const createdJobIds = new Set<string>();

const sql = postgres(databaseUrl(), { max: 2 });
const storage = new S3ObjectStorage({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "auto",
  bucket: required("S3_BUCKET"),
  accessKeyId: required("S3_ACCESS_KEY_ID"),
  secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Run the tests with the same .env as the stack.`);
  }
  return value;
}

function databaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const user = encodeURIComponent(process.env.POSTGRES_USER ?? "app");
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "app");
  const database = encodeURIComponent(process.env.POSTGRES_DB ?? "app");
  return `postgres://${user}:${password}@localhost:5432/${database}?sslmode=disable`;
}

interface JobBody {
  job_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  completed_at?: string;
  failed_at?: string;
  download_url?: string;
  error?: { code: string; message: string; retryable: boolean };
}

async function upload(
  data: Uint8Array,
  filename: string,
  type: string,
): Promise<Response> {
  const form = new FormData();
  const bytes = new Uint8Array(data);
  form.set("image", new File([bytes], filename, { type }));
  return fetch(`${API_BASE}/api/jobs`, { method: "POST", body: form });
}

async function waitForTerminal(jobId: string): Promise<JobBody> {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Status request failed for ${jobId}: ${response.status}`);
    }

    const body = (await response.json()) as JobBody;
    if (body.status === "completed" || body.status === "failed") {
      return body;
    }

    await Bun.sleep(500);
  }

  throw new Error(`Timed out waiting for ${jobId}`);
}

async function rememberJob(response: Response): Promise<JobBody> {
  const body = (await response.json()) as JobBody;
  createdJobIds.add(body.job_id);
  return body;
}

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 42, g: 110, b: 150 },
    },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

beforeAll(async () => {
  const response = await fetch(`${API_BASE}/health`).catch((error: unknown) => {
    throw new Error(
      `Cannot reach ${API_BASE}. Start the stack with "docker compose up -d".`,
      { cause: error },
    );
  });

  if (!response.ok) {
    throw new Error(`Health check failed with ${response.status}`);
  }
});

afterAll(async () => {
  for (const jobId of createdJobIds) {
    await storage.delete(`inputs/${jobId}`).catch(() => {});
    await storage.deleteOutput(jobId).catch(() => {});
    await sql`DELETE FROM jobs WHERE id = ${jobId}`.catch(() => {});
  }

  await sql.end({ timeout: 5 });
});

describe("upload and processing", () => {
  test(
    "resizes a JPEG to WebP and makes it downloadable",
    async () => {
      const input = await makeJpeg(2_000, 1_000);
      const response = await upload(input, "input.jpg", "image/jpeg");

      expect(response.status).toBe(202);
      const job = await rememberJob(response);
      expect(job.status).toBe("pending");
      expect(response.headers.get("Location")).toBe(`/api/jobs/${job.job_id}`);

      const terminal = await waitForTerminal(job.job_id);
      expect(terminal.status).toBe("completed");
      expect(terminal.download_url).toBe(`/api/jobs/${job.job_id}/download`);

      const download = await fetch(`${API_BASE}${terminal.download_url}`);
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toBe("image/webp");

      const output = Buffer.from(await download.arrayBuffer());
      const metadata = await sharp(output).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(1280);
      expect(metadata.height).toBe(640);
    },
    120_000,
  );

  test(
    "rejects an image above 25 MP with a permanent failure",
    async () => {
      const input = await makeJpeg(5_001, 5_000);
      const response = await upload(input, "too-large.jpg", "image/jpeg");

      expect(response.status).toBe(202);
      const job = await rememberJob(response);
      const terminal = await waitForTerminal(job.job_id);

      expect(terminal.status).toBe("failed");
      expect(terminal.error?.code).toBe("IMAGE_DIMENSIONS_EXCEEDED");
      expect(terminal.error?.retryable).toBe(false);

      const download = await fetch(`${API_BASE}/api/jobs/${job.job_id}/download`);
      expect(download.status).toBe(410);
    },
    120_000,
  );
});

describe("validation", () => {
  test("returns 400 when the image field is missing", async () => {
    const response = await fetch(`${API_BASE}/api/jobs`, {
      method: "POST",
      body: new FormData(),
    });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("MISSING_FILE");
  });

  test("returns 413 above 20 MB", async () => {
    const input = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    input[0] = 0x89;
    input[1] = 0x50;
    input[2] = 0x4e;
    input[3] = 0x47;
    const response = await upload(input, "too-big.png", "image/png");
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(413);
    expect(body.error.code).toBe("FILE_TOO_LARGE");
  });

  test("returns 415 for a spoofed image type", async () => {
    const response = await upload(
      Buffer.from("not an image"),
      "fake.png",
      "image/png",
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(415);
    expect(body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  test("returns 404 for an unknown job", async () => {
    const response = await fetch(
      `${API_BASE}/api/jobs/0193a2f4-8b12-7c90-a1b2-3c4d5e6f7a8b`,
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("JOB_NOT_FOUND");
  });
});
