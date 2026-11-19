import { describe, expect, test } from "bun:test";
import { UnrecoverableError } from "bullmq";
import { ERROR_CODES } from "@ts-upload-image/shared";
import { ImageDecodeError, ImageDimensionsExceededError } from "../image/errors";
import { processJob, type ProcessJobDeps } from "./process-job";

function makeDeps(overrides: Partial<ProcessJobDeps> = {}): ProcessJobDeps {
  return {
    store: {
      isOwned: async () => true,
      markCompleted: async () => {},
      markFailed: async () => {},
    },
    storage: {
      putOutput: async (jobId) => ({ key: `outputs/${jobId}.webp`, bytes: 3 }),
    },
    processImage: async () => ({
      data: Buffer.from([1, 2, 3]),
      width: 1280,
      height: 640,
      format: "webp",
    }),
    ...overrides,
  };
}

const job = {
  jobId: "0193a2f4-8b12-7c90-a1b2-3c4d5e6f7a8b",
  runId: "0193a2f4-8b12-7c90-a1b2-3c4d5e6f7a8b",
  input: Buffer.from("input"),
};

describe("processJob", () => {
  test("stores the output and marks the job completed", async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      store: {
        isOwned: async () => true,
        markCompleted: async (_jobId, _runId, result) => {
          calls.push(`completed:${result.outputKey}`);
        },
        markFailed: async () => {
          calls.push("failed");
        },
      },
    });

    await processJob(job, deps);

    expect(calls).toEqual([`completed:outputs/${job.jobId}.webp`]);
  });

  test("marks a pixel-limit failure and does not retry it", async () => {
    const failures: Array<{ code: string; message: string }> = [];
    const deps = makeDeps({
      processImage: async () => {
        throw new ImageDimensionsExceededError(25_000_000);
      },
      store: {
        isOwned: async () => true,
        markCompleted: async () => {},
        markFailed: async (_jobId, _runId, error) => {
          failures.push(error);
        },
      },
    });

    await expect(processJob(job, deps)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(failures).toEqual([
      {
        code: ERROR_CODES.IMAGE_DIMENSIONS_EXCEEDED,
        message: "Image exceeds the maximum of 25000000 pixels.",
      },
    ]);
  });

  test("marks a decode failure and does not retry it", async () => {
    const failures: Array<{ code: string; message: string }> = [];
    const deps = makeDeps({
      processImage: async () => {
        throw new ImageDecodeError("The image could not be decoded.");
      },
      store: {
        isOwned: async () => true,
        markCompleted: async () => {},
        markFailed: async (_jobId, _runId, error) => {
          failures.push(error);
        },
      },
    });

    await expect(processJob(job, deps)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(failures[0]?.code).toBe(ERROR_CODES.IMAGE_DECODE_FAILED);
  });

  test("does not upload output when ownership was lost", async () => {
    let uploaded = false;
    const deps = makeDeps({
      store: {
        isOwned: async () => false,
        markCompleted: async () => {},
        markFailed: async () => {},
      },
      storage: {
        putOutput: async (jobId) => {
          uploaded = true;
          return { key: `outputs/${jobId}.webp`, bytes: 3 };
        },
      },
    });

    await processJob(job, deps);
    expect(uploaded).toBe(false);
  });

  test("lets transient errors retry", async () => {
    const deps = makeDeps({
      storage: {
        putOutput: async () => {
          throw new Error("S3 timeout");
        },
      },
    });

    await expect(processJob(job, deps)).rejects.toThrow("S3 timeout");
  });
});
