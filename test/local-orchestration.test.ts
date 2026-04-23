import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { runOrchestratorFlow, runProcessFlow } from "../src/cli-actions";
import { LocalControlPlaneRepository, LocalJobOrchestrator } from "../src/orchestration";
import { DEFAULT_RUNTIME_CONFIG } from "../src/orchestration/runtime-defaults";

function createTempControlPlaneDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "suno-export-orchestration-"));
}

test("local control plane repository persists jobs, stages, and logs", async () => {
  const dir = createTempControlPlaneDir();
  const repository = new LocalControlPlaneRepository(dir);
  await repository.initialize();

  const now = new Date("2026-04-23T12:00:00.000Z");
  await repository.createJob({
    id: "job-1",
    workflowType: "process",
    status: "queued",
    runtimeMode: "local",
    payload: { input: "/tmp/in", output: "/tmp/out" },
    createdAt: now,
    updatedAt: now,
  });
  await repository.createStage({
    id: "stage-1",
    jobId: "job-1",
    stageType: "conversion",
    status: "pending",
    sequence: 1,
    createdAt: now,
    updatedAt: now,
  });
  await repository.write({
    timestamp: now,
    level: "info",
    message: "conversion queued",
    context: {
      jobId: "job-1",
      role: "conversion",
    },
  });

  const jobs = await repository.listJobs();
  const stages = await repository.listStages("job-1");
  const logs = await repository.query({ jobId: "job-1" });

  assert.equal(jobs.length, 1);
  assert.equal(stages.length, 1);
  assert.equal(logs.entries.length, 1);
  assert.ok(fs.existsSync(path.join(dir, "state.json")));
  assert.ok(fs.existsSync(path.join(dir, "logs.json")));
});

test("local job orchestrator records stage and job completion", async () => {
  const dir = createTempControlPlaneDir();
  const repository = new LocalControlPlaneRepository(dir);
  const orchestrator = new LocalJobOrchestrator(repository);
  let createdJobId = "";

  const { jobId, result } = await orchestrator.runWorkflow(
    {
      workflowType: "fetch-metadata",
      payload: { ids: "clip-1" },
      stagePlan: [
        { type: "authorization", workerRole: "auth" },
        { type: "metadata-acquisition", workerRole: "metadata" },
        { type: "finalization", workerRole: "orchestrator" },
      ],
      onJobCreated: (created) => {
        createdJobId = created;
      },
    },
    async ({ runStage }) => {
      await runStage("authorization", async () => "token");
      await runStage("metadata-acquisition", async () => undefined);
      await runStage("finalization", async () => undefined);
      return "done";
    },
  );

  const snapshot = await orchestrator.getJobSnapshot(jobId);

  assert.equal(jobId, createdJobId);
  assert.equal(result, "done");
  assert.equal(snapshot.job?.status, "completed");
  assert.deepEqual(snapshot.stages.map((stage) => stage.status), [
    "succeeded",
    "succeeded",
    "succeeded",
  ]);
  assert.ok(snapshot.statusEvents.length >= 4);
});

test("metadata acquisition waits while asset acquisition lease is active", async () => {
  const dir = createTempControlPlaneDir();
  const repo1 = new LocalControlPlaneRepository(dir);
  const repo2 = new LocalControlPlaneRepository(dir);
  const orchestrator1 = new LocalJobOrchestrator(repo1, {
    ...DEFAULT_RUNTIME_CONFIG,
    concurrency: {
      ...DEFAULT_RUNTIME_CONFIG.concurrency,
      metadataAcquisitionMaxActive: 1,
      assetAcquisitionMaxActive: 1,
    },
  });
  const orchestrator2 = new LocalJobOrchestrator(repo2, {
    ...DEFAULT_RUNTIME_CONFIG,
    concurrency: {
      ...DEFAULT_RUNTIME_CONFIG.concurrency,
      metadataAcquisitionMaxActive: 1,
      assetAcquisitionMaxActive: 1,
    },
  });

  let releaseAssetStage!: () => void;
  const assetStageStarted = new Promise<void>((resolve) => {
    releaseAssetStage = resolve;
  });

  const assetRun = orchestrator1.runWorkflow(
    {
      workflowType: "download",
      payload: { output: "/tmp/out" },
      stagePlan: [{ type: "asset-acquisition", workerRole: "asset" }],
    },
    async ({ runStage }) => {
      await runStage("asset-acquisition", async () => assetStageStarted);
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 150));

  const metadataRun = orchestrator2.runWorkflow(
    {
      workflowType: "fetch-metadata",
      payload: { ids: "clip-1" },
      stagePlan: [{ type: "metadata-acquisition", workerRole: "metadata" }],
    },
    async ({ runStage }) => {
      await runStage("metadata-acquisition", async () => undefined);
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 300));
  const metadataJobId = (await repo2.listJobs(1))[0]?.id;
  assert.ok(metadataJobId);
  const blockedSnapshot = await orchestrator2.getJobSnapshot(metadataJobId!);
  assert.equal(blockedSnapshot.stages[0]?.status, "blocked");

  releaseAssetStage();
  await assetRun;
  const metadataResult = await metadataRun;
  const finalSnapshot = await orchestrator2.getJobSnapshot(metadataResult.jobId);
  assert.equal(finalSnapshot.stages[0]?.status, "succeeded");
});

