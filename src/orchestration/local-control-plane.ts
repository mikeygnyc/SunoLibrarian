import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
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

const DEFAULT_LOCAL_CONTROL_PLANE_DIR = path.join(os.homedir(), ".suno-export", "orchestration");
const STATE_FILE = "state.json";
const LOGS_FILE = "logs.json";

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
  constructor(private readonly baseDir: string = DEFAULT_LOCAL_CONTROL_PLANE_DIR) {}

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
    const state = this.readState();
    state.jobs.push(job);
    this.writeState(state);
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
    const state = this.readState();
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
    this.writeState(state);
  }

  async createStage(stage: IOrchestrationStage): Promise<IOrchestrationStage> {
    const state = this.readState();
    state.stages.push(stage);
    this.writeState(state);
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
    const state = this.readState();
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
    this.writeState(state);
  }

  async createWorkItem(workItem: IWorkItem): Promise<IWorkItem> {
    const state = this.readState();
    state.workItems.push(workItem);
    this.writeState(state);
    return workItem;
  }

  async listWorkItems(jobId: string): Promise<IWorkItem[]> {
    return this.readState().workItems
      .filter((workItem) => workItem.jobId === jobId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async updateWorkItemStatus(
    workItemId: string,
    status: WorkItemStatus,
    details: Partial<Pick<IWorkItem, "startedAt" | "completedAt" | "leaseOwnerId" | "errorCode" | "errorMessage">> = {},
  ): Promise<void> {
    const state = this.readState();
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
    this.writeState(state);
  }

  async upsertWorkerInstance(worker: IWorkerInstance): Promise<void> {
    const state = this.readState();
    const existingIndex = state.workerInstances.findIndex((candidate) => candidate.id === worker.id);
    if (existingIndex >= 0) {
      state.workerInstances[existingIndex] = worker;
    } else {
      state.workerInstances.push(worker);
    }
    this.writeState(state);
  }

  async heartbeatWorkerInstance(workerInstanceId: string, heartbeatAt: Date = new Date()): Promise<void> {
    const state = this.readState();
    state.workerInstances = state.workerInstances.map((worker) => {
      if (worker.id !== workerInstanceId) return worker;
      return {
        ...worker,
        heartbeatAt,
      };
    });
    this.writeState(state);
  }

  async upsertLease(lease: IWorkerLease): Promise<void> {
    const state = this.readState();
    const existingIndex = state.workerLeases.findIndex((candidate) => candidate.id === lease.id);
    if (existingIndex >= 0) {
      state.workerLeases[existingIndex] = lease;
    } else {
      state.workerLeases.push(lease);
    }
    this.writeState(state);
  }

  async releaseLease(leaseId: string, releasedAt: Date = new Date()): Promise<void> {
    const state = this.readState();
    state.workerLeases = state.workerLeases.map((lease) => {
      if (lease.id !== leaseId) return lease;
      return {
        ...lease,
        status: "released",
        releasedAt,
        updatedAt: new Date(),
      };
    });
    this.writeState(state);
  }

  async listActiveLeases(resourceKey?: string): Promise<IWorkerLease[]> {
    return this.readState().workerLeases.filter((lease) => {
      if (lease.status !== "active") return false;
      return resourceKey ? lease.resourceKey === resourceKey : true;
    });
  }

  async appendStatusEvent(event: IStatusEvent): Promise<void> {
    const state = this.readState();
    state.statusEvents.push(event);
    this.writeState(state);
  }

  async listStatusEvents(jobId: string): Promise<IStatusEvent[]> {
    return this.readState().statusEvents
      .filter((event) => event.jobId === jobId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async write(entry: ILogEntry): Promise<void> {
    const logs = this.readLogs();
    logs.push(entry);
    this.writeJsonAtomic(this.getLogsPath(), logs);
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
}

function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)) {
    return new Date(value);
  }
  return value;
}
