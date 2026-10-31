'use strict';
const crypto = require('crypto');

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;

// One-way password hash for login verification.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64, SCRYPT_OPTS).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(String(password), String(salt), 64, SCRYPT_OPTS).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(String(expectedHash), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Reversible key for encrypting whole files (AES-256-GCM).
function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), String(salt), KEY_LEN, SCRYPT_OPTS);
}

// Envelope format: { v:1, salt, iv, tag, data }  (data = base64)
function encryptJSON(obj, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    v: 1,
    algo: 'aes-256-gcm',
    salt,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: enc.toString('base64'),
  };
}

// Returns parsed object or throws on wrong password / tampered data.
function decryptJSON(envelope, password) {
  const key = deriveKey(password, envelope.salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

module.exports = { hashPassword, verifyPassword, deriveKey, encryptJSON, decryptJSON };
