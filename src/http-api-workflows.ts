import type {
  IHttpApiDownloadImagesWorkflowRequest,
  IHttpApiDownloadWorkflowRequest,
  IHttpApiFetchMetadataWorkflowRequest,
  IHttpApiProcessWorkflowRequest,
  IHttpApiRefreshWorkflowRequest,
  IHttpApiSyncWorkflowRequest,
  WorkflowType,
} from "./core/contracts";
import type { WorkflowSubmissionOptions } from "./app-config";

type WorkflowRequestMap = {
  "download": IHttpApiDownloadWorkflowRequest;
  "process": IHttpApiProcessWorkflowRequest;
  "sync": IHttpApiSyncWorkflowRequest;
  "download-images": IHttpApiDownloadImagesWorkflowRequest;
  "fetch-metadata": IHttpApiFetchMetadataWorkflowRequest;
  "refresh": IHttpApiRefreshWorkflowRequest;
};

export interface IHttpApiWorkflowServerDefaults {
  downloadRoot: string;
  libraryRoot: string;
}

export function validateWorkflowSubmission(
  workflowType: WorkflowType,
  payload: unknown,
  serverDefaults: IHttpApiWorkflowServerDefaults,
): WorkflowSubmissionOptions {
  if (!isPlainObject(payload)) {
    throw createValidationError("Workflow request body must be an object");
  }

  assertServerOwnedFieldsAbsent(payload);

  switch (workflowType) {
    case "download":
      return mapDownloadRequest(payload as WorkflowRequestMap["download"], serverDefaults);
    case "process":
      return mapProcessRequest(payload as unknown as WorkflowRequestMap["process"], serverDefaults);
    case "sync":
      return mapSyncRequest(payload as unknown as WorkflowRequestMap["sync"], serverDefaults);
    case "download-images":
      return mapDownloadImagesRequest(payload as WorkflowRequestMap["download-images"], serverDefaults);
    case "fetch-metadata":
      return mapFetchMetadataRequest(payload as WorkflowRequestMap["fetch-metadata"]);
    case "refresh":
      return mapRefreshRequest(payload as WorkflowRequestMap["refresh"]);
  }
}

function mapDownloadRequest(
  request: IHttpApiDownloadWorkflowRequest,
  serverDefaults: IHttpApiWorkflowServerDefaults,
): WorkflowSubmissionOptions {
  return {
    ...mapCommonRequest(request),
    workspace: optionalString(request.workspaceId, "workspaceId"),
    format: optionalEnum(request.format, ["mp3", "wav"], "format"),
    output: serverDefaults.downloadRoot,
    createdAfter: optionalString(request.createdAfter, "createdAfter"),
    createdBefore: optionalString(request.createdBefore, "createdBefore"),
    flushCache: optionalBoolean(request.flushCache, "flushCache"),
  };
}

function mapProcessRequest(
  request: IHttpApiProcessWorkflowRequest,
  serverDefaults: IHttpApiWorkflowServerDefaults,
): WorkflowSubmissionOptions {
  return {
    ...mapProcessingCommonRequest(request),
    input: serverDefaults.downloadRoot,
    output: serverDefaults.libraryRoot,
  };
}

function mapSyncRequest(
  request: IHttpApiSyncWorkflowRequest,
  serverDefaults: IHttpApiWorkflowServerDefaults,
): WorkflowSubmissionOptions {
  return {
    ...mapCommonRequest(request),
    workspace: optionalString(request.workspaceId, "workspaceId"),
    format: optionalEnum(request.format, ["mp3", "wav"], "format"),
    output: serverDefaults.downloadRoot,
    library: serverDefaults.libraryRoot,
    createdAfter: optionalString(request.createdAfter, "createdAfter"),
    createdBefore: optionalString(request.createdBefore, "createdBefore"),
    flushCache: optionalBoolean(request.flushCache, "flushCache"),
    processExistingMetadata: optionalBoolean(request.processExistingMetadata, "processExistingMetadata"),
    processFormats: optionalCsv(request.formats, "formats"),
    processBitrate: optionalPositiveIntegerString(request.bitrateKbps, "bitrateKbps"),
    images: optionalBoolean(request.embedImages, "embedImages"),
    lyrics: optionalBoolean(request.embedLyrics, "embedLyrics"),
    exitOnError: optionalBoolean(request.exitOnError, "exitOnError"),
    reconvertBefore: optionalString(request.reconvertBefore, "reconvertBefore"),
    reconvertAfter: optionalString(request.reconvertAfter, "reconvertAfter"),
    reconvertMissing: optionalBoolean(request.reconvertMissing, "reconvertMissing"),
    processClipIds: optionalStringArray(request.clipIds, "clipIds"),
  };
}

