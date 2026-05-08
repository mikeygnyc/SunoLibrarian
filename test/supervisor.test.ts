import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import type { SupervisorConfig } from "../src/app-config";
import type {
  IRemoteSupervisorAdapter,
  RemoteSupervisorReconcileResult,
  RemoteSupervisorReconcileRequest,
  SupervisedRuntimeTopology,
} from "../src/core/contracts";
import { HttpApiClient } from "../src/http-api-client";
import {
  buildSupervisorChildEnv,
  buildRemoteSupervisorReconcileRequest,
  bootstrapSupervisorControlPlane,
  createFixedChildRuntimes,
  createLibrarianChildRuntimes,
  CONTROL_PLANE_BOOTSTRAPPED_ENV,
  resolveSupervisorTopology,
  runSupervisor,
} from "../src/supervisor/local-supervisor";
import { InMemoryRemoteSupervisorAdapter } from "../src/supervisor/remote-supervisor";

function createWorkspacePolicyFile(policy: { disabledWorkspaceIds?: string[] }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "suno-export-supervisor-policy-"));
  const filePath = path.join(dir, "workspace-policy.json");
  fs.writeFileSync(filePath, JSON.stringify(policy, null, 2));
  return filePath;
}

function createSupervisorServices(workspaces: Array<{ id: string; name: string }>) {
  const savedWorkspaceBatches: Array<Array<{ id: string; name: string }>> = [];

  return {
    savedWorkspaceBatches,
    services: {
      authService: {
        async getAuthenticatedClient() {
          return {
            async getWorkspaces() {
              return workspaces;
            },
          };
        },
      },
      metadataService: {
        async saveWorkspacesToDatabase(_options: unknown, discoveredWorkspaces: Array<{ id: string; name: string }>) {
          savedWorkspaceBatches.push(discoveredWorkspaces);
        },
      },
    } as any,
  };
}

async function getFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to determine free port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

test("supervisor topology keeps api available and creates one librarian per allowed workspace", async () => {
  const { services, savedWorkspaceBatches } = createSupervisorServices([
    { id: "ws-1", name: "Workspace 1" },
    { id: "ws-2", name: "Workspace 2" },
  ]);

  const topology = await resolveSupervisorTopology({
    apiHost: "127.0.0.1",
    apiPort: "3010",
    healthHost: "127.0.0.1",
    orchestratorHealthPort: "3110",
    workerRoles: ["auth", "processing"],
  }, services);

  assert.equal(topology.api.label, "api");
  assert.equal(topology.api.healthUrl, "http://127.0.0.1:3010/healthz");
  assert.equal(topology.orchestrator.healthUrl, "http://127.0.0.1:3110/healthz");
  assert.deepEqual(topology.workers.map((worker) => worker.role), ["auth", "processing"]);
  assert.deepEqual(topology.librarians.map((librarian) => librarian.workspaceId), ["ws-1", "ws-2"]);
  assert.equal(savedWorkspaceBatches.length, 1);
  assert.deepEqual(savedWorkspaceBatches[0].map((workspace) => workspace.id), ["ws-1", "ws-2"]);
});

test("supervisor topology excludes disabled and initially excluded workspaces", async () => {
  const policyFile = createWorkspacePolicyFile({
    disabledWorkspaceIds: ["ws-2"],
  });
  const { services } = createSupervisorServices([
    { id: "ws-1", name: "Workspace 1" },
    { id: "ws-2", name: "Workspace 2" },
    { id: "ws-3", name: "Workspace 3" },
  ]);

  const topology = await resolveSupervisorTopology({
    excludedWorkspaces: ["ws-3"],
    workspacePolicyFile: policyFile,
  }, services);

  assert.deepEqual(topology.workspacePolicy.disabledWorkspaceIds, ["ws-2"]);
  assert.deepEqual(topology.workspacePolicy.excludedWorkspaceIds, ["ws-3"]);
  assert.deepEqual(topology.librarians.map((librarian) => librarian.workspaceId), ["ws-1"]);
});

