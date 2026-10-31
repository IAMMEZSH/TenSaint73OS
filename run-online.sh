#!/data/data/com.termux/files/usr/bin/bash
# TenSaint73OS · 联网启动: 出站隧道 + 本机服务
# 全程只由手机主动向外连接, 不需要公网 IP, 不需要路由器端口转发。
set -e
cd "$(dirname "$0")"

PORT="${TS_PORT:-7373}"
TLOG="./data/tunnel.log"
rm -f ./data/public_url.txt ./data/tunnel.url

# ---------- 0. 凭据安全检查 ----------
if [ -f ./data/admin.env ]; then
  chmod 600 ./data/admin.env 2>/dev/null || true
  . ./data/admin.env
  export TS_ADMIN_USER TS_ADMIN_PASS
fi
if [ -n "${TS_ADMIN_PASS:-}" ] && [ "${#TS_ADMIN_PASS}" -lt 10 ]; then
  echo "[!] 拒绝联网: admin.env 里的管理员密码短于 10 位, 请先设置强密码。"
  echo "    先 ./start.sh 本机登录 -> 用户模块改密 (会自动重加密数据库并吊销旧会话)。"
  exit 1
fi

if [ ! -f ./data/online.ok ]; then
  echo "首次对外联网前, 请确认已完成:"
  echo "  1) ./start.sh 本机启动, 浏览器打开 http://127.0.0.1:${PORT} 登录"
  echo "  2) 在「用户」模块把管理员密码改成只有你知道的值"
  echo "  3) 确认管理员密码足够强 (至少 10 位)"
  printf '以上都已完成? 输入 yes 继续联网: '
  read -r ans
  [ "$ans" = "yes" ] || { echo "[x] 已取消。"; exit 1; }
  touch ./data/online.ok
fi

# ---------- 1. 依赖与防休眠 ----------
command -v node >/dev/null 2>&1 || { echo "[!] 缺少 node: pkg install nodejs-lts"; exit 1; }
command -v cloudflared >/dev/null 2>&1 || { echo "[!] 缺少 cloudflared: pkg install cloudflared"; exit 1; }
termux-wake-lock 2>/dev/null || echo "[!] 拿不到 wakelock (非 Termux 环境?), 请手动关闭 Termux 的电池优化。"

# ---------- 2. 起隧道 ----------
: > "$TLOG"
if [ -n "${TS_TUNNEL_NAME:-}" ] && [ -f ./data/tunnel.yml ]; then
  # 命名隧道 (有 Cloudflare 账号 + 自己的域名时): 地址固定不变
  cloudflared tunnel --config ./data/tunnel.yml run "$TS_TUNNEL_NAME" >>"$TLOG" 2>&1 &
  TUN_PID=$!
  URL="${TS_PUBLIC_URL:-}"
else
  # 快速隧道 (免账号, 立即可用): 每次重启会换一个随机网址
  cloudflared tunnel --url "http://localhost:${PORT}" --no-autoupdate >>"$TLOG" 2>&1 &
  TUN_PID=$!
  URL=""
  for _ in $(seq 1 40); do
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TLOG" | tail -1 || true)
    [ -n "$URL" ] && break
    sleep 1
  done
fi

cleanup() {
  kill "$TUN_PID" 2>/dev/null || true
  termux-wake-unlock 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [ -z "$URL" ]; then
  echo "[!] 60 秒内没拿到隧道地址, 见 $TLOG"
  exit 1
fi
echo "$URL" > ./data/public_url.txt
# 写这个文件 = 让系统内的「网址」板块自动收下本次的对外地址并记历史
echo "$URL" > ./data/tunnel.url
echo "[i] 全球访问地址: $URL"
echo "[i] 已写入 data/tunnel.url, 打开系统的「网址」板块可见全部历史地址。"

# ---------- 3. 起系统 (前台, Ctrl+C 即停并关闭隧道) ----------
TS_PORT="$PORT" TS_PUBLIC_URL="$URL" node server.js
