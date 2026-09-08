#!/usr/bin/env bash
# tools/wk.sh — spustí node skript v kontejneru s opravdovým WebKitem.
# WebKit od Playwrightu potřebuje libicu74; Fedora má 77 a ABI nesedí,
# takže Safari engine se testuje jedině tady.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PWDIR="${PLAYWRIGHT_DIR:-/home/ixp/.npm/_npx/e41f203b7505f1fb/node_modules}"
IMG="${PLAYWRIGHT_IMG:-mcr.microsoft.com/playwright:v1.63.0-noble}"
exec podman run --rm \
  -v "$ROOT":/w:z \
  -v "$PWDIR":/w/node_modules:ro,z \
  -w /w "$IMG" node "$@"
