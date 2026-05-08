import type { SupervisorRuntimeMode, SupervisorWorkerSpec, WorkerRole } from "./core/contracts";
import type { CliOptions } from "./core/services";

type RuntimeWorkerRole = Extract<WorkerRole, "auth" | "metadata" | "asset" | "processing" | "conversion">;
type ControlPlaneBackend = "local" | "postgres";

export interface ControlPlaneConfig {
  controlPlane?: ControlPlaneBackend;
  controlPlaneDir?: string;
  postgresUrl?: string;
}

export interface BrowserAuthConfig {
  token?: string;
  browser?: string | boolean;
  ignoreCachedToken?: boolean;
  browserProfile?: string;
  profileDirectory?: string;
}

export interface MetadataStoreConfigInput {
  databaseType?: string;
  database?: string;
}

export type ApiServerConfig = CliOptions & ControlPlaneConfig & MetadataStoreConfigInput & {
  host?: string;
  port?: string | number;
  output?: string;
  library?: string;
  logFile?: string;
  delay?: string;
  processConcurrency?: string;
  processUpdateConcurrency?: string;
};

export type OperatorCliConfig = CliOptions & {
  apiUrl?: string;
};

export type WorkflowSubmissionOptions = CliOptions & BrowserAuthConfig & {
  workspace?: string;
  format?: string;
  input?: string;
  output?: string;
  library?: string;
  createdAfter?: string;
  createdBefore?: string;
  flushCache?: boolean;
  processExistingMetadata?: boolean;
  processFormats?: string;
  processBitrate?: string;
  images?: boolean;
  lyrics?: boolean;
  exitOnError?: boolean;
  reconvertBefore?: string;
  reconvertAfter?: string;
  reconvertMissing?: boolean;
  processClipIds?: string[];
  list?: string;
  fetchImageList?: string;
  fetchMissing?: boolean;
  ids?: string;
};

export type OrchestratorConfig = CliOptions & ControlPlaneConfig & {
  once?: boolean;
  pollInterval?: string | number;
  healthHost?: string;
  healthPort?: string | number;
};

export type WorkerConfig = CliOptions & ControlPlaneConfig & {
  role: RuntimeWorkerRole;
  once?: boolean;
  pollInterval?: string | number;
  healthHost?: string;
  healthPort?: string | number;
};

export type LibrarianConfig = CliOptions & BrowserAuthConfig & MetadataStoreConfigInput & {
  postgresUrl?: string;
  workspace: string;
  enabledWorkspaces?: string[];
  disabledWorkspaces?: string[];
  librarianInterval?: string | number;
  once?: boolean;
  healthHost?: string;
  healthPort?: string | number;
};

export type SupervisorConfig = ControlPlaneConfig & {
  cacheDir?: string;
  token?: string;
  browser?: string | boolean;
  ignoreCachedToken?: boolean;
  browserProfile?: string;
  profileDirectory?: string;
  databaseType?: string;
  database?: string;
  mode?: SupervisorRuntimeMode;
  apiHost?: string;
  apiPort?: string | number;
  healthHost?: string;
  orchestratorHealthPort?: string | number;
  workerTopology?: SupervisorWorkerSpec[];
  workerRoles?: RuntimeWorkerRole[];
  workerHealthPortBase?: string | number;
  librarianInterval?: string | number;
  librarianHealthPortBase?: string | number;
  workspaceRefreshIntervalMs?: string | number;
  excludedWorkspaces?: string[];
  workspacePolicyFile?: string;
  startupTimeoutMs?: string | number;
};

export function normalizeApiServerConfig(options: Record<string, unknown>): ApiServerConfig {
  return {
    cacheDir: optionalString(options.cacheDir),
    host: optionalString(options.host),
    port: optionalStringOrNumber(options.port),
    controlPlane: optionalControlPlane(options.controlPlane),
    controlPlaneDir: optionalString(options.controlPlaneDir),
    postgresUrl: optionalString(options.postgresUrl),
    databaseType: optionalString(options.databaseType),
    database: optionalString(options.database),
    output: optionalString(options.output),
    library: optionalString(options.library),
    logFile: optionalString(options.logFile),
    delay: optionalString(options.delay),
    processConcurrency: optionalString(options.processConcurrency),
    processUpdateConcurrency: optionalString(options.processUpdateConcurrency),
  };
}

export function normalizeOperatorCliConfig(options: Record<string, unknown>): OperatorCliConfig {
  return options as OperatorCliConfig;
}

export function normalizeOrchestratorConfig(options: Record<string, unknown>): OrchestratorConfig {
  return {
    cacheDir: optionalString(options.cacheDir),
    controlPlane: optionalControlPlane(options.controlPlane),
    controlPlaneDir: optionalString(options.controlPlaneDir),
    postgresUrl: optionalString(options.postgresUrl),
    once: optionalBoolean(options.once),
    pollInterval: optionalStringOrNumber(options.pollInterval),
    healthHost: optionalString(options.healthHost),
    healthPort: optionalStringOrNumber(options.healthPort),
  };
}

