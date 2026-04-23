import type { OrchestrationStageType, WorkItemStatus, WorkerRole } from "./IOrchestrationShared";

export interface IWorkItem<TPayload = Record<string, unknown>> {
  id: string;
  jobId: string;
  stageId: string;
  stageType: OrchestrationStageType;
  status: WorkItemStatus;
  workerRole: WorkerRole;
  leaseOwnerId?: string;
  attemptCount: number;
  maxAttempts?: number;
  payload: TPayload;
  clipId?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  errorCode?: string;
  errorMessage?: string;
}

