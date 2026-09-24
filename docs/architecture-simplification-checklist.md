# Architecture Simplification Checklist

## Status

The architecture simplification is functionally complete in code.

The project now follows the intended two-target model:

- `target.localRoot` for direct local filesystem workflows backed by
  `songs_metadata.json`
- `target.apiUrl` for HTTP API submission and inspection

The main remaining work is runtime verification and ongoing maintenance, not
more architectural surgery.

## Final Shape

### User-facing

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

### Runtime/internal

- `serve-api`
- `run-worker`
- `run-librarian`

### Removed

- `run-orchestrator`
- `run-supervisor`
- `--runtime-mode`
- `--submit-only`
- `--control-plane local`
- `SUNO_EXPORT_CONTROL_PLANE_DIR`
- local control-plane backends
- local orchestrator and supervisor layers

## Completed Work

- [x] Added config-driven target resolution with `apiUrl` or `localRoot`
- [x] Kept normal local workflow file-backed through `songs_metadata.json`
- [x] Made API submission and inspection commands config-first
- [x] Removed local control-plane backend support from production code
- [x] Removed local orchestrator and supervisor runtime paths
- [x] Removed the standalone orchestrator runtime role
- [x] Collapsed finalization onto existing worker roles
- [x] Simplified root CLI bootstrap and command registration
- [x] Removed duplicate API job/log wrapper flows in `src/cli-actions.ts`
- [x] Added current testing guidance in `docs/testing-guide.md`
- [x] Updated migration notes to reflect the shipped architecture

## Verification Still Worth Doing

- [ ] Submit a real workflow through the API and confirm `job-status`
- [ ] Confirm `watch-job` against a live API-backed job
- [ ] Confirm workers process queued work end to end against Postgres
- [ ] Confirm librarian still syncs correctly in the runtime model
- [ ] Replace deleted local-runtime-focused tests with API-first coverage

## Validation Commands

These already pass as part of the simplification work:

- [x] `npm run build`
- [x] `npm start -- --help`
- [x] `npm start -- download --help`
- [x] `npm start -- sync --help`
- [x] `npm start -- process --help`
- [x] `npm start -- serve-api --help`
- [x] `npm start -- run-worker --help`
- [x] `npm start -- run-librarian --help`

Use [testing-guide.md](./testing-guide.md)
for the live end-to-end validation steps.

## Current Open Decisions

- [ ] Should `api-health`, `api-submit`, and `api-cancel-job` remain explicit commands, or fold further into the main surface?
- [ ] Should workers continue talking directly to Postgres-backed orchestration state, or eventually move behind more API endpoints?
- [ ] How much API-first automated coverage should replace the removed local-runtime tests?
