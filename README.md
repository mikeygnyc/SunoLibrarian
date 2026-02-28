# Suno Track Exporter Suite

Unified toolkit for exporting tracks from Suno and building a local tagged audio library.

## Project Layout

- `cli/` - `suno-export` CLI downloader (tracks, metadata, images) plus `sync` chaining
- `converter/` - `suno-process` CLI converter/metadata embedder
- `extension/` - Chrome extension for interactive downloading

## Quick Start (Recommended)

1. Install/build both CLIs:

```bash
cd cli && npm install && npm run build
cd ../converter && npm install && npm run build
```

2. Run end-to-end in one command:

```bash
cd ../cli
suno-export sync --token YOUR_TOKEN --output ../downloads --library ../library
```

This downloads source files/metadata/images, then runs the converter.

## Manual Two-Step Flow

1. Download:

```bash
cd cli
suno-export download --token YOUR_TOKEN --output ../downloads
```

2. Process:

```bash
cd ../converter
suno-process -i ../downloads -o ../library
```

## Prerequisites

- Node.js 18+
- `ffmpeg`
- `flac` package (`metaflac`)

Example install:

```bash
# macOS
brew install ffmpeg flac
```

## Notes

- Artwork workflow prefers `image_large_url`; failed image downloads can trigger artwork regeneration in CLI flows with `clipId`.
- Converter logs (`process.log`, `processed.log`, `skipped.log`, `images.log`) are written in the input root.

## Detailed Docs

- CLI: [cli/README.md](./cli/README.md)
- Converter: [converter/README.md](./converter/README.md)
- Extension: [extension/README.md](./extension/README.md)
