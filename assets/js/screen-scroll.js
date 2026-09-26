/* ============================================================
   screen-scroll.js —— 屏间滚轮翻页 + 网址导航板块滚轮翻页（全站通用）
   ============================================================
   不归属任何具体页面：index / archives / about / page 及线上生成的
   page-*.html 都直接引用本文件。页面内只要存在 ≥2 个整屏
   （.page-screen.is-full）即自动启用，与模板类型、屏数（2/3/4…）无关；
   最后一屏是长屏时向上翻同样走两段式（先夹回屏顶，再翻上一屏）。
   两类互不干扰的滚轮行为（事件委托挂 window，apps.js 任意时机渲染都生效）：
   1) 鼠标停在某个网址导航板块（.nav-zone）内 → 翻「该实例」的导航页；
   2) 鼠标停在整屏（.page-screen.is-full）的其他区域 → 翻「上一屏 / 下一屏」。
   只要页面有 ≥2 个整屏就支持滚轮翻屏。

   核心机制（v3.3，修复"大滑穿过半截/兜底吸错屏"）：
   - 短屏（屏高 ≤ 可视区，如 hero）：内部无内容可滚，任何滚轮/触摸直接翻页；
   - 长屏（如文章列表）：滚动被完全接管，滚动位置硬性夹在 [屏顶, 屏底]
     区间内，物理上滚不出本屏、穿不到两屏间隙，因此不会卡半截；
   - 翻页判定绑定「手势起点」（wheel 事件间隔 <200ms 视为同一手势）：
     · 手势从内容中部开始 → 滚到屏顶/屏底即被夹停（=第一段"吸回初始态"），
       同一次手势继续滚也不翻页；
     · 手势从屏顶开始向上、或从屏底开始向下 → 才真正翻相邻屏（第二段）。
   - 最后一屏向下无下一屏时放行，保证能继续滚到屏外 footer。

   为什么不用"预判 y+delta 越界再 preventDefault"：真实触摸板一次大滑是
   连续小事件，Firefox 滚轮还是行模式（deltaY=3 实际滚约 48px），预判必
   失准；自管累加 + 区间夹取在任何输入模式下行为都确定。
   自管滚动一律 window.scrollTo({behavior:'instant'})：html 全局
   scroll-behavior:smooth 会让 scrollTop 赋值也变平滑，逐事件累加时会黏滞；
   翻页/吸回动画才用 smooth。
   ============================================================ */

