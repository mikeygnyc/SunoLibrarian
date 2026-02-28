# suno-export (Unified)

This directory contains the unified binary project that combines downloader + processor into one command surface.

## Install

```bash
cd suno-export
npm install
npm run build
npm link
```

Then run:

```bash
suno-export --help
```

## Main Commands

- `suno-export download ...` download tracks/metadata/images
- `suno-export process -i <input> -o <output> ...` run converter functionality
- `suno-export sync ...` download and process in one flow
- `suno-export download-images --list <file> ...` image-only pass

## Example

```bash
suno-export sync --token YOUR_TOKEN --output ../downloads --library ../library
```

## Notes

- The legacy `cli/` and `converter/` directories are intentionally left in place for comparison and verification.
- This project builds a single output tree: `dist/`
