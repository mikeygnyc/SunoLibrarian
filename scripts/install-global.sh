#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname -- "$SCRIPT_DIR")"

"$SCRIPT_DIR/install.sh"

# shellcheck source=./install.sh
. "$SCRIPT_DIR/install.sh"

cd "$PROJECT_ROOT"
use_node_version
npm install -g .
suno-export --help
