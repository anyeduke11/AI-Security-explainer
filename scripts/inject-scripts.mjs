/* 为新 92 条风险补充 SCRIPTS 教学剧本最小可用模板 */
import fs from 'node:fs';
const DATA = '../assets/js/data.js';
let src = fs.readFileSync(DATA, 'utf8');
const risks = JSON.parse(fs.readFileSync('new-risks.json', 'utf8'));
const MARK = '/* === 方案新增：9 域剧本模板（由 scripts/inject-scripts.mjs 生成） === */';
if (src.includes(MARK)) {
  const s = src.indexOf(MARK);
  const e = src.indexOf('  };', s);
  src = src.slice(0, s) + src.slice(e);
}
const seg = { foundation: 'doc', society: 'flow', governance: 'inspect' };
const code = '\n' + MARK + '\n' + risks.map((r) => {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const s = seg[r.cat] || 'doc';
  return "    " + r.code + ": {\n" +
    "      seg: '" + s + "', focus: [0, 2],\n" +
    "      note: '" + esc(r.brief) + "',\n" +
    "      sys: '你是 AI 安全学习助手，请围绕「" + esc(r.title) + "」进行教学式分析。',\n" +
    "      doc: '" + esc(r.scenario) + "',\n" +
    "      docClean: '" + esc(r.analogy) + "',\n" +
    "      usr: '请说明这一风险的核心机制、防护措施与典型场景。',\n" +
    "      pk: ['" + esc(r.steps[0].split('::')[0]) + "', '" + esc(r.title) + "'],\n" +
    "      tail: { atk: '" + esc(r.why) + "', ok: '" + esc(r.defense[0]) + "' }\n" +
    "    },";
}).join('\n') + '\n';
const start = src.indexOf('  var SCRIPTS = {');
const end = src.indexOf('  };', start);
src = src.slice(0, end) + code + src.slice(end);
fs.writeFileSync(DATA, src, 'utf8');
console.log('注入剧本:', risks.length, '条');
