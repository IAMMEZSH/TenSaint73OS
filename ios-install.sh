#!/bin/sh
# TenSaint73OS · iOS iSH 环境安装（只需运行一次，需联网）
set -e
echo "[1/2] 更新软件源"
apk update
echo "[2/2] 安装 Node.js、npm、unzip"
apk add --no-cache nodejs npm unzip
node -v
npm -v
echo
echo "完成。以后启动：sh ios-start.sh"
