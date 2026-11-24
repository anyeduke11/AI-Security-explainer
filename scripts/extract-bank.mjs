// 从原始题库 HTML 中提取 BANK JSON（大括号平衡扫描，跳过字符串与转义）
// 用法：node extract-bank.mjs <源HTML路径>；源文件不随仓库分发
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'source-bank.html');
if (!fs.existsSync(SRC)) {
  console.error('未找到源题库文件。请通过参数指定：node extract-bank.mjs <源HTML路径>');
  process.exit(1);
}
const html = fs.readFileSync(SRC, 'utf8');

const key = 'const BANK = ';
const start = html.indexOf(key);
if (start < 0) { console.error('未找到 BANK'); process.exit(1); }
let i = start + key.length;
// 跳过空白
while (i < html.length && /\s/.test(html[i])) i++;
if (html[i] !== '{') { console.error('BANK 不是对象'); process.exit(1); }

// 平衡扫描：跳过字符串、处理转义
let depth = 0, inStr = false, esc = false;
const begin = i;
for (; i < html.length; i++) {
  const c = html[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (c === '"') inStr = false;
    continue;
  }
  if (c === '"') { inStr = true; continue; }
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
}
const json = html.slice(begin, i);
const BANK = JSON.parse(json);
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'bank.raw.json'), JSON.stringify(BANK, null, 2));

// 输出结构摘要
let total = 0, diffCnt = {}, optLen = [];
for (const ch of BANK.chapters) {
  console.log(`章 ${ch.chapter} 《${ch.title}》 题数=${ch.questions.length} 来源=${ch.source}`);
  for (const q of ch.questions) {
    total++;
    diffCnt[q.difficulty] = (diffCnt[q.difficulty] || 0) + 1;
    optLen.push(q.options.length);
  }
}
console.log('总题数:', total);
console.log('难度分布:', diffCnt);
console.log('选项数分布:', optLen.reduce((a, n) => (a[n] = (a[n] || 0) + 1, a), {}));

// 答案字母分布
const ansCnt = {};
for (const ch of BANK.chapters) for (const q of ch.questions) ansCnt[q.answer] = (ansCnt[q.answer] || 0) + 1;
console.log('答案字母分布:', ansCnt);

// 题干结尾模式统计（前 2 字）
const tail = {};
for (const ch of BANK.chapters) for (const q of ch.questions) {
  const t = q.text.replace(/[？?]$/, '');
  const k = t.slice(-2);
  tail[k] = (tail[k] || 0) + 1;
}
console.log('题干结尾(去问号后2字) Top10:', Object.entries(tail).sort((a, b) => b[1] - a[1]).slice(0, 10));
