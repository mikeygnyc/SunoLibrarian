# Orchestration Refactor Implementation Phases

## Summary

This document turns the orchestration refactor into delivery phases that can be
implemented incrementally while keeping the current CLI usable. Each phase is
intended to leave the repo in a working state and preserve compatibility with
existing commands unless noted otherwise.

## Phase 1: Foundations and Shared Contracts

Goal: establish the shared types, configuration, and repository structure
without changing command behavior yet.

Deliverables:

- add `src/orchestration/` and `src/logging/` package structure
- define shared interfaces for jobs, stages, work items, leases, runtime
  instances, and structured log entries
- define runtime config types for:
  - local vs distributed mode
  - Postgres control-plane connection
  - shared path mappings
  - heartbeat and lease settings
  - song and conversion concurrency
  - centralized logging options
- add a path abstraction layer for logical roots and mounted shares
- add a logging abstraction with console and database sink interfaces

Acceptance criteria:

- code compiles with new interfaces and no behavior changes to existing flows
- new abstractions are isolated enough that later phases can plug into them
- existing CLI help remains unchanged

## Phase 2: Postgres Control Plane and Centralized Logging Storage

Goal: introduce durable shared state for orchestration and logs.

Deliverables:

- add Postgres-backed orchestration repository for:
  - jobs
  - stages
  - work items
  - worker instances
  - leases
  - status events
- add Postgres-backed log repository for `log_entries`
- define schema creation and migration path for orchestration tables
- implement `DatabaseLogSink` and `LogQueryService`
- add basic CLI-readable log filtering capability, even if minimal

Acceptance criteria:

- orchestration records can be created and read back reliably
- structured logs can be written and filtered by `jobId`, role, and level
- transient log write failures are handled without crashing normal workers

## Phase 3: Local Orchestrator and Job Submission Layer

Goal: move command entrypoints from direct flow execution to job submission and
coordinated local execution.

Deliverables:

- add `JobCoordinator`, `LeaseManager`, `StatusBus`, and `RuntimeRegistry`
- refactor `src/cli-actions.ts` into thin command adapters that submit jobs
- keep existing commands:
  - `download`
  - `process`
  - `sync`
  - `download-images`
  - `fetch-metadata`
  - `refresh`
- add local-mode orchestration path that can run all roles in-process
- add `job-status` and `watch-job`

Acceptance criteria:

- existing commands still work in local mode
- job and stage states are durable and queryable
- authorization always runs before acquisition stages

## Phase 4: Role Extraction from Current Flows

Goal: split current command-oriented logic into explicit services without
changing end-user behavior.

Deliverables:

- extract `AuthorizationService` from current auth logic in `cli-actions.ts`
  and `auth.ts`
- extract `MetadataAcquisitionService` from workspace, track, and metadata
  fetch logic
- extract `AssetAcquisitionService` from audio and image download logic
- extract `ProcessingPlannerService` from top-level processing selection logic
- narrow `Processor` into a conversion-focused `ConversionService` wrapper

Acceptance criteria:

- role boundaries are explicit in code
- services communicate through typed requests, results, status, and log context
- current metadata import and export behavior remains intact

## Phase 5: Enforced Concurrency and Lease Semantics

Goal: enforce the operating rules you specified through durable coordination.

Deliverables:

- global lease for metadata acquisition
- global lease for asset acquisition
- mutual exclusion between metadata and asset acquisition roles
- configurable song-level processing concurrency
- configurable conversion-level concurrency
- worker heartbeat and lease expiry handling for stuck or dead workers

Acceptance criteria:

- no two metadata acquisition workers can run at once
- no two asset acquisition workers can run at once
- metadata and asset acquisition cannot overlap
- processing can run in parallel within configured limits

## Phase 6: Worker Runtime Commands and Distributed Mode

Goal: support separate worker processes or containers using the same control
plane.

Deliverables:

- add `run-orchestrator`
- add `run-worker --role <auth|metadata|asset|processing|conversion>`
- move work polling and lease heartbeat behavior into worker runners
- support shared mounted paths through the path abstraction layer
- make job submission work whether workers are local or remote

Acceptance criteria:

- one CLI can submit a job while a separate process executes it
- work can be resumed or retried after worker loss
- local and distributed modes share the same state model

## Phase 7: Logging Maturity and Operator Readiness

Goal: make centralized logging operationally useful before any dedicated UI is
built.

Deliverables:

- ensure all major lifecycle events emit structured logs
- mirror critical failures to console for last-resort debugging
- add correlation fields consistently across orchestrator and workers
- add minimal CLI support for filtered log retrieval
- document how a future log viewer would consume the query layer

Acceptance criteria:

- operators can answer "what is everything doing?" from durable logs
- logs can be filtered by job, role, worker instance, level, and clip id
- a future log viewer can be built on the existing storage and query contract

## Phase 8: Compatibility Cleanup and Documentation

Goal: finish the transition cleanly and make the new architecture maintainable.

Deliverables:

- preserve or alias existing concurrency flags during transition
- update `README.md` with local and distributed runtime docs
- add an architecture doc showing command submission, orchestration, worker
  roles, and logging flow
- add migration notes for operators moving from single-machine use to Postgres
  and multi-worker deployment

Acceptance criteria:

- command compatibility is documented clearly
- new runtime and logging behavior is discoverable from repo docs
- the refactor is ready for later k8s-specific deployment work without another
  architectural redesign

## Cross-Phase Test Expectations

These checks should expand as phases land:

1. `npm run build`
2. `npm start -- --help`
3. relevant subcommand help for any changed command surface
4. unit tests for state transitions, leases, and log formatting
5. integration tests for Postgres-backed orchestration and log storage
6. regression coverage for existing metadata import, export, download, and
   processing flows

## Defaults and Assumptions

- Existing user-facing commands stay in place and become submission frontends.
- Postgres is the authoritative backend for distributed orchestration and
  centralized logs.
- Shared filesystems remain the transport for downloaded and processed assets.
- Kubernetes remains a deployment target, not a code-level dependency in this
  refactor.
- The filterable log viewer is intentionally out of scope; only the durable log
  model and query path are part of implementation.
