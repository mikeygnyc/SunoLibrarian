import type { OrchestrationJobStatus, RuntimeMode, WorkflowType } from "./IOrchestrationShared";

export interface IOrchestrationJob<TPayload = Record<string, unknown>> {
  id: string;
  workflowType: WorkflowType;
  status: OrchestrationJobStatus;
  runtimeMode: RuntimeMode;
  queueName?: string;
  priority?: number;
  payload: TPayload;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  errorCode?: string;
  errorMessage?: string;
}

