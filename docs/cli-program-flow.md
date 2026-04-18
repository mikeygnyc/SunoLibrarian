# CLI Program Flow

This document maps the `suno-export` command surface to the modules and methods
that implement each workflow. It is intended as a maintenance guide for tracing
where behavior lives.

## Top-Level Dispatch

`src/index.ts` defines the CLI with Commander. Each command registers options and
then dispatches to a flow function in `src/cli-actions.ts` through
`withCliError(...)`.

```mermaid
flowchart TD
  A["suno-export CLI<br/>src/index.ts"] --> B{"Command"}

  B --> C["download"]
  B --> D["sync"]
  B --> E["process"]
  B --> F["download-images"]
  B --> G["list"]
  B --> H["workspaces"]
  B --> I["metadata <trackId>"]
  B --> J["fetch-metadata"]
  B --> K["refresh"]

  C --> C1["runDownloadFlow<br/>src/cli-actions.ts"]
  D --> D1["runSyncFlow<br/>src/cli-actions.ts"]
  E --> E1["runProcessFlow<br/>src/cli-actions.ts"]
  F --> F1["runDownloadImagesFlow<br/>src/cli-actions.ts"]
  G --> G1["runListFlow<br/>src/cli-actions.ts"]
  H --> H1["runWorkspacesFlow<br/>src/cli-actions.ts"]
  I --> I1["runMetadataFlow<br/>src/cli-actions.ts"]
  J --> J1["runFetchMetadataFlow<br/>src/cli-actions.ts"]
  K --> K1["runRefreshFlow<br/>src/cli-actions.ts"]
```

### Dispatch Notes

- `src/index.ts`
  - `program.command("download")`: command registration for download.
  - `program.command("sync")`: command registration for download plus process.
  - `program.command("process")`: command registration for converter-only runs.
  - `program.command("download-images")`: command registration for artwork fetches.
  - `withCliError(...)`: shared error wrapper that prints the error and exits.
- `src/cli-defaults.ts`
  - `DEFAULT_DOWNLOAD_ROOT`: default output root for commands with `--output`.

## Authentication Flow

Most commands that contact Suno call `getAuthenticatedClient(options)` before
doing API work.

```mermaid
flowchart LR
  A["Command needs Suno API"] --> B{"Auth option"}
  B -- "--token" --> C["Use token directly"]
  B -- "--browser [url]" --> D["Extract token from Chrome requests"]
  C --> E["new SunoClient"]
  D --> E
```

### Authentication Notes

- `src/cli-actions.ts`
  - `getAuthenticatedClient(options)`: central auth entrypoint for CLI flows.
  - `resolveBrowserEndpoint(options)`: handles `--browser` defaulting.
  - `resolveBrowserUserDataDir(options)`: resolves `--browser-profile`.
  - `resolveBrowserProfileDirectory(options)`: resolves `--profile-directory`.
- `src/auth.ts`
  - `extractTokenFromBrowser(...)`: launches/connects to Chrome and captures a
    bearer token from Suno network requests.
- `src/client.ts`
  - `SunoClient`: API client used after authentication.

## Metadata File Path Rule

The combined metadata JSON file defaults to `songs_metadata.json`, but callers
can override the path with `--metadata-file`.

```mermaid
flowchart TD
  A{"--metadata-file set?"}
  A -- yes --> B["Use provided absolute/resolved path"]
  A -- "no, download/sync/download-images" --> C["<output>/songs_metadata.json"]
  A -- "no, process" --> D["<input>/songs_metadata.json"]
```

### Metadata Path Notes

- `src/index.ts`
  - Registers `--metadata-file <path>` on `download`, `sync`, `process`, and
    `download-images`.
- `src/cli-actions.ts`
  - `resolveMetadataFilePath(rootDir, options)`: resolves the download-side
    metadata file path.
  - `runDownloadFlow(...)`: reads, initializes, normalizes, and writes the
    metadata file during download.
  - `runProcessFlow(...)`: passes `metadataFile` into the converter.
  - `runDownloadImagesFlow(...)`: uses the metadata file for missing-image
    discovery.
- `src/converter.ts`
  - `runConverter(options)`: maps `metadataFile` to
    `IProcessorConfig.metadataFilePath`.
- `src/library-processor.ts`
  - `Processor.getMetadataFilePath()`: resolves the processor's authoritative
    metadata file.
  - `Processor.loadMetadata()`: reads and normalizes metadata.
  - `Processor.saveMetadata()`: persists full metadata with tmp plus rename.
  - `Processor.copyFinalMetadataToOutput()`: optionally copies finalized metadata
    to the output root.

## Download Command

`download` fetches Suno tracks, metadata, audio, and artwork into a download-style
folder layout.

