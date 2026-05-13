# Testing Guide

This guide documents how to test the current simplified architecture.

It covers:

- local filesystem workflows through `target.localRoot`
- remote API submission through `target.apiUrl`
- runtime worker processing against Postgres
- librarian runtime checks

## Prerequisites

Use the project Node version through `nvm` before running any Node-based
command:

```bash
source ~/.nvm/nvm.sh
nvm use
```

Build once before testing:

```bash
npm run build
```

## Quick CLI Sanity Check

Run these first after any CLI or wiring change:

```bash
npm start -- --help
npm start -- download --help
npm start -- process --help
npm start -- sync --help
npm start -- serve-api --help
npm start -- run-worker --help
npm start -- run-librarian --help
```

## 1. Test Local Filesystem Mode

This validates the normal local user path:

- no API
- no control-plane runtime
- metadata stored in `songs_metadata.json`

Create a config like:

```json
{
  "target": {
    "localRoot": "/absolute/path/to/test-library"
  }
}
```

Recommended test root layout:

- empty directory before `download`
- or a copy of an existing download-style root before `process`

### Local Process Smoke Test

This is the safest local test because it does not need Suno auth:

```bash
npm start -- process --config ./suno-export.config.json
```

Verify:

- command exits successfully
- converted output is written under the configured root
- `songs_metadata.json` still exists
- metadata-driven side effects still occur as expected

### Local Download Smoke Test

This exercises direct local download into the configured root:

```bash
npm start -- download --config ./suno-export.config.json --browser http://localhost:9222
```

Or with a token:

```bash
npm start -- download --config ./suno-export.config.json --token <token>
```

Verify:

- files appear under the configured root
- `songs_metadata.json` is created or updated
- audio, metadata, and image outputs match the expected download layout

### Local Sync Smoke Test

```bash
npm start -- sync --config ./suno-export.config.json --browser http://localhost:9222
```

Verify:

- download step completes
- processing step completes
- final metadata export remains in `songs_metadata.json`

## 2. Test API Submission Mode

This validates the remote-style user path where the CLI submits work to the
HTTP API.

### Start Postgres

You need a Postgres database reachable by `--postgres-url`.

Example shape:

```bash
export POSTGRES_URL=postgres://user:password@127.0.0.1:5432/suno_export
```

### Start the API

In one terminal:

```bash
npm start -- serve-api \
  --postgres-url "$POSTGRES_URL" \
  --output /absolute/path/to/api-download-root \
  --library /absolute/path/to/api-library-root
```

Verify:

- server starts successfully
- `/healthz` responds

You can check health with:

```bash
npm start -- api-health --api-url http://127.0.0.1:3000
```

### Submit a Workflow

Use either `--api-url` directly or a config file:

```json
{
  "target": {
    "apiUrl": "http://127.0.0.1:3000"
  }
}
```

Example submission:

```bash
npm start -- refresh --config ./suno-export.config.json --browser http://localhost:9222
```

Or:

```bash
npm start -- download --config ./suno-export.config.json --browser http://localhost:9222
```

Capture the returned job id and verify:

```bash
npm start -- job-status <job-id> --config ./suno-export.config.json
npm start -- watch-job <job-id> --config ./suno-export.config.json
npm start -- logs --job-id <job-id> --config ./suno-export.config.json
```

At this stage, before workers are running, the job should remain queued or only
partially progress.

## 3. Test Worker Runtime Processing

This validates that queued work is claimed and executed by runtime workers.

Run workers in separate terminals against the same Postgres database.

For a broad smoke test, start one worker per role:

```bash
npm start -- run-worker --role auth --postgres-url "$POSTGRES_URL"
npm start -- run-worker --role metadata --postgres-url "$POSTGRES_URL"
npm start -- run-worker --role asset --postgres-url "$POSTGRES_URL"
npm start -- run-worker --role processing --postgres-url "$POSTGRES_URL"
npm start -- run-worker --role conversion --postgres-url "$POSTGRES_URL"
```

Then submit a workflow from the API path and watch it complete:

```bash
npm start -- sync --config ./suno-export.config.json --browser http://localhost:9222
npm start -- watch-job <job-id> --config ./suno-export.config.json
```

Verify:

- workers claim work items
- the job transitions through queued, running, and completed
- `logs` shows entries with worker roles `auth`, `metadata`, `asset`,
`processing`, or `conversion`
- no `orchestrator` role appears anywhere
- files are written under the API-owned `--output` and `--library` roots

Useful log checks:

```bash
npm start -- logs --job-id <job-id> --config ./suno-export.config.json
npm start -- logs --role asset --config ./suno-export.config.json
npm start -- logs --role conversion --config ./suno-export.config.json
```

## 4. Test Librarian Runtime

This validates the remaining runtime/internal librarian path.

Run a one-shot sync against a known workspace:

```bash
npm start -- run-librarian \
  --workspace <workspace-id> \
  --browser http://localhost:9222 \
  --once
```

If you want Postgres-backed metadata storage for this runtime check:

```bash
npm start -- run-librarian \
  --workspace <workspace-id> \
  --browser http://localhost:9222 \
  --database-type postgres \
  --postgres-url "$POSTGRES_URL" \
  --once
```

Verify:

- the process starts and exits cleanly with `--once`
- workspace metadata sync still works for the pinned workspace
- no old supervisor or orchestrator commands are required

## 5. Regression Checks After Simplification

Use these checks after architecture cleanup work:

```bash
rg -n "\borchestrator\b|\brun-orchestrator\b|\brun-supervisor\b|submit-only|runtime-mode|control-plane-dir|SUNO_EXPORT_CONTROL_PLANE_DIR" src test package.json
```

Expected result:

- no live code references to removed runtime modes or commands

Also verify:

```bash
rg -n "local-control-plane|local-orchestrator|local-supervisor|remote-supervisor" src test
```

Expected result:

- no production references to removed local control-plane or supervisor layers

## Suggested Minimum Test Matrix

When making architecture changes, the minimum useful matrix is:

1. `npm run build`
2. top-level CLI help
3. `download`, `process`, `sync` help
4. `serve-api`, `run-worker`, `run-librarian` help
5. one local `process` smoke test through `localRoot`
6. one API submission plus `job-status` and `watch-job`
7. one worker-backed end-to-end job completion

## Known Limits

- `run-librarian` still uses the metadata store options directly and is a
runtime/internal command, not part of the normal local `localRoot` workflow
- API-backed testing requires a real Postgres instance
- Suno-backed download tests require valid auth through `--token` or
`--browser`

