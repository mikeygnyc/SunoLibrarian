# Suno Tracks Exporter Chrome Extension

A Chrome extension to quickly export your Suno tracks from each workspace as MP3 or WAV files.

## Features

- 🔐 **Automatic Token Extraction**: Automatically captures your authentication token from Suno.com
- 📋 **List All Tracks**: Fetches all your available tracks with pagination
- 📥 **Batch Download**: Download multiple tracks at once
- 🎵 **Format Support**: Download as MP3 or WAV (WAV requires conversion)
- ✅ **Progress Tracking**: See download progress in real-time
- 🎯 **Selective Download**: Choose specific tracks or download all

## Installation

1. **Download/Clone** this extension folder
2. **Create Icons** (required):
   - Open `create-icons.html` in a browser
   - Click the download buttons to generate `icon16.png`, `icon48.png`, and `icon128.png`
   - Place them in the `chrome-extension` folder
   - Or create your own 16x16, 48x48, and 128x128 PNG icons
3. **Open Chrome** and navigate to `chrome://extensions/`
4. **Enable Developer Mode** (toggle in top-right)
5. **Click "Load unpacked"** and select the `chrome-extension` folder
6. **Visit suno.com** and log in to your account

## Usage

### Using the Extension
- Click the extension icon in Chrome toolbar
- Click "Open Downloader" to open the export interface

### Download Options
- **Download Selected MP3**: Downloads only selected tracks as MP3
- **Convert & Download Selected WAV**: Converts and downloads selected tracks as WAV
- **Individual Download**: Click the MP3 or WAV button next to each track

## How It Works

1. **Token Extraction**: The extension intercepts API requests to capture your authentication token
2. **Track Listing**: Uses the Suno API to fetch all your tracks with pagination
3. **Download**: Uses Chrome's download API to save files to your Downloads folder

## File Structure

```
chrome-extension/
├── manifest.json       # Extension manifest
├── background.js      # Service worker for API calls
├── content.js         # Content script injected into suno.com
├── content.css        # Styles for injected UI
├── popup.html         # Extension popup UI
├── popup.js           # Popup script
└── README.md          # This file
```

## Permissions

- **storage**: To save authentication tokens
- **downloads**: To download files
- **tabs**: To interact with suno.com tabs
- **scripting**: To inject content scripts
- **host_permissions**: Access to suno.com and API endpoints

## Notes

- Files are downloaded to your default Chrome Downloads folder
- Filenames follow the format: `workspace-trackname-trackid.extension`
- The extension automatically handles pagination to fetch all tracks from all workspaces
- Token is stored locally in Chrome storage
- WAV conversion requires additional API calls and polling
- Tracks are grouped by workspace with collapsible sections

## Troubleshooting

- **No tracks found**: Make sure you're logged into suno.com
- **Download fails**: Check that you have permission to download files
- **Token expired**: Visit suno.com again to refresh the token

## Development

To modify the extension:
1. Make changes to the files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Reload suno.com to test changes

