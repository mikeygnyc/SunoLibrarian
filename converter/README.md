# Suno Audio Processor

Converts downloaded Suno audio and embeds rich metadata into output files.

## Role In This Repo

- `cli/`: downloads source audio, metadata, and images from Suno
- `converter/`: processes those downloads into your library formats
- `extension/`: browser extension alternative to CLI download

Recommended flow:
1. Download with `suno-export download` (or use `suno-export sync`)
2. Process with `suno-process`

## Prerequisites

- Node.js 18+
- `ffmpeg`
- `flac` package (`metaflac`)

Install tools:

```bash
# macOS
brew install ffmpeg flac

# Ubuntu/Debian
apt-get install ffmpeg flac
```

## Install

```bash
cd converter
npm install
npm run build
```

Global install (optional):

```bash
npm link
```

## Usage

```bash
suno-process -i ./downloads -o ./library
```

Examples:

```bash
# specific output formats
suno-process -i ./downloads -o ./library -f flac,mp3,alac

# custom MP3 bitrate
suno-process -i ./downloads -o ./library -b 256

# skip embedding images and lyrics
suno-process -i ./downloads -o ./library --no-images --no-lyrics

# generate only a JSON image worklist
suno-process -i ./downloads -o ./library --image-list ./downloads/image-list.json
```

## Input And Output

Expected input root:

```text
input/
├── wav/
├── mp3/                # optional source fallback depending on workflow
├── metadata/
├── images/
├── lyrics/
└── songs_metadata.json
```

Output root:

```text
output/
├── flac/
├── alac/
├── mp3/
├── wav/
├── metadata/
├── images/
├── lyrics/
└── songs_metadata.json
```

Log files are written to the input root:
- `process.log`
- `processed.log`
- `skipped.log`
- `images.log`

Metadata persistence behavior:
- converter writes `songs_metadata.json` to output root
- converter also updates input root metadata (if different) to preserve per-format timestamps for future reconvert decisions

## Options

- `-i, --input <path>` input root (required)
- `-o, --output <path>` output root (required)
- `-f, --formats <formats>` comma list: `flac,alac,mp3,wav` (default: `flac,mp3,alac`)
- `-b, --bitrate <kbps>` MP3 bitrate (default: `320`)
- `-c, --concurrency <n>` processing concurrency (default: `4`)
- `--update-concurrency <n>` update-pass concurrency (default: `8`)
- `--no-images` skip embedding artwork
- `--no-lyrics` skip embedding lyrics
- `--exit-on-error` stop immediately on processing error
- `--reconvert-before <iso>` reconvert when timestamp is missing or `<=` date
- `--reconvert-after <iso>` reconvert when timestamp is missing or `>=` date
- `--reconvert-missing` only process missing formats
- `--image-list <file>` write image worklist JSON and exit

## Metadata Notes

Converter normalizes and persists metadata in `songs_metadata.json` (including fields derived from `rawApiResponse`). It also tracks per-format timestamps:
- `mp3Timestamp`
- `wavTimestamp`
- `alacTimestamp`
- `flacTimestamp`

These timestamps drive `reconvert-*` filtering.

## Development

```bash
cd converter
npm install
npm run build
node dist/index.js -i ./downloads -o ./library
```
