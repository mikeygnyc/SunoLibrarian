import type { RuntimeMode, WorkerRole } from "./IOrchestrationShared";

export interface IWorkerInstance {
  id: string;
  role: WorkerRole;
  runtimeMode: RuntimeMode;
  hostname: string;
  processId?: number;
  containerId?: string;
  capabilities?: string[];
  startedAt: Date;
  heartbeatAt: Date;
  metadata?: Record<string, unknown>;
}

