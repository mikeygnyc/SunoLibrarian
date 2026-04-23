import type { WorkerLeaseStatus, WorkerRole } from "./IOrchestrationShared";

export interface IWorkerLease {
  id: string;
  resourceKey: string;
  status: WorkerLeaseStatus;
  workerInstanceId: string;
  workerRole: WorkerRole;
  jobId?: string;
  stageId?: string;
  workItemId?: string;
  leaseExpiresAt: Date;
  heartbeatAt: Date;
  createdAt: Date;
  updatedAt: Date;
  releasedAt?: Date;
}

