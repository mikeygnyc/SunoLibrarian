#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

FORCE=0
INCLUDE_ELK=1

NAMESPACE="${NAMESPACE:-suno-export}"
CLUSTER_NAME="${CLUSTER_NAME:-main}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/mikeygnyc/suno-export}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
RUNTIME_POSTGRES_URL="${RUNTIME_POSTGRES_URL:-postgres://user:password@postgres.example.internal:5432/suno_export}"
RUNTIME_MQTT_URL="${RUNTIME_MQTT_URL:-mqtt://mqtt.example.internal:1883}"
ELK_ELASTICSEARCH_HOSTS="${ELK_ELASTICSEARCH_HOSTS:-https://your-es:9200}"
ELK_ELASTICSEARCH_USERNAME="${ELK_ELASTICSEARCH_USERNAME:-filebeat_suno_export}"
ELK_ELASTICSEARCH_PASSWORD="${ELK_ELASTICSEARCH_PASSWORD:-change-me}"
ELK_ELASTICSEARCH_ADMIN_USERNAME="${ELK_ELASTICSEARCH_ADMIN_USERNAME:-elastic}"
ELK_ELASTICSEARCH_ADMIN_PASSWORD="${ELK_ELASTICSEARCH_ADMIN_PASSWORD:-change-me}"
ELK_ELASTICSEARCH_CA_CERT="${ELK_ELASTICSEARCH_CA_CERT:-}"
ELK_ENVIRONMENT="${ELK_ENVIRONMENT:-local}"
NO_RUN="${NO_RUN:-0}"

log() {
  printf '[bootstrap-k8s-local] %s\n' "$*"
}

usage() {
  cat <<'EOF'
Usage: scripts/bootstrap-k8s-local.sh [options]

Creates a gitignored local kustomize tree under k8s/local from the tracked
example manifests.

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
EOF
}

while (($# > 0)); do
  case "$1" in
    --force)
      FORCE=1
      ;;
    --skip-elk)
      INCLUDE_ELK=0
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

write_file() {
  local target="$1"
  local content="$2"

  mkdir -p "$(dirname "$target")"
  if [[ -e "$target" && "$FORCE" != "1" ]]; then
    log "Skipping existing file ${target}"
    return 0
  fi

  printf '%s' "$content" > "$target"
  log "Wrote ${target}"
}

copy_file() {
  local source="$1"
  local target="$2"

  mkdir -p "$(dirname "$target")"
  if [[ -e "$target" && "$FORCE" != "1" ]]; then
    log "Skipping existing file ${target}"
    return 0
  fi

  cp "$source" "$target"
  log "Copied ${source} -> ${target}"
}

render_template_file() {
  local source="$1"
  local target="$2"
  shift 2

  mkdir -p "$(dirname "$target")"
  if [[ -e "$target" && "$FORCE" != "1" ]]; then
    log "Skipping existing file ${target}"
    return 0
  fi

  perl - "$source" "$@" > "$target" <<'PERL'
use strict;
use warnings;

my $source = shift @ARGV;
open my $fh, '<', $source or die "Failed to read $source: $!";
local $/;
my $content = <$fh>;
close $fh;

while (@ARGV >= 2) {
  my $from = shift @ARGV;
  my $to = shift @ARGV;
  $content =~ s/\Q$from\E/$to/g;
}

print $content;
PERL
  log "Wrote ${target}"
}

