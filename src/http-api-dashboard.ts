import { HttpApiClient, type IHttpApiClientOptions } from "./http-api-client";
import type {
  IHttpApiAuthStatusResponse,
  IHttpApiCancelJobResponse,
  IHttpApiDownloadImagesWorkflowRequest,
  IHttpApiDownloadWorkflowRequest,
  IHttpApiFetchMetadataWorkflowRequest,
  IHttpApiJobSnapshotResponse,
  IHttpApiLogsResponse,
  IHttpApiMutationResponse,
  IHttpApiProcessWorkflowRequest,
  IHttpApiRefreshWorkflowRequest,
  IHttpApiSetAuthTokenResponse,
  IHttpApiSubmitJobResponse,
  IHttpApiSyncWorkflowRequest,
  ILogEntry,
  ILogQueryFilter,
  IOrchestrationJob,
  IOrchestrationStage,
  IWorkItem,
  OrchestrationStageStatus,
} from "./lib/interfaces";

export interface IDashboardJobSummary {
  id: string;
  workflowType: IOrchestrationJob["workflowType"];
  status: IOrchestrationJob["status"];
  runtimeMode: IOrchestrationJob["runtimeMode"];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  stageCounts: Partial<Record<OrchestrationStageStatus, number>>;
  activeStage?: IOrchestrationStage["stageType"];
  errorMessage?: string;
}

export interface IDashboardJobStageView {
  id: string;
  stageType: IOrchestrationStage["stageType"];
  status: IOrchestrationStage["status"];
  sequence: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  blockedByStageId?: string;
  errorMessage?: string;
  workItemCounts: Partial<Record<IWorkItem["status"], number>>;
}

export interface IDashboardLogEntryView {
  id?: string;
  timestamp: string;
  level: ILogEntry["level"];
  message: string;
  workflowType?: string;
  role?: string;
  jobId?: string;
  stageId?: string;
  workItemId?: string;
  clipId?: string;
  summary: string;
}

export interface IDashboardJobDetails {
  job: IDashboardJobSummary;
  stages: IDashboardJobStageView[];
  logsHref: string;
  latestStatusMessage?: string;
}

export interface IDashboardJobsResult {
  jobs: IDashboardJobSummary[];
}

export interface IDashboardLogsResult {
  entries: IDashboardLogEntryView[];
  nextCursor?: string;
}

export class DashboardApiAdapter {
  private readonly client: HttpApiClient;

  constructor(options: IHttpApiClientOptions = {}) {
    this.client = new HttpApiClient(options);
  }

  getAuthState(signal?: AbortSignal): Promise<IHttpApiAuthStatusResponse> {
    return this.client.getAuthStatus(signal);
  }

  setAuthToken(token: string, signal?: AbortSignal): Promise<IHttpApiSetAuthTokenResponse> {
    return this.client.setAuthToken(token, signal);
  }

  clearAuthToken(signal?: AbortSignal): Promise<IHttpApiMutationResponse> {
    return this.client.clearAuthToken(signal);
  }

  submitDownloadWorkflow(
    payload: IHttpApiDownloadWorkflowRequest,
    signal?: AbortSignal,
  ): Promise<IHttpApiSubmitJobResponse> {
    return this.client.submitWorkflow("download", payload, signal);
  }

  submitProcessWorkflow(
    payload: IHttpApiProcessWorkflowRequest,
    signal?: AbortSignal,
  ): Promise<IHttpApiSubmitJobResponse> {
    return this.client.submitWorkflow("process", payload, signal);
  }

  submitSyncWorkflow(
    payload: IHttpApiSyncWorkflowRequest,
    signal?: AbortSignal,
  ): Promise<IHttpApiSubmitJobResponse> {
    return this.client.submitWorkflow("sync", payload, signal);
  }

  submitDownloadImagesWorkflow(
    payload: IHttpApiDownloadImagesWorkflowRequest,
    signal?: AbortSignal,
  ): Promise<IHttpApiSubmitJobResponse> {
    return this.client.submitWorkflow("download-images", payload, signal);
  }

  submitFetchMetadataWorkflow(
    payload: IHttpApiFetchMetadataWorkflowRequest,
    signal?: AbortSignal,
  ): Promise<IHttpApiSubmitJobResponse> {
    return this.client.submitWorkflow("fetch-metadata", payload, signal);
  }

  submitRefreshWorkflow(
    payload: IHttpApiRefreshWorkflowRequest = {},
    signal?: AbortSignal,
  ): Promise<IHttpApiSubmitJobResponse> {
    return this.client.submitWorkflow("refresh", payload, signal);
  }

  async listJobs(limit?: number, signal?: AbortSignal): Promise<IDashboardJobsResult> {
    const response = await this.client.listJobs(limit, signal);
    return {
      jobs: response.jobs.map((job) => mapJobSummary(job)),
    };
  }

