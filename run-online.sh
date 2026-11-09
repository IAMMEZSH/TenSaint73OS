#!/data/data/com.termux/files/usr/bin/bash
# TenSaint73OS · 联网启动: 出站隧道 + 本机服务
# 全程只由手机主动向外连接, 不需要公网 IP, 不需要路由器端口转发。
set -e
cd "$(dirname "$0")"

PORT="${TS_PORT:-7373}"
TLOG="./data/tunnel.log"
rm -f ./data/public_url.txt ./data/tunnel.url

# ---------- 0. 身份检查 ----------
# 最高管理员只能来自 .tsowner 导入; 公开包不含任何管理员凭据或引导口令。
if [ ! -f ./data/auth.json ]; then
  echo "[!] 尚未导入最高管理员身份: 请先完全退出程序, 运行 sh owner/import-owner-key.sh 导入 .tsowner。"
  exit 1
fi

if [ ! -f ./data/online.ok ]; then
  echo "首次对外联网前, 请确认已完成:"
  echo "  1) 已用 sh owner/import-owner-key.sh 导入 .tsowner (用户名与密码在密钥文件内)"
  echo "  2) ./start.sh 本机启动, 使用原管理员密码 + 绑定手机号登录"
  printf '以上都已完成? 输入 yes 继续联网: '
  read -r ans
  [ "$ans" = "yes" ] || { echo "[x] 已取消。"; exit 1; }
  touch ./data/online.ok
fi

# ---------- 1. 依赖与防休眠 ----------
command -v node >/dev/null 2>&1 || { echo "[!] 缺少 node: pkg install nodejs-lts"; exit 1; }
CF=""
if [ -x ./tools/cloudflared ]; then CF="./tools/cloudflared"; fi
if [ -z "$CF" ]; then CF="$(command -v cloudflared 2>/dev/null || true)"; fi
if [ -z "$CF" ]; then
  echo "[!] 缺少 cloudflared: 打开管理员页面「网络矩阵 → 隧道控制」点“安装隧道组件”, 或 pkg install cloudflared"
  exit 1
fi
termux-wake-lock 2>/dev/null || echo "[!] 拿不到 wakelock (非 Termux 环境?), 请手动关闭 Termux 的电池优化。"

# ---------- 2. 起隧道 ----------
: > "$TLOG"
# 部分网络 UDP/QUIC 受限, 快速隧道固定走 HTTP/2 + IPv4 才能稳定拿到地址
TUN_FLAGS="--no-autoupdate --protocol http2 --edge-ip-version 4"
if [ -n "${TS_TUNNEL_NAME:-}" ] && [ -f ./data/tunnel.yml ]; then
  # 命名隧道 (有 Cloudflare 账号 + 自己的域名时): 地址固定不变
  "$CF" tunnel --config ./data/tunnel.yml --no-autoupdate --protocol http2 run "$TS_TUNNEL_NAME" >>"$TLOG" 2>&1 &
  TUN_PID=$!
  URL="${TS_PUBLIC_URL:-}"
else
  # 快速隧道 (免账号, 立即可用): 每次重启会换一个随机网址
  "$CF" tunnel --url "http://localhost:${PORT}" $TUN_FLAGS >>"$TLOG" 2>&1 &
  TUN_PID=$!
  URL=""
  for _ in $(seq 1 60); do
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
