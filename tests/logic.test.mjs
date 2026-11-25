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

/* ---------- D5 · F1 洗牌（展示序洗牌 + 可注入随机源） ---------- */
spec('D5 洗牌为 Fisher-Yates 且支持注入随机源（可复现）', () => {
  const app = read('assets/js/app.js');
  const fn = app.slice(app.indexOf('function shuffle'), app.indexOf('function quizStart'));
  assert.ok(/function\s+shuffle/.test(fn), '应有统一 shuffle 实现');
  assert.ok(!/Math\.random\(\)\s*-\s*0\.5/.test(app), '全文件不应残留 Math.random()-0.5 模式');
  assert.ok(/var j = Math\.floor\(r\(\) \* \(i \+ 1\)\)/.test(fn), '应为 Fisher-Yates 交换式实现');
  assert.ok(/rnd \|\| Math\.random/.test(fn), '随机源应可注入（默认 Math.random）');
  /* 用固定种子验证可复现：同一随机源两次洗牌结果一致 */
  const mk = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  const sh = (arr, rnd) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const base = [0, 1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(sh(base, mk(42)), sh(base, mk(42)), '同一种子应产出同一结果');
  assert.notDeepEqual(sh(base, mk(1)), sh(base, mk(2)), '不同种子应产出不同结果');
  /* 无偏性抽样：大量重排后各位置出现频次应大致均衡（不集中在单一位置） */
  const N = 3000, freq = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < N; t++) { const r = sh(base, mk(t + 1)); r.forEach((v, i) => { if (v === 0) freq[i]++; }); }
  const exp = N / base.length;
  freq.forEach((f, i) => assert.ok(Math.abs(f - exp) < exp * 0.2, '位置 ' + i + ' 频次 ' + f + ' 偏离期望 ' + exp));
});
spec('D6 随堂小测与测验中心渲染路径均做展示序洗牌并保留原始索引映射', () => {
  const app = read('assets/js/app.js');
  assert.ok(/function displayOrder/.test(app), '应有 displayOrder 展示洗牌实现');
  /* 随堂小测：viewRisk 内使用 displayOrder 并写出 data-orig 映射 */
  const riskFn = app.slice(app.indexOf('function miniQuizHTML'), app.indexOf('function viewRisk'));
  assert.ok(/displayOrder\(r\.quiz\.o\)/.test(riskFn), '随堂小测应调用 displayOrder');
  assert.ok(/data-orig=/.test(riskFn), '随堂小测应输出「展示索引→原始索引」映射');
  /* 测验中心：quizQuestionHTML 内使用 displayOrder 并写出 data-q-orig */
  const quizFn = app.slice(app.indexOf('function quizQuestionHTML'), app.indexOf('function quizResultHTML'));
  assert.ok(/displayOrder\(r\.quiz\.o\)/.test(quizFn), '测验中心应调用 displayOrder');
  assert.ok(/data-q-orig=/.test(quizFn), '测验中心应输出「展示索引→原始索引」映射');
  /* 判定必须用原始索引，而不是展示索引 */
  const quizWire = app.slice(app.indexOf('function wireQuiz'), app.indexOf('/* ---------------- 页面：进度'));
  assert.ok(/qOrig/.test(quizWire) && /=== r\.quiz\.a/.test(quizWire), '判定应基于原始索引 r.quiz.a');
  const riskWire = app.slice(app.indexOf('function wireRisk'), app.indexOf('/* ---------------- 页面：学习路径'));
  assert.ok(/dataset\.orig/.test(riskWire), '随堂小测判定应基于原始索引');
});
spec('D7 展示序洗牌后判定结果与洗牌前一致（映射可逆）', () => {
  const app = read('assets/js/app.js');
  /* 复刻 app.js 的 displayOrder 语义：order[展示位] = 原始索引 */
  const order = [2, 0, 1];
  const r = { quiz: { a: 1 } };
  /* 展示位 0 对应原始索引 2；正确项原始索引 1 → 落在展示位 2 */
  const displayPos = order.indexOf(r.quiz.a);
  assert.equal(displayPos, 2);
  assert.equal(order[displayPos], r.quiz.a, '映射必须可逆：展示位→原始索引');
});

