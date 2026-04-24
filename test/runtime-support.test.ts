import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { cancelWorkflowJob, createControlPlaneRepository, getJobSnapshot, getWorkflowStagePlan, restartRecentlyFailedAuthJobs, serializeJobPayload, submitWorkflowJob } from "../src/orchestration";
import { runOrchestratorFlow } from "../src/cli-actions";

function createTempControlPlaneDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "suno-export-runtime-support-"));
}

test("submitWorkflowJob creates stages and snapshot through shared helpers", async () => {
  const dir = createTempControlPlaneDir();
  const previousDir = process.env.SUNO_EXPORT_CONTROL_PLANE_DIR;
  process.env.SUNO_EXPORT_CONTROL_PLANE_DIR = dir;

  try {
    const jobId = await submitWorkflowJob("sync", {
      controlPlane: "local",
      output: "/tmp/downloads",
      submitOnly: true,
    });

    const repository = createControlPlaneRepository({ controlPlane: "local" });
    try {
      await repository.initialize();
      const snapshot = await getJobSnapshot(repository, jobId);
      assert.equal(snapshot.job?.workflowType, "sync");
      assert.equal(snapshot.job?.status, "queued");
      assert.deepEqual(snapshot.stages.map((stage) => stage.stageType), [
        "authorization",
        "asset-acquisition",
        "processing",
        "conversion",
        "finalization",
      ]);
      assert.equal(snapshot.workItems.length, 5);
    } finally {
      await repository.close();
    }
  } finally {
    if (previousDir == null) {
      delete process.env.SUNO_EXPORT_CONTROL_PLANE_DIR;
    } else {
      process.env.SUNO_EXPORT_CONTROL_PLANE_DIR = previousDir;
    }
  }
});

test("serializeJobPayload strips functions and normalizes dates", () => {
  const payload = serializeJobPayload({
    output: "/tmp/out",
    createdAt: new Date("2026-04-23T00:00:00.000Z"),
    callback: () => undefined,
  });

  assert.equal(payload.output, "/tmp/out");
  assert.equal(payload.createdAt, "2026-04-23T00:00:00.000Z");
  assert.equal("callback" in payload, false);
});

test("getWorkflowStagePlan returns expected stage order for process", () => {
  assert.deepEqual(getWorkflowStagePlan("process").map((item) => item.type), [
    "processing",
    "conversion",
    "finalization",
  ]);
});

test("cancelWorkflowJob marks unfinished job state as cancelled", async () => {
  const dir = createTempControlPlaneDir();
  const previousDir = process.env.SUNO_EXPORT_CONTROL_PLANE_DIR;
  process.env.SUNO_EXPORT_CONTROL_PLANE_DIR = dir;

  try {
    const jobId = await submitWorkflowJob("process", {
      controlPlane: "local",
      input: "/tmp/in",
      output: "/tmp/out",
      submitOnly: true,
    });

    const snapshot = await cancelWorkflowJob(jobId, { controlPlane: "local" }, "operator request");
    assert.equal(snapshot?.job?.status, "cancelled");
    assert.equal(snapshot?.job?.errorCode, "job_cancelled");
    assert.equal(snapshot?.job?.errorMessage, "operator request");
    assert.ok(snapshot?.stages.every((stage) => stage.status === "cancelled"));
    assert.ok(snapshot?.workItems.every((workItem) => workItem.status === "cancelled"));
  } finally {
    if (previousDir == null) {
      delete process.env.SUNO_EXPORT_CONTROL_PLANE_DIR;
    } else {
      process.env.SUNO_EXPORT_CONTROL_PLANE_DIR = previousDir;
    }
  }
});

