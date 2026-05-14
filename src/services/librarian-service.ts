import { assertNotCancelled } from "../cancellation";
import type { CliOptions } from "./auth-service";
import { createControlPlaneRepository, submitWorkflowJob } from "../core/orchestration";
import {
  getLibrarianSyncRequest,
  getLibrarianWorkspaceState,
  MANUAL_SYNC_PRIORITY,
  markLibrarianSyncRequestCompleted,
  markLibrarianSyncRequestFailed,
  markLibrarianSyncRequestRunning,
  PERIODIC_SYNC_PRIORITY,
  setLibrarianWorkspaceState,
} from "../orchestration/librarian-sync-store";
import { MqttControlPlaneNotifier } from "../orchestration/mqtt-control-plane-notifier";

const DEFAULT_LIBRARIAN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SYNC_BATCH_SIZE = 25;
const STARTUP_STAGGER_MIN_MS = 15 * 60 * 1000;
const STARTUP_STAGGER_RANGE_MS = 15 * 60 * 1000;

export class LibrarianService {
  private readonly processStartedAt = Date.now();

  constructor() {}

  async run(options: CliOptions = {}): Promise<void> {
    const intervalMs = parsePositiveInteger(options.librarianInterval, DEFAULT_LIBRARIAN_INTERVAL_MS, "--librarian-interval");
    const once = options.once === true;
    const workspaceId = resolvePinnedWorkspaceId(options);
    const wakeNotifier = new MqttControlPlaneNotifier({
      mqttUrl: options.mqttUrl,
      mqttTopicPrefix: options.mqttTopicPrefix,
    });

    try {
      await wakeNotifier.start();
      do {
        await assertNotCancelled(options);
        try {
          const synced = await this.runSingleWorkspaceCycle(options, intervalMs);
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

        const waitMs = await this.computeNextWaitMs(options, workspaceId, intervalMs);
        await waitForNextCycle(waitMs, options.__abortSignal, wakeNotifier, workspaceId);
      } while (true);
    } finally {
      await wakeNotifier.close();
    }
  }

  async runSingleWorkspaceCycle(options: CliOptions, intervalMs?: number): Promise<boolean> {
    await assertNotCancelled(options);
    const workspaceId = resolvePinnedWorkspaceId(options);
    const workspacePolicy = evaluateWorkspaceSyncPolicy(workspaceId, options);
    if (!workspacePolicy.allowed) {
      console.log(`[librarian] Skipping workspace ${workspaceId}: ${workspacePolicy.reason}`);
      return false;
    }

    const repository = createControlPlaneRepository(options);
    try {
      await repository.initialize();
      const request = await getLibrarianSyncRequest(repository, workspaceId);
      const state = await getLibrarianWorkspaceState(repository, workspaceId);
      const shouldRunScheduled = this.isScheduledSyncDue(workspaceId, state?.lastCompletedAt, intervalMs ?? DEFAULT_LIBRARIAN_INTERVAL_MS);

      if (!request && !shouldRunScheduled) {
        return false;
      }

      const batchSize = parsePositiveInteger(options.batchSize, DEFAULT_SYNC_BATCH_SIZE, "--batch-size");
      const priority = request ? MANUAL_SYNC_PRIORITY : PERIODIC_SYNC_PRIORITY;
      console.log(
        `[librarian] Submitting workspace sync for ${workspaceId} (batchSize=${batchSize}, trigger=${request ? "manual" : "scheduled"})`,
      );
      const jobId = await submitWorkflowJob("sync", {
        ...options,
        workspace: workspaceId,
        batchSize,
        librarianManagedSync: true,
        priority,
      });
      await setLibrarianWorkspaceState(repository, workspaceId, {
        lastStartedAt: new Date().toISOString(),
        lastSyncJobId: jobId,
      });
      if (request) {
        await markLibrarianSyncRequestRunning(repository, workspaceId, jobId);
      }

      try {
        await waitForJobCompletion(jobId, options);
        await setLibrarianWorkspaceState(repository, workspaceId, {
          lastCompletedAt: new Date().toISOString(),
          lastOutcome: "completed",
          lastErrorMessage: undefined,
          lastSyncJobId: jobId,
        });
        if (request) {
          await markLibrarianSyncRequestCompleted(repository, workspaceId);
        }
        console.log(`[librarian] Workspace ${workspaceId} sync batch completed via job ${jobId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await setLibrarianWorkspaceState(repository, workspaceId, {
          lastOutcome: "failed",
          lastErrorMessage: message,
          lastSyncJobId: jobId,
        });
        if (request) {
          await markLibrarianSyncRequestFailed(repository, workspaceId, message);
        }
        throw error;
      }

      return true;
    } finally {
      await repository.close();
    }
  }

  private async computeNextWaitMs(options: CliOptions, workspaceId: string, intervalMs: number): Promise<number> {
    const repository = createControlPlaneRepository(options);
    try {
      await repository.initialize();
      const request = await getLibrarianSyncRequest(repository, workspaceId);
      if (request && (request.status === "pending" || request.status === "running")) {
        return 0;
      }

      const state = await getLibrarianWorkspaceState(repository, workspaceId);
      if (!state?.lastCompletedAt) {
        return Math.max(0, this.processStartedAt + computeStartupStaggerMs(workspaceId) - Date.now());
      }

      const dueAtMs = new Date(state.lastCompletedAt).getTime() + intervalMs;
      return Math.max(0, dueAtMs - Date.now());
    } finally {
      await repository.close();
    }
  }

  private isScheduledSyncDue(workspaceId: string, lastCompletedAt: string | undefined, intervalMs: number): boolean {
    if (!lastCompletedAt) {
      return Date.now() >= this.processStartedAt + computeStartupStaggerMs(workspaceId);
    }
    return Date.now() >= new Date(lastCompletedAt).getTime() + intervalMs;
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

async function waitForJobCompletion(jobId: string, options: CliOptions): Promise<void> {
  const repository = createControlPlaneRepository(options);
  try {
    await repository.initialize();
    while (true) {
      await assertNotCancelled(options);
      const job = await repository.getJob(jobId);
      if (!job) {
        throw new Error(`Librarian-submitted sync job not found: ${jobId}`);
      }
      if (job.status === "completed") {
        return;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        throw new Error(`Librarian-submitted sync job ${job.status}: ${job.errorMessage ?? jobId}`);
      }
      await wait(1000, options.__abortSignal);
    }
  } finally {
    await repository.close();
  }
}

function computeStartupStaggerMs(workspaceId: string): number {
  const hash = Array.from(workspaceId).reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 0);
  return STARTUP_STAGGER_MIN_MS + (hash % STARTUP_STAGGER_RANGE_MS);
}

async function waitForNextCycle(
  waitMs: number,
  signal: AbortSignal | undefined,
  wakeNotifier: MqttControlPlaneNotifier,
  workspaceId: string,
): Promise<void> {
  if (waitMs <= 0) {
    return;
  }

  const woke = await wakeNotifier.waitForLibrarianWakeup(workspaceId, waitMs, signal);
  if (woke) {
    console.log(`[librarian] Received manual sync wakeup for workspace ${workspaceId}`);
  }
}
