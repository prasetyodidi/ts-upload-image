import { Queue } from "bullmq";
import type { JobQueue } from "./app";
import type { SweepQueue, SweepQueueState } from "./sweeper";

export class BullJobQueue implements JobQueue, SweepQueue {
  constructor(private readonly queue: Queue) {}

  async enqueue(jobId: string): Promise<void> {
    await this.queue.add(
      "process",
      { jobId },
      {
        jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
  }

  async getState(jobId: string): Promise<SweepQueueState> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return "missing";
    }

    const state = await job.getState();
    if (
      state === "active" ||
      state === "waiting" ||
      state === "delayed" ||
      state === "completed" ||
      state === "failed" ||
      state === "unknown"
    ) {
      return state;
    }

    if (state === "waiting-children" || state === "prioritized") {
      return "waiting";
    }

    return "unknown";
  }
}
