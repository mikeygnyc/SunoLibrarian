import fetch from "node-fetch";
import type { RequestInit } from "node-fetch";
import type {
  IHttpApiAuthStatusResponse,
  IHttpApiCancelJobResponse,
  IHttpApiErrorResponse,
  IHttpApiHealthResponse,
  IHttpApiJobSnapshotResponse,
  IHttpApiListJobsResponse,
  IHttpApiLogsResponse,
  IHttpApiMutationResponse,
  IHttpApiSetAuthTokenResponse,
  IHttpApiSubmitJobResponse,
  IHttpApiWorkflowRequestMap,
  ILogQueryFilter,
  WorkflowType,
} from "./lib/interfaces";

type FetchResponseLike = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface IHttpApiClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export class HttpApiClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "HttpApiClientError";
  }
}

export class HttpApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: IHttpApiClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  }

  getHealth(signal?: AbortSignal): Promise<IHttpApiHealthResponse> {
    return this.request("/healthz", { signal });
  }

  getAuthStatus(signal?: AbortSignal): Promise<IHttpApiAuthStatusResponse> {
    return this.request("/api/v1/auth/status", { signal });
  }

  setAuthToken(token: string, signal?: AbortSignal): Promise<IHttpApiSetAuthTokenResponse> {
    return this.request("/api/v1/auth/token", {
      method: "POST",
      body: { token },
      signal,
    });
  }

  clearAuthToken(signal?: AbortSignal): Promise<IHttpApiMutationResponse> {
    return this.request("/api/v1/auth/token", {
      method: "DELETE",
      signal,
    });
  }

  listJobs(limit?: number, signal?: AbortSignal): Promise<IHttpApiListJobsResponse> {
    const path = typeof limit === "number" ? `/api/v1/jobs?limit=${encodeURIComponent(String(limit))}` : "/api/v1/jobs";
    return this.request(path, { signal });
  }

  submitWorkflow<TWorkflowType extends WorkflowType>(
    workflowType: TWorkflowType,
    payload: IHttpApiWorkflowRequestMap[TWorkflowType],
    signal?: AbortSignal,
  ): Promise<IHttpApiSubmitJobResponse> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowType)}`, {
      method: "POST",
      body: payload,
      signal,
    });
  }

  getJob(jobId: string, signal?: AbortSignal): Promise<IHttpApiJobSnapshotResponse> {
    return this.request(`/api/v1/jobs/${encodeURIComponent(jobId)}`, { signal });
  }

  cancelJob(jobId: string, reason?: string, signal?: AbortSignal): Promise<IHttpApiCancelJobResponse> {
    return this.request(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
      body: reason ? { reason } : {},
      signal,
    });
  }

  queryLogs(filter: ILogQueryFilter = {}, signal?: AbortSignal): Promise<IHttpApiLogsResponse> {
    const query = new URLSearchParams();
    appendStringQuery(query, "jobId", filter.jobId);
    appendStringQuery(query, "stageId", filter.stageId);
    appendStringQuery(query, "workItemId", filter.workItemId);
    appendStringQuery(query, "workflowType", filter.workflowType);
    appendStringQuery(query, "workerInstanceId", filter.workerInstanceId);
    appendStringQuery(query, "role", filter.role);
    appendStringQuery(query, "clipId", filter.clipId);
    appendStringQuery(query, "level", filter.level);
    appendDateQuery(query, "startTime", filter.startTime);
    appendDateQuery(query, "endTime", filter.endTime);
    if (typeof filter.limit === "number") {
      query.set("limit", String(filter.limit));
    }

    const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";
    return this.request(`/api/v1/logs${suffix}`, { signal });
  }

  private async request<TResponse>(
    path: string,
    options: {
      method?: "GET" | "POST" | "DELETE";
      body?: unknown;
      signal?: AbortSignal;
    } = {},
  ): Promise<TResponse> {
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
      },
      signal: options.signal,
    };

    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
      init.headers = {
        ...init.headers,
        "content-type": "application/json",
      };
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    const parsedBody = await readJsonResponse(response);

    if (!response.ok) {
      const message = extractErrorMessage(parsedBody, response.status);
      throw new HttpApiClientError(message, response.status, parsedBody);
    }

    return parsedBody as TResponse;
  }
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const resolved = typeof baseUrl === "string" && baseUrl.trim().length > 0
    ? baseUrl.trim()
    : "http://127.0.0.1:3000";
  return resolved.replace(/\/+$/, "");
}

async function readJsonResponse(response: FetchResponseLike): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    const text = await response.text();
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }
}

function extractErrorMessage(body: unknown, statusCode: number): string {
  if (body && typeof body === "object" && "error" in body && typeof (body as IHttpApiErrorResponse).error === "string") {
    return (body as IHttpApiErrorResponse).error;
  }
  return `HTTP request failed with status ${statusCode}`;
}

function appendStringQuery(query: URLSearchParams, key: string, value: string | undefined): void {
  if (typeof value === "string" && value.length > 0) {
    query.set(key, value);
  }
}

function appendDateQuery(query: URLSearchParams, key: string, value: Date | undefined): void {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    query.set(key, value.toISOString());
  }
}