test("conversion stage capacity respects configured max active leases", async () => {
  const dir = createTempControlPlaneDir();
  const runtimeConfig = {
    ...DEFAULT_RUNTIME_CONFIG,
    concurrency: {
      ...DEFAULT_RUNTIME_CONFIG.concurrency,
      conversionConcurrency: 1,
    },
  };

  const orchestrator1 = new LocalJobOrchestrator(new LocalControlPlaneRepository(dir), runtimeConfig);
  const orchestrator2 = new LocalJobOrchestrator(new LocalControlPlaneRepository(dir), runtimeConfig);

  let releaseConversionStage!: () => void;
  const conversionGate = new Promise<void>((resolve) => {
    releaseConversionStage = resolve;
  });

  const firstRun = orchestrator1.runWorkflow(
    {
      workflowType: "process",
      payload: { output: "/tmp/out" },
      stagePlan: [{ type: "conversion", workerRole: "conversion" }],
    },
    async ({ runStage }) => {
      await runStage("conversion", async () => conversionGate);
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 150));

  const secondRun = orchestrator2.runWorkflow(
    {
      workflowType: "process",
      payload: { output: "/tmp/out2" },
      stagePlan: [{ type: "conversion", workerRole: "conversion" }],
    },
    async ({ runStage }) => {
      await runStage("conversion", async () => undefined);
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 300));
  const secondJobId = (await new LocalControlPlaneRepository(dir).listJobs(2))
    .find((job) => job.payload.output === "/tmp/out2")?.id;
  assert.ok(secondJobId);
  const blockedSnapshot = await orchestrator2.getJobSnapshot(secondJobId!);
  assert.equal(blockedSnapshot.stages[0]?.status, "blocked");

  releaseConversionStage();
  await firstRun;
  const secondResult = await secondRun;
  const finalSnapshot = await orchestrator2.getJobSnapshot(secondResult.jobId);
  assert.equal(finalSnapshot.stages[0]?.status, "succeeded");
});

test("submit-only workflow can be completed by orchestrator loop", async () => {
  const dir = createTempControlPlaneDir();
  const previousDir = process.env.SUNO_EXPORT_CONTROL_PLANE_DIR;
  process.env.SUNO_EXPORT_CONTROL_PLANE_DIR = dir;

  const inputDir = fs.mkdtempSync(path.join(os.tmpdir(), "suno-export-phase6-in-"));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "suno-export-phase6-out-"));
  const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "suno-export-phase6-db-")), "metadata.sqlite");

  try {
    await runProcessFlow({
      input: inputDir,
      output: outputDir,
      runtimeMode: "distributed",
      database: databasePath,
    });

    const repository = new LocalControlPlaneRepository(dir);
    const [queuedJob] = await repository.listJobs(1);
    assert.equal(queuedJob?.status, "queued");

    await runOrchestratorFlow({ once: true, pollInterval: "10" });
    await runOrchestratorFlow({ once: true, pollInterval: "10" });
    await runOrchestratorFlow({ once: true, pollInterval: "10" });

    const [completedJob] = await repository.listJobs(1);
    assert.equal(completedJob?.status, "completed");
  } finally {
    if (previousDir == null) {
      delete process.env.SUNO_EXPORT_CONTROL_PLANE_DIR;
    } else {
      process.env.SUNO_EXPORT_CONTROL_PLANE_DIR = previousDir;
    }
  }
});
