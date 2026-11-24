/* 清洗章节标记 + 从源文档提取「是什么/记忆点」丰富 92 条风险描述 */
import fs from 'node:fs';

const SRC = process.argv[2] || 'feishu-source.txt';
const NR_PATH = 'new-risks.json';
let lines = [];
try { lines = fs.readFileSync(SRC, 'utf8').split('\n'); } catch { console.error('源文档缺失:', SRC); process.exit(1); }
const risks = JSON.parse(fs.readFileSync(NR_PATH, 'utf8'));

// 1) 建立详细小节索引（仅正文区：行号 150 之后），节标题形如「5.2.2 越狱攻击 【必须掌握】」
const sections = {};
for (let i = 150; i < lines.length; i++) {
  const m = lines[i].match(/^(\d+(?:\.\d+)+)\s+([^【\u200b]+)/);
  if (!m) continue;
  const num = m[1];
  if (sections[num]) continue;
  const buf = [];
  for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
    if (/^\d+(?:\.\d+)+\s+\S/.test(lines[j])) break;
    const t = lines[j].replace(/\u200b/g, '').trim();
    if (t) buf.push(t);
  }
  sections[num] = { title: m[2].trim(), body: buf };
}
console.log('解析详细小节:', Object.keys(sections).length);

// 2) 章节标记清洗规则
function stripMarks(s) {
  return String(s)
    .replace(/第\s*\d+(?:\.\d+)+(?:[-–]\d+(?:\.\d+)+)?\s*节?/g, '')
    .replace(/（讲义\d+）/g, '')
    .replace(/PDF\s*第\s*\d+(?:[-–]\d+)?\s*页/g, '')
    // 括号内任意由章节号（含 、／/- 连接）组成的内容整体删除
    .replace(/[（(]\s*\d+(?:\.\d+)+(?:[\s、,，／\/\-–]\s*\d+(?:\.\d+)+)*\s*[)）]/g, '')
    .replace(/按\s*\d+(?:\.\d+)+/g, '')
    .replace(/\d+(?:\.\d+)+\s*记忆点(?:【[^】]*】)?/g, '课程要点')
    .replace(/【重点】/g, '')
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[，。、；：\s]+|[，。、；：\s]+$/g, '')
    .trim();
}

// 3) 从 basis 提取主章节号，取该节「是什么」与「记忆点」段
function extractRich(num) {
  const sec = sections[num];
  if (!sec) return null;
  const what = sec.body.find((x) => /^是什么[：:]/.test(x));
  const memo = sec.body.find((x) => /^记忆点[：:]/.test(x) || x.startsWith('【') && x.includes('记忆点'));
  const detail = sec.body.find((x) => /^(重要细节|关键细节|降低幻觉的方法|核心|风险|防护|要点)[：:]/.test(x));
  return { what, memo, detail, title: sec.title, body: sec.body };
}
function chapterOf(basis) {
  const m = String(basis).match(/(\d+(?:\.\d+)+)/);
  return m ? m[1] : null;
}

// 4) 处理每条风险
let enriched = 0;
const report = [];
for (const r of risks) {
  const ch = chapterOf(r.basis || '');
  const rich = ch ? extractRich(ch) : null;

  // 清洗所有字段中的章节标记
  r.brief = stripMarks(r.brief);
  r.why = stripMarks(r.why);
  r.steps = r.steps.map(stripMarks);
  r.analogy = stripMarks(r.analogy);
  r.defense = r.defense.map(stripMarks);
  r.scenario = stripMarks(r.scenario);
  r.quiz = [stripMarks(r.quiz[0]), r.quiz[1].map(stripMarks), r.quiz[2], stripMarks(r.quiz[3])];
  const basisTitle = stripMarks((rich && rich.title) || r.title).replace(/[（(]\s*[)）]/g, '');
  r.basis = '课程资料 · ' + basisTitle;

  // 丰富 brief/why：用源文档「是什么」补充背景，「记忆点」补充理解
  if (rich && rich.what) {
    const what = stripMarks(rich.what.replace(/^是什么[：:]\s*/, ''));
    if (what && what.length > r.brief.length) {
      // 若原 brief 与源文档「是什么」表达高度重合，直接采用更完整的源文档版本
      const a = new Set(r.brief.replace(/[，。、；：\s]/g, ''));
      const b = what.replace(/[，。、；：\s]/g, '');
      let common = 0;
      for (const ch of a) if (b.includes(ch)) common++;
      r.brief = common / a.size > 0.45 ? what : r.brief.replace(/[。！？]$/, '') + '。' + what;
      enriched++;
    }
  }
  if (rich && rich.memo) {
    let memo = stripMarks(rich.memo.replace(/^(【[^】]*】)?\s*记忆点[：:]\s*/, ''));
    // 截断到完整句子，避免源文档换行导致的半句
    if (memo.length > 180) {
      const cut = memo.lastIndexOf('。', 180);
      memo = cut > 60 ? memo.slice(0, cut + 1) : memo.slice(0, 180) + '…';
    }
    if (memo && memo.length > 10) r.why = r.why.replace(/[。！？]$/, '') + '。要点：' + memo;
  }
  // 丰富 steps：把源文档的「重要细节」作为补充步骤
  if (rich && rich.detail) {
    const detail = stripMarks(rich.detail);
    if (detail && detail.length > 12 && !r.steps.some((s) => s.includes(detail.slice(0, 12)))) {
      r.steps.push('补充细节::' + detail);
    }
  }
  report.push({ code: r.code, ch: ch || '-', got: !!rich, briefLen: r.brief.length });
}

fs.writeFileSync(NR_PATH, JSON.stringify(risks, null, 2));
const got = report.filter((x) => x.got).length;
console.log('丰富 brief:', enriched, '匹配到源文档小节:', got, '/', risks.length);
console.log('未匹配章节:', report.filter((x) => !x.got).slice(0, 15).map((x) => x.code + '(' + x.ch + ')').join(', '));
console.log('平均 brief 长度:', Math.round(report.reduce((a, x) => a + x.briefLen, 0) / report.length));
