# suno-export

TypeScript tools for downloading Suno tracks, converting a local music library, and running API-backed workflows with separate workers.

## Project Status

The current implementation supports two workflow targets:

- **Local filesystem:** `download`, `process`, and `sync` run directly against `target.localRoot`, with metadata in `songs_metadata.json`.
- **HTTP API:** `target.apiUrl` submits durable jobs for separate runtime processes. Postgres stores workflow state and MQTT dispatches work.

Implemented features include MP3/WAV downloads, FLAC/MP3/ALAC conversion, metadata and artwork processing, browser authentication, an HTTP API and dashboard, workspace librarians, and workers for `auth`, `metadata`, `asset`, and `conversion`. Kubernetes deployment includes a `SunoExportCluster` operator, shared runtime image, local manifest bootstrap, and optional Filebeat/Elasticsearch logging.

The architecture simplification is implemented. The [architecture checklist](docs/architecture-simplification-checklist.md) still lists live API job completion, worker execution, librarian sync, and expanded API-first coverage as follow-up verification. The [operational checklist](docs/remaining-work-todo.md) records completed Kubernetes/ELK hardening and a successful local logging smoke test on August 7, 2026; that is separate from end-to-end workflow validation.

The CLI no longer exposes `run-supervisor`, `run-orchestrator`, `--runtime-mode`, or `--submit-only`.

## Config-First Usage

The CLI now prefers loading settings from `suno-export.config.json` in the current working directory. Settings can come from config or CLI flags; explicit CLI flags win for that run. Commands still require their relevant target, arguments, and runtime settings. Use `--config <path>` to select another config file.

Example:

```json
{
  "target": {
    "localRoot": "./downloads"
  },
  "defaults": {
    "browser": "http://localhost:9222",
    "format": "wav",
    "processFormats": "flac,mp3,alac",
    "processBitrate": "320"
  },
  "commands": {
    "sync": {
      "library": "./library"
    }
  }
}
```

With that file in place and a logged-in Suno browser session available, run:

```bash
npm start -- sync
```

And one-off overrides still work:

```bash
npm start -- sync --workspace another-workspace --format mp3
```

Use `runtime` for shared process-level settings such as `postgresUrl`, `mqttUrl`,
`mqttTopicPrefix`, `host`, `port`, or common runtime paths. Keep per-command
overrides under `commands`.

For distributed operation, `mqttUrl` is required. MQTT is the live control-plane
transport for librarian/worker coordination, while Postgres remains the durable
workflow and metadata store.

`target` must contain exactly one of `localRoot` or `apiUrl`. Relative config paths, including `localRoot`, resolve from the config file's directory. `download`, `process`, and `sync` require a target; `--output` alone does not select local mode.

For API mode, use a separate config such as:

```json
{
  "target": {
    "apiUrl": "http://127.0.0.1:3000"
  }
}
```

## Install

Prerequisites: `nvm`, Node.js 24 (pinned in `.nvmrc`), and `ffmpeg` on `PATH` for conversion. Suno access requires a valid token or a logged-in Chrome session. Distributed operation also requires Postgres, MQTT, and filesystem access to the configured asset roots.

The install script selects the Node version through `nvm`, installs dependencies, builds, and checks CLI help.

```bash
./scripts/install.sh
```

Run the built CLI:

```bash
npm start -- --help
```

Run in dev mode:

```bash
npm run dev -- --help
```

### Global Install (Direct CLI Command)

Install dependencies, build, and install globally from this repo:

```bash
./scripts/install-global.sh
```

After that, run directly from any shell:

```bash
suno-export --help
```

If you are actively developing this repo and want a global command that tracks local changes, use:

```bash
source ~/.nvm/nvm.sh
nvm use
npm run build
npm link
```

Update global install from this repo:

```bash
git pull
npm run build
npm install -g .
```

Uninstall global command:

```bash
npm uninstall -g suno-export
```

If installed via link:

```bash
npm unlink -g suno-export
```

Man page support:

- On Unix-like systems with `man` available, global install adds a `suno-export(1)` man page automatically.
- View it with:

```bash
man suno-export
```

## Manual Page

### NAME

`suno-export` - download, process, and sync Suno tracks.

### SYNOPSIS

```text
suno-export [--version] [--help] <command> [command options] [arguments]
```

### DESCRIPTION

`suno-export` is a unified CLI with commands for:

1. Downloading tracks, metadata, and artwork from Suno.
2. Processing downloaded assets into library formats.
3. Running combined workflows (`sync` = `download` + `process`).

