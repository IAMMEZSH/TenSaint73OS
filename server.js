'use strict';
/* ============================================================================
   TenSaint73OS · 核心服务器
   零依赖 / 便携运行 / 数据库全程加密 / 文件变动自动轮换系统密钥
============================================================================ */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const util = require('./core/util');
const cryptoUtil = require('./core/crypto-util');
const { Store, DEFAULT_THEME } = require('./core/store');
const { Auth } = require('./core/auth');
const { UserStore } = require('./core/userstore');
const { downloadToFile } = require('./core/downloader');
const ai = require('./core/ai');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const FILES = path.join(DATA, 'files');
const USERDATA = path.join(DATA, 'users');
const USER_FILES = path.join(FILES, 'users');
const PUBLIC = path.join(ROOT, 'public');
const SYSTEM_NAME = 'TenSaint73OS';
const VERSION = '1.5.0';
// 官方发行页 (更新提示用; 隧道地址仍由 cloudflared 随机生成, 这里不写死任何公网地址)
const OFFICIAL_URL = 'https://github.com/IAMMEZSH/TenSaint73OS';
const RELEASES_URL = OFFICIAL_URL + '/releases/latest';

/* ---------------- 运行环境 (iOS · iSH / 通用 Node) ---------------- */
const IS_TERMUX = /com\.termux/.test(`${process.env.PREFIX || ''}${process.env.HOME || ''}`);
// 默认只监听回环: 对外通道交给 cloudflared 隧道, 局域网/公网都不能直连本源站
const BIND_HOST = process.env.TS_BIND || '127.0.0.1';
// 仅当源站只接受隧道连接时, X-Forwarded-For 才是可信的 (由 cloudflared 写入)
const TRUST_PROXY = process.env.TS_TRUST_PROXY !== undefined
  ? process.env.TS_TRUST_PROXY === '1'
  : (BIND_HOST === '127.0.0.1' || BIND_HOST === '::1' || BIND_HOST === 'localhost');

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    else if (IS_TERMUX) spawn('termux-open-url', [url], { stdio: 'ignore' });
  } catch (e) { /* 设备上没有可用浏览器, 忽略 */ }
}

util.ensureDir(DATA);
util.ensureDir(FILES);
util.ensureDir(USERDATA);
util.ensureDir(USER_FILES);

/* ---------------- 安装盐 (每台机器/每次安装独一无二) ---------------- */
const SALT_FILE = path.join(DATA, 'install.salt');
if (!fs.existsSync(SALT_FILE)) fs.writeFileSync(SALT_FILE, crypto.randomBytes(32).toString('hex'));
const INSTALL_SALT = fs.readFileSync(SALT_FILE, 'utf8').trim();
const INSTALL_KEY = crypto.createHash('sha256').update('TenSaint73OS::' + INSTALL_SALT).digest();
// 会员私有数据库密钥: 与 install.salt 绑定, 换机器/复制目录都不影响, 拷贝单个文件也解不开
const USER_KEY = crypto.createHash('sha256').update('TenSaint73OS::userdata::v1::' + INSTALL_SALT).digest();

/* ---------------- 系统密钥 + 文件完整性清单 ---------------- */
// 受保护文件清单: 这些文件被移动/复制/修改 -> 密钥随机轮换
const PROTECTED = () => {
  const list = [];
  // 根目录全部文件 (启动器/文档/图标等被移动/修改同样触发轮换)
  for (const f of fs.readdirSync(ROOT)) {
    const p = path.join(ROOT, f);
    if (fs.statSync(p).isFile() && !f.endsWith('.tmp')) list.push(f);
  }
  for (const d of ['core', 'public', path.join('public', 'css'), path.join('public', 'js')]) {
    const dir = path.join(ROOT, d);
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.tmp')) continue;
        if (fs.statSync(path.join(dir, f)).isFile()) list.push(path.join(d, f).split(path.sep).join('/'));
      }
    }
  }
  return list.sort();
};

function buildManifest() {
  const mf = {};
  for (const rel of PROTECTED()) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p)) mf[rel] = util.sha256File(p);
  }
  return mf;
}

const KEY_FILE = path.join(DATA, 'system.key');
const MANIFEST_FILE = path.join(DATA, 'manifest.json');
let systemKey = util.readJSON(KEY_FILE, null) || util.randomKey(32);
let manifestStatus = 'OK';
{
  const current = buildManifest();
  const saved = util.readJSON(MANIFEST_FILE, null);
  if (!saved) {
    // 首次启动: 建立基线
    util.writeJSON(MANIFEST_FILE, current);
  } else if (JSON.stringify(current) !== JSON.stringify(saved)) {
    // 文件被移动/复制/修改/增删 -> 随机轮换密钥, 重建基线
    systemKey = util.randomKey(32);
    manifestStatus = 'ROTATED';
    util.writeJSON(MANIFEST_FILE, current);
  }
}
fs.writeFileSync(KEY_FILE, JSON.stringify(systemKey));

/* ---------------- 配置 ---------------- */
const CONFIG_FILE = path.join(DATA, 'config.json');
let config = Object.assign({ port: 7373, registration: true }, util.readJSON(CONFIG_FILE, {}));
if (process.env.TS_PORT) config.port = parseInt(process.env.TS_PORT, 10) || config.port;
config.registration = config.registration !== false;
function saveConfig() { util.writeJSON(CONFIG_FILE, config); }

/* ---------------- 认证与数据库 ---------------- */
const auth = new Auth(path.join(DATA, 'auth.json'), INSTALL_KEY);
if (auth.loadError) {
  console.log('[!] 认证库无法在本机解密 (系统被复制到其它环境)。请用初始安装目录运行。');
}
// 最高管理员身份只能由 .tsowner 导入: 公开包不含任何管理员凭据、引导口令或环境变量入口。
// 认证库里已有管理员时照常启动 (升级用户的账号与数据原样保留); 没有管理员时以会员模式运行。
if (!auth.users.some(u => u.role === 'admin')) {
  if (auth.loadError) {
    console.log('[!] 认证库在本环境无法解密, 已按空库处理。');
  } else if (auth.users.length === 0) {
    console.log('[i] 未检测到最高管理员: 以会员模式运行 (注册 / 登录 / 自助注销, 每人独立加密空间)。');
    console.log('    需要管理端时, 请先完全退出程序, 再运行 owner/import-owner-key 导入 .tsowner, 然后重新启动。');
  } else {
    console.log('[i] 未检测到最高管理员: 现有会员账号仍可正常登录。');
    console.log('    最高管理员只能通过 owner/import-owner-key 导入 .tsowner 恢复。');
  }
} else if (auth.users.some(u => u.role !== 'admin' && !u.grants)) {
  console.log('[i] 存在尚未授权的受限账号。它们默认看不到任何数据, 请在 用户管理 → 授权 中逐项勾选。');
}

const store = new Store(path.join(DATA, 'system.db'));
if (!store.existed) {
  console.log('[i] 首次启动: 数据库将在管理员首次登录时以 AES-256-GCM 加密落盘。');
}

/* ---------------- 会员私有空间 ----------------
   注册用户拥有彼此独立的数据表与文件目录:
   - 数据库: data/users/<sha256(username)>.db, AES-256-GCM, 每用户一个文件
   - 文件:   data/files/users/<workspace>/ , 接口层做根目录虚拟化, 无法越界
   管理员不受这两套空间约束 (可看全局文件仓库), 但会员之间完全隔离。 */
const userStores = new Map();

function workspaceName(username) {
  const s = String(username || '').normalize('NFKC');
  if (/^[\w\u4e00-\u9fa5.-]{1,24}$/u.test(s) && s !== '.' && s !== '..') return s;
  return 'u_' + util.sha256(s).slice(0, 12);
}

function userFilesRoot(username) {
  const dir = path.join(USER_FILES, workspaceName(username));
  util.ensureDir(dir);
  return dir;
}

function userStoreFor(username) {
  if (userStores.has(username)) return userStores.get(username);
  const file = path.join(USERDATA, util.sha256(username).slice(0, 32) + '.db');
  const us = new UserStore(file, USER_KEY);
  userStores.set(username, us);
  return us;
}

