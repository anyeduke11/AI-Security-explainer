/* 将 new-risks.json 的 92 条注入 data.js：CATS / RISKS / RISK_STAGES / PATHS / SCRIPTS */
import fs from 'node:fs';
const DATA = '../assets/js/data.js';
let src = fs.readFileSync(DATA, 'utf8');
const risks = JSON.parse(fs.readFileSync('new-risks.json', 'utf8'));

// 幂等：若已注入则先回滚到标记前
const MARK = '/* === 方案新增：9 域扩展（由 scripts/inject-risks.mjs 生成） === */';
if (src.includes(MARK)) {
  src = src.slice(0, src.indexOf(MARK)).trimEnd() + '\n';
  // 移除 CATS 中新增 3 域（按标记）
  const CMARK = '/* === 方案新增：3 个知识领域 === */';
  if (src.includes(CMARK)) {
    const s = src.indexOf(CMARK);
    const e = src.indexOf('];', s);
    src = src.slice(0, s) + src.slice(e);
  }
}

// 1) CATS 追加 3 域
const cats = [
  { id: 'foundation', short: 'AI 与安全基础', full: 'AI & Security Fundamentals', year: '2026', color: '#3b82f6', desc: 'AI/ML/DL 原理、Transformer、训练微调与 AI 安全基础概念，是理解后续风险的前置知识。', source: '' },
  { id: 'society', short: '社会与安全影响', full: 'Societal & Security Impact', year: '2026', color: '#d97706', desc: 'AI 对社会、经济、关键基础设施与军事的影响链路：技术失效、恶意使用与结构性变化。', source: '' },
  { id: 'governance', short: '合规与治理', full: 'Policy, Standards & Governance', year: '2026', color: '#059669', desc: '国家战略、法规政策、标准规范与安全评估报告：从合规判定到标准选用的治理闭环。', source: '' }
];
const catsCode = '\n' + MARK + '\n  /* === 方案新增：3 个知识领域 === */\n' +
  cats.map((c) => "    { id: '" + c.id + "', short: '" + c.short + "', full: '" + c.full + "', year: '" + c.year + "', color: '" + c.color + "', desc: '" + c.desc + "', source: '" + c.source + "' },").join('\n') + '\n';
const catsEnd = src.indexOf('  ];', src.indexOf('const CATS'));
src = src.slice(0, catsEnd) + catsCode + src.slice(catsEnd);

// 2) RISKS 追加 92 条
function L(arr) { return '[' + arr.map((s) => JSON.stringify(s)).join(', ') + ']'; }
function q(s) { return JSON.stringify(s); }
const riskCode = '\n' + MARK + '\n' + risks.map((r) => {
  const demo = '{ type: ' + q(r.demo.type) + ', topic: ' + q(r.demo.topic) + ', title: ' + q(r.demo.title) + ' }';
  return "    R(" + [q(r.code), q(r.title), q(r.en), q(r.cat), r.level, q(r.zones), q(r.brief), q(r.why), L(r.steps), q(r.analogy), demo, L(r.defense), q(r.scenario), L(r.quiz) + ','].join(', ') + "\n      " + q(r.basis) + "\n    ),";
}).join('\n') + '\n';
// RISKS 数组结束于 PATHS 之前
const risksEnd = src.indexOf('  ];', src.indexOf('const RISKS'));
src = src.slice(0, risksEnd) + riskCode + src.slice(risksEnd);

// 3) RISK_STAGES 追加映射（按 zones 推 S 阶段）
const zoneStage = { z1: 'S2', z2: 'S2', z3: 'S3', z4: 'S4', z5: 'S5', z6: 'S8' };
const stageCode = '\n' + risks.map((r) => {
  const st = [...new Set(r.zones.split(',').map((z) => zoneStage[z]))].slice(0, 2);
  return '    ' + r.code + ": " + L(st) + ',';
}).join('\n') + '\n';
const rsEnd = src.indexOf('  };', src.indexOf('const RISK_STAGES'));
src = src.slice(0, rsEnd) + stageCode + src.slice(rsEnd);