export function normalizeWorkerConfig(options: Record<string, unknown>): WorkerConfig {
  const role = optionalWorkerRole(options.role);
  if (!role) {
    throw new Error("run-worker requires --role");
  }

  return {
    cacheDir: optionalString(options.cacheDir),
    role,
    controlPlane: optionalControlPlane(options.controlPlane),
    controlPlaneDir: optionalString(options.controlPlaneDir),
    postgresUrl: optionalString(options.postgresUrl),
    once: optionalBoolean(options.once),
    pollInterval: optionalStringOrNumber(options.pollInterval),
    healthHost: optionalString(options.healthHost),
    healthPort: optionalStringOrNumber(options.healthPort),
  };
}

export function normalizeLibrarianConfig(options: Record<string, unknown>): LibrarianConfig {
  const workspace = optionalString(options.workspace);
  if (!workspace) {
    throw new Error("run-librarian requires --workspace so each librarian process owns exactly one workspace");
  }

  return {
    cacheDir: optionalString(options.cacheDir),
    workspace,
    token: optionalString(options.token),
    browser: optionalBrowserOption(options.browser),
    ignoreCachedToken: optionalBoolean(options.ignoreCachedToken),
    browserProfile: optionalString(options.browserProfile),
    profileDirectory: optionalString(options.profileDirectory),
    enabledWorkspaces: parseWorkspaceListOption(options.enabledWorkspaces),
    disabledWorkspaces: parseWorkspaceListOption(options.disabledWorkspaces),
    librarianInterval: optionalStringOrNumber(options.librarianInterval),
    once: optionalBoolean(options.once),
    healthHost: optionalString(options.healthHost),
    healthPort: optionalStringOrNumber(options.healthPort),
    databaseType: optionalString(options.databaseType),
    database: optionalString(options.database),
    postgresUrl: optionalString(options.postgresUrl),
  };
}

export function normalizeSupervisorConfig(options: Record<string, unknown>): SupervisorConfig {
  return {
    cacheDir: optionalString(options.cacheDir),
    token: optionalString(options.token),
    browser: optionalBrowserOption(options.browser),
    ignoreCachedToken: optionalBoolean(options.ignoreCachedToken),
    browserProfile: optionalString(options.browserProfile),
    profileDirectory: optionalString(options.profileDirectory),
    databaseType: optionalString(options.databaseType),
    database: optionalString(options.database),
    mode: optionalSupervisorRuntimeMode(options.mode),
    controlPlane: optionalControlPlane(options.controlPlane),
    controlPlaneDir: optionalString(options.controlPlaneDir),
    postgresUrl: optionalString(options.postgresUrl),
    apiHost: optionalString(options.apiHost),
    apiPort: optionalStringOrNumber(options.apiPort),
    healthHost: optionalString(options.healthHost),
    orchestratorHealthPort: optionalStringOrNumber(options.orchestratorHealthPort),
    workerTopology: parseWorkerTopologyOption(options.workerTopology),
    workerRoles: parseWorkerRolesOption(options.workerRoles),
    workerHealthPortBase: optionalStringOrNumber(options.workerHealthPortBase),
    librarianInterval: optionalStringOrNumber(options.librarianInterval),
    librarianHealthPortBase: optionalStringOrNumber(options.librarianHealthPortBase),
    workspaceRefreshIntervalMs: optionalStringOrNumber(options.workspaceRefreshIntervalMs),
    excludedWorkspaces: parseWorkspaceListOption(options.excludedWorkspaces),
    workspacePolicyFile: optionalString(options.workspacePolicyFile),
    startupTimeoutMs: optionalStringOrNumber(options.startupTimeoutMs),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalStringOrNumber(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return optionalString(value);
}

function optionalControlPlane(value: unknown): ControlPlaneBackend | undefined {
  return value === "local" || value === "postgres" ? value : undefined;
}

function optionalBrowserOption(value: unknown): string | boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return optionalString(value);
}

function optionalWorkerRole(value: unknown): RuntimeWorkerRole | undefined {
  switch (value) {
    case "auth":
    case "metadata":
    case "asset":
    case "processing":
    case "conversion":
      return value;
    default:
      return undefined;
  }
}

function optionalSupervisorRuntimeMode(value: unknown): SupervisorRuntimeMode | undefined {
  return value === "local" || value === "remote" ? value : undefined;
}

function parseWorkerRolesOption(value: unknown): SupervisorWorkerSpec["role"][] | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const roles = Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => optionalWorkerRole(entry))
        .filter((entry): entry is RuntimeWorkerRole => Boolean(entry)),
    ),
  );

  return roles.length > 0 ? roles : undefined;
}

function parseWorkerTopologyOption(value: unknown): SupervisorWorkerSpec[] | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const counts = new Map<RuntimeWorkerRole, number>();
  for (const rawEntry of value.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const [rawRole, rawCount] = entry.split("=");
    const role = optionalWorkerRole(rawRole);
    const parsedCount = Number.parseInt(String(rawCount ?? "1"), 10);
    if (!role || !Number.isFinite(parsedCount) || parsedCount < 0) {
      throw new Error(
        "Invalid --worker-topology entry. Use role=count with roles auth, metadata, asset, processing, conversion",
      );
    }

    counts.set(role, parsedCount);
  }

  const specs = Array.from(counts.entries())
    .filter(([, count]) => count > 0)
    .map(([role, count]) => ({ role, count }));

  return specs.length > 0 ? specs : [];
}

function parseWorkspaceListOption(value: unknown): string[] | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const workspaces = Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );

  return workspaces.length > 0 ? workspaces : undefined;
}