// 旧版本删除账号时保留过私有目录/数据库; 同名重建会把旧数据重新挂到新账号上。
// 建号前把这类孤儿空间移出可访问范围, 新账号从空空间开始 (字节保留在 data/quarantine)。
function quarantineOrphanSpace(username) {
  const ws = path.join(USER_FILES, workspaceName(username));
  const db = path.join(USERDATA, util.sha256(username).slice(0, 32) + '.db');
  if (!fs.existsSync(ws) && !fs.existsSync(db)) return false;
  const qdir = path.join(DATA, 'quarantine');
  util.ensureDir(qdir);
  const tag = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  for (const [p, label] of [[ws, 'ws'], [db, 'db']]) {
    if (!fs.existsSync(p)) continue;
    try { fs.renameSync(p, path.join(qdir, label + '-' + tag)); }
    catch (e) {
      try {
        if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
        else fs.rmSync(p, { force: true });
      } catch (e2) { /* 无法移动也无法删除时保持原样 */ }
    }
  }
  return true;
}

function ensureUserSpace(username) {
  const dir = userFilesRoot(username);
  const welcome = path.join(dir, '空间说明.txt');
  if (!fs.existsSync(welcome)) {
    const text = [
      `欢迎来到 ${username} 的私有空间`,
      '',
      '· 这里的文件与数据默认只有你自己能看到; 平台没有给最高管理员留读别人私有空间的入口。',
      '· 只有管理员把自己名下的全局表/目录显式授权给你时, 共享视图里才会多出那一项; 你的私有空间不在可授权范围内。',
      '· 数据库 → 我的数据库: 你可以自由建表、增删改查, 与其他用户互不影响。',
      '· 所有文件和数据库在磁盘上都是 AES-256-GCM 加密的。',
      '· 退出登录请使用左下角 / 顶部电源按钮。',
      '',
      `创建时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    ].join('\n');
    fs.writeFileSync(welcome, sealBytes(Buffer.from(text, 'utf8')));
  }
  const us = userStoreFor(username);
  if (!fs.existsSync(us.file)) us.save();
  return us;
}

function dirStats(dir) {
  let files = 0, size = 0;
  try {
    (function walk(d) {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p); else { files++; size += st.size; }
      }
    })(dir);
  } catch (e) { /* 空空间 */ }
  return { files, size };
}

function nodeIdOf(username) {
  const h = util.sha256('node::' + username).slice(0, 12).toUpperCase();
  return 'TS73-' + h.match(/.{1,4}/g).join('-');
}

const regAttempts = new Map();
function regAllowed(ip) {
  const t = Date.now();
  const r = regAttempts.get(ip) || { n: 0, since: t };
  if (t - r.since > 3600 * 1000) { r.n = 0; r.since = t; }
  if (r.n >= 8) return false;
  r.n++;
  regAttempts.set(ip, r);
  return true;
}

const bootTime = Date.now();
function uptime() {
  const s = Math.floor((Date.now() - bootTime) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60);
  return `${d}天 ${h}时 ${mm}分 ${s % 60}秒`;
}

const sysCtx = {
  name: SYSTEM_NAME, version: VERSION, auth,
  get key() { return systemKey; },
  get keyStatus() { return manifestStatus === 'OK' ? '稳定' : '已因文件变动自动轮换'; },
  get uptime() { return uptime(); },
  node: process.version, port: () => config.port,
  rotateKey() {
    systemKey = util.randomKey(32);
    fs.writeFileSync(KEY_FILE, JSON.stringify(systemKey));
    store.log('warn', '系统密钥被 AI 手动轮换');
    return systemKey;
  },
};

/* ---------------- HTTP 基础 ---------------- */
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function send(res, code, obj, headers = {}) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SEC_HEADERS, headers));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 50 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); return; }
      data += c;
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  // 直连模式下绝不信任 X-Forwarded-For: 客户端可伪造该头来绕过登录失败限速
  if (TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '');
    if (xff) return xff.split(',')[0].trim() || 'unknown';
  }
  return req.socket.remoteAddress || 'unknown';
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg',
  '.zip': 'application/zip', '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  if (!rel) rel = 'index.html';
  const file = util.safeJoin(PUBLIC, rel);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { send(res, 404, { error: 'NOT_FOUND' }); return; }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream' }, SEC_HEADERS));
  fs.createReadStream(file).pipe(res);
}

// 权限中间件: 返回 {user} 或 null
function requireAuth(req, res) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || (req.headers['x-token'] || '');
  const user = auth.check(token);
  if (!user) { send(res, 401, { error: '未登录或会话已过期' }); return null; }
  return user;
}

/* ---------------- 数据级授权 ----------------
   受限账号默认看不到任何数据。由管理员在 用户管理 → 授权 中逐表 / 逐目录授予
   r (只读) 或 rw (可写)。授权在每次请求实时读取, 撤销后下一个请求即被拒绝。
   只有 role=admin 的账号不受 grants 约束, 可以看到一切。 */
const MEMBER_ROUTES = new Set([
  '/api/my', '/api/me/password', '/api/me/delete', '/api/me/phone', '/api/me/phone/unbind',
  '/api/db/tables', '/api/db/table', '/api/db/create', '/api/db/drop',
  '/api/db/insert', '/api/db/update', '/api/db/delete',
  '/api/db/clear', '/api/db/addcol', '/api/db/delcol',
  '/api/fs/list', '/api/fs/download', '/api/fs/mkdir', '/api/fs/upload', '/api/fs/delete',
]);

// 共享空间: 管理员在「用户 → 授权」里逐表/逐目录授予 r 或 rw 之后, 会员从这里访问全局资源。
// 与私有空间是两套东西: 私有空间永远只属于本人, 这里只给显式授权过的部分。
// 授权在每次请求实时读取, 所以管理员撤销后, 会员的下一个请求就会被拒绝。
const SHARED_ROUTES = new Set([
  '/api/shared',
  '/api/shared/db/tables', '/api/shared/db/table', '/api/shared/db/insert', '/api/shared/db/update', '/api/shared/db/delete',
  '/api/shared/fs/list', '/api/shared/fs/download',
  '/api/shared/fs/upload', '/api/shared/fs/mkdir', '/api/shared/fs/delete',
]);

// 会员私有空间的物理目录名。任何授权（包括根目录 ""）都不得把它暴露出去:
// 一次误勾选就会让被授权的会员读到所有人的私有文件。
const PRIVATE_DIR = 'users';

// 先归一化再判权限: 只判首段的写法挡不住 docs/../users/alice —— 归一化后就变成 users/alice。
function sharedRel(raw) {
  const s = String(raw || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s) return '';
  const norm = path.posix.normalize(s);
  return norm === '.' ? '' : norm;
}

function sharedDenied(rel) {
  if (!rel) return false;
  const parts = rel.split('/');
  // Windows / macOS 文件系统不区分大小写, "USERS" 或尾随空格的 "users." 仍会落到同一个目录
  const head = String(parts[0] || '').replace(/[. ]+$/, '').toLowerCase();
  return head === PRIVATE_DIR || parts.indexOf('..') >= 0 || rel.indexOf('\0') >= 0;
}

// 最高管理员能看全局仓库, 但会员私有空间这一棵子树对任何人都不开放 —— 包括管理员自己。
// 平台不提供读别人私有文件/数据库的入口; 磁盘上的密钥属于机器, 不属于账号。
function adminPrivateDenied(user, rel) {
  return isAdmin(user) && sharedDenied(rel);
}

function isAdmin(user) { return !!user && user.role === 'admin'; }

// 管理员 -> 全局加密库; 普通用户 -> 自己的独立加密库
function dbFor(user) {
  return isAdmin(user) ? store : userStoreFor(user.username);
}

// 文件操作日志写进操作者自己的库: 会员的上传/删除记录不能出现在管理员日志里
function logFor(user, level, msg) {
  if (isAdmin(user)) return store.log(level, msg);
  try { userStoreFor(user.username).touch(level, msg); } catch (e) { /* 日志失败不影响操作 */ }
}

// 管理员 -> 整个文件仓库; 普通用户 -> 自己的虚拟根目录
function fsRootFor(user) {
  return isAdmin(user) ? FILES : userFilesRoot(user.username);
}

function requireUnlocked(res) {
  if (!store.unlocked) { send(res, 423, { error: '数据库处于加密锁定状态, 请管理员登录后解锁' }); return false; }
  return true;
}

function featureEnabled(idf) {
  if (!store.unlocked) return true;
  const f = store.feature(idf);
  return !f || f.enabled;
}

function requireFeature(res, idf) {
  if (!featureEnabled(idf)) { send(res, 403, { error: `功能模块 [${idf}] 已被禁用` }); return false; }
  return true;
}

/* ---------------- API 路由 ---------------- */
const routes = [];
function route(method, pattern, ...handlers) { routes.push({ method, pattern, handlers }); }

route('POST', '/api/register', async (req, res) => {
  if (!config.registration) return send(res, 403, { error: '管理员已关闭新用户注册' });
  const ip = clientIp(req);
  if (!regAllowed(ip)) return send(res, 429, { error: '注册请求过于频繁, 请稍后再试' });
  const { username, password } = await readBody(req);
  try {
    const u = auth.register(String(username || ''), String(password || ''));
    quarantineOrphanSpace(u.username);
    ensureUserSpace(u.username);
    if (store.unlocked) store.log('info', `新用户注册: ${u.username} · 独立空间已分配`);
    const token = auth.createSession(u);
    send(res, 200, { ok: true, token, role: u.role, username: u.username, nodeId: nodeIdOf(u.username) });
  } catch (e) {
    send(res, 400, { error: e.message || '注册失败' });
  }
});

route('POST', '/api/login', async (req, res) => {
  const ip = clientIp(req);
  if (auth.isLocked(ip)) return send(res, 429, { error: '尝试次数过多, 已锁定 60 秒' });
  const { username, password, phone } = await readBody(req);
  const user = auth.verify(String(username || ''), String(password || ''));
  if (!user) { auth.recordFail(ip); return send(res, 401, { error: '账号、密码或安全手机号不正确' }); }
  // 已绑定安全手机号 = 第二因子; 密码正确但手机号缺失/错误同样拒绝
  if (auth.hasPhone(user.username) && !auth.verifyPhone(user.username, phone)) {
    auth.recordFail(ip);
    return send(res, 401, { error: '账号、密码或安全手机号不正确' });
  }
  auth.clearFail(ip);
  // 管理员登录 = 数据库解锁密码
  if (user.role === 'admin' && !store.unlocked) {
    if (!store.unlock(String(password))) return send(res, 500, { error: '数据库解锁失败' });
    store.log('info', `管理员 ${user.username} 登录, 数据库已解锁`);
  }
  if (user.role !== 'admin') ensureUserSpace(user.username);
  const token = auth.createSession(user);
  send(res, 200, { ok: true, token, role: user.role, username: user.username, nodeId: nodeIdOf(user.username) });
});

route('POST', '/api/logout', async (req, res) => {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  auth.destroy(token);
  send(res, 200, { ok: true });
});

route('GET', '/api/state', async (req, res) => {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const user = auth.check(token);
  send(res, 200, {
    ok: true,
    system: SYSTEM_NAME, version: VERSION,
    role: user ? user.role : null,
    username: user ? user.username : null,
    nodeId: user ? nodeIdOf(user.username) : null,
    registrationOpen: !!config.registration,
    locked: !store.unlocked,
    theme: store.unlocked && user && user.role === 'admin' ? store.doc.settings.theme : { ...DEFAULT_THEME },
    features: store.unlocked && user && user.role === 'admin' ? store.doc.features.filter(f => f.enabled).map(f => f.id) : [],
  });
});

route('GET', '/api/theme', async (req, res) => {
  send(res, 200, { theme: store.unlocked ? store.doc.settings.theme : { ...DEFAULT_THEME } });
});

// 更新提示与平台内公布的隧道地址: 只读, 不含账号/数据。隧道地址仍由 cloudflared 随机生成。
function currentPublicUrl() {
  if (tunnelState.url) return tunnelState.url;
  for (const f of [path.join(DATA, 'public_url.txt'), path.join(DATA, 'tunnel.url')]) {
    try {
      const u = fs.readFileSync(f, 'utf8').split('\n')[0].trim();
      if (/^https:\/\/\S+$/i.test(u)) return u;
    } catch (e) { /* 还没生成 */ }
  }
  return process.env.TS_PUBLIC_URL || '';
}

// 旧版本痕迹: 只看本机是否已经有加密库/会员空间/隧道记录。
// 它决定「要不要弹更新提示」——全新安装没有旧数据, 不打扰; 有数据的老副本才提示。
function hasExistingData() {
  try {
    if (fs.existsSync(path.join(DATA, 'system.db'))) return true;
    if (fs.existsSync(path.join(DATA, 'tunnel.url')) || fs.existsSync(path.join(DATA, 'public_url.txt'))) return true;
    if (fs.readdirSync(USERDATA).some(f => f.endsWith('.db'))) return true;
    if (fs.readdirSync(USER_FILES).length > 0) return true;
  } catch (e) { /* 目录还没建好时按「没有旧数据」处理 */ }
  return false;
}

// 官方最新版本: 只向发行接口要一个版本号, 不带账号/数据; 拿到比本机新的版本才提示。
// 缓存一小时, 失败就沿用上次结果 (没有结果就不提示) —— 离线部署不会被拖慢也不会误报。
const RELEASE_API = 'https://api.github.com/repos/IAMMEZSH/TenSaint73OS/releases/latest';
let releaseProbe = { at: 0, version: '' };

function versionOlder(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i];
  }
  return false;
}

function latestOfficialVersion() {
  if (Date.now() - releaseProbe.at < 3600 * 1000) return Promise.resolve(releaseProbe.version);
  releaseProbe.at = Date.now();
  return new Promise((resolve) => {
    const req = https.get(RELEASE_API, {
      headers: { 'User-Agent': 'TenSaint73OS', Accept: 'application/vnd.github+json' },
      timeout: 6000,
    }, (resp) => {
      if (resp.statusCode !== 200) { resp.resume(); return resolve(releaseProbe.version); }
      let body = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { if (body.length < 65536) body += c; });
      resp.on('end', () => {
        try {
          const tag = String(JSON.parse(body).tag_name || '').replace(/^v/i, '');
          if (/^\d+\.\d+\.\d+$/.test(tag)) releaseProbe.version = tag;
        } catch (e) { /* 不是 JSON 就当没拿到 */ }
        resolve(releaseProbe.version);
      });
      resp.on('error', () => resolve(releaseProbe.version));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(releaseProbe.version));
  });
}

route('GET', '/api/update', async (req, res) => {
  const latest = await latestOfficialVersion();
  send(res, 200, {
    version: VERSION,
    latest_version: latest,
    update_available: !!latest && versionOlder(VERSION, latest),
    official_url: OFFICIAL_URL,
    releases_url: RELEASES_URL,
    data_present: hasExistingData(),
    data_preserved: true,
    auto_reconnect: true,
  });
});

route('GET', '/api/access', async (req, res) => {
  send(res, 200, {
    version: VERSION,
    tunnel_url: currentPublicUrl(),
    official_url: RELEASES_URL,
  });
});

// ---- 以下全部需要管理员 + 数据库解锁 ----
route('GET', '/api/overview', async (req, res, user) => {
  if (!requireFeature(res, 'dashboard')) return;
  const tables = Object.keys(store.doc.tables);
  let rows = 0;
  for (const t of tables) rows += store.doc.tables[t].rows.length;
  let fileCount = 0, fileSize = 0;
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p); else { fileCount++; fileSize += st.size; }
    }
  })(FILES);
  send(res, 200, {
    system: SYSTEM_NAME, version: VERSION, uptime: uptime(), node: process.version,
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    key: systemKey, keyStatus: manifestStatus === 'OK' ? '稳定' : '已自动轮换',
    tables: tables.length, rows, users: auth.listUsers().length,
    files: fileCount, fileSize,
    features: store.doc.features.length,
    enabledFeatures: store.doc.features.filter(f => f.enabled).length,
    ips: listIps(), port: config.port,
    urls: accessUrls(),
    locked: false,
  });
});

route('GET', '/api/db/tables', async (req, res, user) => {
  if (isAdmin(user) && !requireFeature(res, 'database')) return;
  const s = dbFor(user);
  send(res, 200, {
    tables: s.listTables().map(n => {
      const t = s.doc.tables[n];
      return { name: n, columns: t.columns, count: t.rows.length };
    }),
    scope: isAdmin(user) ? 'global' : 'private',
  });
});

route('POST', '/api/db/create', async (req, res, user) => {
  const { name, columns } = await readBody(req);
  dbFor(user).createTable(name, columns);
  send(res, 200, { ok: true });
});

route('POST', '/api/db/drop', async (req, res, user) => {
  const { name } = await readBody(req);
  dbFor(user).dropTable(name);
  send(res, 200, { ok: true });
});

route('GET', '/api/db/table', async (req, res, user) => {
  const name = decodeURIComponent((req.url.split('?')[1] || '').split('&').find(s => s.startsWith('name=')) || '').replace('name=', '');
  const t = dbFor(user).getTable(name);
  if (!t) return send(res, 404, { error: '表不存在' });
  send(res, 200, t);
});

route('POST', '/api/db/insert', async (req, res, user) => {
  const { table, row } = await readBody(req);
  send(res, 200, { ok: true, row: dbFor(user).insert(table, row || {}) });
});

route('POST', '/api/db/update', async (req, res, user) => {
  const { table, id, patch } = await readBody(req);
  send(res, 200, { ok: true, row: dbFor(user).update(table, id, patch || {}) });
});

route('POST', '/api/db/delete', async (req, res, user) => {
  const { table, id } = await readBody(req);
  dbFor(user).remove(table, id);
  send(res, 200, { ok: true });
});

route('POST', '/api/db/clear', async (req, res, user) => {
  const { table } = await readBody(req);
  dbFor(user).clear(table);
  send(res, 200, { ok: true });
});

route('POST', '/api/db/addcol', async (req, res, user) => {
  const { table, col } = await readBody(req);
  dbFor(user).addColumn(table, col);
  send(res, 200, { ok: true });
});

route('POST', '/api/db/delcol', async (req, res, user) => {
  const { table, col } = await readBody(req);
  dbFor(user).removeColumn(table, col);
  send(res, 200, { ok: true });
});

// ---- 文件仓库 (加密落盘) ----
// 文件密钥派生自本机 install.salt, 与数据库密钥分离: 仓库文件单独被拷走也读不出内容。
const FILE_MAGIC = 'TSF1';
let _fileKey = null;
function fileKey() {
  if (!_fileKey) _fileKey = cryptoUtil.deriveKey(INSTALL_SALT, 'TenSaint73OS::files::v1');
  return _fileKey;
}
function sealBytes(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', fileKey(), iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([Buffer.from(FILE_MAGIC, 'latin1'), iv, cipher.getAuthTag(), enc]);
}
function unsealBytes(buf) {
  const iv = buf.subarray(4, 16);
  const tag = buf.subarray(16, 32);
  const enc = buf.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', fileKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}
const isSealed = buf => buf.length > 32 && buf.subarray(0, 4).toString('latin1') === FILE_MAGIC;

route('GET', '/api/fs/list', async (req, res, user) => {
  if (isAdmin(user) && !requireFeature(res, 'files')) return;
  const root = fsRootFor(user);
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  const rel = sharedRel(q.get('path') || '');
  if (adminPrivateDenied(user, rel)) return send(res, 403, { error: '会员私有空间只对本人开放' });
  const dir = util.safeJoin(root, rel);
  if (!dir || !fs.existsSync(dir)) return send(res, 404, { error: '目录不存在' });
  const items = fs.readdirSync(dir).map(f => {
    const st = fs.statSync(path.join(dir, f));
    return { name: f, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs };
  }).filter(it => !(isAdmin(user) && !rel && it.name.toLowerCase() === PRIVATE_DIR))
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  send(res, 200, { path: rel, items, scope: isAdmin(user) ? 'global' : 'private' });
});

route('POST', '/api/fs/mkdir', async (req, res, user) => {
  const { path: rel, name } = await readBody(req);
  const root = fsRootFor(user);
  const base = sharedRel(rel || '');
  const clean = String(name || '').replace(/[\\/:*?"<>|]/g, '_');
  const targetRel = path.posix.join(base, clean);
  if (adminPrivateDenied(user, targetRel)) return send(res, 403, { error: '会员私有空间只对本人开放' });
  const dir = util.safeJoin(root, targetRel);
  if (!dir) return send(res, 400, { error: '非法路径' });
  fs.mkdirSync(dir, { recursive: true });
  logFor(user, 'info', `创建目录 ${name}`);
  send(res, 200, { ok: true });
});

route('POST', '/api/fs/upload', async (req, res, user) => {
  const { path: rel, name, data } = await readBody(req);
  const root = fsRootFor(user);
  const base = sharedRel(rel || '');
  const clean = String(name || 'file').replace(/[\\/:*?"<>|]/g, '_');
  const targetRel = path.posix.join(base, clean);
  if (adminPrivateDenied(user, targetRel)) return send(res, 403, { error: '会员私有空间只对本人开放' });
  const file = util.safeJoin(root, targetRel);
  if (!file) return send(res, 400, { error: '非法路径' });
  const plain = Buffer.from(String(data || ''), 'base64');
  fs.writeFileSync(file, sealBytes(plain));
  logFor(user, 'info', `上传文件 ${clean} (${Math.round(plain.length / 1024)}KB, 已加密落盘)`);
  send(res, 200, { ok: true });
});

route('POST', '/api/fs/delete', async (req, res, user) => {
  const { path: rel } = await readBody(req);
  const root = fsRootFor(user);
  const base = sharedRel(rel || '');
  if (adminPrivateDenied(user, base)) return send(res, 403, { error: '会员私有空间只对本人开放' });
  const p = util.safeJoin(root, base);
  if (!p || p === root) return send(res, 400, { error: '非法路径' });
  if (!fs.existsSync(p)) return send(res, 404, { error: '不存在' });
  fs.rmSync(p, { recursive: true, force: true });
  logFor(user, 'warn', `删除 ${rel}`);
  send(res, 200, { ok: true });
});

route('GET', '/api/fs/download', async (req, res, user) => {
  const root = fsRootFor(user);
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  const rel = sharedRel(q.get('path') || '');
  if (adminPrivateDenied(user, rel)) return send(res, 403, { error: '会员私有空间只对本人开放' });
  const p = util.safeJoin(root, rel);
  if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) return send(res, 404, { error: '文件不存在' });
  const raw = fs.readFileSync(p);
  let out = raw;
  if (isSealed(raw)) {
    try { out = unsealBytes(raw); }
    catch (e) { return send(res, 500, { error: '文件解密失败: install.salt 与该文件不匹配 (文件被单独拷走过)' }); }
  }
  res.writeHead(200, Object.assign({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(p))}` }, SEC_HEADERS));
  res.end(out);
});

