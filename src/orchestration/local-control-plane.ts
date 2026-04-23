import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
  IClaimedWorkItem,
  ICentralLogRepository,
  ILogEntry,
  ILogQueryFilter,
  ILogQueryResult,
  IOrchestrationJob,
  IOrchestrationRepository,
  IOrchestrationStage,
  IStatusEvent,
  IWorkItem,
  IWorkerInstance,
  IWorkerLease,
  OrchestrationJobStatus,
  OrchestrationStageStatus,
  WorkItemStatus,
} from "../lib/interfaces";

const STATE_FILE = "state.json";
const LOGS_FILE = "logs.json";
const LOCK_DIR = ".lock";
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5_000;

type PersistedState = {
  jobs: IOrchestrationJob[];
  stages: IOrchestrationStage[];
  workItems: IWorkItem[];
  workerInstances: IWorkerInstance[];
  workerLeases: IWorkerLease[];
  statusEvents: IStatusEvent[];
};

const EMPTY_STATE: PersistedState = {
  jobs: [],
  stages: [],
  workItems: [],
  workerInstances: [],
  workerLeases: [],
  statusEvents: [],
};

export class LocalControlPlaneRepository implements IOrchestrationRepository, ICentralLogRepository {
  constructor(private readonly baseDir: string = resolveDefaultControlPlaneDir()) {}

  async initialize(): Promise<void> {
    fs.mkdirSync(this.baseDir, { recursive: true });
    if (!fs.existsSync(this.getStatePath())) {
      this.writeJsonAtomic(this.getStatePath(), EMPTY_STATE);
    }
    if (!fs.existsSync(this.getLogsPath())) {
      this.writeJsonAtomic(this.getLogsPath(), []);
    }
  }

  async close(): Promise<void> {}

  async createJob(job: IOrchestrationJob): Promise<IOrchestrationJob> {
    await this.withLockedState((state) => {
      state.jobs.push(job);
      return state;
    });
    return job;
  }

  async getJob(jobId: string): Promise<IOrchestrationJob | undefined> {
    return this.readState().jobs.find((job) => job.id === jobId);
  }

