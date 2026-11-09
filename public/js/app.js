/* ==========================================================================
   TenSaint73OS · 全息控制核心 v1.2
   ========================================================================== */
'use strict';

const DEFAULT_THEME = {
  primary: '#f2c94c',
  accent: '#25e7ff',
  bg: 'grid',
  bgColor: '#03030a',
  uiStyle: 'gold',
  customCss: '',
};

const S = {
  token: localStorage.getItem('ts73_token') || '',
  role: null,
  username: '',
  nodeId: '',
  theme: { ...DEFAULT_THEME },
  features: [],
  featureMeta: {},
  current: 'dashboard',
  memberTab: 'overview',
  my: null,
  registrationOpen: true,
  authMode: 'login',
  palette: null,
  tick: {},
};

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleString('zh-CN', { hour12: false });
}
function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function b64(buf) {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/* ---------------- API ---------------- */
async function rawApi(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  const tk = token !== undefined ? token : S.token;
  if (tk) headers.Authorization = 'Bearer ' + tk;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function api(method, path, body) {
  const { status, data } = await rawApi(method, path, body);
  if (status === 401) {
    doLogout(true);
    toast('会话密钥已失效, 请重新接入', true);
    throw new Error(data.error || '会话已失效');
  }
  if (status < 200 || status >= 300) throw new Error(data.error || ('HTTP ' + status));
  return data;
}

/* ---------------- 提示 / 弹窗 ---------------- */
function toast(msg, isErr) {
  const box = $('#toasts');
  if (!box) return;
  const t = el('div', 'toast' + (isErr ? ' err' : ''), esc(msg));
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, 3400);
}

function closeModal() { const m = $('#modal-root'); if (m) m.classList.remove('open'); }

function openModal(title, bodyEl, onOk, okText) {
  const root = $('#modal-root');
  const modal = el('div', 'modal');
  modal.appendChild(el('h3', '', esc(title)));
  const body = el('div');
  body.appendChild(bodyEl);
  modal.appendChild(body);
  const acts = el('div', 'modal-actions');
  const cancel = el('button', 'btn btn-ghost', '取消');
  cancel.onclick = closeModal;
  const ok = el('button', 'btn', okText || '确认');
  ok.onclick = async () => {
    try {
      const r = await onOk();
      if (r === false) return;
      closeModal();
    } catch (e) { toast(e.message, true); }
  };
  acts.appendChild(cancel);
  acts.appendChild(ok);
  modal.appendChild(acts);
  root.innerHTML = '';
  root.appendChild(modal);
  root.classList.add('open');
}
function formRow(label, inputEl) {
  const r = el('div', 'form-row');
  r.appendChild(el('label', '', esc(label)));
  r.appendChild(inputEl);
  return r;
}
function inp(value, placeholder) {
  const i = el('input', 'inp');
  i.value = value ?? '';
  if (placeholder) i.placeholder = placeholder;
  return i;
}
function confirmBox(text, onYes, okText) {
  const body = el('div', '', '<div style="font-size:12px;line-height:1.9;color:var(--dim)">' + esc(text) + '</div>');
  openModal('确认操作', body, async () => await onYes(), okText || '执行');
}
function armOnce(btn, label, onRun) {
  if (btn.dataset.armed === '1') {
    btn.dataset.armed = '';
    btn.textContent = label;
    Promise.resolve().then(onRun).catch(e => toast(e.message, true));
    return;
  }
  btn.dataset.armed = '1';
  btn.textContent = '确认?';
  btn.classList.add('btn-danger');
  setTimeout(() => {
    if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = label; }
  }, 4000);
}

function copyText(t) {
  const ok = () => toast('已复制到剪贴板');
  const fallback = () => {
    const ta = el('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch (e) { done = false; }
    ta.remove();
    if (done) ok(); else toast('这台设备不让程序复制, 请长按地址手动选中', true);
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(ok, fallback);
  else fallback();
}

/* ---------------- 颜色 / 主题 ---------------- */
function hexToRgb(hex) {
  let m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  m = /^#?([0-9a-f]{3})$/i.exec(String(hex || ''));
  if (m) {
    const s = m[1];
    return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16) };
  }
  return { r: 242, g: 201, b: 76 };
}
function rgbStr(hex) { const c = hexToRgb(hex); return `${c.r}, ${c.g}, ${c.b}`; }
function hexA(hex, a) { const c = hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; }
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function paletteFor(name) {
  const h = hashStr(String(name || 'node'));
  const hue = h % 360;
  const hue2 = (hue + 48 + ((h >>> 8) % 40)) % 360;
  return { hue, a: hslToHex(hue, 88, 62), b: hslToHex(hue2, 90, 66) };
}

function applyTheme(t) {
  S.theme = Object.assign({}, DEFAULT_THEME, t || {});
  const root = document.documentElement.style;
  root.setProperty('--primary', S.theme.primary);
  root.setProperty('--accent', S.theme.accent);
  root.setProperty('--primary-rgb', rgbStr(S.theme.primary));
  root.setProperty('--accent-rgb', rgbStr(S.theme.accent));
  root.setProperty('--bg', S.theme.bgColor || '#03030a');
  bgMode = S.theme.bg || 'grid';
  makeBgGradient();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', S.theme.bgColor || '#03030a');
  const custom = $('#custom-css');
  if (custom) custom.textContent = S.theme.customCss || '';
}

function applyMemberTheme(pal) {
  S.palette = pal;
  const t = { ...DEFAULT_THEME, primary: pal.a, accent: pal.b, bg: 'orbit', bgColor: '#03030a' };
  applyTheme(t);
  const root = document.documentElement.style;
  root.setProperty('--m-accent', pal.a);
  root.setProperty('--m-accent-2', pal.b);
  root.setProperty('--m-hue', String(pal.hue));
}

/* ---------------- 动态背景引擎 ---------------- */
const canvas = $('#bg-canvas');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
let stars = [], dust = [], pillars = [], streaks = [], warp = [], matrixCols = [];
let bgMode = 'grid', bgStarted = false, bgLast = 0, bgGrad = null;

function makeBgGradient() {
  if (!W || !H) return;
  const bgc = (S.theme && S.theme.bgColor) || '#03030a';
  const pc = (S.theme && S.theme.primary) || DEFAULT_THEME.primary;
  const ac = (S.theme && S.theme.accent) || DEFAULT_THEME.accent;
  const g = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.35, Math.max(W, H) * 0.9);
  g.addColorStop(0, hexA(pc, 0.06));
  g.addColorStop(0.45, hexA(ac, 0.025));
  g.addColorStop(1, bgc);
  bgGrad = g;
}

function initBg() {
  stars = [];
  const n = Math.min(170, Math.max(60, Math.floor(W * H / 15000)));
  for (let i = 0; i < n; i++) {
    stars.push({
      x: Math.random() * W, y: Math.random() * H,
      z: 0.3 + Math.random() * 0.7,
      r: Math.random() < 0.14 ? 1.7 : 0.9,
      ph: Math.random() * Math.PI * 2,
      tw: 0.5 + Math.random() * 1.5,
      vy: 0.02 + Math.random() * 0.10,
    });
  }
  dust = [];
  const dn = Math.min(46, Math.max(16, Math.floor(W / 26)));
  for (let i = 0; i < dn; i++) {
    dust.push({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.22, vy: -0.08 - Math.random() * 0.30,
      r: 0.6 + Math.random() * 1.6, a: 0.10 + Math.random() * 0.30,
    });
  }
  pillars = [];
  for (let i = 0; i < 9; i++) {
    pillars.push({ x: Math.random(), w: 1 + Math.random() * 2, sp: 0.4 + Math.random() * 1.2, ph: Math.random() * Math.PI * 2 });
  }
  warp = [];
  for (let i = 0; i < 90; i++) {
    warp.push({ a: Math.random() * Math.PI * 2, d: Math.random() * 0.9 + 0.05, sp: 0.0016 + Math.random() * 0.004 });
  }
  matrixCols = [];
  const fs = 15;
  const cols = Math.ceil(W / fs);
  for (let i = 0; i < cols; i++) {
    matrixCols.push({ x: i * fs, y: Math.random() * H, sp: 1.2 + Math.random() * 3.2, ph: Math.random() * 10 });
  }
}

function resizeCanvas() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.6);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  initBg();
  makeBgGradient();
}

function drawStars(now, dt) {
  const pc = S.theme.primary, ac = S.theme.accent;
  for (const s of stars) {
    s.y += s.vy * dt * 6;
    if (s.y > H + 3) { s.y = -3; s.x = Math.random() * W; }
    const tw = 0.45 + 0.55 * Math.sin(now * 0.001 * s.tw + s.ph);
    ctx.globalAlpha = (0.2 + s.z * 0.55) * tw;
    ctx.fillStyle = s.z > 0.75 ? ac : s.z > 0.5 ? '#ffffff' : pc;
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;
}

function drawDust(now, dt) {
  const ac = S.theme.accent;
  for (const p of dust) {
    p.x += p.vx * dt * 6;
    p.y += p.vy * dt * 6;
    if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
    if (p.x < -10) p.x = W + 10;
    if (p.x > W + 10) p.x = -10;
    ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(now * 0.001 + p.x));
    ctx.fillStyle = ac;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 6.3);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawHyper(now, dt) {
  drawStars(now, dt);
  const pc = S.theme.primary, ac = S.theme.accent;
  const horizon = H * 0.635;
  const cx = W / 2;
  const glow = ctx.createLinearGradient(0, horizon - 110, 0, horizon + 16);
  glow.addColorStop(0, hexA(ac, 0));
  glow.addColorStop(0.82, hexA(ac, 0.10));
  glow.addColorStop(1, hexA(pc, 0.03));
  ctx.fillStyle = glow;
  ctx.fillRect(0, horizon - 110, W, 126);

  ctx.strokeStyle = hexA(ac, 0.075);
  ctx.lineWidth = 1;
  const off = (now * 0.000045) % 1;
  for (let i = -14; i <= 14; i++) {
    const xb = cx + i * (W / 11);
    ctx.beginPath();
    ctx.moveTo(cx + (xb - cx) * 0.06, horizon);
    ctx.lineTo(xb, H + 2);
    ctx.stroke();
  }
  for (let i = 0; i < 20; i++) {
    const p = ((i / 20) + off) % 1;
    const y = horizon + Math.pow(p, 2.7) * (H - horizon);
    ctx.globalAlpha = 0.03 + p * 0.17;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const p of pillars) {
    const x = p.x * W;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.001 * p.sp + p.ph);
    const g = ctx.createLinearGradient(0, H * 0.18, 0, H);
    g.addColorStop(0, hexA(ac, 0));
    g.addColorStop(0.7, hexA(ac, 0.05 + pulse * 0.08));
    g.addColorStop(1, hexA(pc, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, H * 0.18, p.w, H * 0.82);
  }

  drawDust(now, dt);

  if (Math.random() < 0.012 && streaks.length < 5) {
    streaks.push({ x: Math.random() * W * 0.9, y: Math.random() * H * 0.45, vx: 7 + Math.random() * 8, vy: 2 + Math.random() * 3, life: 1 });
  }
  for (let i = streaks.length - 1; i >= 0; i--) {
    const st = streaks[i];
    st.x += st.vx * dt; st.y += st.vy * dt; st.life -= 0.012 * dt;
    if (st.life <= 0 || st.x > W + 100) { streaks.splice(i, 1); continue; }
    const g = ctx.createLinearGradient(st.x, st.y, st.x - 120, st.y - 34);
    g.addColorStop(0, hexA('#ffffff', 0.55 * st.life));
    g.addColorStop(1, hexA(ac, 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(st.x - 120, st.y - 34); ctx.stroke();
  }
}

function drawParticles(now, dt) {
  drawStars(now, dt);
  const pc = S.theme.primary, ac = S.theme.accent;
  const pts = dust;
  for (const p of pts) {
    p.x += p.vx * dt * 10;
    p.y += p.vy * dt * 10;
    if (p.x < 0 || p.x > W) p.vx *= -1;
    if (p.y < 0 || p.y > H) p.vy *= -1;
    p.x = clamp(p.x, 0, W); p.y = clamp(p.y, 0, H);
    ctx.fillStyle = hexA(pc, 0.5);
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 0.4, 0, 6.3); ctx.fill();
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
      const d = dx * dx + dy * dy;
      if (d < 150 * 150) {
        ctx.strokeStyle = hexA(ac, 0.10 * (1 - Math.sqrt(d) / 150));
        ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
      }
    }
  }
}

function drawMatrix(now, dt) {
  const bgc = S.theme.bgColor || '#03030a';
  ctx.fillStyle = hexA(bgc, 0.24);
  ctx.fillRect(0, 0, W, H);
  ctx.font = '14px Consolas, monospace';
  const pc = S.theme.primary, ac = S.theme.accent;
  for (const c of matrixCols) {
    const ch = String.fromCharCode(0x30 + Math.floor(Math.random() * 0x4f));
    ctx.fillStyle = hexA(Math.random() < 0.08 ? '#ffffff' : (Math.random() < 0.5 ? pc : ac), 0.55 + Math.random() * 0.35);
    ctx.fillText(ch, c.x, c.y);
    c.y += c.sp * dt * 2.4;
    if (c.y > H + 30) { c.y = -20 - Math.random() * 200; c.sp = 1.2 + Math.random() * 3.2; }
  }
}

function drawOrbit(now, dt) {
  drawStars(now, dt);
  const pc = S.theme.primary, ac = S.theme.accent;
  const cx = W * 0.5, cy = H * 0.42;
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.36);
  core.addColorStop(0, hexA(ac, 0.08));
  core.addColorStop(0.55, hexA(pc, 0.025));
  core.addColorStop(1, hexA(ac, 0));
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 6; i++) {
    const rot = now * 0.000055 * (i % 2 ? -1 : 1) + i * 1.1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, 90 + i * 68, 26 + i * 24, 0, 0, Math.PI * 2);
    ctx.strokeStyle = hexA(i % 2 ? pc : ac, 0.10);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = hexA(ac, 0.5);
    ctx.beginPath();
    ctx.arc(90 + i * 68, 0, 1.8, 0, 6.3);
    ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < 3; i++) {
    const r = ((now * 0.00004 + i / 3) % 1) * Math.min(W, H) * 0.45;
    ctx.strokeStyle = hexA(ac, 0.05 * (1 - r / (Math.min(W, H) * 0.45)));
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.3); ctx.stroke();
  }
  drawDust(now, dt);
}