// ---- 用户管理 ----
route('GET', '/api/users', async (req, res, user) => {
  if (!requireFeature(res, 'users')) return;
  send(res, 200, { users: auth.listUsers() });
});

route('POST', '/api/users/create', async (req, res, user) => {
  const { username, password, role } = await readBody(req);
  if (role === 'admin') return send(res, 400, { error: '最高管理员全机唯一, 只能通过 .tsowner 导入建立; 控制台只能新增会员' });
  const name = String(username || '');
  try { auth.addUser(name, String(password)); }
  catch (e) { return send(res, 400, { error: e.message }); }
  quarantineOrphanSpace(name);
  ensureUserSpace(name);
  store.log('info', `新建用户 ${name}`);
  send(res, 200, { ok: true });
});

route('POST', '/api/users/delete', async (req, res, user) => {
  const { username } = await readBody(req);
  if (username === user.username) return send(res, 400, { error: '不能删除当前登录账户' });
  const name = String(username);
  // 账号一经删除就销毁其私有空间: 如果保留目录, 任何人用同名重新注册都能接管旧数据,
  // 这等于给「最高管理员也读不到别人私有数据」开了一条侧门。
  auth.removeUser(name);
  userStores.delete(name);
  try { fs.rmSync(path.join(USER_FILES, workspaceName(name)), { recursive: true, force: true }); } catch (e) { /* 已不存在 */ }
  try { fs.rmSync(path.join(USERDATA, util.sha256(name).slice(0, 32) + '.db'), { force: true }); } catch (e) { /* 已不存在 */ }
  store.log('warn', `删除用户 ${name}, 私有数据库与文件已销毁`);
  send(res, 200, { ok: true });
});

