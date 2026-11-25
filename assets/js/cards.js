/* AI 安全学习实验室 — 知识卡片数据层与完整 SM-2 间隔重复算法（零依赖） */
(function (NS) {
  'use strict';

  var D = NS.data;
  var RISKS = (D && D.RISKS) || [];
  var STAGE_OF = {};
  if (D && D.RISKS) D.RISKS.forEach(function (r) { STAGE_OF[r.code] = (r.stages || [])[0] || ''; });

  /* 五类标签：从风险已有字段自动推导，不引入新数据源 */
  var TAGS = ['机制', '防护', '案例', '术语', '合规'];
  function tagsFor(r) {
    var t = [];
    var text = [r.title, r.en, r.brief, r.why, r.basis || ''].join(' ');
    if (/标准|法规|政策|合规|治理|评估|报告|条例|法/.test(text)) t.push('合规');
    if (/定义|指|是什么|概念|属于|分类|区别/.test(text)) t.push('术语');
    if (/案例|【案例】|事件|攻击成功|被诱导|检测到/.test(r.scenario || '')) t.push('案例');
    if (/防护|防御|控制|限制|隔离|校验|过滤|最小权限/.test((r.defense || []).join(' '))) t.push('防护');
    if (r.steps && r.steps.length) t.push('机制');
    return t.length ? t : ['机制'];
  }

  /* 内置卡片：每条风险至少一张（front 用随堂题题干，back 用解析） */
  var BUILTIN = RISKS.map(function (r, i) {
    return {
      id: 'C-' + r.code,
      code: r.code,
      cat: r.cat,
      front: r.quiz && r.quiz.q ? r.quiz.q : r.title + ' 的核心风险是什么？',
      back: (r.quiz && r.quiz.e ? r.quiz.e : r.brief),
      core: r.brief || '',
      memory: r.analogy || '',
      basis: r.basis || '课程资料',
      seeAlso: (r.seeAlso || []).slice(),
      tags: tagsFor(r),
      level: r.level,
      stage: STAGE_OF[r.code] || '',
      custom: false,
      index: i
    };
  });
  var BUILTIN_MAP = {};
  BUILTIN.forEach(function (c) { BUILTIN_MAP[c.id] = c; });

  /* 完整 SM-2：SuperMemo-2 标准实现
   * grade: 0..5（0/1 忘、2 犹豫、3 勉强、4 良好、5 完美）
   * 三档自评映射：忘了=1 / 模糊=3 / 记得=5
   * EF' = EF + (0.1 - (5-q)*(0.08+(5-q)*0.02))，下限 1.3
   * q<3 重置重复计数；q>=3 时 1/6/interval*EF 递进 */
  function blank() {
    return { ef: 2.5, interval: 0, reps: 0, lapses: 0, due: 0, last: 0, history: [] };
  }
  function sm2(prev, grade, now) {
    var p = Object.assign(blank(), prev || {});
    var q = Math.max(0, Math.min(5, Math.round(+grade || 0)));
    now = now || Date.now();
    var interval;
    if (q < 3) {
      p.reps = 0;
      p.lapses = (p.lapses || 0) + 1;
      interval = 1;
    } else {
      interval = p.reps === 0 ? 1 : p.reps === 1 ? 6 : Math.max(1, Math.round((p.interval || 1) * p.ef));
      p.reps = (p.reps || 0) + 1;
    }
    p.ef = Math.max(1.3, p.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    p.interval = interval;
    p.last = now;
    p.due = now + interval * 86400000;
    p.history = (p.history || []).concat([{ at: now, q: q, iv: interval, ef: Math.round(p.ef * 100) / 100 }]).slice(-30);
    return p;
  }
  function gradeOf(label) { return label === 'remember' ? 5 : label === 'fuzzy' ? 3 : 1; }
  function isDue(state, now) { return !state || !state.due || state.due <= (now || Date.now()); }
  function boxLabel(state) {
    if (!state || !state.reps) return '未学';
    if (state.reps === 1) return '初记';
    if (state.reps === 2) return '巩固';
    if (state.interval >= 15) return '长期';
    return '在学';
  }

  /* 合并内置与用户自建卡片（用户卡在前，便于优先看到自己的产出） */
  function all(custom) {
    var list = (custom || []).filter(function (c) { return c && c.id && c.front && c.back; }).map(function (c, i) {
      return Object.assign({ custom: true, index: 10000 + i, tags: ['机制'], level: 1, cat: 'custom' }, c);
    });
    return list.concat(BUILTIN);
  }

  NS.cards = {
    TAGS: TAGS,
    builtin: BUILTIN,
    builtinMap: BUILTIN_MAP,
    all: all,
    blank: blank,
    sm2: sm2,
    gradeOf: gradeOf,
    isDue: isDue,
    boxLabel: boxLabel,
    tagsFor: tagsFor
  };
})(window.AISEC = window.AISEC || {});
