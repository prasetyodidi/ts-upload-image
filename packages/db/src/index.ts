import type { ErrorCode, JobStatus } from "@ts-upload-image/shared";
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface Clock {
  nowMs(): number;
}

export interface ClaimResult {
  inputKey: string;
}

export interface CompletedJobResult {
  outputKey: string;
  bytes: number;
  width: number;
  height: number;
}

export interface JobFailure {
  code: ErrorCode;
  message: string;
}

export interface NewJob {
  id: string;
  inputKey: string;
  inputBytes: number;
  inputMime: string;
  createdAtMs: number;
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  createdAtMs: number;
  updatedAtMs: number;
  startedAtMs: number | null;
  completedAtMs: number | null;
  failedAtMs: number | null;
  inputKey: string;
  inputBytes: number;
  inputMime: string;
  outputKey: string | null;
  outputBytes: number | null;
  outputWidth: number | null;
  outputHeight: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export class JobRepository {
  constructor(
    private readonly sql: Sql,
    private readonly clock: Clock = { nowMs: () => Date.now() },
  ) {}

  static connect(databaseUrl: string, clock?: Clock): JobRepository {
    return new JobRepository(postgres(databaseUrl, { max: 5 }), clock);
  }

  async create(job: NewJob): Promise<void> {
    await this.sql`
      INSERT INTO jobs (
        id, status, created_at_ms, updated_at_ms,
        input_key, input_bytes, input_mime
      )
      VALUES (
        ${job.id}, 'pending', ${job.createdAtMs}, ${job.createdAtMs},
        ${job.inputKey}, ${job.inputBytes}, ${job.inputMime}
      )
    `;
  }

  async markEnqueued(jobId: string): Promise<void> {
    const nowMs = this.clock.nowMs();
    await this.sql`
      UPDATE jobs
      SET enqueued_at_ms = ${nowMs}, updated_at_ms = ${nowMs}
      WHERE id = ${jobId} AND status = 'pending'
    `;
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const rows = await this.sql<
      Array<{
        id: string;
        status: JobStatus;
        created_at_ms: string | number;
        updated_at_ms: string | number;
        started_at_ms: string | number | null;
        completed_at_ms: string | number | null;
        failed_at_ms: string | number | null;
        input_key: string;
        input_bytes: string | number;
        input_mime: string;
        output_key: string | null;
        output_bytes: string | number | null;
        output_width: number | null;
        output_height: number | null;
        error_code: string | null;
        error_message: string | null;
      }>
    >`
      SELECT id, status, created_at_ms, updated_at_ms, started_at_ms,
             completed_at_ms, failed_at_ms, input_key, input_bytes, input_mime,
             output_key, output_bytes, output_width, output_height,
             error_code, error_message
      FROM jobs
      WHERE id = ${jobId}
    `;

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      status: row.status,
      createdAtMs: Number(row.created_at_ms),
      updatedAtMs: Number(row.updated_at_ms),
      startedAtMs: row.started_at_ms === null ? null : Number(row.started_at_ms),
      completedAtMs:
        row.completed_at_ms === null ? null : Number(row.completed_at_ms),
      failedAtMs: row.failed_at_ms === null ? null : Number(row.failed_at_ms),
      inputKey: row.input_key,
      inputBytes: Number(row.input_bytes),
      inputMime: row.input_mime,
      outputKey: row.output_key,
      outputBytes:
        row.output_bytes === null ? null : Number(row.output_bytes),
      outputWidth: row.output_width,
      outputHeight: row.output_height,
      errorCode: row.error_code,
      errorMessage: row.error_message,
    };
  }

  async claim(
    jobId: string,
    runId: string,
    nowMs: number,
    leaseMs: number,
  ): Promise<ClaimResult | null> {
    const rows = await this.sql<{ input_key: string }[]>`
      UPDATE jobs
      SET status = 'processing',
          run_id = ${runId},
          attempts = attempts + 1,
          started_at_ms = COALESCE(started_at_ms, ${nowMs}),
          updated_at_ms = ${nowMs},
          lease_expires_at_ms = ${nowMs + leaseMs},
          last_heartbeat_at_ms = ${nowMs}
      WHERE id = ${jobId}
        AND (
          status = 'pending'
          OR (status = 'processing' AND lease_expires_at_ms < ${nowMs})
        )
      RETURNING input_key
    `;

    const inputKey = rows[0]?.input_key;
    return inputKey ? { inputKey } : null;
  }

  async getStatus(jobId: string): Promise<JobStatus | "not_found"> {
    const rows = await this.sql<{ status: JobStatus }[]>`
      SELECT status FROM jobs WHERE id = ${jobId}
    `;
    return rows[0]?.status ?? "not_found";
  }

