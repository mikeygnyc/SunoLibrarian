#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

NAMESPACE="${NAMESPACE:-suno-export}"
CLUSTER_NAME="${CLUSTER_NAME:-main}"
API_PORT="${API_PORT:-3000}"
FILEBEAT_TIMEOUT="${FILEBEAT_TIMEOUT:-180s}"
API_TIMEOUT="${API_TIMEOUT:-180s}"
INDEX_TIMEOUT_SECONDS="${INDEX_TIMEOUT_SECONDS:-120}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-3}"
TEARDOWN=0
PORT_FORWARD_PID=""
CA_CERT_FILE=""

log() {
  printf '[elk-smoke-test] %s\n' "$*"
}

usage() {
  cat <<'EOF'
Usage: scripts/elk-smoke-test.sh [options]

Generates local manifests, applies the ELK/Filebeat and application manifests,
then verifies a tagged API request arrives in Elasticsearch as a decoded
structured event. It leaves the cluster running by default.

Options:
  --teardown  Remove the local k8s resources after the test (destructive)
  --help      Show this help

Environment overrides:
  NAMESPACE, CLUSTER_NAME, API_PORT, FILEBEAT_TIMEOUT, API_TIMEOUT,
  INDEX_TIMEOUT_SECONDS, POLL_INTERVAL_SECONDS,
  SUNO_EXPORT_K8S_LOCAL_ENV_FILE

Elasticsearch credentials are loaded from the same local environment file used
by pre-conf-bootstrap-k8s-local.sh. The file must include the ELK_* values.
EOF
}

cleanup() {
  if [[ -n "$PORT_FORWARD_PID" ]]; then
    kill "$PORT_FORWARD_PID" >/dev/null 2>&1 || true
    wait "$PORT_FORWARD_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$CA_CERT_FILE" ]]; then
    rm -f "$CA_CERT_FILE"
  fi
  if [[ "$TEARDOWN" == "1" ]]; then
    log "Removing local Kubernetes resources because --teardown was specified"
    "${SCRIPT_DIR}/remove-k8s-resources.sh"
  fi
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command not found: %s\n' "$1" >&2
    exit 1
  }
}

load_local_environment() {
  local config_file="${SUNO_EXPORT_K8S_LOCAL_ENV_FILE:-${SCRIPT_DIR}/pre-conf-bootstrap-k8s-local.env}"
  if [[ ! -f "$config_file" ]]; then
    printf 'Missing local environment file: %s\n' "$config_file" >&2
    printf 'Copy scripts/pre-conf-bootstrap-k8s-local.env.example and set its values first.\n' >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$config_file"
  set +a

  : "${ELK_ELASTICSEARCH_HOSTS:?ELK_ELASTICSEARCH_HOSTS must be set}"
  : "${ELK_ELASTICSEARCH_USERNAME:?ELK_ELASTICSEARCH_USERNAME must be set}"
  : "${ELK_ELASTICSEARCH_PASSWORD:?ELK_ELASTICSEARCH_PASSWORD must be set}"
  : "${ELK_ELASTICSEARCH_ADMIN_USERNAME:?ELK_ELASTICSEARCH_ADMIN_USERNAME must be set}"
  : "${ELK_ELASTICSEARCH_ADMIN_PASSWORD:?ELK_ELASTICSEARCH_ADMIN_PASSWORD must be set}"
}

wait_for_deployment() {
  local deployment="$1"
  local timeout="$2"
  local deadline=$((SECONDS + ${timeout%s}))

  until kubectl -n "$NAMESPACE" get "deployment/${deployment}" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      printf 'Timed out waiting for deployment/%s to be created in namespace %s\n' "$deployment" "$NAMESPACE" >&2
      exit 1
    fi
    sleep 2
  done
  kubectl -n "$NAMESPACE" rollout status "deployment/${deployment}" --timeout="$timeout"
}

elasticsearch_curl() {
  local args=(--fail --silent --show-error --user "${ELK_ELASTICSEARCH_USERNAME}:${ELK_ELASTICSEARCH_PASSWORD}")
  if [[ -n "${ELK_ELASTICSEARCH_CA_CERT:-}" && -z "$CA_CERT_FILE" ]]; then
    CA_CERT_FILE="$(mktemp)"
    printf '%s\n' "$ELK_ELASTICSEARCH_CA_CERT" > "$CA_CERT_FILE"
  fi
  if [[ -n "$CA_CERT_FILE" ]]; then
    args+=(--cacert "$CA_CERT_FILE")
  fi
  curl "${args[@]}" "$@"
}

