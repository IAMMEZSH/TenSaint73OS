'use strict';
const fs = require('fs');
const path = require('path');
const cryptoUtil = require('./crypto-util');
const { id, now, readJSON, writeJSON } = require('./util');

const DEFAULT_THEME = {
  primary: '#d4af37',        // 金色
  accent: '#00e5ff',         // 青色
  bg: 'grid',                // grid | particles | matrix | none
  bgColor: '#050507',
  uiStyle: 'gold',           // gold | cyber | neon | toxic | crimson
  customCss: '',
};

const BUILTIN_FEATURES = [
  { id: 'dashboard', name: '控制台', icon: '⌂', desc: '系统状态总览', builtin: true },
  { id: 'ai',        name: 'AI助手', icon: '◈', desc: '智能系统控制核心', builtin: true },
  { id: 'database',  name: '数据库', icon: '⛁', desc: '数据表管理与增删改查', builtin: true },
  { id: 'files',     name: '文件',   icon: '▤', desc: '系统文件仓库管理', builtin: true },
  { id: 'users',     name: '用户',   icon: '☗', desc: '用户与权限阶级管理', builtin: true },
  { id: 'account',   name: '账户安全', icon: '⬡', desc: '密码与安全手机号绑定', builtin: true },
  { id: 'features',  name: '功能',   icon: '⚙', desc: '功能模块开关与新增', builtin: true },
  { id: 'theme',     name: '主题',   icon: '✦', desc: '界面外观定制', builtin: true },
  { id: 'logs',      name: '日志',   icon: '≣', desc: '系统运行日志', builtin: true },
  { id: 'network',   name: '网络',   icon: '⇄', desc: '联网与远程访问', builtin: true },
  { id: 'urls',      name: '网址',   icon: '◉', desc: '访问地址与历史记录', builtin: true },
  { id: 'tools',     name: '工具',   icon: '⚒', desc: '密钥/哈希/随机工具', builtin: true },
  { id: 'settings',  name: '设置',   icon: '⛭', desc: '系统参数设置', builtin: true },
  { id: 'about',     name: '关于',   icon: '✚', desc: '系统信息', builtin: true },
];

function defaultDoc() {
  return {
    meta: { createdAt: now(), name: 'TenSaint73OS', version: '1.0.0' },
    settings: { port: 7373, theme: { ...DEFAULT_THEME } },
    tables: {
      示例表: {
        columns: ['名称', '类型', '备注'],
        rows: [
          { id: id(), 名称: 'TenSaint73OS', 类型: '系统', 备注: '主核心' },
          { id: id(), 名称: '圣钥协议', 类型: '安全', 备注: '文件变动即轮换密钥' },
        ],
      },
    },
    features: BUILTIN_FEATURES.map(f => ({ ...f, enabled: true })),
    urls: [],
    logs: [],
  };
}

class Store {
  constructor(file) {
    this.file = file;
    this.doc = null;         // decrypted in-memory document
    this.password = null;    // current db password (admin password)
    this.existed = fs.existsSync(file);
    this.fresh = !this.existed;
    if (this.existed) {
      this.envelope = readJSON(file, null);
    }
  }

  get unlocked() { return !!this.doc; }

  // Try to unlock with a password. On success the doc lives in memory.
  // First run: initialize the default database and encrypt it on disk now.
  unlock(password) {
    if (this.doc) return true;
    if (this.fresh) {
      this.doc = defaultDoc();
      this.password = password;
      this.migrate();
      this.log('info', '数据库初始化完成 (AES-256-GCM 加密已启用)');
      return true;
    }
    try {
      this.doc = cryptoUtil.decryptJSON(this.envelope, password);
      this.password = password;
      this.migrate();
      return true;
    } catch (e) {
      return false;
    }
  }

  migrate() {
    const d = this.doc;
    d.settings = d.settings || {};
    d.settings.theme = Object.assign({}, DEFAULT_THEME, d.settings.theme || {});
    d.tables = d.tables || {};
    d.features = d.features || [];
    for (const bf of BUILTIN_FEATURES) {
      if (!d.features.some(f => f.id === bf.id)) d.features.push({ ...bf, enabled: true });
    }
    d.logs = d.logs || [];
    d.urls = d.urls || [];
  }

