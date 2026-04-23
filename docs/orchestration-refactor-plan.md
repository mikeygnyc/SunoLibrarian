# Modular Orchestration Refactor with Centralized Logging

## Summary

Refactor `suno-export` into explicit orchestration and worker modules that
support both single-machine and distributed execution:

- `traffic cop` orchestrator: accepts CLI intent, creates jobs, enforces
  sequencing and locking, tracks progress
- `authorization` worker: acquires and refreshes auth tokens
- `metadata acquisition` worker: fetches workspaces, tracks, and track metadata
- `asset acquisition` worker: downloads audio and artwork
- `main processing` worker: plans per-song processing work
- `conversion` worker: performs conversion, metadata embedding, and sidecar
  writes

Add centralized structured logging as a first-class subsystem. Console logs
remain for critical local troubleshooting, but every role also emits durable,
queryable log records to a shared store so a future filterable log viewer can
be added without changing worker behavior.

The design should support:

- `local` mode: all roles can run in one process or host
- `distributed` mode: roles run as separate processes or containers coordinated
  through Postgres and shared paths

Postgres is the authoritative control plane for orchestration and centralized
logs in distributed mode.

## Key Changes

### 1. Introduce orchestration services

Add `src/orchestration/` with:

- `JobCoordinator`
  - creates jobs for `download`, `process`, `sync`, `download-images`,
    `fetch-metadata`, and `refresh`
  - decomposes jobs into stages and work items
  - enforces:
    - authorization before any acquisition
    - metadata acquisition and asset acquisition are mutually exclusive globally
    - processing can run in parallel
- `LeaseManager`
  - DB-backed leases for exclusive resources
  - global exclusivity for `metadata-acquisition` and `asset-acquisition`
- `StatusBus`
  - durable job, stage, and work-item status transitions
- `RuntimeRegistry`
  - tracks worker instance id, host or container id, role, heartbeat, and
    capabilities

Use explicit state machines, not implicit flags.

### 2. Split existing flows into role-specific services

Replace large orchestration logic in `src/cli-actions.ts` with thin command
adapters.

Create service boundaries:

- `AuthorizationService`
- `MetadataAcquisitionService`
- `AssetAcquisitionService`
- `ProcessingPlannerService`
- `ConversionService`

`Processor` should become conversion-focused instead of being the top-level
workflow coordinator.

### 3. Add runtime roles and execution modes

Keep current commands as submission frontends, and add runtime commands:

- `suno-export run-orchestrator`
- `suno-export run-worker --role <auth|metadata|asset|processing|conversion>`
- `suno-export job-status <jobId>`
- `suno-export watch-job <jobId>`

Behavior:

- `local` mode: submit and run locally, optionally streaming progress
- `distributed` mode: submit to the Postgres-backed coordinator and optionally
  wait or watch

### 4. Add centralized logging subsystem

Add `src/logging/` with a structured logging pipeline shared by orchestrator
and workers.

Core components:

- `CentralLogger`
  - common logging API used by all modules
  - emits structured log entries with `timestamp`, `level`, `message`, `role`,
    `workerInstanceId`, `jobId`, `stageId`, `workItemId`, `clipId`, and
    optional JSON context
- `LogSink` interface
  - `ConsoleLogSink` for local stderr/stdout and critical operator visibility
  - `DatabaseLogSink` for centralized durable storage
- `LogContext`
  - lightweight context object passed through services so logs are
    automatically correlated
- `LogQueryService`
  - read-side service for future viewer or CLI filtering
  - out of scope to build UI now, but define the filtering contract now

Logging rules:

- all major lifecycle events must be logged centrally
- retries, lease acquisition and release, worker heartbeats, queue blocking,
  per-song processing start and finish, conversion start and finish, and errors
  must emit structured logs
- critical failures should also go to console immediately
- log writes must be best-effort but durable enough for operations; transient
  DB log failures should not crash healthy workers unless explicitly configured
- log schema should be stable and filter-friendly from day one

Recommended initial filters supported by the query layer:

- by `jobId`
- by `role`
- by `workerInstanceId`
- by `level`
- by time range
- by `clipId`
- by workflow type or status

### 5. Standardize shared storage and paths

Introduce:

- `StorageLocation`
- `PathResolver`

Workers operate on logical roots mapped to local paths or mounted network
shares. No object storage in this phase.

### 6. Add orchestration and log persistence schema

Add Postgres tables for orchestration:

- `orchestration_jobs`
- `orchestration_stages`
- `work_items`
- `worker_leases`
- `worker_instances`
- `status_events`

Add centralized log table:

- `log_entries`

`log_entries` should include:

- stable id
- timestamp
- level
- message
- structured context JSON
- workflow type
- job, stage, and work-item ids
- role
- worker instance id
- clip id if applicable
- error code and stack fields when present

Index for common filtering:

- timestamp
- job id
- role
- level
- clip id

### 7. Separate concurrency controls by layer

Replace current loosely coupled concurrency flags with explicit limits:

- acquisition exclusivity
  - metadata acquisition max active = 1 globally
  - asset acquisition max active = 1 globally
- processing song concurrency
- conversion concurrency
- optional metadata update concurrency

Expose config names that match those layers directly.

## Public Interfaces and Commands

Add orchestration and logging config:

- runtime mode: `local | distributed`
- coordinator and log backend: Postgres URL
- shared path definitions
- worker heartbeat and lease durations
- song-level and conversion-level concurrency
- centralized logging enable or disable
- log level threshold
- optional console mirroring policy

Keep existing commands intact as submission entrypoints.

Add new commands:

- `run-orchestrator`
- `run-worker`
- `job-status`
- `watch-job`
- optional `logs`
  - CLI-only query surface for centralized logs
  - no UI or viewer yet, but useful for validation and future integration

## Test Plan

Core orchestration scenarios:

1. authorization completes before acquisition starts
2. metadata acquisition lease prevents concurrent metadata workers
3. asset acquisition lease prevents concurrent asset workers
4. metadata and asset acquisition cannot overlap
5. processing respects song-level concurrency
6. conversion respects separate conversion concurrency
7. `sync` stages execute in required order
8. worker heartbeat expiry allows lease recovery
9. local and distributed modes share the same transitions

Centralized logging scenarios:

10. every role emits structured logs to the central sink with correlation ids
11. critical errors are mirrored to console even when DB logging is enabled
12. logs remain queryable by `jobId`, role, level, and clip id
13. log sink failure degrades gracefully without silently losing worker
    progress or state
14. retries and stuck or blocked states emit visible central log records
15. CLI log-query command can retrieve filtered results from the log store

Compatibility and regression:

16. existing metadata DB behavior remains compatible
17. existing command names and flags remain usable during the transition

## Assumptions and Defaults

- Postgres is the authoritative shared backend for orchestration and
  centralized logs in distributed mode.
- Shared filesystem mounts remain the file transport mechanism.
- Console logging remains enabled for critical issues and local debugging, but
  structured central logging is the operational source of truth.
- A filterable log viewer UI is out of scope now; this plan only requires
  durable structured logs plus a queryable read contract.
- Single-machine mode uses the same orchestration and logging contracts so
  later k8s adoption does not require redesign.
- Existing command names and main flags remain unless replaced with
  compatibility aliases.