```mermaid
flowchart TD
  A["download<br/>src/index.ts"] --> B["runDownloadFlow<br/>src/cli-actions.ts"]
  B --> C["getAuthenticatedClient"]
  C --> D["resolve output dirs"]
  D --> E["load/create metadata file"]
  E --> F["client.getWorkspaces"]
  F --> G["client.getTracks per workspace"]
  G --> H{"track downloadable<br/>and date filters pass?"}
  H -- no --> I["skip"]
  H -- yes --> J{"already in metadata?"}
  J -- yes --> K["skip or refresh missing rawApiResponse"]
  J -- no --> L["client.fetchTrackMetadata"]
  L --> M["download wav/mp3"]
  M --> N["download image if available"]
  N --> O["normalizeMetadata"]
  O --> P["append metadata entry<br/>write metadata + sidecar JSON"]
  P --> Q["optional onTrackDownloaded hook"]
```

### Download Notes

- `src/cli-actions.ts`
  - `runDownloadFlow(options)`: owns the download workflow.
  - `getCreatedAtFilters(options)`: parses `--created-after` and
    `--created-before`.
  - `isTrackInDateWindow(...)`: applies date filters to each track.
  - `getPreferredImageUrl(...)`: picks the best artwork URL from metadata.
  - `DownloadedTrackHook`: callback shape used by sync to queue conversion.
- `src/client.ts`
  - `SunoClient.getWorkspaces()`: fetches workspaces.
  - `SunoClient.getTracks(workspaceId)`: fetches tracks for a workspace.
  - `SunoClient.fetchTrackMetadata(trackId)`: fetches detailed metadata.
  - `SunoClient.downloadWav(...)`, `downloadMp3(...)`, `downloadImage(...)`:
    asset download helpers.
- `src/lib/metadata/normalize-metadata.ts`
  - `normalizeMetadata(...)`: canonicalizes metadata entries before writing.

## Process Command

`process` runs the converter against an existing download-style input root.

```mermaid
flowchart TD
  A["process<br/>src/index.ts"] --> B["runProcessFlow<br/>src/cli-actions.ts"]
  B --> C["runConverter<br/>src/converter.ts"]
  C --> D["build IProcessorConfig"]
  D --> E["new Processor(config)"]
  E --> F["Processor.process"]
  F --> G["ensureDirectories"]
  G --> H["loadMetadata"]
  H --> I{"processClipIds set?"}
  I -- yes --> J["filter processing set only<br/>preserve full metadata list"]
  I -- no --> K["use all metadata entries"]
  J --> L["detect songs needing conversion"]
  K --> L
  L --> M["processSong"]
  M --> N["AudioConverter.convertFormat"]
  N --> O["MetadataProcessor.embedMetadata"]
  O --> P["MetadataProcessor.saveSidecarFiles"]
  P --> Q["updateExistingFiles"]
  Q --> R["persistState"]
  R --> S["copyFinalMetadataToOutput"]
```

### Process Notes

- `src/cli-actions.ts`
  - `runProcessFlow(options)`: adapts CLI options to converter options.
- `src/converter.ts`
  - `runConverter(options)`: builds `IProcessorConfig`, initializes logging, and
    creates `Processor`.
- `src/library-processor.ts`
  - `Processor.process()`: top-level processing coordinator.
  - `Processor.ensureDirectories()`: creates output folders.
  - `Processor.loadMetadata()`: loads and normalizes combined metadata.
  - `Processor.getProcessSongs(...)`: filters by `processClipIds` when present.
  - `Processor.resolveSourceWavPath(...)`: finds source WAV in input or output.
  - `Processor.shouldConvert(...)`: decides whether a format should be created.
  - `Processor.processSong(...)`: per-song conversion and sidecar workflow.
  - `Processor.updateExistingFiles(...)`: refreshes existing converted files in
    the selected processing set.
  - `Processor.persistState()`: serializes metadata/log writes.
- `src/audio-converter.ts`
  - `AudioConverter.convertFormat(...)`: ffmpeg conversion primitive.
- `src/metadata-processor.ts`
  - `MetadataProcessor.embedMetadata(...)`: dispatches metadata embedding by
    format.
  - `MetadataProcessor.saveSidecarFiles(...)`: writes per-track metadata, lyrics,
    and artwork sidecars.

## Sync Command

`sync` chains download and process. Conversion is queued after successful
downloads.

```mermaid
flowchart TD
  A["sync<br/>src/index.ts"] --> B["runSyncFlow<br/>src/cli-actions.ts"]
  B --> C["resolve output and library paths"]
  C --> D["create conversion promise chain"]
  D --> E["runDownloadFlow"]
  E --> F{"successful download?"}
  F -- yes --> G["record downloaded clipId"]
  G --> H["queueConversion"]
  H --> I{"--process-downloaded-only?"}
  I -- yes --> J["processClipIds = downloaded clip IDs"]
  I -- no --> K["processClipIds unset"]
  J --> L["runProcessFlow"]
  K --> L
  F -- no --> M["skip conversion for that track"]
  L --> N["await conversion chain"]
```

