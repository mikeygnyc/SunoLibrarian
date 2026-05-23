#!/usr/bin/env sh
set -eu

APP="${SUNO_EXPORT_APP:-cli}"

case "$APP" in
  cli)
    exec node /app/dist/index.js "$@"
    ;;
  api)
    exec node /app/dist/apps/api/main.js "$@"
    ;;
  operator-cli)
    exec node /app/dist/apps/operator-cli/main.js "$@"
    ;;
  k8s-operator)
    exec node /app/dist/apps/k8s-operator/main.js "$@"
    ;;
  worker)
    exec node /app/dist/apps/worker/main.js "$@"
    ;;
  librarian)
    exec node /app/dist/apps/librarian/main.js "$@"
    ;;
  *)
    echo "Unknown SUNO_EXPORT_APP: $APP" >&2
    exit 1
    ;;
esac
