import { randomUUID } from "node:crypto";
import { JobRepository } from "@ts-upload-image/db";
import { S3ObjectStorage } from "@ts-upload-image/storage";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { loadConfig } from "./config";
import { processJob } from "./queue/process-job";

const config = loadConfig();
const clock = { nowMs: () => Date.now() };

const repository = JobRepository.connect(config.databaseUrl, clock);
const storage = new S3ObjectStorage(config.s3);

const redis = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

const worker = new Worker<{ jobId: string }>(
  config.queueName,
  async (job) => {
    const jobId = job.data?.jobId;
    if (typeof jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(jobId)) {
      throw new Error(`Invalid job payload: ${JSON.stringify(job.data)}`);
    }

    const runId = randomUUID();
    const nowMs = clock.nowMs();
    const claim = await repository.claim(
      jobId,
      runId,
      nowMs,
      config.leaseMs,
    );

    if (!claim) {
      const status = await repository.getStatus(jobId);
      if (status === "completed" || status === "failed" || status === "not_found") {
        return;
      }
      throw new Error(`Job ${jobId} is still owned by another worker`);
    }

    const heartbeat = setInterval(() => {
      void repository
        .heartbeat(jobId, runId, clock.nowMs(), config.leaseMs)
        .then((owned) => {
          if (!owned) {
            console.warn(`[worker] lost ownership of job ${jobId}`);
          }
        })
        .catch((error: unknown) => {
          console.error(`[worker] heartbeat failed for job ${jobId}`, error);
        });
    }, config.heartbeatMs);
    heartbeat.unref?.();

    try {
      const input = await storage.getInput(claim.inputKey);
      await processJob(
        { jobId, runId, input },
        { store: repository, storage },
      );
    } finally {
      clearInterval(heartbeat);
    }
  },
  {
    connection: redis,
    concurrency: 1,
    lockDuration: 30_000,
    maxStalledCount: 1,
  },
);

worker.on("completed", (job) => {
  console.log(`[worker] completed ${job.id}`);
});

worker.on("failed", (job, error) => {
  console.error(`[worker] failed ${job?.id ?? "unknown"}: ${error.message}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] received ${signal}, shutting down`);
  await worker.close();
  await redis.quit();
  await repository.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log(
  `[worker] listening on queue "${config.queueName}" with concurrency 1`,
);
