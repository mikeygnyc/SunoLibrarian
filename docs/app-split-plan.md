# App Split Plan

This document proposes a staged refactor from the current single-binary,
many-modes structure toward separate apps with a shared core.

The goal is to reduce boundary confusion without forcing a risky big-bang
rewrite.

## Why Split

The current project has accumulated several distinct runtime concerns:

- HTTP API and dashboard
- operator-facing CLI utilities
- orchestrator control loop
- worker execution loops
- librarian/background metadata sync
- local auth token capture

Those concerns now create friction in a few predictable ways:

- app responsibilities are too easy to blur
- command/config surfaces are larger than they need to be
- deployment shape is harder to reason about
- process boundaries can drift unless enforced deliberately
- future k8s packaging becomes less obvious

The recent `serve-api` discussion is a good example. The architecture wants the
API to stay API-only, but the current repo shape makes it too easy for runtime
loops to creep in.

## Recommendation

Split the project into separate apps inside the same repository before
considering multiple repositories.

That means:

1. keep one repo
2. create separate app entrypoints/packages
3. move shared logic into a reusable core package

This gives clearer boundaries without adding multi-repo release overhead.

## Target Structure

Suggested high-level layout:

```text
apps/
  api/
  operator-cli/
  orchestrator/
  worker/
  librarian/
packages/
  core/
```

Suggested responsibilities:

- `apps/api`
  - HTTP API
  - built-in dashboard
  - auth token update endpoint
  - job submission/status/cancel/logs endpoints
  - no orchestrator, worker, or librarian loops

- `apps/operator-cli`
  - submit workflows
  - inspect jobs/logs
  - cancel jobs
  - local token capture utility
  - other operator convenience commands

- `apps/orchestrator`
  - orchestrator loop only
  - no HTTP serving
  - no worker execution outside orchestrator role

- `apps/worker`
  - worker runtime only
  - likely keeps `--role` initially
  - can later split into separate worker apps if useful

- `apps/librarian`
  - background metadata sync for one workspace per process
  - no multi-workspace ownership inside a single librarian process

- `packages/core`
  - orchestration repositories and helpers
  - metadata store
  - workflow contracts
  - auth/browser token helpers
  - reusable services
  - shared logging and config primitives

## Boundary Rules

These rules should become explicit and enforced during the refactor:

- apps do not import other apps
- apps may import `packages/core`
- HTTP handlers do not start long-running runtime loops
- worker/orchestrator/librarian processes each own one runtime responsibility
- each librarian process owns at most one workspace
- workflow request contracts are distinct from process/bootstrap config
- operator-facing CLI commands are distinct from service processes

## Librarian Model

The target librarian model should be workspace-scoped rather than one process
rotating across all workspaces.

That means:

- one librarian process should be configured for one workspace
- multiple workspaces should be handled by multiple librarian processes
- the system should support disabling specific workspaces entirely to reduce
  unnecessary traffic

This is a better fit for operational clarity and deployment:

- each librarian has explicit ownership boundaries
- a busy or noisy workspace does not interfere with others
- low-value workspaces can be disabled cleanly
- k8s packaging becomes straightforward because workspace ownership is already
  process-scoped

Recommended rules:

- a workspace must be explicitly selected for each librarian process
- disabled workspaces must not be polled or refreshed by background sync
- workspace enable/disable state should live in server/operator-controlled
  config rather than workflow request payloads

The current rotating-across-workspaces librarian behavior should therefore be
treated as transitional rather than target architecture.

## Refactor Strategy

Do this in phases, starting with entrypoints rather than moving all logic at
once.

### Phase 1: Define and Freeze Boundaries

Before moving files:

- define the responsibility of each app
- define which modules are core versus app-only
- stop adding new cross-boundary coupling

App-only code should include:

- Commander wiring
- HTTP route registration
- dashboard HTML rendering/bootstrap
- process startup and signal handling
- env/argv parsing specific to an app

Core code should include:

