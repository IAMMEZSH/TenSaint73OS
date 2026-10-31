'use strict';
/* 分段并行下载: 单连接被限速时用多连接把大文件拖下来 */
const fs = require('fs');
const http = require('http');
const https = require('https');

const UA = { 'User-Agent': 'TenSaint73OS' };
const MIN_PARALLEL = 6 * 1024 * 1024;
const MAX_PARTS = 8;
const IDLE_TIMEOUT = 30000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function request(url, headers, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('重定向过多'));
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        resp.resume();
        return resolve(request(new URL(resp.headers.location, url).toString(), headers, redirects + 1));
      }
      resp.on('error', () => { /* 由调用方处理 */ });
      resolve({ resp, statusCode: resp.statusCode, headers: resp.headers });
    });
    req.on('error', reject);
    req.setTimeout(IDLE_TIMEOUT, () => req.destroy(new Error('连接超时')));
  });
}

async function probeSize(url) {
  const r = await request(url, Object.assign({ Range: 'bytes=0-0' }, UA));
  try {
    const cr = String(r.headers['content-range'] || '');
    const m = cr.match(/\/(\d+)\s*$/);
    if (r.statusCode === 206 && m) return { size: Number(m[1]), ranges: true };
    return { size: 0, ranges: false };
  } finally {
    r.resp.destroy();
  }
}

function writeAt(fd, buf, pos) {
  let off = 0;
  while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off, pos + off);
}

async function fetchRange(url, fd, start, end) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await request(url, Object.assign({ Range: `bytes=${start}-${end}` }, UA));
      if (r.statusCode !== 206) {
        r.resp.destroy();
        const err = new Error('镜像不支持分段下载 (HTTP ' + r.statusCode + ')');
        err.rangeUnsupported = true;
        throw err;
      }
      let pos = start;
      for await (const chunk of r.resp) {
        writeAt(fd, chunk, pos);
        pos += chunk.length;
      }
      if (pos !== end + 1) throw new Error('分段不完整');
      return;
    } catch (e) {
      lastErr = e;
      if (e.rangeUnsupported) throw e;
      if (attempt < 3) await sleep(400 * attempt);
    }
  }
  throw lastErr;
}

async function downloadParallel(url, dest, size) {
  const parts = Math.min(MAX_PARTS, Math.max(2, Math.ceil(size / (4 * 1024 * 1024))));
  const chunk = Math.ceil(size / parts);
  const tmp = dest + '.part';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.ftruncateSync(fd, size);
    const jobs = [];
    for (let i = 0; i < parts; i++) {
      const start = i * chunk;
      if (start >= size) break;
      jobs.push(fetchRange(url, fd, start, Math.min(size - 1, start + chunk - 1)));
    }
    await Promise.all(jobs);
    if (fs.fstatSync(fd).size !== size) throw new Error('文件大小不符');
  } catch (e) {
    fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (e2) { /* 忽略 */ }
    throw e;
  }
  fs.closeSync(fd);
  fs.renameSync(tmp, dest);
}

async function downloadSingle(url, dest) {
  const r = await request(url, Object.assign({}, UA));
  if (r.statusCode !== 200) {
    r.resp.destroy();
    throw new Error('HTTP ' + r.statusCode);
  }
  const tmp = dest + '.part';
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    let settled = false;
    const fail = (e) => {
      if (settled) return;
      settled = true;
      try { r.resp.destroy(); } catch (e2) { /* 忽略 */ }
      try { out.destroy(); } catch (e2) { /* 忽略 */ }
      try { fs.unlinkSync(tmp); } catch (e2) { /* 忽略 */ }
      reject(e);
    };
    r.resp.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (settled) return;
      settled = true;
      out.close(() => {
        try { fs.renameSync(tmp, dest); resolve(); }
        catch (e) { fail(e); }
      });
    });
    r.resp.pipe(out);
  });
}

async function downloadToFile(url, dest) {
  let probe = { size: 0, ranges: false };
  try { probe = await probeSize(url); } catch (e) { /* 探测失败就直接单流 */ }
  if (probe.ranges && probe.size >= MIN_PARALLEL) {
    try {
      await downloadParallel(url, dest, probe.size);
      return;
    } catch (e) {
      if (!e.rangeUnsupported) throw e;
    }
  }
  await downloadSingle(url, dest);
}

module.exports = { downloadToFile };
