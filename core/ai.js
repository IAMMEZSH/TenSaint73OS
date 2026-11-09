'use strict';
// TenSaint73OS 内置 AI 控制核心
// 解析自然语言指令 -> 直接操作系统: 数据库增删改查 / 界面主题 / 功能模块 / 用户 / 系统
function parseFields(str) {
  // "a=1, b=2" or "a:1 b:2"
  const out = {};
  String(str || '').split(/[,,]/).forEach(part => {
    const m = part.match(/^\s*([^=:\s]+)\s*[=:]\s*(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  });
  return out;
}

function handle(message, ctx) {
  const { store, sys } = ctx;      // sys = {key, version, uptime...}
  const msg = String(message || '').trim();
  if (!msg) return { reply: '指令为空。输入 "帮助" 查看我能做的一切。', actions: [] };
  const actions = [];
  const t = msg.toLowerCase();

  const done = (reply) => ({ reply, actions });

  // ---------- 帮助 ----------
  if (/^(帮助|help|你会什么|你能做什么|说明)$/.test(t)) {
    return done(
`【TenSaint73OS · AI 控制核心】可用指令:

■ 数据库
  创建表 表名 列名1,列名2,...
  删除表 表名
  表结构 表名  /  所有表
  添加数据 表名 字段=值, 字段=值
  删除数据 表名 字段=值
  修改数据 表名 字段=值 -> 字段=新值
  查询 表名  (可加: 条件 字段=值 / 前N条)
  清空表 表名

■ 界面控制
  主题颜色 #d4af37      (改主色调)
  强调色 #00e5ff
  背景 网格|粒子|矩阵|无
  界面风格 金|赛博|霓虹|毒液|暗红
  自定义CSS css代码
  恢复默认主题

■ 功能模块
  所有功能  /  添加功能 名称 描述
  删除功能 名称  /  启用功能 名称  /  禁用功能 名称

■ 用户
  所有用户 / 添加用户 用户名 密码 / 删除用户 用户名
  (新建账号一律是会员; 最高管理员全机唯一, 只能由 .tsowner 导入建立)

■ 系统
  系统信息 / 查看密钥 / 轮换密钥 / 打开 模块名`
    );
  }

  // ---------- 系统 ----------
  if (/^系统信息$/.test(t)) {
    return done(`系统: ${sys.name} v${sys.version}
运行时间: ${sys.uptime}
Node: ${sys.node}
密钥状态: ${sys.keyStatus}
功能模块: ${store.doc.features.length} 个 (启用 ${store.doc.features.filter(f => f.enabled).length})
数据表: ${Object.keys(store.doc.tables).length} 张`);
  }
  if (/^查看密钥$/.test(t)) return done(`当前系统密钥:\n${sys.key}\n该密钥在系统文件被移动/复制/修改后自动随机更换。`);
  if (/^轮换密钥$/.test(t)) { const k = sys.rotateKey(); return done(`已随机轮换系统密钥, 新密钥:\n${k}`); }

  // ---------- 数据库 ----------
  let m = t.match(/^创建表\s+(\S+)\s*(.*)$/);
  if (m) {
    const cols = m[2].split(/[,,]/).map(s => s.trim()).filter(Boolean);
    store.createTable(m[1], cols);
    return done(`已创建数据表 [${m[1]}], 共 ${cols.length} 列。`);
  }
  m = t.match(/^删除表\s+(\S+)$/);
  if (m) { store.dropTable(m[1]); return done(`已删除数据表 [${m[1]}]。`); }
  m = t.match(/^(所有表|列出所有表|显示所有表)$/);
  if (m) {
    const names = store.listTables();
    return done(names.length ? `共 ${names.length} 张表:\n` + names.map(n => '· ' + n).join('\n') : '数据库中还没有任何表。');
  }
  m = t.match(/^表结构\s+(\S+)$/);
  if (m) {
    const tb = store.getTable(m[1]);
    if (!tb) return done(`表 [${m[1]}] 不存在。`);
    return done(`表 [${tb.name}] — ${tb.count} 行\n列: ${tb.columns.join(' | ')}`);
  }
  m = msg.match(/^添加数据\s+(\S+)\s+(.+)$/);
  if (m) {
    const row = store.insert(m[1], parseFields(m[2]));
    return done(`已向 [${m[1]}] 添加 1 行数据 (id: ${row.id})。`);
  }
  m = msg.match(/^删除数据\s+(\S+)\s+(.+)$/);
  if (m) {
    const cond = parseFields(m[2]);
    const tb = store.doc.tables[m[1]];
    if (!tb) return done(`表 [${m[1]}] 不存在。`);
    const k = Object.keys(cond)[0];
    const before = tb.rows.length;
    tb.rows = tb.rows.filter(r => String(r[k]) !== cond[k]);
    const n = before - tb.rows.length;
    store.save(); store.log('warn', `AI 删除 [${m[1]}] ${n} 行`);
    return done(`已从 [${m[1]}] 删除 ${n} 行匹配数据。`);
  }
  m = msg.match(/^修改数据\s+(\S+)\s+(.+?)\s*->\s*(.+)$/);
  if (m) {
    const cond = parseFields(m[2]), set = parseFields(m[3]);
    const tb = store.doc.tables[m[1]];
    if (!tb) return done(`表 [${m[1]}] 不存在。`);
    const k = Object.keys(cond)[0];
    let n = 0;
    for (const r of tb.rows) {
      if (String(r[k]) === cond[k]) { Object.assign(r, set); n++; }
    }
    store.save(); store.log('info', `AI 更新 [${m[1]}] ${n} 行`);
    return done(`已更新 [${m[1]}] 中 ${n} 行数据。`);
  }
  m = msg.match(/^查询\s+(\S+)([\s\S]*)$/);
  if (m) {
    const tb = store.getTable(m[1]);
    if (!tb) return done(`表 [${m[1]}] 不存在。输入 "所有表" 查看。`);
    let rows = tb.rows;
    const rest = m[2];
    const cm = rest.match(/条件\s+([^=\s]+)\s*[=:]\s*(\S+)/);
    if (cm) rows = rows.filter(r => String(r[cm[1]]) === cm[2]);
    const lm = rest.match(/前\s*(\d+)\s*条/);
    if (lm) rows = rows.slice(0, parseInt(lm[1], 10));
    const head = tb.columns.join(' | ');
    const lines = rows.slice(0, 20).map(r => tb.columns.map(c => r[c] ?? '').join(' | '));
    const more = rows.length > 20 ? `\n... 以及另外 ${rows.length - 20} 行` : '';
    return done(`[${tb.name}] 命中 ${rows.length} 行:\n${head}\n${lines.join('\n')}${more}`);
  }
  m = t.match(/^清空表\s+(\S+)$/);
  if (m) { store.clear(m[1]); return done(`已清空表 [${m[1]}]。`); }

  // ---------- 界面控制 ----------
  m = t.match(/^主题颜色\s+(#\w{3,8})$/);
  if (m) { store.doc.settings.theme.primary = m[1]; store.save(); actions.push({ type: 'theme' }); return done(`主色调已改为 ${m[1]}, 界面即时生效。`); }
  m = t.match(/^强调色\s+(#\w{3,8})$/);
  if (m) { store.doc.settings.theme.accent = m[1]; store.save(); actions.push({ type: 'theme' }); return done(`强调色已改为 ${m[1]}。`); }
  m = t.match(/^背景\s+(网格|粒子|矩阵|无)$/);
  if (m) {
    const map = { 网格: 'grid', 粒子: 'particles', 矩阵: 'matrix', 无: 'none' };
    store.doc.settings.theme.bg = map[m[1]]; store.save(); actions.push({ type: 'theme' });
    return done(`背景动画已切换为: ${m[1]}。`);
  }
  m = t.match(/^界面风格\s+(金|赛博|霓虹|毒液|暗红)$/);
  if (m) {
    const presets = {
      金:     { primary: '#d4af37', accent: '#00e5ff' },
      赛博:   { primary: '#00e5ff', accent: '#ff2d95' },
      霓虹:   { primary: '#b967ff', accent: '#01cdfe' },
      毒液:   { primary: '#39ff14', accent: '#00ff9f' },
      暗红:   { primary: '#ff3131', accent: '#ffd24d' },
    };
    Object.assign(store.doc.settings.theme, presets[m[1]]);
    store.doc.settings.theme.uiStyle = ({ 金: 'gold', 赛博: 'cyber', 霓虹: 'neon', 毒液: 'toxic', 暗红: 'crimson' })[m[1]];
    store.save(); actions.push({ type: 'theme' });
    return done(`界面风格已切换为 [${m[1]}] 套装。`);
  }
  m = msg.match(/^自定义CSS\s+([\s\S]+)$/);
  if (m) { store.doc.settings.theme.customCss = m[1]; store.save(); actions.push({ type: 'theme' }); return done('自定义 CSS 已注入界面。'); }
  if (/^恢复默认主题$/.test(t)) {
    const { DEFAULT_THEME } = require('./store');
    store.doc.settings.theme = { ...DEFAULT_THEME }; store.save(); actions.push({ type: 'theme' });
    return done('主题已恢复默认黑金风格。');
  }

  // ---------- 功能模块 ----------
  if (/^所有功能$/.test(t)) {
    const fs2 = store.doc.features;
    return done(`共 ${fs2.length} 个功能模块:\n` + fs2.map(f => `${f.enabled ? '●' : '○'} ${f.name}${f.builtin ? '' : ' (自定义)'}`).join('\n'));
  }
  m = msg.match(/^添加功能\s+(\S+)(?:\s+([\s\S]+))?$/);
  if (m) {
    const fid = store.addFeature(m[1], m[2] || '');
    actions.push({ type: 'features' });
    return done(`已新增功能模块 [${m[1]}] (id: ${fid})。刷新侧边栏可见。`);
  }
  m = msg.match(/^(删除|启用|禁用)功能\s+(.+)$/);
  if (m) {
    const target = store.doc.features.find(f => f.name === m[2].trim() || f.id === m[2].trim());
    if (!target) return done(`未找到功能 [${m[2]}]。输入 "所有功能" 查看。`);
    if (m[1] === '删除') { store.removeFeature(target.id); }
    else { store.setFeatureEnabled(target.id, m[1] === '启用'); }
    actions.push({ type: 'features' });
    return done(`功能 [${target.name}] 已${m[1]}。`);
  }

  // ---------- 用户 ----------
  if (/^所有用户$/.test(t)) {
    const us = sys.auth.listUsers();
    return done(`共 ${us.length} 个用户:\n` + us.map(u => `· ${u.username} [${u.role === 'admin' ? '最高权限' : '受限用户'}]`).join('\n'));
  }
  m = msg.match(/^添加用户\s+(\S+)\s+(\S+)(?:\s+(\S+))?$/);
  if (m) {
    const role = m[3] || 'user';
    if (role === 'admin') return done('最高管理员全机唯一, 不能通过 AI 新建。新账号只能是会员; 最高管理员身份只能由 .tsowner 导入建立。');
    if (role !== 'user') return done('角色只能是 user; 新账号一律是会员。');
    try { sys.auth.addUser(m[1], m[2]); }
    catch (e) { return done(`添加用户失败: ${e.message}`); }
    return done(`已添加会员 ${m[1]}。`);
  }
  m = t.match(/^删除用户\s+(\S+)$/);
  if (m) { sys.auth.removeUser(m[1]); return done(`已删除用户 ${m[1]}。`); }

  // ---------- 导航 ----------
  m = msg.match(/^打开\s+(.+)$/);
  if (m) {
    const target = store.doc.features.find(f => f.name === m[1].trim());
    if (target) { actions.push({ type: 'navigate', target: target.id }); return done(`正在打开 [${target.name}] ...`); }
    return done(`未找到模块 [${m[1]}]。`);
  }

  return done(`未能识别指令: "${msg}"
输入 "帮助" 查看全部可用指令。`);
}

module.exports = { handle };
