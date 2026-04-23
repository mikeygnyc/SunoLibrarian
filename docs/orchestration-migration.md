# Orchestration Migration Notes

These notes are for operators and developers moving from the original
single-process CLI behavior toward the queued orchestration runtime.

## What Stayed the Same

- existing workflow commands still exist: `download`, `sync`, `process`,
  `download-images`, `fetch-metadata`, and `refresh`
- existing authentication options still work
- metadata import and export behavior still works
- the existing processing concurrency flags are still accepted

If you were running direct local commands before, the default experience is
still close to that original behavior because `--runtime-mode` defaults to
`local`.

## What Changed

Workflow commands now submit durable jobs before work runs. That enables:

- job status inspection from another process
- durable centralized orchestration logs
- separate orchestrator and worker processes
- later migration to a Postgres-backed multi-machine control plane

New operational commands:

- `run-orchestrator`
- `run-worker --role ...`
- `job-status`
- `watch-job`
- `logs`

## Single-Machine Usage

For a one-machine setup, the simplest option is to keep using the workflow
commands directly:

```bash
suno-export sync --browser http://localhost:9222 --output ./downloads
```

That still submits a job, but the current process also executes it.

If you want the same machine to behave more like a distributed runtime, submit
and execute separately:

```bash
suno-export sync --runtime-mode distributed --submit-only --output ./downloads
suno-export run-orchestrator
```

Inspect progress:

```bash
suno-export watch-job <job-id>
suno-export logs --job-id <job-id>
```

## Shared Storage Expectations

The orchestration model assumes downloaded and processed files live on paths
that all participating workers can access.

Current practical setups:

- plain local directories on one machine
- a network share mounted at the same or well-known path on each machine or
  container

The file layout should remain stable even as the control plane moves from local
storage to Postgres.

## Concurrency Compatibility

The original processing flags remain available:

- `--process-concurrency`
- `--process-update-concurrency`

During the transition, treat them as compatibility flags that feed the newer
orchestration model:

- `--process-concurrency`: processing-stage parallelism
- `--process-update-concurrency`: conversion/update parallelism

That preserves current CLI workflows while keeping room for clearer role-level
settings later.

## Current Local Runtime Limitations

The current queued runtime can use separate local processes, but the shared
state is still file-backed. That means it is useful for:

- local development
- one-machine automation
- proving out orchestration behavior

It is not the final multi-machine deployment model yet.

## Preparing for Postgres and Multi-Worker Deployment

When moving beyond a single machine, plan for:

- Postgres as the authoritative control plane
- shared mounted paths for downloads and processed assets
- separate processes or containers for orchestrator and workers
- log collection and filtering through the centralized structured log store

The intended deployment shape is:

1. submit jobs from any CLI instance
2. let orchestrator and worker processes claim work through Postgres
3. keep files on shared mounts
4. surface operational state through `job-status`, `watch-job`, and the log
   query layer

## Kubernetes Direction

Kubernetes remains a deployment concern rather than a code dependency.

The refactor is intentionally structured so later k8s work can focus on:

- how orchestrator and worker containers are launched
- how shared paths are mounted
- how Postgres credentials are supplied
- how logs are surfaced through an external viewer

without changing the command or worker model again.
