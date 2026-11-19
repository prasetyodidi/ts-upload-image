import { JobRepository } from "@ts-upload-image/db";
import { S3ObjectStorage } from "@ts-upload-image/storage";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { BullJobQueue } from "./queue";
import { Sweeper } from "./sweeper";

const config = loadConfig();

const repository = JobRepository.connect(config.databaseUrl);
const storage = new S3ObjectStorage(config.s3);
const redis = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});
const queue = new Queue(config.queueName, { connection: redis });
const jobQueue = new BullJobQueue(queue);

const app = createApp({
  store: repository,
  queue: jobQueue,
  storage,
});

const sweeper = new Sweeper(repository, jobQueue, storage);
sweeper.start();

const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: 25 * 1024 * 1024,
  fetch: app.fetch,
});

console.log(`[api] listening on http://localhost:${server.port}`);

async function shutdown(signal: string): Promise<void> {
  console.log(`[api] received ${signal}, shutting down`);
  sweeper.stop();
  server.stop();
  await queue.close();
  await redis.quit();
  await repository.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
