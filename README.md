# suno-export

Unified TypeScript CLI for downloading, processing, and syncing Suno tracks.

## Install

Use `nvm` before running Node/npm commands.

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

## Main Commands

- `suno-export download ...` download tracks + metadata + images
- `suno-export process -i <input> -o <output> ...` run conversion/embedding pipeline
- `suno-export sync ...` run download then process in one workflow
- `suno-export download-images --list <file> ...` artwork-only pass
- `suno-export list ...` list tracks
- `suno-export workspaces ...` list workspaces
- `suno-export metadata <trackId> ...` fetch metadata for one track
- `suno-export fetch-metadata ...` cache metadata for tracks
- `suno-export refresh ...` refresh workspace caches

## Output Layout

Download flow writes:

- `mp3/`
- `wav/`
- `metadata/`
- `images/`
- `songs_metadata.json`

Process flow reads a download-style input root and writes converted output files.

## Project Structure

- `src/index.ts`: CLI command surface
- `src/client.ts`: Suno API client + download helpers
- `src/auth.ts`: browser token extraction (Puppeteer)
- `src/converter.ts`: converter entrypoint used by the CLI
- `src/library-processor.ts`: processing pipeline coordinator
- `src/audio-converter.ts`: audio conversion (ffmpeg)
- `src/metadata-processor.ts`: metadata/tag embedding + sidecar writes
- `src/lib/metadata/normalize-metadata.ts`: canonical metadata normalization/tag parsing
- `src/lib/interfaces/*.ts`: shared interface definitions
- `src/storage.ts`: local cache/device/auth storage
- `src/types.ts`: compatibility barrel re-exporting interfaces from `src/lib/interfaces`

## Example

```bash
suno-export sync --token YOUR_TOKEN --output ./downloads --library ./library
```
