import type { LogLevel, WorkerRole, WorkflowType } from "../orchestration/IOrchestrationShared";

export interface ILogContext {
  service?: string;
  subsystem?: string;
  jobId?: string;
  stageId?: string;
  workItemId?: string;
  workflowType?: WorkflowType;
  workerInstanceId?: string;
  role?: WorkerRole;
  clipId?: string;
  tags?: string[];
  properties?: Record<string, unknown>;
}

export interface ILogEntry {
  id?: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: ILogContext;
  errorCode?: string;
  errorStack?: string;
}

export interface ILogWriteResult {
  accepted: boolean;
  sinkName: string;
  error?: Error;
}
