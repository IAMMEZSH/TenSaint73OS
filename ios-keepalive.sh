#!/bin/sh
# 可选：让 iSH 切到后台后继续运行（社区办法，耗电，不保证所有系统版本有效）
# 前置：设置 → 隐私与安全性 → 定位服务 → iSH → 使用 App 期间；并打开系统定位。
cat /dev/location > /dev/null &
echo "keepalive 已启动 PID=$!"
echo "现在可以切换到 Safari；用完回 iSH 按 Ctrl+C 结束。"
