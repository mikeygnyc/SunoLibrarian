import { randomUUID } from "crypto";
import * as os from "os";
import type {
  ICentralLogRepository,
  IRuntimeConfig,
  IOrchestrationJob,
  IOrchestrationRepository,
  IOrchestrationStage,
  IStatusEvent,
  IWorkItem,
  IWorkerInstance,
  OrchestrationStageType,
  WorkflowType,
  WorkerRole,
} from "../lib/interfaces";
import { CentralLogger, DatabaseLogSink } from "../logging";
import { LeaseManager } from "./lease-manager";
import { LocalControlPlaneRepository } from "./local-control-plane";
import { DEFAULT_RUNTIME_CONFIG } from "./runtime-defaults";

type StagePlan = {
  type: OrchestrationStageType;
  workerRole: WorkerRole;
};

type StageState = {
  stage: IOrchestrationStage;
  workItem: IWorkItem;
};

export type LocalWorkflowContext = {
  job: IOrchestrationJob<Record<string, unknown>>;
  runStage<T>(stageType: OrchestrationStageType, handler: () => Promise<T>): Promise<T>;
};

type RunLocalWorkflowOptions<TPayload> = {
  workflowType: WorkflowType;
  payload: TPayload;
  stagePlan: StagePlan[];
  onJobCreated?: (jobId: string) => void;
};

export class LocalJobOrchestrator {
  private readonly logger: CentralLogger;
  private readonly leaseManager: LeaseManager;

  constructor(
    private readonly repository: LocalControlPlaneRepository = new LocalControlPlaneRepository(),
    private readonly runtimeConfig: IRuntimeConfig = DEFAULT_RUNTIME_CONFIG,
  ) {
    this.logger = new CentralLogger({
      minimumLevel: "info",
      sinks: [new DatabaseLogSink(this.repository)],
    });
    this.leaseManager = new LeaseManager(this.repository, runtimeConfig);
  }

