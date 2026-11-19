import type { JobStatusResponse } from "./api";
import { ApiError } from "./api";

export interface PollOptions {
  fetchStatus: (signal: AbortSignal) => Promise<JobStatusResponse>;
  onUpdate?: (job: JobStatusResponse) => void;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollJobStatus(options: PollOptions): Promise<JobStatusResponse> {
  const {
    fetchStatus,
    onUpdate,
    signal,
    sleep = defaultSleep,
    baseDelayMs = 500,
    maxDelayMs = 5_000,
  } = options;

  let delay = baseDelayMs;

  for (;;) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      const job = await fetchStatus(signal);
      onUpdate?.(job);

      if (job.status === "completed" || job.status === "failed") {
        return job;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (error instanceof ApiError && !error.retryable) {
        throw error;
      }
    }

    await sleep(delay, signal);
    delay = Math.min(delay * 2, maxDelayMs);
  }
}
