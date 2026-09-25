/* ============================================================
   common.js —— 前台公共脚本
   ============================================================
   职责：
   1. 读取 site-config.json，渲染顶部导航（含站内搜索）与页脚
   2. 根据 config.theme.primary 自动派生深色/浅色，注入 :root CSS 变量
   3. SSBScreenBG：按「背景类应用」分发渲染屏背景（粒子 / 壁纸 / 视频 / 关闭），
      并响应访客右键菜单的选择（偏好存 localStorage）
   4. 提供 BlogUtils 对象给各页面脚本使用（ROOT、fetchJSON、escapeHTML、
      icon、postHref、getPosts、本地存储工具等）

   启动流程：
   DOMContentLoaded → fetch site-config.json → applyTheme → renderHeader
     → renderFooter → dispatch('ssb-config-ready')
     → window.initPage(config)  // 各页面自己的初始化钩子
     （页面渲染后 ssb-page-rendered → SSBScreenBG.init）

   本地存储工作流：
     后台所有改动（文章/配置/应用数据）先写入浏览器 localStorage，
     前台读取时本地覆盖优先于仓库文件；写入由 admin.js 负责，
     提交到 GitHub 统一走后台的「提交管理」。
   ============================================================ */

(function () {
  'use strict';

  /* ---------- 页面根路径（posts/ 子目录用 ../，其余用 ./） ---------- */
  var ROOT = /\/posts\//.test(location.pathname) ? '../' : './';

  /* 尽早确定亮/暗色（配置还没拉到时先按「偏好模式」解析），
     尽量缩短暗色页面的白屏闪烁；配置到达后启动流程会再校准一次。
     ssb.theme 存偏好模式：auto（跟随系统，默认）/ light / dark；
     data-theme 存当前实际生效的亮/暗。auto 下这里先按系统偏好解析 */
  (function bootstrapThemeAttr() {
    var saved = null;
    try { saved = localStorage.getItem('ssb.theme'); } catch (e) {}
    document.documentElement.dataset.theme =
      saved === 'dark' || saved === 'light'
        ? saved
        : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  })();

  /* ---------- 可调整的内部配置（不属于站点配置，不需要写到 JSON） ---------- */
  var INTERNAL = {
    headerSearchDebounce: 120,   /* 顶部搜索框输入防抖 ms */
    mobileDrawerBreakpoint: 720, /* 超过此屏宽自动关闭移动端抽屉 */
    themeDarkMix: 0.28,         /* 主题色与黑色混多少比例做 hover 深色 */
    themeLightMix: 0.92         /* 主题色与白色混多少比例做浅底高亮 */
  };

  /* ============================================================
     BlogUtils —— 全局工具对象
     apps.js / post.js / screen-scroll.js 等脚本都通过 window.BlogUtils 使用
     ============================================================ */
  window.BlogUtils = {
    ROOT: ROOT,
    config: null,              /* 站点配置（site-config.json 解析结果），启动时注入 */
    _postsPromise: null,       /* getPosts() 的单次 Promise 缓存，避免重复 fetch */

    /* 通用 fetchJSON：加 no-cache（方便部署后立即看到最新），非 2xx 抛错 */
    fetchJSON: function (url) {
      return fetch(url, { cache: 'no-cache' }).then(function (res) {
        if (!res.ok) throw new Error('加载失败: ' + url + ' (' + res.status + ')');
        return res.json();
      });
    },

    /* 转义 HTML 特殊字符，用于所有用户输入/动态数据插入 DOM */
    escapeHTML: function (str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    /* 文章详情链接：任何页面层级都能用。
       本地有覆盖的文章跳 view.html 动态渲染（无真实 HTML 文件）；
       其余情况直接跳 posts/*.html */
    postHref: function (file) {
      if (this.isLocalFile(file)) {
        return ROOT + 'posts/view.html?file=' + encodeURIComponent(file);
      }
      return ROOT + 'posts/' + file;
    },

    /* ============================================================
       本地文章（localStorage 存储）
       键约定（admin.js 与此文件保持完全一致，修改请同步）：
         ssb.local.posts            文章元数据数组 [{title,date,updated,file,summary,category,cover,local}]
         ssb.local.content.<file>   文章正文 HTML（编辑器 innerHTML）
       ============================================================ */
    LS_LIST_KEY: 'ssb.local.posts',
    LS_CONTENT_KEY: 'ssb.local.content.',
    _localCache: null,         /* getLocalPosts() 的结果缓存 */

    /* 站点配置/应用数据的本地覆盖键（与 admin.js 保持一致，修改请同步）：
       后台保存的内容写在这里，前台读取时优先于仓库文件 */
    LS_SITE_KEY: 'ssb.local.site-config',
    LS_APP_PREFIX: 'ssb.local.app.',

    /* 读取 localStorage 中的 JSON；不存在/损坏返回 null */
    readLocalJSON: function (key) {
      var raw = null;
      try { raw = localStorage.getItem(key); } catch (e) { return null; }
      if (raw === null) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },

    /* 应用数据（data/ 目录下的 search-engines/quotes/nav-links 等）统一入口：
       始终优先读 localStorage 覆盖，没有再 fetch 仓库 JSON，
       保证后台改完本地即刻生效。
       LS 键只取文件名（不含 data/ 目录），与 admin.js 保持一致 */
    loadDataFile: function (filename) {
      var base = filename.split('/').pop();
      var data = this.readLocalJSON(this.LS_APP_PREFIX + base.replace(/\.json$/, ''));
      if (data !== null) return Promise.resolve(data);
      return this.fetchJSON(this.ROOT + filename);
    },

    getLocalPosts: function () {
      if (!this._localCache) {
        try {
          var list = JSON.parse(localStorage.getItem(this.LS_LIST_KEY) || '[]');
          this._localCache = Array.isArray(list) ? list : [];
        } catch (e) {
          this._localCache = [];
        }
      }
      return this._localCache;
    },

    isLocalFile: function (file) {
      return this.getLocalPosts().some(function (p) { return p.file === file; });
    },

    /* 主题偏好模式三态接口（右键菜单「主题模式」子菜单使用；
       实现见下方主题区块，函数声明提升，这里可直接引用） */
    getThemeMode: function () { return themeMode(); },
    setThemeMode: function (mode) { setThemeMode(mode); },
    /* 当前壁纸基调锁：''=未锁定可自由切换；light/dark=主题被壁纸基调锁定 */
    getToneLock: function () { return screenBG.toneLock; },

    /* 读取并缓存文章列表，按日期倒序；本地保存的文章会并入列表。
       合并按 file 去重：同一篇文章正在本地编辑时，本地条目覆盖仓库条目，
       避免列表出现重复行（提交后本地条目清除，自然回落到仓库版本） */
    getPosts: function () {
      if (!this._postsPromise) {
        var self = this;
        this._postsPromise = this.fetchJSON(ROOT + 'data/posts-list.json')
          .then(function (list) {
            var localMap = {};
            self.getLocalPosts().forEach(function (p) { localMap[p.file] = p; });
            var merged = (Array.isArray(list) ? list : [])
              .filter(function (p) { return !localMap[p.file]; })
              .concat(Object.keys(localMap).map(function (f) { return localMap[f]; }));
            return merged.sort(function (a, b) {
              return new Date(b.date) - new Date(a.date);
            });
          });
      }
      return this._postsPromise;
    }
  };

  /* 小图标（导航/搜索/文章元信息复用）。name 不在表中返回空字符串 */
  window.BlogUtils.icon = function (type) {
    var icons = {
      search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
      chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
      calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
      refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>',
      folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
      word: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
      clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>',
      top: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
      /* 暗色模式开关：当前亮色时显示月亮（点我切到暗色），反之显示太阳 */
      moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
      sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
      /* 主题三态之「自动（跟随系统）」：显示器图标 */
      auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
      /* 页脚社交图标（site-config.json 的 social[].icon：github / mail） */
      mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
      github: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>'
    };
    return icons[type] || '';
  };

  /* ============================================================
     顶部导航渲染（logo + 站内搜索 + 移动端汉堡抽屉）
     ============================================================ */

  /* ---------- 主题三态：auto（跟随系统）/ light / dark ----------
     ssb.theme 存「用户偏好模式」，data-theme 存「当前实际生效的亮暗」。
     实际值优先级：显式 light/dark > auto（配置 theme.dark 或系统偏好）。
     显式选择一旦做出，任何机制（含壁纸明暗联动）都不得再覆盖——
     旧版壁纸联动会把暗/亮色持久写回 ssb.theme，正是「手动切到
     亮色却还是暗色」的病根；现在壁纸联动在 auto 下只改当前生效值，
     不写偏好 */
  var THEME_KEY = 'ssb.theme';

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /* 用户偏好模式：只认 auto/light/dark，其它（含旧 null）视为 auto */
  function themeMode() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* 隐私模式等场景忽略 */ }
    return saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto';
  }

  /* 当前应当生效的亮/暗（auto 时：配置默认 > 系统偏好） */
  function resolveTheme(config) {
    var saved = themeMode();
    if (saved === 'light' || saved === 'dark') return saved;
    var cfg = config && config.theme && config.theme.dark;
    if (cfg === 'light' || cfg === 'dark') return cfg;
    return systemPrefersDark() ? 'dark' : 'light';
  }

  /* 只设置「当前生效」的亮暗，不写偏好模式（壁纸明暗联动专用）。
     主色在暗/亮下派生规则不同，所以要重新 applyTheme */
  function applyResolvedTheme(tone) {
    document.documentElement.dataset.theme = tone;
    applyTheme(BlogUtils.config);
  }

  /* 用户选择偏好模式（右键菜单「主题模式」子菜单调用）。
     壁纸基调锁定中（screenBG.toneLock 非空）直接忽略——
     亮暗由壁纸基调决定，只有基调为「无」的背景才允许自由切换 */
  function setThemeMode(mode) {
    if (mode !== 'auto' && mode !== 'light' && mode !== 'dark') return;
    if (screenBG.toneLock) return;
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) { /* 忽略写入失败 */ }
    applyResolvedTheme(resolveTheme(BlogUtils.config));
  }

  /* auto 模式实时跟随系统外观变化；壁纸基调锁定期间不响应 */
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSystemChange = function () {
      if (themeMode() === 'auto' && !screenBG.toneLock) {
        applyResolvedTheme(resolveTheme(BlogUtils.config));
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
    else mq.addListener(onSystemChange);  /* 旧 Safari 兼容 */
  }

  function renderHeader(config) {
    var header = document.getElementById('site-header');
    if (!header) return;

    /* logo 支持图片（写 img 标签），不配置则纯文字 */
    var logoInner = config.logo
      ? '<img src="' + BlogUtils.escapeHTML(config.logo) + '" alt="logo">'
      : '';

    header.innerHTML =
      '<div class="site-header">' +
        '<div class="header-inner">' +
          '<a class="site-logo" href="' + ROOT + 'index.html">' +
            logoInner +
            '<span class="logo-text">' + BlogUtils.escapeHTML(config.siteName) + '</span>' +
          '</a>' +
          '<div class="header-right">' +
            '<nav class="site-nav" id="site-nav">' +
              '<a href="' + ROOT + 'index.html">首页</a>' +
              '<a href="' + ROOT + 'page.html?slug=archives" data-pid="archives">归档</a>' +
              '<a href="' + ROOT + 'page.html?slug=about" data-pid="about">关于</a>' +
            '</nav>' +
            '<div class="site-search">' +
              '<input type="text" id="site-search-input" placeholder="搜索文章" autocomplete="off">' +
              '<button class="search-btn" type="button" aria-label="搜索">' + BlogUtils.icon('search') + '</button>' +
              '<div class="search-dropdown" id="search-dropdown"></div>' +
            '</div>' +
          '</div>' +
          '<button class="hamburger" id="hamburger" type="button" aria-label="菜单">' +
            '<span></span><span></span><span></span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="mobile-drawer" id="mobile-drawer">' +
        '<nav class="mobile-nav" id="mobile-nav">' +
          '<a href="' + ROOT + 'index.html">首页</a>' +
          '<a href="' + ROOT + 'page.html?slug=archives" data-pid="archives">归档</a>' +
          '<a href="' + ROOT + 'page.html?slug=about" data-pid="about">关于</a>' +
        '</nav>' +
        '<div class="mobile-search">' +
          '<input type="text" id="mobile-search-input" placeholder="搜索文章">' +
          '<button class="search-btn" type="button" aria-label="搜索">' + BlogUtils.icon('search') + '</button>' +
          '<div class="search-dropdown" id="mobile-search-dropdown"></div>' +
        '</div>' +
      '</div>' +
      '<div class="drawer-mask" id="drawer-mask"></div>';

    highlightNav();
    bindSiteSearch();
    bindMobileDrawer();
    /* 导航项来自 pages.json 的页面列表（后台「页面管理」维护）：
       上面的三条默认链接是兜底，pages.json 读取成功后覆盖渲染 */
    renderNavFromPages();
  }

  /* ---------- 导航项渲染：读 pages.json 的 pages 数组 ----------
     每个页面一个导航项，顺序即页面数组顺序（落地页锚定首位）。
     落地页 file=index.html；其余页面 file 一律为空，跳
     page.html?slug= 动态渲染。读取失败保持默认兜底链接 */
  function renderNavFromPages() {
    BlogUtils.loadDataFile('data/pages.json').then(function (data) {
      if (!data || !Array.isArray(data.pages) || !data.pages.length) return;

      var linksHTML = data.pages.map(function (p) {
        var href = p.file ? ROOT + p.file : ROOT + 'page.html?slug=' + encodeURIComponent(p.id);
        return '<a href="' + href + '" data-file="' + BlogUtils.escapeHTML(p.file || '') +
               '" data-pid="' + BlogUtils.escapeHTML(p.id) + '">' +
               BlogUtils.escapeHTML(p.title || p.id) + '</a>';
      }).join('');

      var nav = document.getElementById('site-nav');
      if (nav) nav.innerHTML = linksHTML;
      var mnav = document.getElementById('mobile-nav');
      if (mnav) mnav.innerHTML = linksHTML;
      highlightNav();
    }).catch(function () { /* 保持默认链接 */ });
  }

  /* 移动端汉堡抽屉：点按钮展开遮罩层 + 抽屉，窗口放大自动关闭 */
  function bindMobileDrawer() {
    var btn = document.getElementById('hamburger');
    var drawer = document.getElementById('mobile-drawer');
    var mask = document.getElementById('drawer-mask');
    if (!btn || !drawer || !mask) return;

    function open() {
      drawer.classList.add('open');
      mask.classList.add('show');
      btn.classList.add('active');
      document.body.style.overflow = 'hidden';  /* 防抽屉打开时背后还能滚 */
    }
    function close() {
      drawer.classList.remove('open');
      mask.classList.remove('show');
      btn.classList.remove('active');
      document.body.style.overflow = '';
    }

    /* 把 close/open 挂到 window 上，供 resize 和其他地方复用 */
    window.__closeMobileDrawer = close;

    btn.onclick = function () {
      drawer.classList.contains('open') ? close() : open();
    };
    mask.onclick = close;

    /* 移动端搜索（独立绑定一次） */
    var input = document.getElementById('mobile-search-input');
    var dropdown = document.getElementById('mobile-search-dropdown');
    if (input && dropdown && !input.__bound) {
      input.__bound = true;
      input.addEventListener('input', function () {
        var kw = input.value.trim().toLowerCase();
        if (!kw) { dropdown.classList.remove('show'); dropdown.innerHTML = ''; return; }
        BlogUtils.getPosts().then(function (posts) {
          var hits = posts.filter(function (p) {
            return (p.title || '').toLowerCase().indexOf(kw) > -1 ||
                   (p.summary || '').toLowerCase().indexOf(kw) > -1;
          }).slice(0, 8);
          dropdown.innerHTML = hits.length
            ? hits.map(function (p) {
                return '<a class="dd-item" href="' + BlogUtils.postHref(p.file) + '">' +
                         '<div class="dd-title">' + BlogUtils.escapeHTML(p.title) + '</div>' +
                         '<div class="dd-meta">' + BlogUtils.escapeHTML(p.date || '') + '</div>' +
                       '</a>';
              }).join('')
            : '<div class="dd-empty">没有找到相关文章</div>';
          dropdown.classList.add('show');
        });
      });
      input.addEventListener('focus', function () {
        if (dropdown.children.length) dropdown.classList.add('show');
      });
      document.addEventListener('click', function (e) {
        if (e.target && typeof e.target.closest === 'function' &&
            e.target.closest('.mobile-search')) return;
        dropdown.classList.remove('show');
      });
    }

    /* 窗口放大到桌面时自动关抽屉（只绑定一次） */
    if (!window.__mobileResizeBound) {
      window.__mobileResizeBound = true;
      window.addEventListener('resize', function () {
        if (window.innerWidth > INTERNAL.mobileDrawerBreakpoint && window.__closeMobileDrawer) {
          window.__closeMobileDrawer();
        }
      });
    }
  }

  /* 根据当前页面高亮导航项：
     普通页面按文件名匹配 data-file；page.html?slug=xxx 动态页按 slug 匹配 data-pid */
  function highlightNav() {
    var file = location.pathname.split('/').pop() || 'index.html';
    var slug = null;
    try { slug = new URLSearchParams(location.search).get('slug'); } catch (e) {}
    document.querySelectorAll('.site-nav a, .mobile-nav a').forEach(function (a) {
      var hit = (a.dataset.file && a.dataset.file === file) ||
                (slug && a.dataset.pid && a.dataset.pid === slug);
      a.classList.toggle('active', !!hit);
    });
  }

  /* ---------- 顶部站内搜索：标题 + 摘要实时匹配 ---------- */
  function bindSiteSearch() {
    var input = document.getElementById('site-search-input');
    var dropdown = document.getElementById('search-dropdown');
    if (!input || !dropdown) return;

    function render(keyword) {
      var kw = keyword.trim().toLowerCase();
      if (!kw) {
        dropdown.classList.remove('show');
        dropdown.innerHTML = '';
        return;
      }

      BlogUtils.getPosts().then(function (posts) {
        var hits = posts.filter(function (p) {
          return (p.title || '').toLowerCase().indexOf(kw) > -1 ||
                 (p.summary || '').toLowerCase().indexOf(kw) > -1;
        }).slice(0, 8);

        if (!hits.length) {
          dropdown.innerHTML = '<div class="dd-empty">没有找到相关文章</div>';
        } else {
          dropdown.innerHTML = hits.map(function (p) {
            return '<a class="dd-item" href="' + BlogUtils.postHref(p.file) + '">' +
                     '<div class="dd-title">' + BlogUtils.escapeHTML(p.title) + '</div>' +
                     '<div class="dd-meta">' + BlogUtils.escapeHTML(p.date || '') + '</div>' +
                   '</a>';
          }).join('');
        }
        dropdown.classList.add('show');
      }).catch(function () {
        dropdown.innerHTML = '<div class="dd-empty">文章列表加载失败</div>';
        dropdown.classList.add('show');
      });
    }

    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { render(input.value); }, INTERNAL.headerSearchDebounce);
    });

    input.addEventListener('focus', function () {
      if (input.value.trim()) render(input.value);
    });

    /* 点击搜索框外部收起面板 */
    document.addEventListener('click', function (e) {
      if (e.target && typeof e.target.closest === 'function' &&
          e.target.closest('.site-search')) return;
      dropdown.classList.remove('show');
    });
  }

  /* ---------- 页脚：收藏横条（左 Ctrl/⌘+D 键帽提示，右社交图标）+ 版权行 ---------- */
  function renderFooter(config) {
    var footer = document.getElementById('site-footer');
    if (!footer) return;

    /* 内联样式钉死 footer 为全宽块级 — 任何 CSS 缓存都绕不开。
       内边距清零交给内部两段（横条 / 版权行）各自控制，防旧规则残留导致贴边 */
    footer.style.display = 'block';
    footer.style.width = '100%';
    footer.style.maxWidth = 'none';
    footer.style.textAlign = 'left';
    footer.style.marginLeft = '0';
    footer.style.marginRight = '0';
    footer.style.padding = '0';

    /* 收藏快捷键提示：Apple 设备是 ⌘ Command，其余（Windows/Linux）是 Ctrl */
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    var keyLabel = isMac ? '⌘ Command' : 'Ctrl';

    /* 社交图标：icon=mail → 点击弹窗展示博主邮箱地址（QQ「邮我」直达
       写信已随新版 QQ 邮箱改版失效，改为展示地址 + 一键复制，访客
       自行去任意邮箱发信）。其余 icon 按普通外链打开。
       图标类型不在图标库里的直接跳过，避免渲染出空按钮 */
    var social = Array.isArray(config.social) ? config.social : [];
    var socialHTML = social.map(function (s) {
      var icon = BlogUtils.icon(s.icon);
      if (!icon) return '';
      var label = BlogUtils.escapeHTML(s.name || '');
      /* 邮箱地址兼容两种写法：mailto:号@域名 与 纯地址 号@域名。
         含 @ 且 @ 不在开头才视为邮箱，否则按普通外链处理 */
      var addr = (s.url || '').trim().replace(/^mailto:/i, '');
      if (s.icon === 'mail' && addr.indexOf('@') > 0) {
        return '<button type="button" class="footer-social-btn" data-mail="' +
          BlogUtils.escapeHTML(addr) + '" title="' + label + '" aria-label="查看博主邮箱">' +
          icon + '</button>';
      }
      return '<a class="footer-social-btn" href="' + BlogUtils.escapeHTML(s.url || '#') +
        '" target="_blank" rel="noopener" title="' + label + '">' + icon + '</a>';
    }).join('');

    /* 计算已运行天数：从 config.startDate（如 "2021-08-27"）到今天 */
    var runningDays = '';
    if (config.startDate) {
      var start = new Date(config.startDate.replace(/-/g, '/'));
      var today = new Date();
      var diffMs = today.getTime() - start.getTime();
      var days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      runningDays = ' · 已运行 ' + days + ' 天';
    }

    var year = new Date().getFullYear();
    var startYear = year;
    if (config.startDate) {
      var m2 = /^(\d{4})/.exec(config.startDate);
      if (m2) startYear = Number(m2[1]);
    }
    var copyrightYears = (startYear === year) ? year : (startYear + '-' + year);

    footer.innerHTML =
      '<div class="footer-band"><div class="footer-band-inner">' +
        '<p class="footer-collect">按 <kbd>' + keyLabel + '</kbd> + <kbd>D</kbd> 收藏本站，随时回来看看</p>' +
        (socialHTML ? '<div class="footer-social">' + socialHTML + '</div>' : '') +
      '</div></div>' +
      '<p class="footer-copy">© ' + copyrightYears + runningDays + ' · ' +
      BlogUtils.escapeHTML(config.siteName) + ' · All Rights Reserved</p>';

    var mailBtn = footer.querySelector('[data-mail]');
    if (mailBtn) {
      mailBtn.addEventListener('click', function () {
        showMailAddress(mailBtn.getAttribute('data-mail'));
      });
    }
  }

  /* ============================================================
     邮箱地址弹窗（页脚邮箱图标触发）：QQ「邮我」直达写信已随新版
     QQ 邮箱改版失效，改为展示博主邮箱地址 + 一键复制，访客自行
     去任意邮箱写信
     ============================================================ */
  function showMailAddress(address) {
    var old = document.getElementById('mail-modal-mask');
    if (old) old.remove();   /* 防止重复打开时叠加 */

    var mask = document.createElement('div');
    mask.id = 'mail-modal-mask';
    mask.className = 'mail-modal-mask';
    mask.innerHTML =
      '<div class="mail-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="mail-modal-close" aria-label="关闭">&times;</button>' +
        '<h3>联系博主</h3>' +
        '<p class="mail-modal-hint">把邮件发到下面的地址，任何邮箱都可以：</p>' +
        '<div class="mail-addr-row">' +
          '<code class="mail-addr" title="' + BlogUtils.escapeHTML(address) + '">' +
          BlogUtils.escapeHTML(address) + '</code>' +
          '<button type="button" class="mail-copy">复制地址</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    function close() {
      mask.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    mask.querySelector('.mail-modal-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    var copyBtn = mask.querySelector('.mail-copy');
    copyBtn.addEventListener('click', function () {
      function done() {
        copyBtn.textContent = '已复制 ✓';
        copyBtn.disabled = true;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(address).then(done).catch(function () {
          legacyCopy(address);
          done();
        });
      } else {
        legacyCopy(address);
        done();
      }
    });

    /* 剪贴板兜底：非安全环境（http / file）下 clipboard API 可能缺失 */
    function legacyCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
    }
  }

  /* ============================================================
     主题色注入：读取 config.theme.primary，自动派生深色/浅色注入 :root
     生成的 CSS 变量：
       --primary       原色（用户配置）
       --primary-dark  hover/激活态（原色 + 黑色 INTERNAL.themeDarkMix 比例）
       --primary-light 浅底高亮（原色 + 白色 INTERNAL.themeLightMix 比例）
     ============================================================ */
  function applyTheme(config) {
    var primary = config && config.theme && config.theme.primary;
    if (!primary) return;
    var hex = /^#?([0-9a-f]{6})$/i.exec(primary.trim());
    if (!hex) return;   /* 非法格式，跳过以免报错 */
    var rgb = parseHex(hex[1]);

    var root = document.documentElement.style;
    var isDark = document.documentElement.dataset.theme === 'dark';

    if (!isDark) {
      /* 亮色：hover 加黑、浅底几乎加白到 92% */
      root.setProperty('--primary', '#' + toHex(rgb));
      root.setProperty('--primary-dark', '#' + toHex(mix(rgb, [0, 0, 0], INTERNAL.themeDarkMix)));
      root.setProperty('--primary-light', '#' + toHex(mix(rgb, [255, 255, 255], INTERNAL.themeLightMix)));
    } else {
      /* 暗色：主色本身提亮以保证在深底上的对比度；
         hover 更亮而不是更黑；浅底高亮改为同色 16% 透明（叠在深底上） */
      var bright = mix(rgb, [255, 255, 255], 0.32);
      var brighter = mix(rgb, [255, 255, 255], 0.5);
      root.setProperty('--primary', '#' + toHex(bright));
      root.setProperty('--primary-dark', '#' + toHex(brighter));
      root.setProperty('--primary-light', 'rgba(' + bright.join(',') + ', .16)');
    }
  }

  /* 主题色辅助：#rrggbb → [r, g, b]；两 RGB 按比例 mix 混色；[r,g,b] → #rrggbb */
  function parseHex(h) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    ];
  }
  function mix(a, b, r) {
    return [
      Math.round(a[0] * (1 - r) + b[0] * r),
      Math.round(a[1] * (1 - r) + b[1] * r),
      Math.round(a[2] * (1 - r) + b[2] * r)
    ];
  }
  function toHex(rgb) {
    return rgb.map(function (n) {
      var h = Math.max(0, Math.min(255, n)).toString(16);
      return h.length < 2 ? '0' + h : h;
    }).join('');
  }

  /* ============================================================
     屏级背景系统（v4：背景即应用）
     ------------------------------------------------------------
     apps.js 把每个屏渲染成 .page-screen > .screen-bg（空层）+ 内容，
     本系统在 ssb-page-rendered 后按「背景应用」填充每层：

     屏配置（pages.json 的 screens[].bg，写在 dataset 上）：
       {app:'背景应用 id', variant?:'应用内选项'}；无 app=不渲染背景层。
       背景应用在 applications/*.js 用 kind:'background' 声明；
       粒子无 variant，壁纸/视频的 variant=具体文件（留空稳定随机）。

     访客偏好（localStorage 'ssb.bg-pref'，由全站右键菜单写入）：
       null                              跟随作者（默认）
       {mode:'none'}                     强制无背景
       {mode:'app', app, variant?, tone?}
     mode=app 覆盖所有屏。

     明暗基调锁定（2026-09-26）：任何生效背景带 tone=light/dark
     （壁纸/视频/颜色的变体字段，粒子在应用参数里配）即把整站主题
     锁定为对应亮暗——不可切换、不改写 ssb.theme；所有背景基调
     为「无」时才恢复自由切换。访客选择与作者配置一视同仁。
     背景资源加载失败回退普通底色；动态背景（粒子/视频）由应用自己
     用 IntersectionObserver 按可见性暂停，节省 CPU。
     ============================================================ */
  var BG_PREF_KEY = 'ssb.bg-pref';
  var screenBG = {
    list: [],          /* 当前页所有背景层状态 {layer, section, resolved, ctl} */
    globalApps: {},    /* pages.json 顶层 apps：背景应用参数（两层合并） */
    pref: null,
    toneLock: ''       /* 当前基调锁：''=未锁定；light/dark=被壁纸基调锁定 */
  };

  /* 旧版偏好（mode=particles|wallpaper）一次性迁移到 v4 结构，
     老访客升级后选择不丢；迁移结果写回，下次直接读新格式 */
  function migratePref(p) {
    if (!p || p.mode === 'none' || p.mode === 'app') return p;
    if (p.mode === 'particles') return { mode: 'app', app: 'particles' };
    if (p.mode === 'wallpaper') {
      return {
        mode: 'app', app: 'wallpapers',
        variant: p.file || '', tone: p.tone
      };
    }
    return null;   /* 陈旧/非法值：回落跟随作者 */
  }

  function readBgPref() {
    try {
      var raw = localStorage.getItem(BG_PREF_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      var p = migratePref(parsed);
      if (JSON.stringify(p) !== JSON.stringify(parsed)) writeBgPref(p);
      screenBG.pref = p;
    } catch (e) { screenBG.pref = null; }
    return screenBG.pref;
  }

  function writeBgPref(pref) {
    screenBG.pref = pref;
    try {
      if (pref) localStorage.setItem(BG_PREF_KEY, JSON.stringify(pref));
      else localStorage.removeItem(BG_PREF_KEY);
    } catch (e) { /* 隐私模式忽略 */ }
  }

  /* 简单稳定 hash：变体留空时让每个 key（全局/某屏）稳定抽到同一项，刷新不乱跳 */
  function hashIndex(str, n) {
    if (n <= 0) return 0;
    var h = 0;
    for (var i = 0; i < str.length; i++) h = ((h * 31) + str.charCodeAt(i)) >>> 0;
    return h % n;
  }

  /* 取背景应用的变体列表（无 variants 钩子=无变体，如粒子） */
  function variantList(def) {
    return def.variants ? def.variants() : Promise.resolve([]);
  }

  /* 解析某一层最终生效的背景（先访客偏好，后屏配置）。异步：壁纸/视频的
     变体列表要从应用数据文件读取。能进到这里的都是作者开启了背景层的屏
     （bg.app）；没有 .screen-bg 的屏，访客偏好也无法给它加背景 */
  function resolveState(state) {
    var layer = state.layer;
    var pref = screenBG.pref;

    /* 访客选「无背景」：作者开启的背景层也强制留空 */
    if (pref && pref.mode === 'none') return Promise.resolve({ kind: 'empty' });

    if (pref && pref.mode === 'app') {
      var def = window.SSBApps.registry[pref.app];
      if (!def || def.kind !== 'background') return Promise.resolve({ kind: 'empty' });

      return variantList(def).then(function (list) {
        /* 无变体（粒子）：基调从应用参数读取（两层合并，与 applyState 同源） */
        if (!def.variants) {
          var cfg0 = window.SSBApps.deepMerge(
            window.SSBApps.appDefaults(def),
            screenBG.globalApps[def.id] || {}
          );
          return { app: def.id, tone: cfg0.tone || '' };
        }
        if (!list.length) return { kind: 'empty' };

        var hit = list.filter(function (v) { return v.value === pref.variant; })[0];
        if (!hit) {
          /* 未指定或指定项已被删：全局稳定抽一个并写回偏好（保持原行为） */
          hit = list[hashIndex('global', list.length)];
          writeBgPref(Object.assign({}, pref, { variant: hit.value, tone: hit.tone || '' }));
        }
        return { app: def.id, variant: hit.value, tone: hit.tone || '' };
      });
    }

    /* 无访客偏好：跟随作者（init 时固化的配置，非动态 dataset） */
    var appId = state.authorApp;
    var sdef = window.SSBApps.registry[appId];
    if (!sdef || sdef.kind !== 'background') return Promise.resolve({ kind: 'empty' });

    return variantList(sdef).then(function (list) {
      if (!sdef.variants) {
        var cfg1 = window.SSBApps.deepMerge(
          window.SSBApps.appDefaults(sdef),
          screenBG.globalApps[sdef.id] || {}
        );
        return { app: sdef.id, tone: cfg1.tone || '' };
      }
      if (!list.length) return { kind: 'empty' };

      var item = list.filter(function (v) { return v.value === state.authorVariant; })[0];
      if (!item) {
        /* 屏未指定或指定项已删：按屏稳定随机（不写偏好，不打扰访客） */
        item = list[hashIndex(state.section.dataset.screen || '0', list.length)];
      }
      return { app: sdef.id, variant: item.value, tone: item.tone || '' };
    });
  }

  /* 清掉一层旧内容并销毁旧控制器（粒子 RAF / 视频播放 / 监听器） */
  function clearLayer(state) {
    if (state.ctl) {
      try { state.ctl.destroy(); } catch (e) {}
      state.ctl = null;
    }
    state.layer.innerHTML = '';
    state.layer.className = state.layer.className.replace(/\bscreen-bg-\S+/g, '').trim() + ' screen-bg-empty';
    state.resolved = null;
  }

  /* 填充一层：解析后交给对应背景应用 render。
     render 返回函数=destroy（动态背景必需）；返回 false 或 Promise resolve
     false=无内容（图库空等异常），留空层兜底 */
  function applyState(state) {
    return resolveState(state).then(function (resolved) {
      state.resolved = resolved;
      state.layer.className = state.layer.className.replace(/\bscreen-bg-\S+/g, '').trim();
      /* dataset 同步实际生效的背景（apps.js 只在初次渲染时按作者配置设过，
         访客切换后必须更新，DOM 才能反映真实状态） */
      if (resolved.kind === 'empty' || !resolved.app) {
        state.layer.dataset.bgApp = '';
        state.layer.dataset.bgVariant = '';
        state.layer.classList.add('screen-bg-empty');
        return resolved;
      }
      state.layer.dataset.bgApp = resolved.app;
      state.layer.dataset.bgVariant = resolved.variant || '';

      var def = window.SSBApps.registry[resolved.app];
      /* 背景应用参数两层合并：schema 默认 ∪ pages.json 顶层 apps[id]（无实例） */
      var cfg = window.SSBApps.deepMerge(
        window.SSBApps.appDefaults(def),
        screenBG.globalApps[resolved.app] || {}
      );

      var ret;
      try {
        ret = def.render(state.layer, {
          cfg: cfg, section: state.section, variant: resolved.variant || ''
        });
      } catch (err) {
        console.error('背景应用渲染失败：' + resolved.app, err);
        state.layer.classList.add('screen-bg-empty');
        return resolved;
      }

      function adopt(v) {
        if (typeof v === 'function') state.ctl = { destroy: v };
        if (v === false) state.layer.classList.add('screen-bg-empty');
      }
      if (ret && typeof ret.then === 'function') {
        return ret.then(adopt).catch(function (err) {
          console.error('背景应用渲染失败：' + resolved.app, err);
          state.layer.classList.add('screen-bg-empty');
        }).then(function () { return resolved; });
      }
      adopt(ret);
      return resolved;
    });
  }

  /* 壁纸明暗基调锁定：任何一层解析出 light/dark 基调即锁定整站主题
     （选了亮只能亮、选了暗只能暗）；全部生效背景的基调都为「无」时
     才允许自由切换。多层都有基调时最后渲染的一层定调（同页请保持
     基调一致）。访客选择与作者配置一视同仁 */
  function collectTone(resolved) {
    if (resolved && (resolved.tone === 'light' || resolved.tone === 'dark')) {
      screenBG.toneLock = resolved.tone;
    }
  }

  /* 重渲染全部背景层并结算主题：有锁定→强制对应亮暗（覆盖任何手动
     偏好，但不改写 ssb.theme，解锁后用户原偏好自动恢复）；
     无锁定→按偏好模式恢复（auto=配置默认/系统，显式选择=用户值） */
  function applyAllLayers() {
    screenBG.toneLock = '';
    return Promise.all(screenBG.list.map(function (state) {
      clearLayer(state);
      return applyState(state).then(collectTone);
    })).then(function () {
      applyResolvedTheme(screenBG.toneLock || resolveTheme(BlogUtils.config));
    });
  }

  /* 初始化当前页所有屏背景（apps.js 渲染完触发事件，detail.globalApps
     提供背景应用全局参数） */
  function initScreenBackgrounds(detail) {
    readBgPref();
    screenBG.globalApps = (detail && detail.globalApps) || {};
    var layers = Array.prototype.slice.call(document.querySelectorAll('.screen-bg'));
    screenBG.list = layers.map(function (layer) {
      return {
        layer: layer,
        section: layer.closest('.page-screen'),
        /* 作者背景在 init 时固化：访客切换只改 dataset（实际态），
           clearPref 时靠这里回到作者配置，不能反过来读动态 dataset */
        authorApp: layer.dataset.bgApp || '',
        authorVariant: layer.dataset.bgVariant || '',
        ctl: null, resolved: null
      };
    });
    return applyAllLayers();
  }

  /* 右键菜单：写访客偏好后重新应用全部层 */
  function setBgPref(pref) {
    writeBgPref(pref);
    if (!screenBG.list.length) return Promise.resolve();
    return applyAllLayers();
  }

  window.SSBScreenBG = {
    init: initScreenBackgrounds,
    getPref: function () { return screenBG.pref; },
    setPref: setBgPref,
    /* 清除访客偏好：回到跟随作者配置 */
    clearPref: function () { return setBgPref(null); },
    /* 选中某背景应用的具体变体（壁纸/视频/颜色；粒子 variant 留空）。
       主题恒跟随背景明暗基调（无开关） */
    pick: function (app, variant, tone) {
      return setBgPref({
        mode: 'app', app: app, variant: variant || '',
        tone: tone || ''
      });
    },
    /* 随机换一个：在当前背景应用的变体列表里真随机（避开当前项）；
       列表只有一项时原样重选 */
    shuffle: function () {
      var cur = screenBG.pref;
      if (!cur || cur.mode !== 'app') return Promise.resolve();
      var def = window.SSBApps.registry[cur.app];
      if (!def || !def.variants) return Promise.resolve();
      return def.variants().then(function (list) {
        if (!list.length) return;
        var pool = list.filter(function (v) { return v.value !== cur.variant; });
        var choices = pool.length ? pool : list;
        var hit = choices[Math.floor(Math.random() * choices.length)];
        return setBgPref({
          mode: 'app', app: def.id, variant: hit.value,
          tone: hit.tone || ''
        });
      });
    }
  };

  /* apps.js 渲染晚于本脚本，模块级监听即可接住 */
  document.addEventListener('ssb-page-rendered', function (e) {
    initScreenBackgrounds(e.detail || {});
  });

  /* ============================================================
     启动
     DOMContentLoaded → fetch site-config.json → 渲染导航/页脚
                      → dispatch('ssb-config-ready') → 各页面 initPage
     ============================================================ */
  document.addEventListener('DOMContentLoaded', function () {
    BlogUtils.fetchJSON(ROOT + 'site-config.json')
      .then(function (config) {
        /* 后台「站点设置」保存的整份配置覆盖优先于仓库文件。
           这是本地存储工作流的预期行为：访客浏览器里没有覆盖键时
           自动回落到 fetch 到的仓库配置，不受任何影响 */
        var localConfig = BlogUtils.readLocalJSON(BlogUtils.LS_SITE_KEY);
        if (localConfig) config = localConfig;
        BlogUtils.config = config;

        /* 配置到达后校准主题：按偏好模式解析实际亮暗，重新派生主题色，
           避免首屏闪一下默认蓝；同时同步三段开关选中态。
           背景改由屏级背景系统在 apps.js 渲染完 ssb-page-rendered 后初始化 */
        applyResolvedTheme(resolveTheme(config));

        document.title = document.title.replace(/\s*-\s*My Blog\s*$/, '') +
          (document.title.indexOf(config.siteName) > -1 ? '' : ' - ' + config.siteName);

        renderHeader(config);
        renderFooter(config);

        /* 通知其他脚本 config 已就绪（如关于页的邮箱填充） */
        document.dispatchEvent(new CustomEvent('ssb-config-ready'));

        /* 各页面自己的初始化钩子（apps.js / post.js 通过 window.initPage 注册） */
        if (typeof window.initPage === 'function') {
          window.initPage(config);
        }
      })
      .catch(function (err) {
        console.error(err);
      });
  });
})();