  async getJobDetails(jobId: string, signal?: AbortSignal): Promise<IDashboardJobDetails> {
    const snapshot = normalizeSnapshot(await this.client.getJob(jobId, signal));
    if (!snapshot.job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    return mapJobDetails(snapshot);
  }

  cancelJob(jobId: string, reason?: string, signal?: AbortSignal): Promise<IHttpApiCancelJobResponse> {
    return this.client.cancelJob(jobId, reason, signal);
  }

  async queryLogs(filter: ILogQueryFilter = {}, signal?: AbortSignal): Promise<IDashboardLogsResult> {
    const result = normalizeLogsResult(await this.client.queryLogs(filter, signal));
    return {
      entries: result.entries.map((entry) => mapLogEntry(entry)),
      nextCursor: result.nextCursor,
    };
  }
}

function mapJobDetails(snapshot: IHttpApiJobSnapshotResponse): IDashboardJobDetails {
  const logsQuery = new URLSearchParams();
  if (snapshot.job?.id) {
    logsQuery.set("jobId", snapshot.job.id);
  }

  const latestStatusMessage = snapshot.statusEvents.length > 0
    ? snapshot.statusEvents[snapshot.statusEvents.length - 1].message
    : undefined;

  return {
    job: mapJobSummary(snapshot.job!, snapshot.stages),
    stages: snapshot.stages
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .map((stage) => mapStageView(stage, snapshot.workItems)),
    logsHref: `/api/v1/logs${logsQuery.toString().length > 0 ? `?${logsQuery.toString()}` : ""}`,
    latestStatusMessage,
  };
}

function mapJobSummary(job: IOrchestrationJob, stages: IOrchestrationStage[] = []): IDashboardJobSummary {
  const stageCounts = countByStatus(stages);
  const activeStage = stages
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .find((stage) => stage.status === "running" || stage.status === "queued" || stage.status === "pending")
    ?.stageType;

  return {
    id: job.id,
    workflowType: job.workflowType,
    status: job.status,
    runtimeMode: job.runtimeMode,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: optionalIso(job.startedAt),
    completedAt: optionalIso(job.completedAt),
    stageCounts,
    activeStage,
    errorMessage: job.errorMessage,
  };
}

function normalizeSnapshot(snapshot: IHttpApiJobSnapshotResponse): IHttpApiJobSnapshotResponse {
  return {
    job: snapshot.job ? normalizeJob(snapshot.job) : undefined,
    stages: snapshot.stages.map((stage) => normalizeStage(stage)),
    workItems: snapshot.workItems.map((workItem) => normalizeWorkItem(workItem)),
    statusEvents: snapshot.statusEvents.map((event) => ({
      ...event,
      createdAt: normalizeDate(event.createdAt),
    })),
  };
}

function normalizeLogsResult(result: IHttpApiLogsResponse): IHttpApiLogsResponse {
  return {
    entries: result.entries.map((entry) => ({
      ...entry,
      timestamp: normalizeDate(entry.timestamp),
    })),
    nextCursor: result.nextCursor,
  };
}

function normalizeJob(job: IOrchestrationJob): IOrchestrationJob {
  return {
    ...job,
    createdAt: normalizeDate(job.createdAt),
    updatedAt: normalizeDate(job.updatedAt),
    startedAt: normalizeOptionalDate(job.startedAt),
    completedAt: normalizeOptionalDate(job.completedAt),
  };
}

function normalizeStage(stage: IOrchestrationStage): IOrchestrationStage {
  return {
    ...stage,
    createdAt: normalizeDate(stage.createdAt),
    updatedAt: normalizeDate(stage.updatedAt),
    startedAt: normalizeOptionalDate(stage.startedAt),
    completedAt: normalizeOptionalDate(stage.completedAt),
  };
}

function normalizeWorkItem(workItem: IWorkItem): IWorkItem {
  return {
    ...workItem,
    createdAt: normalizeDate(workItem.createdAt),
    updatedAt: normalizeDate(workItem.updatedAt),
    startedAt: normalizeOptionalDate(workItem.startedAt),
    completedAt: normalizeOptionalDate(workItem.completedAt),
  };
}

function mapStageView(stage: IOrchestrationStage, workItems: IWorkItem[]): IDashboardJobStageView {
  const stageWorkItems = workItems.filter((workItem) => workItem.stageId === stage.id);
  return {
    id: stage.id,
    stageType: stage.stageType,
    status: stage.status,
    sequence: stage.sequence,
    createdAt: stage.createdAt.toISOString(),
    updatedAt: stage.updatedAt.toISOString(),
    startedAt: optionalIso(stage.startedAt),
    completedAt: optionalIso(stage.completedAt),
    blockedByStageId: stage.blockedByStageId,
    errorMessage: stage.errorMessage,
    workItemCounts: countByStatus(stageWorkItems),
  };
}

function mapLogEntry(entry: ILogEntry): IDashboardLogEntryView {
  const summarySegments = [
    entry.level.toUpperCase(),
    entry.context?.workflowType,
    entry.context?.role,
    entry.context?.jobId,
    entry.message,
  ].filter((segment): segment is string => Boolean(segment));

  return {
    id: entry.id,
    timestamp: entry.timestamp.toISOString(),
    level: entry.level,
    message: entry.message,
    workflowType: entry.context?.workflowType,
    role: entry.context?.role,
    jobId: entry.context?.jobId,
    stageId: entry.context?.stageId,
    workItemId: entry.context?.workItemId,
    clipId: entry.context?.clipId,
    summary: summarySegments.join(" | "),
  };
}

function countByStatus<TItem extends { status: string }>(
  items: TItem[],
): Partial<Record<TItem["status"], number>> {
  const counts: Partial<Record<TItem["status"], number>> = {};
  for (const item of items) {
    const current = counts[item.status as TItem["status"]] ?? 0;
    counts[item.status as TItem["status"]] = current + 1;
  }
  return counts;
}

function optionalIso(value: Date | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function normalizeDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeOptionalDate(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  return normalizeDate(value);
}
