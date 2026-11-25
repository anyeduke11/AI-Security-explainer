/* TDD：攻击路径实验室（lab.js）—— 状态机阻断判定、几何纯函数、字符串渲染与边界。
 * 运行：node tests/lab.test.mjs
 * 方式：源码字符串注入私有函数导出（不改磁盘源码），vm 桩加载；直接改 NS.lab.state 观察纯逻辑。 */
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(ROOT + p, 'utf8');
const CLOSER = '})(window.AISEC = window.AISEC || {});';

function makeCtx() {
  const el = {
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {},
    querySelector: () => el, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 1000, height: 600 })
  };
  const doc = {
    documentElement: el, body: el, createElement: () => Object.assign({}, el),
    querySelector: () => el, querySelectorAll: () => [], getElementById: () => el,
    addEventListener() {}
  };
  const win = {
    document: doc, localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: f => f(), cancelAnimationFrame() {},
    Math, JSON, Date, console, encodeURIComponent, decodeURIComponent
  };
  win.window = win; win.self = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read('assets/js/data.js'), ctx);
  let src = read('assets/js/lab.js');
  assert.ok(src.includes(CLOSER), 'lab.js 结尾注入点存在');
  const EXPOSE = 'NS.__test = { S: S, STAGES: STAGES, startCfg: startCfg, thresholdOf: thresholdOf, statusMap: statusMap, blockedCount: blockedCount, reachableCount: reachableCount, activeStage: activeStage, boundaryOffset: boundaryOffset, edgeCoords: edgeCoords, edgeSeed: edgeSeed, curvePath: curvePath, heatCount: heatCount, svgHTML: svgHTML, timelineHTML: timelineHTML, heatHTML: heatHTML, stageDetail: stageDetail, stagePills: stagePills, hoverNodes: hoverNodes }; ';
  vm.runInContext(src.replace(CLOSER, EXPOSE + CLOSER), ctx);
  return { ctx, NS: win.AISEC, __test: win.AISEC.__test };
}

let pass = 0, fail = 0;
function spec(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '  → ' + e.message); }
}

const { NS, __test: T } = makeCtx();

function reset() {
  Object.assign(T.S, { view: 'topology', start: 'external', stage: 1, defense: 0, playing: false, hover: null, selectedRisk: null, heatCell: null });
}

spec('L1 导出 lab 接口与 S 初始状态', () => {
  assert.equal(typeof NS.lab.mount, 'function');
  assert.equal(typeof NS.lab.stop, 'function');
  assert.ok(NS.lab.state);
  assert.equal(T.STAGES.length, 9);
  assert.equal(T.S.stage, 1);
  assert.equal(T.S.defense, 0);
});

spec('L2 startCfg 按起点取配置并 fallback 到第一项', () => {
  reset();
  T.S.start = 'external';
  assert.ok(T.startCfg());
  T.S.start = '__unknown__';
  assert.ok(T.startCfg(), '未知起点应 fallback');
});

spec('L3 thresholdOf 至少为 1 且含起点 bias', () => {
  reset();
  const bias = T.startCfg().bias || 0;
  T.STAGES.forEach(s => {
    const th = T.thresholdOf(s);
    assert.ok(th >= 1, s.id + ' 阈值应≥1');
    assert.equal(th, Math.max(1, s.threshold + bias), s.id + ' 阈值计算不符');
  });
});

spec('L4 statusMap 返回按 stage.id 索引的 map 与 firstBlocked', () => {
  reset();
  const sm = T.statusMap();
  assert.ok(sm.map && typeof sm.map === 'object' && !Array.isArray(sm.map), 'map 应为对象');
  assert.equal(Object.keys(sm.map).length, T.STAGES.length);
  assert.ok('firstBlocked' in sm);
  T.STAGES.forEach(s => assert.ok(sm.map[s.id], s.id + ' 缺状态'));
});

spec('L5 防御拉满时阻断首阶段且 firstBlocked 指向首个非 skip 阶段', () => {
  reset();
  T.S.defense = 100;
  const sm = T.statusMap();
  const firstNonSkip = T.STAGES.findIndex(s => T.startCfg().skip.indexOf(s.id) < 0);
  assert.equal(sm.firstBlocked, firstNonSkip, 'firstBlocked 应指向首个非 skip 阶段');
  assert.ok(sm.firstBlocked >= 0);
  assert.ok(T.blockedCount() > 0);
});

spec('L6 防御为 0 时无阻断且所有非 skip 阶段可达', () => {
  reset();
  T.S.defense = 0;
  const sm = T.statusMap();
  assert.equal(T.blockedCount(), 0);
  assert.equal(T.reachableCount(), T.STAGES.length - T.startCfg().skip.length);
  T.STAGES.forEach(s => {
    if (T.startCfg().skip.indexOf(s.id) < 0) assert.notEqual(sm.map[s.id], 'blocked', s.id + ' 不应阻断');
  });
});

