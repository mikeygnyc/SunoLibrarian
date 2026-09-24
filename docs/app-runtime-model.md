# App Runtime Model

This project now exposes separate app entrypoints for the major runtime
responsibilities while staying in a single repository.

## App Entry Points

- `apps/api`
  - HTTP API server
  - dashboard rendering
  - control-plane mutations exposed over HTTP

- `apps/operator-cli`
  - operator-facing workflow submission
  - job status, watch, cancel, and log queries
  - auth token capture and local utility commands

- `apps/orchestrator`
  - orchestrator polling loop only

- `apps/worker`
  - worker runtime for a single worker role per process

- `apps/librarian`
  - workspace-scoped metadata sync
  - one workspace per process
  - disabled workspaces skipped before sync work begins

## Common Scripts

Development entrypoints:

- `npm run dev:api -- --host 127.0.0.1 --port 3000`
- `npm run dev:operator -- --help`
- `npm run dev:orchestrator -- --control-plane postgres --postgres-url "$SUNO_EXPORT_CONTROL_PLANE_POSTGRES_URL"`
- `npm run dev:worker -- --role auth --control-plane postgres --postgres-url "$SUNO_EXPORT_CONTROL_PLANE_POSTGRES_URL"`
- `npm run dev:librarian -- --workspace <workspaceId> --browser http://localhost:9222`

Built entrypoints:

- `npm run start:api -- --help`
- `npm run start:operator -- --help`
- `npm run start:orchestrator -- --help`
- `npm run start:worker -- --help`
- `npm run start:librarian -- --help`

Build aliases:

- `npm run build:api`
- `npm run build:operator`
- `npm run build:orchestrator`
- `npm run build:worker`
- `npm run build:librarian`

## Multi-Process Example

```bash
npm run dev:api -- --host 127.0.0.1 --port 3000
npm run dev:orchestrator -- --control-plane postgres --postgres-url "$SUNO_EXPORT_CONTROL_PLANE_POSTGRES_URL"
npm run dev:worker -- --role auth --control-plane postgres --postgres-url "$SUNO_EXPORT_CONTROL_PLANE_POSTGRES_URL"
npm run dev:worker -- --role asset --control-plane postgres --postgres-url "$SUNO_EXPORT_CONTROL_PLANE_POSTGRES_URL"
npm run dev:librarian -- --workspace <workspaceId> --browser http://localhost:9222
```

## Boundary Rules

- `api` does not start orchestrator, worker, or librarian loops
- `operator-cli` does not bootstrap service processes
- each worker process owns one worker role
- each librarian process owns one workspace
