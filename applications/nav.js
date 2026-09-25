/* ============================================================
   SSB 应用：网址导航（nav）
   数据文件：nav-links.json（[{category, links:[{name,url}]}]）
   v3：每个实例独立的 tab/分页状态（zone.__navState），
   窗口缩放时遍历全部实例重算；触摸滑动、圆点、跨 tab 翻页保留。
   screen-scroll.js 通过 SSBApps.navGo(delta, zoneEl) 调用 wheel 钩子
   ============================================================ */
(function () {
  /* 全部实例的状态集合（resize 时遍历重算） */
  var navInstances = [];

  /* 只接受 http/https 链接：导航数据可能来自第三方整理，
     禁止 javascript: 等协议借 href 执行脚本。返回空串=不安全 */
  function safeUrl(u) {
    var s = String(u || '').trim();
    if (/^https?:\/\//i.test(s)) return s;
    try {
      var x = new URL(s, location.href);
      return /^https?:$/.test(x.protocol) ? x.href : '';
    } catch (e) { return ''; }
  }

  SSBApps.define({
    id: 'nav',
    name: '网址导航',
    desc: '分类标签页 + 卡片网格 + 分页轮播（触摸滑动 / 圆点 / 滚轮翻页）',
    hero: true,
    dataFile: 'nav-links.json',
    configSchema: [
      { key: 'panel.enable', label: '启用毛玻璃盒子', type: 'boolean', def: true },
      { key: 'panel.opacity', label: '盒子不透明度（0~1，越大越实）', type: 'number', min: 0, max: 1, step: 0.05, def: 0.4 },
      { key: 'panel.blur', label: '毛玻璃模糊 px', type: 'number', min: 0, max: 40, step: 1, def: 8 },
      { key: 'wheelCrossTab', label: '滚轮翻到边界时跨分类继续翻', type: 'boolean', def: true },
      { key: 'touchThreshold', label: '触摸滑动翻页最小距离 px', type: 'number', min: 10, max: 200, step: 5, def: 50 },
      { key: 'perPageRows', label: '每页固定行数（列数由 CSS 断点控制）', type: 'number', min: 1, max: 6, step: 1, def: 2 }
    ],
    /* 滚轮在导航板块内滚动：翻该实例自己的页（screen-scroll.js 调用） */
    wheel: function (delta, zoneEl) {
      if (zoneEl && zoneEl.__navState) {
        var st = zoneEl.__navState;
        st.goPage(delta > 0 ? st.page + 1 : st.page - 1, st.cfg.wheelCrossTab !== false);
      }
    },
    css: `
:root {
  --card-h: 88px;          /* 网址导航卡片高度 */
  --card-gap: 10px;        /* 卡片之间的间距 */
  --card-radius: 10px;     /* 卡片圆角 */
  --nav-zone-maxw: 880px;  /* 导航区最大宽度 */
  --nav-dot-border: #c5c8d0;   /* 未选中的分页圆点 */
}
html[data-theme="dark"] {
  --nav-dot-border: #4a5160;
}
/* 玻璃盒子面板（glassmorphism 毛玻璃风格）：
   半透明底 + backdrop-filter 模糊背景 + 高光细边 + 柔和大投影。
   透明度/模糊强度由配置注入 CSS 变量（render 时写在 .nav-zone 上） */
.nav-zone {
  --panel-opacity: .55;    /* 底色透明度 0~1，越大越实（配置缺省值） */
  --panel-blur: 16px;      /* 毛玻璃模糊半径 px，越大背景越「雾」 */
  /* 面板底色/高光边按主题切换：亮色透白，暗色透深灰 */
  --panel-bg: rgba(255, 255, 255, var(--panel-opacity));
  --panel-border: rgba(255, 255, 255, .65);
  width: 100%;
  max-width: var(--nav-zone-maxw);
  margin: 0 auto;
  padding: 18px 22px 16px;
  background: var(--panel-bg);
  /* saturate 提亮透过的颜色，让玻璃后面的粒子更通透不发灰（Safari 需 -webkit- 前缀） */
  -webkit-backdrop-filter: blur(var(--panel-blur)) saturate(160%);
  backdrop-filter: blur(var(--panel-blur)) saturate(160%);
  border: 1px solid var(--panel-border);   /* 玻璃高光边 */
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(60, 80, 180, .10); /* 大而柔和，避免生硬 */
}
/* 暗色下玻璃盒子改透深灰；阴影换纯黑系 */
html[data-theme="dark"] .nav-zone {
  --panel-bg: rgba(18, 22, 30, var(--panel-opacity));
  --panel-border: rgba(255, 255, 255, .09);
  box-shadow: 0 8px 32px rgba(0, 0, 0, .45);
}
/* panel.enable=false 时由 JS 加此类，还原为无盒子透明样式 */
.nav-zone.panel-off {
  --panel-opacity: 0;
  --panel-blur: 0px;
  padding: 0;
  background: transparent;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  border-color: transparent;
  box-shadow: none;
}
/* ---------- tab 栏（横向可滚动，窄屏时） ---------- */
.nav-tabs {
  display: flex;
  justify-content: flex-start;
  flex-wrap: nowrap;
  gap: 6px;
  margin-bottom: 20px;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;   /* iOS 丝滑滚动 */
  scrollbar-width: none;               /* Firefox 隐藏滚动条 */
}
.nav-tabs::-webkit-scrollbar { display: none; }
/* 每个分类 tab（胶囊按钮） */
.nav-tab {
  flex-shrink: 0;          /* 不压缩，保证完整显示 */
  padding: 6px 16px;
  border: none;
  border-radius: 999px;
  background: transparent;
  font-size: 14px;
  color: var(--text-2);
  cursor: pointer;
  transition: all .25s ease;
  white-space: nowrap;
}
.nav-tab:hover {
  background: var(--bg-soft);
  color: var(--text);
}
/* 选中态：主题色底白字 */
.nav-tab.active {
  background: var(--primary);
  color: #fff;
  font-weight: 600;
}
/* ---------- 卡片舞台 ---------- */
.nav-stage { position: relative; }
/* 卡片网格容器（grid 布局，列数由 CSS 变量 --nav-cols 控制）
   height 固定为 N 行高度：行数 × 卡片高 + (行数-1) × gap
   不管翻到第几页，卡片区域高度永远不变，指示器位置不跳动 */
.nav-cards {
  --nav-cols: 6;
  display: grid;
  grid-template-columns: repeat(var(--nav-cols), 1fr);
  gap: var(--card-gap);
  height: calc(var(--nav-rows, 2) * var(--card-h) + (var(--nav-rows, 2) - 1) * var(--card-gap));
  overflow: hidden;
}
/* 翻页淡入动画 */
.nav-cards.flip-in .nav-card,
.nav-cards.flip-in .nav-card-disabled {
  animation: navFlip .3s ease both;
}
@keyframes navFlip {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
/* 单个网址卡片 */
.nav-card,
.nav-card-disabled {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: var(--card-h);
  padding: 8px 6px;
  background: var(--surface-translucent);
  backdrop-filter: blur(4px);
  border-radius: var(--card-radius);
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  text-align: center;
  overflow: hidden;
  transition: all .18s;
  border: 1px solid var(--border);
}
.nav-card:hover {
  background: var(--surface);
  border-color: var(--primary);
  color: var(--primary);
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}
/* 图标容器：30×30，里面是 favicon <img> 或首字母 <span>
   img 加载失败时 JS 会隐藏 img、显示 badge */
.nav-card-icon-wrap {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-card-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  object-fit: contain;
  flex-shrink: 0;
  background: #fff;
}
.nav-card-badge {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.nav-card:hover .nav-card-badge {
  background: var(--primary);
  color: #fff;
}
/* 卡片里的网站名，超长截断显示省略号 */
.nav-card-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  line-height: 1.3;
}
/* ---------- 圆点指示器 ---------- */
.nav-dots {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 9px;
  margin-top: 18px;
  min-height: 12px;
}
.nav-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--nav-dot-border);
  background: transparent;
  cursor: pointer;
  padding: 0;
  transition: all .25s;
}
.nav-dot:hover { border-color: var(--primary); }
/* 当前页：填充主题色 */
.nav-dot.active {
  border-color: var(--primary);
  background: var(--primary);
}
/* ---------- 窄屏断点（860 → 720 → 480） ----------
   列数逐级减少，JS 读 --nav-cols 来算每页数量（按配置行数） */
@media (max-width: 860px) {
  .nav-cards { --nav-cols: 4; }
}
@media (max-width: 720px) {
  .nav-cards { --nav-cols: 3; }
  /* 玻璃盒子窄屏减小内边距，给卡片留空间 */
  .nav-zone { padding: 14px 12px 12px; border-radius: 16px; }
}
@media (max-width: 480px) {
  .nav-cards { --nav-cols: 2; }
  .nav-zone { padding: 12px 8px 10px; }
}
`,
    render: function (mount, ctx) {
      var conf = ctx.cfg || {};
      /* 兼容旧版：面板参数原存 site-config.json 的 navPanel */
      var legacy = (U.config && U.config.navPanel) || {};
      var panel = conf.panel && typeof conf.panel === 'object' ? conf.panel : legacy;
      var rows = Number(conf.perPageRows) || 2;

      var zone = document.createElement('div');
      zone.className = 'nav-zone';
      mount.appendChild(zone);

      if (panel.enable === false) {
        zone.classList.add('panel-off');
      } else {
        if (panel.opacity != null) zone.style.setProperty('--panel-opacity', panel.opacity);
        if (panel.blur != null) zone.style.setProperty('--panel-blur', Number(panel.blur) + 'px');
      }
      /* 每页行数同时写成 CSS 变量（.nav-cards 高度用） */
      zone.style.setProperty('--nav-rows', rows);

      var state = {
        zone: zone, data: [], tab: 0, page: 0, perPage: 6 * rows,
        cfg: conf,
        goPage: function (n, allowCrossTab) { navGoPage(state, n, allowCrossTab); }
      };
      zone.__navState = state;
      navInstances.push(state);

      return U.loadDataFile('nav-links.json')
        .then(function (groups) {
          if (!groups || !groups.length) { zone.remove(); return; }
          state.data = groups;
          state.tab = 0;
          state.page = 0;
          updatePerPage(state);
          buildNavShell(state);
          renderNavPage(state);

          /* 窗口尺寸变化：所有实例重新算每页数量并回到首页（全页只绑一次） */
          if (!window.__navResizeBound) {
            window.__navResizeBound = true;
            window.addEventListener('resize', function () {
              navInstances.forEach(function (st) {
                if (!document.contains(st.zone)) return;
                updatePerPage(st);
                st.page = 0;
                renderNavPage(st);
              });
            });
          }
        })
        .catch(function (err) {
          console.error('导航数据加载失败', err);
          zone.remove();
        });
    }
  });

  /* 从某实例 .nav-cards 的 CSS 变量读取当前列数（媒体查询控制），乘配置行数 */
  function updatePerPage(state) {
    var cols = 6;
    var rows = Number(state.cfg.perPageRows) || 2;
    var cardEl = state.zone.querySelector('.nav-cards');
    if (cardEl) {
      var colsRaw = getComputedStyle(cardEl).getPropertyValue('--nav-cols').trim();
      var n = parseInt(colsRaw, 10);
      if (n && n > 0) cols = n;
    }
    state.perPage = cols * rows;
  }

  function buildNavShell(state) {
    var zone = state.zone;
    zone.innerHTML =
      '<div class="nav-tabs"></div>' +
      '<div class="nav-stage">' +
        '<div class="nav-cards"></div>' +
      '</div>' +
      '<div class="nav-dots"></div>';

    zone.querySelector('.nav-tabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.nav-tab');
      if (!btn) return;
      navSwitchTab(state, Number(btn.dataset.idx));
    });

    zone.querySelector('.nav-dots').addEventListener('click', function (e) {
      var dot = e.target.closest('.nav-dot');
      if (!dot) return;
      navGoPage(state, Number(dot.dataset.page), false);
    });

    /* 触摸左右滑 → 翻页（仅作用于本实例） */
    var stage = zone.querySelector('.nav-cards');
    var touchX = 0;
    stage.addEventListener('touchstart', function (e) {
      touchX = e.touches[0].clientX;
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - touchX;
      var threshold = Number(state.cfg.touchThreshold) || 50;
      if (Math.abs(dx) > threshold) {
        navGoPage(state, dx > 0 ? state.page - 1 : state.page + 1, state.cfg.wheelCrossTab !== false);
      }
    }, { passive: true });
  }

  function navSwitchTab(state, idx) {
    if (idx < 0 || idx >= state.data.length) return;
    state.tab = idx;
    state.page = 0;
    renderNavPage(state);
    scrollActiveTabIntoView(state);
  }

  /* 选中 tab 后智能滚动：只滚该实例的 .nav-tabs，clamp 防止整页位移 */
  function scrollActiveTabIntoView(state) {
    var tabsEl = state.zone.querySelector('.nav-tabs');
    if (!tabsEl) return;
    var tab = tabsEl.querySelector('.nav-tab.active');
    if (!tab) return;
    var maxScroll = tabsEl.scrollWidth - tabsEl.clientWidth;
    var desired = tab.offsetLeft + tab.offsetWidth / 2 - tabsEl.clientWidth / 2;
    tabsEl.scrollTo({ left: Math.max(0, Math.min(desired, maxScroll)), behavior: 'smooth' });
  }

  function navTotalPages(state) {
    if (!state.data[state.tab]) return 1;
    return Math.max(1, Math.ceil(state.data[state.tab].links.length / state.perPage));
  }

  function navGoPage(state, p, allowCrossTab) {
    var total = navTotalPages(state);

    if (allowCrossTab) {
      if (p >= total) {
        if (state.tab + 1 < state.data.length) { navSwitchTab(state, state.tab + 1); }
        return;
      }
      if (p < 0) {
        if (state.tab - 1 >= 0) {
          navSwitchTab(state, state.tab - 1);
          state.page = navTotalPages(state) - 1;
          renderNavPage(state);
        }
        return;
      }
    } else {
      if (p < 0) p = 0;
      if (p >= total) p = total - 1;
    }

    if (p === state.page && !allowCrossTab) return;
    state.page = p;
    renderNavPage(state);
  }

  function renderNavPage(state) {
    var zone = state.zone;
    var group = state.data[state.tab];
    if (!group) return;

    var total = navTotalPages(state);
    if (state.page >= total) state.page = 0;
    var start = state.page * state.perPage;
    var pageLinks = group.links.slice(start, start + state.perPage);

    zone.querySelector('.nav-tabs').innerHTML = state.data.map(function (g, i) {
      return '<button class="nav-tab' + (i === state.tab ? ' active' : '') +
             '" type="button" data-idx="' + i + '">' + U.escapeHTML(g.category) + '</button>';
    }).join('');

    /* 链接卡片：非 http(s) 的危险 URL 降级为不可点的 span（防 javascript: 注入） */
    var cardsEl = zone.querySelector('.nav-cards');
    cardsEl.innerHTML = pageLinks.map(function (l) {
      var href = safeUrl(l.url);
      var iconSrc = '';
      if (href) {
        try {
          var u = new URL(href);
          iconSrc = u.protocol + '//' + u.hostname + '/favicon.ico';
        } catch (e) {}
      }
      var tag = href ? 'a' : 'div';
      var attrs = href
        ? ' class="nav-card" href="' + U.escapeHTML(href) + '" target="_blank" rel="noopener"'
        : ' class="nav-card-disabled" title="链接协议不受支持（仅允许 http/https）"';
      return '<' + tag + attrs + '>' +
               '<span class="nav-card-icon-wrap">' +
                 (iconSrc ? '<img class="nav-card-icon" src="' + iconSrc + '" alt="">' : '') +
                 '<span class="nav-card-badge"' + (iconSrc ? ' style="display:none"' : '') + '>' +
                   U.escapeHTML((l.name || '?').slice(0, 1)) +
                 '</span>' +
               '</span>' +
               '<span class="nav-card-name">' + U.escapeHTML(l.name) + '</span>' +
             '</' + tag + '>';
    }).join('');

    /* favicon 加载失败兜底：隐藏 img → 显示首字母 badge */
    cardsEl.querySelectorAll('img.nav-card-icon').forEach(function (img) {
      img.addEventListener('error', function () {
        img.style.display = 'none';
        var badge = img.nextElementSibling;
        if (badge) badge.style.display = 'flex';
      });
    });

    cardsEl.classList.remove('flip-in');
    void cardsEl.offsetWidth;   /* 强制 reflow，让翻页动画重新播放 */
    cardsEl.classList.add('flip-in');

    zone.querySelector('.nav-dots').innerHTML = new Array(total).fill(0).map(function (_, i) {
      return '<button class="nav-dot' + (i === state.page ? ' active' : '') +
             '" type="button" data-page="' + i + '" aria-label="第' + (i + 1) + '页"></button>';
    }).join('');
  }
})();
