# Kubernetes Operator

This repository now includes an initial Kubernetes deployment model built
around a namespaced `SunoExportCluster` custom resource and a lightweight
operator process.

## What The Operator Owns

The operator reconciles deployment infrastructure only:

- runtime `ServiceAccount`
- shared runtime `ConfigMap`
- API `Service`
- API `Deployment`
- worker `Deployment`s for `auth`, `metadata`, `asset`, and `conversion`
- workspace-discovered librarian `CronJob`s
- ad hoc librarian `Job`s for manual wakeups

It does not replace the existing workflow control plane. Postgres and MQTT
remain the source of truth for job state and worker dispatch.

## Container Standard

The project now builds one runtime image from the repo root `Dockerfile`.
Runtime roles are selected with `SUNO_EXPORT_APP`:

- `cli`
- `api`
- `operator-cli`
- `k8s-operator`
- `worker`
- `librarian`

The repo also now includes a GitHub Actions workflow at
[.github/workflows/container-image.yml](/Users/mikegales/Projects/SunoTrackExporter/.github/workflows/container-image.yml:1)
that builds the image on pull requests and publishes it to
`ghcr.io/<owner>/suno-export` on pushes to `main` and version tags.

The runtime apps also support environment-based configuration for the main k8s
paths:

- `SUNO_EXPORT_CONTROL_PLANE_POSTGRES_URL`
- `SUNO_EXPORT_CONTROL_PLANE_MQTT_URL`
- `SUNO_EXPORT_CONTROL_PLANE_MQTT_TOPIC_PREFIX`
- `SUNO_EXPORT_OUTPUT_ROOT`
- `SUNO_EXPORT_LIBRARY_ROOT`
- `SUNO_EXPORT_CACHE_DIR`
- `SUNO_EXPORT_API_HOST`
- `SUNO_EXPORT_API_PORT`
- `SUNO_EXPORT_WORKER_ROLE`
- `SUNO_EXPORT_HEALTH_HOST`
- `SUNO_EXPORT_HEALTH_PORT`

## Manifests

Base manifests live under [k8s/base](/Users/mikegales/Projects/SunoTrackExporter/k8s/base):

- `crd-sunoexportcluster.yaml`
- `operator-deployment.yaml`
- `shared-storage-pvc.yaml`
- `runtime-secret.example.yaml`
- `cluster/sunoexportcluster.example.yaml`

## Example Rollout

Build and push an image:

```bash
docker build -t ghcr.io/mikeygnyc/suno-export:latest .
docker push ghcr.io/mikeygnyc/suno-export:latest
```

Or rely on the GitHub Actions publish flow and reference the resulting GHCR
image in the `SunoExportCluster` spec.

Apply the base manifests first:

```bash
kubectl apply -k k8s/base
```

Wait for the CRD to register, then apply a `SunoExportCluster`:

```bash
kubectl wait --for=condition=Established crd/sunoexportclusters.suno.mikegales.dev
kubectl apply -k k8s/base/cluster
```

Check the operator:

```bash
kubectl -n suno-export get pods
kubectl -n suno-export logs deploy/suno-export-k8s-operator
kubectl -n suno-export get sunoexportclusters
```

Once reconciled, the operator creates:

- `main-api` Service and Deployment
- `main-worker-auth` Deployment
- `main-worker-metadata` Deployment
- `main-worker-asset` Deployment
- `main-worker-conversion` Deployment
- one `main-librarian-<workspace>` CronJob per discovered/configured workspace

## Librarian Workspaces

Librarians can now be discovered dynamically from the metadata store:

```yaml
spec:
  librarians:
    enabled: true
    dynamicDiscovery: true
    defaultIntervalMs: 21600000
    defaultSchedule: "0 */6 * * *"
    manualJobTtlSeconds: 3600
```

The operator uses the Postgres-backed metadata store to discover known
workspaces after initial download/metadata activity has populated them. For
each workspace it creates a `CronJob` that runs the librarian app with
`--once`.

When a manual sync request is pending for a workspace, the operator:

- creates a one-off librarian `Job`
- temporarily suspends the workspace `CronJob`
- lets the `CronJob` resume on the next reconcile once the ad hoc job is no
  longer active

You can still pin extra static workspaces if needed:

```yaml
spec:
  librarians:
    enabled: true
    dynamicDiscovery: true
    workspaces:
      - workspace: important-workspace-id
        schedule: "15 * * * *"
```

## Current Assumptions

- Postgres and MQTT are provided outside this base bundle
- shared storage is an existing RWX-compatible PVC
- auth token capture remains an operator workflow outside the cluster
- the operator is intentionally polling-based for now to keep the first pass
  simple and easy to debug
