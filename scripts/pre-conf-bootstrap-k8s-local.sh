#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SUNO_EXPORT_K8S_LOCAL_ENV_FILE:-${SCRIPT_DIR}/pre-conf-bootstrap-k8s-local.env}"

if [[ -f "$CONFIG_FILE" ]]; then
  # This file is intentionally local and gitignored. It must contain only shell
  # environment assignments; its values are passed to bootstrap-k8s-local.sh.
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
fi

log() {
  printf '[setup bootstrap-k8s-local] %s\n' "$*"
}

usage() {
  cat <<'EOF'
Usage: scripts/pre-conf-bootstrap-k8s-local.sh [options]

Creates a gitignored local kustomize tree under k8s/local from the tracked
example manifests.

Configuration is loaded from the current environment. If present, the wrapper
also loads scripts/pre-conf-bootstrap-k8s-local.env (or the file named by
SUNO_EXPORT_K8S_LOCAL_ENV_FILE). Copy the adjacent .env.example file to create
your local configuration; never commit real credentials.

Options:
  --force         Overwrite any existing generated files
  --skip-elk      Do not generate k8s/local/observability/elk
  --no-run        Do not execute any kubectl commands, just print what would be done
  --help          Show this help

Environment overrides:
  NAMESPACE
  CLUSTER_NAME
  IMAGE_REPO
  IMAGE_TAG
  RUNTIME_POSTGRES_URL
  RUNTIME_MQTT_URL
  ELK_ELASTICSEARCH_HOSTS
  ELK_ELASTICSEARCH_USERNAME
  ELK_ELASTICSEARCH_PASSWORD
  ELK_ELASTICSEARCH_ADMIN_USERNAME
  ELK_ELASTICSEARCH_ADMIN_PASSWORD
  ELK_ELASTICSEARCH_CA_CERT
  ELK_ENVIRONMENT
  SUNO_EXPORT_K8S_LOCAL_ENV_FILE
EOF
}
exec "${SCRIPT_DIR}/bootstrap-k8s-local.sh" "$@"