test("supervisor librarian children are pinned to exactly one workspace", async () => {
  const topology: SupervisedRuntimeTopology = {
    mode: "local",
    api: {
      label: "api",
      service: "api",
      role: "api",
      required: true,
      healthUrl: "http://127.0.0.1:3000/healthz",
    },
    orchestrator: {
      label: "orchestrator",
      service: "orchestrator",
      role: "orchestrator",
      required: true,
      healthUrl: "http://127.0.0.1:3101/healthz",
    },
    workers: [],
    librarians: [
      {
        label: "librarian:ws-1",
        service: "librarian",
        role: "librarian",
        required: true,
        healthUrl: "http://127.0.0.1:3300/healthz",
        workspaceId: "ws-1",
      },
      {
        label: "librarian:ws-2",
        service: "librarian",
        role: "librarian",
        required: true,
        healthUrl: "http://127.0.0.1:3301/healthz",
        workspaceId: "ws-2",
      },
    ],
    workspacePolicy: {
      excludedWorkspaceIds: [],
      disabledWorkspaceIds: [],
    },
  };

  const children = createLibrarianChildRuntimes({
    browser: "http://localhost:9222",
    databaseType: "sqlite",
  } satisfies SupervisorConfig, topology);

  assert.equal(children.length, 2);
  assert.ok(children.every((child) => child.args.includes("--workspace")));
  assert.deepEqual(
    children.map((child) => {
      const workspaceIndex = child.args.indexOf("--workspace");
      return child.args[workspaceIndex + 1];
    }),
    ["ws-1", "ws-2"],
  );
});

test("supervisor fixed child runtimes always include api and orchestrator children", () => {
  const topology: SupervisedRuntimeTopology = {
    mode: "local",
    api: {
      label: "api",
      service: "api",
      role: "api",
      required: true,
      healthUrl: "http://127.0.0.1:3000/healthz",
    },
    orchestrator: {
      label: "orchestrator",
      service: "orchestrator",
      role: "orchestrator",
      required: true,
      healthUrl: "http://127.0.0.1:3101/healthz",
    },
    workers: [
      {
        label: "worker:auth",
        service: "worker",
        role: "auth",
        required: true,
        healthUrl: "http://127.0.0.1:3200/healthz",
      },
    ],
    librarians: [],
    workspacePolicy: {
      excludedWorkspaceIds: [],
      disabledWorkspaceIds: [],
    },
  };

  const children = createFixedChildRuntimes({
    controlPlane: "local",
  }, topology);

  assert.deepEqual(children.map((child) => child.label), ["api", "orchestrator", "worker:auth"]);
  assert.equal(children[0]?.app, "api");
  assert.equal(children[1]?.app, "orchestrator");
});

test("supervisor child env marks control plane bootstrap when preflight already ran", () => {
  const baseEnv = { PATH: process.env.PATH };
  const childEnv = buildSupervisorChildEnv(baseEnv, true);

  assert.equal(childEnv[CONTROL_PLANE_BOOTSTRAPPED_ENV], "1");
  assert.equal(childEnv.PATH, process.env.PATH);
});

test("supervisor child runtimes inherit bootstrap env for postgres-backed startup", () => {
  const topology: SupervisedRuntimeTopology = {
    mode: "local",
    api: {
      label: "api",
      service: "api",
      role: "api",
      required: true,
      healthUrl: "http://127.0.0.1:3000/healthz",
    },
    orchestrator: {
      label: "orchestrator",
      service: "orchestrator",
      role: "orchestrator",
      required: true,
      healthUrl: "http://127.0.0.1:3101/healthz",
    },
    workers: [],
    librarians: [
      {
        label: "librarian:ws-1",
        service: "librarian",
        role: "librarian",
        required: true,
        healthUrl: "http://127.0.0.1:3300/healthz",
        workspaceId: "ws-1",
      },
    ],
    workspacePolicy: {
      excludedWorkspaceIds: [],
      disabledWorkspaceIds: [],
    },
  };

  const fixedChildren = createFixedChildRuntimes({ controlPlane: "postgres" }, topology, true);
  const librarianChildren = createLibrarianChildRuntimes({ controlPlane: "postgres" }, topology, true);

  assert.equal(fixedChildren[0]?.env?.[CONTROL_PLANE_BOOTSTRAPPED_ENV], "1");
  assert.equal(fixedChildren[1]?.env?.[CONTROL_PLANE_BOOTSTRAPPED_ENV], "1");
  assert.equal(librarianChildren[0]?.env?.[CONTROL_PLANE_BOOTSTRAPPED_ENV], "1");
});

