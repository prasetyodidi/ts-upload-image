import { ERROR_CODES } from "@ts-upload-image/shared";

export type SweepQueueState =
  | "active"
  | "waiting"
  | "delayed"
  | "completed"
  | "failed"
  | "missing"
  | "unknown";

export interface SweepQueue {
  getState(jobId: string): Promise<SweepQueueState>;
  enqueue(jobId: string): Promise<void>;
}

export interface SweepStorage {
  headOutput(jobId: string): Promise<{ exists: boolean; bytes?: number }>;
  deleteOutput(jobId: string): Promise<void>;
}

export interface SweepRepository {
  findPendingBefore(cutoffMs: number, limit: number): Promise<string[]>;
  findExpiredProcessing(nowMs: number, limit: number): Promise<string[]>;
  findFailedForCleanup(cutoffMs: number, limit: number): Promise<string[]>;
  resetToPending(jobId: string, nowMs: number): Promise<boolean>;
  markProcessingCompleted(
    jobId: string,
    outputKey: string,
    outputBytes: number,
    nowMs: number,
  ): Promise<boolean>;
  markProcessingFailed(
    jobId: string,
    errorCode: string,
    errorMessage: string,
    nowMs: number,
  ): Promise<boolean>;
  markPendingCompleted(
    jobId: string,
    outputKey: string,
    outputBytes: number,
    nowMs: number,
  ): Promise<boolean>;
  markPendingFailed(
    jobId: string,
    errorCode: string,
    errorMessage: string,
    nowMs: number,
  ): Promise<boolean>;
  clearFailedOutput(jobId: string, nowMs: number): Promise<void>;
  withSweepLock<T>(fn: () => Promise<T>): Promise<T | null>;
}

export interface SweeperOptions {
  intervalMs?: number;
  pendingGraceMs?: number;
  cleanupWindowMs?: number;
  batchSize?: number;
}

export class Sweeper {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;

  private readonly intervalMs: number;
  private readonly pendingGraceMs: number;
  private readonly cleanupWindowMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly repository: SweepRepository,
    private readonly queue: SweepQueue,
    private readonly storage: SweepStorage,
    private readonly clock: { nowMs(): number } = { nowMs: () => Date.now() },
    options: SweeperOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 10_000;
    this.pendingGraceMs = options.pendingGraceMs ?? 30_000;
    this.cleanupWindowMs = options.cleanupWindowMs ?? 24 * 60 * 60 * 1000;
    this.batchSize = options.batchSize ?? 50;
  }

  start(): void {
    if (this.running || this.timer) {
      return;
    }
    this.stopped = false;
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    await this.repository.withSweepLock(async () => {
      const nowMs = this.clock.nowMs();
      await this.reconcilePending(nowMs);
      await this.reconcileProcessing(nowMs);
      await this.cleanupFailed(nowMs);
    });
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }

    try {
      await this.runOnce();
    } catch (error) {
      console.error("[sweeper] sweep failed", error);
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.tick();
        }, this.intervalMs);
        this.timer.unref?.();
      }
    }
  }

  private async reconcilePending(nowMs: number): Promise<void> {
    const cutoffMs = nowMs - this.pendingGraceMs;
    const jobIds = await this.repository.findPendingBefore(
      cutoffMs,
      this.batchSize,
    );

    for (const jobId of jobIds) {
      try {
        const state = await this.queue.getState(jobId);

        if (state === "missing") {
          await this.queue.enqueue(jobId);
          continue;
        }

        if (
          state === "active" ||
          state === "waiting" ||
          state === "delayed" ||
          state === "unknown"
        ) {
          continue;
        }

        const artifact = await this.storage.headOutput(jobId);
        if (artifact.exists) {
          await this.repository.markPendingCompleted(
            jobId,
            `outputs/${jobId}.webp`,
            artifact.bytes ?? 0,
            nowMs,
          );
          continue;
        }

        const code =
          state === "completed"
            ? ERROR_CODES.OUTPUT_UNAVAILABLE
            : ERROR_CODES.JOB_INTERRUPTED;
        const message =
          state === "completed"
            ? "Queue selesai tetapi artefak hasil tidak ditemukan."
            : "Job terhenti sebelum diproses.";
        await this.repository.markPendingFailed(jobId, code, message, nowMs);
      } catch (error) {
        console.error(`[sweeper] pending reconciliation failed for ${jobId}`, error);
      }
    }
  }

  private async reconcileProcessing(nowMs: number): Promise<void> {
    const jobIds = await this.repository.findExpiredProcessing(
      nowMs,
      this.batchSize,
    );

    for (const jobId of jobIds) {
      try {
        const state = await this.queue.getState(jobId);
        if (state === "active" || state === "unknown") {
          continue;
        }

        const artifact = await this.storage.headOutput(jobId);
        if (artifact.exists) {
          await this.repository.markProcessingCompleted(
            jobId,
            `outputs/${jobId}.webp`,
            artifact.bytes ?? 0,
            nowMs,
          );
          continue;
        }

        if (state === "waiting" || state === "delayed") {
          await this.repository.resetToPending(jobId, nowMs);
          continue;
        }

        const code =
          state === "completed"
            ? ERROR_CODES.OUTPUT_UNAVAILABLE
            : ERROR_CODES.JOB_INTERRUPTED;
        const message =
          state === "completed"
            ? "Queue selesai tetapi artefak hasil tidak ditemukan."
            : "Pemrosesan terhenti sebelum selesai.";
        await this.repository.markProcessingFailed(jobId, code, message, nowMs);
      } catch (error) {
        console.error(
          `[sweeper] processing reconciliation failed for ${jobId}`,
          error,
        );
      }
    }
  }

  private async cleanupFailed(nowMs: number): Promise<void> {
    const cutoffMs = nowMs - this.cleanupWindowMs;
    const jobIds = await this.repository.findFailedForCleanup(
      cutoffMs,
      this.batchSize,
    );

    for (const jobId of jobIds) {
      try {
        await this.storage.deleteOutput(jobId);
        await this.repository.clearFailedOutput(jobId, nowMs);
      } catch (error) {
        console.error(`[sweeper] failed cleanup failed for ${jobId}`, error);
      }
    }
  }
}
