import type { KubernetesObject } from "@kubernetes/client-node";
import {
  type LibrarianWorkspaceSpec,
  type NormalizedSunoExportCluster,
  type SunoExportClusterResource,
  type SunoExportWorkerRole,
  WORKER_ROLES,
} from "./types";

const DEFAULT_API_PORT = 3000;
const DEFAULT_HEALTH_PORT = 8080;
const DEFAULT_MOUNT_PATH = "/var/lib/suno-export";
const DEFAULT_LIBRARIAN_INTERVAL_MS = 21_600_000;
const DEFAULT_LIBRARIAN_SCHEDULE = "0 */6 * * *";
const DEFAULT_LIBRARIAN_MANUAL_JOB_TTL_SECONDS = 3600;

export type ManagedK8sResource = KubernetesObject & Record<string, unknown> & {
  metadata: Record<string, unknown> & {
    name: string;
    namespace: string;
  };
};

export interface ManualLibrarianSyncTrigger {
  workspaceId: string;
  requestId: string;
}

export function normalizeSunoExportCluster(
  resource: SunoExportClusterResource,
): NormalizedSunoExportCluster {
  const name = resource.metadata?.name?.trim();
  const namespace = resource.metadata?.namespace?.trim();
  const spec = resource.spec;

  if (!name) {
    throw new Error("SunoExportCluster metadata.name is required");
  }
  if (!namespace) {
    throw new Error(`SunoExportCluster ${name} must be namespaced`);
  }
  if (!spec?.image?.repository?.trim()) {
    throw new Error(`SunoExportCluster ${namespace}/${name} requires spec.image.repository`);
  }
  if (!spec.secrets?.postgresUrlSecret?.name || !spec.secrets?.postgresUrlSecret?.key) {
    throw new Error(`SunoExportCluster ${namespace}/${name} requires spec.secrets.postgresUrlSecret`);
  }
  if (!spec.secrets?.mqttUrlSecret?.name || !spec.secrets?.mqttUrlSecret?.key) {
    throw new Error(`SunoExportCluster ${namespace}/${name} requires spec.secrets.mqttUrlSecret`);
  }
  if (!spec.sharedStorage?.existingClaim?.trim()) {
    throw new Error(`SunoExportCluster ${namespace}/${name} requires spec.sharedStorage.existingClaim`);
  }

  const mountPath = spec.sharedStorage.mountPath?.trim() || DEFAULT_MOUNT_PATH;

  return {
    metadata: {
      name,
      namespace,
      uid: resource.metadata?.uid,
      generation: resource.metadata?.generation,
    },
    spec: {
      image: {
        repository: spec.image.repository.trim(),
        tag: spec.image.tag?.trim() || "latest",
        pullPolicy: spec.image.pullPolicy?.trim() || "IfNotPresent",
      },
      secrets: spec.secrets,
      sharedStorage: {
        existingClaim: spec.sharedStorage.existingClaim.trim(),
        mountPath,
      },
      runtime: {
        cacheDir: spec.runtime?.cacheDir?.trim() || `${mountPath}/cache`,
        outputRoot: spec.runtime?.outputRoot?.trim() || `${mountPath}/downloads`,
        libraryRoot: spec.runtime?.libraryRoot?.trim() || `${mountPath}/library`,
        databaseType: spec.runtime?.databaseType?.trim() || "postgres",
        metadataDatabase: spec.runtime?.metadataDatabase?.trim() || "",
        mqttTopicPrefix: spec.runtime?.mqttTopicPrefix?.trim() || "suno-export/control-plane",
        logFile: spec.runtime?.logFile?.trim() || `${mountPath}/logs/http-api.log`,
      },
      api: {
        replicas: sanitizeReplicaCount(spec.api?.replicas, 1),
        host: spec.api?.host?.trim() || "0.0.0.0",
        port: sanitizePort(spec.api?.port, DEFAULT_API_PORT),
      },
      workers: {
        auth: { replicas: sanitizeReplicaCount(spec.workers?.auth?.replicas, 1) },
        metadata: { replicas: sanitizeReplicaCount(spec.workers?.metadata?.replicas, 1) },
        asset: { replicas: sanitizeReplicaCount(spec.workers?.asset?.replicas, 1) },
        conversion: { replicas: sanitizeReplicaCount(spec.workers?.conversion?.replicas, 2) },
      },
      librarians: {
        enabled: spec.librarians?.enabled !== false,
        dynamicDiscovery: spec.librarians?.dynamicDiscovery === true,
        defaultIntervalMs: sanitizePositiveInteger(spec.librarians?.defaultIntervalMs, DEFAULT_LIBRARIAN_INTERVAL_MS),
        defaultSchedule: sanitizeCronSchedule(
          spec.librarians?.defaultSchedule,
          intervalMsToCronSchedule(
            sanitizePositiveInteger(spec.librarians?.defaultIntervalMs, DEFAULT_LIBRARIAN_INTERVAL_MS),
            DEFAULT_LIBRARIAN_SCHEDULE,
          ),
        ),
        manualJobTtlSeconds: sanitizePositiveInteger(
          spec.librarians?.manualJobTtlSeconds,
          DEFAULT_LIBRARIAN_MANUAL_JOB_TTL_SECONDS,
        ),
        workspaces: normalizeLibrarianWorkspaces(spec.librarians?.workspaces),
      },
      serviceAccountName: spec.serviceAccountName?.trim() || `${name}-runtime`,
    },
  };
}

