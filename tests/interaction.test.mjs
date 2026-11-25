/* TDD 交互层模拟测试：在真实浏览器中模拟用户操作，验证 AI 安全学习流程的可用性与可理解性。
 * 运行：node tests/interaction.test.mjs（需先启动 http://127.0.0.1:8899 与 CDP 9222） */
const BASE = 'http://127.0.0.1:9222';
const SITE = 'http://127.0.0.1:8899/';

async function cdp(ws, method, params = {}) {
  const id = ++cdp.i;
  return new Promise(res => {
    const h = e => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener('message', h); res(m); } };
    ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method, params }));
  });
}
cdp.i = 0;

let pass = 0, fail = 0; const failures = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; failures.push({ name, detail }); console.log('FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}

const tab = await (await fetch(BASE + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
const exc = { n: 0 };
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') exc.n++; });
await cdp(ws, 'Runtime.enable'); await cdp(ws, 'Page.enable'); await cdp(ws, 'Network.enable');
await cdp(ws, 'Network.setCacheDisabled', { cacheDisabled: true });
await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp(ws, 'Page.navigate', { url: SITE + '#/home' });
await new Promise(r => setTimeout(r, 1600));

const ev = async x => {
  const m = await cdp(ws, 'Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  const d = m.result && m.result.exceptionDetails;
  if (d) return { __err: (d.exception && d.exception.description || d.text).slice(0, 160) };
  return m.result && m.result.result ? m.result.result.value : undefined;
};
const goto = async h => { await ev(`location.hash='${h}'`); await new Promise(r => setTimeout(r, 450)); };
const click = async s => { await ev(`(function(){var n=document.querySelector(${JSON.stringify(s)});if(!n)return;n.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));})()`); await new Promise(r => setTimeout(r, 220)); };
const text = async s => ev(`(function(){var n=document.querySelector(${JSON.stringify(s)});return n?n.textContent.trim():''})()`);
const count = async s => ev(`document.querySelectorAll(${JSON.stringify(s)}).length`);

/* ---------- G. 首页 → 分类 → 风险详情 → 进度（学习闭环） ---------- */
check('G1 首页展示九类入口与九阶段快捷', await count('.cat-card') === 9 && await count('a[href^="#/lab?stage="]') >= 9,
  'cat=' + await count('.cat-card') + ' stage-links=' + await count('a[href^="#/lab?stage="]'));

await goto('#/cat/llm');
const catTitle = await text('h1');
const catRows = await count('.cat-row');
check('G2 分类页标题与该域全部风险列表', /LLM/.test(catTitle || '') && catRows >= 10, 'title=' + catTitle + ' rows=' + catRows);

await goto('#/risk/LLM01');
const sections = await count('[id^="sec-"]');
const hasDemo = await ev(`!!document.querySelector('[data-demo-host] svg, [data-demo-host] canvas')`);
check('G3 风险详情七段式结构 + 演示挂载', sections >= 7 && hasDemo, 'sections=' + sections + ' demo=' + hasDemo);

await click('[data-read-btn]');
const readStored = await ev(`JSON.parse(localStorage.getItem('aisec-lab-v1')).read.LLM01 > 0`);
check('G4 标记已读后写入 localStorage', readStored === true, 'stored=' + readStored);

await goto('#/progress');
const progressText = await text('body');
check('G5 进度页反映已学 1 条', /1\s*\/\s*152|1条|已学.*1/.test(progressText || ''), (progressText || '').slice(0, 90));

await goto('#/path');
const nextLink = await ev(`(function(){var n=document.querySelector('a.path-link');return n?n.getAttribute('href'):''})()`);
check('G6 学习路径“继续下一步”指向未完成风险', /^#\/risk\//.test(nextLink || ''), 'href=' + nextLink);

/* ---------- H. 测验流程与 query 回填 ---------- */
await goto('#/quiz?cat=llm&level=2&count=3&mode=wrong');
const qState = await ev(`(function(){var cats=document.querySelector('[data-q-cat]'),cts=document.querySelector('[data-q-count]'),mode=document.querySelector('[data-q-mode] .active');return {cat:cats?cats.value:'',count:cts?cts.value:'',mode:mode?mode.dataset.val:''}})()`);
check('H1 测验设置应回填 cat/level/count/mode query', qState.cat === 'llm' && qState.count === '3' && qState.mode === 'wrong', JSON.stringify(qState));

await click('[data-q-start]');
const qOptCount = await count('[data-q-opt]');
check('H2 开始测验后展示选项', qOptCount >= 2, 'options=' + qOptCount);
if (qOptCount) {
  await click('[data-q-opt="0"]');
  const fb = await text('[data-q-feedback]');
  check('H3 答题后给出对错反馈与解析', (fb || '').length > 4, 'feedback=' + (fb || '').slice(0, 50));
}

/* ---------- I. 攻击路径实验室流程 ---------- */
await goto('#/lab');
check('I1 拓扑 9 阶段按钮 + 26 条攻击边 + 9 个徽章',
  await count('[data-stepn]') === 9 && await count('path.lab-edge') === 26 && await count('.lab-badge') === 9,
  'step=' + await count('[data-stepn]') + ' edge=' + await count('path.lab-edge'));

await click('[data-stepn="S5"]');
check('I2 点击阶段按钮同步状态与讲解标题',
  await ev(`AISEC.lab.state.stage`) === 5 && /S5/.test(await text('[data-fold-title]') || ''),
  'stage=' + await ev(`AISEC.lab.state.stage`));

await ev(`(function(){var r=document.querySelector('[data-lab-range="defense"]');r.value=100;r.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await new Promise(r => setTimeout(r, 200));
const blocked = await count('.lab-edge.e-blocked');
const allEdges = await count('path.lab-edge');
check('I3 防御拉满后仍保留完整链路', blocked > 0 && allEdges === 26, 'blocked=' + blocked + ' total=' + allEdges);
check('I4 被拦截提示文案准确', !/全部可到达/.test(await text('[data-viz-sub]') || ''), 'sub=' + await text('[data-viz-sub]'));

await ev(`(function(){var r=document.querySelector('[data-lab-range="stage"]');r.value=9;r.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await new Promise(r => setTimeout(r, 220));
check('I5 越过被拦截阶段时给出明确提示', await count('#toast.show') > 0 || /拦截|blocked/.test(await text('[data-viz-foot]') || ''), '无提示');

await goto('#/lab?view=foo');
const activeView = await count('[data-lab-seg="view"] button.active');
check('I6 非法 view query 不应导致视角 tab 全不亮', activeView === 1, 'active=' + activeView);

/* ---------- J. 搜索与术语可理解性 ---------- */
await goto('#/home');
await ev(`(function(){var i=document.querySelector('#globalSearch');i.value='提示注入';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await new Promise(r => setTimeout(r, 250));
check('J1 搜索框实时给出风险/术语结果', await count('#searchPanel .search-result') > 0 || await count('#searchPanel .gl-hit') > 0,
  'results=' + await count('#searchPanel .search-result'));
await goto('#/search?q=%E6%8F%90%E7%A4%BA%E6%B3%A8%E5%85%A5');
check('J2 搜索结果页有条目且可跳转风险', await count('.search-page-item') > 0, 'items=' + await count('.search-page-item'));

/* ---------- K. 主题、侧栏可理解性 ---------- */
const themeBefore = await ev(`document.documentElement.dataset.theme`);
await click('#themeBtn');
const themeAfter = await ev(`document.documentElement.dataset.theme`);
check('K1 主题切换生效并写入存储', themeBefore !== themeAfter && await ev(`JSON.parse(localStorage.getItem('aisec-lab-v1')).theme`) === themeAfter,
  themeBefore + '→' + themeAfter);

await goto('#/lab?view=heat');
const heatActive = await ev(`(function(){var n=[...document.querySelectorAll('#sideNav .nav-link')].find(x=>x.getAttribute('href')==='#/lab?view=heat');return n?n.classList.contains('active'):null})()`);
check('K2 侧栏“风险热度矩阵”应随当前视图高亮', heatActive === true, 'active=' + heatActive);

/* ---------- L. 界面可用性（多视口无横向溢出） ---------- */
for (const [w, h, mobile] of [[1400, 900, false], [768, 1024, false], [390, 844, true]]) {
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await new Promise(r => setTimeout(r, 250));
  const over = await ev(`document.documentElement.scrollWidth - window.innerWidth`);
  check('L' + w + ' ' + w + 'px 视口无横向溢出', over <= 1, 'overflow=' + over);
}
check('L-runtime 测试期间无运行时异常', exc.n === 0, 'exceptions=' + exc.n);

console.log('\n=== 汇总 ===');
console.log('PASS=' + pass + '  FAIL=' + fail + '  运行时异常=' + exc.n);
if (failures.length) { console.log('\n不符合项：'); failures.forEach((f, i) => console.log((i + 1) + '. ' + f.name + ' — ' + f.detail)); }
await cdp(ws, 'Page.close');
process.exit(fail || exc.n ? 1 : 0);
