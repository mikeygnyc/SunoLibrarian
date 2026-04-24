# App Split Checklist

This checklist turns the app split plan into a concrete execution sequence.

## Phase 1: Boundary Freeze

- [ ] Write down the responsibility of each target app:
  - `api`
  - `operator-cli`
  - `orchestrator`
  - `worker`
  - `librarian`
- [ ] Identify current modules that are app-only versus reusable core
- [ ] Stop adding new bootstrap logic to `src/index.ts`
- [ ] Stop adding any runtime loops to `serve-api`
- [ ] Confirm the rule that one process owns one runtime responsibility

## Phase 2: New Entrypoints

- [ ] Create `apps/api/src/main.ts`
- [ ] Create `apps/operator-cli/src/main.ts`
- [ ] Create `apps/orchestrator/src/main.ts`
- [ ] Create `apps/worker/src/main.ts`
- [ ] Create `apps/librarian/src/main.ts`
- [ ] Point each new entrypoint at existing implementation functions first
- [ ] Keep the old entrypoint working during the transition
- [ ] Add temporary compatibility scripts if needed

## Phase 3: Config Cleanup

- [ ] Introduce `ApiServerConfig`
- [ ] Introduce `OperatorCliConfig`
- [ ] Introduce `OrchestratorConfig`
- [ ] Introduce `WorkerConfig`
- [ ] Introduce `LibrarianConfig`
- [ ] Reduce direct reliance on broad `CliOptions` in app bootstraps
- [ ] Separate workflow submission payloads from bootstrap/runtime config

## Phase 4: Shared Contracts

- [ ] Move HTTP API contracts into shared core/contracts
- [ ] Move orchestration interfaces into shared core/contracts
- [ ] Keep dashboard/client types importing shared contracts only
- [ ] Remove app-local duplicates of shared types if any appear

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
- [ ] `operator-cli` can submit jobs, inspect jobs, cancel jobs, and capture
  auth tokens
- [ ] job submission still works end to end
- [ ] auth token updates still restart recent auth-blocked jobs correctly
- [ ] logging and status queries still work across separated apps

## Suggested First Implementation Slice

If doing this incrementally, start here:

- [ ] add separate app entrypoints
- [ ] move `serve-api` bootstrap under `apps/api`
- [ ] move `run-orchestrator` bootstrap under `apps/orchestrator`
- [ ] move `run-worker` bootstrap under `apps/worker`
- [ ] move `run-librarian` bootstrap under `apps/librarian`
- [ ] move `capture-auth-token` and operator utilities under `apps/operator-cli`

That slice gives the architectural win early, even before deeper module moves.
