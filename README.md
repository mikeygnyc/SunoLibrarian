# suno-export

Unified TypeScript CLI for downloading, processing, and syncing Suno tracks to a local filesystem.

## Install

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
npm run build
npm link
```

Update global install from this repo:

```bash
git pull
npm run build
npm install -g .
```

If installed from npm registry, update with:

```bash
npm update -g suno-export
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

### GLOBAL OPTIONS

- `-V, --version`: print CLI version.
- `-h, --help`: print help for the current scope.

### AUTHENTICATION REQUIREMENT

Commands that access Suno need one of these authentication methods:

- `--token <token>`: use an existing bearer token directly.
- `--browser [url]`: read a bearer token from a Chrome session. If no URL is provided, the CLI uses `http://localhost:9222`.

### TOKEN CACHE

By default, any token supplied with `--token` or captured with `--browser` is saved in the local cache at `~/.suno-export/cache.json`. On later runs, commands that access Suno try the cached token first. If Suno rejects it with `401` or `403`, the CLI falls back to the auth method you passed for that run.

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

### METADATA STORAGE

The authoritative combined song metadata now lives in a SQLite database. By default, the database is created at:

```text
data/suno-export.sqlite
```

Use `--database <path>` on `download`, `sync`, `process`, and `download-images` to store metadata somewhere else. The database stores each song as the same normalized object used by the previous `songs_metadata.json` array, which keeps export compatibility and leaves room for a future Postgres-backed store.

Import an existing current-format JSON file into SQLite:

```bash
suno-export import-metadata-json --input ./downloads/songs_metadata.json
```

Export the SQLite database back to the current JSON format:

```bash
suno-export export-metadata-json --output ./downloads/songs_metadata.json
```

Workflow commands also accept `--import-metadata-json <path>` before running and `--export-metadata-json <path>` after running. `--metadata-file` is retained as a legacy JSON export path used with `--copy-songs-metadata-to-output`; it is no longer the authoritative metadata store.

#### `clear-auth-token`

Clear the cached Suno authentication token.

```text
suno-export clear-auth-token
```

This command removes only the auth token from `~/.suno-export/cache.json`; it does not clear cached tracks, metadata, or the stored device ID.

#### `import-metadata-json`

Import an existing current-format metadata JSON array into the SQLite metadata database.

```text
suno-export import-metadata-json --input <path> [--database <path>]
```

Options:

- `-i, --input <path>`: current-format metadata JSON file. Required.
- `--database <path>`: SQLite metadata database path. Default: `data/suno-export.sqlite`.

#### `export-metadata-json`

Export the SQLite metadata database to the current `songs_metadata.json` array format.

```text
suno-export export-metadata-json --output <path> [--database <path>]
```

Options:

- `-o, --output <path>`: output metadata JSON file. Required.
- `--database <path>`: SQLite metadata database path. Default: `data/suno-export.sqlite`.

#### `download`

Download tracks from Suno.

```text
suno-export download [options]
```

Options:

- `-t, --token <token>`: authentication token.
- `-b, --browser [url]`: connect to an existing Chrome DevTools endpoint (default: `http://localhost:9222`).
- `--ignore-cached-token`: skip the cached auth token and use `--token` or `--browser`.
- `--browser-profile <dir>`: Chrome user data directory for a launched browser.
- `-w, --workspace <id>`: only process the given workspace ID.
- `-f, --format <format>`: audio download format, `mp3` or `wav`. Default: `wav`.
- `-o, --output <dir>`: output root directory. Default: OS Downloads directory + `/suno-export` (for example, `~/Downloads/suno-export`).
- `--database <path>`: SQLite metadata database path. Default: `data/suno-export.sqlite`.
- `--import-metadata-json <path>`: import current-format metadata JSON into the database before running.
- `--export-metadata-json <path>`: export the database to current-format JSON after running.
- `--metadata-file <path>`: legacy JSON export path used by `--copy-songs-metadata-to-output`.
- `--copy-songs-metadata-to-output`: export finalized `songs_metadata.json` to output on completion.
- `--no-metadata`: skip metadata sidecar file behavior.
- `--created-after <date>`: include only tracks created on/after this date.
- `--created-before <date>`: include only tracks created on/before this date.
- `--delay <ms>`: delay between downloads in milliseconds. Default: `1000`.
- `--flush-cache`: clear local cache before running.

#### `sync`

Run download and processing in one workflow.

```text
suno-export sync [options]
```

Options:

