# suno-export

Unified TypeScript CLI for downloading, processing, and syncing Suno tracks to a local filesystem.

## Install

```bash
npm install
npm run build
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

Build once, then install globally from this repo:

```bash
npm run build
npm install -g .
```

After that, run directly from any shell:

```bash
suno-export --help
```

If you are actively developing this repo and want a global command that tracks local changes, use:

```bash
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

### GLOBAL OPTIONS

- `-V, --version`: print CLI version.
- `-h, --help`: print help for the current scope.

### AUTHENTICATION REQUIREMENT

For commands that include `--token` / `--browser` options, at least one must be provided.
When `--browser` is provided without a value, it defaults to `http://localhost:9222`.

### BROWSER SESSION SETUP (`--browser`)

Use this when you want the CLI to read auth from a live Chrome session instead of passing `--token`.

1. Start Chrome in remote-debug mode with a dedicated temp profile directory.
2. Open `https://suno.com` in that browser and complete login.
3. Keep that Chrome instance running while you run `suno-export ... --browser [url]`.

If a specified browser endpoint is unavailable, the CLI will automatically launch a local Chrome debug session (OS-appropriate defaults) and continue.

macOS example:

```bash
TMP_PROFILE="$(mktemp -d /tmp/suno-export-chrome.XXXXXX)"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$TMP_PROFILE"
```

Linux example:

```bash
TMP_PROFILE="$(mktemp -d /tmp/suno-export-chrome.XXXXXX)"
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$TMP_PROFILE"
```

Windows PowerShell example:

```powershell
$tmp = New-Item -ItemType Directory -Path ([System.IO.Path]::GetTempPath()) -Name ("suno-export-chrome-" + [guid]::NewGuid())
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$($tmp.FullName)"
```

Use it in commands:

```bash
suno-export list --browser http://localhost:9222
suno-export download --browser http://localhost:9222 --output ./downloads
```

Verification and troubleshooting:

- Confirm the debug endpoint is reachable: `http://localhost:9222/json/version`
- If connection fails, make sure the debug Chrome process is still running.
- If the endpoint is unavailable, the CLI automatically falls back to launching a local debug browser session.
- If login state is wrong/stale, stop Chrome, delete the temp profile directory, and start again.

### COMMANDS

#### `download`

Download tracks from Suno.

```text
suno-export download [options]
```

Options:

- `-t, --token <token>`: authentication token.
- `-b, --browser [url]`: connect to an existing Chrome DevTools endpoint (default: `http://localhost:9222`).
- `-w, --workspace <id>`: only process the given workspace ID.
- `-f, --format <format>`: audio download format, `mp3` or `wav`. Default: `wav`.
- `-o, --output <dir>`: output root directory. Default: OS Downloads directory + `/suno-export` (for example, `~/Downloads/suno-export`).
- `--copy-songs-metadata-to-output`: copy finalized `songs_metadata.json` to output on completion.
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
- `-w, --workspace <id>`: only process the given workspace ID.
- `-f, --format <format>`: download format, `mp3` or `wav`. Default: `wav`.
- `-o, --output <dir>`: download/output root for source files. Default: OS Downloads directory + `/suno-export` (for example, `~/Downloads/suno-export`).
- `--copy-songs-metadata-to-output`: copy finalized `songs_metadata.json` to conversion output on completion.
- `--created-after <date>`: include only tracks created on/after this date.
- `--created-before <date>`: include only tracks created on/before this date.
- `--delay <ms>`: delay between downloads in milliseconds. Default: `1000`.
- `--flush-cache`: clear local cache before running.
- `--library <dir>`: final converted library output. Default: same as `--output`.
- `--process-formats <formats>`: output formats CSV for processor. Default: `flac,mp3,alac`.
- `--process-bitrate <kbps>`: MP3 bitrate for processor. Default: `320`.
- `--process-concurrency <n>`: conversion concurrency. Default: `4`.
- `--process-update-concurrency <n>`: metadata/update concurrency. Default: `8`.
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
- `--copy-songs-metadata-to-output`: copy finalized `songs_metadata.json` to output root on completion.
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
- `-o, --output <dir>`: output root directory. Default: OS Downloads directory + `/suno-export` (for example, `~/Downloads/suno-export`).
- `--copy-songs-metadata-to-output`: on completion, verify/copy finalized `songs_metadata.json` to output root.
- `--fetch-image-list <file>`: discover missing images and write JSON list to file.
- `--fetch-missing`: discover missing images and download them directly.
- `--delay <ms>`: delay between image downloads in milliseconds. Default: `1000`.

Notes:

- You must pass at least one of: `--list`, `--fetch-image-list`, `--fetch-missing`.
- `--fetch-image-list` and `--fetch-missing` use `--output` as the discovery root for `songs_metadata.json` and image folders.

#### `list`

List tracks.

```text
suno-export list [options]
```

Options:

- `-t, --token <token>`: authentication token.
- `-b, --browser [url]`: connect to an existing Chrome DevTools endpoint (default: `http://localhost:9222`).
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

#### `fetch-metadata`

Fetch and cache metadata for tracks.

```text
suno-export fetch-metadata [options]
```

Options:

- `-t, --token <token>`: authentication token.
- `-b, --browser [url]`: connect to an existing Chrome DevTools endpoint (default: `http://localhost:9222`).
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
- `songs_metadata.json`

Process flow reads a download-style input root and writes converted output.

### SONGS METADATA FILE LOCATION

- The authoritative `songs_metadata.json` is maintained on the input side.
- Backups (`songs_metadata.json.<timestamp>.bak`) are created on the input side only.
- If `--copy-songs-metadata-to-output` is set, a finalized copy is written to the output side only after completion.

### PROJECT STRUCTURE

- `src/index.ts`: CLI setup, arg parsing, and flow dispatch.
- `src/cli-actions.ts`: CLI action implementations.
- `src/client.ts`: Suno API client + download helpers.
- `src/auth.ts`: browser token extraction (Puppeteer).
- `src/converter.ts`: converter entrypoint used by the CLI.
- `src/library-processor.ts`: processing pipeline coordinator.
- `src/audio-converter.ts`: audio conversion (ffmpeg).
- `src/metadata-processor.ts`: metadata/tag embedding + sidecar writes.
- `src/lib/metadata/normalize-metadata.ts`: metadata normalization/tag parsing.
- `src/lib/interfaces/*.ts`: shared interface definitions.
- `src/storage.ts`: local cache/device/auth storage.
- `src/types.ts`: compatibility barrel for interfaces.
