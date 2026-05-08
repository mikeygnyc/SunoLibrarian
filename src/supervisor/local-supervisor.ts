import * as fs from "fs";
import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import fetch from "node-fetch";
import type { RequestInit } from "node-fetch";
import type { SupervisorConfig } from "../app-config";
import type {
  IRemoteSupervisorAdapter,
  IRuntimeHealthResponse,
  RemoteSupervisorReconcileRequest,
  SupervisedChildSpec,
  SupervisedRuntimeTopology,
  SupervisorWorkerRole,
  SupervisorWorkerSpec,
} from "../core/contracts";
import { createControlPlaneRepository, resolveControlPlaneBackend } from "../core/orchestration";
import { AuthService } from "../services/auth-service";
import { MetadataAcquisitionService } from "../services/metadata-acquisition-service";
import { UnimplementedRemoteSupervisorAdapter } from "./remote-supervisor";
import { createHealthUrl } from "./runtime-health";

type SupervisedChildRuntime = SupervisedChildSpec & {
  app: "api" | "orchestrator" | "worker" | "librarian";
  args: string[];
  env?: NodeJS.ProcessEnv;
  child?: ChildProcess;
  expectedExit?: boolean;
  managed: boolean;
  restartTimestamps: number[];
};

type SupervisorServices = {
  authService: AuthService;
  metadataService: MetadataAcquisitionService;
};

export interface RunSupervisorTestDeps {
  services?: SupervisorServices;
  remoteAdapter?: IRemoteSupervisorAdapter;
  bootstrapControlPlane?: (options: SupervisorConfig) => Promise<boolean>;
  onTopologyHealthy?: (topology: SupervisedRuntimeTopology) => Promise<void> | void;
  exitAfterTopologyHealthy?: boolean;
  mutateProcessExitCode?: boolean;
}

type WorkspaceRuntimePolicy = {
  disabledWorkspaceIds: string[];
};

type FetchResponseLike = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponseLike>;

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = 3000;
const DEFAULT_HEALTH_HOST = "127.0.0.1";
const DEFAULT_ORCHESTRATOR_HEALTH_PORT = 3101;
const DEFAULT_WORKER_HEALTH_PORT_BASE = 3200;
const DEFAULT_LIBRARIAN_HEALTH_PORT_BASE = 3300;
const DEFAULT_WORKSPACE_REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_RESTART_DELAY_MS = 1_000;
const DEFAULT_MAX_RESTARTS_PER_WINDOW = 3;
const DEFAULT_RESTART_WINDOW_MS = 60_000;
export const CONTROL_PLANE_BOOTSTRAPPED_ENV = "SUNO_EXPORT_CONTROL_PLANE_BOOTSTRAPPED";
const DEFAULT_WORKER_TOPOLOGY: SupervisorWorkerSpec[] = [
  { role: "auth", count: 1 },
  { role: "asset", count: 1 },
  { role: "processing", count: 1 },
  { role: "conversion", count: 1 },
];

