# End-to-end tests

These tests use the running Compose stack and the same `.env` as the app. They create real jobs, write to the configured R2 bucket, and clean up the rows and objects they create.

## Prerequisites

- `docker compose up --build -d` has completed
- `http://localhost:8080/health` returns `{"status":"ok"}`
- `.env` contains valid R2 credentials
- Chrome is installed for the Playwright test

Run from the repository root:

```sh
bun run test:e2e
```

Override the API origin when needed:

```sh
API_BASE_URL=http://localhost:3000 bun run test:e2e
```

## API coverage

`api.test.ts` covers:

- valid JPEG upload, worker processing, WebP download, 1280 px output
- rejection above 25 MP with `IMAGE_DIMENSIONS_EXCEEDED`
- missing file field
- file above 20 MB
- spoofed MIME with invalid file signature
- unknown job ID

The tests remove `inputs/<jobId>`, `outputs/<jobId>.webp`, and the matching PostgreSQL row in `afterAll`.

## Worker recovery

This test kills the worker while a job is processing, waits for the lease and BullMQ stalled check, restarts the worker, and expects the job to complete.

```sh
bun run test:e2e:recovery
```

It takes about 70 seconds. The worker is restarted in `afterAll` even if the test fails.

## Browser test

The Playwright test drives the Svelte UI in Chrome: file selection, submit, polling, completed state, and WebP download. It also checks the client-side error for an unsupported file type.

```sh
bun run test:browser
```

## Not covered

- download before the worker finishes
- Redis outage during upload
- cleanup of objects if the test process is killed before `afterAll`
