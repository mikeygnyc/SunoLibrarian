import type { WorkerRole } from "./IOrchestrationShared";

export type SupervisorRuntimeMode = "local" | "remote";
export type SupervisorWorkerRole = Extract<WorkerRole, "auth" | "metadata" | "asset" | "processing" | "conversion">;
export type SupervisedRuntimeRole = "api" | "orchestrator" | "librarian" | SupervisorWorkerRole;
export type RuntimeHealthStatus = "starting" | "ready";

export interface SupervisorWorkerSpec {
  role: SupervisorWorkerRole;
  count: number;
}

export interface SupervisorLibrarianSpec {
  workspaceId: string;
  healthPort?: number;
}

export interface SupervisorWorkspacePolicy {
  excludedWorkspaceIds: string[];
  disabledWorkspaceIds: string[];
}

export interface SupervisedChildSpec {
  label: string;
  service: "api" | "orchestrator" | "worker" | "librarian";
  role: SupervisedRuntimeRole;
  required: boolean;
  healthUrl: string;
  workspaceId?: string;
}

export interface SupervisedRuntimeTopology {
  mode: SupervisorRuntimeMode;
  api: SupervisedChildSpec;
  orchestrator: SupervisedChildSpec;
  workers: SupervisedChildSpec[];
  librarians: SupervisedChildSpec[];
  workspacePolicy: SupervisorWorkspacePolicy;
}

export interface IRuntimeHealthResponse {
  ok: boolean;
  status: RuntimeHealthStatus;
  service: "api" | "orchestrator" | "worker" | "librarian" | "supervisor";
  role: SupervisedRuntimeRole | "supervisor";
  pid: number;
  workspaceId?: string;
}

export type RemoteSupervisorDesiredState = "present" | "absent";
export type RemoteSupervisorChildStatus = "pending" | "ready" | "failed" | "absent";
export type RemoteSupervisorLifecycleAction = "created" | "updated" | "unchanged" | "removed" | "failed";

export interface RemoteSupervisorChildTarget extends SupervisedChildSpec {
  desiredState: RemoteSupervisorDesiredState;
}

export interface RemoteSupervisorChildStatusReport {
  label: string;
  service: SupervisedChildSpec["service"];
  role: SupervisedRuntimeRole;
  desiredState: RemoteSupervisorDesiredState;
  action: RemoteSupervisorLifecycleAction;
  status: RemoteSupervisorChildStatus;
  healthUrl?: string;
  workspaceId?: string;
  message?: string;
}

export interface RemoteSupervisorReconcileRequest {
  topology: SupervisedRuntimeTopology;
  api: RemoteSupervisorChildTarget;
  orchestrator: RemoteSupervisorChildTarget;
  workers: RemoteSupervisorChildTarget[];
  librarians: RemoteSupervisorChildTarget[];
}

export interface RemoteSupervisorReconcileResult {
  ready: boolean;
  children: RemoteSupervisorChildStatusReport[];
}

export interface IRemoteSupervisorAdapter {
  reconcile(request: RemoteSupervisorReconcileRequest): Promise<RemoteSupervisorReconcileResult>;
  shutdown(reason: string): Promise<void>;
}
