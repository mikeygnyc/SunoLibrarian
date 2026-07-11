#!/usr/bin/env bash

set -euo pipefail
./scripts/remove-k8s-resources.sh
./scripts/pre-conf-bootstrap-k8s-local.sh --force --no-run
sleep 1
kubectl apply -k k8s/local/observability/elk
sleep 1
kubectl apply -k k8s/local
sleep 1
kubectl apply -k k8s/local/cluster
