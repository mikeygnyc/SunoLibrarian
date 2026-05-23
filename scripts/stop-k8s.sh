#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

NAMESPACE="${NAMESPACE:-suno-export}"
CLUSTER_NAME="${CLUSTER_NAME:-main}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/mikeygnyc/suno-export}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE_REF="${IMAGE_REPO}:${IMAGE_TAG}"
OPERATOR_DEPLOYMENT="${OPERATOR_DEPLOYMENT:-suno-export-k8s-operator}"
OPERATOR_MANIFEST_DIR="${OPERATOR_MANIFEST_DIR:-k8s/local}"
CLUSTER_MANIFEST_DIR="${CLUSTER_MANIFEST_DIR:-k8s/local/cluster}"
WAIT_SECONDS="${WAIT_SECONDS:-180}"
SKIP_IMAGE_LOAD="${SKIP_IMAGE_LOAD:-0}"

log() {
  printf '[stop-k8s-operator] %s\n' "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

wait_for_managed_workloads_to_clear() {
  local deadline
  deadline=$((SECONDS + WAIT_SECONDS))

  while (( SECONDS < deadline )); do
    local deployment_count pod_count
    deployment_count="$(
      kubectl -n "${NAMESPACE}" get deploy \
        -l "app.kubernetes.io/managed-by=suno-export-k8s-operator,app.kubernetes.io/instance=${CLUSTER_NAME}" \
        --no-headers 2>/dev/null | wc -l | tr -d ' '
    )"
    pod_count="$(
      kubectl -n "${NAMESPACE}" get pods \
        -l "app.kubernetes.io/managed-by=suno-export-k8s-operator,app.kubernetes.io/instance=${CLUSTER_NAME}" \
        --no-headers 2>/dev/null | wc -l | tr -d ' '
    )"

    if [[ "${deployment_count}" == "0" && "${pod_count}" == "0" ]]; then
      return 0
    fi

    sleep 2
  done

  return 1
}

delete_lingering_managed_resources() {
  kubectl -n "${NAMESPACE}" delete deploy,svc,configmap,sa,pods \
    -l "app.kubernetes.io/managed-by=suno-export-k8s-operator,app.kubernetes.io/instance=${CLUSTER_NAME}" \
    --ignore-not-found >/dev/null 2>&1 || true
}



main() {
  require_command docker
  require_command kubectl

  cd "${REPO_ROOT}"

  log "Deleting SunoExportCluster ${CLUSTER_NAME} in namespace ${NAMESPACE}"
  kubectl -n "${NAMESPACE}" delete sunoexportcluster "${CLUSTER_NAME}" --ignore-not-found >/dev/null 2>&1 || true

  if ! wait_for_managed_workloads_to_clear; then
    log "Managed workloads did not disappear in time; deleting lingering operator-managed resources directly"
    delete_lingering_managed_resources
  fi

  log "Shutdown complete"
}

main "$@"
