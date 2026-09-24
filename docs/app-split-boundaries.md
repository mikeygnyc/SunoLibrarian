# App Split Phase 1 Boundaries

This document records the Phase 1 boundary freeze for the app split work.

The goal in this phase is not to move files yet. It is to make the target app
ownership explicit so future changes stop widening the current monolithic
entrypoint.

## Target App Responsibilities

### `api`

- Owns HTTP serving, route registration, dashboard rendering, and auth token
  update endpoints.
- Owns control-plane mutations exposed over HTTP such as submit, cancel, and
  status/log queries.
- Must not start orchestrator, worker, or librarian runtime loops inside the
  server process.

### `operator-cli`

- Owns operator-facing commands such as submit, status, watch, cancel, logs,
  and local auth-token capture.
- May call the HTTP API or shared orchestration helpers.
- Must not become the bootstrap location for service runtimes.

### `orchestrator`

- Owns the orchestrator polling loop only.
- May coordinate runnable work across roles through shared control-plane code.
- Must not serve HTTP or take on worker/librarian runtime ownership.

### `worker`

- Owns worker execution loops only.
- Handles one worker runtime responsibility per process, with role selection
  remaining acceptable during transition.
- Must not serve HTTP or host orchestrator/librarian loops.

### `librarian`

- Owns background metadata synchronization only.
- Target model is one workspace per process.
- Disabled workspaces must not be polled once workspace traffic controls are
  introduced.

## Current Module Classification

This is the current app-only versus reusable-core split based on the existing
`src/` layout.

### App-only modules and concerns

- `src/index.ts`
  - Commander wiring and the temporary all-in-one bootstrap.
- `src/http-api.ts`
  - HTTP route registration and server startup.
- `src/http-dashboard.ts`
  - Dashboard HTML rendering and client bootstrap payload assembly.
- Process startup, signal handling, and app-specific argv/env parsing that is
  currently embedded in `src/index.ts` command definitions.

### Reusable core candidates

- `src/cli-actions.ts`
  - Existing flow entrypoints that can be called from future app bootstraps.
- `src/orchestration/**`
  - Control-plane repositories, orchestration helpers, runtime support, and job
    lifecycle helpers.
- `src/services/**`
  - Auth service, metadata acquisition, asset acquisition, processing planner,
    conversion, and librarian service logic.
- `src/lib/interfaces/**`
  - Shared contracts and typed interfaces.
- `src/lib/metadata/**`
  - Metadata normalization helpers.
- `src/storage.ts`, `src/metadata-store.ts`, `src/process-utils.ts`,
  `src/cancellation.ts`
  - Shared storage and runtime primitives.
- `src/client.ts`, `src/auth.ts`
  - Suno API client and browser token extraction helpers.
- `src/audio-converter.ts`, `src/library-processor.ts`,
  `src/metadata-processor.ts`, `src/converter.ts`
  - Processing and conversion pipeline logic.

## Boundary Rules Confirmed In Phase 1

- One process owns one runtime responsibility.
- `serve-api` stays API-only and does not start runtime loops.
- One librarian process owns one workspace in the target model.
- App bootstraps may depend on shared/core modules, but apps must not import
  each other.
- Workflow submission payloads are distinct from future bootstrap/runtime config
  types.

## Workspace Enable/Disable Decision

Workspace enable/disable state should live in server/operator-controlled
configuration, not in workflow request payloads.

That means:

- the API app and operator CLI may read or mutate that state later
- librarian bootstrap/config should consume explicit workspace ownership plus
  enable/disable policy
- disabled workspaces should generate no background sync traffic

## Immediate Guardrails

Until the new app entrypoints land:

- do not add new bootstrap logic to `src/index.ts`
- do not add runtime loops to `runServeApiFlow`
- prefer adding reusable behavior to shared services or orchestration modules
  instead of to app bootstraps