function mapDownloadImagesRequest(
  request: IHttpApiDownloadImagesWorkflowRequest,
  serverDefaults: IHttpApiWorkflowServerDefaults,
): WorkflowSubmissionOptions {
  return {
    ...mapCommonRequest(request),
    output: serverDefaults.downloadRoot,
    list: optionalString(request.listPath, "listPath"),
    fetchImageList: optionalString(request.fetchImageListPath, "fetchImageListPath"),
    fetchMissing: optionalBoolean(request.fetchMissing, "fetchMissing"),
  };
}

function mapFetchMetadataRequest(request: IHttpApiFetchMetadataWorkflowRequest): WorkflowSubmissionOptions {
  return {
    ...mapCommonRequest(request),
    ids: optionalCsv(request.trackIds, "trackIds"),
    workspace: optionalString(request.workspaceId, "workspaceId"),
    createdAfter: optionalString(request.createdAfter, "createdAfter"),
    createdBefore: optionalString(request.createdBefore, "createdBefore"),
  };
}

function mapRefreshRequest(request: IHttpApiRefreshWorkflowRequest): WorkflowSubmissionOptions {
  return mapCommonRequest(request);
}

function mapProcessingCommonRequest(
  request: IHttpApiProcessWorkflowRequest | IHttpApiSyncWorkflowRequest,
): WorkflowSubmissionOptions {
  return {
    ...mapCommonRequest(request),
    processFormats: optionalCsv(request.formats, "formats"),
    processBitrate: optionalPositiveIntegerString(request.bitrateKbps, "bitrateKbps"),
    images: optionalBoolean(request.embedImages, "embedImages"),
    lyrics: optionalBoolean(request.embedLyrics, "embedLyrics"),
    exitOnError: optionalBoolean(request.exitOnError, "exitOnError"),
    reconvertBefore: optionalString(request.reconvertBefore, "reconvertBefore"),
    reconvertAfter: optionalString(request.reconvertAfter, "reconvertAfter"),
    reconvertMissing: optionalBoolean(request.reconvertMissing, "reconvertMissing"),
    processClipIds: optionalStringArray(request.clipIds, "clipIds"),
  };
}

function mapCommonRequest(request: {
  auth?: unknown;
}): WorkflowSubmissionOptions {
  const auth = optionalObject(request.auth, "auth");

  return {
    token: auth ? optionalString(auth.token, "auth.token") : undefined,
    browser: auth ? optionalString(auth.browserUrl, "auth.browserUrl") : undefined,
    ignoreCachedToken: auth ? optionalBoolean(auth.ignoreCachedToken, "auth.ignoreCachedToken") : undefined,
    browserProfile: auth ? optionalString(auth.browserProfile, "auth.browserProfile") : undefined,
    profileDirectory: auth ? optionalString(auth.profileDirectory, "auth.profileDirectory") : undefined,
  };
}

function assertServerOwnedFieldsAbsent(payload: Record<string, unknown>): void {
  const disallowedTopLevelFields = [
    "input",
    "output",
    "libraryOutput",
    "metadataStore",
    "importMetadataJson",
    "exportMetadataJson",
    "metadataFile",
    "copySongsMetadataToOutput",
    "delayMs",
    "songConcurrency",
    "updateConcurrency",
  ];

  for (const field of disallowedTopLevelFields) {
    if (field in payload) {
      throw createValidationError(`${field} is managed by the server and cannot be set per request`);
    }
  }
}

function requiredString(value: unknown, label: string): string {
  const resolved = optionalString(value, label);
  if (!resolved) {
    throw createValidationError(`${label} is required`);
  }
  return resolved;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw createValidationError(`${label} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value !== "boolean") {
    throw createValidationError(`${label} must be a boolean`);
  }
  return value;
}

function optionalPositiveIntegerString(value: unknown, label: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw createValidationError(`${label} must be a positive integer`);
  }
  return String(value);
}

function optionalEnum<TValues extends readonly string[]>(
  value: unknown,
  allowed: TValues,
  label: string,
): TValues[number] | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw createValidationError(`${label} must be one of: ${allowed.join(", ")}`);
  }
  const trimmed = value.trim();
  if ((allowed as readonly string[]).includes(trimmed)) {
    return trimmed as TValues[number];
  }
  throw createValidationError(`${label} must be one of: ${allowed.join(", ")}`);
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw createValidationError(`${label} must be an array of strings`);
  }
  const items = value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw createValidationError(`${label}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
  return items.length > 0 ? items : undefined;
}

function optionalCsv(value: unknown, label: string): string | undefined {
  const items = optionalStringArray(value, label);
  return items?.join(",");
}

function optionalObject(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (!isPlainObject(value)) {
    throw createValidationError(`${label} must be an object`);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createValidationError(message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
}
