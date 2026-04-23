import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { LocalControlPlaneRepository, LocalJobOrchestrator } from "../src/orchestration";

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