When using default output paths, required directories are created automatically if missing.

For a diagrammed implementation map, see [CLI Program Flow](docs/cli-program-flow.md).
For the orchestration runtime model, see [Orchestration Runtime](docs/orchestration-runtime.md).
For migration guidance, see [Orchestration Migration Notes](docs/orchestration-migration.md).
For the current simplified architecture, see [Architecture Simplification Checklist](docs/architecture-simplification-checklist.md).
For Kubernetes deployment and operator configuration, see [Kubernetes Operator](docs/kubernetes-operator.md).
For ELK-oriented container log aggregation, see [ELK Logging](docs/elk-logging.md).
For generating gitignored local k8s manifests from tracked examples, see [Local K8s Bootstrap](docs/k8s-local-bootstrap.md).
For the current prioritized follow-up work, see [Remaining Work TODO](docs/remaining-work-todo.md).

## HTTP API

The HTTP API requires shared Postgres and MQTT settings, supplied through runtime config, environment variables, or flags:

```bash
npm run dev:api -- --host 127.0.0.1 --port 3000 --postgres-url "$POSTGRES_URL" --mqtt-url "$MQTT_URL"
```

Open `http://127.0.0.1:3000/` for the built-in dashboard shell.
When the dashboard says jobs are waiting on auth, capture a fresh token on the
operator machine with `suno-export capture-auth-token --browser
http://localhost:9222`, then paste it into the Auth panel.

Current endpoints:

- `GET /healthz`: liveness check
- `GET /api/v1/auth/status`: whether a cached token is present
- `POST /api/v1/auth/token`: set cached auth token with JSON body `{ "token": "..." }`
- `DELETE /api/v1/auth/token`: clear cached auth token
- `GET /api/v1/jobs?limit=100`: list submitted jobs
- `POST /api/v1/workflows/:workflow`: submit a validated workflow payload without raw CLI options
- `GET /api/v1/jobs/:jobId`: fetch job snapshot, stages, work items, and status events
- `POST /api/v1/jobs/:jobId/cancel`: cancel a queued or running job
- `GET /api/v1/logs?...`: query centralized logs

The API only handles HTTP and control-plane mutations. Start workers and
librarians as separate processes so each runtime stays focused on one
responsibility. There is no `run-supervisor` command in the current CLI.

Example separate-process setup (run each command in its own terminal with the same `POSTGRES_URL` and `MQTT_URL` values):

```bash
npm run dev:api -- --host 127.0.0.1 --port 3000 --postgres-url "$POSTGRES_URL" --mqtt-url "$MQTT_URL"
npm run dev:worker -- --role auth --postgres-url "$POSTGRES_URL" --mqtt-url "$MQTT_URL"
npm run dev:worker -- --role metadata --postgres-url "$POSTGRES_URL" --mqtt-url "$MQTT_URL"
npm run dev:worker -- --role asset --postgres-url "$POSTGRES_URL" --mqtt-url "$MQTT_URL"
npm run dev:worker -- --role conversion --postgres-url "$POSTGRES_URL" --mqtt-url "$MQTT_URL"
npm run dev:librarian -- --workspace <workspaceId> --browser http://localhost:9222 --database-type postgres --postgres-url "$POSTGRES_URL" --mqtt-url "$MQTT_URL"
```

For code-based callers, a small typed client is available in
[`src/http-api-client.ts`](src/http-api-client.ts).

The dashboard-oriented adapter in
[`src/http-api-dashboard.ts`](src/http-api-dashboard.ts) wraps the client
with workflow-specific submit helpers plus display-friendly job and log view
models.

There is also a small CLI utility layer on top of that client:

```bash
npm run dev:operator -- api-health --api-url http://127.0.0.1:3000
npm run dev:operator -- api-submit process --payload ./process-workflow.json --api-url http://127.0.0.1:3000
npm run dev:operator -- job-status <jobId> --api-url http://127.0.0.1:3000
```

Preferred workflow submission example:

```bash
curl -X POST http://127.0.0.1:3000/api/v1/workflows/process \
  -H 'content-type: application/json' \
  -d '{
    "formats": ["flac", "mp3"],
    "bitrateKbps": 320,
    "embedImages": true,
    "embedLyrics": true
  }'
```

Server-owned settings such as filesystem roots and metadata store configuration are not accepted in workflow requests. Set `--output`, `--library`, and metadata store options on `serve-api`. Workers must have access to the same asset paths. The API does not execute queued work by itself.

