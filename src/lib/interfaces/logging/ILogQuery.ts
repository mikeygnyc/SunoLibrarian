import type { LogLevel, WorkerRole, WorkflowType } from "../orchestration/IOrchestrationShared";
import type { ILogEntry } from "./ILogEntry";

export interface ILogQueryFilter {
  jobId?: string;
  stageId?: string;
  workItemId?: string;
  workflowType?: WorkflowType;
  workerInstanceId?: string;
  role?: WorkerRole;
  clipId?: string;
  level?: LogLevel;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}

export interface ILogQueryResult {
  entries: ILogEntry[];
  nextCursor?: string;
}

export interface ILogQueryService {
  query(filter?: ILogQueryFilter): Promise<ILogQueryResult>;
}

