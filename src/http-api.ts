import * as http from "http";
import { URL } from "url";
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
  IHttpApiSubmitJobResponse,
  ILogQueryFilter,
  WorkflowType,
} from "./lib/interfaces";
import { validateWorkflowSubmission } from "./http-api-workflows";
import { SUPPORTED_WORKFLOW_TYPES, cancelWorkflowJob, createControlPlaneRepository, getJobSnapshot, submitWorkflowJob } from "./orchestration";
import { Storage } from "./storage";
import type { CliOptions } from "./services";

type ApiServerOptions = CliOptions & {
  host?: string;
  port?: string | number;
};

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export async function runServeApiFlow(options: ApiServerOptions = {}): Promise<void> {
  const host = typeof options.host === "string" && options.host.trim().length > 0
    ? options.host.trim()
    : "127.0.0.1";
  const port = parseIntegerOption(options.port, 3000, "--port");
  const defaultControlPlane = {
    controlPlane: typeof options.controlPlane === "string" ? options.controlPlane : "local",
    postgresUrl: typeof options.postgresUrl === "string" ? options.postgresUrl : undefined,
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        sendJson(res, 400, { error: "Invalid request" });
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
      const pathname = url.pathname;
      const method = req.method.toUpperCase();

      if (method === "GET" && pathname === "/healthz") {
        const response: IHttpApiHealthResponse = { ok: true };
        sendJson(res, 200, response);
        return;
      }

      if (method === "GET" && pathname === "/api/v1/auth/status") {
        const storage = new Storage();
        const response: IHttpApiAuthStatusResponse = {
          hasToken: Boolean(storage.getAuthToken()),
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
        const storage = new Storage();
        storage.setAuthToken(token);
        const response: IHttpApiMutationResponse = { ok: true };
        sendJson(res, 200, response);
        return;
      }

      if (method === "DELETE" && pathname === "/api/v1/auth/token") {
        const storage = new Storage();
        storage.clearAuthToken();
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
        const validatedOptions = validateWorkflowSubmission(workflowType, body);
        const submitOptions: CliOptions = {
          ...validatedOptions,
          ...defaultControlPlane,
          runtimeMode: "distributed",
          submitOnly: true,
        };
        const jobId = await submitWorkflowJob(workflowType, submitOptions);
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
      sendJson(res, statusCode, { error: message } satisfies IHttpApiErrorResponse);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  console.log(`HTTP API listening on http://${host}:${port}`);

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
}

function buildLogFilter(url: URL): ILogQueryFilter {
  return {
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
    case "orchestrator":
    case "auth":
    case "metadata":
    case "asset":
    case "processing":
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

function createHttpError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function isHttpError(error: unknown): error is Error & { statusCode: number } {
  return typeof error === "object" && error !== null && typeof (error as { statusCode?: unknown }).statusCode === "number";
}
