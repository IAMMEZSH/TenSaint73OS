'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function id() {
  return Date.now().toString(36) + crypto.randomBytes(5).toString('hex');
}

function now() {
  return new Date().toISOString();
}

function randomKey(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

// Resolve a path inside the sandbox root and refuse traversal.
function safeJoin(root, rel) {
  const p = path.resolve(root, String(rel || ''));
  const r = path.resolve(root);
  if (p !== r && !p.startsWith(r + path.sep)) return null;
  return p;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// Constant-time compare
function eq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = { id, now, randomKey, sha256, sha256File, safeJoin, ensureDir, readJSON, writeJSON, eq };
