/* TDD：交互演示引擎（demos.js）—— 纯 UI 字符串生成、clamp 边界、render 分派与 fallback、异常兜底。
 * 运行：node tests/demos.test.mjs
 * 方式：源码字符串注入私有函数导出（不改磁盘源码），在最小 DOM 桩上 vm 加载。 */
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(ROOT + p, 'utf8');
const CLOSER = '})(window.AISEC = window.AISEC || {});';

function makeCtx() {
  const host = { innerHTML: '', addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const doc = {
    documentElement: host, body: host,
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {}, addEventListener() {} }),
    querySelector: () => host, querySelectorAll: () => [], addEventListener() {}, getElementById: () => host
  };
  const win = {
    document: doc, localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: f => f(), Math, JSON, Date, console, encodeURIComponent
  };
  win.window = win; win.self = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read('assets/js/data.js'), ctx);
  let src = read('assets/js/demos.js');
  assert.ok(src.includes(CLOSER), 'demos.js 结尾注入点存在');
  const EXPOSE = 'NS.__test = { esc: esc, clamp: clamp, fmt: fmt, verdict: verdict, meter: meter, sw: sw, seg: seg, range: range, resetBtn: resetBtn, ENGINES: ENGINES, renderRange: NS.demos.renderRange, render: NS.demos.render }; ';
  vm.runInContext(src.replace(CLOSER, EXPOSE + CLOSER), ctx);
  return { ctx, NS: win.AISEC, __test: win.AISEC.__test, host };
}

let pass = 0, fail = 0;
function spec(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '  → ' + e.message); }
}

const { NS, __test: T, host } = makeCtx();

spec('D1 11 类引擎注册齐全且 render/renderRange 导出', () => {
  assert.equal(T.ENGINES && Object.keys(T.ENGINES).length, 11);
  ['prompt', 'scope', 'pipeline', 'inspect', 'budget', 'rag', 'web', 'flow', 'concept', 'policy', 'impact'].forEach(k => assert.ok(T.ENGINES[k], k + ' 引擎缺失'));
  assert.equal(typeof NS.demos.render, 'function');
  assert.equal(typeof NS.demos.renderRange, 'function');
  assert.equal(NS.demos.types.length, 11);
});

spec('D2 esc 转义全部五种 HTML 特殊字符', () => {
  assert.equal(T.esc('<a href="x" \'y\'>&'), '&lt;a href=&quot;x&quot; &#39;y&#39;&gt;&amp;');
  assert.equal(T.esc(null), '');
  assert.equal(T.esc(0), '0');
});

spec('D3 clamp 正常/边界/异常路径', () => {
  assert.equal(T.clamp(5, 1, 10), 5);
  assert.equal(T.clamp(-3, 0, 100), 0);
  assert.equal(T.clamp(150, 0, 100), 100);
  assert.equal(T.clamp(1, 1, 10), 1);
  assert.equal(T.clamp(10, 1, 10), 10);
});

spec('D4 fmt 四舍五入并按 zh-CN 分组', () => {
  assert.equal(T.fmt(1234.6), '1,235');
  assert.equal(T.fmt(-12), '-12');
});

spec('D5 verdict 三类 kind 与结构', () => {
  ['ok', 'warn', 'bad'].forEach(k => {
    const html = T.verdict(k, '标题', '正文');
    assert.ok(html.includes('class="verdict ' + k + '"'), k);
    assert.ok(html.includes('<b>标题</b>正文'), k);
  });
});

spec('D6 meter 限界 0~100 与默认标签', () => {
  assert.ok(T.meter(150, '风险').includes('width:100%'));
  assert.ok(T.meter(-10, '风险').includes('width:0%'));
  assert.ok(T.meter(33.6).includes('当前风险指数'));
  assert.ok(T.meter(50, '中间').includes('<b>50</b>'));
});

spec('D7 sw 开关列表 defaults 决定 checked', () => {
  const items = [['a', '标题A', '说明A'], ['b', '标题B', '说明B']];
  const html = T.sw(items, { a: true });
  assert.equal((html.match(/checked/g) || []).length, 1);
  assert.ok(html.includes('data-sw="a"') && html.includes('data-sw="b"'));
  assert.ok(html.includes('说明A'));
});

spec('D8 seg 段控件 active 与转义', () => {
  const html = T.seg('mode', [['x', '选项X'], ['y', '选项Y']], 'y');
  assert.ok(html.includes('data-seg="mode"'));
  assert.equal((html.match(/class="active"/g) || []).length, 1);
  assert.ok(html.includes('选项X') && html.includes('选项Y'));
});

spec('D9 range 滑块结构含 min/max/step/unit', () => {
  const html = T.range('budget', '预算', 0, 100, 30, 5, '');
  assert.ok(html.includes('data-range="budget"'));
  assert.ok(html.includes('min="0"') && html.includes('max="100"') && html.includes('step="5"') && html.includes('value="30"'));
  assert.ok(html.includes('data-out="budget"'));
});

spec('D10 resetBtn 返回固定重置按钮', () => {
  assert.ok(T.resetBtn().includes('重置'));
});

spec('D11 render 未知 type 回退到 flow 且写 host', () => {
  host.innerHTML = '';
  T.render({ code: 'X', title: '未知类型', demo: { type: '__no_such_engine__' } }, host);
  assert.ok(host.innerHTML.length > 0, 'host 应被写入内容');
  assert.ok(!host.innerHTML.includes('演示加载失败'), 'fallback 不应报错');
});

spec('D12 render 缺 demo 字段时以 flow 渲染不抛异常', () => {
  host.innerHTML = '';
  assert.doesNotThrow(() => T.render({ code: 'X', title: '无 demo' }, host));
  assert.ok(host.innerHTML.length > 0);
});

spec('D13 renderRange 缺剧本时给出建设中提示', () => {
  host.innerHTML = '';
  T.renderRange({ code: '__NO_SCRIPT__', title: '无剧本', demo: {} }, host);
  assert.ok(host.innerHTML.includes('建设中'), host.innerHTML);
});

spec('D14 renderRange 剧本无 gate 时同样提示建设中', () => {
  host.innerHTML = '';
  const r = NS.data.RISKS[0];
  const orig = NS.data.SCRIPTS[r.code];
  NS.data.SCRIPTS[r.code] = { steps: {} };
  try { T.renderRange(r, host); } finally { NS.data.SCRIPTS[r.code] = orig; }
  assert.ok(host.innerHTML.includes('建设中'));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
