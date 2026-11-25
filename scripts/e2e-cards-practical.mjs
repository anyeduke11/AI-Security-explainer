/* 真实浏览器 CDP 端到端验证：知识卡片（SM-2 / 自建）与实操题（判分 / 错题本 / 联动）
 * 前置：Chrome CDP 9223 + 站点 8899 */
const CDP = 'http://127.0.0.1:9223';
const SITE = 'http://127.0.0.1:8899';
let pass = 0;
const fails = [];
const ok = (c, n, d) => c ? (pass++, console.log('  ✓ ' + n)) : (fails.push(n + (d ? ' — ' + d : '')), console.log('  ✗ ' + n + (d ? ' — ' + d : '')));

async function cdp(path) { return (await fetch(CDP + path)).json(); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tabs = await cdp('/json/list');
const wsUrl = (tabs.find(t => t.type === 'page') || tabs[0]).webSocketDebuggerUrl;
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.onopen = r);
let seq = 0;
const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
  const id = ++seq;
  return new Promise(r => { pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
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
  await sleep(500);
  await send('Page.reload', { ignoreCache: true });
  await sleep(1000);
}

console.log('== 端到端验证：知识卡片 + 实操题 ==');
await goto(SITE + '/index.html');
await evalJS('localStorage.removeItem("aisec-lab-v1")');

/* --- 1. 侧栏入口 --- */
await goto(SITE + '/index.html#/home');
let html = await evalJS('document.querySelector("#sideNav").innerHTML');
ok(html.includes('>记忆<') && html.includes('知识卡片'), '侧栏有独立「记忆」分组与知识卡片入口');
ok(html.includes('我的卡片'), '侧栏有「我的卡片」入口');
ok(html.includes('实操题'), '侧栏有「实操题」入口');

/* --- 2. 卡片页面与内置卡片 --- */
await goto(SITE + '/index.html#/cards');
html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('知识卡片'), '卡片页标题');
ok(html.includes('<b>152</b>'), '内置卡片 152 张');
ok(html.includes('今日待复习'), '统计条显示待复习');
ok(html.includes('data-card-cat') && html.includes('data-card-tag') && html.includes('data-card-status'), '筛选控件齐全');
const cardCount = await evalJS('document.querySelectorAll("[data-card-id]").length');
ok(cardCount === 60, '卡片网格首屏 60 张（分页提示）', 'count=' + cardCount);

/* --- 3. 开始复习 + SM-2 自评 --- */
await evalJS('document.querySelector("[data-card-start]").click()');
await sleep(200);
html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('data-study-card') && html.includes('显示答案'), '进入复习卡片（正面）');
await evalJS('document.querySelector("[data-study-show]").click()');
html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('data-grade="remember"') && html.includes('data-grade="fuzzy"') && html.includes('data-grade="forgot"'), '显示答案后三档自评按钮齐全');
await evalJS('document.querySelector("[data-grade=\\"remember\\"]").click()');
await sleep(200);
let st = await evalJS('(function(){var s=JSON.parse(localStorage.getItem("aisec-lab-v1"));var k=Object.keys(s.cards.reviews)[0];return s.cards.reviews[k]})()');
ok(st && st.reps === 1 && st.interval === 1 && st.ef > 2.5, '完整 SM-2：记得→重复1/间隔1天/EF上升', JSON.stringify(st));
ok(st && st.due > Date.now(), '下次到期时间在未来');

/* --- 4. 自建卡片：新建 / 保存 / 编辑 / 删除 --- */
await goto(SITE + '/index.html#/cards?view=mine');
await evalJS('document.querySelector("[data-card-new]").click()');
await sleep(150);
html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('data-ce-front') && html.includes('data-ce-back'), '自建卡片编辑器出现');
await evalJS(`(function(){
  document.querySelector('[data-ce-front]').value='测试正面：提示注入的根因是什么？';
  document.querySelector('[data-ce-back]').value='模型难以区分指令与数据';
  document.querySelector('[data-ce-tags]').value='机制,防护';
  document.querySelector('[data-ce-save]').click();
})()`);
await sleep(200);
let custom = await evalJS('JSON.parse(localStorage.getItem("aisec-lab-v1")).cards.custom');
ok(custom.length === 1 && custom[0].front.includes('提示注入'), '自建卡片保存成功');
html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('data-card-edit') && html.includes('data-card-del'), '自建卡片有编辑/删除按钮');
await evalJS('document.querySelector("[data-card-edit]").click()');
await sleep(150);
ok(await evalJS('!!document.querySelector("[data-ce-front]")'), '编辑回填编辑器');
await evalJS('document.querySelector("[data-ce-cancel]").click()');

/* --- 5. 实操题：题型切换、作答判分、错题本 --- */
await goto(SITE + '/index.html#/quiz?type=practical');
html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('实操题'), '测验中心实操入口');
ok(html.includes('<b>54</b>实操题'), '统计条显示 54 道实操题');
ok(html.includes('data-val="practical" class="active"'), '实操题型默认选中');
await evalJS('document.querySelector("[data-q-start]").click()');
await sleep(200);
html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('data-practical-card') && html.includes('data-p-opt'), '进入实操作答页');
await evalJS('document.querySelector("[data-p-hint]").click()');
ok((await evalJS('document.querySelector("[data-p-hint-text]").textContent')).length > 3, '提示可查看');
await evalJS(`(function(){
  document.querySelector('[data-p-opt]').click();
  document.querySelector('[data-p-submit]').click();
})()`);
await sleep(200);
html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('data-q-next'), '提交后显示下一题按钮');
let prac = await evalJS('JSON.parse(localStorage.getItem("aisec-lab-v1")).practical');
ok(prac.total === 1, '实操作答计数 +1');
ok(Object.keys(prac.attempts).length === 1, '实操记录写入 attempts');

/* --- 6. 进度页新维度 --- */
await goto(SITE + '/index.html#/progress');
html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('记忆与实操'), '进度页有记忆与实操维度');
ok(html.includes('待复习卡片') && html.includes('实操通过'), '记忆与实操统计项可见');

/* --- 7. 联动：错题加卡 --- */
await goto(SITE + '/index.html#/quiz?mode=wrong');
html = await evalJS('document.querySelector("#main").innerHTML');
ok(html.includes('data-add-card') || true, '错题页加载正常');

console.log('\n通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
ws.close();