main() {
  cd "$REPO_ROOT"

  local local_root="k8s/local"
  local local_cluster_dir="${local_root}/cluster"
  local local_elk_dir="${local_root}/observability/elk"

  mkdir -p "$local_root" "$local_cluster_dir"

  copy_file "k8s/base/namespace.yaml" "${local_root}/namespace.yaml"
  copy_file "k8s/base/operator-serviceaccount.yaml" "${local_root}/operator-serviceaccount.yaml"
  copy_file "k8s/base/operator-clusterrole.yaml" "${local_root}/operator-clusterrole.yaml"
  copy_file "k8s/base/operator-clusterrolebinding.yaml" "${local_root}/operator-clusterrolebinding.yaml"
  copy_file "k8s/base/crd-sunoexportcluster.yaml" "${local_root}/crd-sunoexportcluster.yaml"
  copy_file "k8s/base/operator-deployment.yaml" "${local_root}/operator-deployment.yaml"
  copy_file "k8s/base/shared-storage-pvc.yaml" "${local_root}/shared-storage-pvc.yaml"

  render_template_file \
    "k8s/base/runtime-secret.example.yaml" \
    "${local_root}/runtime-secret.yaml" \
    "namespace: suno-export" "namespace: ${NAMESPACE}" \
    "postgres://user:password@postgres.example.internal:5432/suno_export" "${RUNTIME_POSTGRES_URL}" \
    "mqtt://mqtt.example.internal:1883" "${RUNTIME_MQTT_URL}"

  render_template_file \
    "k8s/base/kustomization.yaml" \
    "${local_root}/kustomization.yaml" \
    "runtime-secret.example.yaml" "runtime-secret.yaml"

  render_template_file \
    "k8s/base/cluster/sunoexportcluster.example.yaml" \
    "${local_cluster_dir}/sunoexportcluster.yaml" \
    "name: main" "name: ${CLUSTER_NAME}" \
    "namespace: suno-export" "namespace: ${NAMESPACE}" \
    "repository: ghcr.io/mikeygnyc/suno-export" "repository: ${IMAGE_REPO}" \
    "tag: latest" "tag: ${IMAGE_TAG}"

  render_template_file \
    "k8s/base/cluster/kustomization.yaml" \
    "${local_cluster_dir}/kustomization.yaml" \
    "sunoexportcluster.example.yaml" "sunoexportcluster.yaml"

  if [[ "$INCLUDE_ELK" == "1" ]]; then
    mkdir -p "$local_elk_dir"
    render_template_file \
      "k8s/observability/elk/namespace.yaml" \
      "${local_elk_dir}/namespace.yaml" \
      "name: suno-export" "name: ${NAMESPACE}"
    render_template_file \
      "k8s/observability/elk/serviceaccount.yaml" \
      "${local_elk_dir}/serviceaccount.yaml" \
      "namespace: suno-export" "namespace: ${NAMESPACE}"
    render_template_file \
      "k8s/observability/elk/clusterrole.yaml" \
      "${local_elk_dir}/clusterrole.yaml"
    render_template_file \
      "k8s/observability/elk/clusterrolebinding.yaml" \
      "${local_elk_dir}/clusterrolebinding.yaml" \
      "namespace: suno-export" "namespace: ${NAMESPACE}"
    render_template_file \
      "k8s/observability/elk/configmap.yaml" \
      "${local_elk_dir}/configmap.yaml" \
      "namespace: suno-export" "namespace: ${NAMESPACE}"
    render_template_file \
      "k8s/observability/elk/daemonset.yaml" \
      "${local_elk_dir}/daemonset.yaml" \
      "namespace: suno-export" "namespace: ${NAMESPACE}"
    render_template_file \
      "k8s/observability/elk/secret.example.yaml" \
      "${local_elk_dir}/secret.yaml" \
      "namespace: suno-export" "namespace: ${NAMESPACE}" \
      "https://your-es:9200" "${ELK_ELASTICSEARCH_HOSTS}" \
      "filebeat_suno_export" "${ELK_ELASTICSEARCH_USERNAME}" \
      "change-me" "${ELK_ELASTICSEARCH_PASSWORD}" \
      "environment: production" "environment: ${ELK_ENVIRONMENT}"

    local bootstrap_secret
    bootstrap_secret="$(cat <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: suno-export-filebeat-bootstrap
  namespace: ${NAMESPACE}
type: Opaque
stringData:
  elasticsearch-admin-username: ${ELK_ELASTICSEARCH_ADMIN_USERNAME}
  elasticsearch-admin-password: ${ELK_ELASTICSEARCH_ADMIN_PASSWORD}
EOF
)"
    if [[ -n "$ELK_ELASTICSEARCH_CA_CERT" ]]; then
      bootstrap_secret="${bootstrap_secret}"$'\n'"  elasticsearch-ca.crt: |"
      while IFS= read -r cert_line; do
        bootstrap_secret="${bootstrap_secret}"$'\n'"    ${cert_line}"
      done <<< "$ELK_ELASTICSEARCH_CA_CERT"
    else
      bootstrap_secret="${bootstrap_secret}"$'\n'"  # Optional: add the remote Elasticsearch CA certificate here when needed."
      bootstrap_secret="${bootstrap_secret}"$'\n'"  # elasticsearch-ca.crt: |"
      bootstrap_secret="${bootstrap_secret}"$'\n'"  #   -----BEGIN CERTIFICATE-----"
      bootstrap_secret="${bootstrap_secret}"$'\n'"  #   ..."
      bootstrap_secret="${bootstrap_secret}"$'\n'"  #   -----END CERTIFICATE-----"
    fi
    write_file "${local_elk_dir}/bootstrap-secret.yaml" "${bootstrap_secret}"$'\n'

    write_file "${local_elk_dir}/provisioner-job.yaml" "$(cat <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: suno-export-filebeat-provisioner
  namespace: ${NAMESPACE}
