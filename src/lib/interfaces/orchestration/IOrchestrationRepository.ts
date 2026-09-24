import type { ILogEntry, ILogQueryFilter, ILogQueryResult } from "../logging";
import type { IOrchestrationJob } from "./IOrchestrationJob";
import type { IOrchestrationStage } from "./IOrchestrationStage";
import type { IStatusEvent } from "./IStatusEvent";
import type { IWorkItem } from "./IWorkItem";
import type { IWorkerInstance } from "./IWorkerInstance";
import type { IWorkerLease } from "./IWorkerLease";
import type { OrchestrationJobStatus, OrchestrationStageStatus, WorkItemStatus } from "./IOrchestrationShared";

export interface IClaimedWorkItem {
  job: IOrchestrationJob;
  stage: IOrchestrationStage;
  workItem: IWorkItem;
}

export interface IRuntimeStateCleanupResult {
  expiredLeaseCount: number;
  removedWorkerInstanceCount: number;
}

export interface IOrchestrationRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  createJob(job: IOrchestrationJob): Promise<IOrchestrationJob>;
  getJob(jobId: string): Promise<IOrchestrationJob | undefined>;
  listJobs(limit?: number): Promise<IOrchestrationJob[]>;
  updateJobStatus(
    jobId: string,
    status: OrchestrationJobStatus,
    details?: Partial<Pick<IOrchestrationJob, "startedAt" | "completedAt" | "errorCode" | "errorMessage">>,
  ): Promise<void>;
  updateJobPayload(
    jobId: string,
    payload: IOrchestrationJob["payload"],
  ): Promise<void>;
  cancelJob(
    jobId: string,
    details?: Partial<Pick<IOrchestrationJob, "completedAt" | "errorCode" | "errorMessage">>,
  ): Promise<void>;
  createStage(stage: IOrchestrationStage): Promise<IOrchestrationStage>;
  listStages(jobId: string): Promise<IOrchestrationStage[]>;
  updateStageStatus(
    stageId: string,
    status: OrchestrationStageStatus,
    details?: Partial<Pick<IOrchestrationStage, "startedAt" | "completedAt" | "blockedByStageId" | "errorCode" | "errorMessage">>,
  ): Promise<void>;
  createWorkItem(workItem: IWorkItem): Promise<IWorkItem>;
  listWorkItems(jobId: string): Promise<IWorkItem[]>;
  claimNextRunnableWorkItem(workerRole: IWorkItem["workerRole"], workerInstanceId: string): Promise<IClaimedWorkItem | null>;
  updateWorkItemStatus(
    workItemId: string,
    status: WorkItemStatus,
    details?: Partial<Pick<IWorkItem, "startedAt" | "completedAt" | "leaseOwnerId" | "errorCode" | "errorMessage">>,
  ): Promise<void>;
  upsertWorkerInstance(worker: IWorkerInstance): Promise<void>;
  heartbeatWorkerInstance(workerInstanceId: string, heartbeatAt?: Date): Promise<void>;
  upsertLease(lease: IWorkerLease): Promise<void>;
  releaseLease(leaseId: string, releasedAt?: Date): Promise<void>;
  listActiveLeases(resourceKey?: string): Promise<IWorkerLease[]>;
  acquireLease(params: {
    resourceKey: string;
    workerInstanceId: string;
    workerRole: IWorkerLease["workerRole"];
    jobId?: string;
    stageId?: string;
    workItemId?: string;
    maxActive: number;
    conflictResourceKeys?: string[];
    leaseTtlMs?: number;
  }): Promise<IWorkerLease | null>;
  appendStatusEvent(event: IStatusEvent): Promise<void>;
  listStatusEvents(jobId: string): Promise<IStatusEvent[]>;
  cleanupStaleRuntimeState(staleBefore: Date): Promise<IRuntimeStateCleanupResult>;
  getRuntimeSetting(key: string): Promise<unknown | undefined>;
  setRuntimeSetting(key: string, value: unknown): Promise<void>;
  deleteRuntimeSetting(key: string): Promise<void>;
}

export interface ICentralLogRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  write(entry: ILogEntry): Promise<void>;
  query(filter?: ILogQueryFilter): Promise<ILogQueryResult>;
}
