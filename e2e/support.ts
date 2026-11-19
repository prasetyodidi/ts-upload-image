import { S3ObjectStorage } from "@ts-upload-image/storage";
import postgres from "postgres";
import sharp from "sharp";

export const API_BASE = process.env.API_BASE_URL ?? "http://localhost:8080";

export interface JobBody {
  job_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  completed_at?: string;
  failed_at?: string;
  download_url?: string;
  error?: { code: string; message: string; retryable: boolean };
}

export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Run from the repository root with .env loaded.`);
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

export const sql = postgres(databaseUrl(), { max: 2 });
export const storage = new S3ObjectStorage({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "auto",
  bucket: required("S3_BUCKET"),
  accessKeyId: required("S3_ACCESS_KEY_ID"),
  secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

export const createdJobIds = new Set<string>();

export async function upload(
  data: Uint8Array,
  filename: string,
  type: string,
): Promise<Response> {
  const form = new FormData();
  form.set("image", new File([new Uint8Array(data)], filename, { type }));
  return fetch(`${API_BASE}/api/jobs`, { method: "POST", body: form });
}

export async function getJob(jobId: string): Promise<JobBody> {
  const response = await fetch(`${API_BASE}/api/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`Status request failed for ${jobId}: ${response.status}`);
  }
  return (await response.json()) as JobBody;
}

export async function waitForTerminal(
  jobId: string,
  timeoutMs = 90_000,
): Promise<JobBody> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const body = await getJob(jobId);
    if (body.status === "completed" || body.status === "failed") {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${jobId}`);
}

export async function rememberJob(response: Response): Promise<JobBody> {
  const body = (await response.json()) as JobBody;
  createdJobIds.add(body.job_id);
  return body;
}

export async function makeJpeg(width: number, height: number): Promise<Buffer> {
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

export async function cleanupJob(jobId: string): Promise<void> {
  await storage.delete(`inputs/${jobId}`).catch(() => {});
  await storage.deleteOutput(jobId).catch(() => {});
  await sql`DELETE FROM jobs WHERE id = ${jobId}`.catch(() => {});
}

export async function cleanupAll(): Promise<void> {
  for (const jobId of createdJobIds) {
    await cleanupJob(jobId);
  }
  createdJobIds.clear();
}

export async function closeSupport(): Promise<void> {
  await sql.end({ timeout: 5 });
}
