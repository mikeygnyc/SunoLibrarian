# App Split Checklist

This checklist turns the app split plan into a concrete execution sequence.

## Phase 1: Boundary Freeze

- [x] Write down the responsibility of each target app:
  - `api`
  - `operator-cli`
  - `orchestrator`
  - `worker`
  - `librarian`
- [x] Identify current modules that are app-only versus reusable core
- [x] Stop adding new bootstrap logic to `src/index.ts`
- [x] Stop adding any runtime loops to `serve-api`
- [x] Confirm the rule that one process owns one runtime responsibility
- [x] Confirm the rule that one librarian process owns one workspace
- [x] Decide where workspace enable/disable state should live

Phase 1 decisions are recorded in `docs/app-split-boundaries.md`.

## Phase 2: New Entrypoints

- [x] Create `apps/api/src/main.ts`
- [x] Create `apps/operator-cli/src/main.ts`
- [x] Create `apps/orchestrator/src/main.ts`
- [x] Create `apps/worker/src/main.ts`
- [x] Create `apps/librarian/src/main.ts`
- [x] Point each new entrypoint at existing implementation functions first
- [x] Keep the old entrypoint working during the transition
- [x] Add temporary compatibility scripts if needed
- [x] Ensure librarian entrypoints accept explicit workspace ownership

## Phase 3: Config Cleanup

- [x] Introduce `ApiServerConfig`
- [x] Introduce `OperatorCliConfig`
- [x] Introduce `OrchestratorConfig`
- [x] Introduce `WorkerConfig`
- [x] Introduce `LibrarianConfig`
- [x] Reduce direct reliance on broad `CliOptions` in app bootstraps
- [x] Separate workflow submission payloads from bootstrap/runtime config
- [x] Add workspace enable/disable config for librarian-managed traffic

## Phase 4: Shared Contracts

- [x] Move HTTP API contracts into shared core/contracts
- [x] Move orchestration interfaces into shared core/contracts
- [x] Keep dashboard/client types importing shared contracts only
- [x] Remove app-local duplicates of shared types if any appear

No app-local duplicate shared contract definitions were found during the Phase 4
cleanup pass; imports were tightened toward `src/core/contracts` instead.

## Phase 5: Orchestration Core Extraction

- [ ] Move control-plane repository code into core
- [ ] Move runtime-support helpers into core
- [ ] Move workflow stage-plan helpers into core
- [ ] Move job submission/restart/cancellation helpers into core
- [ ] Ensure orchestrator, worker, API, and operator CLI all use the same core
  orchestration modules

## Phase 6: Service Extraction

- [ ] Move auth service into core
- [ ] Move metadata acquisition service into core
- [ ] Move asset acquisition service into core
- [ ] Move processing planner service into core
- [ ] Move conversion service into core
- [ ] Move librarian service into core or keep a thin app wrapper around a core
  sync service
- [ ] Refactor librarian logic away from rotating across all workspaces
- [ ] Support one-workspace-per-librarian execution
- [ ] Skip disabled workspaces entirely during background sync

## Phase 7: Operator CLI Cleanup

- [ ] Move submit/status/cancel/log queries into `operator-cli`
- [ ] Move `capture-auth-token` into `operator-cli`
- [ ] Keep dashboard/API client helpers shared if both CLI and UI need them
- [ ] Remove service-process startup from the operator CLI entrypoint

## Phase 8: API Cleanup

- [ ] Keep `api` limited to HTTP, dashboard, and control-plane mutations
- [ ] Ensure `api` does not start orchestrator, worker, or librarian loops
- [ ] Keep server-owned runtime config local to the API app
- [ ] Confirm token update and auth-failure restart behavior still work from the
  API app

## Phase 9: Build and Tooling

- [ ] Add per-app build scripts
- [ ] Add per-app dev scripts
- [ ] Update VS Code launch configs to target new app entrypoints
- [ ] Update README command examples
- [ ] Update docs to describe the multi-process app model

## Phase 10: Migration Cleanup

- [ ] Reduce the old top-level `src/index.ts` to a compatibility shim or remove
  it
- [ ] Remove deprecated bootstrap glue
- [ ] Remove dead imports and stale option wiring
- [ ] Re-run architecture review and confirm the boundaries still make sense

## Validation Checklist

- [ ] `api` starts and serves the dashboard without starting any runtime loops
- [ ] `orchestrator` starts and only runs the orchestrator loop
- [ ] `worker` starts and only runs worker logic
- [ ] `librarian` starts and only runs workspace sync
- [ ] each librarian process is pinned to exactly one workspace
- [ ] disabled workspaces generate no librarian polling traffic
- [ ] `operator-cli` can submit jobs, inspect jobs, cancel jobs, and capture
  auth tokens
- [ ] job submission still works end to end
- [ ] auth token updates still restart recent auth-blocked jobs correctly
- [ ] logging and status queries still work across separated apps

## Suggested First Implementation Slice

If doing this incrementally, start here:

- [x] add separate app entrypoints
- [x] move `serve-api` bootstrap under `apps/api`
- [x] move `run-orchestrator` bootstrap under `apps/orchestrator`
- [x] move `run-worker` bootstrap under `apps/worker`
- [x] move `run-librarian` bootstrap under `apps/librarian`
- [x] make `run-librarian` explicitly workspace-scoped
- [x] add workspace enable/disable configuration for librarian-managed sync
- [x] move `capture-auth-token` and operator utilities under `apps/operator-cli`

That slice gives the architectural win early, even before deeper module moves.
