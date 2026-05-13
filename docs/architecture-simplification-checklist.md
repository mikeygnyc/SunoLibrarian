# Architecture Simplification Checklist

## Goal

Status note: the implementation direction has changed. Normal local usage is now moving toward a single config file with either a remote `apiUrl` target or a local filesystem `localRoot` target backed by `songs_metadata.json`, instead of a standalone local API plus SQLite path.

Shift the system to a simpler two-target architecture where:

- a config file selects either a remote API target or a local filesystem target
- the API remains the primary remote orchestration entrypoint
- Postgres is the real durable backend for orchestration state
- workers are remote executors managed by a k8s operator
- local tooling is limited to:
  - auth/token capture
  - job submission to a remote API when `apiUrl` is configured
  - direct local download/process/sync when `localRoot` is configured
  - status/log inspection
  - optional local worker/agent execution against the API
  - optional runtime/internal local API components for backend development only

The key change is that normal local execution is no longer a separate orchestration/control-plane model. It is just direct filesystem work plus `songs_metadata.json`.

## Non-Goals

- Do not redesign the orchestration domain model from scratch.
- Do not remove worker roles, job stages, or librarian concepts.
- Do not rewrite the docs until the code changes settle.
- Do not undo the trimmed CLI surface for `download`, `sync`, and `process`.

## Target Shape

### User-facing

- `capture-auth-token`
- `download`
- `sync`
- `process`
- `download-images`
- `fetch-metadata`
- `refresh`
- `job-status`
- `watch-job`
- `logs`

These commands should resolve their target from config first. `download` / `sync` / `process` may run locally when `localRoot` is configured. The API-oriented commands require an API target.

### Runtime/internal

- `serve-api`
- `run-worker`
- `run-librarian`

These commands exist for deployment/runtime use, not as the primary end-user workflow.

### Removed or deprecated

- `run-orchestrator`
- `run-supervisor`
- `--runtime-mode`
- `--submit-only`
- `--control-plane local`
- `SUNO_EXPORT_CONTROL_PLANE_DIR`
- local control-plane as a first-class backend
- in-process local orchestration for workflow commands

## Keep / Reshape / Remove

### Keep

- HTTP API surface
- job/stage/work-item model
- Postgres control-plane path
- worker roles: `auth`, `metadata`, `asset`, `processing`, `conversion`
- librarian runtime role
- operator CLI as the user-facing entrypoint

### Reshape

- `serve-api` becomes the primary backend entrypoint
- `run-worker` becomes API-first and runtime/internal
- `run-librarian` becomes API-first and runtime/internal
- normal local workflow becomes file-backed (`songs_metadata.json`) instead of SQLite-backed
- workflow commands resolve target from config instead of carrying orchestration mode flags

### Remove or deprecate

- local control-plane as a first-class backend
- in-process local orchestration for workflow commands
- `run-orchestrator`
- `run-supervisor`
- `--runtime-mode`
- `--submit-only`
- `--control-plane local`
- `SUNO_EXPORT_CONTROL_PLANE_DIR`

## Current Hotspots

These files currently drive the local-first or dual-mode behavior:

- `src/cli-actions.ts`
- `src/orchestration/runtime-support.ts`
- `src/orchestration/local-control-plane.ts`
- `src/orchestration/local-orchestrator.ts`
- `src/supervisor/local-supervisor.ts`
- `src/http-api.ts`
- `src/cli-programs.ts`

## Phase 1

Make workflow commands API-only.

- [x] Make workflow commands API-only in `src/cli-actions.ts`
  Remove local execution from `runDownloadFlow`, `runSyncFlow`, `runProcessFlow`, `runDownloadImagesFlow`, `runFetchMetadataFlow`, and `runRefreshFlow`.
- [x] Remove `shouldSubmitOnly()` and local workflow submission branching in `src/cli-actions.ts`
- [x] Remove `createLocalJobOrchestrator()` and `runLocalWorkflowCommand()` from `src/cli-actions.ts`
- [x] Add direct workflow submission helpers using `src/http-api-client.ts`
- [x] Add `--api-url` to user workflow commands in `src/cli-programs.ts`
  `download`, `sync`, `process`, `download-images`, `fetch-metadata`, `refresh`, `job-status`, `watch-job`, and `logs`
- [x] Decide whether to keep separate `api-*` commands or fold them into the main commands
- [x] Keep `capture-auth-token` local in `src/cli-actions.ts`
- [x] Keep `clear-auth-token` local in `src/cli-actions.ts`

