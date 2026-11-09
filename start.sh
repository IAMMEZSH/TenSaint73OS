#!/data/data/com.termux/files/usr/bin/bash
# TenSaint73OS · 本机启动 (安卓 Termux)
# 只监听 127.0.0.1, 外部无法直连。要对外服务请用 ./run-online.sh
set -e
cd "$(dirname "$0")"

# 最高管理员只能由 .tsowner 导入; 这里不读取任何管理员凭据文件或环境变量。

if ! command -v node >/dev/null 2>&1; then
  echo "[!] 未找到 node。请先执行: pkg update && pkg install nodejs-lts"
  exit 1
fi

echo "[i] Node $(node -v) · 启动 TenSaint73OS"
exec node server.js
