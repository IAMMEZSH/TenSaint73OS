#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const readline = require('readline');
const cryptoUtil = require('../core/crypto-util');
const { Auth } = require('../core/auth');

const APP = path.resolve(__dirname, '..');
const DATA = path.join(APP, 'data');
const SALT_FILE = path.join(DATA, 'install.salt');
const MAGIC = 'TenSaint73OS-OWNER-KEY';
const FORMAT = 1;
const USERNAME_RE = /^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]{1,19}$/u;

// 管道输入会一次性缓冲所有行, readline 逐问会丢行; 非 TTY 时先读入队列。
const pipedLines = process.stdin.isTTY ? null : fs.readFileSync(0, 'utf8').split(/\r?\n/);
let pipedIndex = 0;
let rl = null;

function getRl() {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return rl;
}

function ask(q, hidden) {
  if (pipedLines) {
    const a = pipedIndex < pipedLines.length ? pipedLines[pipedIndex++] : '';
    process.stdout.write(q + '\n');
    return Promise.resolve(a);
  }
  if (!hidden) {
    const iface = getRl();
    return new Promise((resolve) => iface.question(q, resolve));
  }
  // 隐藏输入: 关闭 readline, 直接读终端原始按键, 每输入一个字符显示一个 *
  if (rl) { try { rl.close(); } catch (e) {} rl = null; }
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(q);
    stdin.resume();
    stdin.setEncoding('utf8');
    try { stdin.setRawMode(true); } catch (e) {}
    let buf = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      try { stdin.setRawMode(false); } catch (e) {}
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (buf.length) {
            buf = buf.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (ch.codePointAt(0) < 32) continue;
        buf += ch;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function maskPhone(p) {
  const s = String(p || '');
  return s.length >= 7 ? s.slice(0, 3) + '****' + s.slice(-4) : '****';
}

function serverRunning() {
  return new Promise((resolve) => {
    const port = parseInt(process.env.TS_PORT || '7373', 10) || 7373;
    const req = http.get({ host: '127.0.0.1', port, path: '/api/state', timeout: 800 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function requireStopped() {
  return serverRunning().then((up) => {
    if (up) throw new Error('检测到 TenSaint73OS 正在运行 (端口 ' + (process.env.TS_PORT || '7373') + ')。请先完全退出启动器和程序, 再执行本操作。');
  });
}

function readSalt() {
  if (!fs.existsSync(SALT_FILE)) throw new Error('未找到 data/install.salt, 请先正常启动一次程序。');
  return fs.readFileSync(SALT_FILE, 'utf8').trim();
}

function ensureSalt() {
  fs.mkdirSync(DATA, { recursive: true });
  if (fs.existsSync(SALT_FILE)) return fs.readFileSync(SALT_FILE, 'utf8').trim();
  if (fs.existsSync(path.join(DATA, 'auth.json'))) {
    throw new Error('data/auth.json 存在但 data/install.salt 丢失, 无法安全导入。请恢复原始 install.salt 或清空 data 后重试。');
  }
  const salt = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SALT_FILE, salt);
  return salt;
}

function openAuth(salt) {
  const key = crypto.createHash('sha256').update('TenSaint73OS::' + salt).digest();
  const auth = new Auth(path.join(DATA, 'auth.json'), key);
  if (auth.loadError) throw new Error('认证库无法解密 (install.salt 不匹配)。');
  return auth;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

function defaultOutPath() {
  const desktop = path.join(os.homedir(), 'Desktop');
  const base = fs.existsSync(desktop) ? desktop : os.homedir();
  return path.join(base, 'TenSaint73OS-owner-' + stamp() + '.tsowner');
}

async function doExport() {
  console.log('提示: 密码、手机号、口令输入时会显示 *, 输入完成按回车。');
  await requireStopped();
  const auth = openAuth(readSalt());
  const admins = auth.listUsers().filter((u) => u.role === 'admin');
  if (!admins.length) throw new Error('本机没有最高管理员账号, 无身份可导出。');

  const typed = (await ask('最高管理员用户名 [' + admins[0].username + ']: ')).trim();
  const username = typed || admins[0].username;
  const target = auth.users.find((u) => u.username === username);
  if (!target || target.role !== 'admin') throw new Error('该用户名不是本机最高管理员。');

  const password = await ask('管理员密码 (输入以 * 显示): ', true);
  if (!auth.verify(username, password)) throw new Error('管理员密码不正确。');

  let phoneRec = null;
  if (auth.hasPhone(username)) {
    const phone = await ask('已绑定的安全手机号 (输入以 * 显示): ', true);
    if (!auth.verifyPhone(username, phone)) throw new Error('安全手机号不正确。');
    phoneRec = auth.getPhone(username);
  }

  const p1 = await ask('设置所有者密钥口令 (至少 8 位, 输入以 * 显示): ', true);
  if (p1.length < 8) throw new Error('口令至少 8 位。');
  const p2 = await ask('再次输入口令 (输入以 * 显示): ', true);
  if (p1 !== p2) throw new Error('两次输入的口令不一致。');

  const payload = {
    kind: MAGIC,
    version: FORMAT,
    exportedAt: new Date().toISOString(),
    user: {
      username: target.username,
      salt: target.salt,
      hash: target.hash,
      role: 'admin',
      createdAt: target.createdAt || new Date().toISOString(),
      phone: phoneRec ? { phone: phoneRec.phone, boundAt: phoneRec.boundAt } : null,
    },
  };
  const envelope = cryptoUtil.encryptJSON(payload, p1);
  const doc = {
    magic: MAGIC,
    format: FORMAT,
    kdf: 'scrypt(N=16384,r=8,p=1)',
    cipher: 'aes-256-gcm',
    createdAt: new Date().toISOString(),
    envelope,
  };

  const out = process.argv[3] ? path.resolve(process.argv[3]) : defaultOutPath();
  fs.writeFileSync(out, JSON.stringify(doc, null, 2), { mode: 0o600 });
  try { fs.chmodSync(out, 0o600); } catch (e) {}

  console.log('');
  console.log('[+] 所有者密钥已生成');
  console.log('    账号: ' + username + (phoneRec ? '  手机: ' + maskPhone(phoneRec.phone) : ''));
  console.log('    文件: ' + out);
  console.log('    加密: AES-256-GCM + scrypt 口令派生 (文件内无明文账号/手机号)');
  console.log('');
  console.log('请把文件和口头口令分开保管。不要放进软件目录、网盘公开链接或 GitHub。');
  console.log('在任何平台的 TenSaint73OS 上运行导入, 即可恢复最高管理员身份。');
}

async function doImport() {
  console.log('提示: 口令输入时会显示 *, 输入完成按回车。');
  await requireStopped();
  const typedPath = process.argv[3] || await ask('所有者密钥文件路径: ');
  const file = typedPath.trim().replace(/^["']|["']$/g, '');
  if (!fs.existsSync(file)) throw new Error('文件不存在: ' + file);

  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error('文件不是有效的所有者密钥。'); }
  if (!doc || doc.magic !== MAGIC || doc.format !== FORMAT || !doc.envelope) throw new Error('文件格式不受支持。');

  const pass = await ask('所有者密钥口令 (输入以 * 显示): ', true);
  let payload;
  try { payload = cryptoUtil.decryptJSON(doc.envelope, pass); }
  catch (e) { throw new Error('口令错误或文件已损坏。'); }
  if (!payload || payload.kind !== MAGIC || !payload.user) throw new Error('密钥内容无效。');

  const u = payload.user;
  if (typeof u.username !== 'string' || !USERNAME_RE.test(u.username)) throw new Error('密钥中的用户名无效。');
  if (u.role !== 'admin') throw new Error('密钥中的身份不是最高管理员。');
  if (!/^[0-9a-f]{32}$/i.test(String(u.salt || '')) || !/^[0-9a-f]{128}$/i.test(String(u.hash || ''))) {
    throw new Error('密钥中的凭据格式无效。');
  }

  const auth = openAuth(ensureSalt());
  if (auth.users.some((x) => x.role === 'admin')) throw new Error('本机已存在最高管理员账号, 为避免覆盖已停止导入。');
  if (auth.users.some((x) => x.username === u.username)) throw new Error('本机已存在同名账号, 请先移除该账号再导入。');

  auth.users.push({
    username: u.username,
    salt: u.salt,
    hash: u.hash,
    role: 'admin',
    grants: { tables: {}, files: {} },
    createdAt: u.createdAt || new Date().toISOString(),
  });
  auth.save();

  let phoneLine = '未绑定安全手机';
  const phone = u.phone && u.phone.phone ? String(u.phone.phone) : '';
  if (phone) {
    try {
      auth.setPhone(u.username, phone);
      phoneLine = '安全手机 ' + maskPhone(phone) + ' (已加密绑定)';
    } catch (e) {
      phoneLine = '安全手机未导入: ' + e.message;
    }
  }

  console.log('');
  console.log('[+] 最高管理员身份已导入');
  console.log('    账号: ' + u.username);
  console.log('    ' + phoneLine);
  console.log('    登录: 使用原密码' + (phone ? ' + 该手机号' : '') + ' (本机独立加密空间)');
  console.log('');
  console.log('请删除或移走 .tsowner 文件, 然后重新启动 TenSaint73OS。');
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'export') await doExport();
  else if (mode === 'import') await doImport();
  else {
    console.log('用法: node owner-vault.js <export|import> [file]');
    process.exitCode = 1;
  }
}

main().then(() => {
  if (rl) rl.close();
}).catch((e) => {
  console.error('');
  console.error('[x] ' + e.message);
  if (rl) rl.close();
  process.exitCode = 1;
});
