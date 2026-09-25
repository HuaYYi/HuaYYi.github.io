/* ============================================================
   context-menu.js —— 全站自定义右键菜单（访客工具箱）
   ============================================================
   - 在任意位置右键唤起；按点击目标给出上下文操作：
       链接上  → 新标签打开 / 复制链接地址
       图片上  → 新标签打开图片 / 复制图片地址
       输入框  → 剪切 / 复制 / 粘贴 / 全选
       任意处  → 明暗切换、背景与壁纸切换、回到顶部、
                 复制本页链接、快捷导航
   - 背景/壁纸选择写 localStorage（ssb.bg-pref），由 common.js 的
     SSBScreenBG 统一应用；文章页等无屏幕背景的页面不显示背景组。
   - 带 data-ctx-native 标记的页面不接管菜单，保留浏览器原生右键。
   - 触摸设备没有右键：右下角显示一个「⋯」工具箱悬浮按钮作为兜底入口。
   ============================================================ */

(function () {
  'use strict';

  /* 标记了 data-ctx-native 的页面保留原生菜单。
     用页面标记而非路径名判断，避免代码里出现可被搜索到的路径词 */
  if (document.documentElement.hasAttribute('data-ctx-native')) return;

  var U = window.BlogUtils;
  var menuEl = null;
  var lastTarget = null;

  /* ---------- 轻提示（复制成功等） ---------- */
  var toastEl = null;
  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'ssb-ctx-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  /* ---------- 剪贴板：优先 Clipboard API，降级 execCommand ---------- */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { toast('已复制'); },
        function () { fallbackCopy(text); }
      );
    }
    fallbackCopy(text);
    return Promise.resolve();
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制'); }
    catch (e) { toast('复制失败，请手动复制'); }
    ta.remove();
  }

  /* ---------- 菜单 DOM 构建 ---------- */
  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.className = 'ssb-ctx';
    menuEl.style.display = 'none';
    document.body.appendChild(menuEl);

    /* 菜单内点击：项动作已在构建时绑定；这里只负责点空白处关闭与子菜单交互 */
    menuEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    menuEl.addEventListener('click', function (e) {
      var sub = e.target.closest('.ssb-ctx-sub > .ssb-ctx-label');
      if (sub) {
        /* 触屏/点击：切换子菜单展开（桌面端同时有 hover 展开） */
        sub.parentElement.classList.toggle('open');
        e.stopPropagation();
        return;
      }
      if (e.target.closest('.ssb-ctx-submenu')) return;   /* 子菜单内部点击由各自项处理 */
      if (!e.target.closest('.ssb-ctx-item')) hide();
    });

    /* 全局关闭时机（target 可能是非 Element，如合成事件落在 document 上） */
    document.addEventListener('click', function (e) {
      if (!e.target || typeof e.target.closest !== 'function') return;
      if (menuEl.style.display !== 'none' && !e.target.closest('.ssb-ctx') &&
          !e.target.closest('.ssb-tool-btn')) {
        hide();
      }
    });
    document.addEventListener('contextmenu', function (e) {
      /* 在菜单自身上右键不重复弹出 */
      if (e.target && typeof e.target.closest === 'function' &&
          e.target.closest('.ssb-ctx')) { e.preventDefault(); return; }
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hide();
    });
    window.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);

    return menuEl;
  }

  /* 单项 DOM：{label, icon, checked, disabled, onClick}；返回元素 */
  function itemNode(opts) {
    var d = document.createElement('div');
    d.className = 'ssb-ctx-item' + (opts.disabled ? ' disabled' : '');
    var iconHTML = opts.icon ? '<span class="ssb-ctx-ico">' + opts.icon + '</span>' : '<span class="ssb-ctx-ico"></span>';
    var check = opts.checked ? '<span class="ssb-ctx-check">✓</span>' : '<span class="ssb-ctx-check"></span>';
    d.innerHTML = iconHTML + '<span class="ssb-ctx-text">' + opts.label + '</span>' + check;
    if (!opts.disabled && opts.onClick) {
      d.addEventListener('click', function (e) {
        e.stopPropagation();
        var keepOpen = opts.onClick(d) === true;   /* 返回 true 保持菜单（如勾选项） */
        if (!keepOpen) hide();
      });
    }
    return d;
  }

  function separatorNode() {
    var d = document.createElement('div');
    d.className = 'ssb-ctx-sep';
    return d;
  }

  /* 子菜单：label + 子项数组（子项可异步，先放占位，ready 后替换） */
  function submenuNode(label, icon, buildChildren) {
    var d = document.createElement('div');
    d.className = 'ssb-ctx-item ssb-ctx-sub';
    d.innerHTML =
      (icon ? '<span class="ssb-ctx-ico">' + icon + '</span>' : '<span class="ssb-ctx-ico"></span>') +
      '<span class="ssb-ctx-label ssb-ctx-text">' + label + '</span>' +
      '<span class="ssb-ctx-arrow">›</span>';
    var sub = document.createElement('div');
    sub.className = 'ssb-ctx-submenu';
    sub.innerHTML = '<div class="ssb-ctx-item disabled"><span class="ssb-ctx-ico"></span>' +
                    '<span class="ssb-ctx-text">加载中…</span><span class="ssb-ctx-check"></span></div>';
    d.appendChild(sub);

    function fill() {
      sub.innerHTML = '';
      var children = buildChildren() || [];
      children.forEach(function (node) { sub.appendChild(node); });
    }
    /* 首次 hover/focus 再构建，壁纸库此时通常已就绪 */
    d.addEventListener('mouseenter', fill);
    d.addEventListener('click', function (e) {
      if (e.target.closest('.ssb-ctx-label')) { fill(); }
    });
    d.__fill = fill;
    return d;
  }

  /* ---------- 各上下文分组 ---------- */

  function linkItems(target) {
    var a = target.closest('a[href]');
    if (!a) return [];
    var href = a.href;
    return [
      itemNode({
        label: '在新标签页打开',
        onClick: function () { window.open(href, '_blank', 'noopener'); }
      }),
      itemNode({
        label: '复制链接地址',
        onClick: function () { copyText(href); }
      }),
      separatorNode()
    ];
  }

  function imageItems(target) {
    var img = target.closest('img');
    if (!img || !img.currentSrc && !img.src) return [];
    var src = img.currentSrc || img.src;
    if (!src) return [];
    return [
      itemNode({
        label: '在新标签页打开图片',
        onClick: function () { window.open(src, '_blank', 'noopener'); }
      }),
      itemNode({
        label: '复制图片地址',
        onClick: function () { copyText(src); }
      }),
      separatorNode()
    ];
  }

  function editableItems(target) {
    var el = target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
    if (!el) return [];
    var inputish = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    if (inputish && ['text', 'search', 'url', 'email', 'password', ''].indexOf(
      (el.type || 'text').toLowerCase()) === -1) return [];

    function exec(cmd) {
      el.focus();
      try { document.execCommand(cmd); } catch (e) {}
    }
    return [
      itemNode({ label: '剪切', onClick: function () { exec('cut'); } }),
      itemNode({ label: '复制', onClick: function () { exec('copy'); } }),
      itemNode({ label: '粘贴', onClick: function () { exec('paste'); } }),
      itemNode({ label: '全选', onClick: function () {
        el.focus();
        if (inputish) el.select();
        else exec('selectAll');
      } }),
      separatorNode()
    ];
  }

  /* 判断右键目标所在的屏是否开启了背景：
     - 屏背景开关关闭（none）的屏不渲染 .screen-bg → 该屏上不显示背景组
     - 文章页等普通文档流页同样没有 → 不显示
     - 触摸兜底按钮挂在 body 上不属于任何屏，取视口中部所在屏兜底 */
  function screenAllowsBg(target) {
    var sec = target && typeof target.closest === 'function'
      ? target.closest('.page-screen') : null;
    if (!sec) {
      var mid = document.elementFromPoint(
        Math.round(document.documentElement.clientWidth / 2),
        Math.round(document.documentElement.clientHeight / 2));
      sec = mid ? mid.closest('.page-screen') : null;
    }
    return !!(sec && sec.querySelector('.screen-bg'));
  }

  /* 背景/壁纸子菜单（仅右键落在「开启了背景的屏」上时出现） */
  function bgSubmenu() {
    if (!window.SSBScreenBG || !window.SSBScreenBG.wallpapers) return null;
    if (!document.querySelector('.screen-bg')) return null;

    return submenuNode('背景', null, function () {
      var nodes = [];
      var pref = window.SSBScreenBG.getPref();
      var mode = pref ? pref.mode : 'default';

      nodes.push(itemNode({
        label: '无背景', checked: mode === 'none',
        onClick: function () {
          /* 访客主动清空该页背景（覆盖作者配置；清除偏好可恢复） */
          window.SSBScreenBG.setPref({ mode: 'none' });
        }
      }));
      nodes.push(itemNode({
        label: '粒子动画', checked: mode === 'particles',
        onClick: function () {
          window.SSBScreenBG.setPref({ mode: 'particles' });
        }
      }));
      nodes.push(separatorNode());

      var wps = window.SSBScreenBG.wallpapers() || [];
      wps.forEach(function (w) {
        var selected = mode === 'wallpaper' && pref.file === w.file;
        nodes.push(itemNode({
          label: w.name || w.file.split('/').pop(),
          checked: selected,
          onClick: function () {
            var follow = pref && pref.followTone === false ? false : true;
            window.SSBScreenBG.setPref({
              mode: 'wallpaper', file: w.file, tone: w.tone, followTone: follow
            });
          }
        }));
      });
      nodes.push(itemNode({
        label: '随机壁纸（换一张）',
        onClick: function () {
          window.SSBScreenBG.shuffleWallpaper();
        }
      }));
      nodes.push(separatorNode());
      nodes.push(itemNode({
        label: '跟随壁纸明暗',
        checked: !(pref && pref.followTone === false),
        disabled: mode !== 'wallpaper',
        onClick: function () {
          var next = pref && pref.followTone === false;
          window.SSBScreenBG.setFollowTone(next);
          if (next) window.SSBScreenBG.setPref(window.SSBScreenBG.getPref());
        }
      }));

      return nodes;
    });
  }

  function navSubmenu() {
    var links = Array.prototype.slice.call(document.querySelectorAll('#site-nav a[href]'));
    if (!links.length) return null;
    return submenuNode('快捷导航', null, function () {
      return links.map(function (a) {
        return itemNode({
          label: a.textContent.trim() || a.href,
          onClick: function () { location.href = a.href; }
        });
      });
    });
  }

  /* ---------- 「主题模式」子菜单：自动（跟随系统）/ 亮色 / 暗色 ----------
     勾选态和切换都走 common.js 暴露的 BlogUtils 三态接口，
     头部三段开关与右键菜单永远同步 */
  var THEME_OPTIONS = [
    { mode: 'auto', label: '自动（跟随系统）', icon: 'auto' },
    { mode: 'light', label: '亮色', icon: 'sun' },
    { mode: 'dark', label: '暗色', icon: 'moon' }
  ];

  function themeSubmenu() {
    return submenuNode('主题模式', U ? U.icon('auto') : '', function () {
      var current = U.getThemeMode();
      return THEME_OPTIONS.map(function (opt) {
        return itemNode({
          label: opt.label,
          icon: U ? U.icon(opt.icon) : '',
          checked: current === opt.mode,
          onClick: function () {
            U.setThemeMode(opt.mode);
            /* 不返回 true：选定即最终结果，菜单直接关闭。
               勾选态无需现场刷新——下次打开时 build() 会重新生成 */
          }
        });
      });
    });
  }

  /* ---------- 根据点击目标组装整份菜单 ---------- */
  function build(target) {
    var m = ensureMenu();
    m.innerHTML = '';

    var groups = []
      .concat(linkItems(target))
      .concat(imageItems(target))
      .concat(editableItems(target));

    groups.forEach(function (n) { m.appendChild(n); });

    /* 通用组 */
    var common = [];

    /* 文章页：目录开关（窄屏开右侧抽屉，宽屏显隐侧栏）。
       post.js 把动作暴露在 window.SSBPost；有 h2/h3 时才出现 */
    if (window.SSBPost && window.SSBPost.hasTOC) {
      common.push(itemNode({
        label: window.SSBPost.tocVisible() ? '收起目录' : '文章目录',
        icon: U ? U.icon('list') : '',
        onClick: function (node) {
          window.SSBPost.toggleTOC();
          /* 窄屏点目录是开抽屉，菜单可以关掉；保持返回默认（关闭） */
        }
      }));
    }

    common.push(themeSubmenu());

    var bg = screenAllowsBg(target) ? bgSubmenu() : null;
    if (bg) common.push(bg);

    common.push(separatorNode());

    if (window.scrollY > 8) {
      common.push(itemNode({
        label: '回到顶部',
        onClick: function () { window.scrollTo({ top: 0, behavior: 'smooth' }); }
      }));
    }

    common.push(itemNode({
      label: '复制本页链接',
      onClick: function () { copyText(location.href); }
    }));

    var nav = navSubmenu();
    if (nav) common.push(nav);

    common.forEach(function (n) { m.appendChild(n); });
  }

  /* ---------- 定位与显隐（视口边缘翻转，避免菜单溢出屏幕） ----------
     传入 anchor（「⋯」按钮的 rect）时走锚定模式：菜单优先出现在
     按钮正上方并留 8px 缝隙，按钮始终可见、可再次点击收起；
     上方空间不足时翻到按钮下方 */
  function show(x, y, anchor) {
    var m = ensureMenu();
    m.style.display = 'block';
    m.classList.add('ssb-ctx-anim');
    var w = m.offsetWidth;
    var h = m.offsetHeight;
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;

    if (anchor) {
      /* 水平夹进视口（x 是按 -220 估算的位置，真实宽度可能不同） */
      x = Math.max(8, Math.min(x, vw - w - 8));
      if (anchor.top - 8 >= h) {
        y = anchor.top - h - 8;               /* 上方放得下：菜单底沿距按钮 8px */
      } else {
        y = anchor.bottom + 8;                /* 放不下：翻到按钮下方 */
        if (y + h > vh - 8) y = Math.max(8, vh - h - 8);
      }
    } else {
      if (x + w > vw - 8) x = Math.max(8, vw - w - 8);
      if (y + h > vh - 8) y = Math.max(8, vh - h - 8);
    }
    m.style.left = x + 'px';
    m.style.top = y + 'px';

    /* 子菜单右侧空间不足时向左展开 */
    Array.prototype.forEach.call(m.querySelectorAll('.ssb-ctx-sub'), function (sub) {
      var r = sub.getBoundingClientRect();
      sub.classList.toggle('flip-x', r.left + w + 170 > vw);
    });
  }

  function hide() {
    if (menuEl) {
      menuEl.style.display = 'none';
      menuEl.classList.remove('ssb-ctx-anim');
      Array.prototype.forEach.call(menuEl.querySelectorAll('.ssb-ctx-sub'), function (s) {
        s.classList.remove('open');
      });
    }
  }

  /* ---------- 全局接管 contextmenu ---------- */
  document.addEventListener('contextmenu', function (e) {
    /* 输入框内也走自定义菜单（已提供剪切/复制/粘贴/全选兜底） */
    e.preventDefault();
    lastTarget = e.target;
    build(e.target);
    show(e.clientX, e.clientY);
  });

  /* ---------- 触摸设备兜底：右下角「⋯」工具箱 ---------- */
  function injectToolButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ssb-tool-btn';
    btn.setAttribute('aria-label', '页面菜单');
    btn.textContent = '⋯';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      /* 菜单已打开时再点按钮 = 收起（菜单不再盖住按钮，锚点始终可点） */
      if (menuEl && menuEl.style.display === 'block') { hide(); return; }
      var r = btn.getBoundingClientRect();
      lastTarget = btn;
      build(btn);
      /* 第三参传按钮 rect：show 内部按真实菜单高度把它放到按钮上方 */
      show(Math.min(r.left, document.documentElement.clientWidth - 220),
           r.top, r);
    });
    document.body.appendChild(btn);
  }
  if (window.matchMedia && matchMedia('(pointer: coarse)').matches) {
    injectToolButton();
  } else {
    /* 窄屏笔记本触摸板等边缘场景：窗口很窄时也给兜底 */
    if (document.documentElement.clientWidth < 560) injectToolButton();
  }
})();
