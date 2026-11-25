/* 金融企业网络攻击路径实验室 — 主交互可视化
 * 交互范式对齐 Transformer Explainer：
 *   一个占据主视觉的图 + 参数滑块/切换实时改变图 + 悬停联动高亮
 *   + 逐步播放动画 + 实时数值 + 右侧解释面板 + 下方分节长文讲解
 */
(function (NS) {
  'use strict';

  var D = NS.data;
  var STAGES = D.STAGES, CATS = D.CATS, NODES = D.NODE_MAP, STARTS = D.STARTS;
  var S = {
    view: 'topology', start: 'external', stage: 1, defense: 0,
    playing: false, hover: null, selectedRisk: null, heatCell: null, timer: null
  };
  var LABELS = {
    attacker: '外部攻击者', customer: '手机银行用户', partner: '开放银行合作方',
    registry: '技能 / 模型市场', exfil: '数据外发端',
    waf: 'WAF / API 网关', portal: '网银门户 / SSO', mail: '邮件网关',
    api3rd: '开放银行 API', proxy: '出向代理',
    endpoint: '员工终端 / OA', oa: '内网门户', bastion: '堡垒机 / 运维',
    skill: '技能包运行时', siem: '日志 / SIEM',
    llmapp: '智能客服 / LLM', agent: 'Agent 编排', mcp: 'MCP 工具服务器',
    rag: '知识库 / 向量库', model: '模型推理 / 权重',
    core: '核心账务', payment: '支付 / 清算', riskctl: '风控引擎',
    approval: '信贷审批流', vault: '密钥 / HSM',
    cdb: '客户主数据', dw: '数据仓库 / 报表', backup: '备份 / 灾备',
    audit: '审计 / 合规报送', monitor: '监控 / 告警'
  };
  var STATUS_NAME = {
    active: '当前阶段', passed: '已越过', future: '未到达',
    blocked: '已被控制拦截', unreachable: '不可达', skipped: '起点已具备'
  };

  /* 网络拓扑常用图标（内联 symbol，stroke 风格） */
  function iconSym(id, d) {
    return '<symbol id="ln-' + id + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</symbol>';
  }
  var ICONS = [
    iconSym('globe', '<circle cx="12" cy="12" r="9"/><path d="M3.5 12h17M12 3c2.4 2.7 2.4 15.3 0 18M12 3c-2.4 2.7-2.4 15.3 0 18"/>'),
    iconSym('user', '<circle cx="12" cy="8" r="3.6"/><path d="M4.7 20c0-3.6 3.2-6.3 7.3-6.3s7.3 2.7 7.3 6.3"/>'),
    iconSym('package', '<rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M3.6 7l8.4-3.9 8.4 3.9M12 3.1v14"/><path d="m8.7 9 2 2 2.8-2.9"/>'),
    iconSym('shield', '<path d="M12 2.9l7 2.9v5.9c0 4.5-3 7.4-7 8.6-4-1.2-7-4.1-7-8.6V5.8l7-2.9Z"/><path d="m8.9 11.8 2.2 2.2 4.1-4.4"/>'),
    iconSym('laptop', '<rect x="4.8" y="4.4" width="14.4" height="10" rx="1.8"/><path d="M2.5 18.7h19"/>'),
    iconSym('bot', '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4.7v3.1M9 12.6h1.7M13.3 12.6H15"/><circle cx="9.1" cy="16.2" r=".7" fill="currentColor"/><circle cx="14.9" cy="16.2" r=".7" fill="currentColor"/>'),
    iconSym('bank', '<path d="M4 10l8-5 8 5"/><path d="M5.3 10.4v8.4M9.6 10.4v8.4M14.4 10.4v8.4M18.7 10.4v8.4M3.4 21.3h17.2"/>'),
    iconSym('database', '<ellipse cx="12" cy="5.4" rx="8" ry="3"/><path d="M4 5.4v13.2c0 1.6 3.6 3 8 3s8-1.4 8-3V5.4M4 12c0 1.6 3.6 3 8 3s8-1.4 8-3"/>'),
    iconSym('activity', '<circle cx="12" cy="12" r="9"/><path d="M12 7.6v4.4l2.9 2.2"/>'),
    iconSym('key', '<circle cx="8" cy="12" r="3.5"/><path d="m10.3 14.3 8.1-8.1M16.4 6.4l2-2M14.4 8.4l2.1 2.1"/>')
  ];
  var KIND_ICON = {
    threat: 'globe', user: 'user', supply: 'package', gate: 'shield',
    host: 'laptop', ai: 'bot', biz: 'bank', data: 'database', control: 'activity'
  };
  var NODE_ICON = {
    attacker: 'globe', registry: 'package', exfil: 'globe',
    mail: 'shield', api3rd: 'globe', proxy: 'shield',
    vault: 'key', siem: 'activity', monitor: 'activity'
  };
  function nodeIcon(n) { return NODE_ICON[n.id] || KIND_ICON[n.kind] || 'laptop'; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* 术语悬浮卡包裹：入参必须是已转义文本（见 glossary.js） */
  function gl(s) { return typeof NS.gl === 'function' ? NS.gl(s) : s; }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function startCfg() {
    return STARTS.filter(function (x) { return x.id === S.start; })[0] || STARTS[0];
  }
  function thresholdOf(s) { return Math.max(1, s.threshold + startCfg().bias); }

  /* 每跳状态：纵深防御会在第一个满足阈值的跳把链路截断 */
  function statusMap() {
    var cfg = startCfg(), out = {}, firstBlocked = -1;
    STAGES.forEach(function (s, i) {
      if (cfg.skip.indexOf(s.id) >= 0) { out[s.id] = 'skipped'; return; }
      var blocked = S.defense >= thresholdOf(s);
      if (blocked && firstBlocked < 0) firstBlocked = i;
      out[s.id] = blocked ? 'blocked' : (i === S.stage - 1 ? 'active' : i < S.stage - 1 ? 'passed' : 'future');
    });
    return { map: out, firstBlocked: firstBlocked };
  }
  function blockedCount() {
    return STAGES.filter(function (s) { return S.defense >= thresholdOf(s) && startCfg().skip.indexOf(s.id) < 0; }).length;
  }
  function reachableCount() {
    var sm = statusMap().map;
    return STAGES.filter(function (s) { return sm[s.id] !== 'blocked' && sm[s.id] !== 'skipped'; }).length;
  }
  function activeStage() { return STAGES[S.stage - 1]; }

  /* ---------- SVG 拓扑 ---------- */
  function boundaryOffset(dx, dy) {
    var hw = 70, hh = 21;
    var tx = Math.abs(dx) < 0.001 ? Infinity : hw / Math.abs(dx);
    var ty = Math.abs(dy) < 0.001 ? Infinity : hh / Math.abs(dy);
    var t = Math.min(tx, ty);
    return { x: dx * t, y: dy * t };
  }
  function edgeCoords(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var off = boundaryOffset(dx, dy);
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var shrink = Math.min(off.x * dx / len + off.y * dy / len, len * 0.42);
    var ux = dx / len, uy = dy / len;
    return {
      x1: a.x + ux * (shrink + 3), y1: a.y + uy * (shrink + 3),
      x2: b.x - ux * (shrink + 5), y2: b.y - uy * (shrink + 5)
    };
  }
  /* 稳定散列：让每条边拥有固定的弯曲方向，避免每次重绘抖动 */
  function edgeSeed(a, b) {
    var s = a + '|' + b, h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  /* 三次贝塞尔曲线：控制点沿法线偏移，端点切线保持水平/垂直方向的自然入射 */
  function curvePath(c, seed, amp) {
    var dx = c.x2 - c.x1, dy = c.y2 - c.y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    var k = (seed % 2 ? 1 : -1) * amp;
    var c1x = c.x1 + dx / 3 + nx * k, c1y = c.y1 + dy / 3 + ny * k;
    var c2x = c.x1 + dx * 2 / 3 + nx * k, c2y = c.y1 + dy * 2 / 3 + ny * k;
    return {
      d: 'M' + c.x1.toFixed(1) + ' ' + c.y1.toFixed(1) +
        ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' +
        c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' +
        c.x2.toFixed(1) + ' ' + c.y2.toFixed(1),
      mx: (c.x1 + 3 * c1x + 3 * c2x + c.x2) / 8,
      my: (c.y1 + 3 * c1y + 3 * c2y + c.y2) / 8
    };
  }
  function curveAmp(c, min, max, ratio) {
    return clamp(Math.sqrt(Math.pow(c.x2 - c.x1, 2) + Math.pow(c.y2 - c.y1, 2)) * ratio, min, max);
  }
  function svgHTML() {
    var markers = ['active:#dc4c43', 'passed:#b97062', 'future:#8fa6c9',
      'blocked:#d23f3f', 'unreachable:#9fb1c9', 'skipped:#5b8df7'].map(function (x) {
      var p = x.split(':');
      return '<marker id="lab-arrow-' + p[0] + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="' + p[1] + '"/></marker>';
    }).join('');
    var icons = ICONS.join('');
    var backdrops = '<pattern id="lab-grid" width="22" height="22" patternUnits="userSpaceOnUse">' +
      '<circle class="lab-grid-dot" cx="1.2" cy="1.2" r="1.1"/></pattern>';
    var defs = '<defs>' + icons + markers + backdrops + '</defs>';

    var zones = D.NET_ZONES.map(function (z, i) {
      return '<g class="lab-zone" data-zone="' + z.id + '" style="--zc:' + z.color + '">' +
        '<rect class="lab-zone-box" x="' + z.x + '" y="' + z.y + '" width="' + z.w + '" height="' + z.h + '" rx="13"/>' +
        '<rect class="lab-zone-cap" x="' + (z.x + 12) + '" y="' + (z.y + 3) + '" width="' + (z.w - 24) + '" height="3.5" rx="2"/>' +
        '<circle class="lab-zone-no" cx="' + (z.x + z.w - 23) + '" cy="' + (z.y + 25) + '" r="11"/>' +
        '<text class="lab-zone-no-t" x="' + (z.x + z.w - 23) + '" y="' + (z.y + 29) + '" text-anchor="middle">' + (i + 1) + '</text>' +
        '<text class="lab-zone-title" x="' + (z.x + 14) + '" y="' + (z.y + 27) + '">' + esc(z.name) + '</text>' +
        '<text class="lab-zone-en" x="' + (z.x + 14) + '" y="' + (z.y + 43) + '">' + esc(z.en) + '</text></g>';
    }).join('');

    var links = D.NET_LINKS.map(function (p) {
      var a = NODES[p[0]], b = NODES[p[1]];
      if (!a || !b) return '';
      var c = edgeCoords(a, b);
      var q = curvePath(c, edgeSeed(p[0], p[1]), curveAmp(c, 3, 15, 0.055));
      return '<path class="lab-link" d="' + q.d + '"/>';
    }).join('');

    var attack = STAGES.map(function (s) {
      return s.edges.map(function (p, i) {
        var a = NODES[p[0]], b = NODES[p[1]];
        if (!a || !b) return '';
        var c = edgeCoords(a, b);
        var q = curvePath(c, edgeSeed(p[0] + s.id, p[1]), curveAmp(c, 11, 44, 0.145));
        var path = '<path class="lab-edge" data-edge="' + s.id + '" data-stage="' + s.id + '" data-node-a="' + p[0] + '" data-node-b="' + p[1] +
          '" style="--sc:' + s.color + '" d="' + q.d + '"><title>' + esc(s.id + ' · ' + s.name) + '</title></path>';
        if (i !== 0) return path;
        return path + '<g class="lab-badge" data-badge="' + s.id + '" data-stage="' + s.id +
          '" style="--sc:' + s.color + '" transform="translate(' + q.mx.toFixed(1) + ',' + q.my.toFixed(1) + ')">' +
          '<circle class="lab-badge-halo" r="16"/><circle class="lab-badge-core" r="10.5"/>' +
          '<text y="3.6" text-anchor="middle">' + esc(s.id) + '</text></g>';
      }).join('');
    }).join('');

    var nodes = D.NET_NODES.map(function (n) {
      return '<g class="lab-node kind-' + n.kind + '" data-node="' + n.id + '" transform="translate(' + n.x + ',' + n.y + ')" tabindex="0" role="button" aria-label="' + esc(n.name) + '">' +
        '<rect class="lab-node-box" x="-78" y="-24" width="156" height="48" rx="10"/>' +
        '<rect class="lab-node-cap" x="-78" y="-19" width="3.5" height="38" rx="2"/>' +
        '<circle class="lab-node-icbg" cx="-57" cy="1" r="12"/>' +
        '<use class="lab-node-icon" href="#ln-' + nodeIcon(n) + '" x="-67" y="-9" width="20" height="20"/>' +
        '<text class="lab-node-label" x="-38" y="4">' + esc(LABELS[n.id] || n.name) + '</text>' +
        '<title>' + esc(n.name + '：' + n.desc) + '</title></g>';
    }).join('');

    var canvas = '<rect class="lab-canvas" width="1200" height="560"/>' +
      '<rect class="lab-canvas-grid" width="1200" height="560" fill="url(#lab-grid)"/>' +
      '<g class="lab-canvas-tag"><text x="20" y="34">ATTACK PATH / ' + STAGES.length + ' STAGES</text>' +
      '<text x="1180" y="34" text-anchor="end">5 SECURITY ZONES · 30 NODES</text></g>';

    return '<svg class="lab-svg" viewBox="0 0 1200 560" role="img" aria-label="金融企业网络拓扑与攻击路径">' +
      defs + canvas + zones + '<g class="lab-links">' + links + '</g>' +
      '<g class="lab-edges">' + attack + '</g>' + '<g class="lab-nodes">' + nodes + '</g>' + '</svg>';
  }

  /* ---------- 时间轴视图 ---------- */
  function timelineHTML() {
    return '<div class="lab-timeline">' + STAGES.map(function (s, i) {
      return '<button type="button" class="lab-tl-item" data-stage="' + s.id + '" style="--sc:' + s.color + '">' +
        '<span class="tl-no">' + esc(s.id) + '</span><span class="tl-name">' + esc(s.name) + '</span>' +
        '<span class="tl-count" data-tl-count="' + s.id + '">' + s.risks.length + ' 条风险</span>' +
        '<span class="tl-bar" data-tl-bar="' + s.id + '"></span></button>';
    }).join('') + '</div>' +
      '<div class="lab-tl-note" data-tl-note></div>';
  }

  /* ---------- 阶段 × 知识域 热度矩阵（对齐 attention 矩阵） ---------- */
  function heatCount(sid, cid) {
    return D.byStage(sid).filter(function (r) { return r.cat === cid; }).length;
  }
  function heatHTML() {
    var head = '<tr><th class="heat-corner">知识域 ↓ / 阶段 →</th>' + STAGES.map(function (s) {
      return '<th data-heat-col="' + s.id + '">' + esc(s.id) + '</th>';
    }).join('') + '</tr>';
    var rows = CATS.map(function (c) {
      return '<tr data-heat-row="' + c.id + '"><th style="--cc:' + c.color + '"><span class="heat-dot"></span>' + esc(c.short) + '</th>' +
        STAGES.map(function (s) {
          var n = heatCount(s.id, c.id);
          return '<td><button type="button" class="lab-heat-cell" data-heat="' + s.id + '|' + c.id + '" ' +
            'style="--hc:' + c.color + ';--hv:' + (n ? clamp(12 + n * 20, 14, 88) : 0) + '%" aria-label="' + esc(s.id + ' ' + c.short + ' ' + n + ' 条风险') + '">' +
            (n || '·') + '</button></td>';
        }).join('') + '</tr>';
    }).join('');
    return '<div class="lab-heat-wrap"><table class="lab-heat"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>' +
      '<div class="lab-heat-tip" data-heat-tip></div></div>' +
      '<p class="control-tip" style="margin-top:12px">格子里的数字是「该攻击阶段 × 该知识域」的风险条数，颜色越深越密集。悬停可高亮整行整列，点击会把该阶段设为当前阶段并列出对应风险——就像在注意力矩阵里查看 token 之间的权重。</p>';
  }

  /* ---------- 主框架 ---------- */
  function frameHTML() {
    var startSeg = '<div class="seg" data-lab-seg="start">' + STARTS.map(function (x) {
      return '<button type="button" data-val="' + x.id + '"' + (x.id === S.start ? ' class="active"' : '') + '>' + esc(x.name) + '</button>';
    }).join('') + '</div>';
    var viewSeg = '<div class="seg" data-lab-seg="view">' +
      [['topology', '网络拓扑'], ['timeline', '攻击链时间轴'], ['heat', '风险热度矩阵']].map(function (x) {
        return '<button type="button" data-val="' + x[0] + '"' + (x[0] === S.view ? ' class="active"' : '') + '>' + x[1] + '</button>';
      }).join('') + '</div>';
    var legend = [['active', '当前阶段'], ['passed', '已越过'], ['blocked', '被拦截'], ['unreachable', '不可达'], ['skipped', '起点已具备']]
      .map(function (x) { return '<span class="lg-item"><i class="lg-line e-' + x[0] + '"></i>' + x[1] + '</span>'; }).join('');

    var stepnav = '<div class="lab-stepnav" data-stepnav>' + STAGES.map(function (s) {
      return '<button type="button" data-stepn="' + s.id + '" style="--sc:' + s.color + '"><b>' + esc(s.id) + '</b><span>' + esc(s.name) + '</span></button>';
    }).join('') + '</div>';

    return '<div class="lab">' +
      '<div class="card lab-bar">' +
        '<div class="lab-bar-row">' +
          '<div class="lab-field"><label>攻击者起点</label>' + startSeg + '<p class="control-tip" data-start-tip></p></div>' +
          '<div class="lab-field"><label>可视化视角</label>' + viewSeg + '</div>' +
          '<div class="lab-field lab-actions"><label>路径控制</label><div class="demo-actions">' +
            '<button class="btn primary small" type="button" data-lab-play><svg class="ic"><use href="#i-play"></use></svg><span data-play-label>播放路径</span></button>' +
            '<button class="btn small" type="button" data-lab-prev>上一步</button>' +
            '<button class="btn small" type="button" data-lab-next>下一步</button>' +
            '<button class="btn small" type="button" data-lab-reset><svg class="ic"><use href="#i-reset"></use></svg>重置</button>' +
            '<button class="btn small" type="button" data-lab-simulate><svg class="ic"><use href="#i-bolt"></use></svg>重新模拟</button>' +
          '</div></div>' +
        '</div>' +
        '<div class="lab-bar-row lab-bar-sliders">' +
          '<div class="lab-field"><label>攻击阶段 <b data-out-stage>S1</b></label>' +
            '<input type="range" data-lab-range="stage" min="1" max="' + STAGES.length + '" step="1" value="' + S.stage + '">' +
            '<p class="control-tip" data-stage-name></p></div>' +
          '<div class="lab-field"><label>防御强度 <b data-out-defense>0</b></label>' +
            '<input type="range" data-lab-range="defense" min="0" max="100" step="1" value="' + S.defense + '">' +
            '<p class="control-tip">把滑块拉高，控制在第几跳拦截就会在链路上亮起红标；链路不会被抹掉，只会标黄。</p></div>' +
          '<div class="lab-stats" data-lab-stats></div>' +
        '</div>' +
      '</div>' +

      '<div class="lab-main">' +
        '<div class="card lab-viz">' +
          '<div class="lab-viz-head"><div><h3 data-viz-title>金融企业网络拓扑</h3><p data-viz-sub></p></div>' +
            '<div class="lab-legend">' + legend + '</div></div>' +
          '<div class="lab-viz-body" data-viz></div>' +
          '<div class="lab-viz-foot" data-viz-foot></div>' +
        '</div>' +
        '<aside class="card lab-panel" data-panel></aside>' +
      '</div>' + stepnav +
      '<details class="card lab-fold" open><summary><b data-fold-label>本阶段讲解</b><span data-fold-title></span></summary>' +
        '<div data-lab-chapters></div></details>' +
    '</div>';
  }

  /* ---------- 联动解释面板 ---------- */
  function riskRow(r) {
    var c = D.CAT_MAP[r.cat];
    return '<a class="lab-risk" data-risk="' + r.code + '" href="#/risk/' + r.code + '" style="--rc:' + c.color + '">' +
      '<span class="lr-code">' + esc(r.code) + '</span><span class="lr-title">' + esc(r.title) + '</span>' +
      '<span class="badge level-' + r.level + '">' + (D.LEVELS[r.level].name) + '</span></a>';
  }
  function panelHTML() {
    var s = activeStage(), st = statusMap().map[s.id];
    var list = s.risks;
    if (S.heatCell) {
      var parts = S.heatCell.split('|');
      list = D.byStage(parts[0]).filter(function (r) { return r.cat === parts[1]; });
    }
    var groups = CATS.map(function (c) {
      var rows = list.filter(function (r) { return r.cat === c.id; });
      if (!rows.length) return '';
      return '<div class="lab-risk-group"><h5 style="--rc:' + c.color + '"><span class="heat-dot"></span>' + esc(c.short) + ' <span class="muted tiny">' + rows.length + ' 条</span></h5>' +
        rows.map(riskRow).join('') + '</div>';
    }).join('');
    var nodeChips = s.focus.map(function (n) {
      return '<button type="button" class="lab-chip" data-node-chip="' + n + '">' + esc(LABELS[n] || n) + '</button>';
    }).join('');
    var nav = '<div class="lp-nav"><button class="btn small" type="button" data-lab-prev>← 上一跳</button>' +
      '<button class="btn small" type="button" data-lab-next>下一跳 →</button></div>';
    return '<div class="lab-panel-inner">' +
      '<div class="lp-head"><span class="lp-no" style="--sc:' + s.color + '">' + esc(s.id) + '</span>' +
        '<div><h3>' + esc(s.name) + '</h3><span class="muted tiny">' + esc(s.en) + '</span></div>' +
        '<div class="lp-status st-' + st + '">' + esc(STATUS_NAME[st]) + ' · ' + s.risks.length + ' 条关联风险</div>' + nav + '</div>' +
      (S.heatCell ? '<div class="notice" style="margin-top:12px">已筛选：' + esc(S.heatCell.split('|')[0]) + ' × ' +
        esc(D.CAT_MAP[S.heatCell.split('|')[1]].short) + ' <button class="btn ghost small" type="button" data-lab-clearfilter>清除筛选</button></div>' : '') +
      '<div class="lp-grid">' +
        '<section class="lp-col"><h4 class="lp-h">这一跳发生了什么</h4><p class="lp-text">' + gl(esc(s.technique)) + '</p>' +
          '<h4 class="lp-h">为什么能成功</h4><p class="lp-text muted">' + gl(esc(s.why)) + '</p></section>' +
        '<section class="lp-col"><h4 class="lp-h">逐步拆解</h4><ol class="lp-steps">' + s.steps.map(function (x) {
          return '<li><b>' + esc(x[0]) + '</b><span>' + gl(esc(x[1])) + '</span></li>';
        }).join('') + '</ol></section>' +
        '<section class="lp-col"><h4 class="lp-h">涉及的网络节点（悬停可定位）</h4><div class="lab-chips">' + nodeChips + '</div>' +
          '<h4 class="lp-h">应该在哪一层拦住</h4><ul class="lp-controls">' + s.controls.map(function (x) { return '<li>' + gl(esc(x)) + '</li>'; }).join('') + '</ul></section>' +
        '<section class="lp-col lp-col-risks"><h4 class="lp-h">在这一跳可以学习的风险 <span class="muted tiny">（悬停高亮拓扑节点，点击进入详情）</span></h4>' +
          '<div class="lp-risk-groups">' + (groups || '<div class="empty-state tiny" style="grid-column:1/-1">该筛选下没有风险条目</div>') + '</div></section>' +
      '</div>' +
    '</div>';
  }

  /* ---------- 当前阶段单章解读（配合按钮切换，不再长文堆叠） ---------- */
  function stagePills() {
    return '<div class="lab-pills" aria-label="网络分区">' + D.NET_ZONES.map(function (z) {
      return '<span class="lab-pill" style="--zc:' + z.color + '">' + esc(z.name) + '<i>' + esc(z.en) + '</i></span>';
    }).join('') + '</div>';
  }
  function stageDetail(s) {
    var nodes = s.focus.map(function (nid) {
      var n = NODES[nid];
      if (!n) return '';
      var zone = D.NET_ZONES.filter(function (z) { return z.id === n.zone; })[0] || {};
      return '<div class="lab-ncard kind-' + n.kind + '" style="--zc:' + zone.color + '">' +
        '<span class="lnc-ic"><svg width="18" height="18"><use href="#ln-' + nodeIcon(n) + '"></use></svg></span>' +
        '<b>' + esc(LABELS[n.id] || n.name) + '</b><span>' + esc(n.desc) + '</span></div>';
    }).join('');
    return stagePills() +
      '<section class="lab-chapter" id="lab-sec-' + s.id + '" data-chapter="' + s.id + '">' +
        '<div class="lab-chapter-top">' +
          '<div class="eyebrow" style="--ec:' + s.color + '">阶段 ' + s.no + ' / ' + STAGES.length + ' · ' + esc(s.en) + '</div>' +
          '<h2>' + esc(s.id) + ' · ' + esc(s.name) + '</h2>' +
        '</div>' +
        '<p class="lab-lead">' + gl(esc(s.section)) + '</p>' +
        '<h4>关键节点</h4><div class="lab-ncards">' + nodes + '</div>' +
      '</section>';
  }
  function chaptersHTML() {
    return stageDetail(STAGES[S.stage - 1]);
  }
  function renderChapter() {
    var box = $('[data-lab-chapters]', root);
    if (box) box.innerHTML = chaptersHTML();
  }

  /* ---------- 绘制 ---------- */
  var root = null;
  function renderStats() {
    var s = activeStage(), b = blockedCount(), r = reachableCount(), total = STAGES.length;
    var score = clamp(100 - S.defense + (S.stage - 1) * 2, 0, 100);
    var stats = [
      ['当前阶段', s.id + ' / ' + total, ''],
      ['可达阶段', r + ' / ' + total, r < total ? 'ok' : ''],
      ['本跳风险', s.risks.length + ' 条', ''],
      ['生效控制', b + ' / ' + total, b ? 'ok' : ''],
      ['剩余风险指数', String(score), score > 60 ? 'danger' : score > 30 ? 'warn' : 'ok']
    ];
    $('[data-lab-stats]', root).innerHTML = stats.map(function (x) {
      return '<div class="lab-stat"><span class="ls-label">' + esc(x[0]) + '</span>' +
        '<b class="ls-value ' + (x[2] || '') + '">' + esc(x[1]) + '</b></div>';
    }).join('');
  }
  function hoverNodes() {
    var h = S.hover, out = {};
    if (!h) return out;
    if (h.type === 'node') out[h.id] = 1;
    else if (h.type === 'risk') {
      var r = D.RISK_MAP[h.id];
      if (r) r.stages.forEach(function (sid) { (D.STAGE_MAP[sid].focus || []).forEach(function (n) { out[n] = 1; }); });
    } else if (h.type === 'edge') {
      var st = D.STAGE_MAP[h.id];
      if (st) st.focus.forEach(function (n) { out[n] = 1; });
    } else if (h.type === 'nodeChip') out[h.id] = 1;
    return out;
  }
  function paint() {
    if (!root) return;
    var sm = statusMap(), s = activeStage(), hn = hoverNodes(), hasHover = !!S.hover;
    var activeNodes = {};
    s.focus.forEach(function (n) { activeNodes[n] = 1; });
    var startNode = startCfg().node;

    $$('.lab-edge', root).forEach(function (line) {
      var sid = line.dataset.edge, status = sm.map[sid];
      var related = hasHover && (
        (S.hover.type === 'node' && (line.dataset.nodeA === S.hover.id || line.dataset.nodeB === S.hover.id)) ||
        (S.hover.type === 'edge' && S.hover.id === sid) ||
        (S.hover.type === 'risk' && D.RISK_MAP[S.hover.id] && D.RISK_MAP[S.hover.id].stages.indexOf(sid) >= 0) ||
        (S.hover.type === 'nodeChip' && (line.dataset.nodeA === S.hover.id || line.dataset.nodeB === S.hover.id))
      );
      line.setAttribute('class', 'lab-edge e-' + status + (related ? ' is-related' : '') + (hasHover && !related ? ' is-dim' : ''));
      line.setAttribute('marker-end', 'url(#lab-arrow-' + status + ')');
    });
    $$('.lab-badge', root).forEach(function (g) { g.setAttribute('data-status', sm.map[g.dataset.badge]); });
    $$('.lab-node', root).forEach(function (g) {
      var id = g.dataset.node;
      g.classList.toggle('is-active', !!activeNodes[id]);
      g.classList.toggle('is-related', !!hn[id]);
      g.classList.toggle('is-start', id === startNode);
      g.classList.toggle('is-dim', hasHover && !hn[id] && !activeNodes[id]);
    });
    $$('.lab-tl-item', root).forEach(function (b) {
      var status = sm.map[b.dataset.stage];
      b.setAttribute('data-status', status);
      b.classList.toggle('is-current', b.dataset.stage === s.id);
    });
    $$('.lab-heat-cell', root).forEach(function (b) {
      var parts = b.dataset.heat.split('|');
      var rowHit = S.hover && S.hover.type === 'heat' && S.hover.cat === parts[1];
      var colHit = S.hover && S.hover.type === 'heat' && S.hover.stage === parts[0];
      b.classList.toggle('is-row', !!rowHit);
      b.classList.toggle('is-col', !!colHit);
      b.classList.toggle('is-current', parts[0] === s.id);
    });
    $$('.lab-risk', root).forEach(function (a) {
      a.classList.toggle('is-hover', !!(S.hover && S.hover.type === 'risk' && S.hover.id === a.dataset.risk));
      a.classList.toggle('is-selected', S.selectedRisk === a.dataset.risk);
    });
    $$('[data-stepn]', root).forEach(function (b) { b.classList.toggle('is-current', b.dataset.stepn === s.id); });
    $$('[data-fold-title]', root).forEach(function (el) { el.textContent = esc(s.id + ' · ' + s.name); });

    renderStats();
    $('[data-out-stage]', root).textContent = s.id;
    $('[data-out-defense]', root).textContent = S.defense;
    $('[data-stage-name]', root).textContent = s.id + ' · ' + s.name + '（' + s.risks.length + ' 条风险）';
    $('[data-start-tip]', root).textContent = startCfg().desc;
    $('[data-viz-sub]', root).textContent = '起点：' + startCfg().name + '　·　当前：' + s.id + ' ' + s.name + '　·　防御强度 ' + S.defense;
    var titles = { topology: '金融企业网络拓扑', timeline: '九阶段攻击链时间轴', heat: '阶段 × 知识域 风险热度矩阵' };
    $('[data-viz-title]', root).textContent = titles[S.view];
    var foot;
    if (sm.firstBlocked >= 0) foot = '控制已在 ' + STAGES[sm.firstBlocked].id + ' 生效：链路被截断，之后的阶段不可达。把「防御强度」调低，或换一个起点，观察路径如何重新打通。';
    else if (S.stage >= STAGES.length) foot = '已到达链路末端：风险在核心业务与数据外发处变成真实后果。建议提高防御强度，看看在哪一跳可以最早止损。';
    else foot = '提示：悬停任意节点或右侧风险条目可查看联动高亮；拖动滑块可实时改变链路状态。';
    $('[data-viz-foot]', root).innerHTML = '<svg class="ic"><use href="#i-bolt"></use></svg><span>' + esc(foot) + '</span>';
    var tlNote = $('[data-tl-note]', root);
    if (tlNote) tlNote.innerHTML = '<b>' + esc(s.id + ' · ' + s.name) + '</b>（' + esc(STATUS_NAME[sm.map[s.id]]) + '）<br>' + gl(esc(s.technique));
    var tip = $('[data-heat-tip]', root);
    if (tip) {
      if (S.hover && S.hover.type === 'heat') {
        var n = heatCount(S.hover.stage, S.hover.cat);
        tip.textContent = S.hover.stage + ' × ' + D.CAT_MAP[S.hover.cat].short + '：' + n + ' 条风险' + (n ? '（点击筛选）' : '');
        tip.classList.add('show');
      } else { tip.classList.remove('show'); }
    }
  }
  function renderPanel() { if (root) $('[data-panel]', root).innerHTML = panelHTML(); }
  function renderViz() {
    if (!root) return;
    var html = S.view === 'topology' ? svgHTML() : S.view === 'timeline' ? timelineHTML() : heatHTML();
    $('[data-viz]', root).innerHTML = html;
    $('[data-viz]', root).setAttribute('data-view', S.view);
  }
  function updateAll(rebuildPanel) {
    if (rebuildPanel) renderPanel();
    paint();
  }
  function setStage(n, rebuild, keepFilter) {
    S.stage = clamp(n, 1, STAGES.length);
    var r = $('[data-lab-range="stage"]', root);
    if (r) r.value = S.stage;
    if (!keepFilter) S.heatCell = null;
    /* 手动越过被拦截阶段时给出明确提示（自动播放不打扰） */
    var blocked = statusMap().firstBlocked;
    if (!S.playing && blocked >= 0 && S.stage - 1 >= blocked) {
      toast('链路已在 ' + STAGES[blocked].id + ' 被拦截：' + STAGES[blocked].name + ' 之后的阶段不可达。调低防御强度可重新打通。');
    }
    renderChapter();
    updateAll(rebuild !== false);
  }
  function setHover(h) { S.hover = h; paint(); }

  /* ---------- 播放 ---------- */
  function stop() {
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
    S.playing = false;
    var b = $('[data-lab-play]', root);
    if (b) { $('[data-play-label]', b).textContent = '播放路径'; b.innerHTML = '<svg class="ic"><use href="#i-play"></use></svg><span data-play-label>播放路径</span>'; }
  }
  function play() {
    if (S.playing) { stop(); return; }
    if (S.stage >= STAGES.length) setStage(1);
    S.playing = true;
    var b = $('[data-lab-play]', root);
    b.innerHTML = '<svg class="ic"><use href="#i-pause"></use></svg><span data-play-label>暂停</span>';
    S.timer = setInterval(function () {
      if (S.stage >= STAGES.length) { stop(); return; }
      var sm = statusMap();
      if (sm.firstBlocked >= 0 && S.stage - 1 >= sm.firstBlocked) { stop(); return; }
      setStage(S.stage + 1);
    }, 1000);
    paint();
  }
  function simulate() {
    stop();
    var pick = STARTS[Math.floor(Math.random() * STARTS.length)];
    S.start = pick.id;
    S.defense = Math.floor(Math.random() * 35);
    S.heatCell = null;
    S.selectedRisk = null;
    $$('[data-lab-seg="start"] button', root).forEach(function (b) { b.classList.toggle('active', b.dataset.val === S.start); });
    $('[data-lab-range="defense"]', root).value = S.defense;
    setStage(1);
    toast('已重新模拟：起点「' + pick.name + '」，防御强度 ' + S.defense);
    play();
  }
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------- 事件 ---------- */
  function bind() {
    $$('[data-lab-seg]', root).forEach(function (box) {
      box.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-val]');
        if (!b) return;
        $$('button', box).forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        if (box.dataset.labSeg === 'start') {
          S.start = b.dataset.val; stop(); setStage(1);
        } else {
          S.view = b.dataset.val; renderViz(); paint();
        }
      });
    });
    root.addEventListener('input', function (e) {
      var r = e.target.closest('[data-lab-range]');
      if (!r) return;
      if (r.dataset.labRange === 'stage') { stop(); setStage(+r.value); }
      else { S.defense = +r.value; paint(); }
    });
    root.addEventListener('click', function (e) {
      var t = e.target;
      var stepBtn = t.closest('[data-stepn]');
      if (stepBtn) { stop(); setStage(parseInt(stepBtn.dataset.stepn.replace('S', ''), 10)); return; }
      var playBtn = t.closest('[data-lab-play]'); if (playBtn) { play(); return; }
      if (t.closest('[data-lab-prev]')) { stop(); setStage(S.stage - 1); return; }
      if (t.closest('[data-lab-next]')) { stop(); setStage(S.stage + 1); return; }
      if (t.closest('[data-lab-reset]')) {
        stop(); S.start = 'external'; S.defense = 0; S.heatCell = null; S.selectedRisk = null; S.view = 'topology';
        $$('[data-lab-seg="start"] button', root).forEach(function (b) { b.classList.toggle('active', b.dataset.val === 'external'); });
        $$('[data-lab-seg="view"] button', root).forEach(function (b) { b.classList.toggle('active', b.dataset.val === 'topology'); });
        $('[data-lab-range="defense"]', root).value = 0;
        renderViz(); setStage(1); return;
      }
      if (t.closest('[data-lab-simulate]')) { simulate(); return; }
      if (t.closest('[data-lab-clearfilter]')) { S.heatCell = null; renderPanel(); paint(); return; }
      var goto = t.closest('[data-goto]');
      if (goto) {
        var key = goto.dataset.goto;
        if (D.STAGE_MAP[key]) { stop(); setStage(D.STAGE_MAP[key].no); }
        var sec = $('#lab-sec-' + key, root);
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      var chip = t.closest('[data-node-chip]');
      if (chip) { setHover({ type: 'nodeChip', id: chip.dataset.nodeChip }); return; }
      var tl = t.closest('[data-stage]');
      if (tl && D.STAGE_MAP[tl.dataset.stage]) { stop(); setStage(D.STAGE_MAP[tl.dataset.stage].no); return; }
      var edge = t.closest('[data-edge]');
      if (edge && D.STAGE_MAP[edge.dataset.edge]) { stop(); setStage(D.STAGE_MAP[edge.dataset.edge].no); return; }
      var node = t.closest('[data-node]');
      if (node) { setHover({ type: 'node', id: node.dataset.node }); return; }
      var cell = t.closest('[data-heat]');
      if (cell) {
        var p = cell.dataset.heat.split('|');
        stop();
        S.heatCell = p.join('|');
        setStage(D.STAGE_MAP[p[0]].no, false, true);
        renderPanel(); paint();
        return;
      }
    });
    // 悬停联动（委托在稳定的根节点上）
    root.addEventListener('mouseover', function (e) {
      var t = e.target, h = null;
      var node = t.closest('[data-node]'); if (node) h = { type: 'node', id: node.dataset.node };
      var edge = t.closest('[data-edge]'); if (edge) h = { type: 'edge', id: edge.dataset.edge };
      var risk = t.closest('[data-risk]'); if (risk) h = { type: 'risk', id: risk.dataset.risk };
      var chip = t.closest('[data-node-chip]'); if (chip) h = { type: 'nodeChip', id: chip.dataset.nodeChip };
      var cell = t.closest('[data-heat]');
      if (cell) { var p = cell.dataset.heat.split('|'); h = { type: 'heat', stage: p[0], cat: p[1] }; }
      var tl = t.closest('[data-stage]'); if (tl) h = { type: 'edge', id: tl.dataset.stage };
      if (h) setHover(h);
    });
    root.addEventListener('mouseout', function (e) {
      var from = e.target.closest('[data-node],[data-edge],[data-risk],[data-node-chip],[data-heat],[data-stage]');
      var to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-node],[data-edge],[data-risk],[data-node-chip],[data-heat],[data-stage]');
      if (from && !to) { S.hover = null; paint(); }
    });
  }

  /* ---------- 挂载 ---------- */
  function mount(host, opts) {
    opts = opts || {};
    S.view = ['topology', 'timeline', 'heat'].indexOf(opts.view) >= 0 ? opts.view : 'topology';
    S.start = opts.start || 'external';
    S.stage = clamp(parseInt(opts.stage, 10) || 1, 1, STAGES.length);
    S.defense = clamp(parseInt(opts.defense, 10) || 0, 0, 100);
    S.selectedRisk = opts.risk || null;
    S.heatCell = null; S.hover = null; S.playing = false; S.timer = null;
    if (opts.risk && D.RISK_MAP[opts.risk] && D.RISK_MAP[opts.risk].stages.length) {
      var st = D.STAGE_MAP[D.RISK_MAP[opts.risk].stages[0]];
      if (st && !opts.stage) S.stage = st.no;
    }
    host.innerHTML = frameHTML();
    root = host;
    renderChapter();
    renderViz();
    renderPanel();
    paint();
    bind();
  }

  NS.lab = { mount: mount, state: S, stop: stop };
})(window.AISEC = window.AISEC || {});