export function buildManagedResources(
  cluster: NormalizedSunoExportCluster,
  manualTriggers: ManualLibrarianSyncTrigger[] = [],
  suspendedWorkspaceIds: string[] = [],
): ManagedK8sResource[] {
  const resources: ManagedK8sResource[] = [];
  resources.push(buildServiceAccount(cluster));
  resources.push(buildRuntimeConfigMap(cluster));
  resources.push(buildApiService(cluster));
  resources.push(buildApiDeployment(cluster));

  for (const role of WORKER_ROLES) {
    resources.push(buildWorkerDeployment(cluster, role));
  }

  const triggerMap = new Map(manualTriggers.map((trigger) => [trigger.workspaceId, trigger]));
  const suspendedWorkspaces = new Set(suspendedWorkspaceIds);
  if (cluster.spec.librarians.enabled) {
    for (const workspace of cluster.spec.librarians.workspaces) {
      resources.push(buildLibrarianCronJob(cluster, workspace, suspendedWorkspaces.has(workspace.workspace)));
      const trigger = triggerMap.get(workspace.workspace);
      if (trigger) {
        resources.push(buildManualLibrarianJob(cluster, workspace, trigger));
      }
    }
  }

  return resources;
}

export function buildClusterStatus(cluster: NormalizedSunoExportCluster): Record<string, unknown> {
  const apiServiceName = getApiServiceName(cluster);
  return {
    observedGeneration: cluster.metadata.generation,
    phase: "Ready",
    endpoint: `http://${apiServiceName}.${cluster.metadata.namespace}.svc.cluster.local:${cluster.spec.api.port}`,
    image: renderImage(cluster),
    workerReplicas: Object.fromEntries(
      WORKER_ROLES.map((role) => [role, cluster.spec.workers[role].replicas]),
    ),
    librarianEnabled: cluster.spec.librarians.enabled,
    librarianDynamicDiscovery: cluster.spec.librarians.dynamicDiscovery,
    librarianWorkspaces: cluster.spec.librarians.workspaces.map((workspace) => workspace.workspace),
    sharedStorageClaim: cluster.spec.sharedStorage.existingClaim,
    lastReconciledAt: new Date().toISOString(),
  };
}

function buildServiceAccount(cluster: NormalizedSunoExportCluster): ManagedK8sResource {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: withOwnerMetadata(cluster, cluster.spec.serviceAccountName),
  };
}