route('GET', '/api/users/space', async (req, res, user) => {
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  const name = String(q.get('username') || '');
  // 私有空间统计只给本人看: 管理员也没有读别人表名/行数/文件数/活动的入口
  if (name !== user.username) return send(res, 403, { error: '私有空间只对本人开放' });
  const u = auth.getUser(name);
  if (!u) return send(res, 404, { error: '用户不存在' });
  const us = userStoreFor(name);
  send(res, 200, {
    username: name, role: u.role, nodeId: nodeIdOf(name), createdAt: u.createdAt,
    phoneBound: !!u.phoneBound,
    workspace: workspaceName(name),
    tables: us.tableMeta(), files: dirStats(userFilesRoot(name)),
    activity: us.doc.activity.slice(0, 30), totals: us.stats(),
  });
});

route('POST', '/api/users/password', async (req, res, user) => {
  const { username, password } = await readBody(req);
  const target = String(username);
  // 管理员不能替别人改密再登录进去读私有数据; 改密只允许本人
  if (target !== user.username) return send(res, 403, { error: '只能修改自己的密码; 私有数据只对本人开放' });
  const np = String(password || '');
  if (np.length < 8) return send(res, 400, { error: '密码至少 8 位' });
  auth.changePassword(target, np);          // 内部已吊销该用户全部在线令牌
  // 管理员改自己的密码 = 数据库派生密钥变了, 必须立刻用新密码重新加密整库
  const rekeyed = (target === user.username && store.unlocked) ? store.rekey(np) : false;
  store.log('warn', `修改用户 ${target} 的密码${rekeyed ? ' (数据库已用新密码重新加密)' : ''}`);
  send(res, 200, { ok: true, relogin: target === user.username, rekeyed });
});