- `-t, --token <token>`: authentication token.
- `-b, --browser [url]`: connect to an existing Chrome DevTools endpoint (default: `http://localhost:9222`).
- `--ignore-cached-token`: skip the cached auth token and use `--token` or `--browser`.
- `--browser-profile <dir>`: Chrome user data directory for a launched browser.
- `-w, --workspace <id>`: only process the given workspace ID.
- `-f, --format <format>`: download format, `mp3` or `wav`. Default: `wav`.
- `-o, --output <dir>`: download/output root for source files. Default: OS Downloads directory + `/suno-export` (for example, `~/Downloads/suno-export`).
- `--database <path>`: SQLite metadata database path. Default: `data/suno-export.sqlite`.
- `--import-metadata-json <path>`: import current-format metadata JSON into the database before running.
- `--export-metadata-json <path>`: export the database to current-format JSON after running.
- `--metadata-file <path>`: legacy JSON export path used by `--copy-songs-metadata-to-output`.
- `--copy-songs-metadata-to-output`: export finalized `songs_metadata.json` to conversion output on completion.
- `--created-after <date>`: include only tracks created on/after this date.
- `--created-before <date>`: include only tracks created on/before this date.
- `--delay <ms>`: delay between downloads in milliseconds. Default: `1000`.
- `--flush-cache`: clear local cache before running.
- `--library <dir>`: final converted library output. Default: same as `--output`.
- `--process-formats <formats>`: output formats CSV for processor. Default: `flac,mp3,alac`.
- `--process-bitrate <kbps>`: MP3 bitrate for processor. Default: `320`.
- `--process-concurrency <n>`: conversion concurrency. Default: `4`.
- `--process-update-concurrency <n>`: metadata/update concurrency. Default: `8`.
- `--process-downloaded-only`: only convert tracks downloaded during this sync run; existing metadata entries are not processed.
- `--no-images`: skip image embedding during conversion.
- `--no-lyrics`: skip lyric embedding during conversion.
- `--exit-on-error`: stop on first conversion error.

Sync behavior note:

- Conversion is queued immediately after each successful download (pipelined flow).

#### `process`

Run audio conversion and metadata embedding on an existing download-style input.

```text
suno-export process -i <path> -o <path> [options]
```

Options:

- `-i, --input <path>`: input root directory. Required.
- `-o, --output <path>`: output root directory. Required.
- `--database <path>`: SQLite metadata database path. Default: `data/suno-export.sqlite`.
- `--import-metadata-json <path>`: import current-format metadata JSON into the database before running.
- `--export-metadata-json <path>`: export the database to current-format JSON after running.
- `--metadata-file <path>`: legacy JSON export path used by `--copy-songs-metadata-to-output`.
- `--copy-songs-metadata-to-output`: export finalized `songs_metadata.json` to output root on completion.
- `--process-formats <formats>`: output formats CSV. Default: `flac,mp3,alac`.
- `--process-bitrate <kbps>`: MP3 bitrate. Default: `320`.
- `--process-concurrency <n>`: processing concurrency. Default: `4`.
- `--process-update-concurrency <n>`: update concurrency. Default: `8`.
- `--no-images`: skip image embedding.
- `--no-lyrics`: skip lyric embedding.
- `--exit-on-error`: exit on processing error.
- `--reconvert-before <iso>`: only reconvert tracks at or before the given timestamp.
- `--reconvert-after <iso>`: only reconvert tracks at or after the given timestamp.
- `--reconvert-missing`: only produce missing formats.

#### `download-images`

Download artwork from a provided list, or discover missing images from metadata.

```text
suno-export download-images [options]
```

Options:

- `-l, --list <file>`: JSON file with objects containing `clipId` and `thumbnail`.
- `-t, --token <token>`: authentication token.
- `-b, --browser [url]`: connect to an existing Chrome DevTools endpoint (default: `http://localhost:9222`).
- `--ignore-cached-token`: skip the cached auth token and use `--token` or `--browser`.
- `--browser-profile <dir>`: Chrome user data directory for a launched browser.
- `-o, --output <dir>`: output root directory. Default: OS Downloads directory + `/suno-export` (for example, `~/Downloads/suno-export`).
- `--database <path>`: SQLite metadata database path. Default: `data/suno-export.sqlite`.
- `--import-metadata-json <path>`: import current-format metadata JSON into the database before running.
- `--export-metadata-json <path>`: export the database to current-format JSON after running.
- `--metadata-file <path>`: legacy JSON export path used by `--copy-songs-metadata-to-output`.
- `--copy-songs-metadata-to-output`: on completion, export finalized `songs_metadata.json` to output root.
- `--fetch-image-list <file>`: discover missing images and write JSON list to file.
- `--fetch-missing`: discover missing images and download them directly.
- `--delay <ms>`: delay between image downloads in milliseconds. Default: `1000`.

Notes:

- You must pass at least one of: `--list`, `--fetch-image-list`, `--fetch-missing`.
- `--fetch-image-list` and `--fetch-missing` use `--output` as the discovery root for images and the configured SQLite metadata database.

#### `list`

List tracks.

```text
suno-export list [options]
```

Options:

- `-t, --token <token>`: authentication token.
- `-b, --browser [url]`: connect to an existing Chrome DevTools endpoint (default: `http://localhost:9222`).
- `--ignore-cached-token`: skip the cached auth token and use `--token` or `--browser`.
- `--browser-profile <dir>`: Chrome user data directory for a launched browser.
- `-w, --workspace <id>`: only list this workspace ID.
- `--json`: emit JSON output.