### Phase 1 Validation

- [x] `npm run build`
- [x] `npm start -- --help`
- [x] `npm start -- download --help`
- [x] `npm start -- sync --help`
- [x] `npm start -- process --help`
- [ ] Submit one workflow through the API and confirm `job-status` / `watch-job`

## Phase 2

Move local fallback behind the API.

- [x] Reframe `src/http-api.ts` as the primary orchestration entrypoint
- [x] Introduce a clear standalone API mode in `src/http-api.ts`
  SQLite + local folders should live here, not in CLI workflow execution
- [x] Separate API storage/deployment config from old control-plane config in `src/app-config.ts`
- [ ] Refactor `src/http-api-workflows.ts` if needed so submitted payloads are the canonical workflow contract
- [x] Move local fallback assumptions out of `src/cli-actions.ts`
- [x] Confirm artifact roots and metadata DB defaults are owned by API config, not operator CLI config

### Phase 2 Validation

- [x] Start API in standalone mode
- [x] Submit a workflow from the CLI
- [ ] Verify local files and SQLite metadata update through API-driven execution only

## Phase 3

Simplify runtime internals.

- [x] Deprecate `run-orchestrator` in `src/cli-programs.ts`
- [x] Deprecate `run-supervisor` in `src/cli-programs.ts`
- [x] Remove local supervisor wiring from `src/supervisor/local-supervisor.ts`
- [x] Keep `run-worker` only as a runtime/internal entrypoint in `src/apps/worker/main.ts`
- [x] Keep `run-librarian` only as a runtime/internal entrypoint in `src/apps/librarian/main.ts`
- [x] Remove worker-topology and local multi-process assumptions from `src/app-config.ts` and `src/cli-programs.ts`
- [ ] Strip local health/bootstrap orchestration assumptions that only existed for supervisor mode

### Phase 3 Validation

- [x] Build passes
- [ ] Worker still processes queued work against the real backend
- [ ] Librarian still syncs correctly in the runtime model

## Phase 4

Delete the local control-plane layer.

- [ ] Delete `src/orchestration/local-orchestrator.ts`
- [ ] Delete `src/orchestration/local-control-plane.ts`
- [x] Remove re-exports from `src/core/orchestration/index.ts` and `src/orchestration/index.ts`
- [ ] Simplify `src/orchestration/runtime-support.ts`
  Remove local backend resolution and make repository creation match the new model
- [ ] Remove `resolveControlPlaneBackend()` local branch in `src/orchestration/runtime-support.ts`
- [x] Remove `SUNO_EXPORT_CONTROL_PLANE_DIR` usage
- [x] Remove `--control-plane local`
- [ ] Remove `--runtime-mode`
- [ ] Remove `--submit-only`

### Phase 4 Validation

- [ ] `rg` shows no remaining references to local control-plane classes or flags
- [ ] Build passes
- [ ] Existing API/worker flow still functions

## Phase 5

Cleanup and rename.

- [ ] Collapse duplicated job/status/log flows in `src/cli-actions.ts`
- [ ] Simplify command registration in `src/cli-programs.ts`
  Separate user-facing commands from runtime/internal commands
- [ ] Review `src/index.ts`
  Decide whether the legacy mixed-surface bootstrap is still appropriate
- [ ] Clean up runtime-only app entrypoints under `src/apps/`
- [ ] Remove stale env/config handling from `src/app-config.ts`
- [ ] Replace local-runtime-focused tests with API-first tests
- [ ] Rewrite docs after code settles

## Likely File Touch List

### High-priority edits

- `src/cli-actions.ts`
- `src/cli-programs.ts`
- `src/http-api.ts`
- `src/http-api-client.ts`
- `src/app-config.ts`
- `src/orchestration/runtime-support.ts`

### Likely deletions later

- `src/orchestration/local-control-plane.ts`
- `src/orchestration/local-orchestrator.ts`
- `src/supervisor/local-supervisor.ts`

## Open Decisions

- [x] `download` / `sync` / `process` now require either `--api-url` or a config file target, and support `localRoot` for local execution
- [ ] Should `api-*` commands survive as explicit aliases, or be merged into the main surface?
- [ ] Should workers talk directly to Postgres-backed control-plane state, or eventually through more API endpoints?
- [ ] Is standalone local API mode a permanent supported mode, or just a dev convenience?
