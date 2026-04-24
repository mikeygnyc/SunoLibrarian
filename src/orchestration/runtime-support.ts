import { randomUUID } from "crypto";
import { SunoClient } from "../client";
import { CancellationError } from "../cancellation";
import type {
  ICentralLogRepository,
  IJobSnapshot,
  IOrchestrationRepository,
  OrchestrationStageType,
  WorkerRole,
  WorkflowType,
} from "../lib/interfaces";
import { CentralLogger, ConsoleLogSink, DatabaseLogSink } from "../logging";
import { LocalControlPlaneRepository } from "./local-control-plane";
import { PostgresControlPlaneRepository } from "./postgres-control-plane";
import type { CliOptions } from "../services";

const RECENT_AUTH_RESTART_WINDOW_MS = 60 * 60 * 1000;
const RECENT_AUTH_RESTART_LIMIT = 100;

export type AuthFailureCode = "auth_missing" | "auth_invalid" | "auth_expired";

export type ControlPlaneRepository = IOrchestrationRepository & ICentralLogRepository;

export type WorkflowStagePlanItem = {
  type: Extract<
    OrchestrationStageType,
    "authorization" | "metadata-acquisition" | "asset-acquisition" | "processing" | "conversion" | "finalization"
  >;
  workerRole: Extract<WorkerRole, "orchestrator" | "auth" | "metadata" | "asset" | "processing" | "conversion">;
};

export const SUPPORTED_WORKFLOW_TYPES: WorkflowType[] = [
  "download",
  "process",
  "sync",
  "download-images",
  "fetch-metadata",
  "refresh",
];

export function createRuntimeLogger(repository: ControlPlaneRepository): CentralLogger {
  return new CentralLogger({
    minimumLevel: "debug",
    sinks: [new DatabaseLogSink(repository), new ConsoleLogSink()],
  });
}

export function createControlPlaneRepository(options: CliOptions = {}): ControlPlaneRepository {
  if (resolveControlPlaneBackend(options) === "postgres") {
    return new PostgresControlPlaneRepository({
      postgresUrl: typeof options.postgresUrl === "string" ? options.postgresUrl : undefined,
    });
  }
  return new LocalControlPlaneRepository();
}

export function resolveControlPlaneBackend(options: CliOptions = {}): "local" | "postgres" {
  if (typeof options.controlPlane === "string" && options.controlPlane.trim() === "postgres") {
    return "postgres";
  }
  if (process.env.SUNO_EXPORT_CONTROL_PLANE_BACKEND?.trim() === "postgres") {
    return "postgres";
  }
  return "local";
}

export function serializeJobPayload(options: CliOptions): Record<string, unknown> {
  return JSON.parse(JSON.stringify(options, (_key, value) => {
    if (typeof value === "function") return undefined;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof SunoClient) return undefined;
    return value;
  })) as Record<string, unknown>;
}

export function classifyAuthFailure(message: string | undefined): AuthFailureCode | undefined {
  const normalized = message?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized.includes("authentication required")
    || normalized.includes("provide either --token or --browser")
    || normalized.includes("missing auth")
    || normalized.includes("missing token")
  ) {
    return "auth_missing";
  }

  if (
    normalized.includes("expired auth")
    || normalized.includes("expired token")
  ) {
    return "auth_expired";
  }

  if (
    normalized.includes("invalid auth")
    || normalized.includes("invalid token")
    || normalized.includes("cached authentication token was rejected")
    || normalized.includes("token was rejected")
    || normalized.includes("401")
    || normalized.includes("403")
  ) {
    return "auth_invalid";
  }

  return undefined;
}