// ---- 授权管理 (仅最高权限账号) ----
function listDirs() {
  const out = [];
  (function walk(rel) {
    const abs = util.safeJoin(FILES, rel);
    if (!abs || !fs.existsSync(abs)) return;
    for (const f of fs.readdirSync(abs)) {
      // 会员私有空间不可授权 (共享接口在读取层也会拒绝), 所以不把它列进可授权目录
      if (!rel && f.toLowerCase() === PRIVATE_DIR) continue;
      const st = fs.lstatSync(path.join(abs, f));
      if (st.isSymbolicLink() || !st.isDirectory()) continue;
      const sub = rel ? rel + '/' + f : f;
      out.push(sub);
      if (out.length < 500) walk(sub);
    }
  })('');
  return out;
}

route('GET', '/api/grants', async (req, res, user) => {
  send(res, 200, {
    users: auth.listUsers().filter(u => u.role !== 'admin').map(u => ({ username: u.username, grants: u.grants })),
    tables: store.listTables(),
    dirs: listDirs(),
  });
});

route('POST', '/api/grants/set', async (req, res, user) => {
  const { username, grants } = await readBody(req);
  // 私有空间目录即便被写进授权也不生效 (共享接口在读取层拒绝), 这里直接丢掉, 免得界面显示一条假授权
  if (grants && grants.files && typeof grants.files === 'object') {
    for (const k of Object.keys(grants.files)) if (sharedDenied(sharedRel(k))) delete grants.files[k];
  }
  const g = auth.setGrants(String(username), grants);
  const n = Object.keys(g.tables).length + Object.keys(g.files).length;
  store.log('warn', `设置用户 ${username} 的数据授权 (${n} 项)`);
  send(res, 200, { ok: true, grants: g });
});

// ---- 会员个人空间 ----
route('GET', '/api/my', async (req, res, user) => {
  if (isAdmin(user)) {
    return send(res, 200, { username: user.username, role: 'admin', nodeId: nodeIdOf(user.username) });
  }
  const us = ensureUserSpace(user.username);
  const u = auth.getUser(user.username);
  send(res, 200, {
    username: user.username,
    role: 'user',
    phoneBound: !!(u && u.phoneBound),
    nodeId: nodeIdOf(user.username),
    createdAt: u ? u.createdAt : null,
    workspace: workspaceName(user.username),
    tables: us.tableMeta(),
    files: dirStats(userFilesRoot(user.username)),
    activity: us.doc.activity.slice(0, 20),
    totals: us.stats(),
    server: { version: VERSION, uptime: uptime(), node: process.version },
  });
});

