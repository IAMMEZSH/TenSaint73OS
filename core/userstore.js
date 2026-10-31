'use strict';
/* ============================================================================
   每个注册用户独立的加密数据库
   - AES-256-GCM, 密钥来自本机 install.salt (与管理员数据库密码无关)
   - 管理员未解锁系统库时, 会员依然可以使用自己的空间
   - 一个用户一个文件, 任何接口都不能跨用户读取
============================================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { id, now } = require('./util');

const MAX_TABLES = 60;
const MAX_ROWS = 5000;
const MAX_COLS = 32;
const MAX_ACTIVITY = 60;

class UserStore {
  constructor(file, key) {
    this.file = file;
    this.key = key;
    this.doc = this.load() || { createdAt: now(), tables: {}, activity: [] };
    this.doc.tables = this.doc.tables || {};
    this.doc.activity = this.doc.activity || [];
    this.doc.createdAt = this.doc.createdAt || now();
  }

  load() {
    if (!fs.existsSync(this.file)) return null;
    try {
      const env = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(env.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(env.tag, 'hex'));
      const plain = Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]);
      return JSON.parse(plain.toString('utf8'));
    } catch (e) {
      return null;
    }
  }

  save() {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(this.doc), 'utf8')), cipher.final()]);
    const body = JSON.stringify({ v: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: enc.toString('base64') });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, this.file);
  }

  touch(kind, msg) {
    this.doc.activity.unshift({ t: now(), kind, msg: String(msg).slice(0, 160) });
    if (this.doc.activity.length > MAX_ACTIVITY) this.doc.activity = this.doc.activity.slice(0, MAX_ACTIVITY);
    this.save();
  }

  listTables() { return Object.keys(this.doc.tables); }

  tableMeta() {
    return this.listTables().map(name => ({
      name,
      columns: this.doc.tables[name].columns,
      count: this.doc.tables[name].rows.length,
    }));
  }

  getTable(name) {
    const t = this.doc.tables[name];
    if (!t) return null;
    return { name, columns: t.columns, rows: t.rows, count: t.rows.length };
  }

  createTable(name, columns) {
    name = String(name || '').trim();
    if (!name) throw new Error('表名不能为空');
    if (name.length > 40) throw new Error('表名最多 40 个字符');
    if (this.doc.tables[name]) throw new Error('表已存在: ' + name);
    if (this.listTables().length >= MAX_TABLES) throw new Error(`每个空间最多 ${MAX_TABLES} 张表`);
    columns = (columns || []).map(c => String(c).trim()).filter(Boolean).slice(0, MAX_COLS);
    if (!columns.length) throw new Error('至少需要一个列');
    this.doc.tables[name] = { columns, rows: [], createdAt: now() };
    this.touch('db', `创建数据表 [${name}]`);
    return this.doc.tables[name];
  }

  dropTable(name) {
    if (!this.doc.tables[name]) throw new Error('表不存在: ' + name);
    delete this.doc.tables[name];
    this.touch('db', `删除数据表 [${name}]`);
  }

  addColumn(name, col) {
    const t = this.doc.tables[name];
    if (!t) throw new Error('表不存在: ' + name);
    col = String(col || '').trim();
    if (!col) throw new Error('列名不能为空');
    if (col.length > 30) throw new Error('列名最多 30 个字符');
    if (t.columns.includes(col)) throw new Error('列已存在: ' + col);
    if (t.columns.length >= MAX_COLS) throw new Error(`每张表最多 ${MAX_COLS} 列`);
    t.columns.push(col);
    this.touch('db', `表 [${name}] 新增列 [${col}]`);
  }

  removeColumn(name, col) {
    const t = this.doc.tables[name];
    if (!t) throw new Error('表不存在: ' + name);
    t.columns = t.columns.filter(c => c !== col);
    for (const r of t.rows) delete r[col];
    this.touch('db', `表 [${name}] 删除列 [${col}]`);
  }

  insert(name, row) {
    const t = this.doc.tables[name];
    if (!t) throw new Error('表不存在: ' + name);
    if (t.rows.length >= MAX_ROWS) throw new Error(`每张表最多 ${MAX_ROWS} 行`);
    const clean = { id: id() };
    for (const c of t.columns) clean[c] = row && row[c] != null ? String(row[c]).slice(0, 2000) : '';
    t.rows.push(clean);
    this.touch('db', `表 [${name}] 插入 1 行`);
    return clean;
  }

  update(name, rowId, patch) {
    const t = this.doc.tables[name];
    if (!t) throw new Error('表不存在: ' + name);
    const row = t.rows.find(r => r.id === rowId);
    if (!row) throw new Error('行不存在');
    for (const c of t.columns) {
      if (patch && patch[c] !== undefined) row[c] = String(patch[c]).slice(0, 2000);
    }
    this.touch('db', `表 [${name}] 更新 1 行`);
    return row;
  }

  remove(name, rowId) {
    const t = this.doc.tables[name];
    if (!t) throw new Error('表不存在: ' + name);
    const i = t.rows.findIndex(r => r.id === rowId);
    if (i < 0) throw new Error('行不存在');
    t.rows.splice(i, 1);
    this.touch('db', `表 [${name}] 删除 1 行`);
  }

  clear(name) {
    const t = this.doc.tables[name];
    if (!t) throw new Error('表不存在: ' + name);
    const n = t.rows.length;
    t.rows = [];
    this.touch('db', `表 [${name}] 清空 ${n} 行`);
  }

  stats() {
    const tables = this.listTables().length;
    let rows = 0;
    for (const n of this.listTables()) rows += this.doc.tables[n].rows.length;
    return { tables, rows, activity: this.doc.activity.slice(0, 20) };
  }
}

module.exports = { UserStore };
