#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

NAMESPACE="${NAMESPACE:-suno-export}"
WAIT_SECONDS="${WAIT_SECONDS:-180}"
DELETE_NAMESPACE="${DELETE_NAMESPACE:-1}"
DELETE_CRD="${DELETE_CRD:-1}"
OPERATOR_MANIFEST_DIR="${OPERATOR_MANIFEST_DIR:-k8s/local}"
CLUSTER_MANIFEST_DIR="${CLUSTER_MANIFEST_DIR:-k8s/local/cluster}"
ELK_MANIFEST_DIR="${ELK_MANIFEST_DIR:-k8s/local/observability/elk}"
CRD_NAME="sunoexportclusters.suno.mikegales.dev"
NO_RUN="${NO_RUN:-0}"

log() {
  printf '[remove-k8s-resources] %s\n' "$*"
}

usage() {
  cat <<'EOF'
Usage: scripts/remove-k8s-resources.sh [options]

Removes the Suno Export k8s install, including operator-managed workloads,
optional ELK/Filebeat resources, and cluster-scoped RBAC/CRD objects.

Options:
  --keep-namespace  Leave the namespace in place after deleting resources
  --keep-crd        Leave the SunoExportCluster CRD in place
  --no-run          Do not execute any kubectl commands, just print what would be done
  --help            Show this help message
Environment overrides:
  NAMESPACE
  WAIT_SECONDS
  DELETE_NAMESPACE
  DELETE_CRD
  OPERATOR_MANIFEST_DIR
  CLUSTER_MANIFEST_DIR
  ELK_MANIFEST_DIR
EOF
}

while (($# > 0)); do
  case "$1" in
    --keep-namespace)
      DELETE_NAMESPACE=0
      ;;
    --keep-crd)
      DELETE_CRD=0
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --no-run)
      NO_RUN=1
      log "Running in no-run mode: kubectl commands will be printed but not executed"
      kubectl() {
        log "kubectl $*"
      }
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

delete_kustomization_if_present() {
  local manifest_dir="$1"
  local absolute_dir="${REPO_ROOT}/${manifest_dir}"

  if [[ -f "${absolute_dir}/kustomization.yaml" ]]; then
    log "Deleting kustomize bundle ${manifest_dir}"
    kubectl delete -k "${manifest_dir}" --ignore-not-found >/dev/null 2>&1 || true
  fi
}

delete_all_custom_resources() {
  if ! kubectl get crd "${CRD_NAME}" >/dev/null 2>&1; then
    return 0
  fi

  local resources
  resources="$(
    kubectl get sunoexportclusters --all-namespaces \
      -o jsonpath='{range .items[*]}{.metadata.namespace}{"\t"}{.metadata.name}{"\n"}{end}' \
      2>/dev/null || true
  )"

  if [[ -z "${resources}" ]]; then
    return 0
  fi

  while IFS=$'\t' read -r resource_namespace resource_name; do
    [[ -z "${resource_namespace}" || -z "${resource_name}" ]] && continue
    log "Deleting SunoExportCluster ${resource_name} in namespace ${resource_namespace}"
    kubectl -n "${resource_namespace}" delete sunoexportcluster "${resource_name}" \
      --ignore-not-found >/dev/null 2>&1 || true
  done <<< "${resources}"
}

delete_operator_managed_resources() {
  log "Deleting operator-managed workloads in namespace ${NAMESPACE}"
  kubectl -n "${NAMESPACE}" delete deploy,svc,configmap,sa,cronjob,job,pod \
    -l "app.kubernetes.io/managed-by=suno-export-k8s-operator" \
    --ignore-not-found >/dev/null 2>&1 || true
}

delete_named_namespaced_resources() {
  local resource_type="$1"
  shift

  if (($# == 0)); then
    return 0
  fi

  kubectl -n "${NAMESPACE}" delete "${resource_type}" "$@" \
    --ignore-not-found >/dev/null 2>&1 || true
}

wait_for_namespace_deletion() {
  local deadline
  deadline=$((SECONDS + WAIT_SECONDS))

  while (( SECONDS < deadline )); do
    if ! kubectl get namespace "${NAMESPACE}" >/dev/null 2>&1; then
      return 0
    fi

    sleep 2
  done

  return 1
}

main() {
  require_command kubectl

  cd "${REPO_ROOT}"

  delete_all_custom_resources
  delete_kustomization_if_present "${CLUSTER_MANIFEST_DIR}"
  delete_operator_managed_resources
  delete_kustomization_if_present "${ELK_MANIFEST_DIR}"
  delete_kustomization_if_present "${OPERATOR_MANIFEST_DIR}"

  log "Deleting named fallback resources in namespace ${NAMESPACE}"
  delete_named_namespaced_resources daemonset suno-export-filebeat
  delete_named_namespaced_resources deployment suno-export-k8s-operator
  delete_named_namespaced_resources configmap suno-export-filebeat
  delete_named_namespaced_resources serviceaccount suno-export-filebeat suno-export-k8s-operator
  delete_named_namespaced_resources secret \
    suno-export-filebeat \
    suno-export-filebeat-bootstrap \
    suno-export-runtime
  delete_named_namespaced_resources job suno-export-filebeat-provisioner
  delete_named_namespaced_resources persistentvolumeclaim suno-export-shared

  log "Deleting cluster-scoped RBAC"
  kubectl delete clusterrolebinding \
    suno-export-filebeat \
    suno-export-k8s-operator \
    --ignore-not-found >/dev/null 2>&1 || true
  kubectl delete clusterrole \
    suno-export-filebeat \
    suno-export-k8s-operator \
    --ignore-not-found >/dev/null 2>&1 || true

  if [[ "${DELETE_NAMESPACE}" == "1" ]]; then
    log "Deleting namespace ${NAMESPACE}"
    kubectl delete namespace "${NAMESPACE}" --ignore-not-found >/dev/null 2>&1 || true
    if ! wait_for_namespace_deletion; then
      log "Namespace ${NAMESPACE} is still terminating after ${WAIT_SECONDS}s"
    fi
  fi

  if [[ "${DELETE_CRD}" == "1" ]]; then
    log "Deleting CRD ${CRD_NAME}"
    kubectl delete crd "${CRD_NAME}" --ignore-not-found >/dev/null 2>&1 || true
  fi

  log "Kubernetes teardown complete"
}

main "$@"
