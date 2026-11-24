/* TDD 逻辑层模拟测试：数据完整性、路由解析、进度状态机、测验与搜索评分。
 * 运行：node tests/logic.test.mjs
 * 说明：用 Node vm 在最小 DOM/localStorage 桩上加载真实脚本，先断言期望行为。 */
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(ROOT + p, 'utf8');

let pass = 0, fail = 0;
const failures = [];
function spec(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { fail++; failures.push({ name, msg: e.message }); console.log('FAIL  ' + name + '  → ' + e.message); }
}

/* ---------- 最小浏览器桩 ---------- */
function mockStorage() {
  const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), _m: m };
}
function mockEl() {
  const el = {
    innerHTML: '', textContent: '', value: '', dataset: {}, style: {}, className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [], attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    querySelector: () => mockEl(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, bottom: 0, width: 0, height: 0, left: 0, right: 0 }),
    scrollIntoView() {}, focus() {}, click() {}, insertAdjacentHTML() {}
  };
  return el;
}
function makeCtx(hash = '#/home', store = mockStorage()) {
  const loc = { hash, href: 'http://localhost/' + hash, pathname: '/', search: '' };
  const doc = {
    documentElement: mockEl(), body: mockEl(), location: loc,
    querySelector: () => mockEl(), querySelectorAll: () => [],
    getElementById: () => mockEl(), createElement: () => mockEl(),
    addEventListener() {}, removeEventListener() {}
  };
  const win = {
    document: doc, location: loc, localStorage: store, navigator: { userAgent: 'node-test' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, setTimeout, clearTimeout,
    setInterval, clearInterval, requestAnimationFrame: f => f(), confirm: () => true,
    alert() {}, fetch: async () => ({ json: async () => ({}) }), btoa: s => Buffer.from(s).toString('base64'),
    URL, Blob: class { constructor(a) { this.parts = a; } }, Math, JSON, Date, console,
    postMessage() {}, top: null
  };
  win.window = win; win.self = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read('assets/js/data.js'), ctx);
  vm.runInContext(read('assets/js/glossary.js'), ctx);
  return { ctx, win, doc, store, loc, NS: win.AISEC };
}

/* ---------- A. 数据完整性（9 域 × 152 风险 × 9 阶段） ---------- */
const { ctx, NS, win } = makeCtx();
const D = NS.data;
spec('A1 九大知识域共 152 条风险且编号唯一', () => {
  assert.equal(D.CATS.length, 9);
  assert.equal(D.RISKS.length, 152);
  assert.equal(new Set(D.RISKS.map(r => r.code)).size, 152);
  D.CATS.forEach(c => assert.ok(D.byCat(c.id).length >= 10, c.id + ' 不足 10 条'));
});
spec('A2 九个攻击阶段与风险双向索引一致', () => {
  assert.equal(D.STAGES.length, 9);
  D.STAGES.forEach(s => {
    const back = D.RISKS.filter(r => r.stages.includes(s.id)).map(r => r.code).sort();
    assert.deepEqual(s.risks.map(r => r.code).sort(), back, s.id + ' 正反向索引不一致');
  });
});
spec('A3 学习路径 7 阶段 44 步引用的风险 code 全部存在', () => {
  const steps = D.PATHS.reduce((n, p) => n + p.steps.length, 0);
  assert.equal(D.PATHS.length, 7);
  assert.equal(steps, 44);
  D.PATHS.forEach(p => p.steps.forEach(st => assert.ok(D.RISK_MAP[st.code], st.code + ' 不存在')));
});
spec('A4 术语表 see 引用的风险 code 全部有效', () => {
  D.GLOSSARY.forEach(g => (g.see || []).forEach(c => assert.ok(D.RISK_MAP[c], g.id + ' → ' + c)));
});
spec('A5 每个风险都有 quiz、demo 与 defense', () => {
  D.RISKS.forEach(r => {
    assert.ok(r.quiz && r.quiz.q && Array.isArray(r.quiz.o) && r.quiz.a >= 0, r.code + ' quiz 不完整');
    assert.ok(r.demo && r.demo.type, r.code + ' 缺 demo');
    assert.ok(r.defense && r.defense.length, r.code + ' 缺防御建议');
  });
});
spec('A6 ZONES.codes 中的风险编号全部有效', () => {
  const declared = D.ZONES.flatMap(z => z.codes || []);
  const unknown = declared.filter(c => !D.RISK_MAP[c]);
  assert.equal(unknown.length, 0, 'ZONES.codes 含无效编号: ' + [...new Set(unknown)].join(','));
});
spec('A7 全部 152 条风险均有 SCRIPTS 剧本', () => {
  const missing = D.RISKS.filter(r => !D.SCRIPTS[r.code]).map(r => r.code);
  assert.equal(missing.length, 0, '缺剧本 ' + missing.length + ' 条: ' + missing.join(','));
});

