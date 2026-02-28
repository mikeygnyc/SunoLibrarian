# Suno Tracks Exporter Chrome Extension

Browser extension that exports Suno tracks directly from Chrome.

## Role In This Repo

- `cli/`: recommended automation path for bulk downloads and converter chaining
- `converter/`: audio/metadata processor for downloaded files
- `extension/`: browser UI alternative for interactive downloading

If you want end-to-end CLI automation, prefer `suno-export sync`.

## Features

- Automatic token extraction from active Suno session
- Workspace and track listing with pagination
- Batch MP3 download
- WAV conversion + download flow
- Selective per-track download controls

## Install (Unpacked Extension)

1. Open Chrome and go to `chrome://extensions/`
2. Enable Developer Mode
3. Click **Load unpacked**
4. Select this repo's `extension/` directory
5. Visit `https://suno.com` and sign in

## Usage

1. Click the extension icon
2. Click **Open Downloader**
3. Choose tracks and format (MP3 or WAV)

## File Layout

```text
extension/
├── manifest.json
├── background.js
├── content.js
├── content.css
├── popup.html
├── popup.js
└── README.md
```

## Permissions Used

- `storage`
- `downloads`
- `tabs`
- `scripting`
- host permissions for `suno.com` and Suno API domains

## Notes

- Downloads go to Chrome's default download directory
- WAV requires additional conversion/polling API calls
- Pagination and workspace grouping are handled automatically

## Troubleshooting

- No tracks shown: confirm you're signed in on `suno.com`
- Download failures: verify Chrome download permissions
- Token issues: reload `suno.com` and reopen the downloader
