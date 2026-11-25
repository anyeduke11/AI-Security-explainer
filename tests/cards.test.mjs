/* TDD：知识卡片数据层与完整 SM-2 算法
 * 运行：node tests/cards.test.mjs */
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(ROOT + p, 'utf8');
const ctx = vm.createContext({ console, Date, Math, JSON });
ctx.window = ctx;
vm.runInContext(read('assets/js/data.js'), ctx);
vm.runInContext(read('assets/js/cards.js'), ctx);
const C = ctx.window.AISEC.cards;
const D = ctx.window.AISEC.data;

let pass = 0, fail = 0;
function spec(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '  → ' + e.message); }
}

spec('C1 内置卡片覆盖每条风险（152 张）', () => {
  assert.equal(C.builtin.length, D.RISKS.length);
  const codes = new Set(C.builtin.map(c => c.code));
  D.RISKS.forEach(r => assert.ok(codes.has(r.code), r.code + ' 缺卡片'));
});

spec('C2 卡片字段齐全且标签在五类内', () => {
  C.builtin.forEach(c => {
    ['id', 'code', 'cat', 'front', 'back', 'basis', 'tags'].forEach(k => assert.ok(c[k] !== undefined, c.id + ' 缺 ' + k));
    assert.ok(c.front.length > 4, c.id + ' front 太短');
    c.tags.forEach(t => assert.ok(C.TAGS.includes(t), c.id + ' 未知标签 ' + t));
  });
});

spec('C3 完整 SM-2：首次 1 天、第二次 6 天', () => {
  let s = C.sm2(C.blank(), 5, 0);
  assert.equal(s.interval, 1);
  assert.equal(s.reps, 1);
  s = C.sm2(s, 5, 86400000);
  assert.equal(s.interval, 6);
  assert.equal(s.reps, 2);
});

spec('C4 完整 SM-2：后续按 interval×EF 递进，EF 下限 1.3', () => {
  let s = C.blank();
  for (let i = 0; i < 8; i++) s = C.sm2(s, 5, i * 86400000);
  assert.ok(s.interval >= 6, '后续间隔应递增');
  assert.ok(s.ef >= 1.3);
  for (let i = 0; i < 30; i++) s = C.sm2(s, 0, (30 + i) * 86400000);
  assert.equal(s.ef, 1.3, 'EF 应收敛到下限 1.3');
});

spec('C5 完整 SM-2：q<3 重置重复次数并计遗忘', () => {
  let s = C.blank();
  s = C.sm2(s, 5, 0); s = C.sm2(s, 5, 86400000);
  const before = s.reps;
  s = C.sm2(s, 1, 2 * 86400000);
  assert.equal(s.reps, 0);
  assert.equal(s.lapses, 1);
  assert.equal(s.interval, 1);
  assert.ok(before >= 2);
});

spec('C6 三档自评映射与到期判定', () => {
  assert.equal(C.gradeOf('remember'), 5);
  assert.equal(C.gradeOf('fuzzy'), 3);
  assert.equal(C.gradeOf('forgot'), 1);
  assert.equal(C.isDue(undefined, 1000), true);
  assert.equal(C.isDue({ due: 500 }, 1000), true);
  assert.equal(C.isDue({ due: 5000 }, 1000), false);
});

spec('C7 自建卡片合并且排在前', () => {
  const custom = [{ id: 'CU-1', front: '自建问', back: '自建答' }];
  const list = C.all(custom);
  assert.equal(list.length, C.builtin.length + 1);
  assert.equal(list[0].id, 'CU-1');
  assert.equal(list[0].custom, true);
});

spec('C8 SM-2 历史记录有上限', () => {
  let s = C.blank();
  for (let i = 0; i < 50; i++) s = C.sm2(s, 4, i * 86400000);
  assert.equal(s.history.length, 30);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
