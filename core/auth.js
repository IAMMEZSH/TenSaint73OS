'use strict';
const fs = require('fs');
const crypto = require('crypto');
const cryptoUtil = require('./crypto-util');
const { readJSON, writeJSON, now, eq } = require('./util');

const SESSION_TTL = 12 * 60 * 60 * 1000; // 12h sliding

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
    this.load();
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
      this.users = JSON.parse(plain.toString('utf8'));
    } catch (e) {
      // Auth vault unreadable (copied to another machine etc.)
      this.users = [];
      this.loadError = true;
    }
  }

  save() {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(this.users), 'utf8')), cipher.final()]);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: enc.toString('base64') }));
    fs.renameSync(tmp, this.file);
  }

  ensureUser(username, password, role) {
    if (this.users.some(u => u.username === username)) return;
    const { salt, hash } = cryptoUtil.hashPassword(password);
    this.users.push({ username, salt, hash, role, grants: emptyGrants(), createdAt: now() });
    this.save();
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
    this.sessions.set(token, { username: user.username, role: user.role, exp: Date.now() + SESSION_TTL });
    return token;
  }

  check(token) {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    if (s.exp < Date.now()) { this.sessions.delete(token); return null; }
    s.exp = Date.now() + SESSION_TTL;   // sliding
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

  listUsers() {
    return this.users.map(u => ({
      username: u.username, role: u.role, createdAt: u.createdAt,
      phoneBound: !!u.phone,
      grants: u.role === 'admin' ? null : this.normalizeGrants(u.grants),
    }));
  }

  addUser(username, password, role) {
    if (this.users.some(u => u.username === username)) throw new Error('用户已存在');
    if (role !== 'admin' && role !== 'user') throw new Error('权限阶级只能是 admin 或 user');
    const { salt, hash } = cryptoUtil.hashPassword(password);
    this.users.push({ username, salt, hash, role, grants: emptyGrants(), createdAt: now() });
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
    const u = { username, salt, hash, role: 'user', grants: emptyGrants(), createdAt: now() };
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
