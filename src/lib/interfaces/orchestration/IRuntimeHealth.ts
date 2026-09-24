import type { WorkerRole } from "./IOrchestrationShared";

export type RuntimeHealthStatus = "starting" | "ready";
export type RuntimeHealthService = "api" | "worker" | "librarian";
export type RuntimeHealthRole = "api" | "librarian" | WorkerRole;

export interface IRuntimeHealthResponse {
  ok: boolean;
  status: RuntimeHealthStatus;
  service: RuntimeHealthService;
  role: RuntimeHealthRole;
  pid: number;
  workspaceId?: string;
}