// ---- 安全手机号 (仅本人可见) ----
function bearerOf(req) {
  return (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || (req.headers['x-token'] || '');
}

route('GET', '/api/me/phone', async (req, res, user) => {
  const rec = auth.getPhone(user.username);
  send(res, 200, {
    ok: true,
    bound: !!rec,
    phone: rec ? rec.phone : null,
    boundAt: rec ? rec.boundAt : null,
    enforced: !!rec,
  });
});

route('POST', '/api/me/phone', async (req, res, user) => {
  const { password, phone, currentPhone } = await readBody(req);
  if (!auth.verify(user.username, String(password || ''))) {
    return send(res, 403, { error: '当前密码不正确' });
  }
  const wasBound = auth.hasPhone(user.username);
  if (wasBound && !auth.verifyPhone(user.username, currentPhone)) {
    return send(res, 403, { error: '当前绑定的手机号不正确' });
  }
  let rec;
  try { rec = auth.setPhone(user.username, phone); }
  catch (e) { return send(res, 400, { error: e.message }); }
  const killed = auth.destroyOtherSessions(user.username, bearerOf(req));
  if (store.unlocked) store.log('warn', `用户 ${user.username} ${wasBound ? '更新' : '绑定'}了安全手机号 (号码加密保存)`);
  send(res, 200, { ok: true, bound: true, phone: rec.phone, boundAt: rec.boundAt, killed });
});

route('POST', '/api/me/phone/unbind', async (req, res, user) => {
  const { password, phone } = await readBody(req);
  if (!auth.hasPhone(user.username)) return send(res, 400, { error: '尚未绑定安全手机号' });
  if (!auth.verify(user.username, String(password || ''))) {
    return send(res, 403, { error: '当前密码不正确' });
  }
  if (!auth.verifyPhone(user.username, phone)) {
    return send(res, 403, { error: '当前绑定的手机号不正确' });
  }
  auth.clearPhone(user.username);
  const killed = auth.destroyOtherSessions(user.username, bearerOf(req));
  if (store.unlocked) store.log('warn', `用户 ${user.username} 解除了安全手机号绑定`);
  send(res, 200, { ok: true, bound: false, killed });
});

route('POST', '/api/me/password', async (req, res, user) => {
  const { oldPassword, newPassword } = await readBody(req);
  const np = String(newPassword || '');
  if (np.length < 8) return send(res, 400, { error: '新密码至少 8 位' });
  if (!auth.verify(user.username, String(oldPassword || ''))) {
    return send(res, 403, { error: '当前密码不正确' });
  }
  auth.changePassword(user.username, np);   // 内部吊销该账号全部在线令牌
  if (store.unlocked && isAdmin(user)) store.rekey(np);
  logFor(user, 'warn', `用户 ${user.username} 修改了自己的密码`);
  send(res, 200, { ok: true, relogin: true });
});

// 会员自助注销: 校验密码 (绑定时再校验手机号), 然后彻底销毁账号与私有空间。
route('POST', '/api/me/delete', async (req, res, user) => {
  if (isAdmin(user)) return send(res, 403, { error: '最高管理员账号不可在此注销' });
  const { password, phone } = await readBody(req);
  if (!auth.verify(user.username, String(password || ''))) {
    return send(res, 403, { error: '当前密码不正确' });
  }
  if (auth.hasPhone(user.username) && !auth.verifyPhone(user.username, phone)) {
    return send(res, 403, { error: '安全手机号不正确' });
  }
  auth.removeUser(user.username);
  userStores.delete(user.username);
  try { fs.rmSync(path.join(USER_FILES, workspaceName(user.username)), { recursive: true, force: true }); } catch (e) { /* 已不存在 */ }
  try { fs.rmSync(path.join(USERDATA, util.sha256(user.username).slice(0, 32) + '.db'), { force: true }); } catch (e) { /* 已不存在 */ }
  if (store.unlocked) store.log('warn', `会员 ${user.username} 永久注销账号, 私有数据库与文件已销毁`);
  send(res, 200, { ok: true, deleted: true });
});

/* ---------------- 共享空间 (会员按显式授权访问全局资源) ---------------- */
// 管理员未解锁时全局库和文件密钥都在管理员密码后面, 因此共享数据不可用——如实返回 423,
// 不退回成空列表, 否则界面会把"暂时打不开"显示成"管理员什么都没给你"。
function sharedTableLevel(user, name) {
  return auth.getGrants(user.username).tables[name] || null;
}

function sharedTableGate(res, user, name, needWrite) {
  if (!store.unlocked) { send(res, 423, { error: '所有者尚未登录解锁, 共享数据暂时不可用' }); return null; }
  // 先判授权再判存在: 否则未授权的人可以用 404/403 的差异探测全局表名
  const lvl = sharedTableLevel(user, name);
  if (!lvl) { send(res, 403, { error: '数据表 [' + name + '] 未授权给你' }); return null; }
  if (needWrite && lvl !== 'rw') { send(res, 403, { error: '数据表 [' + name + '] 对你是只读' }); return null; }
  if (!store.doc.tables[name]) { send(res, 404, { error: '表不存在: ' + name }); return null; }
  return lvl;
}

function sharedFsGate(res, user, rawRel, needWrite) {
  if (!store.unlocked) { send(res, 423, { error: '所有者尚未登录解锁, 共享数据暂时不可用' }); return null; }
  const rel = sharedRel(rawRel);
  if (sharedDenied(rel)) { send(res, 403, { error: '该路径不在共享范围内' }); return null; }
  if (!auth.hasFileAccess(user.username, rel, needWrite)) {
    send(res, 403, { error: needWrite ? '该目录对你是只读或未授权' : '该目录未授权给你' });
    return null;
  }
  const abs = util.safeJoin(FILES, rel);
  if (!abs) { send(res, 400, { error: '非法路径' }); return null; }
  return abs;
}

route('GET', '/api/shared', async (req, res, user) => {
  if (!store.unlocked) return send(res, 200, { unlocked: false, tables: [], dirs: [] });
  const g = auth.getGrants(user.username);
  const tables = Object.keys(g.tables).filter(n => !!store.doc.tables[n]).map(n => {
    const t = store.doc.tables[n];
    return { name: n, columns: t.columns, count: t.rows.length, level: g.tables[n] };
  });
  const dirs = Object.keys(g.files).filter(p => !sharedDenied(sharedRel(p)))
    .map(p => ({ path: sharedRel(p), level: g.files[p] }));
  send(res, 200, { unlocked: true, tables, dirs });
});

route('GET', '/api/shared/db/tables', async (req, res, user) => {
  if (!store.unlocked) return send(res, 423, { error: '所有者尚未登录解锁, 共享数据暂时不可用' });
  const g = auth.getGrants(user.username);
  const tables = Object.keys(g.tables).filter(n => !!store.doc.tables[n]).map(n => ({
    name: n, columns: store.doc.tables[n].columns, count: store.doc.tables[n].rows.length, level: g.tables[n],
  }));
  send(res, 200, { tables });
});

route('GET', '/api/shared/db/table', async (req, res, user) => {
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  const name = q.get('name') || '';
  if (!sharedTableGate(res, user, name, false)) return;
  send(res, 200, store.getTable(name));
});

route('POST', '/api/shared/db/insert', async (req, res, user) => {
  const { table, row } = await readBody(req);
  if (!sharedTableGate(res, user, table, true)) return;
  const r = store.insert(table, row || {});
  store.log('info', `会员 ${user.username} 向共享表 [${table}] 插入 1 行`);
  send(res, 200, { ok: true, row: r });
});

route('POST', '/api/shared/db/update', async (req, res, user) => {
  const { table, id, patch } = await readBody(req);
  if (!sharedTableGate(res, user, table, true)) return;
  const r = store.update(table, id, patch || {});
  store.log('info', `会员 ${user.username} 更新共享表 [${table}] 1 行`);
  send(res, 200, { ok: true, row: r });
});

route('POST', '/api/shared/db/delete', async (req, res, user) => {
  const { table, id } = await readBody(req);
  if (!sharedTableGate(res, user, table, true)) return;
  store.remove(table, id);
  store.log('warn', `会员 ${user.username} 删除共享表 [${table}] 1 行`);
  send(res, 200, { ok: true });
});

route('GET', '/api/shared/fs/list', async (req, res, user) => {
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  const rel = sharedRel(q.get('path') || '');
  const abs = sharedFsGate(res, user, rel, false);
  if (!abs) return;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return send(res, 404, { error: '目录不存在' });
  // 根目录下永远隐藏私有空间目录, 即便管理员把根目录 "" 授权出去
  const items = fs.readdirSync(abs)
    .filter(f => !(rel === '' && f.toLowerCase() === PRIVATE_DIR))
    .map(f => {
      const full = path.join(abs, f);
      const st = fs.lstatSync(full);
      // 符号链接可以绕开 safeJoin 的字符级检查, 一律不当作目录/文件展示
      return { name: f, dir: !st.isSymbolicLink() && st.isDirectory(), size: st.size, mtime: st.mtimeMs, link: st.isSymbolicLink() };
    }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  send(res, 200, { path: rel, items, scope: 'shared' });
});

route('GET', '/api/shared/fs/download', async (req, res, user) => {
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  const abs = sharedFsGate(res, user, q.get('path') || '', false);
  if (!abs) return;
  if (!fs.existsSync(abs) || !fs.lstatSync(abs).isFile()) return send(res, 404, { error: '文件不存在' });
  const raw = fs.readFileSync(abs);
  let out = raw;
  if (isSealed(raw)) {
    try { out = unsealBytes(raw); }
    catch (e) { return send(res, 500, { error: '文件解密失败: install.salt 与该文件不匹配' }); }
  }
  res.writeHead(200, Object.assign({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
  }, SEC_HEADERS));
  res.end(out);
});

route('POST', '/api/shared/fs/upload', async (req, res, user) => {
  const { path: rel, name, data } = await readBody(req);
  const clean = String(name || 'file').replace(/[\\/:*?"<>|]/g, '_');
  if (!clean || clean === '.' || clean === '..') return send(res, 400, { error: '非法文件名' });
  const abs = sharedFsGate(res, user, path.join(sharedRel(rel), clean), true);
  if (!abs) return;
  const plain = Buffer.from(String(data || ''), 'base64');
  fs.writeFileSync(abs, sealBytes(plain));
  store.log('info', `会员 ${user.username} 向共享目录上传 ${clean} (${Math.round(plain.length / 1024)}KB)`);
  send(res, 200, { ok: true });
});

route('POST', '/api/shared/fs/mkdir', async (req, res, user) => {
  const { path: rel, name } = await readBody(req);
  const clean = String(name || '').replace(/[\\/:*?"<>|]/g, '_');
  if (!clean || clean === '.' || clean === '..') return send(res, 400, { error: '非法文件夹名' });
  const abs = sharedFsGate(res, user, path.join(sharedRel(rel), clean), true);
  if (!abs) return;
  fs.mkdirSync(abs, { recursive: true });
  store.log('info', `会员 ${user.username} 在共享目录新建文件夹 ${clean}`);
  send(res, 200, { ok: true });
});

route('POST', '/api/shared/fs/delete', async (req, res, user) => {
  const { path: rel } = await readBody(req);
  const abs = sharedFsGate(res, user, rel, true);
  if (!abs) return;
  if (abs === util.safeJoin(FILES, '')) return send(res, 400, { error: '不能删除共享根目录' });
  if (!fs.existsSync(abs)) return send(res, 404, { error: '不存在' });
  fs.rmSync(abs, { recursive: true, force: true });
  store.log('warn', `会员 ${user.username} 删除共享路径 ${sharedRel(rel)}`);
  send(res, 200, { ok: true });
});

// ---- 功能模块 ----
route('GET', '/api/features', async (req, res, user) => {
  send(res, 200, { features: store.doc.features });
});

route('POST', '/api/features/toggle', async (req, res, user) => {
  const { id, enabled } = await readBody(req);
  store.setFeatureEnabled(id, enabled);
  send(res, 200, { ok: true });
});

route('POST', '/api/features/add', async (req, res, user) => {
  const { name, desc } = await readBody(req);
  store.addFeature(name, desc);
  send(res, 200, { ok: true });
});

route('POST', '/api/features/remove', async (req, res, user) => {
  const { id } = await readBody(req);
  store.removeFeature(id);
  send(res, 200, { ok: true });
});

// ---- 主题 ----
route('POST', '/api/theme/set', async (req, res, user) => {
  if (!requireFeature(res, 'theme')) return;
  const { theme } = await readBody(req);
  store.doc.settings.theme = Object.assign({}, DEFAULT_THEME, store.doc.settings.theme, theme || {});
  store.save();
  send(res, 200, { ok: true, theme: store.doc.settings.theme });
});

route('POST', '/api/theme/reset', async (req, res, user) => {
  store.doc.settings.theme = { ...DEFAULT_THEME };
  store.save();
  store.log('info', '主题恢复默认');
  send(res, 200, { ok: true, theme: store.doc.settings.theme });
});

// ---- 日志 ----
route('GET', '/api/logs', async (req, res, user) => {
  if (!requireFeature(res, 'logs')) return;
  send(res, 200, { logs: store.doc.logs.slice(-300).reverse() });
});

route('POST', '/api/logs/clear', async (req, res, user) => {
  store.doc.logs = [];
  store.save();
  send(res, 200, { ok: true });
});

// ---- AI ----
route('POST', '/api/ai', async (req, res, user) => {
  if (!requireFeature(res, 'ai')) return;
  const { message } = await readBody(req);
  const result = ai.handle(String(message || ''), { store, sys: sysCtx });
  send(res, 200, result);
});

// ---- 网络 / 系统 ----
function listIps() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of ifs[name] || []) {
      if (it.family === 'IPv4' && !it.internal) out.push({ name, address: it.address });
    }
  }
  return out;
}

function accessUrls() {
  syncTunnelUrl();
  const out = [];
  const cur = store.unlocked ? (store.doc.urls || []).find(u => u.current) : null;
  if (cur) out.push({ label: '全球访问 (隧道)', url: cur.url });
  else if (process.env.TS_PUBLIC_URL) out.push({ label: '全球访问 (隧道)', url: process.env.TS_PUBLIC_URL });
  out.push({ label: '本机访问', url: `http://localhost:${config.port}` });
  if (!LOOPBACK_ONLY) for (const i of listIps()) out.push({ label: `局域网 [${i.name}]`, url: `http://${i.address}:${config.port}` });
  return out;
}

route('GET', '/api/network', async (req, res, user) => {
  if (!requireFeature(res, 'network')) return;
  send(res, 200, {
    port: config.port,
    ips: listIps(),
    online: true,
    urls: accessUrls(),
  });
});

/* ---------------- 网址板块: 访问地址 + 历史 + 删除 ---------------- */
// run-online.sh 申请到隧道地址后写入 data/tunnel.url, 这里按需读入并记入历史。
// 只落 data/, 不在 PROTECTED() 覆盖范围内, 因此不会触发系统密钥轮换。
const TUNNEL_URL_FILE = path.join(DATA, 'tunnel.url');
const URL_HISTORY_MAX = 200;

function cleanUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('地址不能为空');
  if (s.length > 300) throw new Error('地址过长');
  let u;
  try { u = new URL(s); } catch (e) { throw new Error('地址格式无效'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只支持 http / https 地址');
  if (u.username || u.password) throw new Error('地址里不能内嵌账号密码');
  if (s.includes('\n') || s.includes('\r')) throw new Error('地址不能包含换行');
  return s;
}

function syncTunnelUrl() {
  if (!store.unlocked) return;
  let raw = '';
  try { raw = fs.readFileSync(TUNNEL_URL_FILE, 'utf8'); } catch (e) { return; }
  const url = String(raw).split('\n')[0].trim();
  if (!/^https:\/\/\S+$/i.test(url)) return;
  if ((store.doc.urls || []).some(u => u.url === url)) return;
  store.addUrl({ url, name: '隧道地址', note: `由 run-online.sh 于 ${new Date().toLocaleString('zh-CN')} 自动上报`, source: '自动', current: true });
  store.log('info', `新的对外地址已记入网址板块: ${url}`);
}

/* ---------------- 平台内隧道开关 (管理员) ---------------- */
const TUNNEL_DIR = path.join(ROOT, 'tools');
const tunnelState = { proc: null, running: false, url: '', startedAt: 0, error: '', exitCode: null, log: [] };

function cloudflaredName() { return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'; }

function cloudflaredCandidates() {
  const name = cloudflaredName();
  const list = [];
  if (process.env.TS_CLOUDFLARED) list.push(process.env.TS_CLOUDFLARED);
  list.push(path.join(TUNNEL_DIR, name), path.join(ROOT, name));
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    if (d) list.push(path.join(d, name));
  }
  return list;
}

function findCloudflared() {
  for (const p of cloudflaredCandidates()) {
    try { if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (e) { /* 忽略 */ }
  }
  return null;
}

function tunnelStatus() {
  const bin = findCloudflared();
  return {
    supported: !!bin,
    binary: bin,
    running: tunnelState.running,
    url: tunnelState.url,
    startedAt: tunnelState.startedAt || null,
    error: tunnelState.error,
    exitCode: tunnelState.exitCode,
    recent: tunnelState.log.slice(-6),
  };
}

function startTunnel() {
  if (tunnelState.running) return;
  const bin = findCloudflared();
  if (!bin) throw new Error('未检测到 cloudflared 隧道组件, 请先在本页安装或手动放入 tools/ 目录');
  tunnelState.error = ''; tunnelState.url = ''; tunnelState.exitCode = null;
  tunnelState.startedAt = Date.now(); tunnelState.log = [];
  // 部分网络 UDP/QUIC 受限, 固定走 HTTP/2 + IPv4 才能稳定拿到地址
  const args = ['tunnel', '--url', `http://127.0.0.1:${config.port}`, '--no-autoupdate', '--protocol', 'http2', '--edge-ip-version', '4'];
  const child = spawn(bin, args, { cwd: DATA, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  tunnelState.proc = child;
  tunnelState.running = true;
  let urlSeen = false;
  const onData = (buf) => {
    const text = buf.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      tunnelState.log.push(s);
      if (tunnelState.log.length > 40) tunnelState.log.shift();
    }
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (m && !urlSeen) {
      urlSeen = true;
      tunnelState.url = m[0];
      try { fs.writeFileSync(TUNNEL_URL_FILE, tunnelState.url + '\n'); } catch (e) { /* 忽略 */ }
      try { fs.writeFileSync(path.join(DATA, 'public_url.txt'), tunnelState.url + '\n'); } catch (e) { /* 忽略 */ }
      if (store.unlocked) {
        try {
          if (!(store.doc.urls || []).some(u => u.url === tunnelState.url)) {
            store.addUrl({ url: tunnelState.url, name: '隧道地址', note: '由平台内隧道开关自动申请', source: '自动', current: true });
          }
          store.log('info', `平台内隧道已建立: ${tunnelState.url}`);
        } catch (e) { /* 忽略 */ }
      }
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => {
    tunnelState.running = false;
    tunnelState.proc = null;
    tunnelState.error = e.message;
  });
  child.on('exit', (code) => {
    tunnelState.running = false;
    tunnelState.proc = null;
    tunnelState.exitCode = code;
    if (!urlSeen) tunnelState.error = tunnelState.error || `cloudflared 已退出 (${code})`;
  });
  setTimeout(() => {
    if (tunnelState.proc === child && !urlSeen) {
      tunnelState.error = '隧道申请超时: 请确认本机网络可访问 Cloudflare';
    }
  }, 45000);
}

function stopTunnel() {
  const child = tunnelState.proc;
  tunnelState.running = false;
  tunnelState.proc = null;
  tunnelState.startedAt = 0;
  tunnelState.url = '';
  tunnelState.error = '';
  if (child) { try { child.kill(); } catch (e) { /* 忽略 */ } }
}

function cloudflaredAsset() {
  const key = `${process.platform}-${process.arch}`;
  return {
    'win32-x64': 'cloudflared-windows-amd64.exe',
    'win32-ia32': 'cloudflared-windows-386.exe',
    'win32-arm64': 'cloudflared-windows-arm64.exe',
    'linux-x64': 'cloudflared-linux-amd64',
    'linux-arm64': 'cloudflared-linux-arm64',
    'linux-ia32': 'cloudflared-linux-386',
    'linux-arm': 'cloudflared-linux-arm',
    'darwin-x64': 'cloudflared-darwin-amd64.tgz',
    'darwin-arm64': 'cloudflared-darwin-arm64.tgz',
  }[key] || null;
}

route('GET', '/api/tunnel/status', async (req, res) => {
  if (!requireFeature(res, 'network')) return;
  send(res, 200, tunnelStatus());
});

route('POST', '/api/tunnel/start', async (req, res) => {
  if (!requireFeature(res, 'network')) return;
  try { startTunnel(); send(res, 200, tunnelStatus()); }
  catch (e) { send(res, 400, { error: e.message }); }
});

route('POST', '/api/tunnel/stop', async (req, res) => {
  if (!requireFeature(res, 'network')) return;
  stopTunnel();
  send(res, 200, tunnelStatus());
});

const CLOUDFLARED_MIRRORS = [
  (u) => u,
  (u) => 'https://gh-proxy.com/' + u,
  (u) => 'https://ghfast.top/' + u,
  (u) => 'https://ghproxy.net/' + u,
];

route('POST', '/api/tunnel/install', async (req, res) => {
  if (!requireFeature(res, 'network')) return;
  const asset = cloudflaredAsset();
  if (!asset) {
    return send(res, 400, { error: `当前平台 ${process.platform}/${process.arch} 没有对应的 cloudflared, 请手动安装` });
  }
  util.ensureDir(TUNNEL_DIR);
  const dest = path.join(TUNNEL_DIR, cloudflaredName());
  try {
    const size = fs.statSync(dest).size;
    if (size > 1024 * 1024) return send(res, 200, { ok: true, binary: dest, bytes: size, existing: true });
  } catch (e) { /* 尚未安装, 继续下载 */ }
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  const isTgz = asset.endsWith('.tgz');
  const archive = path.join(TUNNEL_DIR, asset);
  const errors = [];
  for (const mirror of CLOUDFLARED_MIRRORS) {
    try {
      await downloadToFile(mirror(url), isTgz ? archive : dest);
      if (isTgz) {
        execFileSync('tar', ['-xzf', archive, '-C', TUNNEL_DIR], { timeout: 60000, windowsHide: true });
        try { fs.unlinkSync(archive); } catch (e) { /* 忽略 */ }
        if (!fs.existsSync(dest)) throw new Error('压缩包内未找到 cloudflared');
      }
      if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
      if (process.platform === 'win32') {
        const sig = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath "${dest}").Status`], { encoding: 'utf8', timeout: 20000, windowsHide: true }).trim();
        if (sig !== 'Valid') throw new Error('签名校验失败 (' + sig + ')');
      }
      execFileSync(dest, ['--version'], { timeout: 60000, stdio: 'ignore', windowsHide: true });
      if (store.unlocked) store.log('info', `已安装 cloudflared 隧道组件 (${asset})`);
      return send(res, 200, { ok: true, binary: dest, bytes: fs.statSync(dest).size });
    } catch (e) {
      errors.push(e.message);
      for (const f of [dest, dest + '.part', archive, archive + '.part']) {
        try { fs.unlinkSync(f); } catch (e2) { /* 忽略 */ }
      }
    }
  }
  send(res, 400, { error: '隧道组件下载失败: ' + errors.join(' | ') + ' (可手动下载 cloudflared 放入 tools/ 目录)' });
});

route('GET', '/api/urls', async (req, res, user) => {
  if (!requireFeature(res, 'urls')) return;
  syncTunnelUrl();
  const list = store.listUrls();
  send(res, 200, {
    urls: list,
    current: list.find(u => u.current) || null,
    local: `http://127.0.0.1:${config.port}`,
    max: URL_HISTORY_MAX,
  });
});

route('POST', '/api/urls/add', async (req, res, user) => {
  const { url, name, note, setAsCurrent } = await readBody(req);
  let clean;
  try { clean = cleanUrl(url); } catch (e) { return send(res, 400, { error: e.message }); }
  const r = store.addUrl({ url: clean, name, note, source: '手动', current: !!setAsCurrent });
  store.log('info', `网址板块${r.existed ? '已存在该地址' : '新增地址'}: ${clean}`);
  send(res, 200, { ok: true, url: r.rec, existed: r.existed });
});

route('POST', '/api/urls/delete', async (req, res, user) => {
  const { id } = await readBody(req);
  try { store.removeUrl(String(id || '')); } catch (e) { return send(res, 400, { error: e.message }); }
  send(res, 200, { ok: true });
});

route('POST', '/api/urls/current', async (req, res, user) => {
  const { id } = await readBody(req);
  try { send(res, 200, { ok: true, url: store.setCurrentUrl(String(id || '')) }); }
  catch (e) { send(res, 400, { error: e.message }); }
});

route('POST', '/api/urls/clear', async (req, res, user) => {
  const n = store.clearUrls();
  send(res, 200, { ok: true, removed: n });
});

route('POST', '/api/settings/port', async (req, res, user) => {
  const { port } = await readBody(req);
  const p = parseInt(port, 10);
  if (!p || p < 1 || p > 65535) return send(res, 400, { error: '端口无效' });
  config.port = p; saveConfig();
  if (store.unlocked) store.doc.settings.port = p;
  store.save();
  send(res, 200, { ok: true, needRestart: true });
});

route('POST', '/api/settings/registration', async (req, res, user) => {
  const { enabled } = await readBody(req);
  config.registration = !!enabled;
  saveConfig();
  store.log('warn', `新用户注册已${config.registration ? '开启' : '关闭'}`);
  send(res, 200, { ok: true, registrationOpen: config.registration });
});

route('POST', '/api/system/restart', async (req, res, user) => {
  send(res, 200, { ok: true, msg: '系统正在重启...' });
  setTimeout(() => {
    const child = require('child_process').spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT, detached: true, stdio: 'ignore', env: process.env,
    });
    child.unref();
    process.exit(0);
  }, 500);
});

route('POST', '/api/system/lock', async (req, res, user) => {
  store.doc = null; store.password = null;
  send(res, 200, { ok: true, msg: '数据库已重新加密锁定, 需管理员再次登录解锁' });
});

route('POST', '/api/key/rotate', async (req, res, user) => {
  send(res, 200, { key: sysCtx.rotateKey() });
});

route('GET', '/api/tools/random', async (req, res, user) => {
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  const kind = q.get('kind') || 'key';
  const out = {};
  if (kind === 'key' || kind === 'all') out.key = util.randomKey(32);
  if (kind === 'password' || kind === 'all') {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
    let pw = '';
    for (let i = 0; i < 16; i++) pw += chars[crypto.randomInt(chars.length)];
    out.password = pw;
  }
  if (kind === 'uuid' || kind === 'all') out.uuid = crypto.randomUUID();
  send(res, 200, out);
});

route('POST', '/api/tools/hash', async (req, res, user) => {
  const { text } = await readBody(req);
  const t = String(text || '');
  send(res, 200, { sha256: util.sha256(t), md5: crypto.createHash('md5').update(t).digest('hex'), sha1: crypto.createHash('sha1').update(t).digest('hex') });
});

/* ---------------- 请求处理 ---------------- */
async function handleApi(req, res, pathname) {
  const r = routes.find(x => x.method === req.method && x.pattern === pathname);
  if (!r) return send(res, 404, { error: 'API_NOT_FOUND' });

  // 公开路由
  if (pathname === '/api/login' || pathname === '/api/register' || pathname === '/api/state' || pathname === '/api/theme' || pathname === '/api/logout' || pathname === '/api/update' || pathname === '/api/access') {
    return r.handlers[0](req, res);
  }

  const user = requireAuth(req, res);
  if (!user) return;
  if (SHARED_ROUTES.has(pathname)) {
    // 共享视图只服务受限用户: 管理员读自己的全局库, 但同样进不了会员私有子树
    if (isAdmin(user)) return send(res, 403, { error: '共享视图面向受限用户; 最高权限账号请直接使用管理面板' });
  } else if (!isAdmin(user) && !MEMBER_ROUTES.has(pathname)) {
    return send(res, 403, { error: '权限不足: 该内容仅最高权限账号可见' });
  }
  // 会员使用自己的加密库, 不依赖管理员是否已解锁系统库
  if (isAdmin(user) && !requireUnlocked(res)) return;
  try {
    await r.handlers[0](req, res, user);
  } catch (e) {
    send(res, 400, { error: e.message || '操作失败' });
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    serveStatic(res, pathname);
  } catch (e) {
    send(res, 500, { error: 'INTERNAL_ERROR', detail: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`[!] 端口 ${config.port} 已被占用 — 系统可能已在运行, 直接打开浏览器访问即可。`);
    if (process.env.LAUNCH_OPEN === '1') openBrowser(`http://localhost:${config.port}`);
    setTimeout(() => process.exit(0), 1500);
  } else {
    console.error(e);
  }
});

const LOOPBACK_ONLY = (BIND_HOST === '127.0.0.1' || BIND_HOST === '::1' || BIND_HOST === 'localhost');

server.listen(config.port, BIND_HOST, () => {
  console.log(`=================================================`);
  console.log(`  ${SYSTEM_NAME} v${VERSION} · 核心已上线  [全平台版]`);
  console.log(`  监听:      ${BIND_HOST}:${config.port}  ${LOOPBACK_ONLY ? '(仅本机可达, 对外必须经隧道)' : '(警告: 直连暴露, 请确认已启用 HTTPS)'}`);
  console.log(`  本机访问:  http://localhost:${config.port}`);
  if (process.env.TS_PUBLIC_URL) console.log(`  对外地址:  ${process.env.TS_PUBLIC_URL}`);
  if (!LOOPBACK_ONLY) for (const i of listIps()) console.log(`  局域网:    http://${i.address}:${config.port}  [${i.name}]`);
  console.log(`  转发头信任: ${TRUST_PROXY ? '是 (源站仅回环, X-Forwarded-For 取自隧道)' : '否 (使用直连 IP 做限速)'}`);
  console.log(`  系统密钥:  ${systemKey.slice(0, 16)}... (${manifestStatus === 'OK' ? '稳定' : '检测到文件变动, 已自动轮换'})`);
  console.log(`  数据库:    ${store.unlocked ? '已解锁' : '加密锁定中 (等待管理员登录)'}`);
  console.log(`=================================================`);
  if (process.env.LAUNCH_OPEN === '1') {
    setTimeout(() => openBrowser(`http://localhost:${config.port}`), 800);
  }
});