test("supervisor control plane bootstrap preflight is only needed for postgres mode", async () => {
  await assert.doesNotReject(async () => {
    const bootstrapped = await bootstrapSupervisorControlPlane({ controlPlane: "local" });
    assert.equal(bootstrapped, false);
  });
});

test("remote supervisor reconcile request expands topology into explicit child desired state", () => {
  const topology: SupervisedRuntimeTopology = {
    mode: "remote",
    api: {
      label: "api",
      service: "api",
      role: "api",
      required: true,
      healthUrl: "http://127.0.0.1:3000/healthz",
    },
    orchestrator: {
      label: "orchestrator",
      service: "orchestrator",
      role: "orchestrator",
      required: true,
      healthUrl: "http://127.0.0.1:3101/healthz",
    },
    workers: [
      {
        label: "worker:auth",
        service: "worker",
        role: "auth",
        required: true,
        healthUrl: "http://127.0.0.1:3200/healthz",
      },
    ],
    librarians: [
      {
        label: "librarian:ws-1",
        service: "librarian",
        role: "librarian",
        required: true,
        healthUrl: "http://127.0.0.1:3300/healthz",
        workspaceId: "ws-1",
      },
    ],
    workspacePolicy: {
      excludedWorkspaceIds: [],
      disabledWorkspaceIds: [],
    },
  };

  const request = buildRemoteSupervisorReconcileRequest(topology);

  assert.equal(request.api.desiredState, "present");
  assert.equal(request.orchestrator.desiredState, "present");
  assert.deepEqual(request.workers.map((child) => child.desiredState), ["present"]);
  assert.deepEqual(request.librarians.map((child) => child.workspaceId), ["ws-1"]);
});

test("supervisor remote mode delegates explicit child lifecycle targets through the remote adapter boundary", async () => {
  const { services } = createSupervisorServices([
    { id: "ws-1", name: "Workspace 1" },
  ]);
  const reconcileRequests: RemoteSupervisorReconcileRequest[] = [];
  const shutdownReasons: string[] = [];
  const bootstrapCalls: SupervisorConfig[] = [];
  const remoteAdapter: IRemoteSupervisorAdapter = {
    async reconcile(request) {
      reconcileRequests.push(request);
      return {
        ready: true,
        children: [
          {
            label: request.api.label,
            service: request.api.service,
            role: request.api.role,
            desiredState: request.api.desiredState,
            action: "unchanged",
            status: "ready",
            healthUrl: request.api.healthUrl,
          },
          {
            label: request.orchestrator.label,
            service: request.orchestrator.service,
            role: request.orchestrator.role,
            desiredState: request.orchestrator.desiredState,
            action: "updated",
            status: "ready",
            healthUrl: request.orchestrator.healthUrl,
          },
          ...request.workers.map((worker) => ({
            label: worker.label,
            service: worker.service,
            role: worker.role,
            desiredState: worker.desiredState,
            action: "created" as const,
            status: "ready" as const,
            healthUrl: worker.healthUrl,
          })),
          ...request.librarians.map((librarian) => ({
            label: librarian.label,
            service: librarian.service,
            role: librarian.role,
            desiredState: librarian.desiredState,
            action: "created" as const,
            status: "ready" as const,
            healthUrl: librarian.healthUrl,
            workspaceId: librarian.workspaceId,
          })),
        ],
      };
    },
    async shutdown(reason) {
      shutdownReasons.push(reason);
    },
  };

  await runSupervisor({
    mode: "remote",
    workerRoles: ["auth", "processing"],
    excludedWorkspaces: ["ws-2"],
  }, {
      services,
      remoteAdapter,
      bootstrapControlPlane: async (config) => {
        bootstrapCalls.push(config);
        return false;
      },
      exitAfterTopologyHealthy: true,
      mutateProcessExitCode: false,
  });

  assert.equal(reconcileRequests.length, 1);
  assert.equal(reconcileRequests[0]?.topology.mode, "remote");
  assert.equal(reconcileRequests[0]?.api.label, "api");
  assert.equal(reconcileRequests[0]?.api.desiredState, "present");
  assert.equal(reconcileRequests[0]?.orchestrator.desiredState, "present");
  assert.deepEqual(reconcileRequests[0]?.workers.map((worker) => worker.role), ["auth", "processing"]);
  assert.deepEqual(reconcileRequests[0]?.workers.map((worker) => worker.desiredState), ["present", "present"]);
  assert.deepEqual(reconcileRequests[0]?.librarians.map((librarian) => librarian.workspaceId), ["ws-1"]);
  assert.deepEqual(shutdownReasons, ["topology healthy", "supervisor exiting"]);
  assert.equal(bootstrapCalls.length, 1);
  assert.equal(bootstrapCalls[0]?.mode, "remote");
});

