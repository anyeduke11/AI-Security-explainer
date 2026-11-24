/* 从 new-risks.json 把丰富后的描述定点更新到 data.js 的 92 条风险（不重建文件） */
import fs from 'node:fs';
const risks = JSON.parse(fs.readFileSync('new-risks.json', 'utf8'));
const path = '../assets/js/data.js';
let src = fs.readFileSync(path, 'utf8');
const J = (s) => JSON.stringify(s);
let done = 0;
const miss = [];

for (const r of risks) {
  const token = 'R(' + J(r.code);
  const start = src.indexOf(token);
  if (start < 0) { miss.push(r.code); continue; }

  // 逐字符扫出完整 R(...) 调用，返回结束位置（不含）与参数数组
  let i = start + 2, depth = 0, inStr = false, esc = false, cur = '';
  const args = [];
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      cur += ch;
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; cur += ch; continue; }
    if (ch === '[' || ch === '{' || ch === '(') { depth++; cur += ch; continue; }
    if (ch === ']' || ch === '}' || ch === ')') {
      if (depth === 0 && ch === ')') { args.push(cur.trim()); break; }
      depth--; cur += ch; continue;
    }
    if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  const end = i + 1;
  if (args.length < 15) { miss.push(r.code + '(args=' + args.length + ')'); continue; }

  args[6] = J(r.brief);
  args[7] = J(r.why);
  args[8] = '[' + r.steps.map(J).join(', ') + ']';
  args[9] = J(r.analogy);
  args[11] = '[' + r.defense.map(J).join(', ') + ']';
  args[12] = J(r.scenario);
  args[13] = '[' + r.quiz.map((x) => Array.isArray(x) ? '[' + x.map(J).join(', ') + ']' : J(x)).join(', ') + ']';
  args[14] = J(r.basis);

  const newBlock = 'R(' + args.join(', ') + ')';
  src = src.slice(0, start) + newBlock + src.slice(end);
  done++;
}

fs.writeFileSync(path, src);
console.log('更新风险:', done, '失败:', miss.length, miss.slice(0, 10).join(', '));
