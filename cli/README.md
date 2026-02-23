# Suno Track Exporter CLI

A command-line tool to export your Suno tracks as MP3 or WAV files. This is a standalone Node.js/TypeScript version of the Chrome extension, maintaining the same logic and API calls.

## Installation

```bash
cd cli
npm install
npm run build
```

Or install globally:

```bash
npm install -g .
```

## Usage

### Download tracks

**With token:**
```bash
suno-export download --token YOUR_TOKEN
```

**Without token (browser will launch):**
```bash
suno-export download
```

**Options:**
- `-t, --token <token>` - Authentication token (optional, will launch browser if not provided)
- `-w, --workspace <id>` - Specific workspace ID (default: all workspaces)
- `-f, --format <format>` - Download format: mp3 or wav (default: mp3)
- `-o, --output <dir>` - Output directory (default: ./downloads)
- `--no-metadata` - Skip metadata sidecar files
- `--delay <ms>` - Delay between downloads in ms (default: 1000)

**Examples:**
```bash
# Download all tracks as MP3 with metadata
suno-export download --token YOUR_TOKEN

# Download from specific workspace
suno-export download --token YOUR_TOKEN --workspace workspace-id

# Download as WAV
suno-export download --token YOUR_TOKEN --format wav

# Custom output directory
suno-export download --token YOUR_TOKEN --output ./my-tracks

# Without token (browser will open)
suno-export download --format mp3 --output ./downloads

# Skip metadata sidecar files
suno-export download --token YOUR_TOKEN --no-metadata

# Custom delay between downloads
suno-export download --token YOUR_TOKEN --delay 2000
```

### List tracks

```bash
suno-export list --token YOUR_TOKEN
```

**Options:**
- `-t, --token <token>` - Authentication token (optional)
- `-w, --workspace <id>` - Specific workspace ID (default: all workspaces)
- `--json` - Output as JSON

**Examples:**
```bash
# List all tracks
suno-export list --token YOUR_TOKEN

# List tracks from specific workspace
suno-export list --token YOUR_TOKEN --workspace workspace-id

# Output as JSON
suno-export list --token YOUR_TOKEN --json
```

### List workspaces

```bash
suno-export workspaces --token YOUR_TOKEN
```

**Options:**
- `-t, --token <token>` - Authentication token (optional)
- `--json` - Output as JSON

### Get track metadata

```bash
suno-export metadata <trackId> --token YOUR_TOKEN
```

Fetches detailed metadata for a specific track including lyrics, BPM, key, prompt, cover art, etc.

## How to get your token

### Method 1: Automatic (Recommended)
Simply run any command without the `--token` option, and a browser window will open. Log in to Suno.com, and the token will be automatically extracted.

### Method 2: Manual
1. Open Chrome and go to https://suno.com
2. Log in to your account
3. Open Developer Tools (F12)
4. Go to the Network tab
5. Refresh the page or navigate to your library
6. Look for requests to `studio-api.prod.suno.com`
7. Click on any request and find the `Authorization` header
8. Copy the token (everything after "Bearer ")

## Features

All features from the Chrome extension are preserved:

- 🔐 **Automatic Token Extraction**: Launch browser to capture token automatically
- 📋 **List All Tracks**: View all tracks across workspaces
- 📥 **Batch Download**: Download multiple tracks at once
- 🎵 **Format Support**: Download as MP3 or WAV (WAV requires conversion)
- 🎯 **Workspace Filtering**: Download from specific workspaces
- ⚡ **Rate Limiting**: Built-in exponential backoff and retry logic
- 📝 **Metadata Support**: Generates sidecar .txt files with track metadata
- 🔄 **Pagination**: Automatically handles pagination for all API calls
- 💾 **Caching**: Metadata caching to reduce API calls
- 🛡️ **Error Handling**: Robust error handling with retry logic

## Implementation Details

This CLI tool maintains the same logic as the Chrome extension:

- **API Calls**: All API endpoints and request formats are identical
- **Rate Limiting**: Same exponential backoff and retry logic
- **Pagination**: Same pagination handling for workspaces and tracks
- **Metadata**: Same metadata extraction and sidecar file generation
- **WAV Conversion**: Same polling mechanism for WAV file conversion
- **Device ID**: Generates and maintains a device ID like the extension
- **Browser Token**: Generates browser tokens for each request

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev -- download --token YOUR_TOKEN

# Build
npm run build

# Run built version
npm start -- download --token YOUR_TOKEN
```

## Notes

- Files are saved with format: `workspace-trackname-trackid.extension`
- Metadata sidecar files are saved as: `workspace-trackname-trackid.extension.txt`
- WAV conversion requires additional API calls and may take longer
- The tool automatically handles pagination to fetch all tracks
- Rate limiting is built-in with exponential backoff
- Already downloaded files are skipped automatically
- The tool uses the same billing endpoint as the web UI for download tracking
