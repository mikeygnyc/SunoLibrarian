import type { ILogQueryResult } from "../logging";
import type { IJobSnapshot, IOrchestrationJob, IRuntimeHealthResponse, WorkflowType } from "../orchestration";

export interface IHttpApiHealthResponse extends IRuntimeHealthResponse {}

export interface IHttpApiAuthStatusResponse {
  hasToken: boolean;
}

export interface IHttpApiSetAuthTokenRequest {
  token: string;
}

export interface IHttpApiSetAuthTokenResponse extends IHttpApiMutationResponse {
  restartedJobIds: string[];
  restartedJobCount: number;
  restartError?: string;
}

export interface IHttpApiAuthConfig {
  token?: string;
  browserUrl?: string;
  ignoreCachedToken?: boolean;
  browserProfile?: string;
  profileDirectory?: string;
}

export interface IHttpApiMetadataStoreConfig {
  type?: "sqlite" | "postgres";
  sqlitePath?: string;
  postgresUrl?: string;
}

export interface IHttpApiMutationResponse {
  ok: true;
}

export interface IHttpApiListJobsResponse {
  jobs: IOrchestrationJob[];
}

export interface IHttpApiSubmitJobResponse {
  jobId: string;
  workflowType: WorkflowType;
  status: "queued";
}

export interface IHttpApiWorkflowSubmissionBase {
  auth?: IHttpApiAuthConfig;
}

export interface IHttpApiDownloadWorkflowRequest extends IHttpApiWorkflowSubmissionBase {
  workspaceId?: string;
  format?: "mp3" | "wav";
  createdAfter?: string;
  createdBefore?: string;
  flushCache?: boolean;
}

export interface IHttpApiProcessWorkflowRequest extends IHttpApiWorkflowSubmissionBase {
  formats?: string[];
  bitrateKbps?: number;
  embedImages?: boolean;
  embedLyrics?: boolean;
  exitOnError?: boolean;
  reconvertBefore?: string;
  reconvertAfter?: string;
  reconvertMissing?: boolean;
  clipIds?: string[];
}

export interface IHttpApiSyncWorkflowRequest extends IHttpApiWorkflowSubmissionBase {
  workspaceId?: string;
  format?: "mp3" | "wav";
  createdAfter?: string;
  createdBefore?: string;
  flushCache?: boolean;
  processExistingMetadata?: boolean;
  formats?: string[];
  bitrateKbps?: number;
  embedImages?: boolean;
  embedLyrics?: boolean;
  exitOnError?: boolean;
  reconvertBefore?: string;
  reconvertAfter?: string;
  reconvertMissing?: boolean;
  clipIds?: string[];
}

export interface IHttpApiDownloadImagesWorkflowRequest extends IHttpApiWorkflowSubmissionBase {
  listPath?: string;
  fetchImageListPath?: string;
  fetchMissing?: boolean;
}

export interface IHttpApiFetchMetadataWorkflowRequest extends IHttpApiWorkflowSubmissionBase {
  workspaceId?: string;
  trackIds?: string[];
  createdAfter?: string;
  createdBefore?: string;
}

export interface IHttpApiRefreshWorkflowRequest extends IHttpApiWorkflowSubmissionBase {}

export interface IHttpApiWorkflowRequestMap {
  "download": IHttpApiDownloadWorkflowRequest;
  "process": IHttpApiProcessWorkflowRequest;
  "sync": IHttpApiSyncWorkflowRequest;
  "download-images": IHttpApiDownloadImagesWorkflowRequest;
  "fetch-metadata": IHttpApiFetchMetadataWorkflowRequest;
  "refresh": IHttpApiRefreshWorkflowRequest;
}

export interface IHttpApiCancelJobRequest {
  reason?: string;
}

export interface IHttpApiCancelJobResponse {
  jobId: string;
  status: "cancelled";
}

export type IHttpApiJobSnapshotResponse = IJobSnapshot;
export type IHttpApiLogsResponse = ILogQueryResult;

export interface IHttpApiErrorResponse {
  error: string;
}
