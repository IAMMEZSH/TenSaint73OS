#!/bin/sh
# TenSaint73OS · iOS iSH 启动脚本
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "尚未安装 Node。请先运行：sh ios-install.sh"
  exit 1
fi
PORT="${TS_PORT:-7373}"
echo "TenSaint73OS 正在启动"
echo "保持 iSH 在前台，Safari 打开：http://127.0.0.1:${PORT}"
exec node server.js
