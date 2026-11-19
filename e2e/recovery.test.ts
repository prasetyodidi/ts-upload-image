import { afterAll, beforeAll, expect, test } from "bun:test";
import { dirname } from "node:path";
import {
  API_BASE,
  cleanupAll,
  closeSupport,
  getJob,
  makeJpeg,
  rememberJob,
  upload,
  waitForTerminal,
} from "./support";

const repoRoot = dirname(import.meta.dir);
const enabled = process.env.E2E_RECOVERY === "1";
const recoveryTest = enabled ? test : test.skip;

async function compose(args: string[]): Promise<void> {
  const process = Bun.spawn(["docker", "compose", ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await process.exited;
  if (code !== 0) {
    const stderr = await new Response(process.stderr).text();
    throw new Error(`docker compose ${args.join(" ")} failed: ${stderr}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  await compose(["start", "worker"]);
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
  await compose(["start", "worker"]).catch(() => {});
  await cleanupAll();
  await closeSupport();
});

recoveryTest(
  "recovers a job after the worker is killed mid-process",
  async () => {
    const input = await makeJpeg(5_000, 4_999);
    const response = await upload(input, "recovery.jpg", "image/jpeg");
    expect(response.status).toBe(202);

    const job = await rememberJob(response);
    let sawProcessing = false;
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
      const status = await getJob(job.job_id);
      if (status.status === "processing") {
        sawProcessing = true;
        break;
      }
      if (status.status === "completed" || status.status === "failed") {
        throw new Error(
          `Worker reached ${status.status} before the kill; use a larger fixture`,
        );
      }
      await sleep(25);
    }

    if (!sawProcessing) {
      throw new Error("Never observed processing state before the kill");
    }

    await compose(["kill", "worker"]);

    await sleep(35_000);
    await compose(["start", "worker"]);

    const terminal = await waitForTerminal(job.job_id, 180_000);
    expect(terminal.status).toBe("completed");

    const download = await fetch(
      `${API_BASE}/api/jobs/${job.job_id}/download`,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/webp");
  },
  240_000,
);
