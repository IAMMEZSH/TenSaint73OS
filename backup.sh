#!/data/data/com.termux/files/usr/bin/bash
# 加密备份整个 data/ 到手机下载目录。数据库和文件本身已是密文, 但 install.salt
# 是解开认证库与文件仓库的钥匙, 所以整包再套一层 AES-256 才允许离开本机。
set -e
cd "$(dirname "$0")"

if [ ! -d /sdcard/Download ]; then
  echo "[!] 未授权存储: 先执行 termux-setup-storage 并同意权限"
  exit 1
fi

STAMP=$(date +%Y%m%d-%H%M)
OUT="/sdcard/Download/tensaint-backup-${STAMP}.tar.gz.enc"

read -rsp "备份加密密码 (忘了就无法恢复): " TS_BACKUP_PW; echo
tar -C . -czf - data | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:TS_BACKUP_PW > "$OUT"
unset TS_BACKUP_PW
chmod 600 "$OUT" 2>/dev/null || true

ls -la "$OUT"
echo "[i] 完成。恢复命令:"
echo "    export TS_BACKUP_PW='你的密码'"
echo "    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in <备份文件> -pass env:TS_BACKUP_PW | tar -xzf - -C ~/TenSaint73OS"
