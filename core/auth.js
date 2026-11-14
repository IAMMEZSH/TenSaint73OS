'use strict';
const fs = require('fs');
const crypto = require('crypto');
const cryptoUtil = require('./crypto-util');
const { readJSON, writeJSON, now, eq } = require('./util');

const SESSION_TTL = 12 * 60 * 60 * 1000; // 12h sliding
// 在线 = 持有有效会话, 且最近一次已认证请求(页面心跳/任意接口)发生在窗口内。
// 页面每 20 秒发一次心跳; 90 秒窗口覆盖后台标签页被浏览器降频到 1 分钟一次的情况。
const ONLINE_WINDOW = 90 * 1000;
// 未登录访客同样按 IP + User-Agent 归并, 保留 30 天; 只记访问元数据, 不记录输入内容。
const VISITOR_TTL = 30 * 24 * 60 * 60 * 1000;
const VISITOR_LIMIT = 5000;
const VISITOR_PING_MS = 5000;

function emptyGrants() { return { tables: {}, files: {} }; }

class Auth {
  constructor(file, installKey) {
    this.file = file;
    this.key = installKey;          // Buffer(32), per-install key
    // 手机号字段单独加密: 与认证库信封密钥做域分离, 数据库文件被拷走也读不出号码
    this.phoneKey = crypto.createHmac('sha256', installKey).update('TenSaint73OS::phone-vault::v1').digest();
    this.users = [];
    this.sessions = new Map();      // token -> {username, role, exp}
    this.fail = new Map();          // ip -> {count, lockUntil}
    this.usageDirty = new Set();    // 活跃时间有变化、尚未落盘的用户名
    this.visitors = [];             // 未登录访客: 按 IP + UA 归并
    this.visitorDirty = false;
    this.visitorPingAt = new Map(); // visitor id -> 上次计入心跳的时间戳, 防止公网接口被高频刷写
    this.load();
    this.migrateUsage();
    this.pruneVisitors();
  }

  // 旧版本账号没有使用元数据: 只补字段, 不伪造任何登录记录
  migrateUsage() {
    let dirty = false;
    for (const u of this.users) {
      let touched = false;
      if (u.lastLoginAt === undefined) { u.lastLoginAt = null; touched = true; }
      if (u.lastSeenAt === undefined) { u.lastSeenAt = u.lastLoginAt || null; touched = true; }
      if (typeof u.loginCount !== 'number') { u.loginCount = u.lastLoginAt ? 1 : 0; touched = true; }
      if (!u.createdBy) { u.createdBy = u.role === 'admin' ? 'owner' : 'legacy'; touched = true; }
      if (touched) { this.usageDirty.add(u.username); dirty = true; }
    }
    return dirty;
  }

  // ---- 安全手机号 ----
  // 手机号以 AES-256-GCM 加密保存; 另存 scrypt 哈希用于登录二次校验。
  // 管理端任何列表/详情接口都不返回号码, 只有本人会话能通过 getPhone 解密。
  normalizePhone(raw) {
    const s = String(raw || '').replace(/[\s-]/g, '');
    if (!/^\+?\d{6,20}$/.test(s)) throw new Error('手机号格式不正确 (6-20 位数字, 可带 + 国际区号)');
    return s;
  }