function buildRuntimeConfigMap(cluster: NormalizedSunoExportCluster): ManagedK8sResource {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: withOwnerMetadata(cluster, getRuntimeConfigMapName(cluster)),
    data: {
      SUNO_EXPORT_CACHE_DIR: cluster.spec.runtime.cacheDir,
      SUNO_EXPORT_CONTROL_PLANE_MQTT_TOPIC_PREFIX: cluster.spec.runtime.mqttTopicPrefix,
      SUNO_EXPORT_METADATA_DATABASE_TYPE: cluster.spec.runtime.databaseType,
      SUNO_EXPORT_METADATA_DATABASE: cluster.spec.runtime.metadataDatabase,
      SUNO_EXPORT_OUTPUT_ROOT: cluster.spec.runtime.outputRoot,
      SUNO_EXPORT_LIBRARY_ROOT: cluster.spec.runtime.libraryRoot,
      SUNO_EXPORT_API_HOST: cluster.spec.api.host,
      SUNO_EXPORT_API_PORT: String(cluster.spec.api.port),
      SUNO_EXPORT_LOG_FILE: cluster.spec.runtime.logFile,
    },
  };
}

function buildApiService(cluster: NormalizedSunoExportCluster): ManagedK8sResource {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: withOwnerMetadata(cluster, getApiServiceName(cluster)),
    spec: {
      selector: componentLabels(cluster, "api"),
      ports: [
        {
          name: "http",
          port: cluster.spec.api.port,
          targetPort: cluster.spec.api.port,
        },
      ],
    },
  };
}

function buildApiDeployment(cluster: NormalizedSunoExportCluster): ManagedK8sResource {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: withOwnerMetadata(cluster, getApiDeploymentName(cluster)),
    spec: {
      replicas: cluster.spec.api.replicas,
      selector: {
        matchLabels: componentLabels(cluster, "api"),
      },
      template: {
        metadata: {
          labels: componentLabels(cluster, "api"),
        },
        spec: {
          serviceAccountName: cluster.spec.serviceAccountName,
          securityContext: podSecurityContext(),
          containers: [
            {
              name: "api",
              image: renderImage(cluster),
              imagePullPolicy: cluster.spec.image.pullPolicy,
              command: ["node", "/app/dist/apps/api/main.js"],
              securityContext: containerSecurityContext(),
              envFrom: [
                {
                  configMapRef: {
                    name: getRuntimeConfigMapName(cluster),
                  },
                },
              ],
              env: [
                buildSecretEnv("SUNO_EXPORT_CONTROL_PLANE_POSTGRES_URL", cluster.spec.secrets.postgresUrlSecret.name, cluster.spec.secrets.postgresUrlSecret.key),
                buildSecretEnv("SUNO_EXPORT_CONTROL_PLANE_MQTT_URL", cluster.spec.secrets.mqttUrlSecret.name, cluster.spec.secrets.mqttUrlSecret.key),
                {
                  name: "SUNO_EXPORT_APP",
                  value: "api",
                },
              ],
              ports: [
                {
                  name: "http",
                  containerPort: cluster.spec.api.port,
                },
              ],
              volumeMounts: sharedVolumeMounts(cluster),
              readinessProbe: {
                httpGet: {
                  path: "/healthz",
                  port: cluster.spec.api.port,
                },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              livenessProbe: {
                httpGet: {
                  path: "/healthz",
                  port: cluster.spec.api.port,
                },
                initialDelaySeconds: 15,
                periodSeconds: 20,
              },
            },
          ],
          volumes: sharedVolumes(cluster),
        },
      },
    },
  };
}

