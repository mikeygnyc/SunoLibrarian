# Suno Track Exporter CLI

CLI for downloading Suno tracks and metadata. It can run standalone, or chain directly into the converter.

## Role In This Repo

- `cli/`: fetches tracks/metadata/images from Suno
- `converter/`: processes downloaded audio and embeds metadata
- `extension/`: browser extension alternative to the CLI

Recommended flow:
1. Download with `suno-export download` (or use `suno-export sync` to chain both steps)
2. Process with `suno-process` (if not using `sync`)

## Install

```bash
cd cli
npm install
npm run build
```

Global install (optional):

```bash
npm install -g .
```

## Commands

### `download`

Download tracks as `mp3` or `wav`, persist `songs_metadata.json`, save per-track JSON sidecars, and download artwork.

```bash
suno-export download --token YOUR_TOKEN --output ./downloads
```

Options:
- `-t, --token <token>` auth token (if omitted, browser token extraction is used)
- `-b, --browser <url>` connect to existing Chrome instance
- `-w, --workspace <id>` only process one workspace
- `-f, --format <format>` `mp3` or `wav` (default: `mp3`)
- `-o, --output <dir>` output root (default: `./downloads`)
- `--delay <ms>` delay between downloads (default: `1000`)
- `--flush-cache` clear local cache before run
- `--no-metadata` compatibility flag (currently no behavior change)

### `sync`

Runs `download`, then launches converter (`converter/dist/index.js`) in the same workflow.

```bash
suno-export sync --token YOUR_TOKEN --output ./downloads --library ./library
```

Converter must be built first:

```bash
cd converter
npm install
npm run build
```

`sync` accepts download options plus converter options:
- `--library <dir>`
- `--process-formats <formats>`
- `--process-bitrate <kbps>`
- `--process-concurrency <n>`
- `--process-update-concurrency <n>`
- `--no-images`
- `--no-lyrics`
- `--exit-on-error`
- `--reconvert-before <iso>`
- `--reconvert-after <iso>`
- `--reconvert-missing`

### `download-images`

Downloads artwork from a JSON list (typically produced by converter `--image-list`).

```bash
suno-export download-images --list ./downloads/image-list.json --token YOUR_TOKEN
```

Behavior:
- prefers `image_large_url` (`*_large`) for each clip
- if image download fails and `clipId` exists, CLI attempts artwork regeneration from the song page, then retries download

Options:
- `-l, --list <file>` JSON file with `{ clipId, thumbnail }[]` (required)
- `-t, --token <token>`
- `-b, --browser <url>`
- `-o, --output <dir>` (default: `./downloads`)
- `--delay <ms>` (default: `1000`)

### Other Commands

- `list` list tracks (supports `--json`)
- `workspaces` list workspaces (supports `--json`)
- `metadata <trackId>` fetch one track metadata payload
- `fetch-metadata` fetch/cache metadata for all tracks in selected workspaces
- `refresh` refresh cached tracks for all workspaces

## Output Layout

Default output root is `./downloads`:

```text
downloads/
├── mp3/
├── wav/
├── images/
├── metadata/
└── songs_metadata.json
```

This is compatible with converter input expectations.

## Token Retrieval

Automatic: run a command without `--token`; browser flow extracts token.

Manual:
1. Open `https://suno.com` and log in
2. Open DevTools Network tab
3. Find a request to `studio-api.prod.suno.com`
4. Copy `Authorization: Bearer ...` token value

## Development

```bash
cd cli
npm install
npm run dev -- download --token YOUR_TOKEN
npm run build
npm start -- list --token YOUR_TOKEN
```
