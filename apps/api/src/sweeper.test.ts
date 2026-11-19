import { describe, expect, test } from "bun:test";
import { ERROR_CODES } from "@ts-upload-image/shared";
import {
  Sweeper,
  type SweepQueue,
  type SweepQueueState,
  type SweepRepository,
  type SweepStorage,
} from "./sweeper";

interface SweepCalls {
  enqueued: string[];
  reset: string[];
  processingCompleted: string[];
  processingFailed: Array<{ id: string; code: string }>;
  pendingCompleted: string[];
  pendingFailed: Array<{ id: string; code: string }>;
  deleted: string[];
  cleared: string[];
}

function makeHarness(options: {
  pending?: string[];
  processing?: string[];
  failed?: string[];
  states?: Record<string, SweepQueueState>;
  artifacts?: Set<string>;
  locked?: boolean;
} = {}) {
  const calls: SweepCalls = {
    enqueued: [],
    reset: [],
    processingCompleted: [],
    processingFailed: [],
    pendingCompleted: [],
    pendingFailed: [],
    deleted: [],
    cleared: [],
  };

  const states = options.states ?? {};
  const artifacts = options.artifacts ?? new Set<string>();

  const repository: SweepRepository = {
    findPendingBefore: async () => options.pending ?? [],
    findExpiredProcessing: async () => options.processing ?? [],
    findFailedForCleanup: async () => options.failed ?? [],
    resetToPending: async (id) => {
      calls.reset.push(id);
      return true;
    },
    markProcessingCompleted: async (id) => {
      calls.processingCompleted.push(id);
      return true;
    },
    markProcessingFailed: async (id, code) => {
      calls.processingFailed.push({ id, code });
      return true;
    },
    markPendingCompleted: async (id) => {
      calls.pendingCompleted.push(id);
      return true;
    },
    markPendingFailed: async (id, code) => {
      calls.pendingFailed.push({ id, code });
      return true;
    },
    clearFailedOutput: async (id) => {
      calls.cleared.push(id);
    },
    withSweepLock: async (fn) => {
      if (options.locked === false) {
        return null;
      }
      return fn();
    },
  };

  const queue: SweepQueue = {
    getState: async (id) => states[id] ?? "missing",
    enqueue: async (id) => {
      calls.enqueued.push(id);
    },
  };

  const storage: SweepStorage = {
    headOutput: async (id) =>
      artifacts.has(id)
        ? { exists: true, bytes: 123 }
        : { exists: false },
    deleteOutput: async (id) => {
      calls.deleted.push(id);
    },
  };

  const sweeper = new Sweeper(
    repository,
    queue,
    storage,
    { nowMs: () => 1_000_000 },
    { pendingGraceMs: 10_000, cleanupWindowMs: 60_000 },
  );

  return { sweeper, calls };
}

describe("Sweeper", () => {
  test("enqueues a pending job whose queue entry is missing", async () => {
    const { sweeper, calls } = makeHarness({ pending: ["job-1"] });
    await sweeper.runOnce();
    expect(calls.enqueued).toEqual(["job-1"]);
  });

  test("does not touch a pending job that is still waiting in the queue", async () => {
    const { sweeper, calls } = makeHarness({
      pending: ["job-1"],
      states: { "job-1": "waiting" },
    });
    await sweeper.runOnce();
    expect(calls.enqueued).toEqual([]);
    expect(calls.pendingFailed).toEqual([]);
  });

  test("promotes a pending job when the queue completed and the artifact exists", async () => {
    const { sweeper, calls } = makeHarness({
      pending: ["job-1"],
      states: { "job-1": "completed" },
      artifacts: new Set(["job-1"]),
    });
    await sweeper.runOnce();
    expect(calls.pendingCompleted).toEqual(["job-1"]);
  });

  test("fails a pending job when the queue is terminal but the artifact is missing", async () => {
    const { sweeper, calls } = makeHarness({
      pending: ["job-1"],
      states: { "job-1": "completed" },
    });
    await sweeper.runOnce();
    expect(calls.pendingFailed).toEqual([
      { id: "job-1", code: ERROR_CODES.OUTPUT_UNAVAILABLE },
    ]);
  });

  test("skips an expired processing job while the queue still reports active", async () => {
    const { sweeper, calls } = makeHarness({
      processing: ["job-1"],
      states: { "job-1": "active" },
      artifacts: new Set(["job-1"]),
    });
    await sweeper.runOnce();
    expect(calls.processingCompleted).toEqual([]);
    expect(calls.processingFailed).toEqual([]);
  });

  test("promotes an expired processing job when its artifact exists", async () => {
    const { sweeper, calls } = makeHarness({
      processing: ["job-1"],
      states: { "job-1": "failed" },
      artifacts: new Set(["job-1"]),
    });
    await sweeper.runOnce();
    expect(calls.processingCompleted).toEqual(["job-1"]);
  });

  test("resets an expired processing job that is waiting in the queue", async () => {
    const { sweeper, calls } = makeHarness({
      processing: ["job-1"],
      states: { "job-1": "waiting" },
    });
    await sweeper.runOnce();
    expect(calls.reset).toEqual(["job-1"]);
  });

  test("fails an expired processing job whose queue entry is gone", async () => {
    const { sweeper, calls } = makeHarness({
      processing: ["job-1"],
      states: { "job-1": "missing" },
    });
    await sweeper.runOnce();
    expect(calls.processingFailed).toEqual([
      { id: "job-1", code: ERROR_CODES.JOB_INTERRUPTED },
    ]);
  });

  test("deletes failed artifacts and clears their DB key", async () => {
    const { sweeper, calls } = makeHarness({ failed: ["job-1"] });
    await sweeper.runOnce();
    expect(calls.deleted).toEqual(["job-1"]);
    expect(calls.cleared).toEqual(["job-1"]);
  });

  test("does nothing when another sweeper holds the advisory lock", async () => {
    const { sweeper, calls } = makeHarness({
      pending: ["job-1"],
      locked: false,
    });
    await sweeper.runOnce();
    expect(calls.enqueued).toEqual([]);
  });
});