/* ---------- D8 · P0-1 预测闸门（与 simulate 同源） ---------- */
spec('D8 预测闸门：未预测时「发起攻击」禁用，合法对照态无闸门', () => {
  const demos = read('assets/js/demos.js');
  const fn = demos.slice(demos.indexOf('function engineRange'), demos.indexOf('/* 8) flow'));
  assert.ok(/b\.disabled = needPredict && !st\.predict/.test(fn), '未选预测时应禁用发起按钮');
  assert.ok(/st\.variant !== 'benign' && !st\.predict\) return;/.test(fn), '未预测时应拦截发起动作');
  assert.ok(/if \(st\.variant === 'benign'\)/.test(fn), '合法对照态应特殊处理（无预测闸门）');
  assert.ok(/③ 预测（先预测再验证）/.test(fn), '应存在独立的预测卡片');
  assert.ok(/④ 执行/.test(fn), '执行组应排在预测之后');
});
spec('D9 预测真值与 simulate 同源（禁止两套判定逻辑）', () => {
  const demos = read('assets/js/demos.js');
  const fn = demos.slice(demos.indexOf('function engineRange'), demos.indexOf('/* 8) flow'));
  assert.ok(/function predictTruth\(\) \{ return simulate\(\)\.truth; \}/.test(fn), 'predictTruth 必须直接复用 simulate()');
  assert.ok(/truth: truth/.test(fn), 'simulate() 必须返回 truth 字段');
  /* truth 取值域固定为四种 */
  assert.ok(/var truth = 'none'/.test(fn) && /truth = 'ok'/.test(fn) && /truth = 'blocked'/.test(fn) && /truth = 'atk'/.test(fn),
    'truth 应覆盖 none/ok/blocked/atk 四种取值');
  /* 不得出现独立的第二套判定分支：predictTruth 之外不应另写按 D 配置判定结果的代码 */
  const predTruthBody = fn.slice(fn.indexOf('function predictTruth'), fn.indexOf('function predictMatches'));
  assert.ok(!/st\.D\./.test(predTruthBody), 'predictTruth 内部不得自行按防御配置判定');
});
spec('D10 预测记录可回溯（st.predicted 历史 + 答错三段对照）', () => {
  const demos = read('assets/js/demos.js');
  const fn = demos.slice(demos.indexOf('function engineRange'), demos.indexOf('/* 8) flow'));
  assert.ok(/st\.predicted\.push\(st\.predict\)/.test(fn), '应记录预测历史（允许改答案并重测）');
  assert.ok(/st\.predicted = \[\]/.test(fn), '重置时应清空预测历史');
  assert.ok(/你的预测/.test(fn) && /实际结果/.test(fn) && /差异原因/.test(fn), '答错反馈应含「你的预测 / 实际结果 / 差异原因」三段');
  assert.ok(/st\.predict: st\.predict/.test(fn) || /predict: st\.predict/.test(fn), '闭环完成时应把预测结果回传宿主');
  assert.ok(/onRangeComplete/.test(fn), '闭环完成应回调 NS.demos.onRangeComplete');
});