### GLOBAL OPTIONS

- `-V, --version`: print CLI version.
- `-h, --help`: print help for the current scope.

### AUTHENTICATION REQUIREMENT

Commands that access Suno need one of these authentication methods:

- `--token <token>`: use an existing bearer token directly.
- `--browser [url]`: read a bearer token from a Chrome session. If no URL is provided, the CLI uses `http://localhost:9222`.

### TOKEN CACHE

By default, any token supplied with `--token` or captured with `--browser` is saved in the local cache at `~/.suno-export/cache.json`. A configured `cacheDir` changes the cache location. On later runs, commands that access Suno try the cached token first. If Suno rejects it with `401` or `403`, the CLI falls back to the auth method you passed for that run.

Use `--ignore-cached-token` when you want to skip the cached token and force the command to use `--token` or `--browser`.

```bash
suno-export list --ignore-cached-token --browser http://localhost:9222
```

Clear only the cached auth token with:

```bash
suno-export clear-auth-token
```

This leaves other cached data, such as tracks, metadata, and device ID, intact.

### BROWSER AUTH (`--browser`)

Use browser auth when you want the CLI to launch or connect to Chrome and capture the token from logged-in Suno requests.

Recommended setup:

1. Create a dedicated Chrome user data directory for this CLI.
2. Launch Chrome with that directory and sign in to `https://suno.com` once.
3. Reuse that directory with `--browser-profile <dir>`.

Example:

```bash
suno-export list \
  --browser http://localhost:9222 \
  --browser-profile "$HOME/.suno-export/chrome-user-data"
```

If the Chrome profile inside that user data directory is named, pass it with `--profile-directory`:

```bash
suno-export list \
  --browser http://localhost:9222 \
  --browser-profile "$HOME/.suno-export/chrome-user-data" \
  --profile-directory "Profile 2"
```

Profile rules:

- `--browser-profile <dir>` should point at a Chrome user data directory.
- `--profile-directory <name>` is optional and names a profile inside that user data directory, such as `Default` or `Profile 2`.
- You may also pass a specific profile directory directly to `--browser-profile`; the CLI will use its parent as `--user-data-dir` and the folder name as `--profile-directory`.
- Do not point `--browser-profile` at Chrome's default user data root, including through a symlink. Recent Chrome versions can open that profile while refusing remote debugging.

### MANUAL BROWSER SETUP

You can also launch Chrome yourself and connect the CLI to it.

macOS example:

```bash
PROFILE="$HOME/.suno-export/chrome-user-data"
mkdir -p "$PROFILE"

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$PROFILE"
```

Linux example:

```bash
PROFILE="$HOME/.suno-export/chrome-user-data"
mkdir -p "$PROFILE"

google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$PROFILE"
```

Windows PowerShell example:

```powershell
$profile = "$env:USERPROFILE\.suno-export\chrome-user-data"
New-Item -ItemType Directory -Force -Path $profile | Out-Null

& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$profile"
```

Use it in commands:

```bash
suno-export list --browser http://localhost:9222
suno-export download --browser http://localhost:9222 --output ./downloads
```

Verification and troubleshooting:

- Confirm the debug endpoint is reachable: `http://localhost:9222/json/version`
- If connection fails, make sure the debug Chrome process is still running and no other process is using port `9222`.
- If login state is wrong or stale, stop Chrome, delete the dedicated CLI profile directory, launch Chrome again, and sign in to Suno.
- If you need a fresh token from browser or `--token`, pass `--ignore-cached-token` or run `suno-export clear-auth-token` first.
- Never log or commit real bearer tokens.

### COMMANDS

### ORCHESTRATION RUNTIME

Workflow commands execute directly against the configured local target or HTTP
API target. Use the API, worker, and librarian entrypoints when operating the
separate runtime processes.

Operational commands:

- `run-worker --role <role>`: execute only one worker role.
- `run-librarian --workspace <id>`: synchronize one pinned workspace.
- `serve-api`: run the HTTP API server.
- `job-status <jobId>`: show the current durable job state.
- `watch-job <jobId>`: watch a job until completion.
- `logs`: query centralized orchestration logs.

Example API health check:

```bash
suno-export api-health --api-url http://127.0.0.1:3000
```

For the runtime process options, use `suno-export serve-api --help`,
`suno-export run-worker --help`, and `suno-export run-librarian --help`.

### METADATA STORAGE

