import { createMetadataStore, type MetadataStoreConfig } from "../metadata-store";
import { assertNotCancelled } from "../cancellation";
import type { CliOptions } from "./auth-service";
import type { IWorkspace } from "../lib/interfaces";
import type { SunoClient } from "../client";

export class MetadataAcquisitionService {
  async saveWorkspacesToDatabase(options: CliOptions, workspaces: IWorkspace[]): Promise<void> {
    const store = await createMetadataStore(resolveMetadataStoreOptions(options));
    try {
      await store.upsertWorkspaces(workspaces);
    } finally {
      await store.close();
    }
  }

  async saveTrackWorkspaceLinks(
    options: CliOptions,
    workspace: IWorkspace,
    clipIds: string[],
  ): Promise<void> {
    const store = await createMetadataStore(resolveMetadataStoreOptions(options));
    try {
      await store.upsertWorkspaces([workspace]);
      for (const clipId of clipIds) {
        await store.upsertSongWorkspace(clipId, workspace, "discovery");
      }
    } finally {
      await store.close();
    }
  }

  async fetchMetadata(options: CliOptions, client: SunoClient): Promise<void> {
    await assertNotCancelled(options);
    const explicitIds = parseTrackIdsOption(options.ids);
    const { createdAfter, createdBefore } = getCreatedAtFilters(options);

    if (explicitIds.length > 0 && (options.workspace || createdAfter || createdBefore)) {
      throw new Error("--ids cannot be combined with --workspace, --created-after, or --created-before");
    }

    if (explicitIds.length > 0) {
      console.log(`Fetching metadata for ${explicitIds.length} tracks from --ids...`);
      await client.fetchAllTracksMetadata(explicitIds, writeFetchProgress, async () => assertNotCancelled(options));
      console.log("\nMetadata fetch complete!");
      return;
    }

    await assertNotCancelled(options);
    const workspaces = await client.getWorkspaces();
    await this.saveWorkspacesToDatabase(options, workspaces);
    const targetWorkspaces = filterWorkspaces(workspaces, options.workspace);

    for (const workspace of targetWorkspaces) {
      const result = await this.syncWorkspaceMetadata(options, client, workspace, createdAfter, createdBefore);
      if (result.fetchedMetadataCount === 0) {
        continue;
      }
    }
    console.log("\nMetadata fetch complete!");
  }

  async refresh(options: CliOptions, client: SunoClient): Promise<void> {
    await assertNotCancelled(options);
    console.log("Refreshing all workspaces...");
    const workspaces = await client.refreshAllWorkspaces(async () => assertNotCancelled(options));
    await this.saveWorkspacesToDatabase(options, workspaces);
    console.log(`Refreshed ${workspaces.length} workspace(s)`);
  }

  async syncWorkspaceMetadata(
    options: CliOptions,
    client: SunoClient,
    workspace: IWorkspace,
    createdAfter?: Date,
    createdBefore?: Date,
  ): Promise<{ discoveredTrackCount: number; fetchedMetadataCount: number }> {
    await assertNotCancelled(options);
    const effectiveCreatedAfter = createdAfter ?? getCreatedAtFilters(options).createdAfter;
    const effectiveCreatedBefore = createdBefore ?? getCreatedAtFilters(options).createdBefore;
    const tracks = await client.getTracks(workspace.id);
    await this.saveTrackWorkspaceLinks(
      options,
      workspace,
      tracks.map((track) => track.id),
    );

    const filteredTrackIds = tracks
      .filter((track) => isTrackInDateWindow(track, effectiveCreatedAfter, effectiveCreatedBefore))
      .map((track) => track.id);

    if (filteredTrackIds.length === 0) {
      console.log(`[metadata] Workspace ${workspace.name} has no tracks matching the current selection criteria.`);
      return {
        discoveredTrackCount: tracks.length,
        fetchedMetadataCount: 0,
      };
    }

    console.log(`[metadata] Fetching metadata for ${filteredTrackIds.length} track(s) in workspace ${workspace.name}...`);
    await client.fetchAllTracksMetadata(filteredTrackIds, writeFetchProgress, async () => assertNotCancelled(options));
    console.log("");
    return {
      discoveredTrackCount: tracks.length,
      fetchedMetadataCount: filteredTrackIds.length,
    };
  }
}

type DateBoundary = "start" | "end";

function writeFetchProgress(current: number, total: number): void {
  const percent = Math.round((current / total) * 100);
  process.stdout.write(`\rProgress: ${current}/${total} (${percent}%)`);
}

function parseDateFilter(value: string | undefined, label: string, boundary: DateBoundary): Date | undefined {
  if (!value) return undefined;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  if (dateOnly) {
    const suffix = boundary === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
    const parsedDateOnly = new Date(`${value.trim()}${suffix}`);
    if (Number.isNaN(parsedDateOnly.getTime())) {
      throw new Error(`Invalid date for ${label}: ${value}`);
    }
    return parsedDateOnly;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date for ${label}: ${value}`);
  }
  return parsed;
}

export function getCreatedAtFilters(options: CliOptions): { createdAfter?: Date; createdBefore?: Date } {
  const createdAfter = parseDateFilter(options.createdAfter, "--created-after", "start");
  const createdBefore = parseDateFilter(options.createdBefore, "--created-before", "end");

  if (createdAfter && createdBefore && createdAfter > createdBefore) {
    throw new Error("--created-after must be earlier than or equal to --created-before");
  }

  return { createdAfter, createdBefore };
}

export function isTrackInDateWindow(
  track: { created_at?: string },
  createdAfter?: Date,
  createdBefore?: Date,
): boolean {
  if (!createdAfter && !createdBefore) return true;
  if (!track.created_at) return false;

  const createdAt = new Date(track.created_at);
  if (Number.isNaN(createdAt.getTime())) return false;
  if (createdAfter && createdAt < createdAfter) return false;
  if (createdBefore && createdAt > createdBefore) return false;
  return true;
}

export function parseTrackIdsOption(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  );
}

export function filterWorkspaces(workspaces: IWorkspace[], workspaceId?: string): IWorkspace[] {
  return workspaceId ? workspaces.filter((workspace) => workspace.id === workspaceId) : workspaces;
}

type ResolveMetadataStoreOptions = (options: CliOptions) => MetadataStoreConfig;
let resolveMetadataStoreOptions: ResolveMetadataStoreOptions;

export function configureMetadataAcquisitionService(deps: {
  resolveMetadataStoreOptions: ResolveMetadataStoreOptions,
}): void {
  resolveMetadataStoreOptions = deps.resolveMetadataStoreOptions;
}