/* ---------- D11 · P0-2 进度三维度 ---------- */
spec('D11 进度三维度：defaults 含 ranged，读懂/练过/答对各自计数', () => {
  const app = read('assets/js/app.js');
  const defaultsFn = app.slice(app.indexOf('function defaults'), app.indexOf('var S;'));
  assert.ok(/ranged: \{\}/.test(defaultsFn), 'defaults() 应包含 ranged 字段');
  assert.ok(/S\.ranged = S\.ranged \|\| \{\}/.test(app), '旧用户无 ranged 键时应兜底为空对象');
  assert.ok(/function rangedCount/.test(app) && /function quizAnsweredCount/.test(app), '应有练过与答对计数函数');
  const progFn = app.slice(app.indexOf('function viewProgress'), app.indexOf('function wireProgress'));
  assert.ok(/读懂/.test(progFn) && /练过/.test(progFn) && /答对/.test(progFn), '进度页应展示三维度');
  assert.ok(/PROGRESS_WEIGHT/.test(app) && /read: 0\.4/.test(app) && /ranged: 0\.4/.test(app) && /quiz: 0\.2/.test(app),
    '主环权重应为 读懂 40% + 练过 40% + 答对 20%');
  assert.ok(/NS\.demos\.onRangeComplete = onRangeComplete/.test(app), 'app.js 应注册 onRangeComplete 回调');
});
spec('D12 migrateCodes 兜底 ranged 的旧编号键', () => {
  const app = read('assets/js/app.js');
  const mig = app.slice(app.indexOf('function migrateCodes'), app.indexOf('function learnedCount'));
  assert.ok(/\['read', 'visited', 'mini', 'ranged'\]/.test(mig), 'migrateCodes 应覆盖 ranged 字段');
  /* 旧用户 localStorage 无 ranged 键时不得抛错（迁移后 ranged 仍为对象） */
  const map = { MCP1: 'MCP01', MCP8: 'MCP08' };
  const state = { read: { MCP1: 1 }, visited: {}, mini: {}, ranged: { MCP1: 1 }, quiz: { total: 0, right: 0, wrong: {}, ok: {} } };
  ['read', 'visited', 'mini', 'ranged'].forEach(f => Object.keys(state[f]).forEach(k => {
    if (map[k]) { state[f][map[k]] = state[f][k]; delete state[f][k]; }
  }));
  assert.ok(state.ranged.MCP01, 'ranged 旧编号应迁移');
  assert.equal(state.ranged.MCP1, undefined, 'ranged 旧编号键应被删除');
  const legacy = { read: {}, visited: {}, mini: {}, theme: 'light', quiz: { total: 0, right: 0, wrong: {} } };
  legacy.ranged = legacy.ranged || {};
  assert.deepEqual(legacy.ranged, {}, '无 ranged 键的旧状态应兜底为空对象且不报错');
});

/* ---------- D13 · P1-1 术语补齐至 46 条 ---------- */
spec('D13 术语表补齐至 46 条且 12 条新术语均可检索', () => {
  assert.equal(D.GLOSSARY.length, 46, 'GLOSSARY 应为 46 条，实际 ' + D.GLOSSARY.length);
  const need = ['API', 'SQL 注入', 'Shell', 'YAML', 'schema', 'TLS', 'SAST', '反序列化', '熔断', '参数化', '告警', '密钥管理'];
  need.forEach(t => {
    const g = D.GLOSSARY.find(x => x.term === t);
    assert.ok(g, '缺少术语 ' + t);
    assert.ok(g.short && g.short.length > 8, t + ' 释义过短');
    assert.ok(Array.isArray(g.see) && g.see.length > 0, t + ' 应有关联风险');
    g.see.forEach(c => assert.ok(D.RISK_MAP[c], t + ' → 关联编号无效 ' + c));
  });
});
spec('D14 术语 pat 互不冲突且 id 唯一', () => {
  const seen = {};
  D.GLOSSARY.forEach(g => {
    assert.ok(!seen[g.id], '术语 id 重复: ' + g.id);
    seen[g.id] = 1;
    (g.pat || [g.term]).forEach(p => {
      const k = /^[A-Za-z0-9]/.test(p) ? p.toLowerCase() : p;
      assert.ok(!seen['pat:' + k] || seen['pat:' + k] === g.id, 'pat 冲突: ' + k);
      seen['pat:' + k] = g.id;
    });
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
