import {
  type OperatorRuntimeConfig,
  SUNO_EXPORT_CLUSTER_GROUP,
  SUNO_EXPORT_CLUSTER_PLURAL,
  SUNO_EXPORT_CLUSTER_VERSION,
} from "./types";

const DEFAULT_POLL_INTERVAL_MS = 15_000;

export function resolveOperatorRuntimeConfig(options: Record<string, unknown>): OperatorRuntimeConfig {
  return {
    namespace: optionalString(options.namespace) ?? optionalString(process.env.SUNO_EXPORT_OPERATOR_NAMESPACE),
    pollIntervalMs: parsePositiveInteger(
      options.pollInterval ?? process.env.SUNO_EXPORT_OPERATOR_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      "--poll-interval",
    ),
    customResourceGroup: optionalString(options.crdGroup)
      ?? optionalString(process.env.SUNO_EXPORT_OPERATOR_CRD_GROUP)
      ?? SUNO_EXPORT_CLUSTER_GROUP,
    customResourceVersion: optionalString(options.crdVersion)
      ?? optionalString(process.env.SUNO_EXPORT_OPERATOR_CRD_VERSION)
      ?? SUNO_EXPORT_CLUSTER_VERSION,
    customResourcePlural: optionalString(options.crdPlural)
      ?? optionalString(process.env.SUNO_EXPORT_OPERATOR_CRD_PLURAL)
      ?? SUNO_EXPORT_CLUSTER_PLURAL,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parsePositiveInteger(value: unknown, fallback: number, label: string): number {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}
