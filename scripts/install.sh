#!/usr/bin/env bash
set -euo pipefail

# Thin installer shim. Real install logic lives in @nitejar/cli.
exec npx -y @nitejar/cli@latest up "$@"