  async isOwned(jobId: string, runId: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      SELECT id
      FROM jobs
      WHERE id = ${jobId}
        AND status = 'processing'
        AND run_id = ${runId}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  async heartbeat(
    jobId: string,
    runId: string,
    nowMs: number,
    leaseMs: number,
  ): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE jobs
      SET last_heartbeat_at_ms = ${nowMs},
          lease_expires_at_ms = ${nowMs + leaseMs},
          updated_at_ms = ${nowMs}
      WHERE id = ${jobId}
        AND status = 'processing'
        AND run_id = ${runId}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async markCompleted(
    jobId: string,
    runId: string,
    result: CompletedJobResult,
  ): Promise<void> {
    const nowMs = this.clock.nowMs();
    const rows = await this.sql<{ id: string }[]>`
      UPDATE jobs
      SET status = 'completed',
          output_key = ${result.outputKey},
          output_bytes = ${result.bytes},
          output_width = ${result.width},
          output_height = ${result.height},
          completed_at_ms = ${nowMs},
          updated_at_ms = ${nowMs},
          lease_expires_at_ms = NULL
      WHERE id = ${jobId}
        AND status = 'processing'
        AND run_id = ${runId}
      RETURNING id
    `;

    if (rows.length === 0) {
      throw new Error(`Lost ownership while completing job ${jobId}`);
    }
  }

  async markFailed(
    jobId: string,
    runId: string,
    failure: JobFailure,
  ): Promise<void> {
    const nowMs = this.clock.nowMs();
    const rows = await this.sql<{ id: string }[]>`
      UPDATE jobs
      SET status = 'failed',
          error_code = ${failure.code},
          error_message = ${failure.message},
          failed_at_ms = ${nowMs},
          updated_at_ms = ${nowMs},
          lease_expires_at_ms = NULL
      WHERE id = ${jobId}
        AND status = 'processing'
        AND run_id = ${runId}
      RETURNING id
    `;

    if (rows.length === 0) {
      throw new Error(`Lost ownership while failing job ${jobId}`);
    }
  }

  async findPendingBefore(cutoffMs: number, limit: number): Promise<string[]> {
    const rows = await this.sql<{ id: string }[]>`
      SELECT id
      FROM jobs
      WHERE status = 'pending' AND created_at_ms < ${cutoffMs}
      ORDER BY created_at_ms
      LIMIT ${limit}
    `;
    return rows.map((row) => row.id);
  }

  async findExpiredProcessing(nowMs: number, limit: number): Promise<string[]> {
    const rows = await this.sql<{ id: string }[]>`
      SELECT id
      FROM jobs
      WHERE status = 'processing' AND lease_expires_at_ms < ${nowMs}
      ORDER BY lease_expires_at_ms
      LIMIT ${limit}
    `;
    return rows.map((row) => row.id);
  }

  async findFailedForCleanup(
    cutoffMs: number,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.sql<{ id: string }[]>`
      SELECT id
      FROM jobs
      WHERE status = 'failed' AND artifacts_cleaned_at_ms IS NULL
      ORDER BY updated_at_ms DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => row.id);
  }

  async resetToPending(jobId: string, nowMs: number): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE jobs
      SET status = 'pending',
          run_id = NULL,
          started_at_ms = NULL,
          lease_expires_at_ms = NULL,
          last_heartbeat_at_ms = NULL,
          updated_at_ms = ${nowMs}
      WHERE id = ${jobId}
        AND status = 'processing'
        AND lease_expires_at_ms < ${nowMs}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async markProcessingCompleted(
    jobId: string,
    outputKey: string,
    outputBytes: number,
    nowMs: number,
  ): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE jobs
      SET status = 'completed',
          output_key = ${outputKey},
          output_bytes = ${outputBytes},
          completed_at_ms = ${nowMs},
          updated_at_ms = ${nowMs},
          lease_expires_at_ms = NULL
      WHERE id = ${jobId}
        AND status = 'processing'
        AND lease_expires_at_ms < ${nowMs}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async markProcessingFailed(
    jobId: string,
    errorCode: string,
    errorMessage: string,
    nowMs: number,
  ): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE jobs
      SET status = 'failed',
          error_code = ${errorCode},
          error_message = ${errorMessage},
          failed_at_ms = ${nowMs},
          updated_at_ms = ${nowMs},
          lease_expires_at_ms = NULL
      WHERE id = ${jobId}
        AND status = 'processing'
        AND lease_expires_at_ms < ${nowMs}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async markPendingCompleted(
    jobId: string,
    outputKey: string,
    outputBytes: number,
    nowMs: number,
  ): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE jobs
      SET status = 'completed',
          output_key = ${outputKey},
          output_bytes = ${outputBytes},
          completed_at_ms = ${nowMs},
          updated_at_ms = ${nowMs}
      WHERE id = ${jobId} AND status = 'pending'
      RETURNING id
    `;
    return rows.length > 0;
  }

  async markPendingFailed(
    jobId: string,
    errorCode: string,
    errorMessage: string,
    nowMs: number,
  ): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE jobs
      SET status = 'failed',
          error_code = ${errorCode},
          error_message = ${errorMessage},
          failed_at_ms = ${nowMs},
          updated_at_ms = ${nowMs}
      WHERE id = ${jobId} AND status = 'pending'
      RETURNING id
    `;
    return rows.length > 0;
  }

  async clearFailedOutput(jobId: string, nowMs: number): Promise<void> {
    await this.sql`
      UPDATE jobs
      SET output_key = NULL,
          output_bytes = NULL,
          artifacts_cleaned_at_ms = ${nowMs},
          updated_at_ms = ${nowMs}
      WHERE id = ${jobId} AND status = 'failed'
    `;
  }

  async withSweepLock<T>(fn: () => Promise<T>): Promise<T | null> {
    const reserved = await this.sql.reserve();
    try {
      const rows = await reserved<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${SWEEP_LOCK_KEY}) AS locked
      `;
      if (!rows[0]?.locked) {
        return null;
      }

      try {
        return await fn();
      } finally {
        await reserved`SELECT pg_advisory_unlock(${SWEEP_LOCK_KEY})`;
      }
    } finally {
      reserved.release();
    }
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

const SWEEP_LOCK_KEY = 727_001;