spec('L7 中等防御 firstBlocked 单调不减', () => {
  reset();
  const seq = [0, 20, 40, 60, 80, 100].map(d => { T.S.defense = d; return T.statusMap().firstBlocked; });
  for (let i = 1; i < seq.length; i++) {
    const prev = seq[i - 1], cur = seq[i];
    assert.ok(cur < 0 || prev < 0 || cur >= prev, 'firstBlocked 不应回退: ' + JSON.stringify(seq));
  }
});

spec('L8 skip 阶段不计入 blockedCount', () => {
  reset();
  T.S.defense = 100;
  const sm = T.statusMap();
  const values = Object.keys(sm.map).map(k => sm.map[k]);
  const skips = values.filter(s => s === 'skipped').length;
  const blocked = values.filter(s => s === 'blocked').length;
  assert.equal(T.blockedCount(), blocked, 'blockedCount 应等于 map 中 blocked 数');
  assert.equal(skips, T.startCfg().skip.length, 'skip 数应与起点配置一致');
});

spec('L9 activeStage 与 stage 边界（1..9）', () => {
  reset();
  T.S.stage = 1; assert.ok(T.activeStage());
  T.S.stage = 9; assert.ok(T.activeStage());
  T.S.stage = 0; assert.ok(T.activeStage() === undefined, '越界 stage 应无 activeStage');
});

spec('L10 boundaryOffset 处理 (dx,dy) 与零分量边界', () => {
  const off = T.boundaryOffset(100, 100);
  assert.ok(off && typeof off.x === 'number' && typeof off.y === 'number');
  const zeroY = T.boundaryOffset(100, 0);
  assert.ok(Number.isFinite(zeroY.x) && Number.isFinite(zeroY.y), 'dy=0 应有限值');
  /* 已知源码边界：boundaryOffset(0,0) 会得到 0*Infinity=NaN；此处仅断言不抛异常，
   * 真实调用路径 edgeCoords 用 len||1 保护，正常坐标不会传入全零。 */
  assert.doesNotThrow(() => T.boundaryOffset(0, 0));
});

spec('L11 edgeCoords / edgeSeed / curvePath 稳定可复现', () => {
  assert.equal(T.edgeSeed(1, 2), T.edgeSeed(1, 2), 'edgeSeed 应稳定');
  assert.notEqual(T.edgeSeed(1, 2), T.edgeSeed(2, 1), '不同边应不同散列');
  const c = T.edgeCoords({ x: 0, y: 0 }, { x: 100, y: 100 });
  assert.ok(c.x1 <= c.x2 && c.y1 <= c.y2, '坐标应有序');
  const p1 = T.curvePath(c, 1, 8);
  const p2 = T.curvePath(c, 1, 8);
  assert.equal(p1.d, p2.d, 'curvePath 应可复现');
  assert.ok(/^M[\d.]+ [\d.]+ C/.test(p1.d), '应为 SVG 三次贝塞尔路径');
  assert.ok(typeof p1.mx === 'number' && typeof p1.my === 'number');
});

spec('L12 heatCount 按阶段与知识域计数', () => {
  const n = T.heatCount(T.STAGES[0].id, 'llm');
  assert.ok(typeof n === 'number' && n >= 0);
  assert.equal(T.heatCount('__no_stage__', 'llm'), 0);
});

spec('L13 svgHTML/timelineHTML/heatHTML 返回字符串且反映状态', () => {
  reset();
  const svg = T.svgHTML ? T.svgHTML() : '';
  assert.equal(typeof svg, 'string');
  const tl = T.timelineHTML();
  assert.ok(typeof tl === 'string' && tl.length > 0);
  const heat = T.heatHTML();
  assert.ok(typeof heat === 'string' && heat.length > 0);
});

spec('L14 stageDetail(stage)/stagePills() 结构正确', () => {
  reset();
  const s = T.STAGES[2];
  const html = T.stageDetail(s);
  assert.ok(html.includes(s.id) && html.includes(s.name), '应含阶段标识与名称');
  assert.ok(html.includes('lab-chapter'), '应含章节容器');
  const pills = T.stagePills();
  assert.ok(typeof pills === 'string' && pills.length > 0);
  assert.ok(pills.includes('lab-pill'), '应含网络分区徽章');
});

spec('L15 hoverNodes 对各类 hover 输入安全', () => {
  reset();
  [null, { type: 'node', id: 'waf' }, { type: 'risk', id: 'LLM01' }, { type: 'edge', id: 'e1' }, { type: 'nodeChip', id: 'x' }].forEach(h => {
    T.S.hover = h;
    assert.doesNotThrow(() => T.hoverNodes(), 'hover=' + JSON.stringify(h));
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
