import { describe, expect, test } from "bun:test";
import { ApiError, type JobStatusResponse } from "./api";
import { pollJobStatus } from "./poll";

function job(status: JobStatusResponse["status"]): JobStatusResponse {
  return {
    job_id: "job-1",
    status,
    created_at: "2026-11-19T09:30:00.000Z",
    updated_at: "2026-11-19T09:30:00.000Z",
  };
}

describe("pollJobStatus", () => {
  test("backs off until completed", async () => {
    const statuses = [job("pending"), job("processing"), job("completed")];
    const sleeps: number[] = [];
    const updates: string[] = [];
    let index = 0;

    const result = await pollJobStatus({
      fetchStatus: async () => statuses[index++]!,
      onUpdate: (next) => updates.push(next.status),
      signal: new AbortController().signal,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.status).toBe("completed");
    expect(updates).toEqual(["pending", "processing", "completed"]);
    expect(sleeps).toEqual([500, 1000]);
  });

  test("stops on failed without another sleep", async () => {
    const sleeps: number[] = [];
    const result = await pollJobStatus({
      fetchStatus: async () => job("failed"),
      signal: new AbortController().signal,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.status).toBe("failed");
    expect(sleeps).toEqual([]);
  });

  test("retries retryable errors with the same backoff", async () => {
    let attempt = 0;
    const sleeps: number[] = [];
    const result = await pollJobStatus({
      fetchStatus: async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new ApiError("STORAGE_UNAVAILABLE", "try again", 503, true);
        }
        return job("completed");
      },
      signal: new AbortController().signal,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.status).toBe("completed");
    expect(sleeps).toEqual([500]);
  });

  test("does not retry a permanent error", async () => {
    await expect(
      pollJobStatus({
        fetchStatus: async () => {
          throw new ApiError("JOB_NOT_FOUND", "missing", 404, false);
        },
        signal: new AbortController().signal,
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  test("stops when aborted during sleep", async () => {
    const controller = new AbortController();
    await expect(
      pollJobStatus({
        fetchStatus: async () => job("pending"),
        signal: controller.signal,
        sleep: async (_ms, signal) => {
          controller.abort();
          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
        },
      }),
    ).rejects.toHaveProperty("name", "AbortError");
  });
});
