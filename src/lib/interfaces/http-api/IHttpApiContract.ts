import type { ILogQueryResult } from "../logging";
import type { IJobSnapshot, IOrchestrationJob, WorkflowType } from "../orchestration";

export interface IHttpApiHealthResponse {
  ok: true;
}

export interface IHttpApiAuthStatusResponse {
  hasToken: boolean;
}

export interface IHttpApiSetAuthTokenRequest {
  token: string;
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
  metadataStore?: IHttpApiMetadataStoreConfig;
  importMetadataJson?: string;
  exportMetadataJson?: string;
  metadataFile?: string;
  copySongsMetadataToOutput?: boolean;
}

export interface IHttpApiDownloadWorkflowRequest extends IHttpApiWorkflowSubmissionBase {
  output?: string;
  workspaceId?: string;
  format?: "mp3" | "wav";
  createdAfter?: string;
  createdBefore?: string;
  delayMs?: number;
  flushCache?: boolean;
}

export interface IHttpApiProcessWorkflowRequest extends IHttpApiWorkflowSubmissionBase {
  input: string;
  output: string;
  formats?: string[];
  bitrateKbps?: number;
  songConcurrency?: number;
  updateConcurrency?: number;
  embedImages?: boolean;
  embedLyrics?: boolean;
  exitOnError?: boolean;
  reconvertBefore?: string;
  reconvertAfter?: string;
  reconvertMissing?: boolean;
  clipIds?: string[];
}

export interface IHttpApiSyncWorkflowRequest extends IHttpApiWorkflowSubmissionBase {
  output: string;
  libraryOutput?: string;
  workspaceId?: string;
  format?: "mp3" | "wav";
  createdAfter?: string;
  createdBefore?: string;
  delayMs?: number;
  flushCache?: boolean;
  processExistingMetadata?: boolean;
  formats?: string[];
  bitrateKbps?: number;
  songConcurrency?: number;
  updateConcurrency?: number;
  embedImages?: boolean;
  embedLyrics?: boolean;
  exitOnError?: boolean;
  reconvertBefore?: string;
  reconvertAfter?: string;
  reconvertMissing?: boolean;
  clipIds?: string[];
}

export interface IHttpApiDownloadImagesWorkflowRequest extends IHttpApiWorkflowSubmissionBase {
  output?: string;
  listPath?: string;
  fetchImageListPath?: string;
  fetchMissing?: boolean;
  delayMs?: number;
}

export interface IHttpApiFetchMetadataWorkflowRequest extends IHttpApiWorkflowSubmissionBase {
  workspaceId?: string;
  trackIds?: string[];
  createdAfter?: string;
  createdBefore?: string;
}

export interface IHttpApiRefreshWorkflowRequest extends IHttpApiWorkflowSubmissionBase {}

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
