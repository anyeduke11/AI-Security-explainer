/* AI 安全学习实验室 — 术语悬浮卡
 * NS.gl(escapedText): 把文本中首次出现的术语包成可点击的 <button class="gl">
 * NS.glSearch(term):   术语模糊检索（供搜索面板使用）
 * 弹卡为全局单例，事件委托挂在 document 上，页面局部重绘不影响。
 * 依赖: assets/js/data.js 中的 AISEC.data.GLOSSARY（须先于本文件加载）。
 */
(function (NS) {
  'use strict';

  var G = (NS.data && NS.data.GLOSSARY) || [];
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 匹配：按 pattern 长度降序合并成一条正则，单趟扫描 ---------- */
  var MAP = {};   /* surface -> term id（ASCII 词统一小写键） */
  var terms = [];
  G.forEach(function (g) {
    (g.pat || [g.term]).forEach(function (p) {
      terms.push({ id: g.id, p: p });
      MAP[/^[A-Za-z0-9]/.test(p) ? p.toLowerCase() : p] = g.id;
    });
  });
  terms.sort(function (a, b) { return b.p.length - a.p.length; });
  var RX = null;
  if (terms.length) {
    RX = new RegExp(terms.map(function (t) {
      var q = t.p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return /^[A-Za-z0-9]/.test(t.p) ? '\\b' + q + '\\b' : q;
    }).join('|'), 'g');
  }

  /* ---------- 文本包裹：返回的 HTML 里术语为 <button class="gl"> ----------
   * 约定: 入参必须是已经 esc() 过的文本；同一次调用内每个术语只包首次出现。 */
  NS.gl = function (s) {
    if (!s || !RX) return s;
    var seen = {}, out = '', last = 0, m;
    RX.lastIndex = 0;
    while ((m = RX.exec(s)) !== null) {
      var hit = m[0];
      var id = MAP[hit] || MAP[hit.toLowerCase()];
      if (!id) continue;
      out += s.slice(last, m.index);
      if (seen[id]) { out += hit; }
      else {
        seen[id] = 1;
        out += '<button type="button" class="gl" data-gl="' + id + '" aria-haspopup="dialog" aria-expanded="false" title="点击查看术语解释">' + hit + '</button>';
      }
      last = m.index + hit.length;
    }
    out += s.slice(last);
    return out;
  };

  /* ---------- 术语检索（搜索面板用） ---------- */
  NS.glSearch = function (q) {
    var t = String(q || '').trim().toLowerCase();
    if (!t) return [];
    return G.filter(function (g) {
      return (g.term + ' ' + (g.en || '') + ' ' + g.short + ' ' + (g.pat || []).join(' ')).toLowerCase().indexOf(t) >= 0;
    });
  };

  /* ---------- 弹卡 ---------- */
  var POP = null;
  function ensurePop() {
    if (!POP) {
      POP = document.createElement('div');
      POP.className = 'gl-pop';
      POP.id = 'glPop';
      POP.setAttribute('role', 'dialog');
      POP.setAttribute('aria-label', '术语解释');
      document.body.appendChild(POP);
    }
    return POP;
  }
  function byId(id) {
    for (var i = 0; i < G.length; i++) if (G[i].id === id) return G[i];
    return null;
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function showPop(btn) {
    var g = byId(btn.getAttribute('data-gl'));
    if (!g) return;
    var p = ensurePop();
    var inFrame = false;
    try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
    var see = (g.see || []).map(function (code) {
      return inFrame
        ? '<span class="gl-see-code">' + esc(code) + '</span>'
        : '<a class="gl-see-code" href="#/risk/' + esc(code) + '">' + esc(code) + '</a>';
    }).join('');
    p.innerHTML =
      '<div class="gl-pop-head"><b>' + esc(g.term) + '</b>' +
        (g.en ? '<span class="gl-en">' + esc(g.en) + '</span>' : '') +
        '<button type="button" class="gl-x" aria-label="关闭术语解释">×</button></div>' +
      '<p class="gl-short">' + esc(g.short) + '</p>' +
      (g.detail ? '<p class="gl-detail">' + esc(g.detail) + '</p>' : '') +
      (see ? '<div class="gl-see"><span>相关风险：</span>' + see + '</div>' : '');
    var pw = Math.min(360, (window.innerWidth || 800) - 16);
    p.style.maxWidth = pw + 'px';
    p.style.visibility = 'hidden';
    p.hidden = false; /* 先解除 display:none，才能量取高度做翻转定位 */
    p.classList.add('show');
    /* 定位: 优先显示在触发词下方，装不下则翻转到上方，水平方向夹在视口内 */
    var r = btn.getBoundingClientRect();
    var left = clamp(r.left + r.width / 2 - pw / 2, 8, Math.max(8, (window.innerWidth || 800) - pw - 8));
    p.style.left = left + 'px';
    p.style.top = (r.bottom + 8) + 'px';
    var ph = p.offsetHeight;
    if (r.bottom + 8 + ph > (window.innerHeight || 600) - 8 && r.top - ph - 8 > 8) {
      p.style.top = (r.top - ph - 8) + 'px';
    }
    p.style.visibility = '';
    if (POP._btn) POP._btn.setAttribute('aria-expanded', 'false');
    POP._btn = btn;
    btn.setAttribute('aria-expanded', 'true');
  }
  function hidePop() {
    if (POP && !POP.hidden) {
      POP.classList.remove('show');
      POP.hidden = true;
      if (POP._btn) POP._btn.setAttribute('aria-expanded', 'false');
      POP._btn = null;
    }
  }
  NS.glHide = hidePop;

  /* ---------- 全局事件（委托，页面重绘无需重新绑定） ---------- */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.gl');
    if (btn) {
      e.preventDefault();
      if (POP && POP._btn === btn && !POP.hidden) hidePop(); else showPop(btn);
      return;
    }
    if (e.target.closest('.gl-x') || !e.target.closest('#glPop')) hidePop();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hidePop(); });
  /* 滚动/缩放时关闭，避免弹卡与触发词错位 */
  window.addEventListener('scroll', hidePop, true);
  window.addEventListener('resize', hidePop);
})(window.AISEC = window.AISEC || {});