  encryptPhone(phone) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.phoneKey, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(phone, 'utf8')), cipher.final()]);
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: enc.toString('base64') };
  }

  decryptPhone(rec) {
    if (!rec || !rec.enc) return null;
    try {
      const e = rec.enc;
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.phoneKey, Buffer.from(e.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(e.tag, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(e.data, 'base64')), decipher.final()]).toString('utf8');
    } catch (e) {
      return null;
    }
  }

  phoneTakenBy(phone, exceptUser) {
    for (const u of this.users) {
      if (u.username === exceptUser || !u.phone) continue;
      if (this.decryptPhone(u.phone) === phone) return u.username;
    }
    return null;
  }

  setPhone(username, rawPhone) {
    const u = this.users.find(x => x.username === username);
    if (!u) throw new Error('用户不存在');
    const phone = this.normalizePhone(rawPhone);
    if (this.phoneTakenBy(phone, username)) throw new Error('该手机号已绑定其他账号');
    const { salt, hash } = cryptoUtil.hashPassword(phone);
    u.phone = { enc: this.encryptPhone(phone), salt, hash, boundAt: now() };
    this.save();
    return { phone, boundAt: u.phone.boundAt };
  }

  getPhone(username) {
    const u = this.users.find(x => x.username === username);
    if (!u || !u.phone) return null;
    const phone = this.decryptPhone(u.phone);
    return phone ? { phone, boundAt: u.phone.boundAt } : null;
  }

  hasPhone(username) {
    const u = this.users.find(x => x.username === username);
    return !!(u && u.phone);
  }

  verifyPhone(username, rawPhone) {
    const u = this.users.find(x => x.username === username);
    if (!u || !u.phone) return true;   // 未绑定 = 不需要第二因子
    try {
      return cryptoUtil.verifyPassword(this.normalizePhone(rawPhone), u.phone.salt, u.phone.hash);
    } catch (e) {
      return false;
    }
  }

  clearPhone(username) {
    const u = this.users.find(x => x.username === username);
    if (!u) throw new Error('用户不存在');
    delete u.phone;
    this.save();
  }

  load() {
    if (!fs.existsSync(this.file)) return;
    try {
      const env = readJSON(this.file, null);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(env.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(env.tag, 'hex'));
      const plain = Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]);
      const parsed = JSON.parse(plain.toString('utf8'));
      // 旧版认证库直接序列化 users 数组; 新版为 { format, users, visitors }
      if (Array.isArray(parsed)) {
        this.users = parsed;
        this.visitors = [];
      } else {
        this.users = Array.isArray(parsed.users) ? parsed.users : [];
        this.visitors = Array.isArray(parsed.visitors) ? parsed.visitors : [];
      }
    } catch (e) {
      // Auth vault unreadable (copied to another machine etc.)
      this.users = [];
      this.visitors = [];
      this.loadError = true;
    }
  }

  save() {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const payload = { format: 2, users: this.users, visitors: this.visitors };
    const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()]);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: enc.toString('base64') }));
    fs.renameSync(tmp, this.file);
  }

  // ---- 数据级授权 ----
  // tables: { 表名: 'r' | 'rw' }; files: { 相对目录: 'r' | 'rw' }
  // 目录授权是递归的: 授予 "照片" 即含 "照片/子目录"。根目录用 ""。
  // 受限账号永远看不到这里的内容以外的数据, 管理员不受 grants 约束。
  normalizeGrants(raw) {
    const g = emptyGrants();
    if (!raw || typeof raw !== 'object') return g;
    for (const src of ['tables', 'files']) {
      const srcMap = raw[src];
      if (!srcMap || typeof srcMap !== 'object') continue;
      for (const k of Object.keys(srcMap)) {
        const name = String(k);
        if (src === 'files' && (name.includes('\0') || /\.\.(\/|\\|$)/.test(name))) continue;
        const lvl = srcMap[k] === 'rw' ? 'rw' : srcMap[k] === 'r' ? 'r' : null;
        if (!lvl) continue;
        g[src][name] = lvl;
      }
    }
    return g;
  }

  // 每次请求都实时读取, 因此管理员取消授权后下一请求立即生效, 无需等会话过期。
  getGrants(username) {
    const u = this.users.find(x => x.username === username);
    return this.normalizeGrants(u && u.grants);
  }

  setGrants(username, grants) {
    const u = this.users.find(x => x.username === username);
    if (!u) throw new Error('用户不存在');
    if (u.role === 'admin') throw new Error('最高权限账号无需授权, 其可见一切数据');
    u.grants = this.normalizeGrants(grants);
    this.save();
    return u.grants;
  }

  hasTableAccess(username, table, needWrite) {
    const lvl = this.getGrants(username).tables[table];
    return !!lvl && (!needWrite || lvl === 'rw');
  }

  // rel 必须是相对文件仓库根的路径 (以 / 分隔)。检查其自身或任一层父目录是否被授权。
  hasFileAccess(username, rel, needWrite) {
    const files = this.getGrants(username).files;
    const parts = String(rel || '').split('/').filter(Boolean);
    const chain = [''];
    for (let i = 0; i <= parts.length; i++) chain.push(parts.slice(0, i).join('/'));
    for (const p of chain) {
      const lvl = files[p];
      if (lvl && (!needWrite || lvl === 'rw')) return true;
    }
    return false;
  }

  verify(username, password) {
    const u = this.users.find(x => x.username === username);
    if (!u) return null;
    if (!cryptoUtil.verifyPassword(password, u.salt, u.hash)) return null;
    return { username: u.username, role: u.role };
  }

  // simple rate limit: 5 fails -> lock 60s
  isLocked(ip) {
    const f = this.fail.get(ip);
    return f && f.lockUntil && f.lockUntil > Date.now();
  }

  recordFail(ip) {
    const f = this.fail.get(ip) || { count: 0, lockUntil: 0 };
    f.count++;
    if (f.count >= 5) { f.lockUntil = Date.now() + 60000; f.count = 0; }
    this.fail.set(ip, f);
  }

  clearFail(ip) { this.fail.delete(ip); }

  createSession(user) {
    const token = crypto.randomBytes(24).toString('hex');
    const t = Date.now();
    this.sessions.set(token, { username: user.username, role: user.role, exp: t + SESSION_TTL, seen: t });
    return token;
  }

  check(token) {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    const t = Date.now();
    if (s.exp < t) { this.sessions.delete(token); return null; }
    s.exp = t + SESSION_TTL;   // sliding
    s.seen = t;                // 心跳与任意已认证请求都会刷新在线时间
    return s;
  }

  destroy(token) { this.sessions.delete(token); }

  // 改密码/删账号后必须吊销该用户的全部在线令牌, 否则旧令牌能继续用到 12 小时。
  destroySessionsFor(username) {
    let n = 0;
    for (const [token, s] of [...this.sessions]) {
      if (s.username === username) { this.sessions.delete(token); n++; }
    }
    return n;
  }

  // 绑定/更新安全手机号时保留当前会话, 只踢掉其它终端
  destroyOtherSessions(username, keepToken) {
    let n = 0;
    for (const [token, s] of [...this.sessions]) {
      if (s.username === username && token !== keepToken) { this.sessions.delete(token); n++; }
    }
    return n;
  }

  // ---- 使用统计: 只记账号元数据, 不读取任何会员文件/数据表内容 ----
  markLogin(username) {
    const u = this.users.find(x => x.username === username);
    if (!u) return;
    const t = now();
    u.lastLoginAt = t;
    u.lastSeenAt = t;
    u.loginCount = (u.loginCount || 0) + 1;
    this.usageDirty.delete(username);
    this.save();
  }

  // 已认证请求都会刷新内存中的活跃时间, 落盘由 flushUsage 按分钟节流
  touchSeen(username) {
    const u = this.users.find(x => x.username === username);
    if (!u) return;
    u.lastSeenAt = now();
    this.usageDirty.add(username);
  }

  flushUsage() {
    if (!this.usageDirty.size && !this.visitorDirty) return false;
    this.pruneVisitors();
    this.usageDirty.clear();
    this.visitorDirty = false;
    this.save();
    return true;
  }

  pruneVisitors() {
    const cutoff = new Date(Date.now() - VISITOR_TTL).toISOString();
    if (this.visitors.some(v => String(v.lastSeenAt || '') < cutoff)) {
      this.visitors = this.visitors.filter(v => String(v.lastSeenAt || '') >= cutoff);
      this.visitorDirty = true;
    }
    if (this.visitors.length > VISITOR_LIMIT) {
      this.visitors.sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
      this.visitors.length = VISITOR_LIMIT;
      this.visitorDirty = true;
    }
  }

  visitorId(ip, ua) {
    const addr = String(ip || 'unknown').replace(/^::ffff:/, '');
    const agent = String(ua || '').slice(0, 180);
    return crypto.createHash('sha256').update(addr + '\n' + agent).digest('hex').slice(0, 16);
  }

  // 已登录的浏览器不再是"未登录访客": 登录成功或任何有效令牌请求都会清除该记录。
  // 同一浏览器注销后重新打开登录页, 会按新的未登录访客重新计数。
  clearVisitor(ip, ua) {
    if (!this.visitors.length) return false;
    const id = this.visitorId(ip, ua);
    const i = this.visitors.findIndex(v => v.id === id);
    if (i < 0) return false;
    this.visitors.splice(i, 1);
    this.visitorPingAt.delete(id);
    this.visitorDirty = true;
    return true;
  }

  // 未登录活动只按 IP + User-Agent 归并, 不落任何输入内容。
  // kind: page(打开登录页) / ping(登录页心跳) / failed-login(登录失败或被锁定) / denied(无有效会话访问受保护接口)
  noteVisitor({ ip, ua, kind, path }) {
    const addr = String(ip || 'unknown').replace(/^::ffff:/, '');
    const agent = String(ua || '').slice(0, 180);
    const id = this.visitorId(addr, agent);
    const t = now();
    const ms = Date.now();
    let v = this.visitors.find(x => x.id === id);
    if (!v) {
      v = { id, ip: addr, ua: agent, firstSeenAt: t, lastSeenAt: t, pageViews: 0, pings: 0, failedLogins: 0, denied: 0, lastPath: '' };
      this.visitors.push(v);
    }
    v.lastSeenAt = t;
    if (path) v.lastPath = String(path).slice(0, 120);
    if (kind === 'page') v.pageViews = (v.pageViews || 0) + 1;
    else if (kind === 'ping') {
      const last = this.visitorPingAt.get(id) || 0;
      if (ms - last >= VISITOR_PING_MS) { v.pings = (v.pings || 0) + 1; this.visitorPingAt.set(id, ms); }
    } else if (kind === 'failed-login') v.failedLogins = (v.failedLogins || 0) + 1;
    else if (kind === 'denied') v.denied = (v.denied || 0) + 1;
    this.visitorDirty = true;
    if (this.visitors.length > VISITOR_LIMIT) this.pruneVisitors();
  }

  visitorReport() {
    const t = Date.now();
    const cutoff = t - ONLINE_WINDOW;
    const ts = (v) => { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : 0; };
    const list = this.visitors.map(v => {
      const last = ts(v.lastSeenAt);
      return {
        ip: v.ip || 'unknown',
        ua: v.ua || '',
        firstSeenAt: v.firstSeenAt || null,
        lastSeenAt: v.lastSeenAt || null,
        pageViews: v.pageViews || 0,
        pings: v.pings || 0,
        failedLogins: v.failedLogins || 0,
        denied: v.denied || 0,
        lastPath: v.lastPath || '',
        online: last >= cutoff,
      };
    }).sort((a, b) =>
      (Number(b.online) - Number(a.online)) ||
      (b.denied - a.denied) ||
      (b.failedLogins - a.failedLogins) ||
      (ts(b.lastSeenAt) - ts(a.lastSeenAt)) ||
      a.ip.localeCompare(b.ip));
    return {
      total: list.length,
      online: list.filter(v => v.online).length,
      active24h: list.filter(v => v.lastSeenAt && ts(v.lastSeenAt) >= t - 24 * 60 * 60 * 1000).length,
      failedLogins: list.reduce((n, v) => n + v.failedLogins, 0),
      denied: list.reduce((n, v) => n + v.denied, 0),
      retentionDays: Math.round(VISITOR_TTL / (24 * 60 * 60 * 1000)),
      list,
    };
  }

  // 一次遍历所有会话, 同时得到"在线"(窗口内有请求)与"已登录"(令牌仍有效)的账号集合。
  // 在线判定逐会话统计: 多终端登录、后台标签页降频、注销/过期都不会漏算。
  sessionSnapshot() {
    const t = Date.now();
    const cutoff = t - ONLINE_WINDOW;
    const online = new Set();
    const counts = new Map();
    for (const s of this.sessions.values()) {
      if (s.exp < t) continue;
      counts.set(s.username, (counts.get(s.username) || 0) + 1);
      if ((s.seen || 0) >= cutoff) online.add(s.username);
    }
    return { online, counts };
  }

  usageReport() {
    const snap = this.sessionSnapshot();
    const ts = (v) => { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : 0; };
    const nowMs = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const users = this.users.map(u => {
      const online = snap.online.has(u.username);
      const sessions = snap.counts.get(u.username) || 0;
      return {
        username: u.username,
        role: u.role,
        createdBy: u.createdBy || (u.role === 'admin' ? 'owner' : 'legacy'),
        createdAt: u.createdAt || null,
        lastLoginAt: u.lastLoginAt || null,
        lastSeenAt: u.lastSeenAt || null,
        loginCount: u.loginCount || 0,
        online,
        loggedIn: sessions > 0,
        sessions,
      };
    }).sort((a, b) =>
      (Number(b.online) - Number(a.online)) ||
      (Number(b.loggedIn) - Number(a.loggedIn)) ||
      (b.sessions - a.sessions) ||
      (ts(b.lastSeenAt) - ts(a.lastSeenAt)) ||
      (ts(b.createdAt) - ts(a.createdAt)) ||
      a.username.localeCompare(b.username));
    const active = (ms) => users.filter(u => u.lastSeenAt && ts(u.lastSeenAt) >= nowMs - ms).length;
    return {
      generatedAt: now(),
      onlineWindowSeconds: ONLINE_WINDOW / 1000,
      total: users.length,
      members: users.filter(u => u.role !== 'admin').length,
      admins: users.filter(u => u.role === 'admin').length,
      online: users.filter(u => u.online).length,
      loggedIn: users.filter(u => u.loggedIn).length,
      sessions: users.reduce((n, u) => n + u.sessions, 0),
      active24h: active(day),
      active7d: active(7 * day),
      neverLoggedIn: users.filter(u => !u.lastLoginAt).length,
      users,
      visitors: this.visitorReport(),
    };
  }

  listUsers() {
    return this.users.map(u => ({
      username: u.username, role: u.role, createdAt: u.createdAt,
      phoneBound: !!u.phone,
      grants: u.role === 'admin' ? null : this.normalizeGrants(u.grants),
    }));
  }

  // 只创建会员。最高管理员全机唯一, 且只能由 owner/import-owner-key 导入 .tsowner 建立。
  addUser(username, password) {
    username = String(username || '').trim();
    password = String(password || '');
    if (username === '.' || username === '..' || !/^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]{1,19}$/u.test(username)) {
      throw new Error('用户名需 2-20 位, 以中英文或数字开头, 可含 _ . -');
    }
    if (password.length < 8) throw new Error('密码至少 8 位');
    if (password.length > 128) throw new Error('密码过长');
    if (this.users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('用户已存在');
    if (this.users.filter(u => u.role !== 'admin').length >= 200) throw new Error('会员名额已满');
    const { salt, hash } = cryptoUtil.hashPassword(password);
    this.users.push({
      username, salt, hash, role: 'user', grants: emptyGrants(), createdAt: now(),
      createdBy: 'admin', lastLoginAt: null, lastSeenAt: null, loginCount: 0,
    });
    this.save();
  }

  // 自助注册: 只允许普通用户, 每个账号自动获得独立加密空间。
  register(username, password) {
    username = String(username || '').trim();
    password = String(password || '');
    if (username === '.' || username === '..' || !/^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]{1,19}$/u.test(username)) {
      throw new Error('用户名需 2-20 位, 以中英文或数字开头, 可含 _ . -');
    }
    if (password.length < 8) throw new Error('密码至少 8 位');
    if (password.length > 128) throw new Error('密码过长');
    if (this.users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('用户名已被占用');
    if (this.users.filter(u => u.role !== 'admin').length >= 200) throw new Error('注册名额已满');
    const { salt, hash } = cryptoUtil.hashPassword(password);
    const createdAt = now();
    const u = {
      username, salt, hash, role: 'user', grants: emptyGrants(), createdAt,
      createdBy: 'self', lastLoginAt: createdAt, lastSeenAt: createdAt, loginCount: 1, // 注册即自动登录
    };
    this.users.push(u);
    this.save();
    return { username, role: 'user', createdAt: u.createdAt };
  }

  getUser(username) {
    const u = this.users.find(x => x.username === username);
    return u ? { username: u.username, role: u.role, createdAt: u.createdAt, phoneBound: !!u.phone } : null;
  }

  removeUser(username) {
    const i = this.users.findIndex(u => u.username === username);
    if (i < 0) throw new Error('用户不存在');
    this.users.splice(i, 1);
    this.destroySessionsFor(username);
    this.usageDirty.delete(username);
    this.save();
  }

  changePassword(username, newPassword) {
    const u = this.users.find(x => x.username === username);
    if (!u) throw new Error('用户不存在');
    const { salt, hash } = cryptoUtil.hashPassword(newPassword);
    u.salt = salt; u.hash = hash;
    this.destroySessionsFor(username);
    this.save();
  }
}

module.exports = { Auth };