  // Persist encrypted to disk (every change is saved immediately).
  save() {
    if (!this.doc) return;
    this.envelope = cryptoUtil.encryptJSON(this.doc, this.password);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.envelope));
    fs.renameSync(tmp, this.file);
  }

  // 数据库密钥由管理员密码派生: 改密码必须立刻用新密码重新加密整库,
  // 否则磁盘上的密文仍可用旧密码解开。
  rekey(newPassword) {
    if (!this.doc) return false;
    this.password = newPassword;
    this.save();
    return true;
  }

  log(level, msg) {
    if (!this.doc) return;
    this.doc.logs.push({ t: now(), level, msg: String(msg).slice(0, 500) });
    if (this.doc.logs.length > 1000) this.doc.logs = this.doc.logs.slice(-1000);
    this.save();
  }

  // ---- table ops ----
  listTables() { return Object.keys(this.doc.tables); }

  getTable(name) {
    const t = this.doc.tables[name];
    if (!t) return null;
    return { name, columns: t.columns, rows: t.rows, count: t.rows.length };
  }

  createTable(name, columns) {
    name = String(name || '').trim();
    if (!name) throw new Error('表名不能为空');
    if (this.doc.tables[name]) throw new Error('表已存在: ' + name);
    columns = (columns || []).map(c => String(c).trim()).filter(Boolean);
    if (!columns.length) throw new Error('至少需要一个列');
    this.doc.tables[name] = { columns, rows: [], createdAt: now() };
    this.save();
    this.log('info', `创建数据表 [${name}]`);
  }

  dropTable(name) {
    if (!this.doc.tables[name]) throw new Error('表不存在: ' + name);
    delete this.doc.tables[name];
    this.save();
    this.log('warn', `删除数据表 [${name}]`);
  }

  addColumn(name, col) {
    const t = this.doc.tables[name];
    if (!t) throw new Error('表不存在: ' + name);
    col = String(col || '').trim();
    if (!col) throw new Error('列名不能为空');
    if (t.columns.includes(col)) throw new Error('列已存在: ' + col);
    t.columns.push(col);
    this.save();
    this.log('info', `表 [${name}] 新增列 [${col}]`);
  }

  removeColumn(name, col) {
    const t = this.doc.tables[name];
    if (!t) throw new Error('表不存在: ' + name);
    t.columns = t.columns.filter(c => c !== col);
    for (const r of t.rows) delete r[col];
    this.save();
    this.log('warn', `表 [${name}] 删除列 [${col}]`);
  }

  insert(name, row) {
    const t = this.doc.tables[name];
    if (!t) throw new Error('表不存在: ' + name);
    const clean = { id: id() };
    for (const c of t.columns) clean[c] = row[c] != null ? String(row[c]) : '';
    t.rows.push(clean);
    this.save();
    this.log('info', `表 [${name}] 插入 1 行数据`);
    return clean;
  }

  update(name, rowId, patch) {
    const t = this.doc.tables[name];
    if (!t) throw new Error('表不存在: ' + name);
    const row = t.rows.find(r => r.id === rowId);
    if (!row) throw new Error('行不存在');
    for (const c of t.columns) {
      if (patch[c] !== undefined) row[c] = String(patch[c]);
    }
    this.save();
    this.log('info', `表 [${name}] 更新 1 行数据`);
    return row;
  }

  remove(name, rowId) {
    const t = this.doc.tables[name];
    if (!t) throw new Error('表不存在: ' + name);
    const i = t.rows.findIndex(r => r.id === rowId);
    if (i < 0) throw new Error('行不存在');
    t.rows.splice(i, 1);
    this.save();
    this.log('warn', `表 [${name}] 删除 1 行数据`);
  }

  clear(name) {
    const t = this.doc.tables[name];
    if (!t) throw new Error('表不存在: ' + name);
    const n = t.rows.length;
    t.rows = [];
    this.save();
    this.log('warn', `表 [${name}] 清空 ${n} 行数据`);
  }

  // ---- 访问地址 (网址板块) ----
  listUrls() { return this.doc.urls.slice().reverse(); }

  addUrl({ url, name, note, source, current }) {
    const list = this.doc.urls;
    const rec = {
      id: id(),
      url: String(url).slice(0, 300),
      name: String(name || '').slice(0, 60),
      note: String(note || '').slice(0, 200),
      source: source === '自动' ? '自动' : '手动',
      current: false,
      createdAt: now(),
    };
    const dup = list.find(u => u.url === rec.url);
    if (dup) {
      if (current) this.setCurrentUrl(dup.id, true);
      else if (name || note) { dup.name = String(name || dup.name).slice(0, 60); dup.note = String(note || dup.note).slice(0, 200); this.save(); }
      return { rec: dup, existed: true };
    }
    list.push(rec);
    while (list.length > 200) {
      const i = list.findIndex(u => !u.current);
      if (i < 0) break;
      list.splice(i, 1);
    }
    if (current || !list.some(u => u.current)) this.setCurrentUrl(rec.id, true);
    this.save();
    return { rec, existed: false };
  }

  setCurrentUrl(recId, quiet) {
    const list = this.doc.urls;
    const t = list.find(u => u.id === recId);
    if (!t) throw new Error('地址记录不存在');
    for (const u of list) u.current = (u.id === recId);
    this.save();
    if (!quiet) this.log('info', `当前访问地址设为 ${t.url}`);
    return t;
  }

  removeUrl(recId) {
    const i = this.doc.urls.findIndex(u => u.id === recId);
    if (i < 0) throw new Error('地址记录不存在');
    const [gone] = this.doc.urls.splice(i, 1);
    if (gone.current && this.doc.urls.length) this.doc.urls[this.doc.urls.length - 1].current = true;
    this.save();
    this.log('warn', `删除地址记录 ${gone.url}`);
    return gone;
  }

  clearUrls() {
    const n = this.doc.urls.length;
    this.doc.urls = [];
    this.save();
    this.log('warn', `清空网址历史 (${n} 条)`);
    return n;
  }

  // ---- features ----
  feature(idf) { return this.doc.features.find(f => f.id === idf); }

  setFeatureEnabled(idf, enabled) {
    const f = this.feature(idf);
    if (!f) throw new Error('功能不存在: ' + idf);
    f.enabled = !!enabled;
    this.save();
    this.log('info', `功能 [${f.name}] ${enabled ? '启用' : '禁用'}`);
  }

  addFeature(name, desc) {
    name = String(name || '').trim();
    if (!name) throw new Error('功能名不能为空');
    const fid = 'custom_' + Date.now().toString(36);
    this.doc.features.push({ id: fid, name, desc: String(desc || ''), icon: '✧', enabled: true, builtin: false });
    this.save();
    this.log('info', `新增功能模块 [${name}]`);
    return fid;
  }

  removeFeature(idf) {
    const i = this.doc.features.findIndex(f => f.id === idf);
    if (i < 0) throw new Error('功能不存在');
    if (this.doc.features[i].builtin) throw new Error('内置功能不可删除, 只能禁用');
    const name = this.doc.features[i].name;
    this.doc.features.splice(i, 1);
    this.save();
    this.log('warn', `删除功能模块 [${name}]`);
  }
}

module.exports = { Store, DEFAULT_THEME, BUILTIN_FEATURES };