function buildWorkerDeployment(
  cluster: NormalizedSunoExportCluster,
  role: SunoExportWorkerRole,
): ManagedK8sResource {
  const component = `worker-${role}`;
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: withOwnerMetadata(cluster, getWorkerDeploymentName(cluster, role)),
    spec: {
      replicas: cluster.spec.workers[role].replicas,
      selector: {
        matchLabels: componentLabels(cluster, component),
      },
      template: {
        metadata: {
          labels: componentLabels(cluster, component),
        },
        spec: {
          serviceAccountName: cluster.spec.serviceAccountName,
          securityContext: podSecurityContext(),
          containers: [
            {
              name: component,
              image: renderImage(cluster),
              imagePullPolicy: cluster.spec.image.pullPolicy,
              command: ["node", "/app/dist/apps/worker/main.js"],
              securityContext: containerSecurityContext(),
              envFrom: [
                {
                  configMapRef: {
                    name: getRuntimeConfigMapName(cluster),
                  },
                },
              ],
              env: [
                buildSecretEnv("SUNO_EXPORT_CONTROL_PLANE_POSTGRES_URL", cluster.spec.secrets.postgresUrlSecret.name, cluster.spec.secrets.postgresUrlSecret.key),
                buildSecretEnv("SUNO_EXPORT_CONTROL_PLANE_MQTT_URL", cluster.spec.secrets.mqttUrlSecret.name, cluster.spec.secrets.mqttUrlSecret.key),
                {
                  name: "SUNO_EXPORT_APP",
                  value: "worker",
                },
                {
                  name: "SUNO_EXPORT_WORKER_ROLE",
                  value: role,
                },
                {
                  name: "SUNO_EXPORT_HEALTH_HOST",
                  value: "0.0.0.0",
                },
                {
                  name: "SUNO_EXPORT_HEALTH_PORT",
                  value: String(DEFAULT_HEALTH_PORT),
                },
              ],
              ports: [
                {
                  name: "health",
                  containerPort: DEFAULT_HEALTH_PORT,
                },
              ],
              volumeMounts: sharedVolumeMounts(cluster),
              readinessProbe: {
                httpGet: {
                  path: "/healthz",
                  port: DEFAULT_HEALTH_PORT,
                },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              livenessProbe: {
                httpGet: {
                  path: "/healthz",
                  port: DEFAULT_HEALTH_PORT,
                },
                initialDelaySeconds: 15,
                periodSeconds: 20,
              },
            },
          ],
          volumes: sharedVolumes(cluster),
        },
      },
    },
  };
}

function buildLibrarianCronJob(
  cluster: NormalizedSunoExportCluster,
  workspace: Required<LibrarianWorkspaceSpec>,
  suspended: boolean,
): ManagedK8sResource {
  const workspaceSlug = slugifyWorkspaceId(workspace.workspace, 20);
  const component = `librarian-${workspaceSlug}`;

  return {
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: withOwnerMetadata(cluster, getLibrarianCronJobName(cluster, workspace.workspace)),
    spec: {
      schedule: workspace.schedule,
      suspend: suspended,
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 1,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          ttlSecondsAfterFinished: cluster.spec.librarians.manualJobTtlSeconds,
          backoffLimit: 1,
          template: buildLibrarianPodTemplate(cluster, component, workspace, false),
        },
      },
    },
  };
}

function buildManualLibrarianJob(
  cluster: NormalizedSunoExportCluster,
  workspace: Required<LibrarianWorkspaceSpec>,
  trigger: ManualLibrarianSyncTrigger,
): ManagedK8sResource {
  const workspaceSlug = slugifyWorkspaceId(workspace.workspace, 20);
  const component = `lib-man-${workspaceSlug}`;
  const manualJobName = buildManualLibrarianJobName(cluster.metadata.name, workspace.workspace, trigger.requestId);

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      ...withOwnerMetadata(cluster, manualJobName),
      labels: {
        ...componentLabels(cluster, component),
        "suno-export/workspace-slug": workspaceSlug,
        "suno-export/run-type": "manual-librarian",
      },
      annotations: {
        "suno-export/workspace-id": workspace.workspace,
        "suno-export/request-id": trigger.requestId,
      },
    },
    spec: {
      ttlSecondsAfterFinished: cluster.spec.librarians.manualJobTtlSeconds,
      backoffLimit: 1,
      template: buildLibrarianPodTemplate(cluster, component, workspace, true),
    },
  };
}

function componentLabels(cluster: NormalizedSunoExportCluster, component: string): Record<string, string> {
  return {
    "app.kubernetes.io/name": "suno-export",
    "app.kubernetes.io/instance": cluster.metadata.name,
    "app.kubernetes.io/component": component,
    "app.kubernetes.io/managed-by": "suno-export-k8s-operator",
  };
}

