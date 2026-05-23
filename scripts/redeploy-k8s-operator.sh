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
  printf '[redeploy-k8s-operator] %s\n' "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_path() {
  if [[ ! -e "$1" ]]; then
    printf 'Missing required path: %s\n' "$1" >&2
    printf 'Generate local manifests first with: scripts/bootstrap-k8s-local.sh\n' >&2
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

load_image_into_cluster() {
  if [[ "${SKIP_IMAGE_LOAD}" == "1" ]]; then
    log "Skipping cluster image load because SKIP_IMAGE_LOAD=1"
    return 0
  fi

  local context
  context="$(kubectl config current-context 2>/dev/null || true)"

  if [[ -z "${context}" ]]; then
    log "No current kubectl context found; skipping cluster image load"
    return 0
  fi

  case "${context}" in
    kind-*)
      if command -v kind >/dev/null 2>&1; then
        log "Loading ${IMAGE_REF} into kind cluster ${context#kind-}"
        kind load docker-image "${IMAGE_REF}" --name "${context#kind-}"
        return 0
      fi
      ;;
    minikube)
      if command -v minikube >/dev/null 2>&1; then
        log "Loading ${IMAGE_REF} into minikube"
        minikube image load "${IMAGE_REF}"
        return 0
      fi
      ;;
    k3d-*)
      if command -v k3d >/dev/null 2>&1; then
        log "Importing ${IMAGE_REF} into k3d cluster ${context#k3d-}"
        k3d image import "${IMAGE_REF}" -c "${context#k3d-}"
        return 0
      fi
      ;;
    docker-desktop|rancher-desktop|desktop-linux)
      log "Current context ${context} usually shares the local Docker image store; skipping explicit image load"
      return 0
      ;;
  esac

  log "No automatic image loader configured for kubectl context ${context}; if your cluster does not share the local Docker daemon, load ${IMAGE_REF} manually"
}

main() {
  require_command docker
  require_command kubectl
  require_path "${REPO_ROOT}/${OPERATOR_MANIFEST_DIR}"
  require_path "${REPO_ROOT}/${CLUSTER_MANIFEST_DIR}"

  cd "${REPO_ROOT}"

  log "Deleting SunoExportCluster ${CLUSTER_NAME} in namespace ${NAMESPACE}"
  kubectl -n "${NAMESPACE}" delete sunoexportcluster "${CLUSTER_NAME}" --ignore-not-found >/dev/null 2>&1 || true

  if ! wait_for_managed_workloads_to_clear; then
    log "Managed workloads did not disappear in time; deleting lingering operator-managed resources directly"
    delete_lingering_managed_resources
  fi

  log "Building local image ${IMAGE_REF}"
  docker build -t "${IMAGE_REF}" .

  load_image_into_cluster

  log "Reapplying operator manifests from ${OPERATOR_MANIFEST_DIR}"
  kubectl apply -k "${OPERATOR_MANIFEST_DIR}"
  kubectl wait --for=condition=Established crd/sunoexportclusters.suno.mikegales.dev --timeout="${WAIT_SECONDS}s"

  log "Restarting operator deployment ${OPERATOR_DEPLOYMENT}"
  kubectl -n "${NAMESPACE}" rollout restart "deployment/${OPERATOR_DEPLOYMENT}"
  kubectl -n "${NAMESPACE}" rollout status "deployment/${OPERATOR_DEPLOYMENT}" --timeout="${WAIT_SECONDS}s"

  log "Recreating SunoExportCluster from ${CLUSTER_MANIFEST_DIR}"
  kubectl apply -k "${CLUSTER_MANIFEST_DIR}"

  log "Waiting for operator-managed deployments to come back"
  local deployments=(
    "deployment/${CLUSTER_NAME}-api"
    "deployment/${CLUSTER_NAME}-worker-auth"
    "deployment/${CLUSTER_NAME}-worker-metadata"
    "deployment/${CLUSTER_NAME}-worker-asset"
    "deployment/${CLUSTER_NAME}-worker-conversion"
  )

  while IFS= read -r librarian_deployment; do
    [[ -n "${librarian_deployment}" ]] && deployments+=("${librarian_deployment}")
  done < <(
    kubectl -n "${NAMESPACE}" get deploy \
      -l "app.kubernetes.io/managed-by=suno-export-k8s-operator,app.kubernetes.io/instance=${CLUSTER_NAME},app.kubernetes.io/component" \
      -o name | grep -- "-librarian-" || true
  )

  kubectl -n "${NAMESPACE}" wait \
    --for=condition=Available \
    "${deployments[@]}" \
    --timeout="${WAIT_SECONDS}s"

  log "Redeploy complete"
}

main "$@"
