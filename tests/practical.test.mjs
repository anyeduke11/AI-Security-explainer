/* TDD：实操题数据完整性与本地判分器
 * 运行：node tests/practical.test.mjs */
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(ROOT + p, 'utf8');
const ctx = vm.createContext({ console, Date, Math, JSON });
ctx.window = ctx;
vm.runInContext(read('assets/js/data.js'), ctx);
vm.runInContext(read('assets/js/practical.js'), ctx);
const P = ctx.window.AISEC.practical;
const D = ctx.window.AISEC.data;

let pass = 0, fail = 0;
function spec(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '  → ' + e.message); }
}

spec('P1 实操题 54 道，九域每域 6 道', () => {
  assert.equal(P.total, 54);
  assert.equal(P.perCat.length, 9);
  P.perCat.forEach(x => assert.equal(x.n, 6, x.id + ' 不是 6 道'));
});

spec('P2 每题关联真实风险，编号唯一，引擎合法', () => {
  const codes = new Set();
  P.list.forEach(t => {
    assert.ok(!codes.has(t.code), t.code + ' 重复');
    codes.add(t.code);
    assert.ok(D.RISK_MAP[t.risk], t.code + ' 关联风险不存在: ' + t.risk);
    assert.equal(t.cat, D.RISK_MAP[t.risk].cat, t.code + ' 知识域与风险不一致');
    assert.ok(['config', 'steps', 'output'].includes(t.type), t.code + ' 题型非法');
    assert.ok(t.options.length >= 3, t.code + ' 选项不足');
    assert.ok(t.key.length >= 2, t.code + ' 关键项不足');
  });
});

spec('P3 关键项与禁用项不重叠，全部出现在选项中', () => {
  P.list.forEach(t => {
    const ids = t.options.map(o => o.id);
    t.key.forEach(k => assert.ok(ids.includes(k), t.code + ' 关键项不在选项: ' + k));
    t.forbidden.forEach(f => assert.ok(ids.includes(f), t.code + ' 禁用项不在选项: ' + f));
    t.forbidden.forEach(f => assert.ok(!t.key.includes(f), t.code + ' 禁用项是关键项: ' + f));
  });
});

spec('P4 全对得 100 分，含禁用项扣分', () => {
  const t = P.list[0];
  const full = P.score(t, { picked: t.key });
  assert.equal(full.score, 100);
  assert.equal(full.pass, true);
  assert.equal(full.master, true);
  const bad = P.score(t, { picked: t.key.concat(t.forbidden) });
  assert.ok(bad.score < 100, '禁用动作应扣分');
  assert.equal(bad.bad.length, t.forbidden.length);
});

spec('P5 全错不得分，顺序错误扣顺序分', () => {
  const t = P.list.find(x => x.type === 'steps');
  const zero = P.score(t, { picked: t.forbidden });
  assert.equal(zero.score, 0, '无命中应得 0 分');
  const rev = P.score(t, { picked: t.key.slice().reverse() });
  assert.ok(rev.rates.order < 100, '倒序应扣顺序分');
});

spec('P6 提示扣 10 分，漏选列出', () => {
  const t = P.list[0];
  const base = P.score(t, { picked: t.key });
  const hinted = P.score(t, { picked: t.key, hint: true });
  assert.equal(base.score - hinted.score, 10);
  const miss = P.score(t, { picked: t.key.slice(1) });
  assert.equal(miss.miss.length, 1);
});

spec('P7 判分不执行输入：选项是纯字符串', () => {
  P.list.forEach(t => {
    t.options.forEach(o => {
      assert.equal(typeof o.id, 'string');
      assert.equal(typeof o.label, 'string');
    });
  });
  const t = P.list[0];
  assert.equal(P.score(t, { picked: ['__proto__', 'constructor'] }).score, 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