function withOwnerMetadata(
  cluster: NormalizedSunoExportCluster,
  name: string,
): ManagedK8sResource["metadata"] {
  return {
    name,
    namespace: cluster.metadata.namespace,
    labels: componentLabels(cluster, "runtime"),
    ownerReferences: cluster.metadata.uid
      ? [
        {
          apiVersion: "suno.mikegales.dev/v1alpha1",
          kind: "SunoExportCluster",
          name: cluster.metadata.name,
          uid: cluster.metadata.uid,
          controller: true,
          blockOwnerDeletion: true,
        },
      ]
      : undefined,
  };
}

function sharedVolumeMounts(cluster: NormalizedSunoExportCluster): Array<Record<string, unknown>> {
  return [
    {
      name: "shared-storage",
      mountPath: cluster.spec.sharedStorage.mountPath,
    },
    {
      name: "tmp",
      mountPath: "/tmp",
    },
  ];
}

function sharedVolumes(cluster: NormalizedSunoExportCluster): Array<Record<string, unknown>> {
  return [
    {
      name: "shared-storage",
      persistentVolumeClaim: {
        claimName: cluster.spec.sharedStorage.existingClaim,
      },
    },
    {
      name: "tmp",
      emptyDir: {},
    },
  ];
}

function buildSecretEnv(name: string, secretName: string, secretKey: string): Record<string, unknown> {
  return {
    name,
    valueFrom: {
      secretKeyRef: {
        name: secretName,
        key: secretKey,
      },
    },
  };
}

function podSecurityContext(): Record<string, unknown> {
  return {
    runAsNonRoot: true,
    runAsUser: 999,
    runAsGroup: 999,
    seccompProfile: {
      type: "RuntimeDefault",
    },
  };
}

function containerSecurityContext(): Record<string, unknown> {
  return {
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: true,
    capabilities: {
      drop: ["ALL"],
    },
  };
}

function buildLibrarianPodTemplate(
  cluster: NormalizedSunoExportCluster,
  component: string,
  workspace: Required<LibrarianWorkspaceSpec>,
  manual: boolean,
): Record<string, unknown> {
  const labels: Record<string, string> = {
    ...componentLabels(cluster, component),
    "suno-export/workspace-slug": slugifyWorkspaceId(workspace.workspace, 20),
  };

  if (manual) {
    labels["suno-export/run-type"] = "manual-librarian";
  }

  return {
    metadata: {
      labels,
      annotations: {
        "suno-export/workspace-id": workspace.workspace,
      },
    },
    spec: {
      restartPolicy: "Never",
      serviceAccountName: cluster.spec.serviceAccountName,
      securityContext: podSecurityContext(),
      containers: [
        {
          name: component,
          image: renderImage(cluster),
          imagePullPolicy: cluster.spec.image.pullPolicy,
          command: ["node", "/app/dist/apps/librarian/main.js", "--once"],
          securityContext: containerSecurityContext(),
          envFrom: [
            {
              configMapRef: {
                name: getRuntimeConfigMapName(cluster),
              },
            },
          ],
          env: [
            buildSecretEnv("SUNO_EXPORT_CONTROL_PLANE_POSTGRES_URL", cluster.spec.secrets.postgresUrlSecret.name, cluster.spec.secrets.postgresUrlSecret.key),
            buildSecretEnv("SUNO_EXPORT_CONTROL_PLANE_MQTT_URL", cluster.spec.secrets.mqttUrlSecret.name, cluster.spec.secrets.mqttUrlSecret.key),
            {
              name: "SUNO_EXPORT_APP",
              value: "librarian",
            },
            {
              name: "SUNO_EXPORT_LIBRARIAN_WORKSPACE",
              value: workspace.workspace,
            },
            {
              name: "SUNO_EXPORT_LIBRARIAN_INTERVAL_MS",
              value: String(workspace.intervalMs),
            },
          ],
          volumeMounts: sharedVolumeMounts(cluster),
        },
      ],
      volumes: sharedVolumes(cluster),
    },
  };
}