  async runWorkflow<TPayload extends Record<string, unknown>, TResult>(
    options: RunLocalWorkflowOptions<TPayload>,
    runner: (context: LocalWorkflowContext) => Promise<TResult>,
  ): Promise<{ jobId: string; result: TResult }> {
    await this.repository.initialize();
    const workerInstance = this.createWorkerInstance();
    await this.repository.upsertWorkerInstance(workerInstance);

    const now = new Date();
    const runningJob: IOrchestrationJob<Record<string, unknown>> = {
      id: randomUUID(),
      workflowType: options.workflowType,
      status: "queued",
      runtimeMode: "local",
      payload: options.payload,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.createJob(runningJob);
    options.onJobCreated?.(runningJob.id);

    const stages = new Map<OrchestrationStageType, StageState>();
    for (const [index, stagePlan] of options.stagePlan.entries()) {
      const stage: IOrchestrationStage = {
        id: randomUUID(),
        jobId: runningJob.id,
        stageType: stagePlan.type,
        status: "pending",
        sequence: index + 1,
        createdAt: now,
        updatedAt: now,
      };
      const workItem: IWorkItem = {
        id: randomUUID(),
        jobId: runningJob.id,
        stageId: stage.id,
        stageType: stagePlan.type,
        status: "pending",
        workerRole: stagePlan.workerRole,
        attemptCount: 0,
        payload: {
          workflowType: options.workflowType,
          stageType: stagePlan.type,
        },
        createdAt: now,
        updatedAt: now,
      };
      await this.repository.createStage(stage);
      await this.repository.createWorkItem(workItem);
      stages.set(stagePlan.type, { stage, workItem });
    }

    await this.repository.appendStatusEvent(buildStatusEvent({
      jobId: runningJob.id,
      entityId: runningJob.id,
      eventType: "job-submitted",
      message: `Job submitted for ${options.workflowType}`,
      scope: "job",
      workerInstanceId: workerInstance.id,
    }));
    await this.logger.info(`job submitted for ${options.workflowType}`, {
      jobId: runningJob.id,
      workflowType: options.workflowType,
      role: "orchestrator",
      workerInstanceId: workerInstance.id,
    });

    const startedAt = new Date();
    await this.repository.updateJobStatus(runningJob.id, "running", { startedAt });
    runningJob.status = "running";
    runningJob.startedAt = startedAt;
    runningJob.updatedAt = startedAt;

    try {
      const result = await runner({
        job: runningJob,
        runStage: async <T>(stageType: OrchestrationStageType, handler: () => Promise<T>): Promise<T> => {
          const stageState = stages.get(stageType);
          if (!stageState) {
            throw new Error(`Stage ${stageType} is not defined for workflow ${options.workflowType}`);
          }

          let lease = null;
          const hasCapacity = await this.leaseManager.hasAvailableCapacity(stageType);
          if (!hasCapacity) {
            await this.repository.updateStageStatus(stageState.stage.id, "blocked");
            await this.repository.updateWorkItemStatus(stageState.workItem.id, "blocked");
            await this.repository.appendStatusEvent(buildStatusEvent({
              jobId: runningJob.id,
              stageId: stageState.stage.id,
              workItemId: stageState.workItem.id,
              entityId: stageState.stage.id,
              eventType: "stage-blocked",
              message: `Stage blocked waiting for capacity: ${stageType}`,
              scope: "stage",
              workerInstanceId: workerInstance.id,
            }));
          }

          lease = await this.leaseManager.acquireStageLease({
            stageType,
            workerInstanceId: workerInstance.id,
            workerRole: stageState.workItem.workerRole,
            jobId: runningJob.id,
            stageId: stageState.stage.id,
            workItemId: stageState.workItem.id,
          });

          await this.repository.updateStageStatus(stageState.stage.id, "running", { startedAt: new Date() });
          await this.repository.updateWorkItemStatus(stageState.workItem.id, "running", { startedAt: new Date() });
          await this.repository.appendStatusEvent(buildStatusEvent({
            jobId: runningJob.id,
            stageId: stageState.stage.id,
            workItemId: stageState.workItem.id,
            entityId: stageState.stage.id,
            eventType: "stage-started",
            message: `Stage started: ${stageType}`,
            scope: "stage",
            workerInstanceId: workerInstance.id,
          }));
          await this.logger.info(`stage started: ${stageType}`, {
            jobId: runningJob.id,
            stageId: stageState.stage.id,
            workItemId: stageState.workItem.id,
            workflowType: options.workflowType,
            role: stageState.workItem.workerRole,
            workerInstanceId: workerInstance.id,
          });

          try {
            const result = await handler();
            const completedAt = new Date();
            await this.repository.updateStageStatus(stageState.stage.id, "succeeded", { completedAt });
            await this.repository.updateWorkItemStatus(stageState.workItem.id, "succeeded", { completedAt });
            await this.repository.appendStatusEvent(buildStatusEvent({
              jobId: runningJob.id,
              stageId: stageState.stage.id,
              workItemId: stageState.workItem.id,
              entityId: stageState.stage.id,
              eventType: "stage-succeeded",
              message: `Stage completed: ${stageType}`,
              scope: "stage",
              workerInstanceId: workerInstance.id,
            }));
            await this.leaseManager.releaseStageLease(lease);
            return result;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const completedAt = new Date();
            await this.repository.updateStageStatus(stageState.stage.id, "failed", {
              completedAt,
              errorMessage: message,
            });
            await this.repository.updateWorkItemStatus(stageState.workItem.id, "failed", {
              completedAt,
              errorMessage: message,
            });
            await this.repository.appendStatusEvent(buildStatusEvent({
              jobId: runningJob.id,
              stageId: stageState.stage.id,
              workItemId: stageState.workItem.id,
              entityId: stageState.stage.id,
              eventType: "stage-failed",
              message: `Stage failed: ${stageType} (${message})`,
              scope: "stage",
              workerInstanceId: workerInstance.id,
            }));
            await this.logger.error(`stage failed: ${stageType}`, {
              jobId: runningJob.id,
              stageId: stageState.stage.id,
              workItemId: stageState.workItem.id,
              workflowType: options.workflowType,
              role: stageState.workItem.workerRole,
              workerInstanceId: workerInstance.id,
              properties: { errorMessage: message },
            });
            await this.leaseManager.releaseStageLease(lease);
            throw error;
          }
        },
      });

      const completedAt = new Date();
      await this.repository.updateJobStatus(runningJob.id, "completed", { completedAt });
      await this.repository.appendStatusEvent(buildStatusEvent({
        jobId: runningJob.id,
        entityId: runningJob.id,
        eventType: "job-completed",
        message: `Job completed for ${options.workflowType}`,
        scope: "job",
        workerInstanceId: workerInstance.id,
      }));
      return { jobId: runningJob.id, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const completedAt = new Date();
      await this.repository.updateJobStatus(runningJob.id, "failed", {
        completedAt,
        errorMessage: message,
      });
      await this.repository.appendStatusEvent(buildStatusEvent({
        jobId: runningJob.id,
        entityId: runningJob.id,
        eventType: "job-failed",
        message: `Job failed for ${options.workflowType}: ${message}`,
        scope: "job",
        workerInstanceId: workerInstance.id,
      }));
      throw error;
    }
  }

  async getJobSnapshot(jobId: string): Promise<{
    job?: IOrchestrationJob;
    stages: IOrchestrationStage[];
    workItems: IWorkItem[];
    statusEvents: IStatusEvent[];
  }> {
    await this.repository.initialize();
    const job = await this.repository.getJob(jobId);
    const stages = await this.repository.listStages(jobId);
    const workItems = await this.repository.listWorkItems(jobId);
    const statusEvents = await this.repository.listStatusEvents(jobId);
    return { job, stages, workItems, statusEvents };
  }

  private createWorkerInstance(): IWorkerInstance {
    const now = new Date();
    return {
      id: randomUUID(),
      role: "orchestrator",
      runtimeMode: "local",
      hostname: os.hostname(),
      processId: process.pid,
      startedAt: now,
      heartbeatAt: now,
      metadata: {
        kind: "local-job-orchestrator",
      },
    };
  }
}

function buildStatusEvent(input: {
  jobId: string;
  entityId: string;
  eventType: string;
  message: string;
  scope: IStatusEvent["scope"];
  stageId?: string;
  workItemId?: string;
  workerInstanceId?: string;
}): IStatusEvent {
  return {
    id: randomUUID(),
    scope: input.scope,
    entityId: input.entityId,
    jobId: input.jobId,
    stageId: input.stageId,
    workItemId: input.workItemId,
    workerInstanceId: input.workerInstanceId,
    eventType: input.eventType,
    level: input.eventType.endsWith("failed") ? "error" : "info",
    message: input.message,
    createdAt: new Date(),
  };
}
