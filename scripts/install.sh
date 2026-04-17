#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname -- "$SCRIPT_DIR")"

load_nvm() {
  if command -v nvm >/dev/null 2>&1; then
    return
  fi

  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$nvm_dir/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "$nvm_dir/nvm.sh"
  fi
}

use_node_version() {
  load_nvm

  if ! command -v nvm >/dev/null 2>&1; then
    echo "nvm is not available. Install/load nvm, then rerun this script." >&2
    exit 1
  fi

  if [ -f "$PROJECT_ROOT/.nvmrc" ]; then
    nvm install
    nvm use
  else
    echo "No .nvmrc found; using current nvm Node version: $(nvm current)"
  fi
}

main() {
  cd "$PROJECT_ROOT"
  use_node_version

  npm install
  npm run build
  npm start -- --help
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
