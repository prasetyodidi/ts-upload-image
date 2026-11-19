import type { CompletedJobResult, JobFailure } from "@ts-upload-image/db";
import type { ErrorCode } from "@ts-upload-image/shared";
import { UnrecoverableError } from "bullmq";
import type { ProcessedImage } from "../image/process-image";
import { processImage } from "../image/process-image";
import { ImageProcessingError } from "../image/errors";

export interface JobStateStore {
  isOwned(jobId: string, runId: string): Promise<boolean>;
  markCompleted(
    jobId: string,
    runId: string,
    result: CompletedJobResult,
  ): Promise<void>;
  markFailed(jobId: string, runId: string, failure: JobFailure): Promise<void>;
}

export interface ObjectStoragePort {
  putOutput(jobId: string, data: Buffer): Promise<{ key: string; bytes: number }>;
}

export interface ProcessJobDeps {
  store: JobStateStore;
  storage: ObjectStoragePort;
  processImage?: (
    input: Buffer,
    options?: { maxPixels?: number },
  ) => Promise<ProcessedImage>;
}

export interface ProcessJobData {
  jobId: string;
  runId: string;
  input: Buffer;
}

export async function processJob(
  job: ProcessJobData,
  deps: ProcessJobDeps,
): Promise<void> {
  try {
    const processed = await (deps.processImage ?? processImage)(job.input);
    if (!(await deps.store.isOwned(job.jobId, job.runId))) {
      return;
    }
    const stored = await deps.storage.putOutput(job.jobId, processed.data);

    await deps.store.markCompleted(job.jobId, job.runId, {
      outputKey: stored.key,
      bytes: stored.bytes,
      width: processed.width,
      height: processed.height,
    });
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      await deps.store.markFailed(job.jobId, job.runId, {
        code: error.code,
        message: error.message,
      });
      throw new UnrecoverableError(error.message);
    }

    throw error;
  }
}
