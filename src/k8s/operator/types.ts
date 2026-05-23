export const SUNO_EXPORT_CLUSTER_GROUP = "suno.mikegales.dev";
export const SUNO_EXPORT_CLUSTER_VERSION = "v1alpha1";
export const SUNO_EXPORT_CLUSTER_PLURAL = "sunoexportclusters";
export const SUNO_EXPORT_CLUSTER_KIND = "SunoExportCluster";

export const WORKER_ROLES = ["auth", "metadata", "asset", "conversion"] as const;
export type SunoExportWorkerRole = (typeof WORKER_ROLES)[number];

export interface SecretKeyRef {
  name: string;
  key: string;
}

export interface NamedSecretRefs {
  postgresUrlSecret: SecretKeyRef;
  mqttUrlSecret: SecretKeyRef;
}

export interface ImageSpec {
  repository: string;
  tag?: string;
  pullPolicy?: string;
}

export interface SharedStorageSpec {
  existingClaim: string;
  mountPath?: string;
}

export interface RuntimeSpec {
  cacheDir?: string;
  outputRoot?: string;
  libraryRoot?: string;
  databaseType?: string;
  metadataDatabase?: string;
  mqttTopicPrefix?: string;
  logFile?: string;
}

export interface ApiSpec {
  replicas?: number;
  host?: string;
  port?: number;
}

export interface WorkerReplicaSpec {
  replicas?: number;
}

export interface WorkersSpec {
  auth?: WorkerReplicaSpec;
  metadata?: WorkerReplicaSpec;
  asset?: WorkerReplicaSpec;
  conversion?: WorkerReplicaSpec;
}

export interface LibrarianWorkspaceSpec {
  workspace: string;
  schedule?: string;
  intervalMs?: number;
}

export interface LibrariansSpec {
  enabled?: boolean;
  dynamicDiscovery?: boolean;
  defaultSchedule?: string;
  defaultIntervalMs?: number;
  manualJobTtlSeconds?: number;
  workspaces?: LibrarianWorkspaceSpec[];
}

export interface SunoExportClusterSpec {
  image: ImageSpec;
  secrets: NamedSecretRefs;
  sharedStorage: SharedStorageSpec;
  runtime?: RuntimeSpec;
  api?: ApiSpec;
  workers?: WorkersSpec;
  librarians?: LibrariansSpec;
  serviceAccountName?: string;
}

export interface MetadataRef {
  name: string;
  namespace: string;
  uid?: string;
  generation?: number;
}

export interface NormalizedSunoExportCluster {
  metadata: MetadataRef;
  spec: Required<Omit<SunoExportClusterSpec, "workers" | "runtime" | "api" | "librarians">> & {
    runtime: Required<RuntimeSpec>;
    api: Required<ApiSpec>;
    workers: Record<SunoExportWorkerRole, Required<WorkerReplicaSpec>>;
    librarians: {
      enabled: boolean;
      dynamicDiscovery: boolean;
      defaultSchedule: string;
      defaultIntervalMs: number;
      manualJobTtlSeconds: number;
      workspaces: Array<Required<LibrarianWorkspaceSpec>>;
    };
  };
}

export interface SunoExportClusterResource {
  apiVersion: string;
  kind: string;
  metadata?: {
    name?: string;
    namespace?: string;
    uid?: string;
    generation?: number;
    [key: string]: unknown;
  };
  spec?: SunoExportClusterSpec;
  status?: Record<string, unknown>;
}

export interface OperatorRuntimeConfig {
  namespace?: string;
  pollIntervalMs: number;
  customResourceGroup: string;
  customResourceVersion: string;
  customResourcePlural: string;
}