export async function runSupervisor(
  options: SupervisorConfig = {},
  deps: RunSupervisorTestDeps = {},
): Promise<void> {
  const services: SupervisorServices = deps.services ?? {
    authService: new AuthService(),
    metadataService: new MetadataAcquisitionService(),
  };
  const remoteAdapter = deps.remoteAdapter ?? new UnimplementedRemoteSupervisorAdapter();
  const mutateProcessExitCode = deps.mutateProcessExitCode ?? true;
  const controlPlaneBootstrapped = await (deps.bootstrapControlPlane?.(options) ?? bootstrapSupervisorControlPlane(options));
  let topology = await resolveSupervisorTopology(options, services);
  const librarianChildren = new Map<string, SupervisedChildRuntime>();
  const allChildren = new Map<string, SupervisedChildRuntime>();
  const fixedChildren = createFixedChildRuntimes(options, topology, controlPlaneBootstrapped);
  for (const child of fixedChildren) {
    allChildren.set(child.label, child);
  }

  const startupTimeoutMs = parsePositiveInteger(
    options.startupTimeoutMs,
    DEFAULT_STARTUP_TIMEOUT_MS,
    "--startup-timeout-ms",
  );
  const refreshIntervalMs = parsePositiveInteger(
    options.workspaceRefreshIntervalMs,
    DEFAULT_WORKSPACE_REFRESH_INTERVAL_MS,
    "--workspace-refresh-interval-ms",
  );
  let shuttingDown = false;
  let fatalError: Error | undefined;
  let announcedRemoteHealthy = false;

  const shutdownAll = async (reason: string, exitCode?: number): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[supervisor] Shutting down child processes: ${reason}`);
    await Promise.all(Array.from(allChildren.values()).map(async (child) => stopChild(child)));
    if (typeof exitCode === "number" && mutateProcessExitCode) {
      process.exitCode = exitCode;
    }
  };

  const signalHandler = (signal: NodeJS.Signals) => {
    void shutdownAll(`received ${signal}`);
  };
  process.once("SIGINT", signalHandler);
  process.once("SIGTERM", signalHandler);

  try {
    if (topology.mode === "remote") {
      while (!shuttingDown) {
        const remoteResult = await remoteAdapter.reconcile(buildRemoteSupervisorReconcileRequest(topology));
        if (remoteResult.ready && !announcedRemoteHealthy) {
          console.log("[supervisor] Remote topology is healthy:");
          for (const child of remoteResult.children) {
            console.log(
              `[supervisor]   ${child.label}: ${child.action}/${child.status}${child.healthUrl ? ` (${child.healthUrl})` : ""}`,
            );
          }
          await deps.onTopologyHealthy?.(topology);
          announcedRemoteHealthy = true;
        }

        if (deps.exitAfterTopologyHealthy === true && remoteResult.ready) {
          await remoteAdapter.shutdown("topology healthy");
          return;
        }

        await delay(refreshIntervalMs);
        if (shuttingDown) {
          break;
        }

        topology = await resolveSupervisorTopology(options, services);
      }
      return;
    }

    for (const child of fixedChildren) {
      await startManagedChild(child, {
        allChildren,
        onUnexpectedExit: (error) => {
          fatalError = error;
        },
        shuttingDown: () => shuttingDown,
        startupTimeoutMs,
      });
    }

    const initialLibrarians = createLibrarianChildRuntimes(options, topology, controlPlaneBootstrapped);
    await reconcileLibrarianChildren(
      initialLibrarians,
      librarianChildren,
      {
        allChildren,
        onUnexpectedExit: (error) => {
          fatalError = error;
        },
        shuttingDown: () => shuttingDown,
        startupTimeoutMs,
      },
    );

    console.log("[supervisor] Topology is healthy:");
    console.log(`[supervisor]   api: ${topology.api.healthUrl}`);
    console.log(`[supervisor]   orchestrator: ${topology.orchestrator.healthUrl}`);
    for (const worker of topology.workers) {
      console.log(`[supervisor]   worker ${worker.role}: ${worker.healthUrl}`);
    }
    for (const librarian of initialLibrarians) {
      console.log(`[supervisor]   librarian ${librarian.workspaceId}: ${librarian.healthUrl}`);
    }

    await deps.onTopologyHealthy?.(topology);
    if (deps.exitAfterTopologyHealthy === true) {
      await shutdownAll("topology healthy");
    }

    while (!shuttingDown) {
      if (fatalError) {
        throw fatalError;
      }

      await delay(refreshIntervalMs);
      if (shuttingDown) {
        break;
      }

      const refreshedTopology = await resolveSupervisorTopology(options, services);
      const desiredLibrarians = createLibrarianChildRuntimes(options, refreshedTopology, controlPlaneBootstrapped);
      await reconcileLibrarianChildren(
        desiredLibrarians,
        librarianChildren,
        {
          allChildren,
          onUnexpectedExit: (error) => {
            fatalError = error;
          },
          shuttingDown: () => shuttingDown,
          startupTimeoutMs,
        },
      );
    }
  } catch (error) {
    if (topology.mode === "remote") {
      await remoteAdapter.shutdown(error instanceof Error ? error.message : String(error));
    }
    await shutdownAll(error instanceof Error ? error.message : String(error), 1);
    throw error;
  } finally {
    process.removeListener("SIGINT", signalHandler);
    process.removeListener("SIGTERM", signalHandler);
    if (topology.mode === "remote") {
      await remoteAdapter.shutdown("supervisor exiting");
    }
    await shutdownAll("supervisor exiting");
  }
}

export async function resolveSupervisorTopology(
  options: SupervisorConfig,
  services: SupervisorServices,
): Promise<SupervisedRuntimeTopology> {
  const mode = options.mode ?? "local";
  const apiHost = typeof options.apiHost === "string" && options.apiHost.trim().length > 0
    ? options.apiHost.trim()
    : DEFAULT_API_HOST;
  const apiPort = parsePositiveInteger(options.apiPort, DEFAULT_API_PORT, "--api-port");
  const healthHost = typeof options.healthHost === "string" && options.healthHost.trim().length > 0
    ? options.healthHost.trim()
    : DEFAULT_HEALTH_HOST;
  const orchestratorHealthPort = parsePositiveInteger(
    options.orchestratorHealthPort,
    DEFAULT_ORCHESTRATOR_HEALTH_PORT,
    "--orchestrator-health-port",
  );
  const workerHealthPortBase = parsePositiveInteger(
    options.workerHealthPortBase,
    DEFAULT_WORKER_HEALTH_PORT_BASE,
    "--worker-health-port-base",
  );
  const librarianHealthPortBase = parsePositiveInteger(
    options.librarianHealthPortBase,
    DEFAULT_LIBRARIAN_HEALTH_PORT_BASE,
    "--librarian-health-port-base",
  );
  const workerTopology = resolveWorkerTopology(options);
  const workspacePolicy = readWorkspaceRuntimePolicy(options.workspacePolicyFile);
  const discoveredWorkspaces = await discoverSupervisorWorkspaces(options, services);
  let nextWorkerPort = workerHealthPortBase;
  let nextLibrarianPort = librarianHealthPortBase;

  return {
    mode,
    api: {
      label: "api",
      service: "api",
      role: "api",
      required: true,
      healthUrl: createHealthUrl(apiHost, apiPort),
    },
    orchestrator: {
      label: "orchestrator",
      service: "orchestrator",
      role: "orchestrator",
      required: true,
      healthUrl: createHealthUrl(healthHost, orchestratorHealthPort),
    },
    workers: workerTopology.flatMap((spec) => {
      return Array.from({ length: spec.count }, (_value, index) => {
        const instanceNumber = index + 1;
        const healthPort = nextWorkerPort++;
        return {
          label: spec.count === 1 ? `worker:${spec.role}` : `worker:${spec.role}:${instanceNumber}`,
          service: "worker" as const,
          role: spec.role,
          required: true,
          healthUrl: createHealthUrl(healthHost, healthPort),
        };
      });
    }),
    librarians: discoveredWorkspaces
      .filter((workspace) => !isExcludedWorkspace(workspace.id, options.excludedWorkspaces))
      .filter((workspace) => !workspacePolicy.disabledWorkspaceIds.includes(workspace.id))
      .map((workspace) => ({
        label: `librarian:${workspace.id}`,
        service: "librarian" as const,
        role: "librarian" as const,
        required: true,
        healthUrl: createHealthUrl(healthHost, nextLibrarianPort++),
        workspaceId: workspace.id,
      })),
    workspacePolicy: {
      excludedWorkspaceIds: options.excludedWorkspaces ?? [],
      disabledWorkspaceIds: workspacePolicy.disabledWorkspaceIds,
    },
  };
}

function resolveWorkerTopology(options: SupervisorConfig): SupervisorWorkerSpec[] {
  if (Array.isArray(options.workerTopology)) {
    return options.workerTopology.filter((spec) => spec.count > 0);
  }

  if (Array.isArray(options.workerRoles) && options.workerRoles.length > 0) {
    return options.workerRoles.map((role) => ({ role, count: 1 }));
  }

  return DEFAULT_WORKER_TOPOLOGY;
}

export function createFixedChildRuntimes(
  options: SupervisorConfig,
  topology: SupervisedRuntimeTopology,
  controlPlaneBootstrapped: boolean = false,
): SupervisedChildRuntime[] {
  const childEnv = buildSupervisorChildEnv(process.env, controlPlaneBootstrapped);
  const apiUrl = new URL(topology.api.healthUrl);
  const orchestratorUrl = new URL(topology.orchestrator.healthUrl);
  const children: SupervisedChildRuntime[] = [
    {
      ...topology.api,
      app: "api",
      managed: true,
      restartTimestamps: [],
      env: childEnv,
      args: [
        "--host",
        apiUrl.hostname,
        "--port",
        apiUrl.port,
        ...buildControlPlaneArgs(options),
      ],
    },
    {
      ...topology.orchestrator,
      app: "orchestrator",
      managed: true,
      restartTimestamps: [],
      env: childEnv,
      args: [
        "--health-host",
        orchestratorUrl.hostname,
        "--health-port",
        orchestratorUrl.port,
        ...buildControlPlaneArgs(options),
      ],
    },
  ];

  for (const worker of topology.workers) {
    const workerUrl = new URL(worker.healthUrl);
    children.push({
      ...worker,
      app: "worker",
      managed: true,
      restartTimestamps: [],
      env: childEnv,
      args: [
        "--role",
        worker.role,
        "--health-host",
        workerUrl.hostname,
        "--health-port",
        workerUrl.port,
        ...buildControlPlaneArgs(options),
      ],
    });
  }

  return children;
}

export function buildRemoteSupervisorReconcileRequest(
  topology: SupervisedRuntimeTopology,
): RemoteSupervisorReconcileRequest {
  return {
    topology,
    api: {
      ...topology.api,
      desiredState: "present",
    },
    orchestrator: {
      ...topology.orchestrator,
      desiredState: "present",
    },
    workers: topology.workers.map((worker) => ({
      ...worker,
      desiredState: "present" as const,
    })),
    librarians: topology.librarians.map((librarian) => ({
      ...librarian,
      desiredState: "present" as const,
    })),
  };
}

export function createLibrarianChildRuntimes(
  options: SupervisorConfig,
  topology: SupervisedRuntimeTopology,
  controlPlaneBootstrapped: boolean = false,
): SupervisedChildRuntime[] {
  const childEnv = buildSupervisorChildEnv(process.env, controlPlaneBootstrapped);
  return topology.librarians.map((librarian) => {
    const librarianUrl = new URL(librarian.healthUrl);
    return {
      ...librarian,
      app: "librarian",
      managed: true,
      restartTimestamps: [],
      env: childEnv,
      args: [
        "--workspace",
        librarian.workspaceId ?? "",
        "--health-host",
        librarianUrl.hostname,
        "--health-port",
        librarianUrl.port,
        ...buildAuthArgs(options),
        ...buildMetadataArgs(options),
      ],
    };
  });
}

function buildControlPlaneArgs(options: SupervisorConfig): string[] {
  const args = ["--control-plane", options.controlPlane ?? "local"];
  if (typeof options.controlPlaneDir === "string" && options.controlPlaneDir.trim().length > 0) {
    args.push("--control-plane-dir", options.controlPlaneDir.trim());
  }
  if (typeof options.postgresUrl === "string" && options.postgresUrl.trim().length > 0) {
    args.push("--postgres-url", options.postgresUrl.trim());
  }
  return args;
}

function buildAuthArgs(options: SupervisorConfig): string[] {
  const args: string[] = [];
  if (typeof options.token === "string" && options.token.trim().length > 0) {
    args.push("--token", options.token.trim());
  }
  if (options.browser === true) {
    args.push("--browser");
  } else if (typeof options.browser === "string" && options.browser.trim().length > 0) {
    args.push("--browser", options.browser.trim());
  }
  if (options.ignoreCachedToken === true) {
    args.push("--ignore-cached-token");
  }
  if (typeof options.browserProfile === "string" && options.browserProfile.trim().length > 0) {
    args.push("--browser-profile", options.browserProfile.trim());
  }
  if (typeof options.profileDirectory === "string" && options.profileDirectory.trim().length > 0) {
    args.push("--profile-directory", options.profileDirectory.trim());
  }
  return args;
}

function buildMetadataArgs(options: SupervisorConfig): string[] {
  const args: string[] = [];
  if (typeof options.databaseType === "string" && options.databaseType.trim().length > 0) {
    args.push("--database-type", options.databaseType.trim());
  }
  if (typeof options.database === "string" && options.database.trim().length > 0) {
    args.push("--database", options.database.trim());
  }
  if (typeof options.librarianInterval === "string" || typeof options.librarianInterval === "number") {
    args.push("--librarian-interval", String(options.librarianInterval));
  }
  return args;
}

function startChild(child: SupervisedChildRuntime, isShuttingDown: () => boolean): void {
  const { command, args } = resolveChildLaunch(child.app);
  child.expectedExit = false;
  const spawned = spawn(command, [...args, ...child.args], {
    cwd: projectRoot(),
    env: child.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.child = spawned;
  forwardChildOutput(child, spawned.stdout, "stdout");
  forwardChildOutput(child, spawned.stderr, "stderr");
  spawned.once("error", (error) => {
    if (!isShuttingDown()) {
      console.error(`[supervisor][${child.label}] failed to start: ${error.message}`);
    }
  });
}

async function startManagedChild(
  child: SupervisedChildRuntime,
  params: {
    allChildren: Map<string, SupervisedChildRuntime>;
    onUnexpectedExit: (error: Error) => void;
    shuttingDown: () => boolean;
    startupTimeoutMs: number;
  },
): Promise<void> {
  console.log(`[supervisor] Starting ${child.label}`);
  child.managed = true;
  child.expectedExit = false;
  startChild(child, params.shuttingDown);
  params.allChildren.set(child.label, child);
  child.child?.once("exit", (code, signal) => {
    child.child = undefined;
    if (params.shuttingDown() || child.expectedExit === true || child.managed === false) {
      return;
    }

    void restartChildAfterUnexpectedExit(child, code, signal, params);
  });
  await waitForChildReadiness(child, params.startupTimeoutMs);
  console.log(`[supervisor] ${child.label} is ready at ${child.healthUrl}`);
}

async function reconcileLibrarianChildren(
  desiredChildren: SupervisedChildRuntime[],
  activeChildren: Map<string, SupervisedChildRuntime>,
  params: {
    allChildren: Map<string, SupervisedChildRuntime>;
    onUnexpectedExit: (error: Error) => void;
    shuttingDown: () => boolean;
    startupTimeoutMs: number;
  },
): Promise<void> {
  const desiredLabels = new Set(desiredChildren.map((child) => child.label));

  for (const [label, child] of activeChildren.entries()) {
    if (desiredLabels.has(label)) {
      continue;
    }
    console.log(`[supervisor] Stopping ${label} due to updated workspace policy`);
    child.managed = false;
    await stopChild(child);
    activeChildren.delete(label);
    params.allChildren.delete(label);
  }

  for (const child of desiredChildren) {
    if (activeChildren.has(child.label)) {
      continue;
    }
    await startManagedChild(child, params);
    activeChildren.set(child.label, child);
  }
}

async function waitForChildReadiness(child: SupervisedChildRuntime, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    if (child.child?.exitCode != null) {
      throw new Error(`${child.label} exited before becoming ready`);
    }

    try {
      const response = await readHealth(child.healthUrl);
      if (response.ok && response.status === "ready") {
        return;
      }
      lastError = `${child.label} reported ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${child.label} readiness at ${child.healthUrl}${lastError ? `: ${lastError}` : ""}`);
}

async function stopChild(child: SupervisedChildRuntime): Promise<void> {
  if (!child.child || child.child.exitCode != null || child.child.killed) {
    return;
  }
  child.expectedExit = true;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.child?.kill("SIGKILL");
    }, 1_000);

    child.child?.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.child?.kill("SIGTERM");
  });
}

async function restartChildAfterUnexpectedExit(
  child: SupervisedChildRuntime,
  code: number | null,
  signal: NodeJS.Signals | null,
  params: {
    allChildren: Map<string, SupervisedChildRuntime>;
    onUnexpectedExit: (error: Error) => void;
    shuttingDown: () => boolean;
    startupTimeoutMs: number;
  },
): Promise<void> {
  const restartCount = registerRestartAttempt(child);
  if (restartCount == null) {
    params.onUnexpectedExit(
      new Error(
        `${child.label} exited unexpectedly with code ${code ?? "null"} and signal ${signal ?? "null"} `
        + `after exceeding ${DEFAULT_MAX_RESTARTS_PER_WINDOW} restarts in ${DEFAULT_RESTART_WINDOW_MS / 1000}s`,
      ),
    );
    return;
  }

  console.error(
    `[supervisor] ${child.label} exited unexpectedly with code ${code ?? "null"} `
    + `and signal ${signal ?? "null"}; restarting (${restartCount}/${DEFAULT_MAX_RESTARTS_PER_WINDOW})`,
  );

  await delay(DEFAULT_RESTART_DELAY_MS);
  if (params.shuttingDown() || child.managed === false) {
    return;
  }

  try {
    await startManagedChild(child, params);
  } catch (error) {
    params.onUnexpectedExit(error instanceof Error ? error : new Error(String(error)));
  }
}

async function readHealth(url: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<IRuntimeHealthResponse> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
  });
  const body = await response.json() as IRuntimeHealthResponse;
  return body;
}

function forwardChildOutput(
  child: SupervisedChildRuntime,
  stream: NodeJS.ReadableStream | null,
  channel: "stdout" | "stderr",
): void {
  if (!stream) {
    return;
  }

  let buffer = "";
  const readable = stream as NodeJS.ReadableStream & {
    setEncoding?(encoding: BufferEncoding): void;
    on(event: "data", listener: (chunk: string) => void): unknown;
    on(event: "end", listener: () => void): unknown;
  };
  readable.setEncoding?.("utf8");
  readable.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        const sink = channel === "stderr" ? console.error : console.log;
        sink(`[${child.label}] ${line}`);
      }
    }
  });
  readable.on("end", () => {
    if (buffer.length > 0) {
      const sink = channel === "stderr" ? console.error : console.log;
      sink(`[${child.label}] ${buffer}`);
    }
  });
}

function resolveChildLaunch(app: SupervisedChildRuntime["app"]): { command: string; args: string[] } {
  const root = projectRoot();
  const sourceMode = __filename.endsWith(".ts");
  if (sourceMode) {
    return {
      command: process.execPath,
      args: ["-r", "ts-node/register", path.join(root, "src", "apps", app, "main.ts")],
    };
  }

  return {
    command: process.execPath,
    args: [path.join(root, "dist", "apps", app, "main.js")],
  };
}

async function discoverSupervisorWorkspaces(
  options: SupervisorConfig,
  services: SupervisorServices,
): Promise<Array<{ id: string; name: string }>> {
  const client = await services.authService.getAuthenticatedClient(options);
  const workspaces = await client.getWorkspaces();
  await services.metadataService.saveWorkspacesToDatabase(options, workspaces);
  return workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
  }));
}

function readWorkspaceRuntimePolicy(policyFilePath?: string): WorkspaceRuntimePolicy {
  if (typeof policyFilePath !== "string" || policyFilePath.trim().length === 0) {
    return { disabledWorkspaceIds: [] };
  }

  const resolvedPath = path.resolve(policyFilePath.trim());
  if (!fs.existsSync(resolvedPath)) {
    return { disabledWorkspaceIds: [] };
  }

  const raw = fs.readFileSync(resolvedPath, "utf8");
  if (!raw.trim()) {
    return { disabledWorkspaceIds: [] };
  }

  const parsed = JSON.parse(raw) as { disabledWorkspaceIds?: unknown };
  return {
    disabledWorkspaceIds: normalizeWorkspaceIdList(parsed.disabledWorkspaceIds),
  };
}

function normalizeWorkspaceIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

function isExcludedWorkspace(workspaceId: string, excludedWorkspaceIds: string[] | undefined): boolean {
  return Array.isArray(excludedWorkspaceIds) && excludedWorkspaceIds.includes(workspaceId);
}

function projectRoot(): string {
  return path.resolve(__dirname, "../..");
}

function parsePositiveInteger(value: string | number | undefined, fallback: number, label: string): number {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function registerRestartAttempt(child: SupervisedChildRuntime): number | null {
  const now = Date.now();
  child.restartTimestamps = child.restartTimestamps.filter(
    (timestamp) => now - timestamp < DEFAULT_RESTART_WINDOW_MS,
  );
  if (child.restartTimestamps.length >= DEFAULT_MAX_RESTARTS_PER_WINDOW) {
    return null;
  }

  child.restartTimestamps.push(now);
  return child.restartTimestamps.length;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

export async function bootstrapSupervisorControlPlane(options: SupervisorConfig): Promise<boolean> {
  if (resolveControlPlaneBackend(options) !== "postgres") {
    return false;
  }

  const repository = createControlPlaneRepository(options);
  try {
    await repository.initialize();
    return true;
  } finally {
    await repository.close();
  }
}

export function buildSupervisorChildEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  controlPlaneBootstrapped: boolean,
): NodeJS.ProcessEnv {
  if (!controlPlaneBootstrapped) {
    return { ...baseEnv };
  }

  return {
    ...baseEnv,
    [CONTROL_PLANE_BOOTSTRAPPED_ENV]: "1",
  };
}
