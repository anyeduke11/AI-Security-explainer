/* AI 安全学习实验室 — 应用逻辑：路由 / 导航 / 搜索 / 进度 / 路径 / 测验 / 攻击路径实验室 */
(function (NS) {
  'use strict';

  var D = NS.data;
  var CATS = D.CATS, ZONES = D.ZONES, RISKS = D.RISKS, RISK_MAP = D.RISK_MAP, PATHS = D.PATHS;
  var AIBANK = NS.aiBank || { list: [], byCode: {} };
  // 统一题库「AI安全题库」：风险 152 + 扩展题 633，全部按九大知识域分类
  var ALL_BANK = (function () {
    var list = RISKS.concat(AIBANK.list);
    var byCode = {};
    list.forEach(function (q) { byCode[q.code] = q; });
    return { list: list, byCode: byCode };
  })();
  var LEVEL_NAME = { 1: '入门', 2: '进阶', 3: '挑战' };
  var DEMO_LABEL = {
    prompt: '提示注入模拟', scope: '权限半径模拟', pipeline: '防御开关实验', inspect: '内容审查训练',
    budget: '资源消耗沙盘', rag: '检索 / 记忆模拟', web: '输入拼接示意', flow: '攻击链动画',
    concept: '概念拆解', policy: '合规判定', impact: '影响链路分析'
  };
  var STORE_KEY = 'aisec-lab-v1';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* 术语悬浮卡包裹：入参必须是已转义文本（见 glossary.js） */
  function gl(s) { return typeof NS.gl === 'function' ? NS.gl(s) : s; }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function catVar(id) { return 'style="--cat:' + (D.CAT_MAP[id] ? D.CAT_MAP[id].color : '#1f4fd8') + '"'; }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }

  /* ---------------- 状态 ---------------- */
  /* 三维度进度：read 读懂 / ranged 练过 / quiz 答对（ROADMAP P0-2） */
  var CARDS = NS.cards || { all: function (c) { return c || []; }, sm2: function (p) { return p; }, blank: function () { return {}; }, isDue: function () { return true; }, gradeOf: function () { return 1; } };
  var PRACTICAL = NS.practical || { list: [], byCode: {}, byCat: {}, score: function () { return { score: 0, pass: false }; }, total: 0 };
  function defaults() {
    return {
      read: {}, visited: {}, mini: {}, ranged: {}, theme: 'light',
      quiz: { total: 0, right: 0, wrong: {}, ok: {} },
      /* 记忆卡片：SM-2 复习状态 + 用户自建卡片 + 连续天数 */
      cards: { reviews: {}, custom: [], streak: 0, lastDay: '', dailyGoal: 20 },
      /* 实操题：答题记录与错题 */
      practical: { total: 0, passed: 0, attempts: {}, wrong: {} }
    };
  }
  var S;
  try {
    S = Object.assign(defaults(), JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
    S.read = S.read || {}; S.visited = S.visited || {}; S.mini = S.mini || {};
    /* 旧用户 localStorage 无 ranged 键时兜底为空对象，不报错 */
    S.ranged = S.ranged || {};
    S.quiz = Object.assign({ total: 0, right: 0, wrong: {}, ok: {} }, S.quiz || {});
    S.quiz.wrong = S.quiz.wrong || {};
    S.quiz.ok = S.quiz.ok || {};
    /* v0.1.0 迁移：补齐记忆与实操状态，不覆盖已有记录 */
    S.cards = Object.assign({ reviews: {}, custom: [], streak: 0, lastDay: '', dailyGoal: 20 }, S.cards || {});
    S.cards.reviews = S.cards.reviews || {};
    S.cards.custom = Array.isArray(S.cards.custom) ? S.cards.custom : [];
    S.practical = Object.assign({ total: 0, passed: 0, attempts: {}, wrong: {} }, S.practical || {});
    S.practical.attempts = S.practical.attempts || {};
    S.practical.wrong = S.practical.wrong || {};
  } catch (e) { S = defaults(); }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* 隐私模式下忽略 */ }
    renderChrome();
  }
  /* MCP 编号零填充迁移（MCP1→MCP01 等）：老进度记录在新编号下继续可用 */
  var CODE_MIGRATE = { MCP1: 'MCP01', MCP2: 'MCP02', MCP4: 'MCP04', MCP5: 'MCP05', MCP6: 'MCP06', MCP8: 'MCP08', MCP9: 'MCP09' };
  function migrateCodes() {
    ['read', 'visited', 'mini', 'ranged'].forEach(function (k) {
      var box = S[k] || {};
      Object.keys(CODE_MIGRATE).forEach(function (oldId) {
        if (box[oldId] !== undefined) {
          if (box[CODE_MIGRATE[oldId]] === undefined) box[CODE_MIGRATE[oldId]] = box[oldId];
          delete box[oldId];
        }
      });
    });
    if (S.quiz && S.quiz.wrong) {
      Object.keys(CODE_MIGRATE).forEach(function (oldId) {
        if (S.quiz.wrong[oldId] !== undefined) {
          S.quiz.wrong[CODE_MIGRATE[oldId]] = (S.quiz.wrong[CODE_MIGRATE[oldId]] || 0) + S.quiz.wrong[oldId];
          delete S.quiz.wrong[oldId];
        }
      });
    }
    /* 迁移后的新结构（ranged / quiz.ok）落盘，避免每次刷新重复迁移 */
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* 隐私模式下忽略 */ }
  }
  function learnedCount() { return Object.keys(S.read).length; }
  function learnedInCat(id) { return D.byCat(id).filter(function (r) { return S.read[r.code]; }).length; }
  /* 练过（靶场闭环完成）计数：只统计有效风险编号 */
  function rangedCount() {
    return Object.keys(S.ranged).filter(function (c) { return RISK_MAP[c]; }).length;
  }
  function rangedInCat(id) {
    return D.byCat(id).filter(function (r) { return S.ranged[r.code]; }).length;
  }
  /* 答对（随堂题 / 测验中心正确）条目数：以 quiz.ok 记账（每条风险答对过即计 1） */
  function quizAnsweredCount() {
    return Object.keys(S.quiz.ok).filter(function (c) { return RISK_MAP[c]; }).length;
  }
  function quizAnsweredInCat(id) {
    return D.byCat(id).filter(function (r) { return S.quiz.ok[r.code]; }).length;
  }
  /* ---------------- 记忆卡片 / 实操 统计工具 ---------------- */
  function allCards() { return CARDS.all(S.cards.custom); }
  function cardMap() { var m = {}; allCards().forEach(function (c) { m[c.id] = c; }); return m; }
  function dueCardCount() {
    var now = Date.now();
    return allCards().filter(function (c) { return CARDS.isDue(S.cards.reviews[c.id], now); }).length;
  }
  function cardMasteredCount() {
    return allCards().filter(function (c) {
      var s = S.cards.reviews[c.id]; return s && s.reps >= 3;
    }).length;
  }
  function practicalPassedCount() {
    return Object.keys(S.practical.attempts).filter(function (k) {
      var a = S.practical.attempts[k]; return a && a.pass;
    }).length;
  }
  function todayStr() {
    var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function bumpStreak() {
    var t = todayStr();
    if (S.cards.lastDay === t) return;
    var y = new Date(Date.now() - 86400000);
    var ys = y.getFullYear() + '-' + ('0' + (y.getMonth() + 1)).slice(-2) + '-' + ('0' + y.getDate()).slice(-2);
    S.cards.streak = S.cards.lastDay === ys ? (S.cards.streak || 0) + 1 : 1;
    S.cards.lastDay = t;
  }
  /* 靶场闭环完成回调（由 demos.js 的 onRangeComplete 触发） */
  function onRangeComplete(code, info) {
    if (!RISK_MAP[code]) return;
    var prev = S.ranged[code];
    S.ranged[code] = {
      at: Date.now(),
      predict: info && info.predict ? info.predict : null,
      truth: info && info.truth ? info.truth : null,
      hit: !!(info && info.hit),
      times: (prev && prev.times ? prev.times : 0) + 1
    };
    save();
  }
  if (NS.demos) NS.demos.onRangeComplete = onRangeComplete;
  function totalPathSteps() { return PATHS.reduce(function (a, p) { return a + p.steps.length; }, 0); }
  function donePathSteps() {
    return PATHS.reduce(function (a, p) { return a + p.steps.filter(function (x) { return S.read[x.code]; }).length; }, 0);
  }
  function markRead(code, silent) {
    if (!S.read[code]) {
      S.read[code] = Date.now();
      save();
      if (!silent) toast('已标记「' + RISK_MAP[code].title + '」为已学');
    }
    var b = $('[data-read-btn]');
    if (b) {
      b.classList.remove('primary');
      b.innerHTML = '<svg class="ic"><use href="#i-check"></use></svg>已完成学习';
      b.disabled = true;
    }
  }
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------------- 顶栏与侧栏 ---------------- */
  function renderChrome() {
    var p = pct(learnedCount(), RISKS.length);
    $('#pillRing').style.setProperty('--p', p + '%');
    $('#pillText').textContent = p + '%';
    $('#progressPill').setAttribute('aria-label', '学习进度 ' + p + '%，已学 ' + learnedCount() + ' / ' + RISKS.length + ' 条');
    document.documentElement.dataset.theme = S.theme;
    $('#themeIcon use').setAttribute('href', S.theme === 'dark' ? '#i-sun' : '#i-moon');
    renderSideNav();
  }
  function navLink(href, icon, text, active, count) {
    return '<a class="nav-link' + (active ? ' active' : '') + '" href="' + href + '">' +
      '<svg class="ic"><use href="#' + icon + '"></use></svg><span>' + esc(text) + '</span>' +
      (count ? '<span class="nav-count">' + esc(count) + '</span>' : '') + '</a>';
  }
  function renderSideNav() {
    var route = parseHash();
    var activeCat = route.view === 'cat' ? route.param : (route.view === 'risk' && RISK_MAP[route.param] ? RISK_MAP[route.param].cat : '');
    var html = '<div class="nav-group"><div class="nav-title">攻击路径主线</div>' +
      navLink('#/home', 'i-home', '首页概览', route.view === 'home') +
      navLink('#/lab', 'i-map', '攻击路径实验室', route.view === 'lab') +
      navLink('#/lab?view=heat', 'i-chart', '风险热度矩阵', false) +
      navLink('#/path', 'i-path', '新手学习路径', route.view === 'path',
        donePathSteps() + '/' + totalPathSteps()) +
      navLink('#/transformer', 'i-bolt', 'Transformer 攻防透视', route.view === 'transformer') +
      '</div>';
    html += '<div class="nav-group"><div class="nav-title">' + CATS.length + ' 大知识域 · ' + RISKS.length + ' 条风险</div>' +
      '<div class="nav-sub-totals" style="' + PROGRESS_CSS.navTotals + '" title="读懂 / 练过 / 答对 三维度进度">读懂 ' + learnedCount() + '/' + RISKS.length +
      ' · 练过 ' + rangedCount() + '/' + RISKS.length +
      ' · 答对 ' + quizAnsweredCount() + '/' + RISKS.length + '</div>';
    CATS.forEach(function (c) {
      var list = D.byCat(c.id);
      html += '<a class="nav-link' + (activeCat === c.id ? ' active' : '') + '" href="#/cat/' + c.id + '" style="--cat:' + c.color + '">' +
        '<span class="nav-dot"></span><span>' + esc(c.short) + '</span>' +
        '<span class="nav-count" title="读懂 ' + learnedInCat(c.id) + ' · 练过 ' + rangedInCat(c.id) + ' · 答对 ' + quizAnsweredInCat(c.id) + '（本域共 ' + list.length + ' 条）">' +
        '练过 ' + rangedInCat(c.id) + '/' + list.length +
        '</span></a>';
      if (activeCat === c.id) {
        html += '<div class="nav-sub">' + list.map(function (r) {
          return '<a class="nav-risk' + (S.read[r.code] ? ' done' : '') + (route.param === r.code ? ' active' : '') +
            '" href="#/risk/' + r.code + '"><span class="rc">' + esc(r.code) + '</span><span>' + esc(r.title) + '</span></a>';
        }).join('') + '</div>';
      }
    });
    html += '</div><div class="nav-group"><div class="nav-title">记忆</div>' +
      navLink('#/cards', 'i-book', '知识卡片', route.view === 'cards', dueCardCount() ? '待复习 ' + dueCardCount() : '') +
      navLink('#/cards?view=mine', 'i-target', '我的卡片', route.view === 'cards' && route.query.view === 'mine',
        S.cards.custom.length ? String(S.cards.custom.length) : '') +
      '</div><div class="nav-group"><div class="nav-title">检验与记录</div>' +
      navLink('#/quiz', 'i-quiz', '测验中心', route.view === 'quiz') +
      navLink('#/quiz?type=practical', 'i-bolt', '实操题', route.view === 'quiz' && route.query.type === 'practical',
        String(PRACTICAL.total)) +
      navLink('#/progress', 'i-chart', '我的学习进度', route.view === 'progress') +
      '</div>';
    $('#sideNav').innerHTML = html;
  }

  /* ---------------- 路由 ---------------- */
  function parseHash() {
    var raw = decodeURIComponent((location.hash || '#/home').replace(/^#\/?/, ''));
    var qi = raw.indexOf('?');
    var q = '';
    if (qi >= 0) { q = raw.slice(qi + 1); raw = raw.slice(0, qi); }
    var parts = raw.split('/').filter(Boolean);
    var query = {};
    q.split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      query[p[0]] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
    });
    return { view: parts[0] || 'home', param: parts[1] || '', query: query };
  }
  function go(hash) { location.hash = hash; if (location.hash === hash) render(); }

  /* ---------------- 搜索 ---------------- */
  function searchRisks(term) {
    var t = term.trim().toLowerCase();
    if (!t) return [];
    var words = t.split(/\s+/).filter(Boolean);
    return RISKS.map(function (r) {
      var score = 0;
      words.forEach(function (w) {
        if (r.code.toLowerCase().indexOf(w) === 0) score += 10;
        else if (r.title.toLowerCase().indexOf(w) >= 0) score += 7;
        else if (r.en.toLowerCase().indexOf(w) >= 0) score += 5;
        else if (D.CAT_MAP[r.cat].short.toLowerCase().indexOf(w) >= 0 || D.CAT_MAP[r.cat].full.toLowerCase().indexOf(w) >= 0) score += 4;
        else if (r.search.indexOf(w) >= 0) score += 2;
      });
      return { r: r, score: score };
    }).filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score || a.r.index - b.r.index; })
      .map(function (x) { return x.r; });
  }
  function resultHTML(r, big) {
    var c = D.CAT_MAP[r.cat];
    if (big) {
      return '<a class="search-page-item" href="#/risk/' + r.code + '" ' + catVar(r.cat) + '>' +
        '<span class="sp-code">' + esc(r.code) + '</span><div style="flex:1;min-width:0">' +
        '<h3>' + esc(r.title) + ' <span class="muted small">· ' + esc(r.en) + '</span></h3>' +
        '<p>' + esc(r.brief) + '</p></div><span class="badge">' + esc(r.stages.join(' · ')) + '</span>' +
        '<span class="badge">' + esc(c.short) + '</span></a>';
    }
    return '<a class="search-result" href="#/risk/' + r.code + '" ' + catVar(r.cat) + '>' +
      '<span class="sr-code">' + esc(r.code) + '</span><span class="sr-body">' +
      '<span class="sr-title">' + esc(r.title) + '</span>' +
      '<span class="sr-brief">' + esc(r.brief) + '</span></span>' +
      '<span class="sr-cat">' + esc(c.short) + '</span></a>';
  }
  /* 术语命中：复用 glossary 的弹卡机制（点击直接打开释义浮层） */
  function glHitHTML(g) {
    return '<button type="button" class="search-result gl gl-hit" data-gl="' + esc(g.id) + '" aria-haspopup="dialog">' +
      '<span class="sr-code">术语</span><span class="sr-body">' +
      '<span class="sr-title">' + esc(g.term) + ' <span class="muted">' + esc(g.en || '') + '</span></span>' +
      '<span class="sr-brief">' + esc(g.short) + '</span></span></button>';
  }
  function glHits(term) {
    return (typeof NS.glSearch === 'function' ? NS.glSearch(term) : []).slice(0, 2);
  }
  function updateSearchPanel(term) {
    var panel = $('#searchPanel');
    if (!term.trim()) { panel.hidden = true; panel.innerHTML = ''; return; }
    var list = searchRisks(term).slice(0, 8);
    var gls = glHits(term);
    panel.innerHTML = gls.map(glHitHTML).join('') +
      (list.length
        ? list.map(function (r) { return resultHTML(r); }).join('') +
          '<a class="search-result" href="#/search?q=' + encodeURIComponent(term) + '"><span class="sr-body"><span class="sr-title">查看全部结果 →</span></span></a>'
        : gls.length
          ? ''
          : '<div class="search-empty">没有找到匹配的风险，试试「注入」「权限」「供应链」或编号 LLM01</div>');
    panel.hidden = false;
  }

  /* ---------------- 页面：首页 ---------------- */
  function viewHome() {
    var demoTypes = {};
    RISKS.forEach(function (r) { demoTypes[r.demo.type] = 1; });
    var stats = [
      [RISKS.length, '条风险条目'], [CATS.length, '大知识域'],
      [Object.keys(demoTypes).length, '类交互演示'], [totalPathSteps(), '步引导路径']
    ];
    var html = '<div class="page">' +
      '<div class="hero"><div class="eyebrow">交互式 AI 安全入门</div>' +
        '<h1>把 AI 安全风险，变成看得见的交互</h1>' +
        '<p class="hero-sub">模拟一张真实的金融企业网络：攻击从互联网侧的暴露面出发，穿过 DMZ、智能客服与 Agent 平台，直达核心账务与数据外发。沿九阶段路径逐跳学习 OWASP 四套 AI 安全 Top 10 与常见 Web、基础设施风险。每一步都可交互、可对照，零基础也能跟着走。</p>' +
        '<div class="hero-actions">' +
          '<a class="btn hero-primary" href="#/lab"><svg class="ic"><use href="#i-map"></use></svg>进入攻击路径实验室</a>' +
          '<a class="btn" href="#/path"><svg class="ic"><use href="#i-path"></use></svg>按新手路径逐条学</a>' +
          '<a class="btn" href="#/quiz"><svg class="ic"><use href="#i-quiz"></use></svg>做个小测验</a>' +
          '<a class="btn" href="#/transformer"><svg class="ic"><use href="#i-bolt"></use></svg>Transformer 攻防透视</a>' +
        '</div></div>' +
      '<div class="stat-grid">' + stats.map(function (x) {
        return '<div class="stat"><div class="stat-num">' + x[0] + '</div><div class="stat-label">' + x[1] + '</div></div>';
      }).join('') + '</div>' +
      '<div class="section"><div class="section-title"><span class="sec-no">01</span>九大知识域<span class="sec-tip">点击卡片进入分类</span></div>' +
        '<div class="cat-grid">' + CATS.map(function (c, i) {
          var list = D.byCat(c.id), done = learnedInCat(c.id), p = pct(done, list.length);
          return '<a class="cat-card" href="#/cat/' + c.id + '" ' + catVar(c.id) + '>' +
            '<div class="cat-top"><span class="cat-num">' + String(i + 1).padStart(2, '0') + ' · ' + esc(c.year) + '</span>' +
            '<span class="cat-count">' + list.length + ' 条</span></div>' +
            '<h3>' + esc(c.short) + '</h3><p>' + gl(esc(c.desc)) + '</p>' +
            '<div class="cat-bar"><i style="--w:' + p + '%"></i></div>' +
            '<div class="cat-bar-label"><span>已学 ' + done + ' / ' + list.length + '</span><span>' + p + '%</span></div></a>';
        }).join('') + '</div></div>' +
      '<div class="section grid grid-2">' +
        '<div><div class="section-title"><span class="sec-no">02</span>新手怎么开始</div>' +
          '<div class="path-preview">' +
            '<div class="mini-step"><span class="ms-no">1</span><div><b>先把整条链播放一遍</b><span>在攻击路径实验室里点「播放路径」，看风险如何从互联网侧传导到核心账务与数据外发。</span></div></div>' +
            '<div class="mini-step"><span class="ms-no">2</span><div><b>拖动防御强度，理解控制点</b><span>像调 temperature 一样实时改变结果：观察控制在第几跳把链路截断、哪些风险因此不可达。</span></div></div>' +
            '<div class="mini-step"><span class="ms-no">3</span><div><b>沿路径逐条深入</b><span>每一跳都能点开 ' + RISKS.length + ' 条风险中的相关条目，配交互演示、随堂小测与 ' + totalPathSteps() + ' 步引导路径。</span></div></div>' +
          '</div></div>' +
        '<div><div class="section-title"><span class="sec-no">03</span>九阶段攻击路径<span class="sec-tip">点击直达对应一跳</span></div>' +
          '<div class="card card-pad">' +
            '<p class="small muted" style="margin-bottom:14px">模拟金融企业网络：互联网 → DMZ → 应用与 AI 平台 → 核心业务 → 数据与外联。每一跳都挂着一组的风险条目。</p>' +
            '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px">' +
              D.STAGES.map(function (s) {
                return '<a class="mini-step" style="padding:8px 10px;gap:8px" href="#/lab?stage=' + s.no + '">' +
                  '<span class="ms-no" style="width:22px;height:22px;font-size:10px;background:' + s.color + '22;color:' + s.color + '">' + s.no + '</span>' +
                  '<div style="min-width:0"><b style="font-size:12px">' + esc(s.id) + ' · ' + esc(s.name) + '</b>' +
                  '<span style="font-size:11px">' + s.risks.length + ' 条风险</span></div></a>';
              }).join('') +
            '</div></div></div>' +
      '</div>' +
      '<div class="section"><div class="card card-pad" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:220px"><h3 style="font-size:16px">内容依据</h3>' +
        '<p class="small muted" style="margin:0">条目依据 OWASP LLM Top 10 (2025)、MCP Top 10 (2025)、Top 10 for Agentic Applications (2026)、Agentic Skills Top 10 (2026)、OWASP Web Top 10 (2025)；基础设施部分为常见风险的教学归纳。所有演示均为本地模拟，用于防御性学习。</p></div>' +
        '<a class="btn" href="#/progress">查看我的进度 <svg class="ic"><use href="#i-arrow"></use></svg></a>' +
      '</div></div></div>';
    return html;
  }

  /* ---------------- 页面：金融企业网络攻击路径实验室（主视图） ---------------- */
  function viewLab() {
    var q = parseHash().query;
    return '<div class="page"><div class="page-head"><div class="eyebrow">交互式主视图 · 金融企业网络</div>' +
      '<h1>沿着一条攻击路径，学完 AI 安全</h1>' +
      '<p class="lead">这是一张模拟的金融行业企业网络：互联网与第三方、DMZ 边界、应用与 AI 平台、核心业务、数据与外联。攻击沿九阶段路径逐跳推进，每一跳都挂着可以学习的风险。像拆解 Transformer 一样：拖动参数、悬停联动高亮、播放路径，右侧讲解与下方章节会实时同步。说明：这里的 <b>S1~S9</b> 是攻击者的推进顺序；风险详情页的 <b>ZONE 1~6</b> 是同一张网络的静态业务分区——两把尺子，同一张地图。</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">' +
        '<span class="badge brand">' + D.NET_NODES.length + ' 个网络节点</span>' +
        '<span class="badge">' + D.STAGES.length + ' 阶段攻击路径</span>' +
        '<span class="badge">' + RISKS.length + ' 条风险全部可到达</span>' +
        '<span class="badge ok">3 种可视化视角</span>' +
        (q.risk && RISK_MAP[q.risk] ? '<span class="badge warn">已定位：' + esc(q.risk) + ' ' + esc(RISK_MAP[q.risk].title) + '</span>' : '') +
      '</div></div>' +
      '<div data-lab-host></div></div>';
  }
  function wireLab() {
    var q = parseHash().query;
    if (NS.lab) NS.lab.mount($('[data-lab-host]'), {
      view: q.view, start: q.start, stage: q.stage, defense: q.defense, risk: q.risk
    });
  }

  /* ---------------- 页面：Transformer 攻防透视（内嵌 demo） ---------------- */
  /* 父页常驻流水线地图：iframe 内轨道在嵌入态隐藏，状态经 postMessage 同步到这里 */
  /* 状态条：模式 + 三道防御 + 温度，既是显示也是远程控制（点击经 postMessage 传入 iframe） */
  function renderTxState(state) {
    var box = $('[data-tx-state]');
    if (!box || !state) return;
    var atk = state.mode === 'attack';
    function dot(on, key, label) {
      return '<button type="button" class="txr-dot' + (on ? ' on' : '') + '" data-tx-set="' + key + '" title="' + (on ? '已开启，点击关闭' : '未开启，点击开启') + '">' + label + '</button>';
    }
    box.innerHTML =
      '<button type="button" class="txr-mode ' + (atk ? 'bad' : 'ok') + '" data-tx-set="mode" data-now="' + state.mode + '" title="点击切换输入模式">' +
        (atk ? '异常输入' : '正常输入') + '</button>' +
      dot(state.detect, 'detect', '检') + dot(state.layer, 'layer', '层') + dot(state.gate, 'gate', '门') +
      '<span class="txr-temp">T ' + Number(state.temp || 1).toFixed(1) + '</span>';
  }
  /* 播放控制组：上一步/下一步/自动播放/重置（按钮样式与 iframe 内执行面板一致） */
  function renderTxCtrls(stage, state, total) {
    var box = $('[data-tx-ctrls]');
    if (!box) return;
    var playing = !!(state && state.playing);
    box.innerHTML =
      '<button type="button" class="txr-btn" data-tx-ctl="reset" title="重置当前剧本">⟲ 重置</button>' +
      '<button type="button" class="txr-btn" data-tx-ctl="prev"' + (stage <= 0 ? ' disabled' : '') + ' title="上一步">◀ 上一步</button>' +
      '<button type="button" class="txr-btn' + (playing ? ' playing' : '') + '" data-tx-ctl="play" title="按数据流顺序自动推进 / 暂停">' + (playing ? '❚❚ 暂停' : '▶ 自动播放') + '</button>' +
      '<button type="button" class="txr-btn primary" data-tx-ctl="next"' + (stage >= total - 1 ? ' disabled' : '') + ' title="下一步">下一步 ▶</button>';
  }
  function renderTxRail(stage, steps, state) {
    var bar = $('[data-tx-rail]');
    if (!bar || !Array.isArray(steps) || !steps.length) return;
    var btn = function (s, i) {
      var cls = 'txr-step' + (i < stage ? ' done' : (i === stage ? ' cur' : ''));
      return '<button type="button" data-tx-step="' + i + '" class="' + cls + '" title="' + esc(s.tip || (s.no + ' · ' + s.name)) + '">' +
        '<b>' + esc(s.no) + '</b><span>' + esc(s.name) + '</span></button>';
    };
    $('[data-tx-steps]', bar).innerHTML = steps.slice(0, 6).map(function (s, i) { return btn(s, i); }).join('');
    $('[data-tx-steps-aux]', bar).innerHTML = steps.slice(6).map(function (s, i) { return btn(s, i + 6); }).join('');
    $('[data-tx-prog]', bar).textContent = '第 ' + (stage + 1) + ' / ' + steps.length + ' 步';
    renderTxCtrls(stage, state, steps.length);
    renderTxState(state);
    bar.hidden = false;
  }
  function viewTransformer(code) {
    var hasCode = !!(code && RISK_MAP[code]);
    /* 演示文件改版时递增 TX_VERSION，避免 iframe 命中浏览器缓存加载旧版 */
    var TX_VERSION = '20261125';
    var src = 'demos/transformer-attack-explainer.html?v=' + TX_VERSION + (hasCode ? '&risk=' + encodeURIComponent(code) : '');
    return '<div class="page"><div class="page-head"><div class="eyebrow">模型内部 · 交互实验</div>' +
      '<h1>Transformer 攻防透视</h1>' +
      '<p class="lead">把任意一条风险放进简化的语言模型流水线：模型内部 6 个阶段（上下文拼接 → 分词 → 嵌入 → 自注意力 → 前馈网络 → 输出采样与门禁），外加 2 个分析步骤（防御失效分析、攻击成功与影响），全程 8 步、地图常驻。三道防御随时开关，采样温度可调；左栏目录覆盖全部 ' + RISKS.length + ' 条风险，并附随堂测验。</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">' +
        '<span class="badge brand">' + RISKS.length + ' 条风险全量剧本</span>' +
        '<span class="badge">流水线 · 6 内部阶段 + 2 分析</span>' +
        '<span class="badge ok">随堂测验计入进度</span>' +
        (hasCode ? '<span class="badge warn">已定位：' + esc(code) + ' ' + esc(RISK_MAP[code].title) + '</span>' : '') +
      '</div></div>' +
      '<div class="tx-rail" data-tx-rail hidden aria-label="流水线地图（滚动时常驻，点击跳转）">' +
        '<span class="txr-cap">模型内部</span><div class="txr-steps" data-tx-steps></div>' +
        '<span class="txr-div" aria-hidden="true"></span>' +
        '<span class="txr-cap">分析</span><div class="txr-steps" data-tx-steps-aux></div>' +
        '<span class="txr-ctrls" data-tx-ctrls></span>' +
        '<span class="txr-state" data-tx-state></span>' +
        '<span class="txr-prog" data-tx-prog></span>' +
      '</div>' +
      '<div class="card" style="overflow:hidden"><iframe data-tx-frame src="' + src + '" title="Transformer 攻防透视" style="display:block;width:100%;height:1200px;border:0;background:#f4f7fc" loading="lazy"></iframe></div>' +
      '<p class="control-tip" style="margin-top:10px">内嵌为独立演示（浅色主题，深色模式站点下仍以浅色展示）。<a href="' + src + '" target="_blank" rel="noopener">在新窗口打开独立版 ↗</a></p></div>';
  }
  var TX_ORIGIN = location.origin || location.protocol + '//' + location.host;
  function wireTransformer() {
    var frame = $('[data-tx-frame]');
    if (!frame) return;
    frame.addEventListener('load', function () { syncFrameHeight(frame); });
    /* 常驻地图：点击步骤跳转；点击状态芯片远程切换模式/防御 */
    var bar = $('[data-tx-rail]');
    if (bar) bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tx-step]');
      if (b) {
        if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'aisec-tx-goto', step: +b.dataset.txStep }, TX_ORIGIN);
        return;
      }
      var setBtn = e.target.closest('[data-tx-set]');
      if (setBtn && frame.contentWindow) {
        var key = setBtn.dataset.txSet;
        var msg = { type: 'aisec-tx-set', key: key };
        if (key === 'mode') msg.value = setBtn.dataset.now === 'attack' ? 'normal' : 'attack';
        else msg.value = !setBtn.classList.contains('on');
        frame.contentWindow.postMessage(msg, TX_ORIGIN);
        return;
      }
      var ctlBtn = e.target.closest('[data-tx-ctl]');
      if (ctlBtn && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'aisec-tx-ctl', cmd: ctlBtn.dataset.txCtl }, TX_ORIGIN);
      }
    });
  }
  function syncFrameHeight(frame) {
    try {
      var d = frame.contentDocument;
      if (d && d.body) frame.style.height = Math.max(600, d.documentElement.scrollHeight) + 'px';
    } catch (e) { /* 跨源受限时交给 postMessage */ }
  }

  /* ---------------- 页面：分类 ---------------- */
  function viewCat(id) {
    var c = D.CAT_MAP[id];
    if (!c) return viewNotFound();
    var list = D.byCat(id);
    var lv = { 1: 0, 2: 0, 3: 0 };
    list.forEach(function (r) { lv[r.level]++; });
    return '<div class="page"><div class="page-head" ' + catVar(id) + '>' +
      '<div class="eyebrow">' + esc(c.full) + '</div><h1>' + esc(c.short) + '</h1>' +
      '<p class="lead">' + gl(esc(c.desc)) + '</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">' +
        '<span class="badge brand">' + esc(c.year) + '</span>' +
        '<span class="badge">' + list.length + ' 条风险</span>' +
        '<span class="badge ok">入门 ' + lv[1] + '</span><span class="badge warn">进阶 ' + lv[2] + '</span><span class="badge danger">挑战 ' + lv[3] + '</span>' +
        (c.source ? '<a class="badge" href="' + esc(c.source) + '" target="_blank" rel="noopener">官方项目 ↗</a>' : '') +
      '</div></div>' +
      '<div class="section-title"><span class="sec-no">01</span>逐条学习<span class="sec-tip">按官方编号排序 · 勾表示已完成</span></div>' +
      '<div class="cat-list">' + list.map(function (r) {
        return '<a class="cat-row' + (S.read[r.code] ? ' done' : '') + '" href="#/risk/' + r.code + '" ' + catVar(id) + '>' +
          '<span class="cr-no">' + esc(r.code) + '</span><span class="cr-body"><b>' + esc(r.title) +
          ' <span class="muted tiny">' + esc(r.en) + '</span></b><span>' + esc(r.brief) + '</span></span>' +
          '<span class="badge">' + esc(r.stages.join(' · ')) + '</span>' +
          '<span class="badge level-' + r.level + '">' + LEVEL_NAME[r.level] + '</span></a>';
      }).join('') + '</div>' +
      '<div class="section" style="display:flex;gap:10px;flex-wrap:wrap">' +
        '<a class="btn primary" href="#/quiz?cat=' + id + '"><svg class="ic"><use href="#i-quiz"></use></svg>测验本分类</a>' +
        '<a class="btn" href="#/lab"><svg class="ic"><use href="#i-map"></use></svg>在攻击路径中查看</a>' +
        '<a class="btn" href="#/lab?view=heat">打开阶段热度矩阵</a></div></div>';
  }

  /* ---------------- 页面：风险详情 ---------------- */
  /* 随堂小测的展示序洗牌（判定仍用 r.quiz.a 原始索引） */
  function miniQuizHTML(r) {
    var disp = displayOrder(r.quiz.o);
    return '<div class="card mini-quiz" data-mini-quiz data-mini-order="' + disp.order.join(',') + '"><h3>' + esc(r.quiz.q) + '</h3>' +
      '<div class="choice-grid">' + disp.items.map(function (o, i) {
        return '<button type="button" class="choice" data-opt="' + i + '" data-orig="' + disp.order[i] + '"><span class="choice-key">' + 'ABCD'[i] + '</span><span>' + esc(o) + '</span></button>';
      }).join('') + '</div><div data-mini-result></div></div>';
  }
  function viewRisk(code) {
    var r = RISK_MAP[code];
    if (!r) return viewNotFound();
    var c = D.CAT_MAP[r.cat];
    var done = !!S.read[code];
    var prev = RISKS[r.index - 1], next = RISKS[r.index + 1];
    var zoneTags = r.zones.map(function (zid) {
      var z = ZONES.filter(function (x) { return x.id === zid; })[0];
      return z ? '<span class="chip" title="ZONE ' + esc(z.no.replace('ZONE ', '')) + ' · ' + esc(z.name) + '：' + esc(z.control) + '">' + esc(z.no) + ' ' + esc(z.name) + '</span>' : '';
    }).join('');
    var stageRows = r.stages.map(function (sid) {
      var s = D.STAGE_MAP[sid];
      if (!s) return '';
      return '<a class="mini-step" style="margin-bottom:8px;display:flex" href="#/lab?stage=' + s.no + '&risk=' + r.code + '">' +
        '<span class="ms-no" style="background:' + s.color + '22;color:' + s.color + '">' + s.no + '</span>' +
        '<div style="min-width:0;flex:1"><b>' + esc(s.id) + ' · ' + esc(s.name) + '</b>' +
        '<span>' + esc(s.technique.slice(0, 58)) + '…</span></div>' +
        '<span class="badge brand" style="align-self:center;flex:none">定位 →</span></a>';
    }).join('');
    var stageNodeSet = {};
    r.stages.forEach(function (sid) {
      if (D.STAGE_MAP[sid]) D.STAGE_MAP[sid].focus.forEach(function (n) { stageNodeSet[n] = 1; });
    });
    var stageNodeChips = Object.keys(stageNodeSet).slice(0, 8).map(function (n) {
      return '<span class="chip">' + esc(D.NODE_MAP[n] ? D.NODE_MAP[n].name : n) + '</span>';
    }).join('');
    var toc = [
      ['sec-0', '攻击路径定位'], ['sec-1', '30 秒读懂'], ['sec-2', '原理拆解'], ['sec-3', '交互演示'],
      ['sec-4', '如何防护'], ['sec-5', '真实场景'], ['sec-6', '随堂小测']
    ];
    return '<div class="page" ' + catVar(r.cat) + '>' +
      '<div class="small muted" style="margin-bottom:14px"><a href="#/home">首页</a> / <a href="#/cat/' + r.cat + '">' + esc(c.short) + '</a> / ' + esc(r.code) + '</div>' +
      '<div class="detail-head">' +
        '<div class="detail-meta"><span class="detail-code">' + esc(r.code) + '</span>' +
          '<span class="badge">' + esc(c.short) + ' · ' + esc(c.year) + '</span>' +
          '<span class="level-badge level-' + r.level + '">' + LEVEL_NAME[r.level] + ' · ' + esc(D.LEVELS[r.level].desc) + '</span>' +
          '<span class="badge">' + esc(DEMO_LABEL[r.demo.type] || '交互演示') + '</span></div>' +
        '<h1 class="detail-title">' + esc(r.title) + '</h1>' +
        '<div class="detail-en">' + esc(r.en) + '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' + zoneTags + '</div>' +
        '<div class="detail-actions">' +
          '<button class="btn ' + (done ? '' : 'primary') + '" type="button" data-read-btn' + (done ? ' disabled' : '') + '>' +
            (done ? '<svg class="ic"><use href="#i-check"></use></svg>已完成学习' : '<svg class="ic"><use href="#i-check"></use></svg>标记已学') + '</button>' +
          '<a class="btn" href="#/quiz?cat=' + r.cat + '"><svg class="ic"><use href="#i-quiz"></use></svg>测验本分类</a>' +
          '<a class="btn" href="#/transformer/' + r.code + '"><svg class="ic"><use href="#i-bolt"></use></svg>流水线透视</a>' +
          '<a class="btn ghost" href="#/lab?stage=' + (r.stages[0] ? D.STAGE_MAP[r.stages[0]].no : 1) + '&risk=' + r.code + '"><svg class="ic"><use href="#i-map"></use></svg>在攻击路径中定位</a>' +
        '</div></div>' +
      '<div class="know-card" data-know-card style="--cat:' + c.color + '">' +
        '<div class="kc-head"><span class="kc-code">' + esc(r.code) + '</span>' +
          '<span class="kc-mastery">掌握等级 · ' + esc(r.mastery || LEVEL_NAME[r.level]) + '</span>' +
          '<span class="kc-basis">' + esc(r.basis || '课程资料') + '</span></div>' +
        '<div class="kc-body"><b>一句话：</b>' + gl(esc(r.brief)) + '</div>' +
        (r.seeAlso && r.seeAlso.length
          ? '<div class="kc-links">关联：' + r.seeAlso.map(function (code) {
              var rr = RISK_MAP[code];
              return rr ? '<a href="#/risk/' + code + '">' + esc(code) + ' ' + esc(rr.title) + '</a>' : '';
            }).join('') + '</div>'
          : '') +
        '<div class="kc-jump"><a href="#/quiz?cat=' + r.cat + '">随堂小测</a><a href="#/cards?cat=' + r.cat + '">记忆卡片</a>' +
          (PRACTICAL.list.some(function (t) { return t.risk === r.code; }) ? '<a href="#/quiz?type=practical&cat=' + r.cat + '">实操题</a>' : '') +
          '<a href="#sec-3" data-scroll="sec-3">动手试一试</a><a href="#/lab?stage=' + (r.stages[0] ? D.STAGE_MAP[r.stages[0]].no : 1) + '&risk=' + r.code + '">攻击路径</a></div>' +
      '</div>' +
      '<div class="detail-layout"><div>' +
        '<section class="section" id="sec-0" style="margin-top:0"><div class="card card-pad" style="border-left:3px solid var(--cat)">' +
          '<div class="section-title" style="margin-bottom:8px"><span class="sec-no">◎</span>在攻击路径中的位置<span class="sec-tip">金融企业网络 · 共 ' + r.stages.length + ' 跳</span></div>' +
          '<p class="small muted" style="margin-bottom:12px">本站用两把「尺子」定位风险：<b>ZONE 1~6</b> 是数据流经的业务环节（静态视角，见上方标签），<b>S1~S9</b> 是攻击者的推进顺序（动态视角）。这条风险出现在下面 ' + r.stages.length + ' 个攻击阶段，点击任一阶段可跳回实验室，自动选中该跳并高亮本条风险。</p>' +
          stageRows +
          '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:10px"><span class="tiny muted" style="align-self:center">相关网络节点：</span>' + stageNodeChips + '</div>' +
        '</div></section>' +
        '<section class="section" id="sec-1"><div class="section-title"><span class="sec-no">01</span>30 秒读懂</div>' +
          '<div class="brief-box"><b>是什么：</b>' + gl(esc(r.brief)) + '</div>' +
          '<div class="why-box"><b>为什么会这样：</b>' + gl(esc(r.why)) + '</div>' +
          '<div class="analogy"><b>打个比方</b><span>' + esc(r.analogy) + '</span></div></section>' +
        '<section class="section" id="sec-2"><div class="section-title"><span class="sec-no">02</span>原理拆解<span class="sec-tip">按顺序看，风险是怎样一步步成立的</span></div>' +
          '<div class="steps">' + r.steps.map(function (s, i) {
            return '<div class="step-card"><span class="n">' + (i + 1) + '</span><div><h4>' + esc(s.h) + '</h4><p>' + gl(esc(s.p)) + '</p></div></div>';
          }).join('') + '</div></section>' +
        '<section class="section" id="sec-3"><div class="section-title"><span class="sec-no">03</span>动手试一试<span class="sec-tip">交互演示 · 靶场演练两种视图</span></div>' +
          '<div class="demo-tabs" data-dtabs role="tablist">' +
            '<button type="button" class="dtab active" data-dtab="demo" role="tab" aria-selected="true">交互演示</button>' +
            '<button type="button" class="dtab" data-dtab="range" role="tab" aria-selected="false">靶场演练</button>' +
            '<span class="dtab-note" data-dtab-note>' + esc(DEMO_LABEL[r.demo.type] || '交互演示') + '</span>' +
          '</div>' +
          '<div data-demo-host></div>' +
          '<div data-range-host hidden></div>' +
          '<p class="control-tip">「交互演示」为本条风险定制的防御视角模拟；「靶场演练」按攻击者流程走完整链路：构造载荷 → 发起攻击 → 观测输出事实 → 防御复测 → 复盘加固。所有计算都在浏览器本地完成。</p></section>' +
        '<section class="section" id="sec-4"><div class="section-title"><span class="sec-no">04</span>如何防护<span class="sec-tip">控制要落在系统里，而不是提示词里</span></div>' +
          '<ul class="defense-list">' + r.defense.map(function (x) {
            return '<li><svg class="ic"><use href="#i-check"></use></svg><span>' + gl(esc(x)) + '</span></li>';
          }).join('') + '</ul></section>' +
        '<section class="section" id="sec-5"><div class="section-title"><span class="sec-no">05</span>典型场景</div>' +
          '<div class="scenario">' + gl(esc(r.scenario)) + '</div></section>' +
        '<section class="section" id="sec-6"><div class="section-title"><span class="sec-no">06</span>随堂小测</div>' +
          miniQuizHTML(r) + '</section>' +
        '<div class="pager">' +
          (prev ? '<a class="btn" href="#/risk/' + prev.code + '"><span>← ' + esc(prev.code) + ' ' + esc(prev.title) + '</span></a>' : '<span></span>') +
          (next ? '<a class="btn" href="#/risk/' + next.code + '"><span>' + esc(next.code) + ' ' + esc(next.title) + ' →</span></a>' : '<span></span>') +
        '</div>' +
      '</div><aside class="detail-toc"><h4>本页目录</h4>' + toc.map(function (t, i) {
        return '<a href="#" class="' + (i === 0 ? 'active' : '') + '" data-scroll="' + t[0] + '">' + esc(t[1]) + '</a>';
      }).join('') +
        '<div class="divider"></div><p class="tiny muted">难度：' + LEVEL_NAME[r.level] + '<br>所属：' + esc(c.short) + '<br>演示：' + esc(DEMO_LABEL[r.demo.type] || '交互演示') + '</p></aside></div></div>';
  }
  function wireRisk(r) {
    NS.demos.render(r, $('[data-demo-host]'));
    if (NS.demos.renderRange) NS.demos.renderRange(r, $('[data-range-host]'));
    $$('[data-dtab]').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('[data-dtab]').forEach(function (x) {
          x.classList.remove('active');
          x.setAttribute('aria-selected', 'false');
        });
        b.classList.add('active');
        b.setAttribute('aria-selected', 'true');
        var demo = $('[data-demo-host]'), range = $('[data-range-host]');
        demo.hidden = b.dataset.dtab !== 'demo';
        range.hidden = b.dataset.dtab !== 'range';
        var note = $('[data-dtab-note]');
        if (note) note.textContent = b.dataset.dtab === 'demo'
          ? (DEMO_LABEL[r.demo.type] || '交互演示')
          : '靶场演练 · ' + r.code;
      });
    });
    var readBtn = $('[data-read-btn]');
    if (readBtn && !S.read[r.code]) readBtn.addEventListener('click', function () { markRead(r.code); });
    $$('[data-scroll]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var t = document.getElementById(a.dataset.scroll);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        $$('[data-scroll]').forEach(function (x) { x.classList.remove('active'); });
        a.classList.add('active');
      });
    });
    var quizBox = $('[data-mini-quiz]');
    quizBox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-opt]');
      if (!b || quizBox.dataset.answered) return;
      quizBox.dataset.answered = '1';
      var pick = b.dataset.orig !== undefined ? +b.dataset.orig : +b.dataset.opt;
      var right = r.quiz.a === pick;
      $$('[data-opt]', quizBox).forEach(function (x) {
        var orig = x.dataset.orig !== undefined ? +x.dataset.orig : +x.dataset.opt;
        x.disabled = true;
        if (orig === r.quiz.a) x.classList.add('correct');
        else if (orig === pick) x.classList.add('wrong');
      });
      $('[data-mini-result]', quizBox).innerHTML = '<div class="quiz-explain"><b>' + (right ? '答对了。' : '再想一想。') + '</b> ' + gl(esc(r.quiz.e)) + '</div>';
      S.mini[r.code] = right ? 1 : 0;
      if (right) S.quiz.ok[r.code] = (S.quiz.ok[r.code] || 0) + 1;
      save();
      if (right) markRead(r.code, true);
    });
    S.visited[r.code] = Date.now();
    save();
  }

  /* ---------------- 页面：学习路径 ---------------- */
  function viewPath() {
    var done = donePathSteps(), total = totalPathSteps();
    var nextStep = null;
    for (var i = 0; i < PATHS.length && !nextStep; i++) {
      for (var j = 0; j < PATHS[i].steps.length; j++) {
        if (!S.read[PATHS[i].steps[j].code]) { nextStep = PATHS[i].steps[j].code; break; }
      }
    }
    return '<div class="page"><div class="page-head"><div class="eyebrow">新手友好 · 引导路径</div>' +
      '<h1>按难度，走一条不迷路的线</h1>' +
      '<p class="lead">' + RISKS.length + ' 条风险不必一次看完。下面 ' + PATHS.length + ' 个阶段共 ' + total + ' 步，先建立 AI 与安全基础直觉，再顺着金融企业网络的攻击路径深入，最后以合规治理收口。每一步都说明「为什么先学它」。</p></div>' +
      '<div class="card card-pad" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:14px">' +
        '<div style="flex:1;min-width:220px"><b>当前进度：' + done + ' / ' + total + ' 步（' + pct(done, total) + '%）</b>' +
        '<div class="cat-bar" style="margin-top:10px"><i style="--w:' + pct(done, total) + '%;background:var(--brand)"></i></div></div>' +
        (nextStep ? '<a class="btn primary" href="#/risk/' + nextStep + '">继续下一步 → ' + esc(RISK_MAP[nextStep].title) + '</a>'
                  : '<span class="badge ok">全部完成，去做综合测验吧</span>') +
        '<a class="btn" href="#/lab?stage=' + (nextStep && RISK_MAP[nextStep].stages[0] ? D.STAGE_MAP[RISK_MAP[nextStep].stages[0]].no : 1) + '"><svg class="ic"><use href="#i-map"></use></svg>在攻击路径中看全貌</a>' +
      '</div>' +
      PATHS.map(function (p, i) {
        var d = p.steps.filter(function (x) { return S.read[x.code]; }).length;
        return '<div class="path-stage"><div class="path-stage-head"><span class="stage-no">' + (i + 1) + '</span>' +
          '<div><h3>' + esc(p.title) + '</h3><p>' + esc(p.desc) + '</p></div>' +
          '<span class="stage-progress">' + d + ' / ' + p.steps.length + ' 已完成</span></div>' +
          p.steps.map(function (x, j) {
            var r = RISK_MAP[x.code];
            return '<div class="path-step' + (S.read[x.code] ? ' done' : '') + '">' +
              '<span class="ps-check"><svg class="ic"><use href="#i-check"></use></svg></span>' +
              '<div class="ps-body"><b>' + esc(x.code) + ' · ' + esc(r.title) + '</b><span>' + gl(esc(x.why)) + '</span></div>' +
              '<a class="path-link" href="#/risk/' + x.code + '">' + (S.read[x.code] ? '复习' : '开始') + ' →</a></div>';
          }).join('') + '</div>';
      }).join('') + '</div>';
  }

  /* ---------------- 页面：测验 ---------------- */
  var QS = null; // {ids, i, right, wrong[], finished, scopeLabel}
  var QUIZ_LAST_HASH = '';
  function quizNormalize(o) {
    o = o || {};
    return {
      cat: o.cat || 'all',
      level: o.level || 'all',
      count: String(o.count || '5'),
      mode: o.mode === 'wrong' ? 'wrong' : 'normal',
      type: o.type === 'practical' ? 'practical' : 'choice'
    };
  }
  function quizSignature(o) {
    var q = quizNormalize(o);
    return [q.cat, q.level, q.count, q.mode, q.type].join('|');
  }
  function quizFind(code) { return ALL_BANK.byCode[code] || PRACTICAL.byCode[code]; }
  function quizIsPractical(t) { return !!(t && t.options && t.key && t.code.indexOf('P-') === 0); }
  /* 可注入随机源：默认 Math.random；给定种子则产出可复现的伪随机序列（测试用） */
  function makeRng(seed) {
    if (typeof seed === 'function') return seed;
    if (seed == null) return Math.random;
    var s = (typeof seed === 'number' ? seed : 0) >>> 0;
    if (typeof seed === 'string') {
      for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function quizPool(o) {
    var practical = o.type === 'practical';
    var list = practical ? PRACTICAL.list.slice() : ALL_BANK.list.slice();
    if (o.cat && o.cat !== 'all') list = list.filter(function (r) { return r.cat === o.cat; });
    if (o.level && o.level !== 'all') list = list.filter(function (r) { return String(r.level) === o.level; });
    if (o.mode === 'wrong') {
      var wrongBox = practical ? S.practical.wrong : S.quiz.wrong;
      var w = list.filter(function (r) { return wrongBox[r.code]; });
      if (w.length) list = w;
    }
    return list;
  }
  /* ---------------- 洗牌（Fisher-Yates） ----------------
   * 统一入口：可注入随机源（默认 Math.random），便于复现与测试；
   * 禁止「随机数减 0.5 再排序」这类无偏性差的写法（正确项易聚集在同一位置）。 */
  function shuffle(arr, rnd) {
    var r = rnd || Math.random;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  /* 展示序洗牌：返回 { items, order }，order[i] = 展示位 i 对应的原始索引
   * 判定始终使用原始索引 r.quiz.a，避免洗牌后错判。 */
  function displayOrder(opts, rnd) {
    var n = (opts && opts.length) || 0;
    var idx = [];
    for (var i = 0; i < n; i++) idx.push(i);
    var order = shuffle(idx, rnd);
    return { items: order.map(function (i) { return opts[i]; }), order: order };
  }
  function quizStart(o, rnd) {
    o = quizNormalize(o);
    var pool = quizPool(o);
    if (!pool.length) { toast('没有符合条件的题目'); return; }
    var random = makeRng(rnd);
    var shuffled = shuffle(pool, random).slice(0, +o.count || 5);
    QS = { ids: shuffled.map(function (r) { return r.code; }), i: 0, right: 0, wrong: [], finished: false, o: o };
    render();
  }
  function quizView() {
    var q = parseHash().query;
    var qLevel = q.level || 'all', qCount = q.count || '5', qMode = q.mode === 'wrong' ? 'wrong' : 'normal';
    var qCat = q.cat || 'all', qType = q.type === 'practical' ? 'practical' : 'choice';
    var total = S.quiz.total, acc = total ? Math.round(S.quiz.right / total * 100) : 0;
    var wrongCount = qType === 'practical' ? Object.keys(S.practical.wrong).length : Object.keys(S.quiz.wrong).length;
    var head = '<div class="page-head"><div class="eyebrow">检验理解</div><h1>测验中心</h1>' +
      '<p class="lead">AI安全题库共 <b>' + ALL_BANK.list.length + '</b> 道单选题 + <b>' + PRACTICAL.total + '</b> 道实操题，覆盖九大知识域。单选题考「知道」，实操题考「做到」：完成配置、步骤或产物清单后按关键项与终态部分得分。</p></div>' +
      '<div class="quiz-stat-strip"><span><b>' + ALL_BANK.list.length + '</b>单选总题数</span><span><b>' + PRACTICAL.total + '</b>实操题</span><span><b>' + total + '</b>累计答题</span><span><b>' + acc + '%</b>正确率</span>' +
        '<span><b>' + practicalPassedCount() + '</b>实操通过</span><span><b>' + wrongCount + '</b>待复习错题</span></div>';
    if (!QS || QS.finished && QS.dismissed) {
      return '<div class="page">' + head +
        '<div class="card card-pad"><div class="section-title" style="margin-top:0"><span class="sec-no">01</span>选择范围</div>' +
        '<div class="control-group"><label>题型</label><div class="seg" data-q-type>' +
          '<button type="button" data-val="choice"' + (qType !== 'practical' ? ' class="active"' : '') + '>单选题（' + ALL_BANK.list.length + '）</button>' +
          '<button type="button" data-val="practical"' + (qType === 'practical' ? ' class="active"' : '') + '>实操题（' + PRACTICAL.total + '）</button></div></div>' +
        '<div class="quiz-setup">' +
          '<div class="control-group"><label>知识域</label><div class="field"><select data-q-cat>' +
            '<option value="all">全部知识域</option>' + CATS.map(function (c) {
              var n = (qType === 'practical' ? PRACTICAL.byCat[c.id] || [] : ALL_BANK.list.filter(function (q) { return q.cat === c.id; })).length;
              return '<option value="' + c.id + '"' + (qCat === c.id ? ' selected' : '') + '>' + esc(c.short) + '（' + n + '）</option>';
            }).join('') +
          '</select></div></div>' +
          '<div class="control-group"><label>难度</label><div class="field"><select data-q-level>' +
            [['all', '全部难度'], ['1', '入门'], ['2', '进阶'], ['3', '挑战']].map(function (x) {
              return '<option value="' + x[0] + '"' + (qLevel === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
            }).join('') + '</select></div></div>' +
          '<div class="control-group"><label>题量与模式</label><div class="field"><select data-q-count>' +
            (['5', '10', '20'].indexOf(qCount) < 0 ? [[qCount, qCount + ' 题 · 自定义']] : []).concat(
              [['5', '5 题 · 快速'], ['10', '10 题 · 标准'], ['20', '20 题 · 挑战']]
            ).map(function (x) {
              return '<option value="' + x[0] + '"' + (qCount === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
            }).join('') + '</select></div></div>' +
        '</div>' +
        '<div class="control-group" style="margin-top:16px"><label>模式</label>' + segHTML(qMode) + '</div>' +
        '<div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
          '<button class="btn primary" type="button" data-q-start>开始测验 <svg class="ic"><use href="#i-arrow"></use></svg></button>' +
          (wrongCount ? '<button class="btn" type="button" data-q-wrong>只练错题（' + wrongCount + '）</button>' : '') +
          '<span class="small muted">当前筛选可选 <b data-q-avail>' + quizPool({ cat: qCat, level: qLevel, mode: qMode, type: qType }).length + '</b> 题</span>' +
        '</div></div>' +
        '<div class="section"><div class="section-title"><span class="sec-no">02</span>测验怎么算</div>' +
        '<div class="card card-pad small muted">' +
          (qType === 'practical'
            ? '实操题按「关键项命中 50% + 顺序正确 30% + 终态命中 20%」计分，禁用动作每项扣 15 分、查看提示扣 10 分；≥60 通过、≥85 熟练。判分是本地纯规则比对，不执行你输入的任何内容。'
            : '每题单选，选择后立即显示正确答案与解析；答对的条目会自动计入学习进度，答错的进入错题本，可随时重练。') +
          ' 所有记录只保存在本机浏览器。</div></div></div>';
    }
    if (QS.finished) return '<div class="page">' + head + quizResultHTML() + '</div>';
    return '<div class="page">' + head + quizQuestionHTML() + '</div>';
  }
  function segHTML(mode) {
    return '<div class="seg" data-q-mode>' +
      '<button type="button" data-val="normal"' + (mode !== 'wrong' ? ' class="active"' : '') + '>标准抽题</button>' +
      '<button type="button" data-val="wrong"' + (mode === 'wrong' ? ' class="active"' : '') + '>错题优先</button></div>';
  }
  function quizCatShort(r) {
    return D.CAT_MAP[r.cat] ? D.CAT_MAP[r.cat].short : '';
  }
  function practicalQuestionHTML(t) {
    var label = { config: '配置终态', steps: '有序步骤', output: '产物清单' }[t.type] || t.type;
    var typeTip = t.type === 'steps' ? '请按处置顺序依次点击选项；顺序会计入评分。'
      : t.type === 'config' ? '请选择你认为应启用的配置组合（可多选）。'
      : '请选择应包含的内容项（可多选）。';
    return '<div class="card quiz-card practical-card" data-practical-card data-p-code="' + esc(t.code) + '">' +
      '<div class="quiz-progress"><span>第 ' + (QS.i + 1) + ' / ' + QS.ids.length + ' 题</span>' +
        '<span class="qp-track"><i style="width:' + (QS.i / QS.ids.length * 100) + '%"></i></span>' +
        '<span>' + esc(quizCatShort(t)) + ' · ' + esc(t.code) + '</span></div>' +
      '<div class="pq-head"><span class="badge warn">' + esc(label) + '</span>' +
        (RISK_MAP[t.risk] ? '<a class="badge" href="#/risk/' + t.risk + '">关联 ' + esc(t.risk) + ' ' + esc(RISK_MAP[t.risk].title) + '</a>' : '') + '</div>' +
      '<div class="quiz-q">' + esc(t.title) + '</div>' +
      '<p class="small muted pq-scene">' + esc(t.scene) + '</p>' +
      '<p class="tiny muted">' + esc(typeTip) + '</p>' +
      '<div class="pq-options">' + t.options.map(function (o, i) {
        return '<button type="button" class="pq-opt" data-p-opt="' + esc(o.id) + '"><span class="pq-seq" data-p-seq hidden></span>' +
          '<span>' + esc(o.label) + '</span><span class="pq-check">✓</span></button>';
      }).join('') + '</div>' +
      '<div class="pq-tools"><button class="btn ghost small" type="button" data-p-hint>查看提示（扣 10 分）</button>' +
        '<span class="small muted" data-p-hint-text></span></div>' +
      '<div data-q-feedback class="quiz-feedback"></div>' +
      '<div class="quiz-nav"><a class="btn ghost small" href="#/quiz?type=practical" data-q-exit>退出本次测验</a>' +
        '<button class="btn primary small" type="button" data-p-submit disabled>提交作答</button>' +
        '<button class="btn primary small" type="button" data-q-next hidden>下一题 →</button></div></div>';
  }
  function quizQuestionHTML() {
    var r = quizFind(QS.ids[QS.i]);
    if (quizIsPractical(r)) return practicalQuestionHTML(r);
    /* 展示序洗牌：打散正确项在选项中的固定位置；判定仍用原始索引 r.quiz.a */
    var disp = displayOrder(r.quiz.o);
    QS.dispOrder = disp.order;
    return '<div class="card quiz-card" data-quiz-card>' +
      '<div class="quiz-progress"><span>第 ' + (QS.i + 1) + ' / ' + QS.ids.length + ' 题</span>' +
        '<span class="qp-track"><i style="width:' + (QS.i / QS.ids.length * 100) + '%"></i></span>' +
        '<span>' + esc(quizCatShort(r)) + ' · ' + esc(r.code) + '</span></div>' +
      '<div class="quiz-q">' + esc(r.quiz.q) + '</div>' +
      '<div class="quiz-options">' + disp.items.map(function (o, i) {
        return '<button type="button" class="choice" data-q-opt="' + i + '" data-q-orig="' + disp.order[i] + '"><span class="choice-key">' + 'ABCD'[i] + '</span><span>' + esc(o) + '</span></button>';
      }).join('') + '</div>' +
      '<div data-q-feedback class="quiz-feedback"></div>' +
      '<div class="quiz-nav"><a class="btn ghost small" href="#/quiz" data-q-exit>退出本次测验</a>' +
        '<button class="btn primary small" type="button" data-q-next disabled>下一题 →</button></div></div>';
  }
  function quizResultHTML() {
    var n = QS.ids.length;
    var practical = QS.o && QS.o.type === 'practical';
    var p = practical ? pct(QS.right, n * 100) : pct(QS.right, n);
    return '<div class="card quiz-result"><div class="score-ring" style="--p:' + p + '%"><span>' + p + '</span></div>' +
      '<h2>' + (practical ? (p >= 85 ? '实操熟练' : p >= 60 ? '实操通过' : '还需练习')
        : p >= 80 ? '掌握得不错' : p >= 60 ? '继续巩固一下' : '建议回到引导路径复习') + '</h2>' +
      '<p class="muted">' + (practical ? '实操平均得分 ' : '答对 ') + QS.right + ' / ' + n + ' 题 · ' + (practical ? '平均' : '') + '得分率 ' + p + '%</p>' +
      (QS.wrong.length ? '<div class="wrong-list"><b class="small">' + (practical ? '未通过回顾' : '错题回顾') + '</b>' + QS.wrong.map(function (code) {
        var r = quizFind(code);
        var detail = practical && QS.detail && QS.detail[code] ? QS.detail[code] : '';
        var inner = '<span class="rl-code">' + esc(code) + '</span><span>' + esc(r.title || r.code) + (detail ? ' — ' + esc(detail) : (r.quiz && r.quiz.e ? ' — ' + esc(r.quiz.e) : '')) + '</span>' +
          '<button class="btn ghost small" type="button" data-add-card="' + esc(code) + '">加入卡片</button>';
        return '<div class="wrong-row">' + (RISK_MAP[code] ? '<a href="#/risk/' + code + '">' + inner + '</a>' : inner) + '</div>';
      }).join('') + '</div>' : '<p class="badge ok" style="margin-top:14px">全部通过，没有错题</p>') +
      '<div style="margin-top:22px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
        '<button class="btn primary" type="button" data-q-again>再来一组</button>' +
        '<button class="btn" type="button" data-q-back>返回设置</button>' +
        '<a class="btn" href="#/progress">查看进度</a></div></div>';
  }
  function wireQuiz() {
    var startBtn = $('[data-q-start]');
    if (startBtn) {
      var modeBox = $('[data-q-mode]');
      var typeBox = $('[data-q-type]');
      var query = parseHash().query;
      var mode = query.mode === 'wrong' ? 'wrong' : 'normal';
      var type = query.type === 'practical' ? 'practical' : 'choice';
      var availEl = $('[data-q-avail]');
      function refreshAvail() {
        if (!availEl) return;
        var o = { cat: $('[data-q-cat]').value, level: $('[data-q-level]').value, mode: mode, type: type };
        availEl.textContent = quizPool(o).length;
      }
      function bindSeg(box, cb) {
        if (!box) return;
        box.addEventListener('click', function (e) {
          var b = e.target.closest('button[data-val]'); if (!b) return;
          $$('button', box).forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active'); cb(b.dataset.val); refreshAvail();
        });
      }
      bindSeg(modeBox, function (v) { mode = v; });
      bindSeg(typeBox, function (v) {
        type = v;
        var q = Object.assign({}, query); q.type = v;
        if (v === 'choice') delete q.type;
        go('#/quiz' + (Object.keys(q).length ? '?' + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&') : ''));
      });
      ['[data-q-cat]', '[data-q-level]'].forEach(function (sel) {
        var el = $(sel); if (el) el.addEventListener('change', refreshAvail);
      });
      startBtn.addEventListener('click', function () {
        quizStart({ cat: $('[data-q-cat]').value, level: $('[data-q-level]').value, count: $('[data-q-count]').value, mode: mode, type: type });
      });
      var wbtn = $('[data-q-wrong]');
      if (wbtn) wbtn.addEventListener('click', function () {
        var box = type === 'practical' ? S.practical.wrong : S.quiz.wrong;
        quizStart({ cat: 'all', level: 'all', count: String(Math.min(20, Object.keys(box).length)), mode: 'wrong', type: type });
      });
    }
    /* 实操题：多选 + 顺序 + 提交判分 */
    var pc = $('[data-practical-card]');
    if (pc) {
      var t = quizFind(pc.dataset.pCode);
      var picked = [];
      var usedHint = false;
      pc.addEventListener('click', function (e) {
        var opt = e.target.closest('[data-p-opt]');
        if (opt) {
          var id = opt.dataset.pOpt;
          var at = picked.indexOf(id);
          if (at >= 0) { picked.splice(at, 1); opt.classList.remove('selected'); }
          else { picked.push(id); opt.classList.add('selected'); }
          if (t.type === 'steps') {
            $$('[data-p-opt]', pc).forEach(function (x) { x.querySelector('[data-p-seq]').hidden = true; });
            picked.forEach(function (pid, i) {
              var b = $('[data-p-opt="' + pid + '"]', pc);
              if (b) { var sq = b.querySelector('[data-p-seq]'); sq.textContent = i + 1; sq.hidden = false; }
            });
          }
          $('[data-p-submit]', pc).disabled = !picked.length;
          return;
        }
        var hint = e.target.closest('[data-p-hint]');
        if (hint && !usedHint) {
          usedHint = true;
          $('[data-p-hint-text]', pc).textContent = t.hint || '先分输入侧、系统侧、出口侧三层来想。';
          hint.disabled = true;
          return;
        }
        var submit = e.target.closest('[data-p-submit]');
        if (submit && picked.length && !pc.dataset.answered) {
          pc.dataset.answered = '1';
          var res = PRACTICAL.score(t, { picked: picked, hint: usedHint });
          var pass = res.pass;
          QS.right += res.score;
          QS.detail = QS.detail || {};
          QS.detail[t.code] = '得分 ' + res.score + '（关键项 ' + res.rates.steps + '% · 顺序 ' + res.rates.order + '% · 终态 ' + res.rates.target + '%）';
          if (!res.miss.length && !res.bad.length && !res.extra.length) QS.detail[t.code] += '；完全命中';
          else {
            if (res.miss.length) QS.detail[t.code] += '；漏选 ' + res.miss.length + ' 项';
            if (res.bad.length) QS.detail[t.code] += '；用了禁用动作';
            if (res.extra.length) QS.detail[t.code] += '；多选 ' + res.extra.length + ' 项';
          }
          var first = S.practical.attempts[t.code];
          S.practical.attempts[t.code] = {
            score: Math.max(res.score, first ? first.score : 0),
            last: res.score, pass: pass || (first && first.pass),
            at: Date.now(), times: (first && first.times ? first.times : 0) + 1,
            detail: QS.detail[t.code]
          };
          S.practical.total++;
          if (pass) { S.practical.passed++; delete S.practical.wrong[t.code]; }
          else { S.practical.wrong[t.code] = (S.practical.wrong[t.code] || 0) + 1; }
          save();
          $$('[data-p-opt]', pc).forEach(function (x) {
            x.disabled = true;
            if (t.key.indexOf(x.dataset.pOpt) >= 0) x.classList.add('correct');
            else if (picked.indexOf(x.dataset.pOpt) >= 0) x.classList.add('wrong');
          });
          $('[data-q-feedback]', pc).innerHTML = '<div class="verdict ' + (pass ? 'ok' : 'bad') + '"><b>' +
            (res.master ? '实操熟练 · ' : pass ? '实操通过 · ' : '未通过 · ') + res.score + ' 分</b>' +
            esc(QS.detail[t.code]) + '。依据：' + esc(t.basis) + '</div>' +
            (RISK_MAP[t.risk] ? '<a class="btn ghost small" style="margin-top:8px" href="#/risk/' + t.risk + '">回看风险 ' + esc(t.risk) + '</a>' : '');
          submit.hidden = true;
          var nb = $('[data-q-next]', pc); nb.hidden = false;
          nb.textContent = QS.i + 1 >= QS.ids.length ? '查看结果 →' : '下一题 →';
        }
      });
    }
    var again = $('[data-q-again]');
    if (again) again.addEventListener('click', function () { quizStart(QS.o); });
    var back = $('[data-q-back]');
    if (back) back.addEventListener('click', function () { QS.dismissed = true; render(); });
    var exit = $('[data-q-exit]');
    if (exit) exit.addEventListener('click', function (e) { e.preventDefault(); QS = null; render(); });
    $$('[data-add-card]').forEach(function (b) {
      b.addEventListener('click', function () {
        var code = b.dataset.addCard;
        var src = RISK_MAP[code] || PRACTICAL.byCode[code];
        var pid = 'CU-from-' + code;
        if (S.cards.custom.some(function (c) { return c.id === pid; })) { toast('这张卡片已在「我的卡片」里'); return; }
        var front = src && src.quiz && src.quiz.q ? src.quiz.q : (src ? src.title : code);
        var backText = src && src.quiz && src.quiz.e ? src.quiz.e : (src ? src.title : '');
        S.cards.custom.unshift({
          id: pid, code: code, cat: src && src.cat ? src.cat : 'custom',
          front: front, back: backText, core: src && src.brief ? src.brief : '',
          memory: '', basis: src && src.basis ? src.basis : '错题转化',
          seeAlso: [], tags: ['机制'], level: src && src.level ? src.level : 1,
          stage: '', custom: true
        });
        save(); toast('已加入「我的卡片」');
      });
    });
    var card = $('[data-quiz-card]');
    if (!card || !QS || QS.finished) return;
    var r = quizFind(QS.ids[QS.i]);
    var isSite = !!RISK_MAP[r.code];
    card.addEventListener('click', function (e) {
      var b = e.target.closest('[data-q-opt]');
      if (!b || card.dataset.answered) return;
      card.dataset.answered = '1';
      var pick = b.dataset.qOrig !== undefined ? +b.dataset.qOrig : +b.dataset.qOpt;
      var right = pick === r.quiz.a;
      $$('[data-q-opt]', card).forEach(function (x) {
        var orig = x.dataset.qOrig !== undefined ? +x.dataset.qOrig : +x.dataset.qOpt;
        x.disabled = true;
        if (orig === r.quiz.a) x.classList.add('correct');
        else if (orig === pick) x.classList.add('wrong');
      });
      if (right) {
        QS.right++; delete S.quiz.wrong[r.code];
        if (isSite) S.quiz.ok[r.code] = (S.quiz.ok[r.code] || 0) + 1;
        if (isSite) markRead(r.code, true);
      }
      else { QS.wrong.push(r.code); S.quiz.wrong[r.code] = (S.quiz.wrong[r.code] || 0) + 1; }
      S.quiz.total++; S.quiz.right += right ? 1 : 0;
      save();
      $('[data-q-feedback]', card).innerHTML = '<div class="verdict ' + (right ? 'ok' : 'bad') + '"><b>' +
        (right ? '回答正确' : '回答错误') + '</b>' + gl(esc(r.quiz.e)) + '</div>';
      var nb = $('[data-q-next]', card);
      nb.disabled = false;
      nb.textContent = QS.i + 1 >= QS.ids.length ? '查看结果 →' : '下一题 →';
    });
    $('[data-q-next]', card).addEventListener('click', function () {
      QS.i++;
      if (QS.i >= QS.ids.length) QS.finished = true;
      render();
    });
  }

  /* ---------------- 页面：知识卡片（记忆 · 完整 SM-2） ---------------- */
  var CARD_SEQ = null; /* { ids, i, mode } 复习队列 */
  function cardView() {
    var route = parseHash();
    var view = route.query.view === 'mine' ? 'mine' : 'review';
    var filter = {
      cat: route.query.cat || 'all', tag: route.query.tag || 'all', level: route.query.level || 'all',
      status: route.query.status || 'all'
    };
    var cards = allCards();
    var now = Date.now();
    var due = cards.filter(function (c) { return CARDS.isDue(S.cards.reviews[c.id], now); });
    var mastered = cardMasteredCount();
    var head = '<div class="page-head"><div class="eyebrow">记忆 · 间隔重复</div><h1>知识卡片</h1>' +
      '<p class="lead">用完整 SM-2 算法安排复习：每张卡片按你的自评（忘了 / 模糊 / 记得）调整难度因子与下次到期时间。内置 <b>' + CARDS.builtin.length + '</b> 张覆盖全部风险，也支持新建自己的卡片。所有记录只保存在本机。</p></div>' +
      '<div class="quiz-stat-strip"><span><b>' + due.length + '</b>今日待复习</span><span><b>' + mastered + '</b>已记住</span>' +
        '<span><b>' + S.cards.streak + '</b>连续天数</span><span><b>' + S.cards.custom.length + '</b>自建卡片</span>' +
        '<span><b>' + cards.length + '</b>卡片总数</span></div>';

    if (CARD_SEQ && CARD_SEQ.ids.length) return '<div class="page">' + head + cardStudyHTML() + '</div>';

    var filtered = cards.filter(function (c) {
      if (view === 'mine' && !c.custom) return false;
      if (filter.cat !== 'all' && c.cat !== filter.cat) return false;
      if (filter.tag !== 'all' && (c.tags || []).indexOf(filter.tag) < 0) return false;
      if (filter.level !== 'all' && String(c.level) !== filter.level) return false;
      if (filter.status === 'due' && !CARDS.isDue(S.cards.reviews[c.id], now)) return false;
      if (filter.status === 'mastered' && !(S.cards.reviews[c.id] && S.cards.reviews[c.id].reps >= 3)) return false;
      if (filter.status === 'new' && S.cards.reviews[c.id]) return false;
      return true;
    });
    var allTags = {};
    cards.forEach(function (c) { (c.tags || []).forEach(function (t) { allTags[t] = 1; }); });
    return '<div class="page">' + head +
      '<div class="card card-pad"><div class="section-title" style="margin-top:0"><span class="sec-no">01</span>筛选范围</div>' +
      '<div class="card-filters">' +
        '<div class="control-group"><label>视图</label><div class="seg" data-card-view>' +
          '<button type="button" data-val="review"' + (view !== 'mine' ? ' class="active"' : '') + '>全部卡片</button>' +
          '<button type="button" data-val="mine"' + (view === 'mine' ? ' class="active"' : '') + '>只看自建</button></div></div>' +
        '<div class="control-group"><label>知识域</label><div class="field"><select data-card-cat>' +
          '<option value="all">全部（' + cards.length + '）</option>' + CATS.map(function (c) {
            var n = cards.filter(function (x) { return x.cat === c.id; }).length;
            return '<option value="' + c.id + '"' + (filter.cat === c.id ? ' selected' : '') + '>' + esc(c.short) + '（' + n + '）</option>';
          }).join('') + '</select></div></div>' +
        '<div class="control-group"><label>标签</label><div class="field"><select data-card-tag>' +
          '<option value="all">全部标签</option>' + CARDS.TAGS.map(function (t) {
            return '<option value="' + t + '"' + (filter.tag === t ? ' selected' : '') + '>' + t + '</option>';
          }).join('') + '</select></div></div>' +
        '<div class="control-group"><label>难度</label><div class="field"><select data-card-level>' +
          '<option value="all">全部难度</option>' + [[1, '入门'], [2, '进阶'], [3, '挑战']].map(function (x) {
            return '<option value="' + x[0] + '"' + (filter.level === String(x[0]) ? ' selected' : '') + '>' + x[1] + '</option>';
          }).join('') + '</select></div></div>' +
        '<div class="control-group"><label>复习状态</label><div class="field"><select data-card-status>' +
          [['all', '全部'], ['due', '待复习'], ['new', '未学'], ['mastered', '已记住']].map(function (x) {
            return '<option value="' + x[0] + '"' + (filter.status === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
          }).join('') + '</select></div></div>' +
      '</div>' +
      '<div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">' +
        '<button class="btn primary" type="button" data-card-start' + (filtered.length ? '' : ' disabled') + '>开始复习（' + filtered.length + '）</button>' +
        '<button class="btn" type="button" data-card-new>＋ 新建卡片</button>' +
        '<span class="small muted">当前筛选 <b>' + filtered.length + '</b> 张 · 今日上限 ' + S.cards.dailyGoal + ' 张</span></div>' +
      '</div>' +
      '<div class="section"><div class="section-title"><span class="sec-no">02</span>卡片一览<span class="sec-tip">翻转查看要点，点击「去练习」联动测验</span></div>' +
      (filtered.length ? '<div class="card-grid">' + filtered.slice(0, 60).map(function (c) {
        var st = S.cards.reviews[c.id];
        var dueNow = CARDS.isDue(st, now);
        return '<div class="mini-card" data-card-id="' + esc(c.id) + '" style="--cat:' + (D.CAT_MAP[c.cat] ? D.CAT_MAP[c.cat].color : 'var(--brand)') + '">' +
          '<div class="mc-head"><span class="mc-id">' + esc(c.custom ? '自建' : c.code) + '</span>' +
            '<span class="mc-state ' + (st && st.reps >= 3 ? 'ok' : dueNow ? 'warn' : '') + '">' + esc(CARDS.boxLabel(st)) + '</span></div>' +
          '<div class="mc-front">' + esc(c.front) + '</div>' +
          '<div class="mc-tags">' + (c.tags || []).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' +
          '<div class="mc-actions"><button type="button" class="btn ghost small" data-card-flip>看答案</button>' +
            (c.code && RISK_MAP[c.code] ? '<a class="btn ghost small" href="#/risk/' + c.code + '">看风险</a>' : '') +
            (c.custom ? '<button type="button" class="btn ghost small" data-card-edit>编辑</button><button type="button" class="btn ghost small" data-card-del>删除</button>' : '') +
          '</div><div class="mc-back" hidden>' + esc(c.back) + (c.memory ? '<div class="mc-mem">记忆锚：' + esc(c.memory) + '</div>' : '') + '</div></div>';
      }).join('') + '</div>' + (filtered.length > 60 ? '<p class="small muted">仅显示前 60 张，可用筛选缩小范围。</p>' : '')
        : '<div class="empty-state"><svg class="ic"><use href="#i-book"></use></svg><p>没有符合条件的卡片。换个筛选或新建一张。</p></div>') +
      '</div>' + (CARD_EDITOR ? cardEditorHTML(CARD_EDITOR) : '') + '</div>';
  }
  function cardStudyHTML() {
    var c = cardMap()[CARD_SEQ.ids[CARD_SEQ.i]];
    if (!c) return '<div class="empty-state">卡片数据异常，<a href="#/cards">返回卡片列表</a></div>';
    var st = S.cards.reviews[c.id];
    return '<div class="study-card" data-study-card style="--cat:' + (D.CAT_MAP[c.cat] ? D.CAT_MAP[c.cat].color : 'var(--brand)') + '">' +
      '<div class="study-top"><span>复习 ' + (CARD_SEQ.i + 1) + ' / ' + CARD_SEQ.ids.length + '</span>' +
        '<span>' + esc(CARDS.boxLabel(st)) + ' · EF ' + (st ? st.ef.toFixed(2) : '2.50') + '</span></div>' +
      '<div class="study-face"><span class="study-label">正面 · 回忆一下</span><h2>' + esc(c.front) + '</h2>' +
        (c.tags || []).map(function (t) { return '<span class="badge">' + esc(t) + '</span>'; }).join('') + '</div>' +
      '<button class="btn primary" type="button" data-study-show' + (CARD_SEQ.flipped ? ' hidden' : '') + '>显示答案</button>' +
      '<div class="study-back"' + (CARD_SEQ.flipped ? '' : ' hidden') + '><span class="study-label">反面 · 对照</span>' +
        '<p>' + esc(c.back) + '</p>' + (c.core ? '<p class="small muted">一句话：' + esc(c.core) + '</p>' : '') +
        (c.memory ? '<p class="small">记忆锚：' + esc(c.memory) + '</p>' : '') +
        '<p class="tiny muted">依据：' + esc(c.basis) + '</p>' +
        '<div class="study-grade"><button class="btn" type="button" data-grade="forgot">忘了</button>' +
          '<button class="btn" type="button" data-grade="fuzzy">模糊</button>' +
          '<button class="btn primary" type="button" data-grade="remember">记得</button></div>' +
        '<div style="margin-top:10px">' + (c.code && RISK_MAP[c.code] ? '<a class="btn ghost small" href="#/risk/' + c.code + '">看风险详情</a> ' : '') +
          '<a class="btn ghost small" href="#/quiz?cat=' + (c.cat === 'custom' ? 'all' : c.cat) + '">去练习</a></div>' +
      '</div></div>';
  }
  var CARD_EDITOR = null;
  function cardEditorHTML(edit) {
    return '<div class="section"><div class="section-title"><span class="sec-no">03</span>' + (edit.id ? '编辑卡片' : '新建卡片') + '</div>' +
      '<div class="card card-pad"><div class="card-editor">' +
        '<div class="control-group"><label>正面（问题）</label><div class="field"><input data-ce-front value="' + esc(edit.front || '') + '" placeholder="写一个能自测的问题"></div></div>' +
        '<div class="control-group"><label>反面（答案）</label><div class="field"><textarea data-ce-back rows="3" placeholder="简明答案">' + esc(edit.back || '') + '</textarea></div></div>' +
        '<div class="card-editor-row">' +
          '<div class="control-group"><label>知识域</label><div class="field"><select data-ce-cat>' +
            '<option value="custom">自建 / 通用</option>' + CATS.map(function (c) {
              return '<option value="' + c.id + '"' + (edit.cat === c.id ? ' selected' : '') + '>' + esc(c.short) + '</option>';
            }).join('') + '</select></div></div>' +
          '<div class="control-group"><label>标签（逗号分隔）</label><div class="field"><input data-ce-tags value="' + esc((edit.tags || []).join(',')) + '" placeholder="机制,防护"></div></div>' +
          '<div class="control-group"><label>记忆锚（可选）</label><div class="field"><input data-ce-memory value="' + esc(edit.memory || '') + '" placeholder="一个便于记住的比方"></div></div>' +
        '</div>' +
        '<div style="display:flex;gap:10px;margin-top:14px"><button class="btn primary" type="button" data-ce-save>保存</button>' +
          '<button class="btn" type="button" data-ce-cancel>取消</button></div>' +
      '</div></div></div>';
  }
  function wireCards() {
    var viewBox = $('[data-card-view]');
    if (viewBox) viewBox.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-val]'); if (!b) return;
      go(b.dataset.val === 'mine' ? '#/cards?view=mine' : '#/cards');
    });
    [['[data-card-cat]', 'cat'], ['[data-card-tag]', 'tag'], ['[data-card-level]', 'level'], ['[data-card-status]', 'status']].forEach(function (pair) {
      var el = $(pair[0]); if (!el) return;
      el.addEventListener('change', function () {
        var route = parseHash(); var q = Object.assign({}, route.query);
        q[pair[1]] = el.value;
        if (q[pair[1]] === 'all') delete q[pair[1]];
        go('#/cards' + (Object.keys(q).length ? '?' + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&') : ''));
      });
    });
    var start = $('[data-card-start]');
    if (start) start.addEventListener('click', function () {
      var now = Date.now();
      var route = parseHash();
      var pool = allCards().filter(function (c) {
        if (route.query.view === 'mine' && !c.custom) return false;
        if (route.query.cat && route.query.cat !== 'all' && c.cat !== route.query.cat) return false;
        if (route.query.tag && route.query.tag !== 'all' && (c.tags || []).indexOf(route.query.tag) < 0) return false;
        if (route.query.level && route.query.level !== 'all' && String(c.level) !== route.query.level) return false;
        if (route.query.status === 'due' && !CARDS.isDue(S.cards.reviews[c.id], now)) return false;
        if (route.query.status === 'mastered' && !(S.cards.reviews[c.id] && S.cards.reviews[c.id].reps >= 3)) return false;
        if (route.query.status === 'new' && S.cards.reviews[c.id]) return false;
        return true;
      });
      /* 待复习优先，其余按到期时间排序；受每日上限约束 */
      pool.sort(function (a, b) {
        var da = CARDS.isDue(S.cards.reviews[a.id], now) ? 0 : 1;
        var db = CARDS.isDue(S.cards.reviews[b.id], now) ? 0 : 1;
        return da - db || a.index - b.index;
      });
      var ids = pool.slice(0, +S.cards.dailyGoal || 20).map(function (c) { return c.id; });
      if (!ids.length) { toast('没有符合条件的卡片'); return; }
      CARD_SEQ = { ids: ids, i: 0, flipped: false };
      render();
    });
    var newBtn = $('[data-card-new]');
    if (newBtn) newBtn.addEventListener('click', function () { CARD_EDITOR = { id: '', front: '', back: '', cat: 'custom', tags: [], memory: '' }; render(); });
    $$('[data-card-flip]').forEach(function (b) {
      b.addEventListener('click', function () {
        var el = b.closest('[data-card-id]'); var back = $('[data-card-id="' + el.dataset.cardId + '"] [data-card-back]');
        var target = el.querySelector('.mc-back');
        if (target) { target.hidden = !target.hidden; b.textContent = target.hidden ? '看答案' : '收起'; }
        if (back) back.hidden = false;
      });
    });
    $$('[data-card-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.closest('[data-card-id]').dataset.cardId;
        var c = S.cards.custom.filter(function (x) { return x.id === id; })[0];
        if (c) { CARD_EDITOR = Object.assign({}, c); render(); }
      });
    });
    $$('[data-card-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.closest('[data-card-id]').dataset.cardId;
        if (!confirm('删除这张自建卡片？复习记录也会一并移除。')) return;
        S.cards.custom = S.cards.custom.filter(function (x) { return x.id !== id; });
        delete S.cards.reviews[id]; save(); render(); toast('已删除卡片');
      });
    });
    var ceSave = $('[data-ce-save]');
    if (ceSave) ceSave.addEventListener('click', function () {
      var front = $('[data-ce-front]').value.trim(), back = $('[data-ce-back]').value.trim();
      if (!front || !back) { toast('正面与反面都要填写'); return; }
      var id = CARD_EDITOR.id || ('CU-' + Date.now().toString(36).toUpperCase());
      var tags = $('[data-ce-tags]').value.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
      var rec = {
        id: id, code: CARD_EDITOR.code || '', cat: $('[data-ce-cat]').value,
        front: front, back: back, core: CARD_EDITOR.core || '', memory: $('[data-ce-memory]').value.trim(),
        basis: CARD_EDITOR.basis || '自建卡片', seeAlso: CARD_EDITOR.seeAlso || [],
        tags: tags.length ? tags : ['机制'], level: CARD_EDITOR.level || 1, stage: CARD_EDITOR.stage || '', custom: true
      };
      if (CARD_EDITOR.id) S.cards.custom = S.cards.custom.map(function (x) { return x.id === id ? rec : x; });
      else S.cards.custom.unshift(rec);
      CARD_EDITOR = null; save(); render(); toast('卡片已保存');
    });
    var ceCancel = $('[data-ce-cancel]');
    if (ceCancel) ceCancel.addEventListener('click', function () { CARD_EDITOR = null; render(); });

    var study = $('[data-study-card]');
    if (!study) return;
    var show = $('[data-study-show]', study);
    if (show) show.addEventListener('click', function () {
      CARD_SEQ.flipped = true;
      $('.study-back', study).hidden = false; show.hidden = true;
    });
    ['forgot', 'fuzzy', 'remember'].forEach(function (g) {
      var btn = $('[data-grade="' + g + '"]', study);
      if (!btn) return;
      btn.addEventListener('click', function () {
        var id = CARD_SEQ.ids[CARD_SEQ.i];
        var grade = CARDS.gradeOf(g);
        S.cards.reviews[id] = CARDS.sm2(S.cards.reviews[id], grade);
        bumpStreak(); save();
        CARD_SEQ.i++; CARD_SEQ.flipped = false;
        if (CARD_SEQ.i >= CARD_SEQ.ids.length) { CARD_SEQ = null; toast('本轮复习完成'); }
        render();
      });
    });
  }

  /* ---------------- 页面：进度 ---------------- */
  /* 三维度主环：读懂 40% + 练过 40% + 答对 20% 加权（ROADMAP P0-2） */
  var PROGRESS_WEIGHT = { read: 0.4, ranged: 0.4, quiz: 0.2 };
  /* 三环与三段进度条的样式（内联，避免额外改动全局样式表） */
  var PROGRESS_CSS = {
    rings: 'display:flex;align-items:center;gap:14px;flex:none;flex-wrap:wrap;',
    ring: 'width:108px;height:108px;border-radius:50%;flex:none;display:grid;place-items:center;position:relative;' +
      'background:conic-gradient(var(--ringc) var(--p,0%), var(--surface-3) 0);',
    ringInner: 'position:absolute;inset:11px;border-radius:50%;background:var(--surface);',
    ringPct: 'position:relative;z-index:1;font:800 22px var(--mono);color:var(--ringc);',
    ringLabel: 'position:absolute;z-index:1;bottom:20px;left:0;right:0;text-align:center;font-style:normal;font-size:10.5px;color:var(--ink-3);',
    mastery: 'display:grid;gap:2px;padding-left:4px;',
    masteryNum: 'font:800 26px var(--mono);color:var(--brand);',
    masteryLabel: 'font-size:11.5px;color:var(--ink-3);',
    bars: 'display:grid;gap:3px;',
    bar: 'height:7px;border-radius:99px;background:var(--surface-3);overflow:hidden;',
    barFill: 'display:block;height:100%;border-radius:99px;background:var(--cat);width:var(--w);transition:width .5s ease;',
    navTotals: 'font:11px var(--mono);color:var(--ink-3);padding:0 10px 8px;line-height:1.5;'
  };
  function progressDims() {
    var total = RISKS.length;
    var read = learnedCount(), ranged = rangedCount(), quiz = quizAnsweredCount();
    return {
      read: read, ranged: ranged, quiz: quiz, total: total,
      readP: pct(read, total), rangedP: pct(ranged, total), quizP: pct(quiz, total),
      mastery: Math.round(
        pct(read, total) * PROGRESS_WEIGHT.read +
        pct(ranged, total) * PROGRESS_WEIGHT.ranged +
        pct(quiz, total) * PROGRESS_WEIGHT.quiz
      )
    };
  }
  /* 靶场演练记录：已练过条数 + 平均预测命中率 */
  function rangeStats() {
    var rows = Object.keys(S.ranged).filter(function (c) { return RISK_MAP[c]; });
    var withPredict = rows.filter(function (c) { return S.ranged[c] && S.ranged[c].predict; });
    var hits = withPredict.filter(function (c) { return S.ranged[c].hit; }).length;
    return {
      count: rows.length,
      predicted: withPredict.length,
      hits: hits,
      hitRate: withPredict.length ? Math.round(hits / withPredict.length * 100) : 0
    };
  }
  function viewProgress() {
    var d = progressDims();
    var total = d.total;
    var recent = Object.keys(S.visited).sort(function (a, b) { return S.visited[b] - S.visited[a]; }).slice(0, 8);
    var acc = S.quiz.total ? Math.round(S.quiz.right / S.quiz.total * 100) : 0;
    var rs = rangeStats();
    var ring = function (label, val, p, color) {
      return '<div class="progress-ring" style="--p:' + p + '%;--ringc:' + color + ';' + PROGRESS_CSS.ring + '">' +
        '<i style="' + PROGRESS_CSS.ringInner + '"></i>' +
        '<span style="' + PROGRESS_CSS.ringPct + '">' + p + '%</span>' +
        '<em style="' + PROGRESS_CSS.ringLabel + '">' + esc(label) + ' · ' + val + '/' + total + '</em></div>';
    };
    return '<div class="page"><div class="page-head"><div class="eyebrow">本地记录</div><h1>我的学习进度</h1>' +
      '<p class="lead">进度分为三个维度：<b>读懂</b>（读了原理 + 随堂题答对）、<b>练过</b>（靶场完成「预测 → 攻击 → 观测」完整闭环）、<b>答对</b>（题目答对）。主环按 读懂 40% + 练过 40% + 答对 20% 加权。所有记录只保存在这台设备的浏览器里，不会上传。</p></div>' +
      '<div class="progress-hero"><div class="progress-rings" style="' + PROGRESS_CSS.rings + '">' +
        ring('读懂', d.read, d.readP, 'var(--brand)') +
        ring('练过', d.ranged, d.rangedP, 'var(--warn)') +
        ring('答对', d.quiz, d.quizP, 'var(--ok)') +
        '<div class="progress-mastery" style="' + PROGRESS_CSS.mastery + '"><b style="' + PROGRESS_CSS.masteryNum + '">' + d.mastery + '%</b>' +
        '<span style="' + PROGRESS_CSS.masteryLabel + '">综合掌握度</span></div>' +
      '</div>' +
        '<div class="progress-stats">' +
          '<div class="ps-stat"><b>' + d.read + ' / ' + total + '</b><span>读懂 · 已掌握风险条目</span></div>' +
          '<div class="ps-stat"><b>' + d.ranged + ' / ' + total + '</b><span>练过 · 靶场闭环完成</span></div>' +
          '<div class="ps-stat"><b>' + d.quiz + ' / ' + total + '</b><span>答对 · 测验答对条目</span></div>' +
          '<div class="ps-stat"><b>' + donePathSteps() + ' / ' + totalPathSteps() + '</b><span>引导路径完成步数</span></div>' +
          '<div class="ps-stat"><b>' + acc + '%</b><span>测验正确率（' + S.quiz.total + ' 题）</span></div>' +
        '</div></div>' +
      '<div class="section"><div class="section-title"><span class="sec-no">01</span>各知识域进度<span class="sec-tip">三段小进度条：读懂 / 练过 / 答对</span></div>' +
        '<div class="card card-pad cat-progress">' + CATS.map(function (c) {
          var l = D.byCat(c.id).length;
          var rd = learnedInCat(c.id), rg = rangedInCat(c.id), qz = quizAnsweredInCat(c.id);
          return '<div class="cp-row" style="grid-template-columns:190px 1fr 92px;align-items:center;gap:12px;font-size:13px;" ' + catVar(c.id) + '><span>' + esc(c.short) + '</span>' +
            '<span class="cp-bars" style="' + PROGRESS_CSS.bars + '">' +
              '<span class="cp-bar" title="读懂 ' + rd + '/' + l + '" style="' + PROGRESS_CSS.bar + '"><i style="' + PROGRESS_CSS.barFill + ';--w:' + pct(rd, l) + '%"></i></span>' +
              '<span class="cp-bar" title="练过 ' + rg + '/' + l + '" style="' + PROGRESS_CSS.bar + '"><i style="' + PROGRESS_CSS.barFill + ';--w:' + pct(rg, l) + '%;background:var(--warn)"></i></span>' +
              '<span class="cp-bar" title="答对 ' + qz + '/' + l + '" style="' + PROGRESS_CSS.bar + '"><i style="' + PROGRESS_CSS.barFill + ';--w:' + pct(qz, l) + '%;background:var(--ok)"></i></span>' +
            '</span>' +
            '<span class="cp-num">' + rd + '·' + rg + '·' + qz + ' / ' + l + '</span></div>';
        }).join('') + '</div></div>' +
      '<div class="section"><div class="section-title"><span class="sec-no">02</span>靶场演练记录<span class="sec-tip">动手实践的可见价值</span></div>' +
        '<div class="card card-pad"><div class="kv">' +
          '<div class="kv-cell"><div class="k">已练过条目</div><div class="v">' + rs.count + ' / ' + total + '</div></div>' +
          '<div class="kv-cell"><div class="k">做过预测的条目</div><div class="v">' + rs.predicted + '</div></div>' +
          '<div class="kv-cell"><div class="k">预测命中</div><div class="v ok">' + rs.hits + '</div></div>' +
          '<div class="kv-cell"><div class="k">平均预测命中率</div><div class="v' + (rs.hitRate >= 60 ? ' ok' : '') + '">' + rs.hitRate + '%</div></div>' +
        '</div>' +
        '<p class="tiny muted" style="margin-top:12px">预测命中率 = 预测与实际结果一致的次数 ÷ 做过的预测次数。命中率低不是坏事——它指出你还需要在哪些防线的作用位置上加深理解。</p></div></div>' +
      '<div class="section"><div class="section-title"><span class="sec-no">03</span>记忆与实操<span class="sec-tip">并列维度，不改变三维度主环权重</span></div>' +
        '<div class="card card-pad"><div class="kv">' +
          '<div class="kv-cell"><div class="k">待复习卡片</div><div class="v">' + dueCardCount() + ' / ' + allCards().length + '</div></div>' +
          '<div class="kv-cell"><div class="k">已记住卡片（SM-2 记住≥3 次）</div><div class="v ok">' + cardMasteredCount() + '</div></div>' +
          '<div class="kv-cell"><div class="k">连续复习天数</div><div class="v">' + (S.cards.streak || 0) + ' 天</div></div>' +
          '<div class="kv-cell"><div class="k">自建卡片</div><div class="v">' + S.cards.custom.length + '</div></div>' +
          '<div class="kv-cell"><div class="k">实操通过</div><div class="v">' + practicalPassedCount() + ' / ' + PRACTICAL.total + '</div></div>' +
          '<div class="kv-cell"><div class="k">实操作答次数</div><div class="v">' + S.practical.total + '</div></div>' +
        '</div><div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">' +
          '<a class="btn small primary" href="#/cards">去复习卡片</a><a class="btn small" href="#/quiz?type=practical">练实操题</a></div></div></div>' +
      '<div class="section"><div class="section-title"><span class="sec-no">04</span>掌握等级分布<span class="sec-tip">按课程要求分级统计已学条目</span></div>' +
        '<div class="card card-pad"><div style="display:flex;gap:10px;flex-wrap:wrap">' +
        [['必须掌握', 3], ['应掌握', 2], ['熟悉', 1]].map(function (m) {
          var all = RISKS.filter(function (r) { return r.level === m[1]; }).length;
          var got = RISKS.filter(function (r) { return r.level === m[1] && S.read[r.code]; }).length;
          return '<span class="badge ' + (m[1] === 3 ? 'danger' : m[1] === 2 ? 'warn' : '') + '" style="font-size:13px;padding:8px 14px">' + m[0] + ' ' + got + ' / ' + all + '</span>';
        }).join('') + '</div>' +
        '<p class="tiny muted" style="margin-top:12px">必经步骤完成：' + donePathSteps() + ' / ' + totalPathSteps() + ' 步（引导路径全部步骤均建议完成，其中基础与合规阶段为必经）。</p></div></div>' +
      '<div class="section grid grid-2">' +
        '<div><div class="section-title"><span class="sec-no">05</span>最近浏览</div>' +
          (recent.length ? '<div class="recent-list">' + recent.map(function (code) {
            var r = RISK_MAP[code];
            return '<a href="#/risk/' + code + '" ' + catVar(r.cat) + '><span class="rl-code">' + esc(code) + '</span>' +
              '<span>' + esc(r.title) + '</span>' + (S.read[code] ? '<span class="badge ok">已学</span>' : '<span class="badge">浏览过</span>') + '</a>';
          }).join('') + '</div>' : '<div class="empty-state">还没有浏览记录，<a href="#/path">从引导路径开始</a></div>') + '</div>' +
        '<div><div class="section-title"><span class="sec-no">06</span>记录管理</div>' +
          '<div class="card card-pad"><p class="small muted">数据保存在 localStorage（键名 <code class="mono">' + STORE_KEY + '</code>）。可以导出一份 JSON 备份，或清空后重新开始。</p>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">' +
            '<button class="btn small" type="button" data-export>导出记录</button>' +
            '<button class="btn small" type="button" data-clear>清空进度</button>' +
            '<a class="btn small" href="#/quiz?mode=wrong">重练错题</a></div></div></div>' +
      '</div></div>';
  }
  function wireProgress() {
    var ex = $('[data-export]');
    if (ex) ex.addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ai-security-learning-progress.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('已导出学习记录');
    });
    var cl = $('[data-clear]');
    if (cl) cl.addEventListener('click', function () {
      if (!confirm('确定清空全部学习进度、测验成绩与错题吗？此操作不可撤销。')) return;
      S = defaults(); QS = null; save(); render(); toast('进度已清空');
    });
  }

  /* ---------------- 页面：搜索结果 / 404 ---------------- */
  function viewSearch() {
    var q = parseHash().query.q || '';
    var list = searchRisks(q);
    var gls = glHits(q);
    return '<div class="page"><div class="page-head"><div class="eyebrow">全站搜索</div>' +
      '<h1>' + (q ? '搜索：' + esc(q) : '搜索风险条目') + '</h1>' +
      '<p class="lead">支持风险编号（如 LLM01）、中英文名称、原理与防御关键词，也可以搜术语（如「RAG」「SSRF」）。共找到 ' + list.length + ' 条结果。</p></div>' +
      (q ? (gls.length ? '<div class="section-title"><span class="sec-no">◎</span>术语释义<span class="sec-tip">点击查看完整解释</span></div>' +
        '<div class="search-page-list">' + gls.map(glHitHTML).join('') + '</div>' : '') +
      (list.length ? '<div class="search-page-list">' + list.map(function (r) { return resultHTML(r, true); }).join('') + '</div>'
        : '<div class="empty-state"><svg class="ic"><use href="#i-search"></use></svg><p>没有匹配结果。试试「注入」「权限」「投毒」「供应链」或「LLM01」，也可以搜术语（如「RAG」「SSRF」）。</p></div>')
        : '<div class="card card-pad"><p class="small muted">常用入口：</p><div style="display:flex;gap:8px;flex-wrap:wrap">' +
          ['提示注入', '权限', '供应链', '投毒', '日志', 'MCP', '注入', '隔离'].map(function (k) {
            return '<a class="chip" href="#/search?q=' + encodeURIComponent(k) + '">' + esc(k) + '</a>';
          }).join('') + '</div></div>') + '</div>';
  }
  function viewNotFound() {
    return '<div class="page"><div class="empty-state"><svg class="ic"><use href="#i-map"></use></svg>' +
      '<h2>没有找到这个页面</h2><p><a href="#/home">回到首页</a> 或 <a href="#/lab">打开攻击路径实验室</a></p></div></div>';
  }

  /* ---------------- 渲染分发 ---------------- */
  function render() {
    var route = parseHash();
    if (route.view === 'map') { location.hash = '#/lab'; return; }
    if (route.view === 'quiz' && location.hash !== QUIZ_LAST_HASH && QS && QS.o &&
        quizSignature(route.query) !== quizSignature(QS.o)) QS = null;
    QUIZ_LAST_HASH = route.view === 'quiz' ? location.hash : '';
    if (NS.lab) NS.lab.stop();
    var main = $('#main');
    var html, wire = null;
    switch (route.view) {
      case 'home': html = viewHome(); break;
      case 'lab': html = viewLab(); wire = wireLab; break;
      case 'cat': html = viewCat(route.param); break;
      case 'risk':
        html = viewRisk(route.param);
        if (RISK_MAP[route.param]) { var rr = RISK_MAP[route.param]; wire = function () { wireRisk(rr); }; }
        break;
      case 'path': html = viewPath(); break;
      case 'transformer': html = viewTransformer(route.param); wire = wireTransformer; break;
      case 'quiz': html = quizView(); wire = wireQuiz; break;
      case 'cards': html = cardView(); wire = wireCards; break;
      case 'progress': html = viewProgress(); wire = wireProgress; break;
      case 'search': html = viewSearch(); break;
      default: html = viewNotFound();
    }
    main.innerHTML = html;
    renderChrome();
    if (wire) wire();
    closeDrawer();
    window.scrollTo(0, 0);
  }

  /* ---------------- 全局交互 ---------------- */
  function closeDrawer() {
    $('#sidebar').classList.remove('open');
    $('#sideOverlay').hidden = true;
    $('#navToggle').setAttribute('aria-expanded', 'false');
  }
  function openDrawer() {
    $('#sidebar').classList.add('open');
    $('#sideOverlay').hidden = false;
    $('#navToggle').setAttribute('aria-expanded', 'true');
  }
  function init() {
    migrateCodes();
    renderChrome();
    $('#navToggle').addEventListener('click', function () {
      if ($('#sidebar').classList.contains('open')) closeDrawer(); else openDrawer();
    });
    $('#sideOverlay').addEventListener('click', closeDrawer);
    $('#themeBtn').addEventListener('click', function () {
      S.theme = S.theme === 'dark' ? 'light' : 'dark';
      save();
    });
    var input = $('#globalSearch');
    input.addEventListener('input', function () { updateSearchPanel(input.value); });
    input.addEventListener('focus', function () { if (input.value.trim()) updateSearchPanel(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var q = input.value.trim();
        $('#searchPanel').hidden = true;
        input.blur();
        go('#/search?q=' + encodeURIComponent(q));
      } else if (e.key === 'Escape') { $('#searchPanel').hidden = true; input.blur(); }
    });
    document.addEventListener('click', function (e) {
      if (!$('#searchWrap').contains(e.target)) $('#searchPanel').hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault(); input.focus(); input.select();
      }
      if (e.key === 'Escape') { closeDrawer(); $('#searchPanel').hidden = true; }
    });
    // 侧栏链接点击后关闭抽屉（移动端）
    $('#sideNav').addEventListener('click', function (e) { if (e.target.closest('a')) closeDrawer(); });
    window.addEventListener('hashchange', render);
    window.addEventListener('message', function (e) {
      var frame = $('[data-tx-frame]');
      if (e.origin !== TX_ORIGIN || !frame || e.source !== frame.contentWindow) return;
      var m = e.data || {};
      if (m.type === 'aisec-tx-height') {
        var f = $('[data-tx-frame]');
        if (f && m.h > 400) f.style.height = Math.min(m.h, 20000) + 'px';
      } else if (m.type === 'aisec-tx-stage' && Array.isArray(m.steps)) {
        renderTxRail(m.stage || 0, m.steps, m.state);
      } else if (m.type === 'aisec-tx-visit' && RISK_MAP[m.code]) {
        S.visited[m.code] = Date.now();
        save();
      } else if (m.type === 'aisec-tx-quiz' && RISK_MAP[m.code]) {
        if (m.correct) {
          S.mini[m.code] = 1; S.quiz.total++; S.quiz.right++;
          S.quiz.ok[m.code] = (S.quiz.ok[m.code] || 0) + 1;
          markRead(m.code, true);
        }
        else { S.mini[m.code] = 0; S.quiz.total++; S.quiz.wrong[m.code] = (S.quiz.wrong[m.code] || 0) + 1; }
        save();
      }
    });
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.AISEC = window.AISEC || {});
