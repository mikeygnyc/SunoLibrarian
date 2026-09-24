# Local K8s Bootstrap

This repo keeps tracked example manifests under `k8s/base` and
`k8s/observability/elk`, while local cluster-specific manifests live under the
gitignored `k8s/local` tree.

## Generate Local Manifests

Run:

```bash
scripts/bootstrap-k8s-local.sh
```

The bootstrap requires runtime and (unless `--skip-elk` is used) Elasticsearch
credentials. For local use, copy the tracked template and fill it with your
own values:

```bash
cp scripts/pre-conf-bootstrap-k8s-local.env.example \
  scripts/pre-conf-bootstrap-k8s-local.env
scripts/pre-conf-bootstrap-k8s-local.sh --no-run
```

The local `.env` file is gitignored. Do not put credentials in shell scripts or
tracked manifests. You can instead set the same variables in your shell, or set
`SUNO_EXPORT_K8S_LOCAL_ENV_FILE` to an alternate local env-file path.

The generator is safe to rerun: it keeps existing files unless `--force` is
specified, and it does not duplicate generated kustomization resources.

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
ELK_ELASTICSEARCH_HOSTS='https://elasticsearch.example.internal:9200' \
ELK_ELASTICSEARCH_USERNAME='filebeat_suno_export' \
ELK_ELASTICSEARCH_PASSWORD='...' \
ELK_ELASTICSEARCH_ADMIN_USERNAME='elastic' \
ELK_ELASTICSEARCH_ADMIN_PASSWORD='...' \
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

[`scripts/redeploy-k8s-operator.sh`](../scripts/redeploy-k8s-operator.sh)
now expects `k8s/local` and `k8s/local/cluster` to exist already. If they do
not, it will tell you to run the bootstrap script first.