function drawWarp(now, dt) {
  const cx = W / 2, cy = H * 0.45;
  const ac = S.theme.accent, pc = S.theme.primary;
  for (const s of warp) {
    s.d += s.sp * dt;
    if (s.d > 1) { s.d = 0.02; s.a = Math.random() * Math.PI * 2; }
    const r1 = Math.pow(s.d, 2) * Math.max(W, H) * 0.8;
    const r2 = r1 + 12 + s.d * 60;
    const x1 = cx + Math.cos(s.a) * r1, y1 = cy + Math.sin(s.a) * r1;
    const x2 = cx + Math.cos(s.a) * r2, y2 = cy + Math.sin(s.a) * r2;
    ctx.strokeStyle = hexA(s.d > 0.7 ? '#ffffff' : (Math.random() < 0.5 ? ac : pc), 0.05 + s.d * 0.30);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.fillStyle = hexA(ac, 0.10);
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 6.3); ctx.fill();
}

function drawBg(now) {
  if (!bgLast) bgLast = now;
  const dt = Math.min(2.5, (now - bgLast) / 16.667);
  bgLast = now;
  if (!W || !H) { requestAnimationFrame(drawBg); return; }
  const bgc = S.theme.bgColor || '#03030a';
  if (bgMode === 'matrix') {
    ctx.fillStyle = hexA(bgc, 0.22);
    ctx.fillRect(0, 0, W, H);
  } else {
    // 必须先实色清屏: 半透明渐变叠加会逐帧累积, 几秒后背景变成刺眼的荧光色
    ctx.fillStyle = bgc;
    ctx.fillRect(0, 0, W, H);
    if (bgGrad) { ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H); }
  }
  if (bgMode === 'grid') drawHyper(now, dt);
  else if (bgMode === 'particles') drawParticles(now, dt);
  else if (bgMode === 'matrix') drawMatrix(now, dt);
  else if (bgMode === 'orbit') drawOrbit(now, dt);
  else if (bgMode === 'warp') drawWarp(now, dt);
  else drawStars(now, dt);
  requestAnimationFrame(drawBg);
}

function startBg() {
  if (bgStarted) return;
  bgStarted = true;
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  requestAnimationFrame(drawBg);
}

/* ---------------- 启动画面 ---------------- */
const BOOT_LINES = [
  '> TENSAINT-73 // SANCTUM KEY PROTOCOL v1.2',
  '> 校验安装盐与身份库 ................ OK',
  '> 挂载 AES-256-GCM 加密矩阵 ......... OK',
  '> 初始化私有空间隔离层 ............. READY',
  '> 校准 73 号节点频率 ............... OK',
  '> 建立安全回环通道 ................. ONLINE',
  '> 系统核心已就绪.',
];

function hideBoot() {
  const b = $('#boot-screen');
  document.body.classList.remove('booting');
  if (!b) return;
  b.style.transition = 'opacity .5s ease';
  b.style.opacity = '0';
  setTimeout(() => { b.classList.add('hidden'); b.style.display = 'none'; }, 520);
}

function runBoot() {
  const text = $('#boot-text'), fill = $('#boot-bar-fill'), pct = $('#boot-pct'), status = $('#boot-status'), hex = $('#boot-hex');
  if (!text) return Promise.resolve();
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return new Promise(resolve => {
    let i = 0, shown = '';
    const total = BOOT_LINES.length;
    const hexIv = setInterval(() => {
      if (!hex) return;
      hex.textContent = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join(' ');
    }, 85);
    const step = () => {
      if (i >= total) {
        clearInterval(hexIv);
        text.textContent = shown + '> 访问闸门已就绪.\n';
        fill.style.width = '100%';
        pct.textContent = '100%';
        if (status) status.textContent = 'ACCESS GATE READY';
        setTimeout(() => { hideBoot(); resolve(); }, reduced ? 80 : 460);
        return;
      }
      shown += BOOT_LINES[i] + '\n';
      text.textContent = shown;
      i++;
      const p = Math.round(i / total * 100);
      fill.style.width = p + '%';
      pct.textContent = String(p).padStart(2, '0') + '%';
      setTimeout(step, reduced ? 0 : 165);
    };
    setTimeout(step, reduced ? 0 : 220);
  });
}

/* ---------------- 登录 / 注册 / 注销 ---------------- */
function setAuthMode(mode) {
  if (mode === 'register' && !S.registrationOpen) {
    toast('管理员已关闭新用户注册', true);
    mode = 'login';
  }
  S.authMode = mode;
  $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  const lf = $('#login-form'), rf = $('#register-form');
  if (lf) lf.classList.toggle('hidden', mode !== 'login');
  if (rf) rf.classList.toggle('hidden', mode !== 'register');
  const title = $('#auth-title');
  if (title) title.textContent = mode === 'login' ? '身份接入' : '铸造新节点';
  clearLoginError();
  const focus = mode === 'login' ? $('#login-user') : $('#reg-user');
  if (focus) setTimeout(() => focus.focus(), 80);
}

function applyRegistrationState(open) {
  S.registrationOpen = open !== false;
  const tab = document.querySelector('.auth-tab[data-mode="register"]');
  if (tab) tab.classList.toggle('hidden', !S.registrationOpen);
  const chip = $('#reg-state-chip');
  if (chip) {
    chip.textContent = S.registrationOpen ? '注册开放' : '注册已关闭';
    chip.style.color = S.registrationOpen ? 'var(--ok)' : 'var(--danger)';
    chip.style.borderColor = S.registrationOpen ? 'rgba(61,255,168,.25)' : 'rgba(255,77,94,.3)';
  }
  if (!S.registrationOpen && S.authMode === 'register') setAuthMode('login');
}

function showLoginError(msg) {
  const err = $('#login-error');
  if (!err) return;
  err.textContent = msg;
  err.classList.remove('hidden');
  err.style.animation = 'none';
  void err.offsetWidth;
  err.style.animation = '';
}
function clearLoginError() {
  const err = $('#login-error');
  if (err) { err.classList.add('hidden'); err.textContent = ''; }
}
function setBtnBusy(btn, busy, textBusy) {
  if (!btn) return;
  const span = btn.querySelector('span');
  if (busy) {
    btn.dataset.label = span ? span.textContent : btn.textContent;
    btn.disabled = true;
    if (span) span.textContent = textBusy || '处 理 中 ...';
  } else {
    btn.disabled = false;
    if (span && btn.dataset.label) span.textContent = btn.dataset.label;
  }
}

async function doLogin(e) {
  if (e) e.preventDefault();
  clearLoginError();
  const username = ($('#login-user').value || '').trim();
  const password = $('#login-pass').value || '';
  const phone = ($('#login-phone').value || '').trim();
  if (!username || !password) return showLoginError('请输入身份标识与访问密钥');
  const btn = $('#login-btn');
  setBtnBusy(btn, true, '验 证 中 ...');
  const { status, data } = await rawApi('POST', '/api/login', { username, password, phone });
  setBtnBusy(btn, false);
  if (status !== 200) return showLoginError(data.error || ('接入失败 (HTTP ' + status + ')'));
  S.token = data.token;
  S.role = data.role;
  S.username = data.username;
  S.nodeId = data.nodeId || '';
  localStorage.setItem('ts73_token', data.token);
  localStorage.setItem('ts73_last_user', data.username);
  if (data.role === 'admin') await enterAdmin(null, true);
  else await enterMember({ username: data.username, nodeId: data.nodeId });
}

async function doRegister(e) {
  if (e) e.preventDefault();
  clearLoginError();
  const username = ($('#reg-user').value || '').trim();
  const pass = $('#reg-pass').value || '';
  const pass2 = $('#reg-pass2').value || '';
  if (!/^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]{1,19}$/u.test(username)) return showLoginError('用户名需 2-20 位, 以中英文或数字开头, 可含 _ . -');
  if (pass.length < 8) return showLoginError('访问密钥至少 8 位');
  if (pass !== pass2) return showLoginError('两次输入的密钥不一致');
  const btn = $('#register-btn');
  setBtnBusy(btn, true, '铸 造 中 ...');
  const { status, data } = await rawApi('POST', '/api/register', { username, password: pass });
  setBtnBusy(btn, false);
  if (status !== 200) return showLoginError(data.error || ('注册失败 (HTTP ' + status + ')'));
  S.token = data.token;
  S.role = data.role;
  S.username = data.username;
  S.nodeId = data.nodeId || '';
  localStorage.setItem('ts73_token', data.token);
  localStorage.setItem('ts73_last_user', data.username);
  $('#reg-pass').value = '';
  $('#reg-pass2').value = '';
  toast('私人节点已铸造 · 独立加密空间初始化完成');
  await enterMember({ username: data.username, nodeId: data.nodeId });
}

function showLoginScreen() {
  const boot = $('#boot-screen');
  if (boot) { boot.classList.add('hidden'); boot.style.display = 'none'; }
  $('#app').classList.add('hidden');
  $('#member-app').classList.add('hidden');
  document.body.classList.remove('member-mode', 'admin-mode', 'booting');
  const login = $('#login-screen');
  if (login) login.classList.remove('hidden');
  const last = localStorage.getItem('ts73_last_user') || '';
  const u = $('#login-user');
  if (u && !u.value && last) u.value = last;
  const p = $('#login-pass');
  if (p) p.value = '';
  const ph = $('#login-phone');
  if (ph) ph.value = '';
  clearLoginError();
  setAuthMode(S.authMode === 'register' && S.registrationOpen ? 'register' : 'login');
  setTimeout(() => { const f = $('#login-user'); if (f && !f.value) f.focus(); }, 100);
}

function doLogout(silent) {
  const token = S.token;
  if (token) {
    fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(() => {});
  }
  localStorage.removeItem('ts73_token');
  S.token = '';
  S.role = null;
  S.username = '';
  S.nodeId = '';
  S.my = null;
  S.features = [];
  S.featureMeta = {};
  S.current = 'dashboard';
  S.memberTab = 'overview';
  S.tick = {};
  S.palette = null;
  applyTheme(DEFAULT_THEME);
  if (!silent) toast('会话已注销 · 访问令牌已销毁');
  showLoginScreen();
}

async function enterAdmin(st, afterLogin) {
  if (!st) st = await api('GET', '/api/state');
  else if (!st.features) {
    // 登录接口只返回令牌; 功能模块清单在 /api/state 里, 不补取一次侧栏会是空的
    try {
      const s2 = await api('GET', '/api/state');
      if (s2 && s2.features) st = Object.assign({}, st, s2);
    } catch (e) { /* 取不到就沿用登录响应 */ }
  }
  S.role = 'admin';
  S.username = st.username;
  S.nodeId = st.nodeId || S.nodeId || '';
  S.my = null;
  S.current = 'dashboard';
  localStorage.setItem('ts73_last_user', S.username);
  const boot = $('#boot-screen');
  if (boot) { boot.classList.add('hidden'); boot.style.display = 'none'; }
  $('#login-screen').classList.add('hidden');
  $('#member-app').classList.add('hidden');
  $('#app').classList.remove('hidden');
  document.body.classList.remove('member-mode');
  document.body.classList.add('admin-mode');
  applyTheme(st.theme || DEFAULT_THEME);
  S.features = st.features || [];
  const sideUser = $('#side-user');
  if (sideUser) sideUser.innerHTML = `<b>${esc(S.username)}</b><span>ROOT ADMINISTRATOR</span>`;
  const ver = $('#side-ver');
  if (ver) ver.textContent = 'OS v' + (st.version || '1.4.0') + ' · ADMIN';
  await buildSidebar();
  navigate('dashboard');
  startTicker();
  if (afterLogin) toast('圣钥认证通过 · 欢迎回来, 掌控者');
}

async function enterMember(st) {
  S.role = 'user';
  S.username = st.username;
  S.nodeId = st.nodeId || '';
  S.memberTab = 'overview';
  localStorage.setItem('ts73_last_user', S.username);
  const boot = $('#boot-screen');
  if (boot) { boot.classList.add('hidden'); boot.style.display = 'none'; }
  $('#login-screen').classList.add('hidden');
  $('#app').classList.add('hidden');
  $('#member-app').classList.remove('hidden');
  document.body.classList.remove('admin-mode');
  document.body.classList.add('member-mode');
  const pal = paletteFor(S.username);
  applyMemberTheme(pal);
  buildMemberNav();
  const chip = $('#m-userchip');
  if (chip) {
    chip.innerHTML = `<div class="mc-avatar">${esc(S.username.slice(0, 1).toUpperCase())}</div><div style="min-width:0"><div class="mc-name">${esc(S.username)}</div><div class="mc-role">PRIVATE MEMBER</div></div>`;
  }
  const node = $('#m-nodeid');
  if (node) node.textContent = S.nodeId || 'TS73-······';
  await memberNavigate('overview');
  startTicker();
  toast('私人节点已解锁 · 文件与数据与其他用户完全隔离');
}

/* ---------------- 侧栏 / 路由 ---------------- */
const MODULES = {
  dashboard: { title: '控制台', render: renderDashboard },
  ai: { title: 'AI 助手', render: renderAI },
  database: { title: '数据库', render: renderDatabase },
  files: { title: '文件仓库', render: renderFiles },
  users: { title: '用户管理', render: renderUsers },
  account: { title: '账户安全', render: renderAdminAccount },
  features: { title: '功能模块', render: renderFeatures },
  theme: { title: '主题定制', render: renderTheme },
  logs: { title: '系统日志', render: renderLogs },
  network: { title: '网络矩阵', render: renderNetwork },
  urls: { title: '访问地址', render: renderUrls },
  tools: { title: '工具箱', render: renderTools },
  settings: { title: '系统设置', render: renderSettings },
  about: { title: '关于系统', render: renderAbout },
};

async function buildSidebar() {
  let metas = [];
  try { metas = (await api('GET', '/api/features')).features; } catch (e) { /* 忽略 */ }
  S.featureMeta = {};
  metas.forEach(f => S.featureMeta[f.id] = f);
  const nav = $('#side-nav');
  if (!nav) return;
  nav.innerHTML = '';
  for (const id of S.features) {
    const meta = S.featureMeta[id] || { name: id, icon: '✧' };
    const item = el('div', 'nav-item' + (id === S.current ? ' active' : ''));
    item.dataset.mod = id;
    item.innerHTML = `<span class="nav-icon">${esc(meta.icon)}</span>${esc(meta.name)}`;
    item.onclick = () => navigate(id);
    nav.appendChild(item);
  }
}

function navigate(id) {
  if (!MODULES[id]) {
    const meta = S.featureMeta[id] || { name: id };
    S.current = id;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.mod === id));
    $('#tb-title').textContent = meta.name;
    const c = $('#content');
    c.innerHTML = '';
    renderCustom(c, meta);
    return;
  }
  S.current = id;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.mod === id));
  const meta = S.featureMeta[id];
  $('#tb-title').textContent = (meta && meta.name) || MODULES[id].title;
  const c = $('#content');
  c.innerHTML = '';
  c.scrollTop = 0;
  Promise.resolve(MODULES[id].render(c)).catch(e => {
    c.innerHTML = '';
    c.appendChild(el('div', 'empty-tip', esc(e.message)));
  });
}

