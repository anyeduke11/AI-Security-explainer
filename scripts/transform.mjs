// AI安全题库变形引擎（原始题库经语义等价改写与选项随机化，生成扩展题）
// 规则式语义等价改写：同义替换题干与选项 + Fisher-Yates 选项随机化 + 相似度去重
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYN } from './synonyms.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANK = JSON.parse(fs.readFileSync(path.join(HERE, 'bank.raw.json'), 'utf8'));

/* ---------- 种子化随机（可复现） ---------- */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fisherYates(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- 同义替换（占位符防震荡，每条规则只应用一次） ---------- */
function synonymize(text) {
  let slots = {};
  let n = 0;
  let out = text;
  for (const [re, rep] of SYN) {
    out = out.replace(re, (m) => {
      const key = `\u0000${n++}\u0000`;
      slots[key] = rep;
      return key;
    });
  }
  // 还原占位符（递归处理占位符内不再含可替换词的情况）
  for (let i = 0; i < 3; i++) {
    out = out.replace(/\u0000(\d+)\u0000/g, (m, d) => slots[m] !== undefined ? slots[m] : m);
  }
  return out;
}

/* ---------- 相似度去重：字符 2-gram Jaccard ---------- */
function normText(t) {
  return t.replace(/[？?，。、；：！!“”"'（）()\s]/g, '');
}
function ngrams(t, n = 2) {
  const s = new Set();
  for (let i = 0; i + n <= t.length; i++) s.add(t.slice(i, i + n));
  return s;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/* ---------- 变形主流程 ---------- */
const SEED = 20261120;
const rand = mulberry32(SEED);
const DUP_THRESHOLD = 0.86;

const outChapters = [];
let kept = 0, skipped = 0, reordered = 0;
const allNorm = []; // 已保留题干的归一化 2-gram，用于去重

for (const ch of BANK.chapters) {
  const qs = [];
  for (const q of ch.questions) {
    // 1) 题干与选项同义替换
    const newText = synonymize(q.text);
    const newOpts = q.options.map((o) => synonymize(o));

    // 2) 选项 Fisher-Yates 随机化，重算答案索引
    const perm = fisherYates(newOpts, rand);
    const oldAnsIdx = q.answer.charCodeAt(0) - 65; // A=0
    const newAnsIdx = perm.indexOf(newOpts[oldAnsIdx]);
    const newAnswer = String.fromCharCode(65 + newAnsIdx);
    if (newAnsIdx !== oldAnsIdx) reordered++;

    // 3) 去重：与已保留题比较
    const ng = ngrams(normText(newText));
    let dup = false;
    for (const exist of allNorm) {
      if (jaccard(ng, exist) >= DUP_THRESHOLD) { dup = true; break; }
    }
    if (dup) { skipped++; continue; }

    qs.push({
      n: q.n,
      text: newText,
      options: perm,
      answer: newAnswer,
      difficulty: q.difficulty,
      analysis: q.analysis,
      basis: q.basis,
    });
    allNorm.push(ng);
    kept++;
  }
  outChapters.push({ chapter: ch.chapter, title: ch.title, source: ch.source, questions: qs });
}

const result = {
  meta: {
    source: '原始题库（一次性导入）',
    totalOriginal: BANK.chapters.reduce((a, c) => a + c.questions.length, 0),
    totalTransformed: kept,
    skippedDuplicate: skipped,
    optionsReordered: reordered,
    seed: SEED,
    strategy: 'synonym-substitution + fisher-yates shuffle + jaccard dedup',
  },
  chapters: outChapters,
};

fs.writeFileSync(path.join(HERE, 'bank.transformed.json'), JSON.stringify(result, null, 2));

console.log('原始题数:', result.meta.totalOriginal);
console.log('保留题数:', kept);
console.log('跳过重复:', skipped);
console.log('选项位置变化:', reordered);
for (const c of outChapters) console.log(`章 ${c.chapter} 《${c.title}》 保留=${c.questions.length}`);
