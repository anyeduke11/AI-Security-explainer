/* 通过 CDP 打开文档页面，滚动加载全部内容后导出纯文本
 * 用法：node fetch-feishu-doc.mjs <文档URL> [输出路径] */
const CDP = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9223';
const URL = process.argv[2];
const OUT = process.argv[3] || 'feishu-source.txt';
if (!URL) { console.error('用法：node fetch-feishu-doc.mjs <文档URL> [输出路径]'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tabs = await (await fetch(CDP + '/json/list')).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.onopen = r);
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((r) => {
  const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) return null;
  return r.result.result.value;
};

await send('Page.enable');
await send('Page.navigate', { url: URL });
await sleep(3500);
console.log('已打开文档，当前标题:', await ev('document.title'));

// 飞书文档容器：常见为 .bear-web-x-container 或 #root 内滚动区域
// 逐步滚动并采集可见文本，靠去重拼接全文
const seen = new Set();
const lines = [];
async function collect() {
  const txt = await ev(`(function(){
    var root=document.querySelector('.bear-web-x-container')||document.querySelector('#root')||document.body;
    return root.innerText||'';
  })()`);
  if (!txt) return;
  for (const ln of txt.split('\n')) {
    const s = ln.replace(/\\u200b/g, '').trim();
    if (s && !seen.has(s)) { seen.add(s); lines.push(s); }
  }
}
await collect();
let stable = 0;
for (let i = 0; i < 400; i++) {
  const before = lines.length;
  const pos = await ev(`(function(){
    var c=document.querySelector('.bear-web-x-container')||document.querySelector('#root')||document.scrollingElement;
    if(!c)return {top:0,h:0};
    var step=Math.max(300,c.clientHeight*0.6);
    if(c.scrollHeight>c.clientHeight) c.scrollTop=Math.min(c.scrollTop+step,c.scrollHeight);
    else window.scrollBy(0,step);
    return {top:c.scrollTop,h:c.scrollHeight};
  })()`);
  await sleep(450);
  await collect();
  if (lines.length === before) stable++; else stable = 0;
  if (pos && pos.top >= pos.h - 5 && lines.length === before) stable += 2;
  if (stable >= 18) { console.log('到达底部且连续无新增，停止于第'+i+'轮'); break; }
}
// 回滚到顶部再走一遍，捕捉懒加载遗漏
await ev(`(function(){var c=document.querySelector('.bear-web-x-container')||document.querySelector('#root')||document.scrollingElement;if(c)c.scrollTop=0;})()`);
await sleep(600);
for (let i = 0; i < 400; i++) {
  const before = lines.length;
  await ev(`(function(){
    var c=document.querySelector('.bear-web-x-container')||document.querySelector('#root')||document.scrollingElement;
    if(!c)return;var step=Math.max(300,c.clientHeight*0.6);
    if(c.scrollHeight>c.clientHeight) c.scrollTop=Math.min(c.scrollTop+step,c.scrollHeight);
    else window.scrollBy(0,step);
  })()`);
  await sleep(300);
  await collect();
  if (lines.length === before && i > 20) break;
}
console.log('采集行数:', lines.length);
const fs = await import('node:fs');
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log('已保存 ' + OUT);
ws.close();