#### `workspaces`

List workspaces.

```text
suno-export workspaces [options]
```

Options:

- `-t, --token <token>`: authentication token.
- `-b, --browser [url]`: connect to an existing Chrome DevTools endpoint (default: `http://localhost:9222`).
- `--ignore-cached-token`: skip the cached auth token and use `--token` or `--browser`.
- `--browser-profile <dir>`: Chrome user data directory for a launched browser.
- `--json`: emit JSON output.

#### `metadata`

Fetch metadata for one track.

```text
suno-export metadata <trackId> [options]
```

Arguments:

- `<trackId>`: Suno clip/track ID. Required.

Options:

- `-t, --token <token>`: authentication token.
- `-b, --browser [url]`: connect to an existing Chrome DevTools endpoint (default: `http://localhost:9222`).
- `--ignore-cached-token`: skip the cached auth token and use `--token` or `--browser`.
- `--browser-profile <dir>`: Chrome user data directory for a launched browser.

#### `fetch-metadata`

Fetch and cache metadata for tracks.

```text
suno-export fetch-metadata [options]
```

Options:

- `-t, --token <token>`: authentication token.
- `-b, --browser [url]`: connect to an existing Chrome DevTools endpoint (default: `http://localhost:9222`).
- `--ignore-cached-token`: skip the cached auth token and use `--token` or `--browser`.
- `--browser-profile <dir>`: Chrome user data directory for a launched browser.
- `--ids <ids>`: comma-separated list of track IDs to fetch.
- `-w, --workspace <id>`: only process this workspace ID.
- `--created-after <date>`: include only tracks created on/after this date.
- `--created-before <date>`: include only tracks created on/before this date.

Selection modes:

- `--ids` mode: fetch only IDs explicitly provided.
- workspace/date mode: fetch tracks discovered from workspace scope, optionally filtered by creation date.
- `--ids` cannot be combined with `--workspace`, `--created-after`, or `--created-before`.

#### `refresh`

Refresh cached tracks for all workspaces.

```text
suno-export refresh [options]
```

Options:

- `-t, --token <token>`: authentication token.
- `-b, --browser [url]`: connect to an existing Chrome DevTools endpoint (default: `http://localhost:9222`).
- `--ignore-cached-token`: skip the cached auth token and use `--token` or `--browser`.
- `--browser-profile <dir>`: Chrome user data directory for a launched browser.

### DATE FILTER FORMAT

`download`, `sync`, and `fetch-metadata` creation-date filters accept:

- full ISO date-time, for example `2026-02-01T12:00:00Z`
- date-only format `YYYY-MM-DD`

Date-only behavior:

- `--created-after YYYY-MM-DD` is treated as `YYYY-MM-DDT00:00:00.000Z`.
- `--created-before YYYY-MM-DD` is treated as `YYYY-MM-DDT23:59:59.999Z`.
- Using both applies an inclusive range.

### OUTPUT LAYOUT

Download flow writes:

- `mp3/`
- `wav/`
- `metadata/`
- `images/`
- `songs_metadata.json` only when exported with `--export-metadata-json` or `--copy-songs-metadata-to-output`

Process flow reads a download-style input root and writes converted output.

### SONGS METADATA DATABASE LOCATION

- The authoritative metadata database defaults to `data/suno-export.sqlite`.
- Use `--database <path>` with `download`, `sync`, `process`, or `download-images` to override the SQLite database path.
- Use `import-metadata-json` or `--import-metadata-json <path>` to migrate an existing `songs_metadata.json` file into SQLite.
- Use `export-metadata-json` or `--export-metadata-json <path>` to write a compatibility JSON file matching the previous format.
- If `--copy-songs-metadata-to-output` is set, a finalized JSON export is written to the output side only after completion, using `--metadata-file` when provided.

### PROJECT STRUCTURE

- `src/index.ts`: CLI setup, arg parsing, and flow dispatch.
- `src/cli-actions.ts`: CLI action implementations.
- `docs/cli-program-flow.md`: CLI flow diagrams and module/method ownership notes.
- `src/client.ts`: Suno API client + download helpers.
- `src/auth.ts`: browser token extraction (Puppeteer).
- `src/converter.ts`: converter entrypoint used by the CLI.
- `src/metadata-store.ts`: SQLite metadata store plus JSON import/export helpers.
- `src/library-processor.ts`: processing pipeline coordinator.
- `src/audio-converter.ts`: audio conversion (ffmpeg).
- `src/metadata-processor.ts`: metadata/tag embedding + sidecar writes.
- `src/lib/metadata/normalize-metadata.ts`: metadata normalization/tag parsing.
- `src/lib/interfaces/*.ts`: shared interface definitions.
- `src/storage.ts`: local cache/device/auth storage.
- `src/types.ts`: compatibility barrel for interfaces.
