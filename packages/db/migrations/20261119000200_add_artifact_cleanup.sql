-- migrate:up
ALTER TABLE jobs
  ADD COLUMN artifacts_cleaned_at_ms bigint;

-- migrate:down
ALTER TABLE jobs
  DROP COLUMN artifacts_cleaned_at_ms;
