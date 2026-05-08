import type {
  IRemoteSupervisorAdapter,
  RemoteSupervisorChildStatusReport,
  RemoteSupervisorChildTarget,
  RemoteSupervisorReconcileRequest,
  RemoteSupervisorReconcileResult,
} from "../core/contracts";

export class UnimplementedRemoteSupervisorAdapter implements IRemoteSupervisorAdapter {
  async reconcile(_request: RemoteSupervisorReconcileRequest): Promise<RemoteSupervisorReconcileResult> {
    throw new Error("Supervisor remote mode is not implemented yet");
  }

  async shutdown(_reason: string): Promise<void> {}
}

export class InMemoryRemoteSupervisorAdapter implements IRemoteSupervisorAdapter {
  private readonly activeChildren = new Map<string, RemoteSupervisorChildTarget>();

  async reconcile(request: RemoteSupervisorReconcileRequest): Promise<RemoteSupervisorReconcileResult> {
    const desiredChildren = flattenDesiredChildren(request);
    const nextChildren = new Map<string, RemoteSupervisorChildTarget>();
    const reports: RemoteSupervisorChildStatusReport[] = [];

    for (const child of desiredChildren) {
      const previous = this.activeChildren.get(child.label);
      const action = !previous
        ? "created"
        : areRemoteChildTargetsEqual(previous, child)
          ? "unchanged"
          : "updated";

      nextChildren.set(child.label, child);
      reports.push({
        label: child.label,
        service: child.service,
        role: child.role,
        desiredState: child.desiredState,
        action,
        status: child.desiredState === "present" ? "ready" : "absent",
        healthUrl: child.healthUrl,
        workspaceId: child.workspaceId,
      });
    }

    for (const previous of this.activeChildren.values()) {
      if (nextChildren.has(previous.label)) {
        continue;
      }
      reports.push({
        label: previous.label,
        service: previous.service,
        role: previous.role,
        desiredState: "absent",
        action: "removed",
        status: "absent",
        healthUrl: previous.healthUrl,
        workspaceId: previous.workspaceId,
      });
    }

    this.activeChildren.clear();
    for (const child of nextChildren.values()) {
      this.activeChildren.set(child.label, child);
    }

    return {
      ready: reports.every((child) => child.status === "ready" || child.status === "absent"),
      children: reports,
    };
  }

  async shutdown(_reason: string): Promise<void> {
    this.activeChildren.clear();
  }
}

function flattenDesiredChildren(request: RemoteSupervisorReconcileRequest): RemoteSupervisorChildTarget[] {
  return [
    request.api,
    request.orchestrator,
    ...request.workers,
    ...request.librarians,
  ];
}

function areRemoteChildTargetsEqual(
  left: RemoteSupervisorChildTarget,
  right: RemoteSupervisorChildTarget,
): boolean {
  return left.label === right.label
    && left.service === right.service
    && left.role === right.role
    && left.required === right.required
    && left.healthUrl === right.healthUrl
    && left.workspaceId === right.workspaceId
    && left.desiredState === right.desiredState;
}
