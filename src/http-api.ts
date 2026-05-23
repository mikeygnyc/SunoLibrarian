import * as http from "http";
import * as path from "path";
import { URL } from "url";
import { DEFAULT_DATABASE_PATH, DEFAULT_DOWNLOAD_ROOT, DEFAULT_HTTP_API_LOG_PATH } from "./cli-defaults";
import { renderDashboardHtml } from "./http-dashboard";
import { HttpApiServerLogger } from "./http-api-server-logger";
import type { ApiServerConfig, ApiServerMode, ApiServerStorageConfig, WorkflowSubmissionOptions } from "./app-config";
import type {
  IHttpApiAuthStatusResponse,
  IHttpApiCancelJobRequest,
  IHttpApiCancelJobResponse,
  IHttpApiErrorResponse,
  IHttpApiHealthResponse,
  IHttpApiJobSnapshotResponse,
  IHttpApiListJobsResponse,
  IHttpApiLogsResponse,
  IHttpApiMutationResponse,
  IHttpApiSetAuthTokenRequest,
  IHttpApiSetAuthTokenResponse,
  IHttpApiSubmitJobResponse,
  ILogQueryFilter,
  WorkflowType,
} from "./core/contracts";
import { validateWorkflowSubmission } from "./http-api-workflows";
import { SUPPORTED_WORKFLOW_TYPES, cancelWorkflowJob, createControlPlaneRepository, getJobSnapshot, restartRecentlyFailedAuthJobs, submitWorkflowJob } from "./core/orchestration";
import { clearSharedAuthToken, getSharedAuthToken, setSharedAuthToken } from "./orchestration/auth-token-store";
import { resolveRequiredControlPlaneMqttUrl } from "./orchestration/mqtt-control-plane-notifier";
import { Storage } from "./storage";
import type { CliOptions } from "./core/services";
import { installStructuredConsoleBridge, type StructuredConsoleBridgeHandle } from "./logging";

type ApiWorkflowDefaults = Pick<
  ApiServerConfig,
  | "databaseType"
  | "database"
  | "postgresUrl"
  | "delay"
  | "processConcurrency"
  | "processUpdateConcurrency"
  | "output"
  | "library"