  async listJobs(limit: number = 100): Promise<IOrchestrationJob[]> {
    return this.readState().jobs
      .slice()
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit);
  }

  async updateJobStatus(
    jobId: string,
    status: OrchestrationJobStatus,
    details: Partial<Pick<IOrchestrationJob, "startedAt" | "completedAt" | "errorCode" | "errorMessage">> = {},
  ): Promise<void> {
    await this.withLockedState((state) => {
      state.jobs = state.jobs.map((job) => {
        if (job.id !== jobId) return job;
        return {
          ...job,
          status,
          startedAt: details.startedAt ?? job.startedAt,
          completedAt: details.completedAt ?? job.completedAt,
          errorCode: details.errorCode ?? job.errorCode,
          errorMessage: details.errorMessage ?? job.errorMessage,
          updatedAt: new Date(),
        };
      });
      return state;
    });
  }

  async createStage(stage: IOrchestrationStage): Promise<IOrchestrationStage> {
    await this.withLockedState((state) => {
      state.stages.push(stage);
      return state;
    });
    return stage;
  }

  async listStages(jobId: string): Promise<IOrchestrationStage[]> {
    return this.readState().stages
      .filter((stage) => stage.jobId === jobId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async updateStageStatus(
    stageId: string,
    status: OrchestrationStageStatus,
    details: Partial<Pick<IOrchestrationStage, "startedAt" | "completedAt" | "blockedByStageId" | "errorCode" | "errorMessage">> = {},
  ): Promise<void> {
    await this.withLockedState((state) => {
      state.stages = state.stages.map((stage) => {
        if (stage.id !== stageId) return stage;
        return {
          ...stage,
          status,
          startedAt: details.startedAt ?? stage.startedAt,
          completedAt: details.completedAt ?? stage.completedAt,
          blockedByStageId: details.blockedByStageId ?? stage.blockedByStageId,
          errorCode: details.errorCode ?? stage.errorCode,
          errorMessage: details.errorMessage ?? stage.errorMessage,
          updatedAt: new Date(),
        };
      });
      return state;
    });
  }

  async createWorkItem(workItem: IWorkItem): Promise<IWorkItem> {
    await this.withLockedState((state) => {
      state.workItems.push(workItem);
      return state;
    });
    return workItem;
  }

  async listWorkItems(jobId: string): Promise<IWorkItem[]> {
    return this.readState().workItems
      .filter((workItem) => workItem.jobId === jobId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async claimNextRunnableWorkItem(workerRole: IWorkItem["workerRole"], workerInstanceId: string): Promise<IClaimedWorkItem | null> {
    return this.withLockedState((state) => {
      const activeJobs = new Set(
        state.jobs
          .filter((job) => job.status === "queued" || job.status === "running")
          .map((job) => job.id),
      );

      const sortedCandidates = state.workItems
        .filter((workItem) => {
          return activeJobs.has(workItem.jobId)
            && workItem.workerRole === workerRole
            && (workItem.status === "pending" || workItem.status === "blocked");
        })
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

      for (const candidate of sortedCandidates) {
        const stage = state.stages.find((item) => item.id === candidate.stageId);
        const job = state.jobs.find((item) => item.id === candidate.jobId);
        if (!stage || !job) continue;
        if (!this.areStageDependenciesSatisfied(state, stage)) continue;

        const claimedAt = new Date();
        state.workItems = state.workItems.map((workItem) => {
          if (workItem.id !== candidate.id) return workItem;
          return {
            ...workItem,
            status: "leased",
            leaseOwnerId: workerInstanceId,
            updatedAt: claimedAt,
          };
        });
        state.stages = state.stages.map((stageItem) => {
          if (stageItem.id !== stage.id) return stageItem;
          return {
            ...stageItem,
            status: "queued",
            updatedAt: claimedAt,
          };
        });

        return {
          job,
          stage,
          workItem: {
            ...candidate,
            status: "leased",
            leaseOwnerId: workerInstanceId,
            updatedAt: claimedAt,
          },
        };
      }

      return null;
    });
  }

  async updateWorkItemStatus(
    workItemId: string,
    status: WorkItemStatus,
    details: Partial<Pick<IWorkItem, "startedAt" | "completedAt" | "leaseOwnerId" | "errorCode" | "errorMessage">> = {},
  ): Promise<void> {
    await this.withLockedState((state) => {
      state.workItems = state.workItems.map((workItem) => {
        if (workItem.id !== workItemId) return workItem;
        return {
          ...workItem,
          status,
          startedAt: details.startedAt ?? workItem.startedAt,
          completedAt: details.completedAt ?? workItem.completedAt,
          leaseOwnerId: details.leaseOwnerId ?? workItem.leaseOwnerId,
          errorCode: details.errorCode ?? workItem.errorCode,
          errorMessage: details.errorMessage ?? workItem.errorMessage,
          updatedAt: new Date(),
        };
      });
      return state;
    });
  }

  async upsertWorkerInstance(worker: IWorkerInstance): Promise<void> {
    await this.withLockedState((state) => {
      const existingIndex = state.workerInstances.findIndex((candidate) => candidate.id === worker.id);
      if (existingIndex >= 0) {
        state.workerInstances[existingIndex] = worker;
      } else {
        state.workerInstances.push(worker);
      }
      return state;
    });
  }

  async heartbeatWorkerInstance(workerInstanceId: string, heartbeatAt: Date = new Date()): Promise<void> {
    await this.withLockedState((state) => {
      state.workerInstances = state.workerInstances.map((worker) => {
        if (worker.id !== workerInstanceId) return worker;
        return {
          ...worker,
          heartbeatAt,
        };
      });
      return state;
    });
  }

  async upsertLease(lease: IWorkerLease): Promise<void> {
    await this.withLockedState((state) => {
      const existingIndex = state.workerLeases.findIndex((candidate) => candidate.id === lease.id);
      if (existingIndex >= 0) {
        state.workerLeases[existingIndex] = lease;
      } else {
        state.workerLeases.push(lease);
      }
      return state;
    });
  }

  async releaseLease(leaseId: string, releasedAt: Date = new Date()): Promise<void> {
    await this.withLockedState((state) => {
      state.workerLeases = state.workerLeases.map((lease) => {
        if (lease.id !== leaseId) return lease;
        return {
          ...lease,
          status: "released",
          releasedAt,
          updatedAt: new Date(),
        };
      });
      return state;
    });
  }

  async listActiveLeases(resourceKey?: string): Promise<IWorkerLease[]> {
    return this.readState().workerLeases.filter((lease) => {
      if (lease.status !== "active") return false;
      return resourceKey ? lease.resourceKey === resourceKey : true;
    });
  }

  async appendStatusEvent(event: IStatusEvent): Promise<void> {
    await this.withLockedState((state) => {
      state.statusEvents.push(event);
      return state;
    });
  }

  async listStatusEvents(jobId: string): Promise<IStatusEvent[]> {
    return this.readState().statusEvents
      .filter((event) => event.jobId === jobId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async write(entry: ILogEntry): Promise<void> {
    await this.withLogsLock((logs) => {
      logs.push(entry);
      return logs;
    });
  }

  async acquireLease(params: {
    resourceKey: string;
    workerInstanceId: string;
    workerRole: IWorkerLease["workerRole"];
    jobId?: string;
    stageId?: string;
    workItemId?: string;
    maxActive: number;
    conflictResourceKeys?: string[];
    leaseTtlMs?: number;
  }): Promise<IWorkerLease | null> {
    return this.withLockedState((state) => {
      const now = new Date();
      state.workerLeases = state.workerLeases.map((lease) => {
        if (lease.status === "active" && lease.leaseExpiresAt <= now) {
          return {
            ...lease,
            status: "expired",
            updatedAt: now,
          };
        }
        return lease;
      });

      const conflictKeys = new Set([params.resourceKey, ...(params.conflictResourceKeys ?? [])]);
      const activeConflicts = state.workerLeases.filter((lease) => {
        return lease.status === "active" && conflictKeys.has(lease.resourceKey);
      });

      if (activeConflicts.length >= params.maxActive) {
        return null;
      }

      const lease: IWorkerLease = {
        id: randomLeaseId(),
        resourceKey: params.resourceKey,
        status: "active",
        workerInstanceId: params.workerInstanceId,
        workerRole: params.workerRole,
        jobId: params.jobId,
        stageId: params.stageId,
        workItemId: params.workItemId,
        leaseExpiresAt: new Date(now.getTime() + (params.leaseTtlMs ?? 30_000)),
        heartbeatAt: now,
        createdAt: now,
        updatedAt: now,
      };
      state.workerLeases.push(lease);
      return lease;
    });
  }

  async query(filter: ILogQueryFilter = {}): Promise<ILogQueryResult> {
    const entries = this.readLogs()
      .filter((entry) => {
        const context = entry.context ?? {};
        if (filter.jobId && context.jobId !== filter.jobId) return false;
        if (filter.stageId && context.stageId !== filter.stageId) return false;
        if (filter.workItemId && context.workItemId !== filter.workItemId) return false;
        if (filter.workflowType && context.workflowType !== filter.workflowType) return false;
        if (filter.workerInstanceId && context.workerInstanceId !== filter.workerInstanceId) return false;
        if (filter.role && context.role !== filter.role) return false;
        if (filter.clipId && context.clipId !== filter.clipId) return false;
        if (filter.level && entry.level !== filter.level) return false;
        if (filter.startTime && entry.timestamp < filter.startTime) return false;
        if (filter.endTime && entry.timestamp > filter.endTime) return false;
        return true;
      })
      .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());

    return {
      entries: entries.slice(0, filter.limit ?? 100),
    };
  }

  getStateFilePath(): string {
    return this.getStatePath();
  }

  private getStatePath(): string {
    return path.join(this.baseDir, STATE_FILE);
  }

  private getLogsPath(): string {
    return path.join(this.baseDir, LOGS_FILE);
  }

  private readState(): PersistedState {
    this.ensureInitializedSync();
    const raw = fs.readFileSync(this.getStatePath(), "utf8");
    const parsed = raw.trim() ? JSON.parse(raw, dateReviver) : EMPTY_STATE;
    return {
      jobs: parsed.jobs ?? [],
      stages: parsed.stages ?? [],
      workItems: parsed.workItems ?? [],
      workerInstances: parsed.workerInstances ?? [],
      workerLeases: parsed.workerLeases ?? [],
      statusEvents: parsed.statusEvents ?? [],
    };
  }

  private writeState(state: PersistedState): void {
    this.writeJsonAtomic(this.getStatePath(), state);
  }

  private areStageDependenciesSatisfied(state: PersistedState, stage: IOrchestrationStage): boolean {
    const priorStages = state.stages
      .filter((candidate) => candidate.jobId === stage.jobId && candidate.sequence < stage.sequence);
    return priorStages.every((candidate) => candidate.status === "succeeded");
  }

  private readLogs(): ILogEntry[] {
    this.ensureInitializedSync();
    const raw = fs.readFileSync(this.getLogsPath(), "utf8");
    return raw.trim() ? JSON.parse(raw, dateReviver) : [];
  }

  private writeJsonAtomic(filePath: string, value: unknown): void {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
    fs.renameSync(tmpPath, filePath);
  }

  private ensureInitializedSync(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    if (!fs.existsSync(this.getStatePath())) {
      this.writeJsonAtomic(this.getStatePath(), EMPTY_STATE);
    }
    if (!fs.existsSync(this.getLogsPath())) {
      this.writeJsonAtomic(this.getLogsPath(), []);
    }
  }

  private async withLockedState<TResult>(
    updater: (state: PersistedState) => TResult,
  ): Promise<TResult> {
    return this.withFileLock(this.getLockPath(), () => {
      const state = this.readState();
      const result = updater(state);
      this.writeState(state);
      return result;
    });
  }

  private async withLogsLock<TResult>(updater: (logs: ILogEntry[]) => TResult): Promise<TResult> {
    return this.withFileLock(`${this.getLockPath()}-logs`, () => {
      const logs = this.readLogs();
      const result = updater(logs);
      this.writeJsonAtomic(this.getLogsPath(), logs);
      return result;
    });
  }

  private async withFileLock<TResult>(lockPath: string, work: () => TResult): Promise<TResult> {
    const startedAt = Date.now();
    while (true) {
      try {
        fs.mkdirSync(lockPath);
        break;
      } catch (error: any) {
        if (error?.code !== "EEXIST") {
          throw error;
        }
        if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
          throw new Error(`Timed out waiting for local control-plane lock: ${lockPath}`);
        }
        await sleep(LOCK_RETRY_MS);
      }
    }

    try {
      return work();
    } finally {
      fs.rmdirSync(lockPath);
    }
  }

  private getLockPath(): string {
    return path.join(this.baseDir, LOCK_DIR);
  }
}

function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)) {
    return new Date(value);
  }
  return value;
}

function resolveDefaultControlPlaneDir(): string {
  return process.env.SUNO_EXPORT_CONTROL_PLANE_DIR?.trim()
    || path.join(os.homedir(), ".suno-export", "orchestration");
}

function randomLeaseId(): string {
  return `lease-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