### Sync Notes

- `src/index.ts`
  - Registers `--process-downloaded-only` on `sync`.
- `src/cli-actions.ts`
  - `runSyncFlow(options)`: owns the chained workflow.
  - `downloadedClipIds`: local `Set<string>` tracking successful downloads in
    the current sync run.
  - `queueConversion()`: serializes converter runs through `conversionChain`.
  - `onTrackDownloaded`: hook passed into `runDownloadFlow` to record a clip ID
    and queue conversion.
- `src/library-processor.ts`
  - `Processor.getProcessTargetClipIds()`: builds the selected clip-id set.
  - `Processor.getProcessSongs(...)`: restricts conversion/update work to those
    IDs while preserving the full metadata list when saving.

### `--process-downloaded-only`

```mermaid
flowchart TD
  A["sync download succeeds for clipId"] --> B["add clipId to downloadedClipIds"]
  B --> C["queue conversion"]
  C --> D{"--process-downloaded-only?"}
  D -- yes --> E["Processor filters conversion/update work to downloadedClipIds"]
  D -- no --> F["Processor considers all songs in metadata"]
  E --> G["full metadata file is still preserved when saved"]
  F --> G
```

Important behavior:

- Existing entries in the metadata file remain in memory and are written back
  when metadata is persisted.
- With `--process-downloaded-only`, only tracks downloaded during that sync run
  are considered for conversion and update work.
- Without `--process-downloaded-only`, sync keeps the previous behavior and
  allows the processor to consider all metadata entries.

## Download Images Command

`download-images` downloads artwork either from a JSON list or by discovering
missing images from metadata.

```mermaid
flowchart TD
  A["download-images<br/>src/index.ts"] --> B["runDownloadImagesFlow<br/>src/cli-actions.ts"]
  B --> C["getAuthenticatedClient"]
  C --> D{"--list provided?"}
  D -- yes --> E["read image list JSON"]
  D -- no --> F["getImagesNeedingDownload"]
  F --> G["Processor.getImagesNeedingDownload"]
  E --> H["download each image"]
  G --> H
  H --> I["optional delay between images"]
```

### Download Images Notes

- `src/cli-actions.ts`
  - `runDownloadImagesFlow(options)`: validates image-list/discovery options and
    downloads artwork.
  - `getImagesNeedingDownload(rootDir, metadataFilePath)`: creates a `Processor`
    solely for missing-image discovery.
- `src/library-processor.ts`
  - `Processor.getImagesNeedingDownload()`: loads metadata, checks image
    presence/validity in input and output image folders, and returns missing
    items.
- `src/client.ts`
  - `SunoClient.downloadImage(...)`: downloads the selected artwork URL.

## Lightweight API Commands

These commands primarily authenticate and call `SunoClient` methods.

```mermaid
flowchart TD
  A["list"] --> A1["runListFlow"] --> A2["client.getWorkspaces"] --> A3["client.getTracks"]
  B["workspaces"] --> B1["runWorkspacesFlow"] --> B2["client.getWorkspaces"]
  C["metadata <trackId>"] --> C1["runMetadataFlow"] --> C2["client.fetchTrackMetadata"]
  D["fetch-metadata"] --> D1["runFetchMetadataFlow"] --> D2["client.fetchAllTracksMetadata"]
  E["refresh"] --> E1["runRefreshFlow"] --> E2["client.refreshAllWorkspaces"]
```

### Lightweight Command Notes

- `src/cli-actions.ts`
  - `runListFlow(options)`: lists tracks, optionally as JSON.
  - `runWorkspacesFlow(options)`: lists workspaces, optionally as JSON.
  - `runMetadataFlow(trackId, options)`: prints metadata for one track.
  - `runFetchMetadataFlow(options)`: fetches metadata for explicit IDs or tracks
    selected by workspace/date filters.
  - `runRefreshFlow(options)`: refreshes cached workspace data.
- `src/client.ts`
  - `SunoClient.fetchAllTracksMetadata(...)`: batch metadata fetch.
  - `SunoClient.refreshAllWorkspaces()`: refresh helper for workspace data.

## Output Ownership

Download-style output root:

- `mp3/`: downloaded MP3 source files.
- `wav/`: downloaded WAV source files.
- `metadata/`: per-track metadata sidecar JSON.
- `images/`: downloaded artwork.
- `songs_metadata.json`: default combined metadata file.

Process output root:

- Audio format folders such as `flac/`, `mp3/`, `alac/`, and optionally `wav/`.
- `metadata/`: processed metadata sidecars and temporary tag files.
- `lyrics/`: lyric sidecars.
- `images/`: copied/downloaded artwork.

Authoritative combined metadata:

- Download uses `<output>/songs_metadata.json` by default.
- Process uses `<input>/songs_metadata.json` by default.
- `--metadata-file <path>` overrides the combined metadata JSON location.
- Processor backups are created next to the authoritative metadata file.
