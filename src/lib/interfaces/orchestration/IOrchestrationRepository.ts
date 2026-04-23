import type { ILogEntry, ILogQueryFilter, ILogQueryResult } from "../logging";
import type { IOrchestrationJob } from "./IOrchestrationJob";
import type { IOrchestrationStage } from "./IOrchestrationStage";
import type { IStatusEvent } from "./IStatusEvent";
import type { IWorkItem } from "./IWorkItem";
import type { IWorkerInstance } from "./IWorkerInstance";
import type { IWorkerLease } from "./IWorkerLease";
import type { OrchestrationJobStatus, OrchestrationStageStatus, WorkItemStatus } from "./IOrchestrationShared";

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
  createStage(stage: IOrchestrationStage): Promise<IOrchestrationStage>;
  listStages(jobId: string): Promise<IOrchestrationStage[]>;
  updateStageStatus(
    stageId: string,
    status: OrchestrationStageStatus,
    details?: Partial<Pick<IOrchestrationStage, "startedAt" | "completedAt" | "blockedByStageId" | "errorCode" | "errorMessage">>,
  ): Promise<void>;
  createWorkItem(workItem: IWorkItem): Promise<IWorkItem>;
  listWorkItems(jobId: string): Promise<IWorkItem[]>;
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
  appendStatusEvent(event: IStatusEvent): Promise<void>;
  listStatusEvents(jobId: string): Promise<IStatusEvent[]>;
}

export interface ICentralLogRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  write(entry: ILogEntry): Promise<void>;
  query(filter?: ILogQueryFilter): Promise<ILogQueryResult>;
}

