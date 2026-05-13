import type { WorkerRole } from "./core/contracts";
import type { CliOptions } from "./core/services";

type ControlPlaneBackend = "postgres";
export type ApiServerMode = "postgres";

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

export interface ApiServerStorageConfig extends MetadataStoreConfigInput {
  mode?: ApiServerMode;
  postgresUrl?: string;
  output?: string;
  library?: string;
  delay?: string;
  processConcurrency?: string;
  processUpdateConcurrency?: string;
}

export type ApiServerConfig = CliOptions & ControlPlaneConfig & ApiServerStorageConfig & {
  host?: string;
  port?: string | number;
  logFile?: string;
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

export type WorkerConfig = CliOptions & ControlPlaneConfig & {
  role: WorkerRole;
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

export function normalizeApiServerConfig(options: Record<string, unknown>): ApiServerConfig {
  return {
    cacheDir: optionalString(options.cacheDir),
    host: optionalString(options.host),
    port: optionalStringOrNumber(options.port),
    mode: "postgres",
    controlPlane: "postgres",
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

export function normalizeWorkerConfig(options: Record<string, unknown>): WorkerConfig {
  const role = optionalWorkerRole(options.role);
  if (!role) {
    throw new Error("run-worker requires --role");
  }
  const postgresUrl = optionalString(options.postgresUrl);

  return {
    cacheDir: optionalString(options.cacheDir),
    role,
    controlPlane: inferRuntimeControlPlane(postgresUrl, options.controlPlane),
    postgresUrl,
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
  return value === "postgres" ? value : undefined;
}

function inferRuntimeControlPlane(
  postgresUrl: string | undefined,
  legacyControlPlane: unknown,
): ControlPlaneBackend | undefined {
  if (postgresUrl) {
    return "postgres";
  }
  return optionalControlPlane(legacyControlPlane);
}

function optionalBrowserOption(value: unknown): string | boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return optionalString(value);
}

function optionalWorkerRole(value: unknown): WorkerRole | undefined {
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