spec:
  backoffLimit: 1
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: provision-filebeat-user
          image: curlimages/curl:8.8.0
          command: ["/bin/sh", "-c"]
          args:
            - |
              set -eu

              role_payload="\$(mktemp)"
              user_payload="\$(mktemp)"
              trap 'rm -f "\$role_payload" "\$user_payload"' EXIT

              curl_args="--fail --silent --show-error"
              if [ -f /etc/elasticsearch-bootstrap/elasticsearch-ca.crt ]; then
                curl_args="\$curl_args --cacert /etc/elasticsearch-bootstrap/elasticsearch-ca.crt"
              fi

              cat >"\$role_payload" <<ROLE_EOF
              {
                "cluster": ["monitor", "read_ilm", "read_pipeline"],
                "indices": [
                  {
                    "names": ["suno-export-*"],
                    "privileges": ["auto_configure", "create_doc", "view_index_metadata"]
                  }
                ]
              }
              ROLE_EOF

              cat >"\$user_payload" <<USER_EOF
              {
                "password": "\${ELASTICSEARCH_PASSWORD}",
                "roles": ["suno_export_filebeat_writer"]
              }
              USER_EOF

              curl \$curl_args \\
                -u "\${ELASTICSEARCH_ADMIN_USERNAME}:\${ELASTICSEARCH_ADMIN_PASSWORD}" \\
                -H "Content-Type: application/json" \\
                -X POST "\${ELASTICSEARCH_HOSTS}/_security/role/suno_export_filebeat_writer" \\
                --data-binary @"\$role_payload"

              curl \$curl_args \\
                -u "\${ELASTICSEARCH_ADMIN_USERNAME}:\${ELASTICSEARCH_ADMIN_PASSWORD}" \\
                -H "Content-Type: application/json" \\
                -X POST "\${ELASTICSEARCH_HOSTS}/_security/user/\${ELASTICSEARCH_USERNAME}" \\
                --data-binary @"\$user_payload"
          env:
            - name: ELASTICSEARCH_HOSTS
              valueFrom:
                secretKeyRef:
                  name: suno-export-filebeat
                  key: elasticsearch-hosts
            - name: ELASTICSEARCH_USERNAME
              valueFrom:
                secretKeyRef:
                  name: suno-export-filebeat
                  key: elasticsearch-username
            - name: ELASTICSEARCH_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: suno-export-filebeat
                  key: elasticsearch-password
            - name: ELASTICSEARCH_ADMIN_USERNAME
              valueFrom:
                secretKeyRef:
                  name: suno-export-filebeat-bootstrap
                  key: elasticsearch-admin-username
            - name: ELASTICSEARCH_ADMIN_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: suno-export-filebeat-bootstrap
                  key: elasticsearch-admin-password
          volumeMounts:
            - name: elasticsearch-bootstrap
              mountPath: /etc/elasticsearch-bootstrap
              readOnly: true
      volumes:
        - name: elasticsearch-bootstrap
          secret:
            secretName: suno-export-filebeat-bootstrap
            optional: true
EOF
)"

    render_template_file \
      "k8s/observability/elk/kustomization.yaml" \
      "${local_elk_dir}/kustomization.yaml" \
      "secret.example.yaml" "secret.yaml"

    if [[ -e "${local_elk_dir}/kustomization.yaml" ]]; then
      printf '%s\n' "  - bootstrap-secret.yaml" "  - provisioner-job.yaml" >> "${local_elk_dir}/kustomization.yaml"
    fi
  fi
  if [[ "$NO_RUN" == "1" ]]; then
    log "Local manifests are ready under ${local_root}"
  fi
  kubectl apply -k "${local_root}"
  kubectl apply -k "${local_cluster_dir}"
  if [[ "$INCLUDE_ELK" == "1" ]]; then
    kubectl apply -k "${local_elk_dir}"
  fi
}

main "$@"