// 4) PATHS 增加两个新阶段（基础先行 + 合规收口）
const pathCode = '\n' + MARK + '\n' +
  "    { title: '第 0 阶段 · 基础先行', desc: '先建立 AI 原理与安全基础术语，再进入风险学习，约 20 分钟。', steps: [\n" +
  "      { code: 'FND01', why: '厘清 AI / 机器学习 / 深度学习的包含关系。' },\n" +
  "      { code: 'FND02', why: '分清基础模型与生成式 AI 的交叉视角。' },\n" +
  "      { code: 'FND03', why: '了解 AI 发展的四个主导阶段。' },\n" +
  "      { code: 'FND04', why: '掌握四种学习范式的训练信号差异。' },\n" +
  "      { code: 'FND05', why: '理解 Transformer 的核心机制。' },\n" +
  "      { code: 'FND07', why: '建立 AI 安全的属性分层概念。' },\n" +
  "      { code: 'FND08', why: '认识安全问题的六层定位。' },\n" +
  "      { code: 'SOC01', why: '把技术能力放进信息流 / 决策 / 行动链看影响。' },\n" +
  "      { code: 'GOV01', why: '用五类事实定位法理解国家战略。' },\n" +
  "      { code: 'GOV07', why: '认识 ISO/IEC 42001 等核心标准分工。' }\n" +
  "    ] },\n" +
  "    { title: '第 6 阶段 · 合规收口', desc: '用政策法规与评估报告把技术风险落到治理闭环。', steps: [\n" +
  "      { code: 'GOV02', why: '理解美国三大支柱与政策五层。' },\n" +
  "      { code: 'GOV03', why: '理解欧盟 AI 大陆行动计划。' },\n" +
  "      { code: 'GOV04', why: '理解中国三步走与「人工智能+」。' },\n" +
  "      { code: 'GOV05', why: '掌握欧盟人工智能法分阶段适用。' },\n" +
  "      { code: 'GOV06', why: '掌握中国三法打底与三套规则。' },\n" +
  "      { code: 'GOV09', why: '学会标准选用五步与适用性留痕。' },\n" +
  "      { code: 'GOV10', why: '掌握安全评估报告六要素。' },\n" +
  "      { code: 'SOC02', why: '建立关键任务外部依赖清单意识。' },\n" +
  "      { code: 'INF21', why: '把外部依赖清单落到数据 / 模型 / 算力。' },\n" +
  "      { code: 'INF20', why: '用应急响应流程收口。' }\n" +
  "    ] },\n";
const pathsEnd = src.indexOf('  ];', src.indexOf('const PATHS'));
src = src.slice(0, pathsEnd) + pathCode + src.slice(pathsEnd);

// 5) SCRIPTS 为新 code 补通用剧本（若 SCRIPTS 存在）
if (src.includes('const SCRIPTS')) {
  const scriptCode = '\n' + MARK + '\n' + risks.map((r) => {
    return "    " + r.code + ": { sys: '你是 AI 安全学习助手。', usr: '请简述「" + r.title.replace(/'/g, "\\'") + "」的核心风险与防护措施。', pk: [], seg: 'doc', focus: [0, 3], doc: '" + r.brief.replace(/'/g, "\\'") + "', docClean: '" + r.analogy.replace(/'/g, "\\'") + "' },";
  }).join('\n') + '\n';
  const scEnd = src.indexOf('  };', src.indexOf('const SCRIPTS'));
  if (scEnd > 0) src = src.slice(0, scEnd) + scriptCode + src.slice(scEnd);
}

fs.writeFileSync(DATA, src, 'utf8');
console.log('注入完成:', risks.length, '条风险 + 3 域 + 2 个路径阶段');
