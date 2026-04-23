import type { IWorkerLease, OrchestrationStageType } from "../lib/interfaces";
import type { LocalControlPlaneRepository } from "./local-control-plane";
import type { IRuntimeConfig, WorkerRole } from "../lib/interfaces";

type StageLeasePlan = {
  resourceKey: string;
  maxActive: number;
  conflictResourceKeys?: string[];
};

const DEFAULT_POLL_INTERVAL_MS = 250;

export class LeaseManager {
  constructor(
    private readonly repository: LocalControlPlaneRepository,
    private readonly runtimeConfig: IRuntimeConfig,
  ) {}

  getStageLeasePlan(stageType: OrchestrationStageType): StageLeasePlan | null {
    switch (stageType) {
      case "metadata-acquisition":
        return {
          resourceKey: "acquisition-global",
          maxActive: this.runtimeConfig.concurrency.metadataAcquisitionMaxActive,
          conflictResourceKeys: ["asset-acquisition-global"],
        };
      case "asset-acquisition":
        return {
          resourceKey: "asset-acquisition-global",
          maxActive: this.runtimeConfig.concurrency.assetAcquisitionMaxActive,
          conflictResourceKeys: ["acquisition-global"],
        };
      case "processing":
        return {
          resourceKey: "processing-global",
          maxActive: this.runtimeConfig.concurrency.processingSongConcurrency,
        };
      case "conversion":
        return {
          resourceKey: "conversion-global",
          maxActive: this.runtimeConfig.concurrency.conversionConcurrency,
        };
      default:
        return null;
    }
  }

  async acquireStageLease(params: {
    stageType: OrchestrationStageType;
    workerInstanceId: string;
    workerRole: WorkerRole;
    jobId: string;
    stageId: string;
    workItemId: string;
  }): Promise<IWorkerLease | null> {
    const plan = this.getStageLeasePlan(params.stageType);
    if (!plan) return null;

    while (true) {
      const lease = await this.repository.acquireLease({
        resourceKey: plan.resourceKey,
        workerInstanceId: params.workerInstanceId,
        workerRole: params.workerRole,
        jobId: params.jobId,
        stageId: params.stageId,
        workItemId: params.workItemId,
        maxActive: plan.maxActive,
        conflictResourceKeys: plan.conflictResourceKeys,
        leaseTtlMs: this.runtimeConfig.leases.leaseTtlMs,
      });

      if (lease) {
        return lease;
      }

      await sleep(DEFAULT_POLL_INTERVAL_MS);
    }
  }

  async hasAvailableCapacity(stageType: OrchestrationStageType): Promise<boolean> {
    const plan = this.getStageLeasePlan(stageType);
    if (!plan) return true;

    const activeLeases = await this.repository.listActiveLeases();
    const conflictKeys = new Set([plan.resourceKey, ...(plan.conflictResourceKeys ?? [])]);
    const activeConflicts = activeLeases.filter((lease) => conflictKeys.has(lease.resourceKey));
    return activeConflicts.length < plan.maxActive;
  }

  async releaseStageLease(lease: IWorkerLease | null | undefined): Promise<void> {
    if (!lease) return;
    await this.repository.releaseLease(lease.id, new Date());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