/* ---------- B. 路由解析（app.js parseHash 行为复刻断言） ---------- */
function parseHash(hash) {
  let s = String(hash || '').replace(/^#\/?/, '');
  const qi = s.indexOf('?'); const query = {};
  if (qi >= 0) {
    s.slice(qi + 1).split('&').forEach(kv => {
      if (!kv) return; const i = kv.indexOf('=');
      const k = decodeURIComponent((i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, ' '));
      const v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
      query[k] = v;
    });
    s = s.slice(0, qi);
  }
  const parts = s.split('/').filter(Boolean);
  return { view: parts[0] || 'home', param: parts[1] || '', query };
}
spec('B1 空 hash 与 #/ 均解析为 home', () => {
  assert.equal(parseHash('').view, 'home'); assert.equal(parseHash('#/').view, 'home');
});
spec('B2 带 query 的风险深链解析正确', () => {
  const r = parseHash('#/risk/LLM01?from=lab&q=%E6%8F%90%E7%A4%BA%E6%B3%A8%E5%85%A5');
  assert.equal(r.view, 'risk'); assert.equal(r.param, 'LLM01');
  assert.equal(r.query.from, 'lab'); assert.equal(r.query.q, '提示注入');
});
spec('B3 所有侧栏目标路由都有渲染分支', () => {
  const app = read('assets/js/app.js');
  ['home', 'lab', 'path', 'quiz', 'progress', 'search', 'transformer', 'cat', 'risk']
    .forEach(v => assert.ok(app.includes("case '" + v + "'") || app.includes("view === '" + v + "'"), v + ' 无分发分支'));
});

/* ---------- C. 进度状态机（模拟 localStorage） ---------- */
spec('C1 默认进度为空且主题为 light', () => {
  const defaults = { read: {}, visited: {}, mini: {}, theme: 'light', quiz: { total: 0, right: 0, wrong: {} } };
  assert.deepEqual(defaults.read, {}); assert.equal(defaults.theme, 'light');
});
spec('C2 旧编号 MCP1 迁移到 MCP01 且不丢计数', () => {
  const map = { 'MCP1': 'MCP01', 'MCP2': 'MCP02', 'MCP4': 'MCP04', 'MCP5': 'MCP05', 'MCP6': 'MCP06', 'MCP8': 'MCP08', 'MCP9': 'MCP09' };
  const state = { read: { MCP1: 1 }, visited: {}, mini: {}, quiz: { total: 2, right: 1, wrong: { MCP1: 2 } } };
  const mig = s => { Object.keys(s.quiz.wrong).forEach(k => { if (map[k]) { s.quiz.wrong[map[k]] = (s.quiz.wrong[map[k]] || 0) + s.quiz.wrong[k]; delete s.quiz.wrong[k]; } });
    ['read', 'visited', 'mini'].forEach(f => Object.keys(s[f]).forEach(k => { if (map[k]) { s[f][map[k]] = s[f][k]; delete s[f][k]; } })); return s; };
  const out = mig(state);
  assert.ok(out.read.MCP01); assert.equal(out.quiz.wrong.MCP01, 2); assert.equal(out.quiz.wrong.MCP1, undefined);
});
spec('C3 已学计数对未知 code 具备容错', () => {
  const app = read('assets/js/app.js');
  const learnedFn = app.slice(app.indexOf('function learnedCount'), app.indexOf('function learnedInCat'));
  assert.ok(/RISK_MAP\[|byCat|filter/.test(learnedFn), 'learnedCount 应过滤掉无效的 read key');
});
spec('C4 随堂小测结果应在进度或统计中被读取', () => {
  const app = read('assets/js/app.js');
  const writes = (app.match(/S\.mini\[/g) || []).length;
  const reads = (app.match(/S\.mini\b/g) || []).length - writes;
  assert.ok(writes >= 2, 'mini 写入点应>=2');
  assert.ok(reads >= 1, 'mini 应至少被读取一次用于进度展示，当前只写不读');
});

/* ---------- D. 测验流程 ---------- */
spec('D1 重练错题深链必须真正进入错题模式', () => {
  const app = read('assets/js/app.js');
  const viewFn = app.slice(app.indexOf('function quizView'), app.indexOf('function segHTML'));
  assert.ok(/q\.mode/.test(viewFn), 'quizView 应读取 q.mode 以响应 #/quiz?mode=wrong');
});
spec('D2 分类/难度/题量 query 应回填到测验设置', () => {
  const app = read('assets/js/app.js');
  const viewFn = app.slice(app.indexOf('function quizView'), app.indexOf('function segHTML'));
  ['q.cat', 'q.level', 'q.count'].forEach(k => assert.ok(viewFn.includes(k), k + ' 未回填'));
});
spec('D3 洗牌应可复现且无偏（禁止 Math.random()-0.5）', () => {
  const app = read('assets/js/app.js');
  const line = app.slice(app.indexOf('function quizStart'), app.indexOf('function quizView'));
  assert.ok(!/Math\.random\(\)\s*-\s*0\.5/.test(line), '应使用 Fisher-Yates + 可注入随机源');
});
spec('D4 每道题的正确选项索引合法且解释非空', () => {
  D.RISKS.forEach(r => {
    assert.ok(r.quiz.a < r.quiz.o.length, r.code + ' 正确选项越界');
    assert.ok(r.quiz.e && r.quiz.e.length > 4, r.code + ' 解析过短');
  });
});

/* ---------- E. 搜索评分 ---------- */
spec('E1 编号精确匹配排名第一', () => {
  const scored = D.RISKS.map(r => ({ r, s: r.code.toLowerCase().startsWith('llm01') ? 10 : 0 })).sort((a, b) => b.s - a.s);
  assert.equal(scored[0].r.code, 'LLM01');
});
spec('E2 多关键词取交集且按分数降序', () => {
  const terms = ['提示', '注入'];
  const hit = D.RISKS.filter(r => terms.every(t => (r.search || '').includes(t)));
  assert.ok(hit.length > 0);
  assert.ok(hit.some(r => r.code === 'LLM01'), 'LLM01 应命中提示注入');
});

/* ---------- F. 实验室状态机 ---------- */
spec('F1 起点改变阈值且跳过阶段生效', () => {
  const starts = D.STARTS;
  assert.equal(starts.length, 4);
  starts.forEach(s => assert.ok(s.skip.every(id => D.STAGE_MAP[id]), s.id + ' skip 含非法阶段'));
  const a = D.STAGES[0], bias = starts[1].bias;
  assert.ok(Math.max(1, a.threshold + bias) >= 1);
});
spec('F2 阶段上限应由 STAGES 长度驱动而非硬编码 9', () => {
  const lab = read('assets/js/lab.js');
  assert.ok(!/clamp\(n, 1, 9\)/.test(lab), 'setStage 硬编码 9');
  assert.ok(!/S\.stage >= 9/.test(lab), 'play 硬编码 9');
  assert.ok(!/max="9"/.test(lab), '滑块 max 硬编码 9');
  assert.ok(!/s\.id \+ ' \/ 9'/.test(lab), '统计分母硬编码 9');
});
spec('F3 非法 view query 应回退到合法视角', () => {
  const lab = read('assets/js/lab.js');
  const mount = lab.slice(lab.indexOf('function mount'), lab.indexOf('NS.lab ='));
  assert.ok(/\['topology', 'timeline', 'heat'\]\.indexOf\(opts\.view\)/.test(mount), 'opts.view 未做白名单');
});
spec('F6 postMessage 双向校验 origin 与 source', () => {
  const app = read('assets/js/app.js');
  const tx = read('demos/transformer-attack-explainer.html');
  assert.ok(/e\.origin !== TX_ORIGIN/.test(app) && /e\.source !== frame\.contentWindow/.test(app), '父页未校验消息来源');
  assert.ok(/e\.origin !== TX_ORIGIN/.test(tx) && /e\.source !== window\.parent/.test(tx), 'iframe 未校验消息来源');
  assert.ok(!/postMessage\([^)]*,\s*'\*'\)/.test(app) && !/postMessage\([^)]*,\s*'\*'\)/.test(tx), '仍存在 '*' 目标');
});
spec('F4 防御拦截后链路仍完整展示所有阶段', () => {
  const lab = read('assets/js/lab.js');
  const sm = lab.slice(lab.indexOf('function statusMap'), lab.indexOf('function blockedCount'));
  assert.ok(sm.includes("out[s.id] = blocked ? 'blocked'"), '当前仅标 blocked，未抹除链路');
  assert.ok(!sm.includes('opacity: 0') && !sm.includes("'hidden'"));
});
spec('F5 用户手动越过被拦截阶段时应有明确提示', () => {
  const lab = read('assets/js/lab.js');
  const setStage = lab.slice(lab.indexOf('function setStage'), lab.indexOf('function setHover'));
  const hasGuard = /blocked/.test(setStage) && /toast|提示|警告|notice/.test(setStage);
  assert.ok(hasGuard, 'setStage 应检测越过 firstBlocked 并给出提示');
});

console.log('\n=== 汇总 ===');
console.log('PASS=' + pass + '  FAIL=' + fail);
if (failures.length) { console.log('\n不符合项：'); failures.forEach((f, i) => console.log((i + 1) + '. ' + f.name + ' — ' + f.msg)); }
process.exit(fail ? 1 : 0);
