/* TDD 持久化与消息通信测试：localStorage 隔离、迁移、导出、跨 iframe 记账。
 * 运行：node tests/persistence.test.mjs */
const BASE = 'http://127.0.0.1:9222', SITE = 'http://127.0.0.1:8899/';
async function cdp(ws, method, params = {}) {
  const id = ++cdp.i;
  return new Promise(res => { const h = e => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener('message', h); res(m); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method, params })); });
}
cdp.i = 0;
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('PASS  ' + n); } else { fail++; failures.push(n + ' — ' + d); console.log('FAIL  ' + n + '  → ' + d); } };

const tab = await (await fetch(BASE + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
const exc = { n: 0 };
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') exc.n++; });
await cdp(ws, 'Runtime.enable'); await cdp(ws, 'Page.enable'); await cdp(ws, 'Network.enable');
await cdp(ws, 'Network.setCacheDisabled', { cacheDisabled: true });
await cdp(ws, 'Page.navigate', { url: SITE + '#/home' });
await new Promise(r => setTimeout(r, 1500));
const ev = async x => { const m = await cdp(ws, 'Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); const d = m.result && m.result.exceptionDetails; if (d) return { __err: (d.exception && d.exception.description || d.text).slice(0, 140) }; return m.result && m.result.result ? m.result.result.value : undefined; };
const goto = async h => { await ev(`location.hash='${h}'`); await new Promise(r => setTimeout(r, 400)); };

/* M1：刷新后进度保持 */
await goto('#/risk/LLM01');
await ev(`(function(){var b=document.querySelector('[data-read-btn]');if(b)b.click()})()`);
await new Promise(r => setTimeout(r, 200));
await cdp(ws, 'Page.reload'); await new Promise(r => setTimeout(r, 1500));
check('M1 刷新后已读状态仍然保持', await ev(`!!JSON.parse(localStorage.getItem('aisec-lab-v1')).read.LLM01`) === true);

/* M2：旧编号迁移 */
await ev(`localStorage.setItem('aisec-lab-v1', JSON.stringify({read:{MCP1:1},visited:{},mini:{},theme:'light',quiz:{total:0,right:0,wrong:{}}}))`);
await cdp(ws, 'Page.reload'); await new Promise(r => setTimeout(r, 1400));
const migrated = await ev(`JSON.parse(localStorage.getItem('aisec-lab-v1'))`);
check('M2 旧编号 MCP1 自动迁移为 MCP01', !!(migrated && migrated.read && migrated.read.MCP01), JSON.stringify(migrated && migrated.read));

/* M3：清空进度需同步到所有视图 */
await goto('#/progress');
await ev(`(function(){var b=document.querySelector('[data-clear]');if(b)b.click()})()`);
await new Promise(r => setTimeout(r, 400));
const afterClear = await ev(`JSON.parse(localStorage.getItem('aisec-lab-v1'))`);
check('M3 清空进度后持久化状态归零', afterClear && Object.keys(afterClear.read || {}).length === 0, JSON.stringify(afterClear && afterClear.read));

/* M4：父页应校验 iframe 消息来源 origin */
const app = (await import('node:fs')).readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
const msgBlock = app.slice(app.indexOf("addEventListener('message'"), app.indexOf("addEventListener('hashchange'"));
check('M4 postMessage 应校验来源 origin（当前为 '*'）', /event\.origin/.test(msgBlock) && !/\*/.test(msgBlock.slice(0, 200)), msgBlock.slice(0, 160).replace(/\s+/g, ' '));

/* M5：独立 Transformer 页与父页进度应口径一致 */
const tx = (await import('node:fs')).readFileSync(new URL('../demos/transformer-attack-explainer.html', import.meta.url), 'utf8');
const standalone = tx.slice(tx.indexOf('function syncProgress'), tx.indexOf('function syncProgress') + 900);
check('M5 独立页答题应同步 quiz.total/right 到主进度', /quiz\.total/.test(standalone), '独立页未累加测验统计');

/* M6：导出内容应包含全部进度字段 */
await goto('#/progress');
const hasExport = await ev(`!!document.querySelector('[data-export]')`);
check('M6 进度页提供导出入口', hasExport === true, 'has=' + hasExport);

check('M-runtime 测试期间无运行时异常', exc.n === 0, 'exceptions=' + exc.n);
console.log('\n=== 汇总 ===');
console.log('PASS=' + pass + '  FAIL=' + fail);
if (failures.length) { console.log('\n不符合项：'); failures.forEach((f, i) => console.log((i + 1) + '. ' + f)); }
await cdp(ws, 'Page.close');
process.exit(fail || exc.n ? 1 : 0);
