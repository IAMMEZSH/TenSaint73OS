#!/bin/sh
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ARCH=$(uname -m 2>/dev/null || echo unknown)
NODE=""
case "$ARCH" in
  x86_64|amd64) NODE="$HERE/../../runtime/node-linux-x64/bin/node" ;;
  aarch64|arm64) NODE="$HERE/../../runtime/node-linux-arm64/bin/node" ;;
esac
if [ ! -x "$NODE" ]; then NODE=$(command -v node 2>/dev/null || true); fi
if [ -z "$NODE" ]; then
  echo "[x] Node.js not found. Start the packaged app once, or install Node.js."
  exit 1
fi
exec "$NODE" "$HERE/owner-vault.js" import
