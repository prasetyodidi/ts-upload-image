-- migrate:up
CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  run_id uuid,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),

  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  started_at_ms bigint,
  completed_at_ms bigint,
  failed_at_ms bigint,
  lease_expires_at_ms bigint,
  last_heartbeat_at_ms bigint,
  enqueued_at_ms bigint,

  input_key text NOT NULL,
  input_bytes bigint NOT NULL CHECK (input_bytes > 0),
  input_mime text NOT NULL
    CHECK (input_mime IN ('image/jpeg', 'image/png', 'image/webp')),

  output_key text,
  output_bytes bigint CHECK (output_bytes IS NULL OR output_bytes > 0),
  output_width integer CHECK (output_width IS NULL OR output_width > 0),
  output_height integer CHECK (output_height IS NULL OR output_height > 0),
  output_sha256 text,

  error_code text,
  error_message text,
  error_detail jsonb,

  CHECK (status <> 'processing' OR (run_id IS NOT NULL AND lease_expires_at_ms IS NOT NULL)),
  CHECK (status <> 'pending' OR (run_id IS NULL AND started_at_ms IS NULL)),
  CHECK (status <> 'completed' OR (output_key IS NOT NULL AND completed_at_ms IS NOT NULL)),
  CHECK (status <> 'failed' OR (error_code IS NOT NULL AND failed_at_ms IS NOT NULL))
);

CREATE INDEX jobs_processing_lease_idx
  ON jobs (lease_expires_at_ms)
  WHERE status = 'processing';

CREATE INDEX jobs_pending_created_idx
  ON jobs (created_at_ms)
  WHERE status = 'pending';

CREATE UNIQUE INDEX jobs_run_id_idx
  ON jobs (run_id)
  WHERE run_id IS NOT NULL;

CREATE INDEX jobs_failed_cleanup_idx
  ON jobs (updated_at_ms)
  WHERE status = 'failed';

-- migrate:down
DROP TABLE jobs;