test("remote supervisor status reports include lifecycle actions for each child", async () => {
  const { services } = createSupervisorServices([
    { id: "ws-1", name: "Workspace 1" },
  ]);
  const seenActions: string[] = [];
  const remoteAdapter: IRemoteSupervisorAdapter = {
    async reconcile(request) {
      const result: RemoteSupervisorReconcileResult = {
        ready: true,
        children: [
          {
            label: request.api.label,
            service: request.api.service,
            role: request.api.role,
            desiredState: request.api.desiredState,
            action: "unchanged",
            status: "ready",
            healthUrl: request.api.healthUrl,
          },
          {
            label: request.orchestrator.label,
            service: request.orchestrator.service,
            role: request.orchestrator.role,
            desiredState: request.orchestrator.desiredState,
            action: "updated",
            status: "ready",
            healthUrl: request.orchestrator.healthUrl,
          },
          ...request.workers.map((worker) => ({
            label: worker.label,
            service: worker.service,
            role: worker.role,
            desiredState: worker.desiredState,
            action: "created" as const,
            status: "ready" as const,
            healthUrl: worker.healthUrl,
          })),
          {
            label: "librarian:old-workspace",
            service: "librarian" as const,
            role: "librarian" as const,
            desiredState: "absent" as const,
            action: "removed" as const,
            status: "absent" as const,
            workspaceId: "old-workspace",
            message: "workspace no longer allowed",
          },
        ],
      };
      seenActions.push(...result.children.map((child) => child.action));
      return result;
    },
    async shutdown() {},
  };

  await runSupervisor({
    mode: "remote",
    workerRoles: ["auth"],
  }, {
    services,
    remoteAdapter,
    exitAfterTopologyHealthy: true,
    mutateProcessExitCode: false,
  });

  assert.ok(seenActions.includes("unchanged"));
  assert.ok(seenActions.includes("updated"));
  assert.ok(seenActions.includes("created"));
  assert.ok(seenActions.includes("removed"));
});

