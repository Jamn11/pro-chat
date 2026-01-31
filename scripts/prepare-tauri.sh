#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT_DIR/apps/web/src-tauri/bin"
mkdir -p "$BIN_DIR"

NODE_PATH="$(command -v node || true)"
if [[ -z "$NODE_PATH" ]]; then
  echo "[prepare-tauri] node not found in PATH; cannot bundle runtime." >&2
  exit 1
fi

cp "$NODE_PATH" "$BIN_DIR/node"
chmod +x "$BIN_DIR/node"

echo "[prepare-tauri] bundled node from $NODE_PATH" >&2
