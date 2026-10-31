#!/data/data/com.termux/files/usr/bin/bash
# TenSaint73OS · 本机启动 (安卓 Termux)
# 只监听 127.0.0.1, 外部无法直连。要对外服务请用 ./run-online.sh
set -e
cd "$(dirname "$0")"

ENV_FILE="./data/admin.env"
if [ -f "$ENV_FILE" ]; then
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  . "$ENV_FILE"
  export TS_ADMIN_USER TS_ADMIN_PASS
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[!] 未找到 node。请先执行: pkg update && pkg install nodejs-lts"
  exit 1
fi

echo "[i] Node $(node -v) · 启动 TenSaint73OS"
exec node server.js