Local `target.localRoot` workflows use `songs_metadata.json` as their metadata store. Downloads create or update it under the download root; `process` reads metadata from the input root. The existing JSON array format remains supported.

Runtime metadata storage and standalone database utilities support SQLite and Postgres. Outside containers, the default SQLite path is `data/suno-export.sqlite`. Use `--database <path>` to override it, or `--database-type postgres --postgres-url <url>` for Postgres. `SUNO_EXPORT_POSTGRES_URL` is also supported for metadata storage. Distributed workflow state uses Postgres independently of the metadata backend.

For database import/export, run these with a config that does not select `target.localRoot`:

```bash
suno-export import-metadata-json --input ./downloads/songs_metadata.json --database ./data/suno-export.sqlite
suno-export export-metadata-json --output ./metadata-export.json --database ./data/suno-export.sqlite
```

#### `clear-auth-token`

Clear the cached Suno authentication token.

```text
suno-export clear-auth-token
```

This command removes only the auth token from `~/.suno-export/cache.json`; it does not clear cached tracks, metadata, or the stored device ID.

#### `capture-auth-token`

Capture a fresh Suno bearer token locally for pasting into the dashboard or API.

```text
suno-export capture-auth-token --browser http://localhost:9222
```

To capture and immediately push the token into the API:

```text
suno-export capture-auth-token --browser http://localhost:9222 --send-to-api --api-url http://127.0.0.1:3000
```

Options:

- `-b, --browser [url]`: connect to an existing Chrome debug session. Required for token capture.
- `--browser-profile <dir>`: Chrome user data directory for launched browser.
- `--profile-directory <name>`: Chrome profile directory inside `--browser-profile`.
- `--save-local`: save the captured token to the local cache after printing it.
- `--send-to-api`: post the captured token to the configured HTTP API after saving it locally.
- `--api-url <url>`: override the HTTP API base URL used by `--send-to-api`. You can also set `target.apiUrl` in the config file instead.
- `--json`: emit `{ "token": "..." }` JSON instead of plain text output.

Config example:

```json
{
  "target": {
    "apiUrl": "http://127.0.0.1:3000"
  },
  "commands": {
    "capture-auth-token": {
      "sendToApi": true
    }
  }
}
```

### WORKFLOW AND UTILITY COMMANDS

Use `suno-export <command> --help` for the current public options. Config keys use camelCase, such as `processFormats` and `processBitrate`; some compatibility flags are hidden from help.

| Command | Current behavior |
| --- | --- |
| `download` | Download MP3 or WAV (default WAV) to a local target, or submit an API job. Supports workspace and creation-date filters. |
| `process` | Convert and embed metadata locally, or submit an API job. Local `--input` and `--output` default to `localRoot`. |
| `sync` | Download and process locally, or submit an API job. Local `--library` defaults to the download output root. |
| `download-images` | API-only artwork workflow. Requires `--list`, `--fetch-image-list`, or `--fetch-missing`. |
| `fetch-metadata` | API-only metadata workflow. Select by `--ids` or workspace/date filters; these selection modes cannot be combined. |
| `refresh` | Submit an API job to refresh cached tracks across workspaces. |
| `list`, `workspaces`, `metadata <trackId>` | Query Suno directly using cached, token, or browser authentication. |
| `import-metadata-json`, `export-metadata-json` | Import/export the compatible metadata JSON array using the selected metadata store. |
| `job-status <jobId>`, `watch-job <jobId>` | Inspect an API job or watch until it completes, fails, or is cancelled. |
| `logs` | Query API-backed centralized logs, with job, role, level, and other filters. |
| `api-health` | Check API liveness. |
| `api-submit <workflow>` | Submit a typed workflow payload using `--payload <file>` (or `-` for stdin). |
| `api-cancel-job <jobId>` | Request cancellation, optionally with `--reason`. |

API-only commands require `target.apiUrl` or `--api-url`; a local target does not execute them locally.

Local examples using the config above:

```bash
suno-export download --workspace <workspaceId> --format wav
suno-export process --input ./downloads --output ./library
suno-export sync --workspace <workspaceId> --library ./library
```

API inspection examples:

```bash
suno-export job-status <jobId> --api-url http://127.0.0.1:3000
suno-export watch-job <jobId> --api-url http://127.0.0.1:3000
suno-export logs --job-id <jobId> --api-url http://127.0.0.1:3000
```

### RUNTIME ENTRYPOINTS

