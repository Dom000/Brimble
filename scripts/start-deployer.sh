#!/usr/bin/env bash
set -euo pipefail
# Start the deployer with the environment and tools path set from repo root.
export PATH="$PWD/tools:$PATH"
export NODE_TLS_REJECT_UNAUTHORIZED=0
set -a
. ./.env
set +a
exec yarn workspace brimble-backend run deployer:dev