(function () {
  'use strict';

  var WHEEL_MIN = 15;        /* 忽略小于此值的滚轮噪声（高精度触控板） */
  var WHEEL_DEBOUNCE = 120;  /* 导航翻页防抖：一次滚轮手势只翻一页 */
  var TOUCH_MIN = 12;        /* 触摸单步最小位移 px（拖动逐帧累加，门槛要小） */
  var EDGE_TOLERANCE = 24;   /* "手势起于边界"的判定容差 px */
  var LOCK_MIN = 450;        /* 翻页动画最短锁定 ms */
  var LOCK_MAX = 900;        /* 最长锁定 ms（防止动画结束检测失效锁死） */
  var GESTURE_GAP = 200;     /* wheel 事件间隔超过此 ms 视为新手势 */
  var SETTLE_MS = 180;       /* 滚动静止多久后执行半截吸附兜底 */
  var SETTLE_MIN = 40;       /* 距合法停靠点超过此 px 才认为是"半截" */
  var LINE_PX = 16;          /* deltaMode=1（行）时每行近似像素 */

  var scrollEl = document.scrollingElement || document.documentElement;
  var wheelTimer = null;     /* 导航翻页防抖 */
  var lockUntil = 0;         /* 翻页动画锁：此时间前忽略屏间翻页输入 */
  var gesture = null;        /* 当前手势：{ startY: 手势开始时的滚动位置 } */
  var settleTimer = null;

  function headerH() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--header-h');
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }

  function fullScreens() {
    return Array.prototype.slice.call(document.querySelectorAll('#app-screens .page-screen.is-full'));
  }

  /* 某屏对齐头部下沿时的滚动位置（第一屏 offsetTop=0 → dock=0，
     内容自身 padding-top 已让开 header） */
  function dockY(screen) {
    return Math.max(0, screen.offsetTop - headerH());
  }

  /* 长屏内容滚到底时的滚动位置（屏底贴视口底） */
  function bottomY(screen) {
    return Math.max(dockY(screen), screen.offsetTop + screen.offsetHeight - window.innerHeight);
  }

  /* 短屏 = 屏内"自然内容"在可视区内放得下（无溢出内容需要阅读）→ 任意滚即翻页。
     不能用 screen.offsetHeight：.page-screen.is-full 有 min-height:100vh，
     即使只挂一个名言板块，section 也被撑满整屏，会把短内容屏误判成长屏，
     用户就得在大片空白里滚很多下才能翻页。正确依据是 inner 子元素（盒子）
     的自然总高 + padding，与可视内容区（视口高-固定头部）比较 */
  function isShortScreen(screen) {
    var inner = screen.querySelector('.screen-inner');
    if (!inner) return screen.offsetHeight <= window.innerHeight - headerH() + 1;
    var kids = inner.children;
    var natural = 0;
    if (kids.length) {
      var first = kids[0].getBoundingClientRect();
      var last = kids[kids.length - 1].getBoundingClientRect();
      natural = last.bottom - first.top;
    }
    var cs = getComputedStyle(inner);
    natural += (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    return natural <= window.innerHeight - headerH() + 1;
  }

  /* 探针（header 下沿）当前落在哪一屏 */
  function locateScreen(screens, y) {
    var probe = y + headerH() + 1;
    for (var i = 0; i < screens.length; i++) {
      var top = screens[i].offsetTop;
      if (probe >= top && probe < top + screens[i].offsetHeight) return i;
    }
    if (!screens.length) return -1;
    return probe <= screens[0].offsetTop ? 0 : screens.length - 1;
  }

  /* instant 定位（自管累加用，避免全局 smooth 导致逐帧黏滞） */
  function setY(y) { window.scrollTo({ top: y, behavior: 'instant' }); }

  /* smooth 定位（翻页/吸回动画用），按飞行距离加输入锁 */
  function animateToY(y) {
    var dist = Math.abs(y - scrollEl.scrollTop);
    window.scrollTo({ top: y, behavior: 'smooth' });
    lockUntil = Date.now() +
      Math.min(LOCK_MAX, Math.max(LOCK_MIN, dist * 0.6));
  }
  function snapTo(screen) { animateToY(dockY(screen)); }

  /* 取/新手势：wheel 事件间隔短 = 同一手势，保留手势起点 */
  function beginGesture(y) {
    var now = Date.now();
    if (!gesture || now - gesture.lastT > GESTURE_GAP) gesture = { startY: y };
    gesture.lastT = now;
    return gesture;
  }

  /* 短屏：任意方向直接翻相邻屏；目标不存在时放行（第一屏顶/末屏 footer） */
  function shortScreenGo(screens, i, dir) {
    var t = screens[i + (dir > 0 ? 1 : -1)];
    if (t) { snapTo(t); gesture = null; return true; }
    return false;
  }

  /* 长屏：自管滚动 + 区间夹取 + 手势起点两段式。
     deltaPx 向下为正（已按 deltaMode 换算成像素）。
     返回 true=已接管（preventDefault），false=放行浏览器自然滚动 */
  function consumeLong(screens, i, deltaPx) {
    var cur = screens[i];
    var dock = dockY(cur);
    var bot = bottomY(cur);
    var y = scrollEl.scrollTop;
    var g = beginGesture(y);

    if (deltaPx < 0) {
      /* 已在本屏范围之外（下方 footer 区）向上：先放行让浏览器自然回到内容区 */
      if (y > bot + EDGE_TOLERANCE) return false;
      var prev = screens[i - 1];
      if (g.startY <= dock + EDGE_TOLERANCE) {
        /* 手势起于屏顶 → 翻上一屏（没有上一屏就夹在屏顶） */
        if (prev) { snapTo(prev); gesture = null; return true; }
        setY(dock); return true;
      }
      /* 手势起于中部：夹停在屏顶（第一段），同一次手势不再翻页 */
      setY(Math.max(dock, y + deltaPx));
      return true;
    }

    if (deltaPx > 0) {
      var next = screens[i + 1];
      if (!next) return false;   /* 最后一屏向下：放行到 footer */
      if (g.startY >= bot - EDGE_TOLERANCE) {
        /* 手势起于屏底 → 翻下一屏 */
        snapTo(next); gesture = null; return true;
      }
      /* 手势起于中部：夹停在屏底（第一段） */
      setY(Math.min(bot, y + deltaPx));
      return true;
    }
    return false;
  }

  function isEditableTarget(target) {
    return target && target.closest && target.closest('input, textarea, select, [contenteditable]');
  }

  /* wheel deltaY 换算成像素：0=像素 1=行 2=页 */
  function wheelPx(e) {
    var d = e.deltaY;
    if (e.deltaMode === 1) return d * LINE_PX;
    if (e.deltaMode === 2) return d * window.innerHeight;
    return d;
  }

  /* ---------- 鼠标滚轮 ---------- */
  window.addEventListener('wheel', function (e) {
    /* 噪声过滤按换算后的像素量：Firefox 行模式每格 deltaY=3（≈48px），
       直接拿 e.deltaY 过滤会把整格滚轮当噪声丢掉 */
    var px = wheelPx(e);
    if (Math.abs(px) < WHEEL_MIN) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;   /* 缩放等组合键放行 */
    if (isEditableTarget(e.target)) return;

    /* 1) 网址导航板块内：翻该实例的导航页（tab 栏横向滚动放行） */
    var zone = e.target.closest && e.target.closest('.nav-zone');
    if (zone && window.SSBApps) {
      if (e.target.closest('.nav-tabs')) return;
      e.preventDefault();
      clearTimeout(wheelTimer);
      var delta = e.deltaY;
      wheelTimer = setTimeout(function () {
        window.SSBApps.navGo(delta, zone);
      }, WHEEL_DEBOUNCE);
      return;
    }

    /* 2) 整屏区域：动画锁内吞掉输入防打断；短屏翻页 / 长屏自管夹取 */
    if (Date.now() < lockUntil) { e.preventDefault(); return; }
    var screens = fullScreens();
    if (screens.length < 2) return;
    var i = locateScreen(screens, scrollEl.scrollTop);
    if (i < 0) return;
    var handled = isShortScreen(screens[i])
      ? shortScreenGo(screens, i, px > 0 ? 1 : -1)
      : consumeLong(screens, i, px);
    if (handled) e.preventDefault();
  }, { passive: false });

  /* ---------- 触摸滑动：长屏逐帧跟手累加（夹区间），短屏滑即翻页 ----------
     preventDefault 抑制浏览器惯性，抬手即停——撞屏顶停在屏顶，再滑才翻页，
     两段式与鼠标完全一致；一次手势最多触发一次翻页 */
  var touchStartY = 0;
  var touchFired = false;   /* 本手势是否已触发翻页（触发后剩余移动全拦截） */

  window.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { touchFired = true; return; }
    touchStartY = e.touches[0].clientY;
    touchFired = false;
    gesture = null;   /* 触摸手势独立计起点，不复用 wheel 的手势 */
  }, { passive: true });

  window.addEventListener('touchmove', function (e) {
    if (touchFired) { e.preventDefault(); return; }
    if (isEditableTarget(e.target)) return;
    if (e.target.closest && e.target.closest('.nav-zone')) return;  /* 导航自管 */

    var dy = touchStartY - e.touches[0].clientY;   /* 上滑 dy>0 = 向下 */
    if (Math.abs(dy) < TOUCH_MIN) return;
    touchStartY = e.touches[0].clientY;            /* 逐帧增量，非累计 */

    if (Date.now() < lockUntil) { e.preventDefault(); return; }
    var screens = fullScreens();
    if (screens.length < 2) return;
    var i = locateScreen(screens, scrollEl.scrollTop);
    if (i < 0) return;
    var handled = isShortScreen(screens[i])
      ? shortScreenGo(screens, i, dy > 0 ? 1 : -1)
      : consumeLong(screens, i, dy);
    if (handled) {
      /* 短屏翻页后本手势不再响应；长屏夹取只是跟手，保持可继续拖 */
      if (isShortScreen(screens[i])) touchFired = true;
      e.preventDefault();
    }
  }, { passive: false });

  /* ---------- 半截卡屏兜底（键盘 PageUp/Down、拖拽滚动条等非滚轮输入） ----------
     合法停留区：① 某长屏的自然滚动范围 [dock, bot]；② 最后一屏 bot 到
     文档底（footer 区，要能停在页脚阅读）；③ 某屏的停靠点 dock。
     其余位置（短屏下方/长屏顶上方的两屏穿越区）为非法半截：吸回"紧贴
     其上方的那一屏"的 dock（即从哪屏向上越界就回哪屏，例如从第二屏拖到
     400 应回第二屏 791 而不是第一屏 0，不能用纯最近距离，边界处只差几 px）。
     滚轮/触摸已自管夹取，正常情况下不会产生间隙位置。 */
  window.addEventListener('scroll', function () {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      if (Date.now() < lockUntil) return;
      var screens = fullScreens();
      if (screens.length < 2) return;
      var y = scrollEl.scrollTop;
      var maxY = scrollEl.scrollHeight - window.innerHeight;

      /* 合法 1：长屏自然滚动范围；最后一屏额外放行到文档底（footer） */
      for (var k = 0; k < screens.length; k++) {
        var s = screens[k];
        if (isShortScreen(s)) continue;
        var upper = dockY(s) - SETTLE_MIN;
        var lower = bottomY(s) + (k === screens.length - 1 ? (maxY - bottomY(s)) : SETTLE_MIN);
        if (y >= upper && y <= lower) return;
      }
      /* 合法 2：某屏停靠点 */
      for (k = 0; k < screens.length; k++) {
        if (Math.abs(y - dockY(screens[k])) <= SETTLE_MIN) return;
      }
      /* 非法：优先吸回 dock 紧邻在其上方的屏（从该屏向上越界）；
         不存在（已高过所有 dock）再退回最近 dock */
      var above = null;
      for (k = 0; k < screens.length; k++) {
        if (dockY(screens[k]) > y + SETTLE_MIN) { above = screens[k]; break; }
      }
      var target = above;
      if (!target) {
        var nd = Infinity;
        screens.forEach(function (s) {
          var d = Math.abs(y - dockY(s));
          if (d < nd) { nd = d; target = s; }
        });
      }
      if (target) animateToY(dockY(target));
    }, SETTLE_MS);
  }, { passive: true });
})();