| App | Development script | Built script |
| --- | --- | --- |
| Unified CLI | `npm run dev` | `npm start` |
| Operator CLI | `npm run dev:operator` | `npm run start:operator` |
| HTTP API/dashboard | `npm run dev:api` | `npm run start:api` |
| Worker | `npm run dev:worker` | `npm run start:worker` |
| Workspace librarian | `npm run dev:librarian` | `npm run start:librarian` |
| Kubernetes operator | `npm run dev:k8s-operator` | `npm run start:k8s-operator` |

Pass application arguments after `--`. Each worker owns one role: `auth`, `metadata`, `asset`, or `conversion`. Workers receive MQTT dispatches; `--poll-interval` is a deprecated compatibility flag. `run-librarian` handles one pinned workspace and supports `--once`, workspace allow/deny lists, and `--librarian-interval` (default six hours).

### DATE FILTER FORMAT

`download`, `sync`, and `fetch-metadata` creation-date filters accept:

- full ISO date-time, for example `2026-02-01T12:00:00Z`
- date-only format `YYYY-MM-DD`

Date-only behavior:

- `--created-after YYYY-MM-DD` is treated as `YYYY-MM-DDT00:00:00.000Z`.
- `--created-before YYYY-MM-DD` is treated as `YYYY-MM-DDT23:59:59.999Z`.
- Using both applies an inclusive range.

### OUTPUT LAYOUT

Local downloads create assets as applicable under the selected root:

```text
downloads/
  mp3/
  wav/
  metadata/
  images/
  songs_metadata.json
```

Processing reads a download-style input root and writes converted files to the configured output. Default conversion formats are `flac,mp3,alac`, with MP3 bitrate `320` kbps. API/runtime workflows use their configured metadata store; JSON exports are separate from durable Postgres job state.

## Development and Validation

```bash
source ~/.nvm/nvm.sh
nvm use
npm run build
npm start -- --help
npm start -- download --help
npm start -- process --help
npm start -- sync --help
npm test
```

`npm run build` runs `npm install` followed by TypeScript compilation. `npm run compile` compiles existing dependencies without reinstalling. Output goes to `dist/` (CommonJS, ES2020).

See [Runtime Smoke Test](docs/testing.md) for current runtime startup commands. Live workflow verification needs Postgres, MQTT, shared asset paths, and valid Suno authentication for downloads; CLI help checks do not establish end-to-end runtime health.

## Deployment and Operations

The root `Dockerfile` builds a shared runtime image; `SUNO_EXPORT_APP` selects `cli`, `api`, `operator-cli`, `k8s-operator`, `worker`, or `librarian`. The [container workflow](.github/workflows/container-image.yml) builds on pull requests and publishes on main-branch pushes and version tags.

- [Kubernetes Operator](docs/kubernetes-operator.md): custom resource, API/worker deployments, and workspace librarian jobs.
- [Local K8s Bootstrap](docs/k8s-local-bootstrap.md): generate local manifests from tracked examples and a gitignored environment file.
- [ELK Logging](docs/elk-logging.md): structured runtime logs, secret redaction, Filebeat collection, retention, and the repeatable `scripts/elk-smoke-test.sh` check.
- [Remaining Work TODO](docs/remaining-work-todo.md): operational hardening and recorded local verification.

Older design and migration documents may retain historical runtime examples. Use the current CLI help and runtime smoke-test instructions when launching services.

## Project Structure

- `src/index.ts`, `src/cli-programs.ts`, `src/cli-actions.ts`: CLI entrypoint, command registration, and workflow dispatch.
- `src/cli-config.ts`, `src/workflow-target-config.ts`: config merging and local/API target resolution.
- `src/apps/`: separate API, operator CLI, worker, librarian, and Kubernetes operator entrypoints.
- `src/client.ts`, `src/lib/auth/auth.ts`: Suno API/download client and browser token capture.
- `src/services/`: authentication, acquisition, planning, conversion, and librarian services.
- `src/metadata-store.ts`: file, SQLite, and Postgres metadata stores.
- `src/library-processor.ts`, `src/audio-converter.ts`, `src/metadata-processor.ts`: conversion and metadata pipeline.
- `src/http-api*.ts`, `src/http-dashboard.ts`: HTTP API, typed client, and dashboard.
- `src/orchestration/`, `src/core/`: durable control plane and runtime contracts.
- `src/logging/`: centralized logging and secret sanitization.
- `src/k8s/`, `k8s/`, `scripts/`: operator implementation, manifests, and operational helpers.
- `test/`: automated regression and integration coverage.