function renderImage(cluster: NormalizedSunoExportCluster): string {
  return `${cluster.spec.image.repository}:${cluster.spec.image.tag}`;
}

function sanitizeReplicaCount(value: number | undefined, fallback: number): number {
  if (value == null) {
    return fallback;
  }
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function sanitizePort(value: number | undefined, fallback: number): number {
  if (value == null) {
    return fallback;
  }
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizeLibrarianWorkspaces(
  workspaces: LibrarianWorkspaceSpec[] | undefined,
): Array<Required<LibrarianWorkspaceSpec>> {
  if (!Array.isArray(workspaces)) {
    return [];
  }

  const normalized = new Map<string, Required<LibrarianWorkspaceSpec>>();
  for (const workspace of workspaces) {
    const workspaceId = workspace.workspace?.trim();
    if (!workspaceId) {
      continue;
    }
    normalized.set(workspaceId, {
      workspace: workspaceId,
      schedule: sanitizeCronSchedule(
        workspace.schedule,
        intervalMsToCronSchedule(
          sanitizePositiveInteger(workspace.intervalMs, DEFAULT_LIBRARIAN_INTERVAL_MS),
          DEFAULT_LIBRARIAN_SCHEDULE,
        ),
      ),
      intervalMs: sanitizePositiveInteger(workspace.intervalMs, DEFAULT_LIBRARIAN_INTERVAL_MS),
    });
  }

  return Array.from(normalized.values());
}

function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value == null) {
    return fallback;
  }
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sanitizeCronSchedule(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function intervalMsToCronSchedule(intervalMs: number, fallback: string): string {
  const totalMinutes = Math.floor(intervalMs / 60_000);
  if (totalMinutes <= 0) {
    return fallback;
  }
  if (totalMinutes % (24 * 60) === 0) {
    const days = totalMinutes / (24 * 60);
    if (days === 1) {
      return "0 0 * * *";
    }
  }
  if (totalMinutes % 60 === 0) {
    const hours = totalMinutes / 60;
    if (hours >= 1 && hours <= 23) {
      return `0 */${hours} * * *`;
    }
  }
  if (totalMinutes >= 1 && totalMinutes <= 59) {
    return `*/${totalMinutes} * * * *`;
  }
  return fallback;
}

function getRuntimeConfigMapName(cluster: NormalizedSunoExportCluster): string {
  return `${cluster.metadata.name}-runtime`;
}

function getApiServiceName(cluster: NormalizedSunoExportCluster): string {
  return `${cluster.metadata.name}-api`;
}

function getApiDeploymentName(cluster: NormalizedSunoExportCluster): string {
  return `${cluster.metadata.name}-api`;
}

function getWorkerDeploymentName(
  cluster: NormalizedSunoExportCluster,
  role: SunoExportWorkerRole,
): string {
  return `${cluster.metadata.name}-worker-${role}`;
}

function getLibrarianCronJobName(
  cluster: NormalizedSunoExportCluster,
  workspaceId: string,
): string {
  return buildLibrarianCronJobName(cluster.metadata.name, workspaceId);
}

function buildLibrarianCronJobName(clusterName: string, workspaceId: string): string {
  return `${slugifyWorkspaceId(clusterName, 12)}-lib-${slugifyWorkspaceId(workspaceId, 20)}`;
}

function buildManualLibrarianJobName(clusterName: string, workspaceId: string, requestId: string): string {
  return `${slugifyWorkspaceId(clusterName, 12)}-libm-${slugifyWorkspaceId(workspaceId, 16)}-${slugifyRequestId(requestId, 8)}`;
}

function slugifyRequestId(requestId: string, maxLength: number = 20): string {
  const normalized = requestId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized.slice(-maxLength) : "request";
}

function slugifyWorkspaceId(workspaceId: string, maxLength: number = 40): string {
  const normalized = workspaceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized.slice(0, maxLength) : "workspace";
}
