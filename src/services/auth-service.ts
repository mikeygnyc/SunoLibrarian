import * as path from "path";
import { extractTokenFromBrowser } from "../auth";
import { SunoClient } from "../client";
import { Storage } from "../storage";

export interface CliOptions {
  [key: string]: any;
  apiUrl?: string;
  browser?: string | boolean;
  browserProfile?: string;
  controlPlane?: string;
  database?: string;
  databaseType?: string;
  delay?: string | number;
  host?: string;
  ignoreCachedToken?: boolean;
  interval?: string | number;
  jobId?: string;
  json?: boolean;
  librarianInterval?: string | number;
  library?: string;
  level?: string;
  limit?: string | number;
  list?: string;
  logFile?: string;
  once?: boolean;
  output?: string;
  payload?: string;
  pollInterval?: string | number;
  port?: string | number;
  postgresUrl?: string;
  processConcurrency?: string | number;
  processUpdateConcurrency?: string | number;
  profileDirectory?: string;
  reason?: string;
  role?: string;
  runtimeMode?: string;
  startTime?: string;
  stageId?: string;
  submitOnly?: boolean;
  token?: string;
  workerInstanceId?: string;
  workflowType?: string;
  workItemId?: string;
  workspace?: string;
  __abortSignal?: AbortSignal;
  __authenticatedClient?: SunoClient;
  __storage?: {
    clearCache?: () => void;
  };
  onTrackDownloaded?: (params: { clipId: string; outputDir: string }) => void;
}

const DEFAULT_BROWSER_ENDPOINT = "http://localhost:9222";

export type AuthStorage = Pick<Storage, "getAuthToken" | "setAuthToken">;

export type AuthClient = {
  fetchWorkspacesPage(page?: number): Promise<any>;
};

export type AuthDeps<TClient extends AuthClient> = {
  storage: AuthStorage;
  createClient: (
    token: string,
    browserEndpoint?: string,
    browserUserDataDir?: string,
    browserProfileDirectory?: string,
    abortSignal?: AbortSignal,
  ) => TClient;
  extractTokenFromBrowser: typeof extractTokenFromBrowser;
  log: Pick<Console, "error" | "log" | "warn">;
};

export class AuthService {
  async getAuthenticatedClient(options: CliOptions): Promise<SunoClient> {
    if (options.__authenticatedClient) {
      return options.__authenticatedClient as SunoClient;
    }

    return getAuthenticatedClientWithDeps(options, {
      storage: new Storage(),
      createClient,
      extractTokenFromBrowser,
      log: console,
    });
  }
}

export async function getAuthenticatedClientWithDeps<TClient extends AuthClient>(
  options: CliOptions,
  deps: AuthDeps<TClient>,
): Promise<TClient> {
  const browserEndpoint = resolveBrowserEndpoint(options);
  const browserUserDataDir = resolveBrowserUserDataDir(options);
  const browserProfileDirectory = resolveBrowserProfileDirectory(options);
  const ignoreCachedToken = options.ignoreCachedToken === true;

  if (!ignoreCachedToken) {
    const cachedToken = deps.storage.getAuthToken();
    if (cachedToken) {
      const cachedClient = deps.createClient(
        cachedToken,
        browserEndpoint,
        browserUserDataDir,
        browserProfileDirectory,
        options.__abortSignal,
      );

      try {
        await cachedClient.fetchWorkspacesPage(1);
        deps.log.error("Using cached authentication token.");
        return cachedClient;
      } catch (error: any) {
        if (!isAuthFailure(error)) {
          throw error;
        }
        deps.log.warn("Cached authentication token was rejected. Falling back to configured auth method.");
      }
    }
  }

  if (!options.token && !browserEndpoint) {
    throw new Error("Authentication required: provide either --token or --browser");
  }

  let token = options.token;
  if (!token) {
    deps.log.log("No token provided. Launching browser to extract token...");
    token = await deps.extractTokenFromBrowser(browserEndpoint, {
      userDataDir: browserUserDataDir,
      profileDirectory: browserProfileDirectory,
      abortSignal: options.__abortSignal,
    });
    deps.log.log("Token extracted successfully!");
  }

  deps.storage.setAuthToken(token);
  return deps.createClient(
    token,
    browserEndpoint,
    browserUserDataDir,
    browserProfileDirectory,
    options.__abortSignal,
  );
}

function createClient(
  token: string,
  browserEndpoint?: string,
  browserUserDataDir?: string,
  browserProfileDirectory?: string,
  abortSignal?: AbortSignal,
): SunoClient {
  return new SunoClient(
    token,
    undefined,
    browserEndpoint,
    browserUserDataDir,
    browserProfileDirectory,
    abortSignal,
  );
}

function resolveBrowserEndpoint(options: CliOptions): string | undefined {
  const browser = options.browser;
  if (browser == null || browser === false) return undefined;
  if (browser === true) return DEFAULT_BROWSER_ENDPOINT;
  if (typeof browser === "string") {
    const trimmed = browser.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_BROWSER_ENDPOINT;
  }
  return DEFAULT_BROWSER_ENDPOINT;
}

function resolveBrowserUserDataDir(options: CliOptions): string | undefined {
  if (typeof options.browserProfile !== "string") return undefined;
  const trimmed = options.browserProfile.trim();
  return trimmed.length > 0 ? path.resolve(trimmed) : undefined;
}

function resolveBrowserProfileDirectory(options: CliOptions): string | undefined {
  if (typeof options.profileDirectory !== "string") return undefined;
  const trimmed = options.profileDirectory.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isAuthFailure(error: any): boolean {
  return error?.status === 401 || error?.status === 403;
}