/* ---------------- 会员路由 ---------------- */
const MEMBER_MODULES = {
  overview: { title: '指挥舱', icon: '◈', render: renderMemberOverview },
  files: { title: '我的文件', icon: '▤', render: renderMemberFiles },
  database: { title: '我的数据库', icon: '⛁', render: renderMemberDatabase },
  shared: { title: '共享空间', icon: '⇄', render: renderMemberShared },
  account: { title: '账户安全', icon: '⬡', render: renderMemberAccount },
};

function buildMemberNav() {
  const nav = $('#m-nav');
  if (!nav) return;
  nav.innerHTML = '';
  for (const id of Object.keys(MEMBER_MODULES)) {
    const m = MEMBER_MODULES[id];
    const item = el('div', 'nav-item' + (id === S.memberTab ? ' active' : ''));
    item.dataset.mod = id;
    item.innerHTML = `<span class="nav-icon">${esc(m.icon)}</span>${esc(m.title)}`;
    item.onclick = () => memberNavigate(id);
    nav.appendChild(item);
  }
}

async function memberNavigate(id) {
  if (!MEMBER_MODULES[id]) return;
  S.memberTab = id;
  $$('#m-nav .nav-item').forEach(n => n.classList.toggle('active', n.dataset.mod === id));
  const title = $('#m-title');
  if (title) title.textContent = MEMBER_MODULES[id].title;
  const c = $('#m-content');
  if (!c) return;
  c.innerHTML = '';
  c.scrollTop = 0;
  try {
    await MEMBER_MODULES[id].render(c);
  } catch (e) {
    c.innerHTML = '';
    c.appendChild(el('div', 'empty-tip', esc(e.message)));
  }
}

function refreshMemberMy() {
  if (S.role !== 'user') return Promise.resolve();
  return api('GET', '/api/my').then(m => { S.my = m; updateTicker(); }).catch(() => {});
}

/* ---------------- 顶栏时钟 / 实时数据带 ---------------- */
let tickerTimer = null;
function startTicker() {
  if (!tickerTimer) tickerTimer = setInterval(updateTicker, 1000);
  updateTicker();
}
function updateTicker() {
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  ['#tb-clock', '#tb-clock2', '#m-clock', '#m-clock2'].forEach(sel => {
    const e = $(sel);
    if (e) e.textContent = now;
  });
  if (S.role === 'admin') {
    const t = S.tick || {};
    const feed = $('#ticker-admin');
    if (feed) feed.innerHTML = `<b>${esc(now)}</b> · UPTIME ${esc(t.uptime || '--')} · 用户 ${esc(t.users ?? '--')} · 表 ${esc(t.tables ?? '--')} · 行 ${esc(t.rows ?? '--')} · 文件 ${esc(t.files ?? '--')} · KEY ${esc(t.keyStatus || '--')}`;
    const u = $('#tb-uptime');
    if (u && t.uptime) u.textContent = 'UPTIME ' + t.uptime;
  } else if (S.role === 'user') {
    const t = S.tick || {};
    const feed = $('#ticker-member');
    if (feed) feed.innerHTML = `<b>${esc(now)}</b> · NODE ${esc(S.nodeId || '--')} · 表 ${esc(t.tables ?? '--')} · 行 ${esc(t.rows ?? '--')} · 文件 ${esc(t.files ?? '--')} · 空间 ${esc(t.size || '--')} · 隔离已启用`;
  }
}

/* ---------------- 通用组件 ---------------- */
function statCard(label, value, icon, note, pct) {
  const c = el('div', 'card stat-card');
  c.innerHTML = `<div class="stat-top"><span class="stat-label">${esc(label)}</span><span class="stat-icon">${esc(icon)}</span></div>
    <div class="stat-val">${esc(value)}</div>
    <div class="stat-note">${note || ''}</div>
    ${pct !== undefined ? `<div class="stat-bar"><i style="width:${clamp(pct, 0, 100)}%"></i></div>` : ''}`;
  return c;
}
function section(c, title) { c.appendChild(el('div', 'section-title', esc(title))); }

/* ==========================================================================
   管理员模块
   ========================================================================== */

/* ---- 控制台 ---- */
async function renderDashboard(c) {
  c.innerHTML = '';
  c.appendChild(el('div', 'empty-tip', '正在同步系统遥测 ...'));
  let ov, tdata, logs;
  try {
    [ov, tdata, logs] = await Promise.all([
      api('GET', '/api/overview'),
      api('GET', '/api/db/tables').catch(() => ({ tables: [] })),
      api('GET', '/api/logs').catch(() => ({ logs: [] })),
    ]);
  } catch (e) {
    c.innerHTML = '';
    c.appendChild(el('div', 'empty-tip', esc(e.message)));
    return;
  }
  c.innerHTML = '';

  const hero = el('div', 'core-hero');
  hero.innerHTML = `<div class="core-copy">
      <div class="core-kicker">SYSTEM CORE // REALTIME TELEMETRY</div>
      <div class="core-title">圣钥核心 <b>已上线</b></div>
      <div class="core-sub">加密数据库已解锁 · 会员私有空间隔离运行中 · 系统文件变动将触发密钥自动轮换</div>
      <div class="core-chips"><span>◈ AES-256-GCM</span><span>◈ NODE ${esc(ov.node)}</span><span>◈ PORT ${esc(String(ov.port))}</span><span>◈ ZERO-DEPENDENCY</span></div>
      <div class="core-mini">
        <div>数据行<b>${esc(String(ov.rows))}</b></div>
        <div>文件对象<b>${esc(String(ov.files))}</b></div>
        <div>身份节点<b>${esc(String(ov.users))}</b></div>
        <div>密钥状态<b>${esc(ov.keyStatus)}</b></div>
      </div>
    </div>
    <div class="reactor">
      <span class="r1"></span><span class="r2"></span><span class="r3"></span><span class="r4"></span>
      <div class="reactor-core"><img src="/logo.png" alt=""><i>◉ STABLE</i></div>
      <div class="reactor-status">CORE INTEGRITY 100%</div>
    </div>`;
  c.appendChild(hero);

  const sg = el('div', 'stat-grid');
  sg.appendChild(statCard('运行时间', ov.uptime, '◷', `NODE ${esc(ov.node)}`, 100));
  sg.appendChild(statCard('数据表', ov.tables + ' 张', '⛁', `共计 ${ov.rows} 行数据`, clamp(ov.tables * 8, 8, 100)));
  sg.appendChild(statCard('注册用户', ov.users + ' 个', '☗', '管理员 + 会员独立空间', clamp(ov.users * 10, 8, 100)));
  sg.appendChild(statCard('文件仓库', ov.files + ' 个', '▤', fmtSize(ov.fileSize) + ' · 加密落盘', clamp(ov.files * 2, 8, 100)));
  sg.appendChild(statCard('功能模块', ov.enabledFeatures + ' / ' + ov.features, '⚙', '可随时启停', ov.features ? ov.enabledFeatures / ov.features * 100 : 0));
  sg.appendChild(statCard('监听端口', String(ov.port), '⇄', '默认仅绑定回环地址', 100));
  sg.appendChild(statCard('运行平台', ov.platform, '⌘', 'Node ' + ov.node, 100));
  sg.appendChild(statCard('系统版本', 'v' + ov.version, '✦', esc(ov.keyStatus), 100));
  c.appendChild(sg);

  section(c, '数据矩阵');
  const g = el('div', 'grid grid-2');

  const chartCard = el('div', 'card');
  chartCard.innerHTML = '<div class="card-title">数据表容量分布</div>';
  const list = (tdata.tables || []).slice(0, 9);
  if (!list.length) {
    chartCard.appendChild(el('div', 'empty-tip', '暂无数据表 — 进入 [数据库] 创建第一张表'));
  } else {
    const max = Math.max(1, ...list.map(t => t.count));
    const chart = el('div', 'bar-chart');
    list.forEach((t, i) => {
      const row = el('div', 'bar-row');
      row.innerHTML = `<span class="bar-label">${esc(t.name)}</span><span class="bar-track"><i class="bar-fill" style="width:${Math.max(2, t.count / max * 100)}%;animation-delay:${i * 60}ms"></i></span><span class="bar-num">${t.count}</span>`;
      chart.appendChild(row);
    });
    chartCard.appendChild(chart);
    chartCard.appendChild(el('div', 'card-small', `共 ${tdata.tables.length} 张加密数据表 · 会员私有表不计入此视图`));
  }
  g.appendChild(chartCard);

  const keyCard = el('div', 'card');
  keyCard.innerHTML = `<div class="card-title">系统密钥 · ${esc(ov.keyStatus)}</div>
    <div class="kv-key">${esc(ov.key)}</div>
    <div class="card-small">系统核心文件被移动 / 修改 / 增删时, 密钥自动随机轮换。会员空间使用 install.salt 独立派生密钥。</div>
    <div class="file-toolbar" style="margin:12px 0 0"><button class="btn btn-sm" id="dash-copy-key">复制密钥</button><button class="btn btn-sm btn-accent" id="dash-rotate-key">手动轮换</button></div>`;
  g.appendChild(keyCard);
  c.appendChild(g);

  section(c, '网络接入点');
  const netCard = el('div', 'card');
  netCard.innerHTML = `<div class="card-title">接入点 · 端口 ${esc(String(ov.port))}</div>`;
  (ov.urls || []).forEach(u => {
    const row = el('div', 'net-row');
    row.innerHTML = `<span class="net-label">${esc(u.label)}</span><span class="net-url">${esc(u.url)}</span>`;
    const b = el('button', 'btn btn-sm', '复制');
    b.onclick = () => copyText(u.url);
    row.appendChild(b);
    netCard.appendChild(row);
  });
  netCard.appendChild(el('div', 'card-small', '对外访问默认通过回环 + 隧道；会员凭自身账号接入同一入口。'));
  c.appendChild(netCard);

  section(c, '事件流');
  const feedCard = el('div', 'card');
  feedCard.innerHTML = '<div class="card-title">最近系统事件</div>';
  const recent = (logs.logs || []).slice(0, 7);
  if (!recent.length) {
    feedCard.appendChild(el('div', 'empty-tip', '暂无事件日志'));
  } else {
    recent.forEach(l => {
      const item = el('div', 'feed-item' + (l.level === 'warn' ? ' warn' : ''));
      item.innerHTML = `<span class="feed-dot"></span><span class="feed-time">${esc(fmtTime(l.t))}</span><span class="feed-text">${esc(l.msg)}</span>`;
      feedCard.appendChild(item);
    });
  }
  c.appendChild(feedCard);

  $('#dash-copy-key').onclick = () => copyText(ov.key);
  $('#dash-rotate-key').onclick = () => confirmBox('确定要随机轮换系统密钥吗? 所有依赖旧密钥的引用需要更新。', async () => {
    await api('POST', '/api/key/rotate');
    toast('系统密钥已轮换');
    renderDashboard(c);
  }, '轮换');

  S.tick = {
    uptime: ov.uptime, users: ov.users, tables: ov.tables, rows: ov.rows,
    files: ov.files, keyStatus: ov.keyStatus, size: fmtSize(ov.fileSize),
  };
  updateTicker();
}

/* ---- AI 助手 ---- */
function renderAI(c) {
  const wrap = el('div', 'chat-wrap');
  const log = el('div', 'chat-log');
  wrap.appendChild(log);

  const suggestData = ['帮助', '所有表', '系统信息', '查看密钥', '界面风格 赛博', '背景 轨道', '所有功能'];
  const sugg = el('div', 'chat-suggests');
  const row = el('div', 'chat-input');
  const input = inp('', '输入指令, 例如: 创建表 圣物 名称,等级,属性');
  const btn = el('button', 'btn', '发送');

  suggestData.forEach(s => {
    const b = el('button', 'btn', esc(s));
    b.onclick = () => { input.value = s; send(); };
    sugg.appendChild(b);
  });
  wrap.appendChild(sugg);
  row.appendChild(input);
  row.appendChild(btn);
  wrap.appendChild(row);
  c.appendChild(wrap);

  function addMsg(role, text) {
    const m = el('div', 'msg ' + (role === 'ai' ? 'ai' : 'me'));
    m.appendChild(el('div', 'msg-role ' + role, role === 'ai' ? '◈ AI 控制核心' : '➤ ' + esc(S.username)));
    const b = el('div', 'bubble');
    b.textContent = text;
    m.appendChild(b);
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
  }
  addMsg('ai', 'AI 控制核心已上线。\n可直接操控系统: 增删改查数据库、更换界面风格、启停功能模块、管理用户。\n输入 "帮助" 查看全部指令。');

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg('me', text);
    const thinking = el('div', 'msg ai');
    thinking.appendChild(el('div', 'msg-role ai', '◈ AI 控制核心'));
    const bubble = el('div', 'bubble', '处理中 ...');
    thinking.appendChild(bubble);
    log.appendChild(thinking);
    log.scrollTop = log.scrollHeight;
    try {
      const r = await api('POST', '/api/ai', { message: text });
      bubble.textContent = r.reply;
      log.scrollTop = log.scrollHeight;
      for (const a of r.actions || []) {
        if (a.type === 'theme') { const st = await api('GET', '/api/state'); applyTheme(st.theme); }
        if (a.type === 'features') await buildSidebar();
        if (a.type === 'navigate') navigate(a.target);
      }
    } catch (e) {
      bubble.textContent = '错误: ' + e.message;
    }
  }
  btn.onclick = send;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  input.focus();
}

/* ---- 数据库 (管理员 / 会员 / 共享视图共用) ---- */

