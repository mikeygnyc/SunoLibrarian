import type { LogLevel } from "./IOrchestrationShared";
import type { StatusEventScope } from "./IOrchestrationShared";

export interface IStatusEvent<TPayload = Record<string, unknown>> {
  id: string;
  scope: StatusEventScope;
  entityId: string;
  jobId?: string;
  stageId?: string;
  workItemId?: string;
  workerInstanceId?: string;
  eventType: string;
  level: LogLevel;
  message: string;
  payload?: TPayload;
  createdAt: Date;
}

