/* TDD：术语悬浮卡（glossary.js）—— 匹配、优先级、转义约定、边界与异常。
 * 运行：node tests/glossary.test.mjs
 * 方式：源码字符串注入私有函数导出（不改磁盘源码），在最小 DOM 桩上用 vm 加载。 */
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(ROOT + p, 'utf8');

const CLOSER = '})(window.AISEC = window.AISEC || {});';
function makeCtx(glossary) {
  const listeners = {};
  const el = {
    innerHTML: '', textContent: '', style: {}, dataset: {}, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
    appendChild() {}, remove() {}, focus() {}, click() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    querySelector: () => null, querySelectorAll: () => []
  };
  const doc = {
    documentElement: el, body: el,
    createElement: () => { const n = Object.assign({}, el); return n; },
    getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
    addEventListener: (k, f) => { (listeners[k] = listeners[k] || []).push(f); }
  };
  const win = {
    document: doc, innerWidth: 1200, innerHeight: 800, scrollX: 0, scrollY: 0,
    localStorage: { getItem: () => null, setItem() {} },
    addEventListener: (k, f) => { (listeners[k] = listeners[k] || []).push(f); },
    setTimeout, clearTimeout, console, Math, JSON, Date, encodeURIComponent
  };
  win.window = win; win.self = win; win.top = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  let src = read('assets/js/data.js');
  vm.runInContext(src, ctx);
  if (glossary) {
    let gs = read('assets/js/glossary.js');
    assert.ok(gs.includes(CLOSER), 'glossary.js 结尾注入点存在');
    gs = gs.replace(CLOSER, 'NS.__test = { gl: NS.gl, glSearch: NS.glSearch, RX: RX, MAP: MAP, terms: terms }; ' + CLOSER);
    vm.runInContext(gs, ctx);
  }
  return { ctx, NS: win.AISEC, listeners, win };
}

let pass = 0, fail = 0;
function spec(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '  → ' + e.message); }
}

/* --- 未加载 glossary.js 时不应有 gl 导出 --- */
const bare = makeCtx(false);
spec('G0 未加载模块时 NS.gl/NS.glSearch 不存在', () => {
  assert.equal(bare.NS.gl, undefined);
  assert.equal(bare.NS.glSearch, undefined);
});

const { NS, __test } = (() => { const c = makeCtx(true); return { NS: c.NS, __test: c.NS.__test }; })();

spec('G1 术语索引从 GLOSSARY 构建，ASCII pat 小写入库', () => {
  assert.ok(__test.terms.length > 0, '术语列表非空');
  assert.ok(typeof __test.RX.test === 'function' && typeof __test.RX.exec === 'function', '正则对象已构建');
  assert.ok(__test.RX.flags.includes('g'), '正则带 g 标志');
  assert.ok(__test.MAP && Object.keys(__test.MAP).length > 0, 'MAP 非空');
  const ascii = Object.keys(__test.MAP).find(k => /^[a-z0-9]/.test(k));
  if (ascii) assert.equal(ascii, ascii.toLowerCase(), 'ASCII 键小写');
});

spec('G2 gl 命中术语时生成 button 且 data-gl 为术语 id', () => {
  const g = NS.data.GLOSSARY[0];
  const pat = (g.pat || [g.term])[0];
  const out = __test.gl('前置 ' + pat + ' 后置');
  assert.ok(out.includes('class="gl"'), out);
  assert.ok(out.includes('data-gl="' + g.id + '"'), out);
  assert.ok(out.includes(pat), out);
  assert.ok(out.includes('aria-haspopup="dialog"'), out);
});

spec('G3 gl 对 falsy 输入（空串/null/undefined/0）原样返回', () => {
  assert.equal(__test.gl(''), '');
  assert.equal(__test.gl(null), null);
  assert.equal(__test.gl(undefined), undefined);
  assert.equal(__test.gl(0), 0);
});

spec('G4 gl 同一术语只包首处，后续原样输出（seen 去重）', () => {
  const g = NS.data.GLOSSARY.find(x => (x.pat || [x.term])[0].length > 1) || NS.data.GLOSSARY[0];
  const pat = (g.pat || [g.term])[0];
  const out = __test.gl(pat + ' 和 ' + pat);
  const wraps = (out.match(/class="gl"/g) || []).length;
  assert.equal(wraps, 1, '只应包裹 1 次，实际 ' + wraps);
  const plainCount = out.split(pat).length - 1;
  assert.ok(plainCount >= 2, '两处术语文本都应保留在输出中');
  assert.ok(out.endsWith(pat), '第二处（末尾）保持原样未包裹');
});

spec('G5 gl 长术语优先匹配（terms 按长度降序）', () => {
  const lens = __test.terms.map(t => t.p.length);
  const sorted = lens.slice().sort((a, b) => b - a);
  assert.deepEqual(lens, sorted, 'terms 必须按 pat 长度降序');
});

spec('G6 glSearch 空/空白返回空数组', () => {
  assert.equal(__test.glSearch('').length, 0);
  assert.equal(__test.glSearch('   ').length, 0);
  assert.equal(__test.glSearch(null).length, 0);
});

spec('G7 glSearch 命中 term/en/short/pat 并返回原始条目', () => {
  const g = NS.data.GLOSSARY.find(x => x.en && x.en.length > 2);
  const byEn = __test.glSearch(g.en.toLowerCase());
  assert.ok(byEn.some(x => x.id === g.id), '英文命中');
  const byTerm = __test.glSearch(g.term);
  assert.ok(byTerm.some(x => x.id === g.id), '中文命中');
  assert.strictEqual(byTerm.find(x => x.id === g.id), g, '返回原始对象引用');
});

spec('G8 glSearch 不存在的词返回空数组', () => {
  assert.equal(__test.glSearch('xyzzy_no_such_term_9876').length, 0);
});

spec('G9 gl 本身不做 HTML 转义（遵循入参已转义约定）', () => {
  const raw = '<script>&"\'';
  assert.equal(__test.gl(raw), raw, 'gl 不转义，原样返回含特殊字符且未命中术语的串');
});

spec('G10 gl 对含正则元字符的 pat 不抛异常', () => {
  assert.doesNotThrow(() => __test.gl('normal text with (paren) [bracket] .dot'));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
