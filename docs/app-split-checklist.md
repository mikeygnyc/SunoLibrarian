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

- [x] Move control-plane repository code into core
- [x] Move runtime-support helpers into core
- [x] Move workflow stage-plan helpers into core
- [x] Move job submission/restart/cancellation helpers into core
- [x] Ensure orchestrator, worker, API, and operator CLI all use the same core
  orchestration modules

This phase currently uses a shared `src/core/orchestration` facade over the
existing orchestration implementation files to preserve behavior while making
the core boundary explicit.

## Phase 6: Service Extraction

- [x] Move auth service into core
- [x] Move metadata acquisition service into core
- [x] Move asset acquisition service into core
- [x] Move processing planner service into core
- [x] Move conversion service into core
- [x] Move librarian service into core or keep a thin app wrapper around a core
  sync service
- [x] Refactor librarian logic away from rotating across all workspaces
- [x] Support one-workspace-per-librarian execution
- [x] Skip disabled workspaces entirely during background sync

This phase currently uses a shared `src/core/services` facade over the existing
service implementation files so app-facing code can depend on a core service
surface before any deeper file moves.

The current librarian implementation no longer rotates across workspaces:
workspace ownership is explicit, one workspace is required per process, and
disabled workspaces are skipped before sync work begins.

## Phase 7: Operator CLI Cleanup

- [x] Move submit/status/cancel/log queries into `operator-cli`
- [x] Move `capture-auth-token` into `operator-cli`
- [x] Keep dashboard/API client helpers shared if both CLI and UI need them
- [x] Remove service-process startup from the operator CLI entrypoint

The dedicated `operator-cli` app exposes operator-facing commands only. Service
process bootstraps remain in the API/orchestrator/worker/librarian apps, while
shared dashboard/API client helpers continue to live outside the app entrypoint.

## Phase 8: API Cleanup

- [x] Keep `api` limited to HTTP, dashboard, and control-plane mutations
- [x] Ensure `api` does not start orchestrator, worker, or librarian loops
- [x] Keep server-owned runtime config local to the API app
- [x] Confirm token update and auth-failure restart behavior still work from the
  API app

The dedicated API app boots `runServeApiFlow` only. HTTP serving, dashboard
rendering, server-owned workflow defaults, and auth-token update restart logic
remain local to the API app boundary.

## Phase 9: Build and Tooling

- [x] Add per-app build scripts
- [x] Add per-app dev scripts
- [x] Update VS Code launch configs to target new app entrypoints
- [x] Update README command examples
- [x] Update docs to describe the multi-process app model

## Phase 10: Migration Cleanup

- [x] Reduce the old top-level `src/index.ts` to a compatibility shim or remove
  it
- [x] Remove deprecated bootstrap glue
- [x] Remove dead imports and stale option wiring
- [x] Re-run architecture review and confirm the boundaries still make sense

The remaining top-level `src/index.ts` is now a minimal compatibility shim that
delegates to the split app bootstraps through `createLegacyProgram()`.

The final cleanup pass removed stale bootstrap-era imports and unused helper
paths without changing behavior. The architecture review still lines up with the
target split: `api` owns HTTP and control-plane mutations, `operator-cli` owns
operator-facing commands, `orchestrator` owns scheduling, `worker` owns stage
execution, and `librarian` remains pinned to one workspace per process.

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
