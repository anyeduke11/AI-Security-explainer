/* 真实浏览器 CDP 端到端验证：统一「AI安全题库」按九大知识域筛选→抽题→判分→错题本 */
const CDP = 'http://127.0.0.1:9223';
const SITE = 'http://127.0.0.1:8899';
let pass = 0;
const fails = [];
const ok = (c, n, d) => c ? (pass++, console.log('  ✓ ' + n)) : (fails.push(n + (d ? ' — ' + d : '')), console.log('  ✗ ' + n + (d ? ' — ' + d : '')));

async function cdp(path) { return (await fetch(CDP + path)).json(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tabs = await cdp('/json/list');
const wsUrl = (tabs.find((t) => t.type === 'page') || tabs[0]).webSocketDebuggerUrl;
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.onopen = r);
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((r) => { pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
}
async function goto(url) {
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url });
  await sleep(600);
  await send('Page.reload', { ignoreCache: true });
  await sleep(1200);
}

console.log('== 端到端验证：统一 AI安全题库（九大知识域）==');
await goto(SITE + '/index.html');
await evalJS('localStorage.removeItem("aisec-lab-v1")');
await goto(SITE + '/index.html#/quiz');
await sleep(400);

/* 1. 统一题库页面：标题、总数、六域分类 */
let html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('AI安全题库共'), '页面标题为 AI安全题库');
ok(!/cisp/i.test(html), '页面无 CISP 字眼');
ok(html.includes('<b>785</b>'), '总题数显示 785');
ok(html.includes('题库总题数') && html.includes('<b>785</b>题库总题数'), '统计条显示总题数 785');
ok(!html.includes('data-q-source'), '来源切换控件已移除');
ok(html.includes('全部知识域（785）'), '全部知识域选项标注总数');
ok(html.includes('当前筛选可选'), '筛选区显示可选数量');

/* 2. 分类下拉只有 6 个知识域选项 */
const cats = await evalJS(`(function(){
  return Array.from(document.querySelectorAll('[data-q-cat] option')).map(o=>({v:o.value,t:o.textContent}));
})()`);
ok(cats.length === 10, '分类下拉 1 全部 + 6 知识域', 'count=' + cats.length);
const expectDomains = 'llm,mcp,agent,skills,web,infra,foundation,society,governance';
ok(cats.slice(1).map((c) => c.v).join(',') === expectDomains, '九个知识域齐全且顺序一致', cats.slice(1).map((c) => c.v).join(','));

/* 3. 选择 LLM 知识域，开始测验 */
const llmCount = await evalJS(`(function(){
  var o=Array.from(document.querySelectorAll('[data-q-cat] option')).find(x=>x.value==='llm');
  return o.textContent;
})()`);
ok(/\d+/.test(llmCount), 'LLM 知识域标注题数', llmCount);
await evalJS(`
  var sel = document.querySelector('[data-q-cat]');
  sel.value = 'llm';
  document.querySelector('[data-q-start]').click();
`);
await sleep(300);
html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('data-quiz-card'), '进入答题页');
ok(/第 1 \/ 5 题/.test(html), '抽题数量为 5');
ok(/LLM 应用/.test(html), '显示知识域标签');

/* 4. 故意选错，验证判分与错题本（题号可能为 Q### 扩展题或内置风险码） */
const qcode = await evalJS(`(function(){
  var t=document.querySelector('.quiz-progress span:last-child').textContent;
  return (t.match(/\\b(?:Q\\d{3}|LLM\\d{2}|MCP\\d{2}|ASI\\d{2}|AST\\d{2}|A\\d{2}|INF\\d{2}|FND\\d{2}|SOC\\d{2}|GOV\\d{2})\\b/)||[])[0];
})()`);
ok(!!qcode, '题目有合法编号', qcode);
const correctIdx = await evalJS(`(function(){
  var m=(document.querySelector('.quiz-progress span:last-child').textContent.match(/\\b[A-Z]+\\d{2,3}\\b/)||[])[0];
  var d=window.AISEC.data, q=d.RISK_MAP[m]||window.AISEC.aiBank.byCode[m];
  return q ? q.quiz.a : 0;
})()`);
const wrongIdx = (correctIdx + 1) % 4;
await evalJS(`document.querySelector('[data-q-opt="${wrongIdx}"]').click()`);
await sleep(200);
html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('回答正确') || html.includes('回答错误'), '显示判分反馈');
const st = await evalJS('JSON.parse(localStorage.getItem("aisec-lab-v1")).quiz');
ok(st.total === 1, '累计答题数 +1', 'total=' + st.total);
ok(!!st.wrong[qcode], '错题本记录当前题号', JSON.stringify(st.wrong));

/* 5. 全部知识域模式：验证能抽满 20 题，题库数为 152+633=785 */
await evalJS('location.hash = "#/quiz?cat=all&level=all&count=20&mode=normal"');
await sleep(400);
await evalJS('document.querySelector("[data-q-start]") && document.querySelector("[data-q-start]").click()');
await sleep(200);
html = await evalJS('document.querySelector("#main").innerHTML');
ok(/第 1 \/ 20 题/.test(html), '全部知识域模式抽题数为 20');
const bankInfo = await evalJS(`(function(){
  return {risk:Object.keys(window.AISEC.data.RISK_MAP).length, ext:window.AISEC.aiBank.list.length};
})()`);
ok(bankInfo.risk === 152 && bankInfo.ext === 633, '题库合并为 152+633=785', JSON.stringify(bankInfo));

console.log('\n通过：' + pass + ' 项');
if (fails.length) {
  console.log('失败 ' + fails.length + ' 项：');
  fails.forEach((f) => console.log('  - ' + f));
  ws.close();
  process.exit(1);
}
console.log('端到端验证全部通过');
ws.close();
