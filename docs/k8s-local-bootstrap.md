# Local K8s Bootstrap

This repo keeps tracked example manifests under `k8s/base` and
`k8s/observability/elk`, while local cluster-specific manifests live under the
gitignored `k8s/local` tree.

## Generate Local Manifests

Run:

```bash
scripts/bootstrap-k8s-local.sh
```

That creates:

- `k8s/local`
- `k8s/local/cluster`
- `k8s/local/observability/elk`

with real filenames such as:

- `runtime-secret.yaml`
- `sunoexportcluster.yaml`
- `secret.yaml`

## Useful Overrides

You can customize generated values with env vars:

```bash
NAMESPACE=suno-export \
CLUSTER_NAME=main \
IMAGE_REPO=ghcr.io/mikeygnyc/suno-export \
IMAGE_TAG=latest \
RUNTIME_POSTGRES_URL='postgres://...' \
RUNTIME_MQTT_URL='mqtt://...' \
ELK_LOGSTASH_HOSTS='logstash.logging.svc.cluster.local:5044' \
ELK_ENVIRONMENT=local \
scripts/bootstrap-k8s-local.sh --force
```

## Apply

```bash
kubectl apply -k k8s/local
kubectl apply -k k8s/local/cluster
kubectl apply -k k8s/local/observability/elk
```

## Teardown

To remove the full local k8s install, including the operator, `SunoExportCluster`
resources, optional ELK/Filebeat objects, namespace-scoped secrets/PVCs, and
cluster-scoped RBAC/CRD objects, run:

```bash
scripts/remove-k8s-resources.sh
```

Useful options:

```bash
scripts/remove-k8s-resources.sh --keep-namespace --keep-crd
```

## Redeploy Script

[`scripts/redeploy-k8s-operator.sh`](./scripts/redeploy-k8s-operator.sh:1)
now expects `k8s/local` and `k8s/local/cluster` to exist already. If they do
not, it will tell you to run the bootstrap script first.
