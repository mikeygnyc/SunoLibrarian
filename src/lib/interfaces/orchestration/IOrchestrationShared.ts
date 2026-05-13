export type WorkflowType =
  | "download"
  | "process"
  | "sync"
  | "download-images"
  | "fetch-metadata"
  | "refresh";

export type OrchestrationJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type OrchestrationStageStatus =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled";

export type WorkItemStatus =
  | "pending"
  | "leased"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled";

export type WorkerLeaseStatus = "active" | "expired" | "released";

export type WorkerRole =
  | "auth"
  | "metadata"
  | "asset"
  | "processing"
  | "conversion";

export type RuntimeMode = "local" | "distributed";

export type OrchestrationStageType =
  | "authorization"
  | "metadata-acquisition"
  | "asset-acquisition"
  | "processing"
  | "conversion"
  | "finalization";

export type StatusEventScope = "job" | "stage" | "work-item" | "lease" | "worker";

export type LogLevel = "debug" | "info" | "warn" | "error";