async function renderDbPanel(c, opts) {
  opts = opts || {};
  const B = opts.apiBase || '/api/db';
  let curT = null;
  c.innerHTML = '';
  const bar = el('div', 'file-toolbar');
  const addBtn = el('button', 'btn', '＋ 新建数据表');
  const rf = el('button', 'btn btn-accent', '⟳ 刷新');
  if (opts.canCreate !== false) bar.appendChild(addBtn);
  bar.appendChild(rf);
  bar.appendChild(el('span', 'crumb', opts.scope || ''));
  c.appendChild(bar);

  const layout = el('div', 'grid db-layout');
  const left = el('div', 'card');
  left.style.minHeight = '320px';
  const right = el('div', 'card');
  layout.appendChild(left);
  layout.appendChild(right);
  c.appendChild(layout);

  addBtn.onclick = () => {
    const name = inp('', '表名');
    const cols = inp('', '列名, 用逗号分隔, 例如: 名称,数量,备注');
    const body = el('div');
    body.appendChild(formRow('表名', name));
    body.appendChild(formRow('列 (逗号分隔)', cols));
    openModal('新建数据表', body, async () => {
      await api('POST', B + '/create', { name: name.value, columns: cols.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) });
      toast('数据表已创建');
      if (opts.onChange) opts.onChange();
      refresh();
    }, '创建');
  };

  async function refresh() {
    let d;
    try { d = await api('GET', B + '/tables'); }
    catch (e) { left.innerHTML = ''; left.appendChild(el('div', 'empty-tip', esc(e.message))); return; }
    if (curT && !d.tables.some(t => t.name === curT)) curT = null;
    if (!curT && d.tables.length) curT = d.tables[0].name;
    left.innerHTML = '<div class="card-title">数据表 (' + d.tables.length + ')</div>';
    if (!d.tables.length) left.appendChild(el('div', 'empty-tip', '暂无数据表'));
    for (const t of d.tables) {
      const lv = t.level === 'r' ? ' · 只读' : '';
      const item = el('div', 'nav-item' + (curT === t.name ? ' active' : ''), `<span class="nav-icon">⛁</span>${esc(t.name)}<span style="margin-left:auto;color:var(--dim);font-size:9px">${t.count}${lv}</span>`);
      item.onclick = () => { curT = t.name; refresh(); };
      left.appendChild(item);
    }
    if (curT) await renderTable(right, curT, refresh, opts);
    else right.innerHTML = '<div class="empty-tip">← 选择左侧数据表, 或新建一张</div>';
  }
  rf.onclick = refresh;
  await refresh();
}

async function renderTable(box, name, refresh, opts) {
  opts = opts || {};
  const B = opts.apiBase || '/api/db';
  const writable = opts.canWriteTable ? !!opts.canWriteTable(name) : true;
  // 共享库只开放行级读写, 建表/删表/加列属于管理员的结构权限
  const canStruct = opts.canStructure !== undefined ? !!opts.canStructure : writable;
  let t;
  try { t = await api('GET', B + '/table?name=' + encodeURIComponent(name)); }
  catch (e) { box.innerHTML = ''; box.appendChild(el('div', 'empty-tip', esc(e.message))); return; }
  box.innerHTML = '';
  const head = el('div', 'file-toolbar');
  head.appendChild(el('span', 'crumb', `表 <b style="color:var(--primary)">${esc(t.name)}</b> · ${t.count} 行 · ${t.columns.length} 列${writable ? '' : ' · 只读授权'}`));
  const sp = el('span'); sp.style.flex = '1'; head.appendChild(sp);
  const addCol = el('button', 'btn btn-sm', '＋列');
  addCol.onclick = () => {
    const col = inp('', '列名');
    const body = el('div'); body.appendChild(formRow('新列名', col));
    openModal('添加列 [' + t.name + ']', body, async () => {
      await api('POST', B + '/addcol', { table: t.name, col: col.value });
      toast('已添加');
      if (opts.onChange) opts.onChange();
      refresh();
    }, '添加');
  };
  const addRow = el('button', 'btn btn-sm', '＋行');
  addRow.onclick = () => editRowModal(t, null, refresh, opts);
  const clear = el('button', 'btn btn-sm btn-danger', '清空');
  clear.onclick = () => confirmBox(`清空表 [${t.name}] 的全部 ${t.count} 行?`, async () => {
    await api('POST', B + '/clear', { table: t.name });
    toast('已清空');
    if (opts.onChange) opts.onChange();
    refresh();
  });
  const drop = el('button', 'btn btn-sm btn-danger', '删表');
  drop.onclick = () => confirmBox(`永久删除表 [${t.name}]? 不可恢复。`, async () => {
    await api('POST', B + '/drop', { name: t.name });
    toast('表已删除');
    if (opts.onChange) opts.onChange();
    refresh();
  });
  if (canStruct) {
    head.appendChild(addCol);
    head.appendChild(clear);
    head.appendChild(drop);
  }
  if (writable) head.appendChild(addRow);
  box.appendChild(head);

  if (!t.rows.length) {
    box.appendChild(el('div', 'empty-tip', writable ? '空表 — 点击 "＋行" 写入第一条数据' : '空表'));
    return;
  }
  const tbl = el('table', 'tbl');
  const trh = el('tr');
  t.columns.forEach(c2 => {
    const th = el('th', '', esc(c2) + (canStruct ? ' <span style="cursor:pointer;color:var(--danger);margin-left:4px" title="删除此列">×</span>' : ''));
    if (canStruct) th.querySelector('span').onclick = () => confirmBox(`删除列 [${c2}]?`, async () => {
      await api('POST', B + '/delcol', { table: t.name, col: c2 });
      toast('列已删除');
      if (opts.onChange) opts.onChange();
      refresh();
    });
    trh.appendChild(th);
  });
  if (writable) trh.appendChild(el('th', '', '操作'));
  tbl.appendChild(trh);
  for (const row of t.rows) {
    const tr = el('tr');
    t.columns.forEach(c2 => tr.appendChild(el('td', '', esc(row[c2]))));
    if (writable) {
      const td = el('td', 'row-actions');
      const bE = el('button', 'btn btn-sm', '改');
      bE.onclick = () => editRowModal(t, row, refresh, opts);
      const bD = el('button', 'btn btn-sm btn-danger', '删');
      bD.onclick = () => confirmBox('删除该行?', async () => {
        await api('POST', B + '/delete', { table: t.name, id: row.id });
        if (opts.onChange) opts.onChange();
        refresh();
      });
      td.appendChild(bE);
      td.appendChild(bD);
      tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }
  box.appendChild(tbl);
}

function editRowModal(t, row, refresh, opts) {
  const B = (opts && opts.apiBase) || '/api/db';
  const inputs = {};
  const body = el('div');
  for (const c2 of t.columns) {
    const i = inp(row ? row[c2] : '');
    inputs[c2] = i;
    body.appendChild(formRow(c2, i));
  }
  openModal((row ? '修改' : '添加') + '数据 [' + t.name + ']', body, async () => {
    const data = {};
    for (const c2 of t.columns) data[c2] = inputs[c2].value;
    if (row) await api('POST', B + '/update', { table: t.name, id: row.id, patch: data });
    else await api('POST', B + '/insert', { table: t.name, row: data });
    toast('已保存');
    if (opts && opts.onChange) opts.onChange();
    refresh();
  }, '保存');
}

function renderDatabase(c) {
  return renderDbPanel(c, { scope: 'GLOBAL ENCRYPTED DB', onChange: null });
}

/* ---- 文件仓库 (管理员 / 会员共用) ---- */
async function renderFileBrowser(c, opts) {
  opts = opts || {};
  const FB = opts.fsBase || '/api/fs';
  const canWrite = opts.writableAt || (() => true);
  c.innerHTML = '';
  const bar = el('div', 'file-toolbar');
  const up = el('button', 'btn', '⬆ 上传文件');
  const mk = el('button', 'btn', '＋ 新建文件夹');
  const rf = el('button', 'btn btn-accent', '⟳ 刷新');
  const crumb = el('span', 'crumb');
  bar.appendChild(up);
  bar.appendChild(mk);
  bar.appendChild(rf);
  bar.appendChild(el('span', 'crumb', opts.scope || ''));
  bar.appendChild(crumb);
  c.appendChild(bar);

  const grid = el('div', 'file-grid');
  c.appendChild(grid);

  const hidden = el('input');
  hidden.type = 'file';
  hidden.multiple = true;
  hidden.style.display = 'none';
  c.appendChild(hidden);

  let cur = opts.startPath || '';
  let uploading = false;

  up.onclick = () => hidden.click();
  hidden.onchange = async () => {
    if (uploading) return;
    uploading = true;
    const files = Array.from(hidden.files || []);
    hidden.value = '';
    try {
      for (const f of files) {
        const buf = await f.arrayBuffer();
        await api('POST', FB + '/upload', { path: cur, name: f.name, data: b64(buf) });
        toast('已加密上传: ' + f.name);
      }
      if (files.length && opts.onChange) opts.onChange();
      refresh();
    } catch (e) {
      toast(e.message, true);
    } finally {
      uploading = false;
    }
  };
  mk.onclick = () => {
    const name = inp('', '文件夹名');
    const body = el('div');
    body.appendChild(formRow('名称', name));
    openModal('新建文件夹', body, async () => {
      await api('POST', FB + '/mkdir', { path: cur, name: name.value });
      toast('文件夹已创建');
      if (opts.onChange) opts.onChange();
      refresh();
    }, '创建');
  };
  rf.onclick = () => refresh();

  async function download(path, name) {
    const r = await fetch(FB + '/download?path=' + encodeURIComponent(path), { headers: { Authorization: 'Bearer ' + S.token } });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || ('HTTP ' + r.status));
    }
    const blob = await r.blob();
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function refresh() {
    const root = opts.startPath || '';
    crumb.innerHTML = `位置: <b data-p="${esc(root)}">${esc(opts.rootLabel || '根目录')}</b>`;
    let acc = root;
    const baseLen = root.split('/').filter(Boolean).length;
    cur.split('/').filter(Boolean).forEach((s, i) => {
      if (i < baseLen) return;
      acc = acc ? acc + '/' + s : s;
      crumb.innerHTML += ' / <b data-p="' + esc(acc) + '">' + esc(s) + '</b>';
    });
    crumb.querySelectorAll('b').forEach(b => b.onclick = () => { cur = b.dataset.p || ''; refresh(); });
    up.style.display = canWrite(cur) ? '' : 'none';
    mk.style.display = canWrite(cur) ? '' : 'none';
    let d;
    try { d = await api('GET', FB + '/list?path=' + encodeURIComponent(cur)); }
    catch (e) { grid.innerHTML = ''; grid.appendChild(el('div', 'empty-tip', esc(e.message))); return; }
    grid.innerHTML = '';
    if (!d.items.length) grid.appendChild(el('div', 'empty-tip', canWrite(cur) ? '空目录 — 上传文件或新建文件夹' : '空目录 (只读)'))
    for (const it of d.items) {
      const p = cur ? cur + '/' + it.name : it.name;
      const item = el('div', 'file-item');
      item.innerHTML = `<div class="fi-icon">${it.link ? '⛓' : it.dir ? '▤' : '◇'}</div><div class="fi-name">${esc(it.name)}</div><div class="fi-size">${it.link ? 'LINK' : it.dir ? 'FOLDER' : fmtSize(it.size)}</div>`;
      const acts = el('div', 'row-actions');

      if (it.dir) {
        item.onclick = () => { cur = p; refresh(); };
      } else if (!it.link) {
        item.onclick = () => {
          $$('.file-item').forEach(x => x.classList.remove('selected'));
          item.classList.add('selected');
        };
        const dl = el('button', 'btn btn-sm', '下载');
        dl.onclick = async e => {
          e.stopPropagation();
          try { await download(p, it.name); } catch (err) { toast(err.message, true); }
        };
        acts.appendChild(dl);
      }

      if (canWrite(p)) {
        const del = el('button', 'btn btn-sm btn-danger', '删除');
        del.onclick = e => {
          e.stopPropagation();
          armOnce(del, '删除', async () => {
            const note = (opts.admin && (p === 'users' || p.startsWith('users/'))) ? ' 这会删除会员私有文件!' : '';
            await api('POST', FB + '/delete', { path: p });
            toast('已删除' + note);
            if (opts.onChange) opts.onChange();
            refresh();
          });
        };
        acts.appendChild(del);
      }
      item.appendChild(acts);
      grid.appendChild(item);
    }
  }
  await refresh();
}

function renderFiles(c) {
  return renderFileBrowser(c, { rootLabel: '文件仓库根', scope: 'GLOBAL VAULT', admin: true, onChange: null });
}