- orchestration repositories
- job submission helpers
- workflow stage plans
- metadata acquisition, asset acquisition, conversion, and processing services
- auth service and browser token extraction helpers
- HTTP request/response contracts
- storage and logging primitives

### Phase 2: Split Entrypoints First

This is the first real implementation milestone.

Create separate entrypoints for:

- `apps/api/src/main.ts`
- `apps/operator-cli/src/main.ts`
- `apps/orchestrator/src/main.ts`
- `apps/worker/src/main.ts`
- `apps/librarian/src/main.ts`

Initially, those entrypoints can call the existing implementation functions.

That means we get:

- separate runnable processes
- cleaner deployment model
- smaller app-level bootstrap files

without immediately rewriting the internal modules.

### Phase 3: Introduce Narrow App Config Types

The current `CliOptions` shape is flexible, but it is also too broad.

Introduce narrower config objects such as:

- `ApiServerConfig`
- `OperatorCliConfig`
- `OrchestratorConfig`
- `WorkerConfig`
- `LibrarianConfig`

This should happen before or alongside deeper module extraction so the app
boundaries become visible in types, not just folders.

For the librarian, the config should be workspace-scoped and include workspace
traffic controls. For example:

- `workspaceId`
- `enabledWorkspaces`
- `disabledWorkspaces`
- sync interval settings

### Phase 4: Extract Shared Contracts and Core Modules

Move reusable code into `packages/core` in slices:

1. contracts and interfaces
2. orchestration runtime helpers
3. metadata store and persistence
4. reusable services
5. logging/config helpers

Do not attempt to move everything in one pass.

### Phase 5: Simplify Scripts and Packaging

Once the app entrypoints exist:

- add per-app build/dev scripts
- update VS Code debug configs
- make deployment commands map directly to runtime responsibilities

Examples:

- `npm run dev:api`
- `npm run dev:operator`
- `npm run dev:orchestrator`
- `npm run dev:worker -- --role auth`
- `npm run dev:librarian`

## Suggested Folder Mapping

A practical first folder mapping could look like this:

```text
apps/
  api/
    src/main.ts
  operator-cli/
    src/main.ts
  orchestrator/
    src/main.ts
  worker/
    src/main.ts
  librarian/
    src/main.ts
packages/
  core/
    src/orchestration/
    src/services/
    src/contracts/
    src/logging/
    src/storage/
```

If a full folder move is too disruptive at first, a temporary bridge layout is
also fine:

```text
src/apps/api/
src/apps/operator-cli/
src/apps/orchestrator/
src/apps/worker/
src/apps/librarian/
src/core/
```

That can later be promoted into `apps/` and `packages/`.

## Recommended Migration Order

Use this order:

1. split app entrypoints
2. add app-specific config types
3. move shared contracts
4. move orchestration modules
5. move reusable services
6. shrink the old top-level bootstrap
7. remove deprecated glue

This order is intentionally biased toward lower-risk progress.

## What Not To Do Yet

Avoid these for now:

- splitting into separate repos
- rewriting every import in one pass
- redesigning every service interface before app boundaries exist
- coupling repo-structure refactors to k8s packaging changes

## First Milestone Definition of Done

The first milestone is complete when:

- `serve-api` is its own app entrypoint
- orchestrator has its own app entrypoint
- worker has its own app entrypoint
- librarian has its own app entrypoint
- librarian processes are workspace-scoped rather than all-workspace rotators
- operator utilities are no longer bootstrapped from the same app entrypoint as
  service processes
- no app imports another app
- shared logic still works from one common core location

## Longer-Term Follow-Ons

Once the split is in place, the next likely improvements are:

- package-level tests for core modules
- app-specific config validation
- thinner app bootstraps with explicit DI/dependencies
- cleaner container images and k8s deployment definitions per app
- workspace enable/disable policy for librarians to reduce unnecessary sync
  traffic
- possible later split of `worker` into role-specific apps if that becomes
  operationally useful
