import { randomUUID } from "crypto";
import type { IOrchestrationRepository } from "../lib/interfaces";

export const LIBRARIAN_SYNC_REQUEST_KEY_PREFIX = "librarian-sync-request:";
const STATE_KEY_PREFIX = "librarian-sync-state:";

export const MANUAL_SYNC_PRIORITY = 100;
export const PERIODIC_SYNC_PRIORITY = 0;

export type LibrarianSyncRequestStatus = "pending" | "running" | "completed" | "failed";

export interface ILibrarianSyncRequest {
  requestId: string;
  workspaceId: string;
  status: LibrarianSyncRequestStatus;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  requestingJobId?: string;
  syncJobId?: string;
  priority: number;
  errorMessage?: string;
}

export interface ILibrarianWorkspaceState {
  workspaceId: string;
  lastCompletedAt?: string;
  lastStartedAt?: string;
  lastSyncJobId?: string;
  lastOutcome?: "completed" | "failed";
  lastErrorMessage?: string;
}

export async function getLibrarianSyncRequest(
  repository: IOrchestrationRepository,
  workspaceId: string,
): Promise<ILibrarianSyncRequest | undefined> {
  const value = await repository.getRuntimeSetting(getRequestKey(workspaceId));
  return isPlainObject(value) ? (value as unknown as ILibrarianSyncRequest) : undefined;
}

export async function upsertManualLibrarianSyncRequest(
  repository: IOrchestrationRepository,
  workspaceId: string,
  requestingJobId?: string,
): Promise<ILibrarianSyncRequest> {
  const existing = await getLibrarianSyncRequest(repository, workspaceId);
  if (existing && (existing.status === "pending" || existing.status === "running")) {
    return existing;
  }

  const request: ILibrarianSyncRequest = {
    requestId: `librarian-sync-${randomUUID()}`,
    workspaceId,
    status: "pending",
    requestedAt: new Date().toISOString(),
    requestingJobId,
    priority: MANUAL_SYNC_PRIORITY,
  };
  await repository.setRuntimeSetting(getRequestKey(workspaceId), request);
  return request;
}

export async function markLibrarianSyncRequestRunning(
  repository: IOrchestrationRepository,
  workspaceId: string,
  syncJobId: string,
): Promise<ILibrarianSyncRequest | undefined> {
  const request = await getLibrarianSyncRequest(repository, workspaceId);
  if (!request || request.status !== "pending") {
    return request;
  }

  const updated: ILibrarianSyncRequest = {
    ...request,
    status: "running",
    startedAt: new Date().toISOString(),
    syncJobId,
  };
  await repository.setRuntimeSetting(getRequestKey(workspaceId), updated);
  return updated;
}

export async function markLibrarianSyncRequestCompleted(
  repository: IOrchestrationRepository,
  workspaceId: string,
): Promise<void> {
  const request = await getLibrarianSyncRequest(repository, workspaceId);
  if (!request) return;

  await repository.setRuntimeSetting(getRequestKey(workspaceId), {
    ...request,
    status: "completed",
    completedAt: new Date().toISOString(),
    errorMessage: undefined,
  } satisfies ILibrarianSyncRequest);
}

export async function markLibrarianSyncRequestFailed(
  repository: IOrchestrationRepository,
  workspaceId: string,
  errorMessage: string,
): Promise<void> {
  const request = await getLibrarianSyncRequest(repository, workspaceId);
  if (!request) return;

  await repository.setRuntimeSetting(getRequestKey(workspaceId), {
    ...request,
    status: "failed",
    completedAt: new Date().toISOString(),
    errorMessage,
  } satisfies ILibrarianSyncRequest);
}

export async function getLibrarianWorkspaceState(
  repository: IOrchestrationRepository,
  workspaceId: string,
): Promise<ILibrarianWorkspaceState | undefined> {
  const value = await repository.getRuntimeSetting(getStateKey(workspaceId));
  return isPlainObject(value) ? (value as unknown as ILibrarianWorkspaceState) : undefined;
}

export async function setLibrarianWorkspaceState(
  repository: IOrchestrationRepository,
  workspaceId: string,
  updates: Partial<ILibrarianWorkspaceState>,
): Promise<ILibrarianWorkspaceState> {
  const current = await getLibrarianWorkspaceState(repository, workspaceId);
  const next: ILibrarianWorkspaceState = {
    workspaceId,
    ...(current ?? {}),
    ...updates,
  };
  await repository.setRuntimeSetting(getStateKey(workspaceId), next);
  return next;
}

function getRequestKey(workspaceId: string): string {
  return `${LIBRARIAN_SYNC_REQUEST_KEY_PREFIX}${workspaceId}`;
}

function getStateKey(workspaceId: string): string {
  return `${STATE_KEY_PREFIX}${workspaceId}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
