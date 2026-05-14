# Orchestration Migration Notes

These notes describe the current architecture after the simplification work.

## Current Model

The project now has two normal user targets:

- `target.localRoot`
- `target.apiUrl`

Normal local usage is no longer a queued local control-plane model. It is
direct filesystem work plus `songs_metadata.json`.

Remote-style usage goes through the HTTP API and Postgres-backed orchestration.

## User-Facing Commands

The main user-facing command surface is:

- `capture-auth-token`
- `clear-auth-token`
- `download`
- `sync`
- `process`
- `download-images`
- `fetch-metadata`
- `refresh`
- `job-status`
- `watch-job`
- `logs`
- `api-health`
- `api-submit`
- `api-cancel-job`

The commands resolve target configuration from `--config` first, with
`--api-url` available as an override for API-targeted flows.

## Local Workflow Mode

When config contains:

```json
{
  "target": {
    "localRoot": "/absolute/path/to/library-root"
  }
}
```

the normal local workflow is:

- `download` writes directly to the configured root
- `process` reads and writes directly against the configured root
- `sync` performs local download plus local processing
- metadata is stored in `songs_metadata.json`

There is no local API mode and no local control-plane runtime involved in this
path.

## API Workflow Mode

When config contains:

```json
{
  "target": {
    "apiUrl": "http://127.0.0.1:3000"
  }
}
```

the workflow and inspection path is:

1. CLI submits work to the HTTP API
2. the API writes orchestration state to Postgres
3. runtime workers claim and execute work items
4. CLI uses `job-status`, `watch-job`, and `logs` for inspection

## Runtime/Internal Commands

The remaining runtime/internal commands are:

- `serve-api`
- `run-worker`
- `run-librarian`

These are deployment or backend-development commands, not the normal end-user
workflow.

## Removed Concepts

The following are no longer part of the active architecture:

- `run-orchestrator`
- `run-supervisor`
- `--runtime-mode`
- `--submit-only`
- `--control-plane local`
- `SUNO_EXPORT_CONTROL_PLANE_DIR`
- local control-plane backends
- local orchestrator and supervisor layers
- a standalone local API as the normal local workflow

## Postgres Role

Postgres is now the only supported orchestration control-plane backend for the
HTTP API and worker runtime.

That means:

- `serve-api` requires `--postgres-url`
- `run-worker` requires `--postgres-url`
- worker roles are `auth`, `metadata`, `asset`, `processing`, and
  `conversion`
- the old dedicated orchestrator runtime role no longer exists

## Librarian Status

`run-librarian` remains as a runtime/internal command for workspace-scoped
metadata synchronization.

It still uses metadata store options directly and is intentionally separate
from the simpler `localRoot` user workflow.

## How To Validate

Use [testing-guide.md](./docs/testing-guide.md:1)
for the current validation steps.

The main remaining verification work is operational rather than architectural:

- submit a real API-backed workflow
- confirm worker processing end to end
- confirm librarian behavior in the runtime model
