import {
  BatchV1Api,
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
  KubernetesObjectApi,
} from "@kubernetes/client-node";
import { createMetadataStore, resolveMetadataStoreConfig } from "../../metadata-store";
import { createControlPlaneRepository } from "../../core/orchestration";
import { getLibrarianSyncRequest } from "../../orchestration/librarian-sync-store";
import {
  buildClusterStatus,
  buildManagedResources,
  type ManualLibrarianSyncTrigger,
  type ManagedK8sResource,
  normalizeSunoExportCluster,
} from "./resource-builder";
import type {
  LibrarianWorkspaceSpec,
  NormalizedSunoExportCluster,
  OperatorRuntimeConfig,
  SecretKeyRef,
  SunoExportClusterResource,
} from "./types";

export class SunoExportK8sOperator {
  private readonly kubeConfig: KubeConfig;

  private readonly objectApi: KubernetesObjectApi;

  private readonly customObjectsApi: CustomObjectsApi;

  private readonly coreV1Api: CoreV1Api;

  private readonly batchV1Api: BatchV1Api;

  constructor(private readonly config: OperatorRuntimeConfig) {
    this.kubeConfig = new KubeConfig();
    this.kubeConfig.loadFromDefault();
    this.objectApi = KubernetesObjectApi.makeApiClient(this.kubeConfig);
    this.customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi);
    this.coreV1Api = this.kubeConfig.makeApiClient(CoreV1Api);
    this.batchV1Api = this.kubeConfig.makeApiClient(BatchV1Api);
  }

  async run(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      await this.reconcileAll();
      await delay(this.config.pollIntervalMs, signal);
    }
  }

  async reconcileAll(): Promise<void> {
    const resources = await this.listClusterResources();
    if (resources.length === 0) {
      console.log("[k8s-operator] no SunoExportCluster resources found");
      return;
    }
    for (const resource of resources) {
      try {
        const cluster = normalizeSunoExportCluster(resource);
        const postgresUrl = await this.resolveSecretValue(cluster.metadata.namespace, cluster.spec.secrets.postgresUrlSecret);
        cluster.spec.librarians.workspaces = await this.resolveDesiredLibrarianWorkspaces(cluster, postgresUrl);
        const manualState = await this.resolveManualLibrarianState(cluster, postgresUrl);
        const managedResources = buildManagedResources(
          cluster,
          manualState.triggersToCreate,
          Array.from(manualState.suspendedWorkspaceIds),
        );
        for (const managed of managedResources) {
          await this.upsertManagedResource(managed);
        }
        await this.pruneStaleLibrarianCronJobs(cluster);
        await this.updateClusterStatus(cluster.metadata.name, cluster.metadata.namespace, buildClusterStatus(cluster));
        console.log(`[k8s-operator] reconciled ${cluster.metadata.namespace}/${cluster.metadata.name}`);
      } catch (error) {
        const label = `${resource.metadata?.namespace ?? "default"}/${resource.metadata?.name ?? "unknown"}`;
        console.error(`[k8s-operator] failed to reconcile ${label}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  private async listClusterResources(): Promise<SunoExportClusterResource[]> {
    const response = this.config.namespace
      ? await this.customObjectsApi.listNamespacedCustomObject({
        group: this.config.customResourceGroup,
        version: this.config.customResourceVersion,
        namespace: this.config.namespace,
        plural: this.config.customResourcePlural,
      })
      : await this.customObjectsApi.listClusterCustomObject({
        group: this.config.customResourceGroup,
        version: this.config.customResourceVersion,
        plural: this.config.customResourcePlural,
      });

    const body = extractResponseBody<{ items?: SunoExportClusterResource[] }>(response);
    if (!body) {
      console.warn("[k8s-operator] failed to extract response body from listClusterCustomObject response");
      return [];
    }
    return Array.isArray(body?.items) ? body.items : [];
  }

  private async upsertManagedResource(resource: ManagedK8sResource): Promise<void> {
    try {
      const current = await this.objectApi.read(resource);
      if (resource.apiVersion === "batch/v1" && resource.kind === "Job") {
        return;
      }
      resource.metadata = {
        ...(resource.metadata ?? {}),
        resourceVersion: current.metadata?.resourceVersion,
      };
      await this.objectApi.replace(resource);
    } catch (error) {
      if (isNotFoundError(error)) {
        await this.objectApi.create(resource);
        return;
      }
      throw error;
    }
  }

  private async resolveDesiredLibrarianWorkspaces(
    cluster: NormalizedSunoExportCluster,
    postgresUrl: string,
  ): Promise<Array<Required<LibrarianWorkspaceSpec>>> {
    const configured = new Map(
      cluster.spec.librarians.workspaces.map((workspace) => [workspace.workspace, workspace]),
    );

    if (!cluster.spec.librarians.enabled || !cluster.spec.librarians.dynamicDiscovery) {
      return Array.from(configured.values());
    }

    if (cluster.spec.runtime.databaseType !== "postgres") {
      console.warn(
        `[k8s-operator] skipping dynamic librarian discovery for ${cluster.metadata.namespace}/${cluster.metadata.name}: metadata database type is ${cluster.spec.runtime.databaseType}`,
      );
      return Array.from(configured.values());
    }

    const store = await createMetadataStore(resolveMetadataStoreConfig({
      databaseType: "postgres",
      postgresUrl,
      database: cluster.spec.runtime.metadataDatabase,
    }));

    try {
      const workspaces = await store.listWorkspaces();
      for (const workspace of workspaces) {
        const workspaceId = workspace.id?.trim();
        if (!workspaceId || configured.has(workspaceId)) {
          continue;
        }
        configured.set(workspaceId, {
          workspace: workspaceId,
          intervalMs: cluster.spec.librarians.defaultIntervalMs,
          schedule: cluster.spec.librarians.defaultSchedule,
        });
      }
    } finally {
      await store.close();
    }

    return Array.from(configured.values()).sort((left, right) => left.workspace.localeCompare(right.workspace));
  }

  private async resolveManualLibrarianState(
    cluster: NormalizedSunoExportCluster,
    postgresUrl: string,
  ): Promise<{
    triggersToCreate: ManualLibrarianSyncTrigger[];
    suspendedWorkspaceIds: Set<string>;
  }> {
    if (!cluster.spec.librarians.enabled || cluster.spec.librarians.workspaces.length === 0) {
      return {
        triggersToCreate: [],
        suspendedWorkspaceIds: new Set<string>(),
      };
    }

    const repository = createControlPlaneRepository({ postgresUrl });
    try {
      await repository.initialize();
      const activeJobs = await this.listActiveManualLibrarianJobs(cluster.metadata.namespace, cluster.metadata.name);
      const triggersToCreate: ManualLibrarianSyncTrigger[] = [];
      const suspendedWorkspaceIds = new Set<string>();

      for (const workspace of cluster.spec.librarians.workspaces) {
        const request = await getLibrarianSyncRequest(repository, workspace.workspace);
        if (!request || (request.status !== "pending" && request.status !== "running")) {
          continue;
        }
        suspendedWorkspaceIds.add(workspace.workspace);
        if (!activeJobs.has(workspace.workspace)) {
          triggersToCreate.push({
            workspaceId: workspace.workspace,
            requestId: request.requestId,
          });
        }
      }

      return {
        triggersToCreate,
        suspendedWorkspaceIds,
      };
    } finally {
      await repository.close();
    }
  }

  private async pruneStaleLibrarianCronJobs(cluster: NormalizedSunoExportCluster): Promise<void> {
    const desiredNames = new Set(
      cluster.spec.librarians.enabled
        ? cluster.spec.librarians.workspaces.map((workspace) => getLibrarianCronJobName(cluster.metadata.name, workspace.workspace))
        : [],
    );
    const response = await this.batchV1Api.listNamespacedCronJob({
      namespace: cluster.metadata.namespace,
    });
    const items = extractResponseBody<{ items?: Array<{ metadata?: { name?: string } }> }>(response)?.items ?? [];

    for (const item of items) {
      const name = item.metadata?.name;
      if (!name || !name.startsWith(`${cluster.metadata.name}-librarian-`) || desiredNames.has(name)) {
        continue;
      }
      await this.batchV1Api.deleteNamespacedCronJob({
        namespace: cluster.metadata.namespace,
        name,
      });
    }
  }

  private async listActiveManualLibrarianJobs(
    namespace: string,
    clusterName: string,
  ): Promise<Set<string>> {
    const response = await this.batchV1Api.listNamespacedJob({
      namespace,
      labelSelector: [
        "app.kubernetes.io/managed-by=suno-export-k8s-operator",
        `app.kubernetes.io/instance=${clusterName}`,
        "suno-export/run-type=manual-librarian",
      ].join(","),
    });
    const items = extractResponseBody(response)?.items ?? [];

    const active = new Set<string>();
    for (const item of items) {
      const workspaceId = item.metadata?.annotations?.["suno-export/workspace-id"];
      if (!workspaceId) {
        continue;
      }
      const status = item.status;
      const finished = Boolean(status?.completionTime) || (status?.succeeded ?? 0) > 0 || (status?.failed ?? 0) > 0;
      if (!finished || (status?.active ?? 0) > 0) {
        active.add(workspaceId);
      }
    }
    return active;
  }

  private async resolveSecretValue(namespace: string, ref: SecretKeyRef): Promise<string> {
    const response = await this.coreV1Api.readNamespacedSecret({
      namespace,
      name: ref.name,
    });
    const secret = extractResponseBody<{ data?: Record<string, string> }>(response);
    const rawValue = secret?.data?.[ref.key];
    if (!rawValue) {
      throw new Error(`Secret ${namespace}/${ref.name} is missing key ${ref.key}`);
    }
    return Buffer.from(rawValue, "base64").toString("utf8").trim();
  }

  private async updateClusterStatus(
    name: string,
    namespace: string,
    status: Record<string, unknown>,
  ): Promise<void> {
    await this.customObjectsApi.patchNamespacedCustomObjectStatus({
      group: this.config.customResourceGroup,
      version: this.config.customResourceVersion,
      namespace,
      plural: this.config.customResourcePlural,
      name,
      body: [
        {
          op: "add",
          path: "/status",
          value: status,
        },
      ],
    });
  }
}

function extractResponseBody<T>(response: T | { body?: T }): T | undefined {
  if (response && typeof response === "object" && "body" in response) {
    return response.body;
  }
  return response as T | undefined;
}

function isNotFoundError(error: unknown): boolean {
  const candidate = error as {
    code?: number | string;
    statusCode?: number;
    status?: number;
    response?: { statusCode?: number; status?: number };
    body?: { code?: number; reason?: string };
    message?: string;
  } | undefined;

  const numericCode = typeof candidate?.code === "number"
    ? candidate.code
    : typeof candidate?.code === "string" && /^\d+$/.test(candidate.code)
      ? Number.parseInt(candidate.code, 10)
      : undefined;

  const statusCandidates = [
    candidate?.statusCode,
    candidate?.status,
    candidate?.response?.statusCode,
    candidate?.response?.status,
    candidate?.body?.code,
    numericCode,
  ];

  if (statusCandidates.some((value) => value === 404)) {
    return true;
  }

  if (candidate?.body?.reason === "NotFound") {
    return true;
  }

  return typeof candidate?.message === "string" && candidate.message.includes("HTTP-Code: 404");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error("Aborted"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function getLibrarianCronJobName(clusterName: string, workspaceId: string): string {
  return `${slugifyWorkspaceId(clusterName, 12)}-lib-${slugifyWorkspaceId(workspaceId, 20)}`;
}

function slugifyWorkspaceId(workspaceId: string, maxLength: number = 40): string {
  const normalized = workspaceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized.slice(0, maxLength) : "workspace";
}