elasticsearch_admin_curl() {
  local args=(--fail --silent --show-error --user "${ELK_ELASTICSEARCH_ADMIN_USERNAME}:${ELK_ELASTICSEARCH_ADMIN_PASSWORD}")
  if [[ -n "${ELK_ELASTICSEARCH_CA_CERT:-}" && -z "$CA_CERT_FILE" ]]; then
    CA_CERT_FILE="$(mktemp)"
    printf '%s\n' "$ELK_ELASTICSEARCH_CA_CERT" > "$CA_CERT_FILE"
  fi
  if [[ -n "$CA_CERT_FILE" ]]; then
    args+=(--cacert "$CA_CERT_FILE")
  fi
  curl "${args[@]}" "$@"
}

main() {
  while (($# > 0)); do
    case "$1" in
      --teardown) TEARDOWN=1 ;;
      --help|-h) usage; exit 0 ;;
      *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 1 ;;
    esac
    shift
  done

  require_command kubectl
  require_command curl
  require_command jq
  load_local_environment
  trap cleanup EXIT
  cd "$REPO_ROOT"

  log "Generating local manifests"
  "${SCRIPT_DIR}/pre-conf-bootstrap-k8s-local.sh" --force --no-run

  log "Applying ELK/Filebeat manifests"
  # The provisioner is intentionally a fixed-name Job. Replace it so this
  # smoke test validates the credentials generated for this invocation.
  kubectl -n "$NAMESPACE" delete job/suno-export-filebeat-provisioner --ignore-not-found
  kubectl apply -k k8s/local/observability/elk
  kubectl -n "$NAMESPACE" wait --for=condition=complete job/suno-export-filebeat-provisioner --timeout="$FILEBEAT_TIMEOUT"
  # ConfigMap updates do not change the DaemonSet pod template. Restart the
  # collector so this smoke test always exercises the freshly generated config.
  kubectl -n "$NAMESPACE" rollout restart daemonset/suno-export-filebeat
  kubectl -n "$NAMESPACE" rollout status daemonset/suno-export-filebeat --timeout="$FILEBEAT_TIMEOUT"

  log "Applying operator and cluster manifests"
  kubectl apply -k k8s/local
  kubectl apply -k k8s/local/cluster
  wait_for_deployment "${CLUSTER_NAME}-api" "$API_TIMEOUT"

  local request_id="elk-smoke-$(date +%s)-${RANDOM}"
  local probe_path="/__elk_smoke__/${request_id}"
  local port_forward_log
  port_forward_log="$(mktemp)"
  kubectl -n "$NAMESPACE" port-forward "service/${CLUSTER_NAME}-api" ":${API_PORT}" >"$port_forward_log" 2>&1 &
  PORT_FORWARD_PID=$!

  local local_port
  for _ in {1..30}; do
    local_port="$(sed -nE 's/.*127\.0\.0\.1:([0-9]+).*/\1/p' "$port_forward_log" | head -n 1)"
    [[ -n "$local_port" ]] && break
    if ! kill -0 "$PORT_FORWARD_PID" >/dev/null 2>&1; then
      cat "$port_forward_log" >&2
      exit 1
    fi
    sleep 1
  done
  rm -f "$port_forward_log"
  if [[ -z "${local_port:-}" ]]; then
    printf 'Timed out establishing an API port-forward\n' >&2
    exit 1
  fi

  log "Sending tagged API request: ${request_id}"
  local probe_status
  probe_status="$(curl --noproxy '*' --silent --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    -H "X-Request-Id: ${request_id}" \
    "http://127.0.0.1:${local_port}${probe_path}")"
  if [[ "$probe_status" != "404" ]]; then
    printf 'Expected smoke-test probe to return HTTP 404, received %s\n' "$probe_status" >&2
    exit 1
  fi

  local search_payload response deadline
  search_payload="$(jq -nc --arg probe_path "$probe_path" '{size: 1, sort: [{"@timestamp": {order: "desc", unmapped_type: "date"}}], query: {bool: {must: [{term: {"properties.pathname.keyword": $probe_path}}, {match: {service: "api"}}, {match_phrase: {message: "request completed"}}]}}}')"
  deadline=$((SECONDS + INDEX_TIMEOUT_SECONDS))
  while :; do
    response="$(elasticsearch_admin_curl -H 'Content-Type: application/json' --data "$search_payload" "${ELK_ELASTICSEARCH_HOSTS%/}/suno-export-*/_search")"
    if jq -e --arg request_id "$request_id" --arg probe_path "$probe_path" '
      .hits.hits[0]._source as $event |
      $event.service == "api" and
      $event.level == "info" and
      $event.message == "request completed" and
      $event.properties.pathname == $probe_path and
      (($event.properties.requestId // $request_id) == $request_id) and
      ($event.timestamp | type == "string")
    ' >/dev/null <<<"$response"; then
      log "Verified decoded structured API event in Elasticsearch"
      return 0
    fi
    if (( SECONDS >= deadline )); then
      printf 'Timed out waiting for tagged event %s in suno-export-*\n' "$request_id" >&2
      exit 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

main "$@"
