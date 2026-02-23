# Suno Audio Processor

Process and convert Suno audio files with comprehensive metadata embedding.

## Features

- Converts WAV files to FLAC, ALAC (M4A), and MP3 formats
- Embeds comprehensive metadata including:
  - Title, Artist, Date, Duration
  - Suno-specific fields (ID, Model, Style, Tags)
  - AI generation parameters (Weirdness, Style Strength, Audio Strength)
  - Remix parent information
  - Lyrics (optional)
  - Album artwork (optional)
- Updates incomplete metadata in existing files
- Matches directory structure of existing utilities

## Prerequisites

- Node.js 18+
- FFmpeg (for audio conversion)
- metaflac (for FLAC metadata embedding)

Install dependencies:
```bash
# macOS
brew install ffmpeg flac

# Ubuntu/Debian
apt-get install ffmpeg flac
```

## Installation

```bash
npm run build
npm link  # Optional: makes 'suno-process' available globally
```

## Usage

```bash
# Basic usage
node dist/index.js -i /path/to/input -o /path/to/output

# Specify formats
node dist/index.js -i ./downloads -o ./library -f flac,mp3,alac

# Custom MP3 bitrate
node dist/index.js -i ./downloads -o ./library -b 256

# Skip image/lyrics embedding
node dist/index.js -i ./downloads -o ./library --no-images --no-lyrics
```

## Directory Structure

### Input Directory
```
input/
├── wav/              # Source WAV files
├── metadata/         # JSON metadata files
├── images/           # Album artwork
├── lyrics/           # Lyrics text files
└── songs_metadata.json  # Combined metadata
```

### Output Directory
```
output/
├── flac/             # Converted FLAC files
├── alac/             # Converted ALAC (M4A) files
├── mp3/              # Converted MP3 files
├── wav/              # Original WAV files (if specified)
├── metadata/         # Temporary metadata files
├── images/           # Album artwork
└── lyrics/           # Lyrics text files
```

## Options

- `-i, --input <path>` - Input root directory (required)
- `-o, --output <path>` - Output root directory (required)
- `-f, --formats <formats>` - Comma-separated formats: flac,alac,mp3,wav (default: flac,mp3,alac)
- `-b, --bitrate <kbps>` - MP3 bitrate in kbps (default: 320)
- `--no-images` - Skip embedding album artwork
- `--no-lyrics` - Skip embedding lyrics

## Metadata Fields

### Standard Fields
- Title, Artist, Date, Genre, Comment

### Suno-Specific Fields (FLAC)
- `SUNO_ID` - Clip identifier
- `AI_MODEL` - Suno model version
- `SUNO_TAGS` - Genre/style tags
- `SUNO_WEIRDNESS` - Weirdness parameter
- `SUNO_STYLE_STRENGTH` - Style strength parameter
- `SUNO_AUDIO_STRENGTH` - Audio strength parameter
- `SUNO_REMIX_PARENT` - Parent clip ID for remixes
- `FAVORITE` - Liked status
- `CONTACT` - Song URL
- `LENGTH` - Duration

## Examples

```bash
# Process all formats with high-quality MP3
suno-process -i ~/Downloads/suno -o ~/Music/suno -f flac,alac,mp3 -b 320

# FLAC only, no images
suno-process -i ./input -o ./output -f flac --no-images

# Update existing library with new metadata
suno-process -i ./downloads -o ./library
```
