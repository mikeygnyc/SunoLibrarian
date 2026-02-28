# Suno Track Exporter Suite

Unified toolkit for exporting tracks from Suno and building a local tagged audio library.

## Project Layout

- `suno-export/` - new unified project directory (single binary: `suno-export`)
- `cli/` - legacy downloader project kept for verification
- `converter/` - legacy processor project kept for verification
- `extension/` - Chrome extension for interactive downloading

## Quick Start (Recommended)

1. Install unified binary from the new directory:

```bash
cd suno-export
npm install
npm run build
npm link
```

2. Run end-to-end in one command with the unified binary:

```bash
suno-export sync --token YOUR_TOKEN --output ../downloads --library ../library
```

This downloads source files/metadata/images, then runs the converter.

You can also run processing directly from the same binary:

```bash
suno-export process -i ../downloads -o ../library
```

## Manual Two-Step Flow

1. Download:

```bash
suno-export download --token YOUR_TOKEN --output ../downloads
```

2. Process:

```bash
suno-export process -i ../downloads -o ../library
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