export function getWorkflowStagePlan(workflowType: WorkflowType): WorkflowStagePlanItem[] {
  switch (workflowType) {
    case "download":
      return [
        { type: "authorization", workerRole: "auth" },
        { type: "asset-acquisition", workerRole: "asset" },
        { type: "finalization", workerRole: "orchestrator" },
      ];
    case "process":
      return [
        { type: "processing", workerRole: "processing" },
        { type: "conversion", workerRole: "conversion" },
        { type: "finalization", workerRole: "orchestrator" },
      ];
    case "sync":
      return [
        { type: "authorization", workerRole: "auth" },
        { type: "asset-acquisition", workerRole: "asset" },
        { type: "processing", workerRole: "processing" },
        { type: "conversion", workerRole: "conversion" },
        { type: "finalization", workerRole: "orchestrator" },
      ];
    case "download-images":
      return [
        { type: "authorization", workerRole: "auth" },
        { type: "asset-acquisition", workerRole: "asset" },
        { type: "finalization", workerRole: "orchestrator" },
      ];
    case "fetch-metadata":
      return [
        { type: "authorization", workerRole: "auth" },
        { type: "metadata-acquisition", workerRole: "metadata" },
        { type: "finalization", workerRole: "orchestrator" },
      ];
    case "refresh":
      return [
        { type: "authorization", workerRole: "auth" },
        { type: "metadata-acquisition", workerRole: "metadata" },
        { type: "finalization", workerRole: "orchestrator" },
      ];
  }
}

