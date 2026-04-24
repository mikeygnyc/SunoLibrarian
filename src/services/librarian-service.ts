import { assertNotCancelled } from "../cancellation";
import type { SunoClient } from "../client";
import { AuthService } from "./auth-service";
import type { CliOptions } from "./auth-service";
import { MetadataAcquisitionService, filterWorkspaces } from "./metadata-acquisition-service";

const DEFAULT_LIBRARIAN_INTERVAL_MS = 5 * 60 * 1000;

export class LibrarianService {
  constructor(
    private readonly authService: AuthService = new AuthService(),
    private readonly metadataService: MetadataAcquisitionService = new MetadataAcquisitionService(),
  ) {}

  async run(options: CliOptions = {}): Promise<void> {
    const intervalMs = parsePositiveInteger(options.librarianInterval, DEFAULT_LIBRARIAN_INTERVAL_MS, "--librarian-interval");
    const once = options.once === true;

    do {
      await assertNotCancelled(options);
      try {
        const client = await this.authService.getAuthenticatedClient(options);
        const synced = await this.runSingleWorkspaceCycle(options, client);
        if (!synced) {
          console.log("[librarian] No workspace was eligible for synchronization in this cycle.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[librarian] Cycle failed: ${message}`);
      }

      if (once) {
        return;
      }

      await wait(intervalMs, options.__abortSignal);
    } while (true);
  }

  async runSingleWorkspaceCycle(options: CliOptions, client?: SunoClient): Promise<boolean> {
    await assertNotCancelled(options);
    const resolvedClient = client ?? await this.authService.getAuthenticatedClient(options);
    const workspaces = await resolvedClient.getWorkspaces();
    await this.metadataService.saveWorkspacesToDatabase(options, workspaces);
    const workspaceId = resolvePinnedWorkspaceId(options);

    const targetWorkspaces = filterWorkspaces(workspaces, workspaceId);
    if (targetWorkspaces.length === 0) {
      console.log(`[librarian] No matching workspace found for ${workspaceId}.`);
      return false;
    }

    const workspace = targetWorkspaces[0];
    const workspacePolicy = evaluateWorkspaceSyncPolicy(workspace.id, options);
    if (!workspacePolicy.allowed) {
      console.log(`[librarian] Skipping workspace ${workspace.id}: ${workspacePolicy.reason}`);
      return false;
    }
    console.log(`[librarian] Syncing workspace ${workspace.name} (${workspace.id})`);
    const result = await this.metadataService.syncWorkspaceMetadata(options, resolvedClient, workspace);
    console.log(
      `[librarian] Workspace ${workspace.name} synced: discovered ${result.discoveredTrackCount} track(s), fetched ${result.fetchedMetadataCount} metadata entr${result.fetchedMetadataCount === 1 ? "y" : "ies"}`,
    );
    return true;
  }
}

function resolvePinnedWorkspaceId(options: CliOptions): string {
  if (typeof options.workspace === "string" && options.workspace.trim().length > 0) {
    return options.workspace.trim();
  }
  throw new Error("run-librarian requires --workspace so each librarian process owns exactly one workspace");
}

function parsePositiveInteger(value: unknown, fallback: number, label: string): number {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function evaluateWorkspaceSyncPolicy(
  workspaceId: string,
  options: CliOptions,
): { allowed: boolean; reason?: string } {
  const enabledWorkspaces = normalizeWorkspaceList(options.enabledWorkspaces);
  const disabledWorkspaces = normalizeWorkspaceList(options.disabledWorkspaces);

  if (disabledWorkspaces?.includes(workspaceId)) {
    return {
      allowed: false,
      reason: "workspace is explicitly disabled by librarian configuration",
    };
  }

  if (enabledWorkspaces && !enabledWorkspaces.includes(workspaceId)) {
    return {
      allowed: false,
      reason: "workspace is not included in the enabled-workspaces policy",
    };
  }

  return { allowed: true };
}

function normalizeWorkspaceList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const workspaces = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return workspaces.length > 0 ? workspaces : undefined;
}

async function wait(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);

    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
