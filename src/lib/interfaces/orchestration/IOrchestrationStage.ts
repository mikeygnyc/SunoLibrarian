import type { OrchestrationJobStatus, OrchestrationStageStatus, OrchestrationStageType } from "./IOrchestrationShared";

export interface IOrchestrationStage<TPayload = Record<string, unknown>> {
  id: string;
  jobId: string;
  stageType: OrchestrationStageType;
  status: OrchestrationStageStatus;
  sequence: number;
  payload?: TPayload;
  dependsOnStageIds?: string[];
  resourceKey?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  blockedByStageId?: string;
  lastKnownJobStatus?: OrchestrationJobStatus;
  errorCode?: string;
  errorMessage?: string;
}