export async function submitWorkflowJob(
  workflowType: WorkflowType,
  options: CliOptions,
): Promise<string> {
  const repository = createControlPlaneRepository(options);
  try {
    await repository.initialize();
    const logger = createRuntimeLogger(repository);
    const stagePlan = getWorkflowStagePlan(workflowType);
    const now = new Date();
    const jobId = `${workflowType}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await repository.createJob({
      id: jobId,
      workflowType,
      status: "queued",
      runtimeMode: "distributed",
      payload: serializeJobPayload(options),
      createdAt: now,
      updatedAt: now,
    });

    for (const [index, stagePlanItem] of stagePlan.entries()) {
      const stageId = `${jobId}-stage-${index + 1}`;
      const workItemId = `${jobId}-work-${index + 1}`;
      await repository.createStage({
        id: stageId,
        jobId,
        stageType: stagePlanItem.type,
        status: "pending",
        sequence: index + 1,
        createdAt: now,
        updatedAt: now,
      });
      await repository.createWorkItem({
        id: workItemId,
        jobId,
        stageId,
        stageType: stagePlanItem.type,
        status: "pending",
        workerRole: stagePlanItem.workerRole,
        attemptCount: 0,
        payload: {
          workflowType,
          stageType: stagePlanItem.type,
        },
        createdAt: now,
        updatedAt: now,
      });
    }

    await logger.info("workflow job submitted", {
      jobId,
      workflowType,
      role: "orchestrator",
      properties: {
        runtimeMode: "distributed",
        stageCount: stagePlan.length,
        controlPlaneBackend: resolveControlPlaneBackend(options),
      },
    });

    return jobId;
  } finally {
    await repository.close();
  }
}

export async function getJobSnapshot(
  repository: IOrchestrationRepository,
  jobId: string,
): Promise<IJobSnapshot> {
  const job = await repository.getJob(jobId);
  const stages = await repository.listStages(jobId);
  const workItems = await repository.listWorkItems(jobId);
  const statusEvents = await repository.listStatusEvents(jobId);
  return { job, stages, workItems, statusEvents };
}

export async function cancelWorkflowJob(
  jobId: string,
  options: CliOptions = {},
  reason?: string,
): Promise<IJobSnapshot | undefined> {
  const repository = createControlPlaneRepository(options);
  try {
    await repository.initialize();
    const logger = createRuntimeLogger(repository);
    const job = await repository.getJob(jobId);
    if (!job) {
      return undefined;
    }

    if (job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled") {
      const cancelledAt = new Date();
      await repository.cancelJob(jobId, {
        completedAt: cancelledAt,
        errorCode: "job_cancelled",
        errorMessage: reason?.trim() || "Job cancelled by operator request",
      });
      await repository.appendStatusEvent({
        id: randomUUID(),
        scope: "job",
        entityId: jobId,
        jobId,
        eventType: "job-cancelled",
        level: "info",
        message: reason?.trim()
          ? `Job cancelled: ${reason.trim()}`
          : "Job cancelled by operator request",
        createdAt: cancelledAt,
      });
      await logger.info("workflow job cancelled", {
        jobId,
        workflowType: job.workflowType,
        role: "orchestrator",
        properties: {
          reason: reason?.trim() || null,
          controlPlaneBackend: resolveControlPlaneBackend(options),
        },
      });
    }

    return getJobSnapshot(repository, jobId);
  } finally {
    await repository.close();
  }
}

export async function restartRecentlyFailedAuthJobs(
  options: CliOptions = {},
): Promise<{ restartedJobIds: string[]; originalJobIds: string[] }> {
  const repository = createControlPlaneRepository(options);
  try {
    await repository.initialize();
    const restartedJobIds: string[] = [];
    const originalJobIds: string[] = [];
    const jobs = await repository.listJobs(RECENT_AUTH_RESTART_LIMIT);
    const restartThreshold = Date.now() - RECENT_AUTH_RESTART_WINDOW_MS;

    for (const job of jobs) {
      if (job.status !== "failed" || job.workflowType === "process") {
        continue;
      }

      const completedAtMs = job.completedAt?.getTime() ?? job.updatedAt.getTime();
      if (completedAtMs < restartThreshold) {
        continue;
      }

      const snapshot = await getJobSnapshot(repository, job.id);
      if (!isRestartableAuthFailure(snapshot)) {
        continue;
      }

      const payload = buildRestartPayload(job.payload);
      const restartedJobId = await submitWorkflowJob(job.workflowType, payload);
      restartedJobIds.push(restartedJobId);
      originalJobIds.push(job.id);

      await repository.appendStatusEvent({
        id: randomUUID(),
        scope: "job",
        entityId: job.id,
        jobId: job.id,
        eventType: "job-restarted-after-auth",
        level: "info",
        message: `Job restarted after auth token refresh as ${restartedJobId}`,
        payload: { restartedJobId },
        createdAt: new Date(),
      });
    }

    return { restartedJobIds, originalJobIds };
  } finally {
    await repository.close();
  }
}

function isRestartableAuthFailure(snapshot: IJobSnapshot): boolean {
  if (!snapshot.job || snapshot.job.status !== "failed") {
    return false;
  }

  if (snapshot.statusEvents.some((event) => event.eventType === "job-restarted-after-auth")) {
    return false;
  }

  const authorizationStage = snapshot.stages.find((stage) => stage.stageType === "authorization");
  const authFailureCode = authorizationStage?.errorCode ?? snapshot.job.errorCode;
  if (authFailureCode === "auth_missing" || authFailureCode === "auth_invalid" || authFailureCode === "auth_expired") {
    return true;
  }

  return Boolean(
    classifyAuthFailure(authorizationStage?.errorMessage)
    || classifyAuthFailure(snapshot.job.errorMessage)
  );
}

function buildRestartPayload(payload: Record<string, unknown>): CliOptions {
  const restartedPayload: Record<string, unknown> = {
    ...payload,
    submitOnly: true,
    runtimeMode: "distributed",
  };

  delete restartedPayload.token;
  delete restartedPayload.browser;
  delete restartedPayload.ignoreCachedToken;
  delete restartedPayload.__authenticatedClient;
  delete restartedPayload.__abortSignal;
  delete restartedPayload.saveLocal;
  delete restartedPayload.json;

  return restartedPayload as CliOptions;
}

export function createJobCancellationAssertion(
  jobId: string,
  options: CliOptions = {},
): () => Promise<void> {
  return async () => {
    const repository = createControlPlaneRepository(options);
    try {
      await repository.initialize();
      const job = await repository.getJob(jobId);
      if (job?.status === "cancelled") {
        throw new CancellationError(job.errorMessage || "Job cancelled by operator request");
      }
    } finally {
      await repository.close();
    }
  };
}