test("orchestrator loop does not execute cancelled queued jobs", async () => {
  const dir = createTempControlPlaneDir();
  const previousDir = process.env.SUNO_EXPORT_CONTROL_PLANE_DIR;
  process.env.SUNO_EXPORT_CONTROL_PLANE_DIR = dir;

  try {
    const jobId = await submitWorkflowJob("process", {
      controlPlane: "local",
      input: "/tmp/in",
      output: "/tmp/out",
      submitOnly: true,
    });
    await cancelWorkflowJob(jobId, { controlPlane: "local" });
    await runOrchestratorFlow({ controlPlane: "local", once: true, pollInterval: "10" });

    const repository = createControlPlaneRepository({ controlPlane: "local" });
    try {
      await repository.initialize();
      const snapshot = await getJobSnapshot(repository, jobId);
      assert.equal(snapshot.job?.status, "cancelled");
      assert.ok(snapshot.stages.every((stage) => stage.status === "cancelled"));
      assert.ok(snapshot.workItems.every((workItem) => workItem.status === "cancelled"));
    } finally {
      await repository.close();
    }
  } finally {
    if (previousDir == null) {
      delete process.env.SUNO_EXPORT_CONTROL_PLANE_DIR;
    } else {
      process.env.SUNO_EXPORT_CONTROL_PLANE_DIR = previousDir;
    }
  }
});

test("restartRecentlyFailedAuthJobs requeues recent auth-related failures once", async () => {
  const dir = createTempControlPlaneDir();
  const previousDir = process.env.SUNO_EXPORT_CONTROL_PLANE_DIR;
  process.env.SUNO_EXPORT_CONTROL_PLANE_DIR = dir;

  try {
    const failedJobId = await submitWorkflowJob("download", {
      controlPlane: "local",
      output: "/tmp/downloads",
      submitOnly: true,
    });

    const repository = createControlPlaneRepository({ controlPlane: "local" });
    try {
      await repository.initialize();
      const snapshot = await getJobSnapshot(repository, failedJobId);
      const authorizationStage = snapshot.stages.find((stage) => stage.stageType === "authorization");
      const authorizationWorkItem = snapshot.workItems.find((workItem) => workItem.stageType === "authorization");
      assert.ok(authorizationStage);
      assert.ok(authorizationWorkItem);

      const failedAt = new Date();
      await repository.updateStageStatus(authorizationStage.id, "failed", {
        completedAt: failedAt,
        errorCode: "auth_missing",
        errorMessage: "Authentication required: provide either --token or --browser",
      });
      await repository.updateWorkItemStatus(authorizationWorkItem.id, "failed", {
        completedAt: failedAt,
        errorCode: "auth_missing",
        errorMessage: "Authentication required: provide either --token or --browser",
      });
      await repository.updateJobStatus(failedJobId, "failed", {
        completedAt: failedAt,
        errorCode: "auth_missing",
        errorMessage: "Authentication required: provide either --token or --browser",
      });
    } finally {
      await repository.close();
    }

    const firstRestart = await restartRecentlyFailedAuthJobs({ controlPlane: "local" });
    assert.equal(firstRestart.originalJobIds.length, 1);
    assert.equal(firstRestart.originalJobIds[0], failedJobId);
    assert.equal(firstRestart.restartedJobIds.length, 1);
    assert.notEqual(firstRestart.restartedJobIds[0], failedJobId);

    const secondRestart = await restartRecentlyFailedAuthJobs({ controlPlane: "local" });
    assert.deepEqual(secondRestart.restartedJobIds, []);

    const validationRepository = createControlPlaneRepository({ controlPlane: "local" });
    try {
      await validationRepository.initialize();
      const jobs = await validationRepository.listJobs(10);
      assert.equal(jobs.length, 2);
      const originalSnapshot = await getJobSnapshot(validationRepository, failedJobId);
      assert.ok(originalSnapshot.statusEvents.some((event) => event.eventType === "job-restarted-after-auth"));
      const restartedSnapshot = await getJobSnapshot(validationRepository, firstRestart.restartedJobIds[0]);
      assert.equal(restartedSnapshot.job?.status, "queued");
    } finally {
      await validationRepository.close();
    }
  } finally {
    if (previousDir == null) {
      delete process.env.SUNO_EXPORT_CONTROL_PLANE_DIR;
    } else {
      process.env.SUNO_EXPORT_CONTROL_PLANE_DIR = previousDir;
    }
  }
});