>;

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export async function runServeApiFlow(options: ApiServerConfig = {}): Promise<void> {
  const logBridge: StructuredConsoleBridgeHandle = installStructuredConsoleBridge({
    service: "api",
    role: "api",
    tags: ["runtime", "k8s"],
  });

  try {
  // The API process is intentionally server-only. Keep worker and librarian
  // runtime loops out of this bootstrap.
  const host = typeof options.host === "string" && options.host.trim().length > 0
    ? options.host.trim()
    : "127.0.0.1";
  const port = parseIntegerOption(options.port, 3000, "--port");
  const apiMode = resolveApiServerMode(options);
  const defaultControlPlane = resolveApiControlPlaneOptions(options, apiMode);
  const workflowDefaults = resolveApiWorkflowDefaults({
    ...options,
    mode: apiMode,
    postgresUrl: defaultControlPlane.postgresUrl,
  });
  const serverLogger = new HttpApiServerLogger({
    logFilePath: resolveServerLogPath(options.logFile),
    minimumLevel: "debug",
  });

  serverLogger.info("serve-api starting", {
    host,
    port,
    apiMode,
    controlPlane: defaultControlPlane.controlPlane,
    workflowDatabaseType: workflowDefaults.databaseType,
    workflowDatabasePath: workflowDefaults.database,
    workflowPostgresUrlConfigured: workflowDefaults.databaseType === "postgres" && Boolean(workflowDefaults.postgresUrl),
    workflowDownloadRoot: workflowDefaults.output,
    workflowLibraryRoot: workflowDefaults.library,
    logFilePath: serverLogger.logFilePath,
  });

  const server = http.createServer(async (req, res) => {
    let method = req.method?.toUpperCase() ?? "";
    let pathname = req.url ?? "";
    const startedAt = Date.now();
    try {
      if (!req.url || !req.method) {
        sendJson(res, 400, { error: "Invalid request" });
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
      pathname = url.pathname;
      method = req.method.toUpperCase();
      res.once("finish", () => {
        serverLogger.info("request completed", {
          method,
          pathname,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
        });
      });

      if (method === "GET" && (pathname === "/" || pathname === "/dashboard")) {
        sendHtml(res, 200, renderDashboardHtml());
        return;
      }

      if (method === "GET" && pathname === "/healthz") {
        const response: IHttpApiHealthResponse = {
          ok: true,
          status: "ready",
          service: "api",
          role: "api",
          pid: process.pid,
        };
        sendJson(res, 200, response);
        return;
      }

      if (method === "GET" && pathname === "/api/v1/auth/status") {
        const storage = new Storage({ cacheDir: options.cacheDir });
        const sharedToken = await getSharedAuthToken({ postgresUrl: defaultControlPlane.postgresUrl });
        const response: IHttpApiAuthStatusResponse = {
          hasToken: Boolean(storage.getAuthToken() || sharedToken),
        };
        sendJson(res, 200, response);
        return;
      }

      if (method === "POST" && pathname === "/api/v1/auth/token") {
        const body = await readJsonBody<IHttpApiSetAuthTokenRequest>(req);
        const token = typeof body.token === "string" ? body.token.trim() : "";
        if (!token) {
          sendJson(res, 400, { error: "token is required" } satisfies IHttpApiErrorResponse);
          return;
        }
        const storage = new Storage({ cacheDir: options.cacheDir });
        storage.setAuthToken(token);
        await setSharedAuthToken({ postgresUrl: defaultControlPlane.postgresUrl }, token);
        let restartedJobIds: string[] = [];
        let restartError: string | undefined;
        try {
          const restartResult = await restartRecentlyFailedAuthJobs({
            ...defaultControlPlane,
            cacheDir: options.cacheDir,
            token,
          });
          restartedJobIds = restartResult.restartedJobIds;
          if (restartedJobIds.length > 0) {
            serverLogger.info("restarted auth-blocked jobs after token update", {
              restartedJobIds,
              originalJobIds: restartResult.originalJobIds,
            });
          }
        } catch (error) {
          restartError = error instanceof Error ? error.message : String(error);
          serverLogger.error("failed to restart auth-blocked jobs after token update", {
            error: restartError,
          });
        }
        const response: IHttpApiSetAuthTokenResponse = {
          ok: true,
          restartedJobIds,
          restartedJobCount: restartedJobIds.length,
          restartError,
        };
        sendJson(res, 200, response);
        return;
      }

      if (method === "DELETE" && pathname === "/api/v1/auth/token") {
        const storage = new Storage({ cacheDir: options.cacheDir });
        storage.clearAuthToken();
        await clearSharedAuthToken({ postgresUrl: defaultControlPlane.postgresUrl });
        const response: IHttpApiMutationResponse = { ok: true };
        sendJson(res, 200, response);
        return;
      }

      if (method === "GET" && pathname === "/api/v1/jobs") {
        const repository = createControlPlaneRepository(defaultControlPlane);
        try {
          await repository.initialize();
          const limit = parseIntegerQuery(url.searchParams.get("limit"), 100, "limit");
          const jobs = await repository.listJobs(limit);
          const response: IHttpApiListJobsResponse = { jobs };
          sendJson(res, 200, response);
        } finally {
          await repository.close();
        }
        return;
      }

      if (method === "POST" && pathname.startsWith("/api/v1/workflows/")) {
        const workflowType = normalizeWorkflowType(
          decodeURIComponent(pathname.slice("/api/v1/workflows/".length)),
        );
        if (!workflowType) {
          sendJson(res, 404, { error: "Workflow not found" } satisfies IHttpApiErrorResponse);
          return;
        }

        const body = await readJsonBody<Record<string, unknown>>(req);
        const validatedOptions: WorkflowSubmissionOptions = validateWorkflowSubmission(workflowType, body, {
          downloadRoot: String(workflowDefaults.output),
          libraryRoot: String(workflowDefaults.library),
        });
        const submitOptions: CliOptions = {
          ...defaultControlPlane,
          ...workflowDefaults,
          ...validatedOptions,
        };
        const jobId = await submitWorkflowJob(workflowType, submitOptions);
        serverLogger.info("workflow submitted via api", {
          workflowType,
          jobId,
        });
        const response: IHttpApiSubmitJobResponse = {
          jobId,
          workflowType,
          status: "queued",
        };
        sendJson(res, 202, response);
        return;
      }

      if (pathname.startsWith("/api/v1/jobs/")) {
        if (pathname.endsWith("/cancel")) {
          const jobId = decodeURIComponent(pathname.slice("/api/v1/jobs/".length, -"/cancel".length));
          if (!jobId) {
            sendJson(res, 400, { error: "jobId is required" } satisfies IHttpApiErrorResponse);
            return;
          }

          if (method !== "POST") {
            sendJson(res, 405, { error: "Method not allowed" } satisfies IHttpApiErrorResponse);
            return;
          }

          const body = await readJsonBody<IHttpApiCancelJobRequest>(req);
          const snapshot = await cancelWorkflowJob(
            jobId,
            defaultControlPlane,
            typeof body.reason === "string" ? body.reason : undefined,
          );
          if (!snapshot?.job) {
            sendJson(res, 404, { error: `Job not found: ${jobId}` } satisfies IHttpApiErrorResponse);
            return;
          }
          if (snapshot.job.status !== "cancelled") {
            sendJson(res, 409, {
              error: `Job ${jobId} is already ${snapshot.job.status} and cannot be cancelled`,
            } satisfies IHttpApiErrorResponse);
            return;
          }
          const response: IHttpApiCancelJobResponse = {
            jobId,
            status: "cancelled",
          };
          sendJson(res, 200, response);
          return;
        }

        if (method !== "GET") {
          sendJson(res, 405, { error: "Method not allowed" } satisfies IHttpApiErrorResponse);
          return;
        }

        const jobId = decodeURIComponent(pathname.slice("/api/v1/jobs/".length));
        if (!jobId) {
          sendJson(res, 400, { error: "jobId is required" });
          return;
        }

        const repository = createControlPlaneRepository(defaultControlPlane);
        try {
          await repository.initialize();
          const snapshot = await getJobSnapshot(repository, jobId);
          if (!snapshot.job) {
            sendJson(res, 404, { error: `Job not found: ${jobId}` } satisfies IHttpApiErrorResponse);
            return;
          }
          const response: IHttpApiJobSnapshotResponse = snapshot;
          sendJson(res, 200, response);
        } finally {
          await repository.close();
        }
        return;
      }

      if (method === "GET" && pathname === "/api/v1/logs") {
        const repository = createControlPlaneRepository(defaultControlPlane);
        try {
          await repository.initialize();
          const filter = buildLogFilter(url);
          const result = await repository.query(filter);
          const response: IHttpApiLogsResponse = result;
          sendJson(res, 200, response);
        } finally {
          await repository.close();
        }
        return;
      }

      sendJson(res, 404, { error: "Not found" } satisfies IHttpApiErrorResponse);
    } catch (error) {
      const statusCode = isHttpError(error) ? error.statusCode : 500;
      const message = error instanceof Error ? error.message : String(error);
      serverLogger.error("request failed", {
        method,
        pathname,
        statusCode,
        error: message,
      });
      sendJson(res, statusCode, { error: message } satisfies IHttpApiErrorResponse);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  console.log(`HTTP API listening on http://${host}:${port}`);
  console.log(`HTTP API mode: ${apiMode}`);
  console.log(`HTTP API local log file: ${serverLogger.logFilePath}`);

  await new Promise<void>((resolve, reject) => {
    const shutdown = () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  } finally {
    logBridge.close();
  }
}

function resolveApiServerMode(options: ApiServerConfig): ApiServerMode {
  if ((options as { mode?: string }).mode === "standalone") {
    throw createHttpError(400, "serve-api no longer supports standalone mode; provide --postgres-url");
  }
  if (typeof options.postgresUrl === "string" && options.postgresUrl.trim().length > 0) {
    return "postgres";
  }
  throw createHttpError(400, "serve-api requires --postgres-url");
}

function resolveApiControlPlaneOptions(
  options: ApiServerConfig,
  apiMode: ApiServerMode,
): Pick<CliOptions, "controlPlane" | "postgresUrl" | "mqttUrl" | "mqttTopicPrefix"> {
  void apiMode;
  const postgresUrl = typeof options.postgresUrl === "string" ? options.postgresUrl.trim() : "";
  if (!postgresUrl) {
    throw createHttpError(400, "serve-api requires --postgres-url");
  }
  return {
    controlPlane: "postgres",
    postgresUrl,
    mqttUrl: resolveRequiredControlPlaneMqttUrl(
      typeof options.mqttUrl === "string" && options.mqttUrl.trim().length > 0 ? options.mqttUrl.trim() : undefined,
    ),
    mqttTopicPrefix: typeof options.mqttTopicPrefix === "string" && options.mqttTopicPrefix.trim().length > 0
      ? options.mqttTopicPrefix.trim()
      : undefined,
  };
}

function buildLogFilter(url: URL): ILogQueryFilter {
  return {
    service: readStringQuery(url, "service"),
    jobId: readStringQuery(url, "jobId"),
    stageId: readStringQuery(url, "stageId"),
    workItemId: readStringQuery(url, "workItemId"),
    workflowType: normalizeWorkflowType(url.searchParams.get("workflowType")) ?? undefined,
    workerInstanceId: readStringQuery(url, "workerInstanceId"),
    role: normalizeWorkerRole(url.searchParams.get("role")),
    clipId: readStringQuery(url, "clipId"),
    level: normalizeLogLevel(url.searchParams.get("level")),
    startTime: parseOptionalDate(url.searchParams.get("startTime"), "startTime"),
    endTime: parseOptionalDate(url.searchParams.get("endTime"), "endTime"),
    limit: parseIntegerQuery(url.searchParams.get("limit"), 100, "limit"),
  };
}

function readStringQuery(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function parseOptionalDate(value: string | null, label: string): Date | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(400, `Invalid date for ${label}: ${value}`);
  }
  return parsed;
}

function parseIntegerQuery(value: string | null, fallback: number, label: string): number {
  if (!value || value.trim().length === 0) return fallback;
  return parseIntegerOption(value, fallback, label);
}

function parseIntegerOption(value: unknown, fallback: number, label: string): number {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createHttpError(400, `${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeWorkflowType(value: unknown): WorkflowType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim() as WorkflowType;
  return SUPPORTED_WORKFLOW_TYPES.includes(normalized) ? normalized : undefined;
}

function normalizeWorkerRole(value: string | null): ILogQueryFilter["role"] | undefined {
  switch (value?.trim()) {
    case "auth":
    case "metadata":
    case "asset":
    case "conversion":
      return value.trim() as ILogQueryFilter["role"];
    default:
      return undefined;
  }
}

function normalizeLogLevel(value: string | null): ILogQueryFilter["level"] | undefined {
  switch (value?.trim()) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value.trim() as ILogQueryFilter["level"];
    default:
      return undefined;
  }
}

async function readJsonBody<TBody extends object>(req: http.IncomingMessage): Promise<TBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {} as TBody;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {} as TBody;

  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      throw new Error("JSON body must be an object");
    }
    return parsed as TBody;
  } catch (error) {
    throw createHttpError(400, error instanceof Error ? error.message : "Invalid JSON");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": JSON_CONTENT_TYPE,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, statusCode: number, body: string): void {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function resolveApiWorkflowDefaults(options: ApiServerStorageConfig): ApiWorkflowDefaults {
  const apiMode = resolveApiServerMode(options);
  const databaseType = typeof options.databaseType === "string"
    ? options.databaseType
    : apiMode === "postgres"
      ? "postgres"
      : "sqlite";
  const downloadRoot = resolveDirectoryOption(options.output, DEFAULT_DOWNLOAD_ROOT);

  return {
    databaseType,
    database: databaseType === "sqlite"
      ? (typeof options.database === "string" && options.database.trim().length > 0
        ? options.database
        : DEFAULT_DATABASE_PATH)
      : undefined,
    postgresUrl: typeof options.postgresUrl === "string" ? options.postgresUrl : undefined,
    delay: String(parseIntegerOption(options.delay, 1000, "--delay")),
    processConcurrency: String(parseIntegerOption(options.processConcurrency, 4, "--process-concurrency")),
    processUpdateConcurrency: String(parseIntegerOption(options.processUpdateConcurrency, 8, "--process-update-concurrency")),
    output: downloadRoot,
    library: resolveDirectoryOption(options.library, path.join(downloadRoot, "library")),
  };
}

function resolveServerLogPath(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return path.resolve(value.trim());
  }
  return DEFAULT_HTTP_API_LOG_PATH;
}

function resolveDirectoryOption(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return path.resolve(value.trim());
  }
  return path.resolve(fallback);
}

function createHttpError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function isHttpError(error: unknown): error is Error & { statusCode: number } {
  return typeof error === "object" && error !== null && typeof (error as { statusCode?: unknown }).statusCode === "number";
}
