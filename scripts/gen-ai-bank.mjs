// 由 bank.transformed.json + new-risks.json 生成统一题库数据模块 ai-bank.js
// 500 道扩展题按内容归入 6 大知识域；92 条新风险的随堂题作为新域扩展题（Q501~Q592）
import fs from 'node:fs';
const B = JSON.parse(fs.readFileSync('bank.transformed.json', 'utf8'));
const NR = JSON.parse(fs.readFileSync('new-risks.json', 'utf8'));
const LVMAP = { '简单': 1, '中等': 2, '困难': 3 };

// 9 大知识域（与 data.js CATS 保持一致）
const DOMAINS = [
  { id: 'foundation', short: 'AI 与安全基础' },
  { id: 'llm',    short: 'LLM 应用' },
  { id: 'mcp',    short: 'MCP 工具层' },
  { id: 'agent',  short: '智能体应用' },
  { id: 'skills', short: '智能体技能' },
  { id: 'web',    short: 'Web 安全' },
  { id: 'infra',  short: '基础设施' },
  { id: 'society', short: '社会与安全影响' },
  { id: 'governance', short: '合规与治理' }
];

// 分类规则：按优先级顺序匹配，先命中者归类
// 高优先级：领域专属术语
const RULES = [
  ['skills', ['技能包', 'SKILL.md', 'manifest', '技能市场', '技能安装', '上架申请', '插件']],
  ['mcp',    ['MCP', '工具调用', '函数调用', '工具协议', '工具描述']],
  ['agent',  ['智能体', 'Agent', '自主规划', '任务分解', '多智能体', '强化学习', 'Q学习', '记忆模块']],
  ['web',    ['SQL注入', 'XSS', 'CSRF', 'SSRF', 'Web应用', '浏览器', '前端', 'Cookie', '会话固定', 'STRIDE', '访问控制列表']],
  ['society',['社会安全', '国家安全', '社会影响', '经济安全', '军事安全', '诈骗', '深度伪造', '虚假信息', '关键基础设施', '就业', '信任危机', '隐私侵害', '人身安全', '公共安全', '信息生态', '舆论']],
  ['governance', ['合规', '法规', '政策', '标准', '治理', '审计', '等保', 'ISO', 'NIST', 'GDPR', '战略', '立法', '监管', '评估报告']],
  ['foundation', [' Transformer', '监督学习', '无监督学习', '自监督学习', '强化学习', '机器学习', '深度学习', '神经网络', '注意力机制', '预训练', '微调']],
  // 中优先级：基础设施
  ['infra',  ['容器', '镜像', 'Kubernetes', 'Docker', '云环境', '密钥', '证书', '固件', '引导程序', '启动链',
              '签名验证', '供应链', '权限最小化', '网络隔离', '沙箱', '日志审计', '备份恢复', '加密', '脱敏',
              '身份认证', '访问控制', '风险评估', '风险矩阵']],
  // 兜底：LLM 应用（AI 安全通识主体）
  ['llm',    []]
];

function classify(q) {
  const text = (q.text + ' ' + q.options.join(' ') + ' ' + q.analysis).toLowerCase();
  for (const [cat, words] of RULES) {
    for (const w of words) if (text.includes(w.toLowerCase())) return cat;
  }
  return 'llm';
}

const clean = (s) => String(s)
  .replace(/CISP-AISA\s*/g, '')
  .replace(/第\s*[3-7]\s*章课程大纲及配套课件/g, '课程大纲及配套课件')
  .replace(/第\s*\d+(?:\.\d+)+\s*节/g, '课程')
  .replace(/PDF\s*第\s*\d+(?:[-–]\d+)?\s*页/g, '')
  .replace(/[（(]\s*\d+(?:\.\d+)+(?:[\s、,，／\/\-–]\s*\d+(?:\.\d+)+)*\s*[)）]/g, '')
  .replace(/\s{2,}/g, ' ');

let seq = 0;
const byDomain = {};
DOMAINS.forEach((d) => { byDomain[d.id] = []; });
for (const ch of B.chapters) {
  for (const q of ch.questions) {
    const cat = classify(q);
    const e = clean(q.analysis) + (q.basis ? '（依据：' + clean(q.basis) + '）' : '');
    byDomain[cat].push([
      'Q' + String(++seq).padStart(3, '0'), // code
      q.text,
      q.options,
      q.answer.charCodeAt(0) - 65,
      LVMAP[q.difficulty] || 2,
      e
    ]);
  }
}

// 追加 92 条新风险的随堂题作为扩展题，覆盖新 3 域与现有域
for (const r of NR) {
  const e = clean(r.quiz[3]) + '（依据：' + clean(r.basis) + '）';
  byDomain[r.cat].push([
    'Q' + String(++seq).padStart(3, '0'),
    r.quiz[0],
    r.quiz[1],
    r.quiz[2],
    r.level,
    e
  ]);
}

// 补齐：任一知识域不足 30 题时，从该域已有题生成选项乱序变体
for (const d of DOMAINS) {
  const arr = byDomain[d.id];
  if (arr.length >= 30) continue;
  const src = arr.slice();
  let i = 0;
  while (arr.length < 30 && src.length) {
    const t = src[i % src.length];
    const shift = (i % 3) + 1; // 1,2,3 循环，避免恒等变换
    const perm = [];
    for (let k = 0; k < t[2].length; k++) perm.push((k + shift) % t[2].length);
    const opts = perm.map((k) => t[2][k]);
    const ans = perm.indexOf(t[3]);
    arr.push(['Q' + String(++seq).padStart(3, '0'), t[1], opts, ans, t[4], t[5]]);
    i++;
  }
}

const lines = [];
lines.push('/* AI安全题库 — 由 scripts/gen-ai-bank.mjs 从变形结果生成，请勿手改 */');
lines.push('(function (NS) {');
lines.push("  'use strict';");
lines.push('  var DOMAINS = ' + JSON.stringify(DOMAINS) + ';');
lines.push('  var Q = ' + JSON.stringify(byDomain) + ';');
lines.push('  var list = [];');
lines.push('  DOMAINS.forEach(function (d) {');
lines.push('    (Q[d.id] || []).forEach(function (t) {');
lines.push('      list.push({');
lines.push('        code: t[0], title: d.short + " · 题" + t[0].slice(1),');
lines.push('        cat: d.id, level: t[4],');
lines.push('        quiz: { q: t[1], o: t[2], a: t[3], e: t[5] }');
lines.push('      });');
lines.push('    });');
lines.push('  });');
lines.push('  var byCode = {};');
lines.push('  list.forEach(function (q) { byCode[q.code] = q; });');
lines.push('  NS.aiBank = { list: list, byCode: byCode, domains: DOMAINS };');
lines.push('})(window.AISEC = window.AISEC || {});');
fs.writeFileSync('../assets/js/ai-bank.js', lines.join('\n'), 'utf8');

console.log('生成 ai-bank.js:', seq, '题,', (fs.statSync('../assets/js/ai-bank.js').size / 1024).toFixed(0), 'KB');
console.log('九大知识域分布:', DOMAINS.map((d) => d.short + '=' + byDomain[d.id].length).join('  '));