/* ---- 用户管理 ---- */
async function renderUsers(c) {
  c.innerHTML = '';
  const bar = el('div', 'file-toolbar');
  const btn = el('button', 'btn', '＋ 新建用户');
  bar.appendChild(btn);
  bar.appendChild(el('span', 'crumb', '新账号首次登录时自动分配独立加密空间'));
  c.appendChild(bar);
  const box = el('div', 'card');
  c.appendChild(box);

  btn.onclick = () => {
    const u = inp('', '用户名');
    const p = inp('', '密码 (至少 8 位)');
    const r = el('select', 'inp');
    r.innerHTML = '<option value="user">会员 · 独立私有空间</option><option value="admin">最高权限 · 全局控制</option>';
    const body = el('div');
    body.appendChild(formRow('用户名', u));
    body.appendChild(formRow('密码', p));
    body.appendChild(formRow('权限阶级', r));
    body.appendChild(el('div', 'card-small', '会员只能看到自己的文件与数据表, 与其他会员完全隔离。'));
    openModal('新建用户', body, async () => {
      await api('POST', '/api/users/create', { username: u.value, password: p.value, role: r.value });
      toast('用户已创建');
      refresh();
    }, '创建');
  };

  async function openSpace(username) {
    let d;
    try { d = await api('GET', '/api/users/space?username=' + encodeURIComponent(username)); }
    catch (e) { toast(e.message, true); return; }
    const body = el('div');
    body.innerHTML = `<div class="mono-list">
      <div><span class="k">节点 ID</span><span class="v hl">${esc(d.nodeId)}</span></div>
      <div><span class="k">工作区</span><span class="v">${esc(d.workspace)}</span></div>
      <div><span class="k">创建时间</span><span class="v">${esc(fmtTime(d.createdAt))}</span></div>
      <div><span class="k">数据表</span><span class="v">${d.totals.tables} 张 / ${d.totals.rows} 行</span></div>
      <div><span class="k">文件</span><span class="v">${d.files.files} 个 / ${fmtSize(d.files.size)}</span></div>
      <div><span class="k">安全手机</span><span class="v">${d.phoneBound ? '已绑定 · 号码加密, 管理员不可见' : '未绑定'}</span></div>
    </div>`;
    if (d.tables.length) {
      const tbl = el('table', 'tbl');
      tbl.innerHTML = '<tr><th>表名</th><th>列</th><th>行数</th></tr>' + d.tables.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.columns.join(' / '))}</td><td>${t.count}</td></tr>`).join('');
      body.appendChild(el('div', 'section-title', '私有数据表'));
      body.appendChild(tbl);
    }
    body.appendChild(el('div', 'section-title', '最近活动'));
    if (!d.activity.length) body.appendChild(el('div', 'empty-tip', '暂无活动'));
    else d.activity.slice(0, 10).forEach(a => {
      const row = el('div', 'feed-item');
      row.innerHTML = `<span class="feed-dot"></span><span class="feed-time">${esc(fmtTime(a.t))}</span><span class="feed-text">${esc(a.msg)}</span>`;
      body.appendChild(row);
    });
    openModal('私有空间 · ' + username, body, async () => true, '关闭');
  }

  async function openGrants(username) {
    let d;
    try { d = await api('GET', '/api/grants'); }
    catch (e) { toast(e.message, true); return; }
    const me = (d.users || []).find(u => u.username === username);
    const curT = (me && me.grants && me.grants.tables) || {};
    const curF = (me && me.grants && me.grants.files) || {};
    const body = el('div');
    const mkSel = (v) => {
      const s = el('select', 'inp');
      s.innerHTML = '<option value="">不授权</option><option value="r">只读</option><option value="rw">读写</option>';
      s.value = v || '';
      return s;
    };
    const tSel = {}, fSel = {};
    body.appendChild(el('div', 'section-title', '数据表 (全局加密库)'));
    if (!d.tables.length) body.appendChild(el('div', 'empty-tip', '全局库还没有数据表'));
    for (const n of d.tables) {
      const s = mkSel(curT[n]);
      tSel[n] = s;
      body.appendChild(formRow(n, s));
    }
    body.appendChild(el('div', 'section-title', '目录 (授予父目录即含整棵子树)'));
    if (!d.dirs.length) body.appendChild(el('div', 'empty-tip', '文件仓库还没有子目录'));
    for (const p of d.dirs) {
      const s = mkSel(curF[p]);
      fSel[p] = s;
      body.appendChild(formRow(p, s));
    }
    body.appendChild(el('div', 'card-small', `保存后 [${username}] 的下一次请求立即生效, 收回同样即时失效。会员私有空间不在可授权范围内, 无论怎样勾选都不会被共享。`));
    openModal('数据授权 · ' + username, body, async () => {
      const grants = { tables: {}, files: {} };
      for (const n of d.tables) if (tSel[n].value) grants.tables[n] = tSel[n].value;
      for (const p of d.dirs) if (fSel[p].value) grants.files[p] = fSel[p].value;
      await api('POST', '/api/grants/set', { username, grants });
      toast('授权已保存');
    }, '保存');
  }

  async function refresh() {
    let d;
    try { d = await api('GET', '/api/users'); } catch (e) { box.innerHTML = ''; box.appendChild(el('div', 'empty-tip', esc(e.message))); return; }
    box.innerHTML = '<div class="card-title">用户列表 (' + d.users.length + ')</div>';
    const tbl = el('table', 'tbl');
    tbl.innerHTML = '<tr><th>用户名</th><th>权限阶级</th><th>安全手机</th><th>创建时间</th><th>操作</th></tr>';
    for (const u of d.users) {
      const tr = el('tr');
      const roleTag = u.role === 'admin' ? '<span class="tag on">最高权限</span>' : '<span class="tag">会员 · 私有空间</span>';
      const phoneTag = u.phoneBound ? '<span class="tag on">已绑定</span>' : '<span class="tag off">未绑定</span>';
      tr.innerHTML = `<td>${esc(u.username)}</td><td>${roleTag}</td><td>${phoneTag}</td><td>${esc(fmtTime(u.createdAt))}</td>`;
      const td = el('td', 'row-actions');
      if (u.role !== 'admin') {
        const space = el('button', 'btn btn-sm btn-accent', '空间');
        space.onclick = () => openSpace(u.username);
        td.appendChild(space);
        const grants = el('button', 'btn btn-sm', '授权');
        grants.onclick = () => openGrants(u.username);
        td.appendChild(grants);
      }
      const pw = el('button', 'btn btn-sm', '改密');
      pw.onclick = () => {
        const p = inp('', '新密码 (至少8位)');
        const body = el('div');
        body.appendChild(formRow('新密码 [' + u.username + ']', p));
        openModal('修改密码', body, async () => {
          if (p.value.length < 8) { toast('密码至少 8 位', true); return false; }
          const r = await api('POST', '/api/users/password', { username: u.username, password: p.value });
          if (r.relogin) {
            toast('密码已修改, 数据库已用新密码重新加密 — 请重新登录');
            localStorage.removeItem('ts73_token');
            setTimeout(() => location.reload(), 1200);
          } else {
            toast('密码已修改, 该用户的在线会话已全部作废');
          }
        }, '修改');
      };
      const del = el('button', 'btn btn-sm btn-danger', '删除');
      del.onclick = () => confirmBox(`删除用户 [${u.username}]? 其私有文件与数据仍保留在磁盘上。`, async () => {
        await api('POST', '/api/users/delete', { username: u.username });
        toast('已删除');
        refresh();
      });
      td.appendChild(pw);
      td.appendChild(del);
      tr.appendChild(td);
      tbl.appendChild(tr);
    }
    box.appendChild(tbl);
  }
  await refresh();
}

/* ---- 功能模块 ---- */
async function renderFeatures(c) {
  c.innerHTML = '';
  const bar = el('div', 'file-toolbar');
  const btn = el('button', 'btn', '＋ 新增功能模块');
  bar.appendChild(btn);
  c.appendChild(bar);
  const box = el('div', 'card');
  c.appendChild(box);

  btn.onclick = () => {
    const n = inp('', '模块名');
    const d2 = inp('', '描述');
    const body = el('div');
    body.appendChild(formRow('名称', n));
    body.appendChild(formRow('描述', d2));
    openModal('新增功能模块', body, async () => {
      await api('POST', '/api/features/add', { name: n.value, desc: d2.value });
      toast('已添加');
      await buildSidebar();
      refresh();
    }, '添加');
  };

  async function refresh() {
    let d;
    try { d = await api('GET', '/api/features'); } catch (e) { box.appendChild(el('div', 'empty-tip', esc(e.message))); return; }
    box.innerHTML = '<div class="card-title">模块列表 (' + d.features.length + ')</div>';
    const tbl = el('table', 'tbl');
    tbl.innerHTML = '<tr><th>状态</th><th>图标</th><th>名称</th><th>描述</th><th>来源</th><th>操作</th></tr>';
    for (const f of d.features) {
      const tr = el('tr');
      tr.innerHTML = `<td><span class="tag ${f.enabled ? 'on' : 'off'}">${f.enabled ? '启用' : '禁用'}</span></td>
        <td style="font-size:15px">${esc(f.icon)}</td><td>${esc(f.name)}</td><td style="color:var(--dim)">${esc(f.desc || '—')}</td>
        <td>${f.builtin ? '<span class="tag">内置</span>' : '<span class="tag">自定义</span>'}</td>`;
      const td = el('td', 'row-actions');
      const tg = el('button', 'btn btn-sm', f.enabled ? '禁用' : '启用');
      tg.onclick = async () => {
        await api('POST', '/api/features/toggle', { id: f.id, enabled: !f.enabled });
        toast(f.name + ' 已' + (f.enabled ? '禁用' : '启用'));
        await buildSidebar();
        refresh();
      };
      td.appendChild(tg);
      if (!f.builtin) {
        const del = el('button', 'btn btn-sm btn-danger', '删除');
        del.onclick = () => confirmBox(`删除功能模块 [${f.name}]?`, async () => {
          await api('POST', '/api/features/remove', { id: f.id });
          toast('已删除');
          await buildSidebar();
          refresh();
        });
        td.appendChild(del);
      }
      tr.appendChild(td);
      tbl.appendChild(tr);
    }
    box.appendChild(tbl);
  }
  await refresh();
}

/* ---- 主题定制 ---- */
function renderTheme(c) {
  c.innerHTML = '';
  return api('GET', '/api/state').then(st => {
    const t = st.theme;
    applyTheme(t);

    section(c, '风格套装');
    const presetsCard = el('div', 'card');
    const chips = el('div', 'style-presets');
    const presets = [
      ['金', 'gold', { primary: '#f2c94c', accent: '#25e7ff' }],
      ['赛博', 'cyber', { primary: '#00e5ff', accent: '#ff2d95' }],
      ['霓虹', 'neon', { primary: '#b967ff', accent: '#01cdfe' }],
      ['毒液', 'toxic', { primary: '#39ff14', accent: '#00ff9f' }],
      ['暗红', 'crimson', { primary: '#ff3131', accent: '#ffd24d' }],
    ];
    presets.forEach(([name, id, colors]) => {
      const chip = el('div', 'preset-chip' + (t.uiStyle === id ? ' active' : ''), name);
      chip.onclick = async () => {
        const r = await api('POST', '/api/theme/set', { theme: { ...colors, uiStyle: id } });
        applyTheme(r.theme);
        toast(name + ' 风格已应用');
        renderTheme(c);
      };
      chips.appendChild(chip);
    });
    presetsCard.appendChild(chips);
    presetsCard.appendChild(el('div', 'card-small', '管理员主题只影响本控制台; 会员界面按身份哈希生成专属配色。'));
    c.appendChild(presetsCard);

    section(c, '自定义颜色');
    const card = el('div', 'card');
    const mkColor = (label, key) => {
      const row = el('div', 'color-row');
      row.appendChild(el('span', 'crumb', label));
      const col = el('input');
      col.type = 'color';
      col.value = t[key];
      const hex = el('span', 'crumb', t[key]);
      row.appendChild(col);
      row.appendChild(hex);
      col.oninput = () => { hex.textContent = col.value; };
      col.onchange = async () => {
        const r = await api('POST', '/api/theme/set', { theme: { [key]: col.value } });
        applyTheme(r.theme);
        toast('颜色已更新');
      };
      return row;
    };
    card.appendChild(mkColor('主色调', 'primary'));
    card.appendChild(mkColor('强调色', 'accent'));
    card.appendChild(mkColor('背景底色', 'bgColor'));
    c.appendChild(card);

    section(c, '背景动画');
    const bgCard = el('div', 'card');
    [['grid', '星港网格'], ['particles', '粒子星云'], ['matrix', '代码雨'], ['orbit', '轨道环'], ['warp', '曲速跃迁'], ['none', '深空静默']].forEach(([mode, name]) => {
      const b = el('button', 'btn' + (t.bg === mode ? ' btn-accent' : ''), name);
      b.style.marginRight = '9px';
      b.style.marginBottom = '8px';
      b.onclick = async () => {
        const r = await api('POST', '/api/theme/set', { theme: { bg: mode } });
        applyTheme(r.theme);
        toast('背景: ' + name);
        renderTheme(c);
      };
      bgCard.appendChild(b);
    });
    c.appendChild(bgCard);

    section(c, '自定义 CSS (界面深度改造)');
    const cssCard = el('div', 'card');
    const ta = el('textarea', 'inp');
    ta.rows = 6;
    ta.style.width = '100%';
    ta.value = t.customCss || '';
    ta.placeholder = '例如: .card { border-radius: 20px; }';
    cssCard.appendChild(ta);
    const cssRow = el('div', 'file-toolbar');
    cssRow.style.marginTop = '12px';
    const saveCss = el('button', 'btn', '注入 CSS');
    saveCss.onclick = async () => {
      const r = await api('POST', '/api/theme/set', { theme: { customCss: ta.value } });
      applyTheme(r.theme);
      toast('自定义 CSS 已注入');
    };
    const clearCss = el('button', 'btn btn-danger', '清除');
    clearCss.onclick = async () => {
      ta.value = '';
      const r = await api('POST', '/api/theme/set', { theme: { customCss: '' } });
      applyTheme(r.theme);
      toast('已清除自定义 CSS');
    };
    cssRow.appendChild(saveCss);
    cssRow.appendChild(clearCss);
    cssCard.appendChild(cssRow);
    c.appendChild(cssCard);

    const resetRow = el('div', 'file-toolbar');
    resetRow.style.marginTop = '18px';
    const reset = el('button', 'btn btn-danger', '恢复默认主题');
    reset.onclick = async () => {
      const r = await api('POST', '/api/theme/reset');
      applyTheme(r.theme);
      toast('已恢复默认黑金主题');
      renderTheme(c);
    };
    resetRow.appendChild(reset);
    c.appendChild(resetRow);
  });
}

/* ---- 日志 ---- */
async function renderLogs(c) {
  c.innerHTML = '';
  const bar = el('div', 'file-toolbar');
  const clear = el('button', 'btn btn-danger', '清空日志');
  const rf = el('button', 'btn btn-accent', '⟳ 刷新');
  const box = el('div', 'card');
  bar.appendChild(clear);
  bar.appendChild(rf);
  c.appendChild(bar);
  c.appendChild(box);

  async function refresh() {
    let d;
    try { d = await api('GET', '/api/logs'); } catch (e) { box.innerHTML = ''; box.appendChild(el('div', 'empty-tip', esc(e.message))); return; }
    box.innerHTML = '<div class="card-title">最近 ' + d.logs.length + ' 条</div>';
    if (!d.logs.length) box.appendChild(el('div', 'empty-tip', '暂无日志'));
    d.logs.forEach(l => {
      box.appendChild(el('div', 'log-line ' + l.level, `<span class="lt">${esc(fmtTime(l.t))}</span><span class="ll">[${esc(l.level).toUpperCase()}]</span> ${esc(l.msg)}`));
    });
  }
  clear.onclick = () => confirmBox('清空全部系统日志?', async () => {
    await api('POST', '/api/logs/clear');
    toast('日志已清空');
    refresh();
  });
  rf.onclick = refresh;
  await refresh();
}

/* ---- 网络 ---- */
async function renderNetwork(c) {
  c.innerHTML = '';
  let d;
  try { d = await api('GET', '/api/network'); } catch (e) { c.appendChild(el('div', 'empty-tip', esc(e.message))); return; }
  const card = el('div', 'card');
  card.innerHTML = `<div class="card-title">接入点 · 端口 ${esc(String(d.port))}</div>`;
  (d.urls || []).forEach(u => {
    const row = el('div', 'net-row');
    row.innerHTML = `<span class="net-label">${esc(u.label)}</span><span class="net-url">${esc(u.url)}</span>`;
    const b = el('button', 'btn btn-sm', '复制');
    b.onclick = () => copyText(u.url);
    row.appendChild(b);
    card.appendChild(row);
  });
  c.appendChild(card);

  const tun = el('div', 'card');
  tun.style.marginTop = '16px';
  c.appendChild(tun);

  let polls = 0, pollTimer = null;
  const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
  const drawTunnel = (t) => {
    tun.innerHTML = '<div class="card-title">隧道控制 · 平台内开关</div>';
    const state = t.running
      ? '<span style="color:var(--ok)">● 运行中</span>'
      : t.supported ? '<span style="color:var(--muted)">○ 未开启</span>' : '<span style="color:var(--danger)">● 组件未安装</span>';
    const info = el('div', 'mono-list');
    info.style.lineHeight = '2.2';
    info.innerHTML = `
      <div><span class="k">状态</span><span class="v">${state}</span></div>
      <div><span class="k">公网地址</span><span class="v">${t.url ? esc(t.url) : '开启后自动生成 (trycloudflare.com)'}</span></div>
      <div><span class="k">组件</span><span class="v">${t.supported ? '已就绪' : '未安装'}</span></div>
      ${t.error ? `<div><span class="k">提示</span><span class="v" style="color:var(--danger)">${esc(t.error)}</span></div>` : ''}`;
    tun.appendChild(info);
    const bar = el('div', 'file-toolbar');
    bar.style.marginTop = '14px';
    if (!t.supported) {
      const ins = el('button', 'btn btn-accent', '安装隧道组件');
      ins.onclick = async () => {
        setBtnBusy(ins, true, '下 载 中 ...');
        const span = ins.querySelector('span');
        let secs = 0;
        const timer = setInterval(() => {
          secs++;
          if (span) span.textContent = `下 载 中 ${secs}s ...`;
        }, 1000);
        try {
          await api('POST', '/api/tunnel/install');
          toast('隧道组件已安装 · 正在开启隧道…');
          await startTunnelFlow();
        } catch (e) {
          toast(e.message, true);
          setBtnBusy(ins, false);
          await pullTunnel();
        } finally {
          clearInterval(timer);
        }
      };
      bar.appendChild(ins);
    } else if (t.running) {
      if (t.url) {
        const cp = el('button', 'btn', '复制公网地址');
        cp.onclick = () => copyText(t.url);
        bar.appendChild(cp);
      }
      const stop = el('button', 'btn btn-danger', '关闭隧道');
      stop.onclick = async () => {
        setBtnBusy(stop, true, '关 闭 中 ...');
        try {
          stopPolling();
          drawTunnel(await api('POST', '/api/tunnel/stop'));
          toast('隧道已关闭 · 公网地址立即失效');
        } catch (e) { toast(e.message, true); setBtnBusy(stop, false); }
      };
      bar.appendChild(stop);
    } else {
      const start = el('button', 'btn btn-accent', '开启隧道');
      start.onclick = async () => {
        setBtnBusy(start, true, '申 请 中 ...');
        await startTunnelFlow();
      };
      bar.appendChild(start);
    }
    const rf = el('button', 'btn', '刷新状态');
    rf.onclick = () => pullTunnel();
    bar.appendChild(rf);
    tun.appendChild(bar);
    tun.appendChild(el('div', 'card-small', '隧道只转发本机回环端口, 无需路由器端口映射; 关闭后临时地址立即失效。'));
  };
  const startTunnelFlow = async () => {
    try {
      drawTunnel(await api('POST', '/api/tunnel/start'));
      toast('隧道申请已发出 · 地址生成后自动显示');
      stopPolling();
      polls = 0;
      pollTimer = setInterval(async () => {
        polls++;
        if (polls > 45 || S.current !== 'network') { stopPolling(); return; }
        try {
          const st = await api('GET', '/api/tunnel/status');
          drawTunnel(st);
          if (st.url || !st.running) stopPolling();
        } catch (e) { stopPolling(); }
      }, 2000);
    } catch (e) {
      toast(e.message, true);
      await pullTunnel();
    }
  };
  const pullTunnel = async () => {
    try { drawTunnel(await api('GET', '/api/tunnel/status')); }
    catch (e) { tun.innerHTML = `<div class="empty-tip">${esc(e.message)}</div>`; }
  };
  await pullTunnel();

  const help = el('div', 'card');
  help.style.marginTop = '16px';
  help.innerHTML = `<div class="card-title">接入规则</div>
    <div class="mono-list" style="line-height:2.2">
      <div><span class="k">源站监听</span><span class="v">${esc(String(d.port))} 端口, 默认只绑 127.0.0.1, 局域网和公网都不能直连</span></div>
      <div><span class="k">本机</span><span class="v">在本机浏览器打开 http://127.0.0.1:${esc(String(d.port))}</span></div>
      <div><span class="k">会员入口</span><span class="v">同一地址, 使用各自账号登录; 登录后进入专属私有空间</span></div>
      <div><span class="k">远程</span><span class="v">在本页“隧道控制”直接开启或关闭 cloudflared 出站隧道, 地址自动记入网址板块</span></div>
      <div><span class="k">隔离</span><span class="v">会员文件写入 data/files/users/&lt;workspace&gt;, 数据写入 data/users/&lt;hash&gt;.db</span></div>
      <div><span class="k">禁忌</span><span class="v">不要做路由器端口转发, 那会把明文 HTTP 直接暴露到公网</span></div>
    </div>`;
  c.appendChild(help);
}

/* ---- 网址 ---- */
async function renderUrls(c) {
  c.innerHTML = '';
  let d;
  try { d = await api('GET', '/api/urls'); } catch (e) { c.appendChild(el('div', 'empty-tip', esc(e.message))); return; }

  const bar = el('div', 'file-toolbar');
  const addBtn = el('button', 'btn', '＋ 手动添加网址');
  const refreshBtn = el('button', 'btn', '刷 新');
  const clearBtn = el('button', 'btn btn-danger', '清空历史');
  addBtn.onclick = () => {
    const u = inp('', 'https:// 开头');
    const n = inp('', '名称, 例如: 我的固定域名');
    const note = inp('', '备注 (可选)');
    const body = el('div');
    body.appendChild(formRow('地址', u));
    body.appendChild(formRow('名称', n));
    body.appendChild(formRow('备注', note));
    openModal('添加网址', body, async () => {
      const r = await api('POST', '/api/urls/add', { url: u.value, name: n.value, note: note.value });
      toast(r.existed ? '这个地址已经在历史里了' : '已添加');
      renderUrls(c);
    }, '保存');
  };
  refreshBtn.onclick = () => renderUrls(c);
  clearBtn.onclick = () => armOnce(clearBtn, '清空历史', async () => {
    const r = await api('POST', '/api/urls/clear', {});
    toast(`已删除 ${r.removed} 条记录`);
    renderUrls(c);
  });
  bar.appendChild(addBtn);
  bar.appendChild(refreshBtn);
  bar.appendChild(clearBtn);
  c.appendChild(bar);

  const card = el('div', 'card');
  card.innerHTML = '<div class="card-title">当前对外地址</div>';
  if (!d.current) {
    card.appendChild(el('div', 'card-small', '还没有对外地址。执行 ./run-online.sh 后, 隧道网址会自动记入这里。'));
  } else {
    const row = el('div', 'url-row');
    row.innerHTML = `<div class="url-main"><div class="url-addr">${esc(d.current.url)}</div>
      <div class="url-meta">${esc(d.current.name || '未命名')} · ${esc(d.current.source)} · ${esc(fmtTime(d.current.createdAt))}</div></div>`;
    const acts = el('div', 'row-actions');
    const cp = el('button', 'btn btn-sm', '复制');
    cp.onclick = () => copyText(d.current.url);
    const op = el('button', 'btn btn-sm', '打开');
    op.onclick = () => window.open(d.current.url, '_blank', 'noopener');
    acts.appendChild(cp);
    acts.appendChild(op);
    row.appendChild(acts);
    card.appendChild(row);
  }
  const local = el('div', 'card-small');
  local.innerHTML = `本机地址 <span class="v hl">${esc(d.local)}</span> — 历史最多保留 ${esc(String(d.max))} 条。`;
  card.appendChild(local);
  c.appendChild(card);

  section(c, '历史地址 (' + d.urls.length + ')');
  if (!d.urls.length) {
    c.appendChild(el('div', 'empty-tip', '暂无记录'));
    return;
  }
  const box = el('div', 'card');
  for (const it of d.urls) {
    const row = el('div', 'url-row');
    row.innerHTML = `<div class="url-main"><div class="url-addr">${it.current ? '<span class="tag on">当前</span> ' : ''}${esc(it.url)}</div>
      <div class="url-meta">${esc(it.name || '未命名')} · ${esc(it.source)} · ${esc(fmtTime(it.createdAt))}${it.note ? ' · ' + esc(it.note) : ''}</div></div>`;
    const acts = el('div', 'row-actions');
    if (!it.current) {
      const set = el('button', 'btn btn-sm', '设为当前');
      set.onclick = async () => { await api('POST', '/api/urls/current', { id: it.id }); toast('已切换'); renderUrls(c); };
      acts.appendChild(set);
    }
    const cp2 = el('button', 'btn btn-sm', '复制');
    cp2.onclick = () => copyText(it.url);
    const del = el('button', 'btn btn-sm btn-danger', '删除');
    del.onclick = () => armOnce(del, '删除', async () => {
      await api('POST', '/api/urls/delete', { id: it.id });
      toast('记录已删除');
      renderUrls(c);
    });
    acts.appendChild(cp2);
    acts.appendChild(del);
    row.appendChild(acts);
    box.appendChild(row);
  }
  c.appendChild(box);
}

/* ---- 工具箱 ---- */
async function renderTools(c) {
  c.innerHTML = '';
  section(c, '随机生成器');
  const g = el('div', 'card');
  const out = el('div', 'kv-key', '—');
  const bar = el('div', 'file-toolbar');
  bar.style.marginTop = '12px';
  [['all', '全部生成'], ['key', '系统级密钥'], ['password', '强密码'], ['uuid', 'UUID']].forEach(([k, n]) => {
    const b = el('button', 'btn', n);
    b.onclick = async () => {
      const r = await api('GET', '/api/tools/random?kind=' + k);
      out.textContent = r.key || r.password || r.uuid || JSON.stringify(r);
    };
    bar.appendChild(b);
  });
  g.appendChild(out);
  g.appendChild(bar);
  c.appendChild(g);

  section(c, '哈希计算器');
  const h = el('div', 'card');
  const ti = inp('', '输入任意文本 ...');
  ti.style.width = '100%';
  const res = el('div', 'mono-list');
  res.style.marginTop = '12px';
  h.appendChild(ti);
  h.appendChild(res);
  ti.oninput = async () => {
    if (!ti.value) { res.innerHTML = ''; return; }
    const r = await api('POST', '/api/tools/hash', { text: ti.value });
    res.innerHTML = `<div><span class="k">SHA-256</span><span class="v hl">${esc(r.sha256)}</span></div>
      <div><span class="k">SHA-1</span><span class="v">${esc(r.sha1)}</span></div>
      <div><span class="k">MD5</span><span class="v">${esc(r.md5)}</span></div>`;
  };
  c.appendChild(h);
}

/* ---- 设置 ---- */
async function renderSettings(c) {
  c.innerHTML = '';
  let net, st;
  try { [net, st] = await Promise.all([api('GET', '/api/network'), api('GET', '/api/state')]); }
  catch (e) { c.appendChild(el('div', 'empty-tip', esc(e.message))); return; }

  section(c, '监听端口');
  const card = el('div', 'card');
  const row = el('div', 'color-row');
  row.appendChild(el('span', 'crumb', '端口'));
  const port = inp(String(net.port));
  row.appendChild(port);
  const save = el('button', 'btn', '保存并重启');
  save.onclick = async () => {
    const r = await api('POST', '/api/settings/port', { port: parseInt(port.value, 10) });
    if (r.needRestart) {
      toast('端口已保存, 系统即将重启 ...');
      setTimeout(async () => { try { await api('POST', '/api/system/restart'); } catch (e) { /* 忽略 */ } setTimeout(() => location.reload(), 3000); }, 1200);
    }
  };
  row.appendChild(save);
  card.appendChild(row);
  c.appendChild(card);

  section(c, '用户注册');
  const regCard = el('div', 'card');
  regCard.innerHTML = `<div class="card-title">新用户注册 · ${st.registrationOpen ? '开放' : '关闭'}</div>
    <div class="card-small">开启后, 访客可以在登录页自助注册。每个新账号自动获得独立加密文件目录与私有数据库, 与其他用户完全隔离。</div>`;
  const regBtn = el('button', 'btn ' + (st.registrationOpen ? 'btn-danger' : 'btn-accent'), st.registrationOpen ? '关闭新用户注册' : '开启新用户注册');
  regBtn.style.marginTop = '12px';
  regBtn.onclick = async () => {
    const r = await api('POST', '/api/settings/registration', { enabled: !st.registrationOpen });
    S.registrationOpen = r.registrationOpen;
    applyRegistrationState(S.registrationOpen);
    toast('注册已' + (r.registrationOpen ? '开启' : '关闭'));
    renderSettings(c);
  };
  regCard.appendChild(regBtn);
  c.appendChild(regCard);

  section(c, '系统控制');
  const ctl = el('div', 'card');
  const rb = el('button', 'btn btn-accent', '⟳ 重启系统');
  rb.onclick = async () => {
    toast('系统正在重启 ...');
    try { await api('POST', '/api/system/restart'); } catch (e) { /* 忽略 */ }
    setTimeout(() => location.reload(), 3000);
  };
  const lb = el('button', 'btn', '锁定数据库');
  lb.style.marginLeft = '9px';
  lb.onclick = () => confirmBox('锁定后数据库将重新加密, 需管理员再次登录解锁。继续?', async () => {
    await api('POST', '/api/system/lock');
    toast('数据库已锁定');
    doLogout();
  });
  ctl.appendChild(rb);
  ctl.appendChild(lb);
  c.appendChild(ctl);

  section(c, '数据与存储');
  const dataCard = el('div', 'card');
  dataCard.innerHTML = `<div class="mono-list" style="line-height:2.1">
    <div><span class="k">管理员数据库</span><span class="v">data/system.db · AES-256-GCM · 由管理员密码派生密钥</span></div>
    <div><span class="k">会员数据库</span><span class="v">data/users/&lt;hash&gt;.db · 每用户独立加密文件</span></div>
    <div><span class="k">文件仓库</span><span class="v">data/files/ · 会员位于 data/files/users/&lt;workspace&gt;/</span></div>
    <div><span class="k">备份</span><span class="v">复制整个 data 目录即可迁移, 需保留 install.salt</span></div>
  </div>`;
  c.appendChild(dataCard);
}

/* ---- 关于 ---- */
async function renderAbout(c) {
  c.innerHTML = '';
  let st;
  try { st = await api('GET', '/api/state'); } catch (e) { st = { version: '1.4.0' }; }
  const card = el('div', 'card');
  card.innerHTML = `<div style="text-align:center;padding:18px 8px">
    <div style="position:relative;width:130px;height:130px;margin:0 auto">
      <img src="/logo.png" style="width:130px;height:130px;border-radius:50%;box-shadow:0 0 60px rgba(var(--primary-rgb),.45),0 0 120px rgba(var(--accent-rgb),.15)">
    </div>
    <h2 style="margin-top:18px;letter-spacing:5px;color:var(--primary)">TENSAINT<span style="color:var(--text)">73</span>OS</h2>
    <div style="font-size:9px;color:var(--dim);letter-spacing:3px;margin-top:7px">圣钥协议 · SANCTUM KEY PROTOCOL</div>
    <div class="mono-list" style="text-align:left;margin-top:24px;line-height:2.2">
      <div><span class="k">系统版本</span><span class="v hl">v${esc(st.version || '1.4.0')}</span></div>
      <div><span class="k">数据库加密</span><span class="v">AES-256-GCM · 管理员库 / 会员库双轨</span></div>
      <div><span class="k">权限模型</span><span class="v">管理员全局 · 会员仅见自己的文件与数据表</span></div>
      <div><span class="k">文件隔离</span><span class="v">每个账号独立虚拟根目录, 接口层强制隔离</span></div>
      <div><span class="k">密钥机制</span><span class="v">核心文件变动 → 系统密钥随机轮换</span></div>
      <div><span class="k">网络</span><span class="v">默认仅监听 127.0.0.1 · 对外须经隧道</span></div>
    </div>
  </div>`;
  c.appendChild(card);
}

function renderCustom(c, meta) {
  section(c, meta.name);
  const card = el('div', 'card');
  card.innerHTML = `<div class="card-title">${esc(meta.desc || '自定义功能模块')}</div>
    <div class="card-small">此模块由 AI 助手或用户手动添加。你可以用 AI 进一步扩展它。</div>
    <div style="margin-top:14px"><button class="btn btn-accent" id="cus-ai">用 AI 扩展此模块</button></div>`;
  c.appendChild(card);
  const b = $('#cus-ai');
  if (b) b.onclick = () => navigate('ai');
}

/* ==========================================================================
   会员模块
   ========================================================================== */

async function renderMemberOverview(c) {
  c.innerHTML = '';
  c.appendChild(el('div', 'empty-tip', '正在读取私有空间 ...'));
  let my;
  try { my = await api('GET', '/api/my'); }
  catch (e) { c.innerHTML = ''; c.appendChild(el('div', 'empty-tip', esc(e.message))); return; }
  S.my = my;
  c.innerHTML = '';
  if (!S.palette) applyMemberTheme(paletteFor(S.username));

  const rows = my.tables.reduce((a, t) => a + t.count, 0);
  const initial = esc((S.username || '?').slice(0, 1).toUpperCase());
  const hero = el('div', 'member-hero');
  hero.innerHTML = `<div class="core-copy">
      <div class="core-kicker">PERSONAL NODE // ISOLATED SANDBOX</div>
      <div class="member-idline">
        <div class="avatar-holo">${initial}</div>
        <div style="min-width:0">
          <div class="member-name"><span>${esc(S.username)}</span> 的空间</div>
          <div class="member-sub">PRIVATE MEMBER · 独立加密节点</div>
          <div class="node-tag">${esc(my.nodeId || S.nodeId)}</div>
        </div>
      </div>
      <div class="isolation-note">这里保存的<b>文件</b>与<b>数据表</b>只属于你。其他会员无法读取, 管理员控制台也不会混入你的私有数据。所有内容在磁盘上均以 <b>AES-256-GCM</b> 加密。</div>
      <div class="core-chips" style="margin-top:14px"><span>◈ PRIVATE VAULT</span><span>◈ PER-USER KEY</span><span>◈ ZERO CROSS-TALK</span></div>
    </div>
    <div class="member-seal">
      <span class="ms-ring"></span><span class="ms-ring r2"></span>
      <div class="ms-core"><b>${rows}</b><span>DATA ROWS</span></div>
    </div>`;
  c.appendChild(hero);

  const sg = el('div', 'stat-grid');
  sg.appendChild(statCard('我的数据表', my.tables.length + ' 张', '⛁', '私有数据库', clamp(my.tables.length * 10, 6, 100)));
  sg.appendChild(statCard('我的数据行', rows + ' 行', '≣', '仅本节点可见', clamp(rows * 2, 6, 100)));
  sg.appendChild(statCard('我的文件', my.files.files + ' 个', '▤', fmtSize(my.files.size) + ' · 加密落盘', clamp(my.files.files * 4, 6, 100)));
  sg.appendChild(statCard('空间创建', fmtTime(my.createdAt).split(' ')[0] || '--', '⬡', '节点 ' + esc(my.nodeId || S.nodeId), 100));
  c.appendChild(sg);

  section(c, '快捷操作');
  const quick = el('div', 'quick-grid');
  const q1 = el('div', 'quick-btn', '<i>⬆</i><b>上传加密文件</b><span>写入你的私有文件仓库</span>');
  q1.onclick = () => memberNavigate('files');
  const q2 = el('div', 'quick-btn', '<i>＋</i><b>新建数据表</b><span>建立只有你能看到的数据结构</span>');
  q2.onclick = () => memberNavigate('database');
  const q3 = el('div', 'quick-btn', '<i>⬡</i><b>账户安全</b><span>修改密钥 / 注销当前会话</span>');
  q3.onclick = () => memberNavigate('account');
  quick.appendChild(q1);
  quick.appendChild(q2);
  quick.appendChild(q3);
  c.appendChild(quick);

  section(c, '最近活动');
  const actCard = el('div', 'card');
  actCard.innerHTML = '<div class="card-title">私有空间活动流</div>';
  if (!my.activity.length) {
    actCard.appendChild(el('div', 'empty-tip', '还没有活动记录 — 上传一个文件或建一张表试试'));
  } else {
    my.activity.slice(0, 12).forEach(a => {
      const icon = a.kind === 'db' ? '⛁' : a.kind === 'fs' ? '▤' : '⬡';
      const item = el('div', 'activity-item');
      item.innerHTML = `<span class="activity-kind">${icon}</span><span class="activity-text">${esc(a.msg)}</span><span class="activity-time">${esc(fmtTime(a.t))}</span>`;
      actCard.appendChild(item);
    });
  }
  c.appendChild(actCard);

  section(c, '隔离状态');
  const iso = el('div', 'card');
  iso.innerHTML = `<div class="mono-list" style="line-height:2.1">
    <div><span class="k">工作区</span><span class="v hl">data/files/users/${esc(my.workspace)}</span></div>
    <div><span class="k">私有数据库</span><span class="v">AES-256-GCM · 每用户独立文件</span></div>
    <div><span class="k">跨用户访问</span><span class="v">接口层强制隔离 · 不可越界</span></div>
    <div><span class="k">服务器版本</span><span class="v">v${esc(my.server.version)} · Node ${esc(my.server.node)}</span></div>
  </div>`;
  c.appendChild(iso);

  S.tick = { tables: my.tables.length, rows, files: my.files.files, size: fmtSize(my.files.size) };
  updateTicker();
}

function renderMemberFiles(c) {
  return renderFileBrowser(c, { rootLabel: '我的空间', scope: 'PRIVATE VAULT', admin: false, onChange: refreshMemberMy });
}

function renderMemberDatabase(c) {
  return renderDbPanel(c, { scope: 'PRIVATE ENCRYPTED DB', onChange: refreshMemberMy });
}

/* ---- 会员 · 共享空间 (管理员显式授权的全局表与目录) ---- */
async function renderMemberShared(c) {
  c.innerHTML = '';
  const bar = el('div', 'file-toolbar');
  const rf = el('button', 'btn btn-accent', '⟳ 刷新');
  bar.appendChild(rf);
  bar.appendChild(el('span', 'crumb', 'SHARED ACCESS · 由管理员显式授权, 收回即时生效'));
  c.appendChild(bar);
  const mount = el('div');
  c.appendChild(mount);

  async function refresh() {
    mount.innerHTML = '';
    let d;
    try { d = await api('GET', '/api/shared'); }
    catch (e) { mount.appendChild(el('div', 'empty-tip', esc(e.message))); return; }
    if (!d.unlocked) {
      const card = el('div', 'card');
      card.innerHTML = '<div class="card-title">共享数据暂不可用</div><div class="empty-tip">最高权限账号尚未登录解锁全局库与文件密钥。这不是「没有授权给你」——解锁后点刷新即可。</div>';
      mount.appendChild(card);
      return;
    }
    if (!d.tables.length && !d.dirs.length) {
      const card = el('div', 'card');
      card.innerHTML = '<div class="card-title">还没有共享内容给你</div><div class="empty-tip">管理员在「用户管理 → 授权」里勾选数据表或目录后, 这里会立即出现; 你的私有文件与私有数据库不受影响。</div>';
      mount.appendChild(card);
      return;
    }

    const levels = {};
    if (d.tables.length) {
      d.tables.forEach(t => { levels[t.name] = t.level; });
      const card = el('div', 'card');
      card.appendChild(el('div', 'card-title', '共享数据表 (' + d.tables.length + ')'));
      const tbl = el('table', 'tbl');
      tbl.innerHTML = '<tr><th>表名</th><th>列</th><th>行数</th><th>权限</th><th>操作</th></tr>';
      for (const t of d.tables) {
        const tr = el('tr');
        tr.innerHTML = `<td>${esc(t.name)}</td><td>${esc(t.columns.join(' / '))}</td><td>${t.count}</td><td>${t.level === 'rw' ? '<span class="tag on">读写</span>' : '<span class="tag">只读</span>'}</td>`;
        const td = el('td', 'row-actions');
        const open = el('button', 'btn btn-sm btn-accent', '打开');
        open.onclick = () => openTables();
        td.appendChild(open);
        tr.appendChild(td);
        tbl.appendChild(tr);
      }
      card.appendChild(tbl);
      mount.appendChild(card);
    }

    const fileGrants = {};
    if (d.dirs.length) {
      const card = el('div', 'card');
      card.appendChild(el('div', 'card-title', '共享目录 (' + d.dirs.length + ')'));
      const tbl = el('table', 'tbl');
      tbl.innerHTML = '<tr><th>目录</th><th>权限</th><th>说明</th><th>操作</th></tr>';
      for (const x of d.dirs) {
        fileGrants[x.path] = x.level;
        const tr = el('tr');
        tr.innerHTML = `<td>${esc(x.path || '(仓库根)')}</td><td>${x.level === 'rw' ? '<span class="tag on">读写</span>' : '<span class="tag">只读</span>'}</td><td>${x.path ? '子树递归生效' : '仓库根, 会员私有目录除外'}</td>`;
        const td = el('td', 'row-actions');
        const open = el('button', 'btn btn-sm btn-accent', '打开');
        open.onclick = () => openDir(x.path, x.level);
        td.appendChild(open);
        tr.appendChild(td);
        tbl.appendChild(tr);
      }
      card.appendChild(tbl);
      mount.appendChild(card);
    }

    const view = el('div');
    mount.appendChild(view);

    // 授权是可叠加的: 任一祖先目录给 rw, 整棵子树都可写; 所以逐层加起来判断, 而不是只看最近的一层
    function chain(p) {
      const parts = String(p || '').split('/').filter(Boolean);
      const out = [''];
      for (let i = 0; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'));
      return out;
    }
    function writableAt(p) { return chain(p).some(k => fileGrants[k] === 'rw'); }

    function openTables() {
      view.innerHTML = '';
      const t = el('div', 'card-title', '共享数据 · 按管理员授予的权限增删改查, 建表与列结构归管理员');
      view.appendChild(t);
      const box = el('div');
      view.appendChild(box);
      renderDbPanel(box, {
        apiBase: '/api/shared/db',
        canCreate: false,
        canStructure: false,
        scope: 'SHARED DB',
        canWriteTable: n => levels[n] === 'rw',
      }).catch(e => { box.innerHTML = ''; box.appendChild(el('div', 'empty-tip', esc(e.message))); });
      view.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function openDir(path, level) {
      view.innerHTML = '';
      renderFileBrowser(view, {
        fsBase: '/api/shared/fs',
        startPath: path,
        rootLabel: path || '共享根目录',
        scope: level === 'rw' ? 'SHARED VAULT · 读写' : 'SHARED VAULT · 只读',
        writableAt,
      });
    }
  }
  rf.onclick = refresh;
  await refresh();
}

function maskPhone(p) {
  const s = String(p || '');
  if (s.length <= 7) return s.slice(0, 2) + '****' + s.slice(-2);
  return s.slice(0, 3) + '****' + s.slice(-4);
}

async function phoneSecurityCard(onChanged) {
  const card = el('div', 'card');
  let st = { bound: false };
  try { st = await api('GET', '/api/me/phone'); }
  catch (e) { card.appendChild(el('div', 'empty-tip', esc(e.message))); return card; }
  const head = el('div', 'card-title');
  head.innerHTML = `安全手机号 <span class="sec-chip ${st.bound ? 'on' : ''}">${st.bound ? '已绑定 · 登录二次校验' : '未绑定'}</span>`;
  card.appendChild(head);
  card.appendChild(el('div', 'card-small', st.bound
    ? '登录时必须同时提交密码与这台手机号。号码以 AES-256-GCM 单独加密保存，只有你本人能看到完整号码；管理员只能看到"已绑定"状态。'
    : '绑定后，即使密码泄露，缺少完整手机号也无法登录。号码以 AES-256-GCM 单独加密保存，只有你本人能看到完整号码。'));

  if (st.bound) {
    const band = el('div', 'phone-band');
    const main = el('div', 'phone-main');
    const digits = el('div', 'phone-digits masked');
    let shown = false;
    const paint = () => {
      digits.textContent = shown ? st.phone : maskPhone(st.phone);
      digits.classList.toggle('masked', !shown);
    };
    paint();
    main.appendChild(digits);
    main.appendChild(el('div', 'phone-meta', 'BOUND ' + esc(fmtTime(st.boundAt)) + ' · 二次校验已启用'));
    band.appendChild(main);
    const acts = el('div', 'phone-actions');
    const eye = el('button', 'btn btn-sm', '显示完整');
    eye.onclick = () => { shown = !shown; eye.textContent = shown ? '隐藏号码' : '显示完整'; paint(); };
    const copy = el('button', 'btn btn-sm', '复制号码');
    copy.onclick = () => copyText(st.phone);
    acts.appendChild(eye);
    acts.appendChild(copy);
    band.appendChild(acts);
    card.appendChild(band);

    const upd = el('div');
    upd.appendChild(el('div', 'section-title', '更新绑定'));
    const grid = el('div', 'phone-form-grid');
    const pw = inp('', '当前密码'); pw.type = 'password';
    const cur = inp('', '当前绑定手机号'); cur.type = 'tel'; cur.inputMode = 'tel';
    const np = inp('', '新手机号'); np.type = 'tel'; np.inputMode = 'tel';
    const np2 = inp('', '再次输入新手机号'); np2.type = 'tel'; np2.inputMode = 'tel';
    grid.appendChild(formRow('当前密码', pw));
    grid.appendChild(formRow('当前手机号', cur));
    grid.appendChild(formRow('新手机号', np));
    grid.appendChild(formRow('确认新手机号', np2));
    upd.appendChild(grid);
    const updBtn = el('button', 'btn btn-accent', '更新安全手机号');
    updBtn.onclick = async () => {
      if (!np.value.trim()) return toast('请输入新手机号', true);
      if (np.value.trim() !== np2.value.trim()) return toast('两次输入的新手机号不一致', true);
      try {
        await api('POST', '/api/me/phone', { password: pw.value, currentPhone: cur.value.trim(), phone: np.value.trim() });
        toast('安全手机号已更新 · 其他终端会话已作废');
        if (onChanged) onChanged();
      } catch (e) { toast(e.message, true); }
    };
    upd.appendChild(updBtn);
    card.appendChild(upd);

    const zone = el('div', 'phone-unbind-zone');
    zone.appendChild(el('span', '', '解除绑定后将失去登录二次校验，账号只由密码保护。'));
    const un = el('button', 'btn btn-sm btn-danger', '解除绑定');
    un.onclick = () => {
      const b = el('div');
      const p1 = inp('', '当前密码'); p1.type = 'password';
      const p2 = inp('', '完整绑定手机号'); p2.type = 'tel'; p2.inputMode = 'tel';
      b.appendChild(formRow('当前密码', p1));
      b.appendChild(formRow('绑定手机号', p2));
      b.appendChild(el('div', 'card-small', '需要同时验证密码与已绑定号码，防止会话被盗后直接解除保护。'));
      openModal('解除安全手机号', b, async () => {
        await api('POST', '/api/me/phone/unbind', { password: p1.value, phone: p2.value.trim() });
        toast('安全手机号已解除绑定');
        if (onChanged) onChanged();
      }, '解除绑定');
    };
    zone.appendChild(un);
    card.appendChild(zone);
  } else {
    const form = el('div', 'phone-form-grid');
    const pw = inp('', '当前密码'); pw.type = 'password';
    const phone = inp('', '手机号 (可带 + 国际区号)'); phone.type = 'tel'; phone.inputMode = 'tel';
    const phone2 = inp('', '再次输入手机号'); phone2.type = 'tel'; phone2.inputMode = 'tel';
    form.appendChild(formRow('当前密码', pw));
    form.appendChild(formRow('手机号', phone));
    form.appendChild(formRow('确认手机号', phone2));
    card.appendChild(form);
    const btn = el('button', 'btn btn-accent', '绑定安全手机号');
    btn.onclick = async () => {
      if (!phone.value.trim()) return toast('请输入手机号', true);
      if (phone.value.trim() !== phone2.value.trim()) return toast('两次输入的手机号不一致', true);
      try {
        await api('POST', '/api/me/phone', { password: pw.value, phone: phone.value.trim() });
        toast('安全手机号已绑定 · 下次登录需同时验证号码');
        if (onChanged) onChanged();
      } catch (e) { toast(e.message, true); }
    };
    card.appendChild(btn);
  }
  return card;
}

async function renderMemberAccount(c) {
  c.innerHTML = '';
  let my = S.my;
  try { my = await api('GET', '/api/my'); S.my = my; } catch (e) { /* 使用缓存 */ }
  if (!my) { c.appendChild(el('div', 'empty-tip', '无法读取账户信息')); return; }

  const grid = el('div', 'account-grid');
  const idCard = el('div', 'card identity-card');
  idCard.innerHTML = `<div class="avatar-holo">${esc(S.username.slice(0, 1).toUpperCase())}</div>
    <div class="member-name"><span>${esc(S.username)}</span></div>
    <div class="node-tag">${esc(my.nodeId || S.nodeId)}</div>
    <div style="margin-top:18px">
      <div class="identity-row"><span>角色</span><b>隐私会员</b></div>
      <div class="identity-row"><span>创建时间</span><b>${esc(fmtTime(my.createdAt))}</b></div>
      <div class="identity-row"><span>安全手机</span><b>${my.phoneBound ? '已绑定 · 登录二次校验' : '未绑定'}</b></div>
      <div class="identity-row"><span>工作区</span><b>${esc(my.workspace)}</b></div>
      <div class="identity-row"><span>数据表 / 行</span><b>${my.totals.tables} / ${my.totals.rows}</b></div>
      <div class="identity-row"><span>文件 / 占用</span><b>${my.files.files} 个 / ${fmtSize(my.files.size)}</b></div>
    </div>`;
  grid.appendChild(idCard);

  const pwCard = el('div', 'card');
  pwCard.innerHTML = '<div class="card-title">修改访问密钥</div>';
  const form = el('div', 'form-stack');
  const oldP = inp('', '当前密码');
  oldP.type = 'password';
  const newP = inp('', '新密码 (至少 8 位)');
  newP.type = 'password';
  const newP2 = inp('', '再次输入新密码');
  newP2.type = 'password';
  form.appendChild(formRow('当前密码', oldP));
  form.appendChild(formRow('新密码', newP));
  form.appendChild(formRow('确认新密码', newP2));
  const save = el('button', 'btn btn-accent', '更新密钥');
  save.style.marginTop = '6px';
  save.onclick = async () => {
    if (newP.value.length < 8) return toast('新密码至少 8 位', true);
    if (newP.value !== newP2.value) return toast('两次输入的新密码不一致', true);
    try {
      await api('POST', '/api/me/password', { oldPassword: oldP.value, newPassword: newP.value });
      toast('密钥已更新 · 正在注销, 请用新密码重新登录');
      setTimeout(() => doLogout(true), 1400);
    } catch (e) { toast(e.message, true); }
  };
  form.appendChild(save);
  pwCard.appendChild(form);
  pwCard.appendChild(el('div', 'card-small', '修改后本账号所有在线会话立即失效, 需要重新登录。'));
  grid.appendChild(pwCard);
  c.appendChild(grid);

  section(c, '安全手机号');
  c.appendChild(await phoneSecurityCard(() => renderMemberAccount(c)));

  section(c, '会话控制');
  const outCard = el('div', 'card');
  outCard.innerHTML = '<div class="card-title">断开当前节点</div><div class="card-small">注销会销毁当前访问令牌。你的私有文件与数据不会丢失, 下次登录仍可访问。</div>';
  const outBtn = el('button', 'btn btn-danger', '注销当前会话');
  outBtn.style.marginTop = '12px';
  outBtn.onclick = () => confirmBox('确定注销当前会话?', async () => { doLogout(); }, '注销');
  outCard.appendChild(outBtn);
  c.appendChild(outCard);

  section(c, '永久注销账号');
  const delCard = el('div', 'card');
  delCard.innerHTML = '<div class="card-title">销毁会员节点</div><div class="card-small">永久删除账号、私有数据库与全部私有文件，无法恢复；其他用户的数据不受影响。</div>';
  const delForm = el('div', 'form-stack');
  const delPw = inp('', '当前密码'); delPw.type = 'password';
  delForm.appendChild(formRow('当前密码', delPw));
  let delPhone = null;
  if (my.phoneBound) {
    delPhone = inp('', '已绑定的安全手机号'); delPhone.type = 'tel';
    delForm.appendChild(formRow('安全手机号', delPhone));
  }
  const delBtn = el('button', 'btn btn-danger', '永久注销我的账号');
  delBtn.style.marginTop = '6px';
  delBtn.onclick = () => {
    if (!delPw.value) return toast('请输入当前密码', true);
    if (my.phoneBound && !delPhone.value.trim()) return toast('请输入已绑定的安全手机号', true);
    confirmBox('确定永久注销账号? 私有数据库与文件将全部销毁, 无法恢复。', async () => {
      try {
        await api('POST', '/api/me/delete', { password: delPw.value, phone: delPhone ? delPhone.value.trim() : '' });
        S.token = ''; S.role = null; S.username = ''; S.nodeId = ''; S.my = null;
        localStorage.removeItem('ts73_token');
        toast('账号与私有空间已永久销毁');
        setTimeout(() => showLoginScreen(), 900);
      } catch (e) { toast(e.message, true); }
    }, '永久注销');
  };
  delForm.appendChild(delBtn);
  delCard.appendChild(delForm);
  c.appendChild(delCard);
}

async function renderAdminAccount(c) {
  c.innerHTML = '';
  let st = {};
  try { st = await api('GET', '/api/state'); } catch (e) { /* 使用已知状态 */ }
  const grid = el('div', 'account-grid');
  const idCard = el('div', 'card identity-card');
  idCard.innerHTML = `<div class="avatar-holo">${esc((S.username || 'A').slice(0, 1).toUpperCase())}</div>
    <div class="member-name"><span>${esc(S.username)}</span></div>
    <div class="node-tag">${esc(S.nodeId || 'TS73-······')}</div>
    <div style="margin-top:18px">
      <div class="identity-row"><span>角色</span><b>ROOT ADMINISTRATOR</b></div>
      <div class="identity-row"><span>系统版本</span><b>v${esc(st.version || '1.4.0')}</b></div>
      <div class="identity-row"><span>全局数据库</span><b>${st.locked ? '加密锁定' : '已解锁 · AES-256-GCM'}</b></div>
      <div class="identity-row"><span>会话策略</span><b>12h 滑动过期</b></div>
    </div>`;
  grid.appendChild(idCard);

  const pwCard = el('div', 'card');
  pwCard.innerHTML = '<div class="card-title">修改管理员密钥</div>';
  const form = el('div', 'form-stack');
  const oldP = inp('', '当前密码'); oldP.type = 'password';
  const newP = inp('', '新密码 (至少 8 位)'); newP.type = 'password';
  const newP2 = inp('', '再次输入新密码'); newP2.type = 'password';
  form.appendChild(formRow('当前密码', oldP));
  form.appendChild(formRow('新密码', newP));
  form.appendChild(formRow('确认新密码', newP2));
  const save = el('button', 'btn btn-accent', '更新管理员密钥');
  save.style.marginTop = '6px';
  save.onclick = async () => {
    if (newP.value.length < 8) return toast('新密码至少 8 位', true);
    if (newP.value !== newP2.value) return toast('两次输入的新密码不一致', true);
    try {
      await api('POST', '/api/me/password', { oldPassword: oldP.value, newPassword: newP.value });
      toast('管理员密钥已更新 · 全局数据库已重新加密, 请重新登录');
      setTimeout(() => doLogout(true), 1600);
    } catch (e) { toast(e.message, true); }
  };
  form.appendChild(save);
  pwCard.appendChild(form);
  pwCard.appendChild(el('div', 'card-small', '管理员密码同时是全局加密数据库的密钥。修改后数据库会立即用新密码重新加密，所有在线会话失效。'));
  grid.appendChild(pwCard);
  c.appendChild(grid);

  section(c, '安全手机号');
  c.appendChild(await phoneSecurityCard(() => renderAdminAccount(c)));

  section(c, '会话控制');
  const outCard = el('div', 'card');
  outCard.innerHTML = '<div class="card-title">断开管理节点</div><div class="card-small">注销会销毁当前访问令牌；会员的私有文件与数据不受影响。</div>';
  const outBtn = el('button', 'btn btn-danger', '注销当前会话');
  outBtn.style.marginTop = '12px';
  outBtn.onclick = () => confirmBox('确定注销当前管理会话?', async () => { doLogout(); }, '注销');
  outCard.appendChild(outBtn);
  c.appendChild(outCard);
}

/* ==========================================================================
   静态事件绑定 / 启动
   ========================================================================== */
function bindStatic() {
  const lf = $('#login-form');
  const rf = $('#register-form');
  if (lf) lf.addEventListener('submit', doLogin);
  if (rf) rf.addEventListener('submit', doRegister);

  $$('.auth-tab').forEach(t => t.addEventListener('click', () => setAuthMode(t.dataset.mode)));

  $$('.eye').forEach(b => {
    b.addEventListener('click', () => {
      const target = document.getElementById(b.dataset.target);
      if (!target) return;
      const show = target.type === 'password';
      target.type = show ? 'text' : 'password';
      b.classList.toggle('on', show);
    });
  });

  const rp = $('#reg-pass');
  if (rp) rp.addEventListener('input', () => {
    const v = rp.value;
    let score = 0;
    if (v.length >= 8) score++;
    if (/[A-Za-z]/.test(v) && /[0-9]/.test(v)) score++;
    if (/[^A-Za-z0-9]/.test(v)) score++;
    if (v.length >= 14) score++;
    const bar = $('#reg-strength');
    const txt = $('#reg-strength-text');
    if (!bar || !txt) return;
    const pct = [0, 26, 52, 76, 100][score];
    bar.style.width = pct + '%';
    bar.style.background = score <= 1 ? 'var(--danger)' : score === 2 ? 'var(--primary)' : 'var(--ok)';
    txt.textContent = v ? ['过短', '弱', '中', '强', '极强'][score] : '强度检测';
  });

  const lock = $('#btn-lock');
  if (lock) lock.onclick = () => confirmBox('确定注销当前管理员会话? 数据库仍保持解锁, 直到手动锁定或重启。', async () => { doLogout(); }, '注销');
  const mlogout = $('#m-logout');
  if (mlogout) mlogout.onclick = () => confirmBox('确定注销当前会话?', async () => { doLogout(); }, '注销');

  const modal = $('#modal-root');
  if (modal) modal.addEventListener('click', e => { if (e.target.id === 'modal-root') closeModal(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

async function checkSession() {
  if (!S.token) return null;
  const { status, data } = await rawApi('GET', '/api/state');
  if (status === 200 && data.role) return data;
  if (status === 401) {
    S.token = '';
    localStorage.removeItem('ts73_token');
  }
  return null;
}

(async function init() {
  bindStatic();
  applyTheme(DEFAULT_THEME);
  startBg();
  const bootPromise = runBoot();
  let st = null;
  try { st = await checkSession(); } catch (e) { st = null; }
  if (st) applyRegistrationState(st.registrationOpen);
  else {
    try {
      const { status, data } = await rawApi('GET', '/api/state');
      if (status === 200) applyRegistrationState(data.registrationOpen);
    } catch (e) { /* 忽略 */ }
  }
  await bootPromise;
  startTicker();
  if (st && st.role === 'admin') {
    await enterAdmin(st);
  } else if (st && st.role === 'user') {
    await enterMember({ username: st.username, nodeId: st.nodeId });
  } else {
    showLoginScreen();
  }
})().catch(e => {
  console.error(e);
  showLoginScreen();
  toast('界面初始化异常: ' + e.message, true);
});
