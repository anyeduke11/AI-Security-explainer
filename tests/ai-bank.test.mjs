/* AI安全题库 TDD：数据等价性 / 去重 / 答案一致性 / 难度与知识域一致性 / 接入接线 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const raw = JSON.parse(read('scripts/bank.raw.json'));
const tr = JSON.parse(read('scripts/bank.transformed.json'));
const SYN = (await import('../scripts/synonyms.mjs')).SYN;

let pass = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) pass++;
  else fails.push(name + (detail ? ' — ' + detail : ''));
}
function syn(t) {
  const slots = {}; let n = 0; let out = t;
  for (const [re, rep] of SYN) out = out.replace(re, (m) => { const k = '\u0000' + (n++) + '\u0000'; slots[k] = rep; return k; });
  for (let i = 0; i < 3; i++) out = out.replace(/\u0000(\d+)\u0000/g, (m) => slots[m] !== undefined ? slots[m] : m);
  return out;
}
const norm = (t) => String(t).replace(/[？?，。、；：！!“”"'（）()\s]/g, '');

/* 1. 数据完整性 */
ok(raw.chapters.length === 5, '原题 5 章');
ok(tr.chapters.length === 5, '变体 5 章');
let rawN = 0, trN = 0;
for (let i = 0; i < 5; i++) {
  rawN += raw.chapters[i].questions.length;
  trN += tr.chapters[i].questions.length;
  ok(raw.chapters[i].chapter === tr.chapters[i].chapter, '第 ' + (i + 1) + ' 章编号一致');
  ok(raw.chapters[i].questions.length === tr.chapters[i].questions.length, '第 ' + (i + 1) + ' 章题数一致');
}
ok(rawN === 500 && trN === 500, '原题与变体各 500 题', rawN + '/' + trN);

/* 2. 答案正确性：变体答案选项 === 原题答案选项的同义替换 */
let ansOK = 0, ansBad = 0;
for (let ci = 0; ci < 5; ci++) {
  const rc = raw.chapters[ci], tc = tr.chapters[ci];
  for (let qi = 0; qi < rc.questions.length; qi++) {
    const q = rc.questions[qi], t = tc.questions[qi];
    const oi = q.answer.charCodeAt(0) - 65;
    const ai = t.answer.charCodeAt(0) - 65;
    if (norm(syn(q.options[oi])) === norm(t.options[ai])) ansOK++;
    else { ansBad++; if (ansBad <= 3) fails.push('答案不符 ch' + rc.chapter + '#' + q.n + ': ' + q.text.slice(0, 18)); }
  }
}
ok(ansBad === 0, '500 题答案语义等价', 'ok=' + ansOK + ' bad=' + ansBad);

/* 3. 去重：题干互不重复，且与原题不同 */
let seen = new Set(), dup = 0, sameAsRaw = 0;
for (let ci = 0; ci < 5; ci++) {
  const rc = raw.chapters[ci], tc = tr.chapters[ci];
  for (let qi = 0; qi < rc.questions.length; qi++) {
    const n = norm(tc.questions[qi].text);
    if (seen.has(n)) dup++; seen.add(n);
    if (n === norm(rc.questions[qi].text)) sameAsRaw++;
  }
}
ok(dup === 0, '变体题干互不重复', 'dup=' + dup);
ok(sameAsRaw === 0, '变体题干与原题不同', 'same=' + sameAsRaw);

/* 4. 难度与知识点一致性：难度不变、章节不变 */
let diffBad = 0;
for (let ci = 0; ci < 5; ci++) {
  const rc = raw.chapters[ci], tc = tr.chapters[ci];
  for (let qi = 0; qi < rc.questions.length; qi++) {
    if (rc.questions[qi].difficulty !== tc.questions[qi].difficulty) diffBad++;
  }
}
ok(diffBad === 0, '难度层级 100% 一致', 'bad=' + diffBad);