test("in-memory remote supervisor adapter supports lifecycle reconciliation for api, orchestrator, worker, and librarian children", async () => {
  const adapter = new InMemoryRemoteSupervisorAdapter();
  const firstTopology: SupervisedRuntimeTopology = {
    mode: "remote",
    api: {
      label: "api",
      service: "api",
      role: "api",
      required: true,
      healthUrl: "http://127.0.0.1:3000/healthz",
    },
    orchestrator: {
      label: "orchestrator",
      service: "orchestrator",
      role: "orchestrator",
      required: true,
      healthUrl: "http://127.0.0.1:3101/healthz",
    },
    workers: [
      {
        label: "worker:auth",
        service: "worker",
        role: "auth",
        required: true,
        healthUrl: "http://127.0.0.1:3200/healthz",
      },
    ],
    librarians: [
      {
        label: "librarian:ws-1",
        service: "librarian",
        role: "librarian",
        required: true,
        healthUrl: "http://127.0.0.1:3300/healthz",
        workspaceId: "ws-1",
      },
    ],
    workspacePolicy: {
      excludedWorkspaceIds: [],
      disabledWorkspaceIds: [],
    },
  };

  const firstResult = await adapter.reconcile(buildRemoteSupervisorReconcileRequest(firstTopology));
  assert.ok(firstResult.children.some((child) => child.label === "api" && child.action === "created"));
  assert.ok(firstResult.children.some((child) => child.label === "orchestrator" && child.action === "created"));
  assert.ok(firstResult.children.some((child) => child.label === "worker:auth" && child.action === "created"));
  assert.ok(firstResult.children.some((child) => child.label === "librarian:ws-1" && child.action === "created"));

  const secondTopology: SupervisedRuntimeTopology = {
    ...firstTopology,
    orchestrator: {
      ...firstTopology.orchestrator,
      healthUrl: "http://127.0.0.1:4101/healthz",
    },
    workers: [
      ...firstTopology.workers,
      {
        label: "worker:processing",
        service: "worker",
        role: "processing",
        required: true,
        healthUrl: "http://127.0.0.1:3201/healthz",
      },
    ],
    librarians: [],
  };

  const secondResult = await adapter.reconcile(buildRemoteSupervisorReconcileRequest(secondTopology));
  assert.ok(secondResult.children.some((child) => child.label === "api" && child.action === "unchanged"));
  assert.ok(secondResult.children.some((child) => child.label === "orchestrator" && child.action === "updated"));
  assert.ok(secondResult.children.some((child) => child.label === "worker:processing" && child.action === "created"));
  assert.ok(secondResult.children.some((child) => child.label === "librarian:ws-1" && child.action === "removed"));
});

test("supervisor remote mode uses the default unimplemented adapter when no remote backend is configured", async () => {
  const { services } = createSupervisorServices([]);

  await assert.rejects(
    runSupervisor({
      mode: "remote",
      workerRoles: ["auth"],
    }, {
      services,
      mutateProcessExitCode: false,
    }),
    /Supervisor remote mode is not implemented yet/,
  );
});

test("supervisor keeps api available while the local child topology is supervised", async () => {
  const apiPort = await getFreePort();
  const orchestratorHealthPort = await getFreePort();
  const workerHealthPortBase = await getFreePort();
  const controlPlaneDir = fs.mkdtempSync(path.join(os.tmpdir(), "suno-export-supervisor-control-plane-"));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "suno-export-supervisor-cache-"));
  const { services } = createSupervisorServices([]);

  let healthResponseOk = false;
  let jobsResponseOk = false;

  await runSupervisor({
    controlPlane: "local",
    controlPlaneDir,
    cacheDir,
    apiHost: "127.0.0.1",
    apiPort: String(apiPort),
    healthHost: "127.0.0.1",
    orchestratorHealthPort: String(orchestratorHealthPort),
    workerRoles: ["auth"],
    workerHealthPortBase: String(workerHealthPortBase),
    workspaceRefreshIntervalMs: "60000",
    startupTimeoutMs: "15000",
  }, {
    services,
    exitAfterTopologyHealthy: true,
    mutateProcessExitCode: false,
    async onTopologyHealthy(topology) {
      const client = new HttpApiClient({
        baseUrl: topology.api.healthUrl.replace(/\/healthz$/, ""),
      });
      const health = await client.getHealth();
      const jobs = await client.listJobs(5);
      healthResponseOk = health.ok === true && health.service === "api" && health.status === "ready";
      jobsResponseOk = Array.isArray(jobs.jobs);
    },
  });

  assert.equal(healthResponseOk, true);
  assert.equal(jobsResponseOk, true);
});
