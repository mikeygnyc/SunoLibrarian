import type { WorkerRole } from "./lib/interfaces";
import type { CliOptions } from "./services";

type RuntimeWorkerRole = Extract<WorkerRole, "auth" | "metadata" | "asset" | "processing" | "conversion">;
type ControlPlaneBackend = "local" | "postgres";

export interface ControlPlaneConfig {
  controlPlane?: ControlPlaneBackend;
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

export type OrchestratorConfig = CliOptions & ControlPlaneConfig & {
  once?: boolean;
  pollInterval?: string | number;
};

export type WorkerConfig = CliOptions & ControlPlaneConfig & {
  role: RuntimeWorkerRole;
  once?: boolean;
  pollInterval?: string | number;
};

export type LibrarianConfig = CliOptions & BrowserAuthConfig & MetadataStoreConfigInput & {
  postgresUrl?: string;
  workspace: string;
  librarianInterval?: string | number;
  once?: boolean;
};

export function normalizeApiServerConfig(options: Record<string, unknown>): ApiServerConfig {
  return {
    host: optionalString(options.host),
    port: optionalStringOrNumber(options.port),
    controlPlane: optionalControlPlane(options.controlPlane),
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
    controlPlane: optionalControlPlane(options.controlPlane),
    postgresUrl: optionalString(options.postgresUrl),
    once: optionalBoolean(options.once),
    pollInterval: optionalStringOrNumber(options.pollInterval),
  };
}

export function normalizeWorkerConfig(options: Record<string, unknown>): WorkerConfig {
  const role = optionalWorkerRole(options.role);
  if (!role) {
    throw new Error("run-worker requires --role");
  }

  return {
    role,
    controlPlane: optionalControlPlane(options.controlPlane),
    postgresUrl: optionalString(options.postgresUrl),
    once: optionalBoolean(options.once),
    pollInterval: optionalStringOrNumber(options.pollInterval),
  };
}

export function normalizeLibrarianConfig(options: Record<string, unknown>): LibrarianConfig {
  const workspace = optionalString(options.workspace);
  if (!workspace) {
    throw new Error("run-librarian requires --workspace so each librarian process owns exactly one workspace");
  }

  return {
    workspace,
    token: optionalString(options.token),
    browser: optionalBrowserOption(options.browser),
    ignoreCachedToken: optionalBoolean(options.ignoreCachedToken),
    browserProfile: optionalString(options.browserProfile),
    profileDirectory: optionalString(options.profileDirectory),
    librarianInterval: optionalStringOrNumber(options.librarianInterval),
    once: optionalBoolean(options.once),
    databaseType: optionalString(options.databaseType),
    database: optionalString(options.database),
    postgresUrl: optionalString(options.postgresUrl),
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