/* 5. 选项随机化：答案索引合法、选项无重复、确实发生重排 */
let idxBad = 0, optDup = 0, reordered = 0;
for (let ci = 0; ci < 5; ci++) {
  const rc = raw.chapters[ci], tc = tr.chapters[ci];
  for (let qi = 0; qi < rc.questions.length; qi++) {
    const q = rc.questions[qi], t = tc.questions[qi];
    const ai = t.answer.charCodeAt(0) - 65;
    if (t.answer.length !== 1 || ai < 0 || ai >= t.options.length) idxBad++;
    const ns = new Set(t.options.map(norm));
    if (ns.size !== t.options.length) optDup++;
    if (norm(q.options[0]) !== norm(t.options[0])) reordered++;
  }
}
ok(idxBad === 0, '答案索引全部合法', 'bad=' + idxBad);
ok(optDup === 0, '选项无重复', 'dup=' + optDup);
ok(reordered > 300, '选项顺序已随机化', 'reordered=' + reordered);

/* 6. 叠词瑕疵清零 */
let dupWord = 0;
const badWords = ['匿名化化', '身份身份认证', '信息数据数据', '内容内容'];
for (const c of tr.chapters) for (const q of c.questions) {
  for (const s of [q.text, ...q.options]) for (const w of badWords) if (s.includes(w)) dupWord++;
}
ok(dupWord === 0, '无叠词瑕疵', 'count=' + dupWord);

/* 7. 前端数据模块可用：在 vm 中加载，校验导出结构 */
const ns = {}; ns.window = ns;
const ctx = vm.createContext(ns);
vm.runInContext(read('assets/js/ai-bank.js'), ctx);
const bank = ns.AISEC.aiBank;
ok(!!bank && Array.isArray(bank.list) && bank.list.length === 633, 'ai-bank.js 导出 633 题', bank && bank.list.length);
ok(bank.domains.length === 9, 'ai-bank.js 导出 9 大知识域');
ok(Object.keys(bank.byCode).length === 633, 'byCode 索引 633 条');
ok(bank.list.every((q) => /^Q\d{3}$/.test(q.code)), '题号格式 Q{3位序号}');
ok(bank.list.every((q) => q.quiz.o.length === 4 && q.quiz.a >= 0 && q.quiz.a < 4), '每题 4 选项、答案索引合法');
ok(bank.list.every((q) => [1, 2, 3].includes(q.level)), '难度映射为 1/2/3');
const DOMAIN_IDS = ['foundation', 'llm', 'mcp', 'agent', 'skills', 'web', 'infra', 'society', 'governance'];
ok(bank.list.every((q) => DOMAIN_IDS.includes(q.cat)), '每题归入九大知识域之一');
ok(DOMAIN_IDS.every((id) => bank.list.filter((q) => q.cat === id).length >= 30), '每域至少 30 题');

/* 8. 接入接线：app.js 统一题库改造存在 */
const app = read('assets/js/app.js');
ok(app.includes('var AIBANK = NS.aiBank'), 'app.js 引用 aiBank');
ok(app.includes('var ALL_BANK = (function ()'), 'app.js 构建统一题库 ALL_BANK');
ok(app.includes('var list = RISKS.concat(AIBANK.list)'), 'ALL_BANK 合并两类题');
ok(!/cisp/i.test(app), 'app.js 无 CISP 字眼');
ok(!app.includes('data-q-source'), '已移除来源切换控件');
ok(app.includes('AI安全题库共'), '页面标题为 AI安全题库');
ok(!app.includes('optgroup'), '分类下拉为单层九域，无分组');
ok(app.includes('if (isSite) markRead(r.code, true)'), '扩展题不污染已学进度');
const html = read('index.html');
ok(html.indexOf('ai-bank.js') < html.indexOf('app.js'), 'index.html 加载顺序正确');
ok(!/cisp/i.test(html), 'index.html 无 CISP 字眼');

console.log('通过：' + pass + ' 项');
if (fails.length) {
  console.log('失败 ' + fails.length + ' 项:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('AI安全题库 TDD 全部通过');
