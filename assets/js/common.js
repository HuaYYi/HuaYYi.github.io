/* ============================================================
   common.js —— 前台公共脚本
   ============================================================
   职责：
   1. 读取 site-config.json，渲染顶部导航（含站内搜索）与页脚
   2. 根据 config.theme.primary 自动派生深色/浅色，注入 :root CSS 变量
   3. 根据 config.background 渲染动态背景（粒子 / 图片 / 视频 / 关闭）
   4. 提供 BlogUtils 对象给各页面脚本使用（ROOT、fetchJSON、escapeHTML、
      icon、postHref、getPosts、本地模式工具等）

   启动流程：
   DOMContentLoaded → fetch site-config.json → applyTheme → initBackground
     → renderHeader → renderFooter → dispatch('ssb-config-ready')
     → window.initPage(config)  // 各页面自己的初始化钩子

   本地模式（config.localMode=true）：
     文章/图片保存在浏览器 localStorage（键名见下方 LS_LIST_KEY / LS_CONTENT_KEY），
     不走 GitHub API，不需要 PAT。common.js 只负责读取并并入列表；
     写入由 admin.js 负责。
   ============================================================ */

(function () {
  'use strict';

  /* ---------- 页面根路径（posts/ 子目录用 ../，其余用 ./） ---------- */
  var ROOT = /\/posts\//.test(location.pathname) ? '../' : './';

  /* 尽早确定亮/暗色（配置还没拉到时先按手动选择或系统偏好），
     尽量缩短暗色页面的白屏闪烁；配置到达后启动流程会再校准一次 */
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
       本地模式下本地文章跳 view.html 动态渲染（无真实 HTML 文件）；
       其余情况直接跳 posts/*.html */
    postHref: function (file) {
      if (this.isLocalMode() && this.isLocalFile(file)) {
        return ROOT + 'posts/view.html?file=' + encodeURIComponent(file);
      }
      return ROOT + 'posts/' + file;
    },

    /* ============================================================
       本地模式（localStorage 文章存储）
       键约定（admin.js 与此文件保持完全一致，修改请同步）：
         ssb.local.posts            文章元数据数组 [{title,date,updated,file,summary,category,cover,local}]
         ssb.local.content.<file>   文章正文 HTML（编辑器 innerHTML）
       ============================================================ */
    LS_LIST_KEY: 'ssb.local.posts',
    LS_CONTENT_KEY: 'ssb.local.content.',
    _localCache: null,         /* getLocalPosts() 的结果缓存 */

    /* 站点设置的本地覆盖键（与 admin.js 保持一致，修改请同步）：
       站点设置页在本地模式下把整份配置/应用数据存到这里，
       前台读取时优先于仓库文件；「清空缓存」只清文章，不清这些键 */
    LS_SITE_KEY: 'ssb.local.site-config',
    LS_APP_PREFIX: 'ssb.local.app.',

    /* 读取 localStorage 中的 JSON；不存在/损坏返回 null */
    readLocalJSON: function (key) {
      var raw = null;
      try { raw = localStorage.getItem(key); } catch (e) { return null; }
      if (raw === null) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },

    /* 首页应用数据（search-engines/quotes/nav-links）统一入口：
       本地模式下优先读 localStorage 覆盖，没有再 fetch 仓库 JSON。
       与 getPosts() 同思路，保证后台改完本地即刻生效 */
    loadDataFile: function (filename) {
      if (this.isLocalMode()) {
        var data = this.readLocalJSON(this.LS_APP_PREFIX + filename.replace(/\.json$/, ''));
        if (data !== null) return Promise.resolve(data);
      }
      return this.fetchJSON(this.ROOT + filename);
    },

    isLocalMode: function () {
      return !!(this.config && this.config.localMode);
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

    /* 清空本地模式数据：文章元数据列表 + 所有正文（ssb.local.content.* 前缀键）。
       遍历整个 localStorage 按前缀删，而不是记死键名，是为了
       将来若扩展出 ssb.local.images 等新前缀也一并覆盖到。
       清完记得调 _localCache = null，让 getLocalPosts() 下次重新读取 */
    clearLocalData: function () {
      var removed = [];
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k === this.LS_LIST_KEY || k.indexOf(this.LS_CONTENT_KEY) === 0) {
          removed.push(k);
        }
      }
      removed.forEach(function (k) { localStorage.removeItem(k); });
      this._localCache = null;
      this._postsPromise = null;   /* 列表缓存一并失效，避免清空后还读到旧数据 */
      return removed.length;
    },

    /* 读取并缓存文章列表，按日期倒序；本地模式会把本地文章并入列表 */
    getPosts: function () {
      if (!this._postsPromise) {
        var self = this;
        this._postsPromise = this.fetchJSON(ROOT + 'posts-list.json')
          .then(function (list) {
            var merged = Array.isArray(list) ? list.slice() : [];
            if (self.isLocalMode()) {
              merged = merged.concat(self.getLocalPosts());
            }
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
      /* 页脚社交图标（site-config.json 的 social[].icon：github / mail） */
      mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
      github: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>'
    };
    return icons[type] || '';
  };

  /* ============================================================
     顶部导航渲染（logo + 站内搜索 + 移动端汉堡抽屉）
     ============================================================ */

  /* ---------- 暗色模式 ----------
     优先级：用户手动选择（localStorage）> 配置 theme.dark > 系统偏好。
     手动选择一旦存在就覆盖一切，符合开关直觉 */
  var THEME_KEY = 'ssb.theme';

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function resolveTheme(config) {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* 隐私模式等场景忽略 */ }
    if (saved === 'light' || saved === 'dark') return saved;
    var mode = config && config.theme && config.theme.dark;
    if (mode === 'light' || mode === 'dark') return mode;
    return systemPrefersDark() ? 'dark' : 'light';
  }

  /* 设置主题（persist=true 写入 localStorage）。壁纸明暗联动与手动开关共用 */
  function setTheme(next, persist) {
    if (persist) {
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 忽略写入失败 */ }
    }
    document.documentElement.dataset.theme = next;
    applyTheme(BlogUtils.config);          /* 主色在暗/亮下派生规则不同，重新算 */
    updateThemeToggles(next);
  }

  function toggleTheme() {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    /* 手动切主题 = 明确表态：关闭壁纸明暗跟随，避免下次刷新又被壁纸改回去 */
    if (window.SSBScreenBG) window.SSBScreenBG.setFollowTone(false);
    setTheme(next, true);
  }

  function updateThemeToggles(theme) {
    var icon = theme === 'dark' ? 'sun' : 'moon';
    var title = theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式';
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.innerHTML = BlogUtils.icon(icon);
      btn.title = title;
      btn.setAttribute('aria-label', title);
    });
  }

  /* 事件委托绑定一次：桌面头部和移动抽屉里的开关共用 .theme-toggle */
  if (!window.__themeBound) {
    window.__themeBound = true;
    document.addEventListener('click', function (e) {
      if (e.target && typeof e.target.closest === 'function' &&
          e.target.closest('.theme-toggle')) toggleTheme();
    });
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
              '<a href="' + ROOT + 'archives.html">归档</a>' +
              '<a href="' + ROOT + 'about.html">关于</a>' +
            '</nav>' +
            '<button class="theme-toggle" type="button"></button>' +
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
          '<a href="' + ROOT + 'archives.html">归档</a>' +
          '<a href="' + ROOT + 'about.html">关于</a>' +
        '</nav>' +
        '<button class="theme-toggle theme-toggle-mobile" type="button"></button>' +
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
    updateThemeToggles(document.documentElement.dataset.theme);
    /* 导航项来自 pages.json 的页面列表（后台「页面管理」维护）：
       上面的三条默认链接是兜底，pages.json 读取成功后覆盖渲染 */
    renderNavFromPages();
  }

  /* ---------- 导航项渲染：读 pages.json 的 pages 数组 ----------
     每个页面一个导航项，顺序即页面数组顺序（「归档调成首页」等
     结构变化在这里自然生效）。页面 file 为空（本地新建页）时
     跳 page.html?slug= 动态渲染。读取失败保持默认兜底链接 */
  function renderNavFromPages() {
    BlogUtils.loadDataFile('pages.json').then(function (data) {
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

  /* ---------- 页脚：收藏横条（左 Ctrl/⌘+D 键帽提示，右社交图标）+ 版权行。
     本地模式标记仍是浮动独立元素（fixed 左下角，脱离文档流） ---------- */
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

    /* 本地模式标记：脱离文档流，绝对定位贴左下角，不影响 footer 居中。
       右侧附带「清空缓存」按钮：本地文章全存在 localStorage，
       用户手动清理（F12 → Application → Local Storage）门槛高，
       所以在角标里直接给一个入口，点了二次确认再清，防误触 */
    if (BlogUtils.isLocalMode()) {
      var existing = document.getElementById('local-flag-float');
      if (!existing) {
        var flag = document.createElement('div');
        flag.id = 'local-flag-float';
        flag.className = 'local-flag-float';
        flag.innerHTML = '<span>本地模式 · 文章仅保存在此浏览器</span>' +
          '<button type="button" class="local-flag-clear" title="删除所有本地保存的文章与图片">' +
          BlogUtils.escapeHTML('清空缓存') + '</button>';
        flag.querySelector('.local-flag-clear').addEventListener('click', function (e) {
          /* stopPropagation：角标本体无点击行为，这里只是防御性隔离，避免未来加整条点击时误触发 */
          e.stopPropagation();
          var ok = window.confirm('确定清空本地缓存的文章与图片吗？\n该操作不可恢复，建议先在后台导出备份。');
          if (!ok) return;
          BlogUtils.clearLocalData();
          location.reload();   /* 清完刷新，让各页面的文章列表回到仓库内容 */
        });
        document.body.appendChild(flag);
      }
    }

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
     屏级背景系统（v3）
     ------------------------------------------------------------
     apps.js 把每个屏渲染成 .page-screen > .screen-bg（空层）+ 内容，
     本系统在 ssb-page-rendered 后为每层填充实际背景：

     屏配置（pages.json 的 screens[].bg，写在 dataset 上）：
       default   — landing 第一屏沿用站点设置 config.background
                   （保持首页背景与站点配置联动）；其余屏为透明底色
       particles — Canvas 粒子（参数取站点 background）
       wallpaper — 壁纸（data-bg-file 指定，留空按屏稳定随机）

     访客偏好（localStorage 'ssb.bg-pref'，由全站右键菜单写入）：
       { mode:'default'|'particles'|'wallpaper', file?:具体壁纸,
         followTone?:bool }
       mode 非 default 时覆盖所有屏；壁纸选中后可按 tone 自动切主题。
     壁纸清单来自 wallpapers.json，图床加载失败回退普通底色。
     多个粒子层用 IntersectionObserver 按可见性暂停动画，节省 CPU。
     ============================================================ */
  var BG_PREF_KEY = 'ssb.bg-pref';
  var screenBG = {
    list: [],        /* 当前页所有背景层状态 {layer, section, resolved:{type,file,tone}, ctl} */
    wallpapers: [],
    pref: null
  };

  function readBgPref() {
    try {
      var raw = localStorage.getItem(BG_PREF_KEY);
      screenBG.pref = raw ? JSON.parse(raw) : null;
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

  /* 加载壁纸库（带缓存，失败不影响主流程） */
  var wallpapersPromise = null;
  function loadWallpapers() {
    if (wallpapersPromise) return wallpapersPromise;
    wallpapersPromise = BlogUtils.loadDataFile('wallpapers.json')
      .then(function (data) {
        screenBG.wallpapers = (data && Array.isArray(data.wallpapers)) ? data.wallpapers : [];
        return screenBG.wallpapers;
      })
      .catch(function () { screenBG.wallpapers = []; return []; });
    return wallpapersPromise;
  }

  /* 简单稳定 hash：屏级壁纸留空时，让每屏稳定抽到同一张，刷新不乱跳 */
  function hashIndex(str, n) {
    if (n <= 0) return 0;
    var h = 0;
    for (var i = 0; i < str.length; i++) h = ((h * 31) + str.charCodeAt(i)) >>> 0;
    return h % n;
  }

  /* 解析某一层最终生效的背景（先访客偏好，后屏配置）。
     能进到这里的都是作者开启了背景的屏（bg.type=particles|wallpaper）；
     开关关闭（none）的屏根本不渲染 .screen-bg，访客偏好也无法给它加背景 */
  function resolveLayerBg(layer, section) {
    var pref = screenBG.pref;

    /* 访客选「无背景」：作者开启的背景层也强制留空（只保留透明层） */
    if (pref && pref.mode === 'none') {
      return { type: 'default' };
    }
    if (pref && pref.mode === 'particles') {
      return { type: 'particles' };
    }
    if (pref && pref.mode === 'wallpaper') {
      var list = screenBG.wallpapers;
      var wp = null;
      if (pref.file) {
        wp = list.filter(function (w) { return w.file === pref.file; })[0] || { file: pref.file, tone: pref.tone };
      } else if (list.length) {
        wp = list[hashIndex('global', list.length)];
        writeBgPref(Object.assign({}, pref, { file: wp.file, tone: wp.tone }));
      }
      if (wp) return { type: 'wallpaper', file: wp.file, tone: wp.tone, followTone: pref.followTone !== false };
    }

    var type = layer.dataset.bgType || 'default';
    if (type === 'particles') return { type: 'particles' };
    if (type === 'wallpaper') {
      var f = layer.dataset.bgFile || '';
      var item = null;
      if (f) {
        item = screenBG.wallpapers.filter(function (w) { return w.file === f; })[0] || { file: f };
      } else if (screenBG.wallpapers.length) {
        item = screenBG.wallpapers[hashIndex(section.dataset.screen || '0', screenBG.wallpapers.length)];
      }
      if (item) return { type: 'wallpaper', file: item.file, tone: item.tone, followTone: false };
      return { type: 'default' };   /* 壁纸列表为空等异常：空层兜底 */
    }

    return { type: 'default' };
  }

  /* 清掉一层旧内容并销毁旧控制器（粒子 RAF / 监听器） */
  function clearLayer(state) {
    if (state.ctl) {
      try { state.ctl.destroy(); } catch (e) {}
      state.ctl = null;
    }
    state.layer.innerHTML = '';
    state.layer.className = state.layer.className.replace(/\bscreen-bg-\S+/g, '').trim() + ' screen-bg-empty';
    state.resolved = null;
  }

  function applyLayer(state) {
    var resolved = resolveLayerBg(state.layer, state.section);
    state.resolved = resolved;
    state.layer.className = state.layer.className.replace(/\bscreen-bg-\S+/g, '').trim();
    state.layer.classList.add('screen-bg-' + resolved.type);

    if (resolved.type === 'particles') {
      var bgConf = (BlogUtils.config && BlogUtils.config.background) || {};
      state.ctl = initParticles(state.layer, bgConf, state.section);
      return resolved;
    }

    if (resolved.type === 'wallpaper' && resolved.file) {
      var img = document.createElement('img');
      img.className = 'screen-bg-img';
      img.alt = '';
      img.src = ROOT + resolved.file;
      /* 加载失败：回退普通底色（移除 wallpaper 类避免遮罩盖住页面） */
      img.addEventListener('error', function () {
        state.layer.classList.remove('screen-bg-wallpaper');
        state.layer.classList.add('screen-bg-empty');
        img.remove();
      });
      state.layer.appendChild(img);
      var overlay = document.createElement('div');
      overlay.className = 'screen-bg-overlay';
      state.layer.appendChild(overlay);
      return resolved;
    }

    if (resolved.type === 'image' && resolved.src) {
      var staticImg = document.createElement('img');
      staticImg.className = 'screen-bg-img';
      staticImg.alt = '';
      staticImg.src = ROOT + resolved.src;
      state.layer.appendChild(staticImg);
      return resolved;
    }

    if (resolved.type === 'video' && resolved.src) {
      var v = document.createElement('video');
      v.className = 'screen-bg-img';
      v.src = ROOT + resolved.src;
      v.autoplay = true;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      state.layer.appendChild(v);
      var vCtl = { destroy: function () { try { v.pause(); } catch (e) {} } };
      /* 视频同样按可见性暂停 */
      observeActive(state.section, function (active) {
        if (active) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        else v.pause();
      }, vCtl);
      state.ctl = vCtl;
      return resolved;
    }

    return resolved;
  }

  /* IntersectionObserver：section 不可见时停止重活动画（粒子/视频） */
  var bgIO = null;
  function observeActive(section, onChange, ctl) {
    if (!bgIO) {
      bgIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.target.__bgActiveHandler) en.target.__bgActiveHandler(en.isIntersecting);
        });
      }, { threshold: 0.02 });
    }
    section.__bgActiveHandler = onChange;
    bgIO.observe(section);
    var oldDestroy = ctl.destroy;
    ctl.destroy = function () {
      bgIO.unobserve(section);
      section.__bgActiveHandler = null;
      oldDestroy && oldDestroy();
    };
  }

  /* 初始化当前页所有屏背景（apps.js 渲染完会触发事件） */
  function initScreenBackgrounds() {
    readBgPref();
    var layers = Array.prototype.slice.call(document.querySelectorAll('.screen-bg'));
    screenBG.list = layers.map(function (layer) {
      return { layer: layer, section: layer.closest('.page-screen'), ctl: null, resolved: null };
    });
    screenBG.list.forEach(function (state) {
      clearLayer(state);
      var resolved = applyLayer(state);
      /* 壁纸主题联动（仅访客主动选择的壁纸；普通底色不打扰手动主题选择） */
      if (resolved.type === 'wallpaper' && resolved.followTone && resolved.tone) {
        if (document.documentElement.dataset.theme !== resolved.tone) {
          setTheme(resolved.tone, true);
        }
      }
    });
  }

  /* 右键菜单：写访客偏好后重应用 */
  function setBgPref(pref) {
    writeBgPref(pref);
    if (!screenBG.list.length) return;
    screenBG.list.forEach(function (state) {
      clearLayer(state);
      var resolved = applyLayer(state);
      if (resolved.type === 'wallpaper' && resolved.followTone && resolved.tone &&
          document.documentElement.dataset.theme !== resolved.tone) {
        setTheme(resolved.tone, true);
      }
    });
  }

  window.SSBScreenBG = {
    init: initScreenBackgrounds,
    loadWallpapers: loadWallpapers,
    getPref: function () { return screenBG.pref; },
    setPref: setBgPref,
    /* 换一张随机壁纸：清掉记住的 file 后重新随机 */
    shuffleWallpaper: function () {
      var cur = screenBG.pref || { mode: 'wallpaper' };
      cur.mode = 'wallpaper';
      delete cur.file;
      delete cur.tone;
      cur.followTone = cur.followTone !== false;
      setBgPref(cur);
    },
    setFollowTone: function (on) {
      if (!screenBG.pref || screenBG.pref.mode !== 'wallpaper') return;
      screenBG.pref.followTone = !!on;
      writeBgPref(screenBG.pref);
    },
    wallpapers: function () { return screenBG.wallpapers; }
  };

  /* apps.js 渲染晚于本脚本，模块级监听即可接住 */
  document.addEventListener('ssb-page-rendered', function () {
    loadWallpapers().then(initScreenBackgrounds);
  });

  /* ============================================================
     Canvas 粒子动画
     site-config.json 的 background 字段可调整：
       background.count   粒子数量（默认 6）
       background.speed   基础速度倍率（默认 0.4，值越大飘得越快）
       background.size    [最小半径, 最大半径]（默认 [25, 115]）
       background.color   颜色数组，或 'auto' 取主题色 + 补充色
     每个粒子：大圆形、随机速度+加速度、淡入淡出生命周期、边界软反弹
     ============================================================ */
  /* 返回控制器 {destroy}：多屏各持有一个；section 不可见时暂停 RAF */
  function initParticles(layer, bg, section) {
    var canvas = document.createElement('canvas');
    canvas.className = 'bg-canvas';
    layer.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var shapes = [];

    /* 从配置读取参数，全部给合理默认值防止 JSON 缺字段时报错 */
    var count = Number(bg.count) || 6;
    var speedMul = Number(bg.speed) || 0.4;
    var sizeMin, sizeMax;
    if (Array.isArray(bg.size) && bg.size.length === 2) {
      sizeMin = Number(bg.size[0]) || 25;
      sizeMax = Number(bg.size[1]) || 115;
    } else {
      sizeMin = 25; sizeMax = 115;
    }

    /* 颜色池：null 特殊值 = 运行时取主题色（好让粒子跟主题走） */
    var palette = bg.color === 'auto'
      ? [null, '#f9cc46', '#ef6a5f', '#7cc98e', '#e0e6f0']
      : (Array.isArray(bg.color) ? bg.color : [null]);

    function pickColor(i) {
      var c = palette[i % palette.length];
      if (c === null) return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#1d6ff2';
      return c;
    }

    function resize() {
      var parent = canvas.parentElement;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }

    /* 创建一个粒子：圆形、随机位置/速度/半径/寿命 */
    function randomShape(index, W, H) {
      return {
        type: 'circle',
        color: pickColor(index),
        baseAlpha: 0.66 + Math.random() * 0.22,   /* 0.66~0.88，重叠自然融合 */
        x: Math.random() * W,
        y: Math.random() * H,
        r: sizeMin + Math.random() * (sizeMax - sizeMin),
        vx: (Math.random() - 0.5) * speedMul,
        vy: (Math.random() - 0.5) * speedMul,
        ax: 0, ay: 0,
        life: 0,
        maxLife: 800 + Math.random() * 1200,      /* 存活 40~100 秒 */
        fadeIn: 120,
        fadeOut: 160
      };
    }

    function buildShapes() {
      shapes = [];
      var W = canvas.width;
      var H = canvas.height;
      for (var i = 0; i < count; i++) {
        shapes.push(randomShape(i, W, H));
        shapes[i].life = Math.random() * 200;  /* 初始随机年龄，避免同时出现 */
      }
    }

    var rafId = null;
    var active = true;      /* IntersectionObserver 按屏可见性控制 */

    function onResize() {
      resize();
      buildShapes();
    }

    resize();
    buildShapes();
    window.addEventListener('resize', onResize);

    function drawShape(s) {
      ctx.save();
      ctx.translate(s.x, s.y);

      /* 淡入淡出 × 基础透明度：life < fadeIn 渐显，life > maxLife-fadeOut 渐隐 */
      var alpha = s.baseAlpha;
      if (s.life < s.fadeIn) alpha *= (s.life / s.fadeIn);
      else if (s.life > s.maxLife - s.fadeOut) alpha *= (s.maxLife - s.life) / s.fadeOut;
      alpha = Math.max(0, Math.min(s.baseAlpha, alpha));

      ctx.globalAlpha = alpha;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(0, 0, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var W = canvas.width, H = canvas.height;

      for (var i = 0; i < shapes.length; i++) {
        var s = shapes[i];
        s.life++;

        /* 随机加速度：约 0.4% 概率改变方向，产生自然飘动感 */
        if (Math.random() < 0.004) {
          s.ax = (Math.random() - 0.5) * 0.025;
          s.ay = (Math.random() - 0.5) * 0.025;
        }
        s.vx += s.ax;
        s.vy += s.ay;
        /* 速度上限（按 speedMul 缩放），防止加速度叠加后飞出屏幕 */
        var sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
        if (sp > speedMul * 0.75) {
          s.vx *= (speedMul * 0.75) / sp;
          s.vy *= (speedMul * 0.75) / sp;
        }
        /* 加速度衰减，让速度逐渐趋于稳定 */
        s.ax *= 0.95;
        s.ay *= 0.95;

        s.x += s.vx;
        s.y += s.vy;

        /* 边界软反弹：出界 300px 再从另一侧进入，避免画面边缘粒子堆集 */
        var pad = 300;
        if (s.x < -pad) { s.x = W + pad; }
        if (s.x > W + pad) { s.x = -pad; }
        if (s.y < -pad) { s.y = H + pad; }
        if (s.y > H + pad) { s.y = -pad; }

        drawShape(s);

        /* 生命周期结束：在当前粒子位置重新随机化（不是移除，保持数量稳定） */
        if (s.life >= s.maxLife) {
          shapes[i] = randomShape(i, W, H);
        }
      }
      rafId = requestAnimationFrame(draw);
    }

    function start() {
      if (rafId == null) { rafId = requestAnimationFrame(draw); }
    }
    function stop() {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    var ctl = {
      destroy: function () {
        stop();
        window.removeEventListener('resize', onResize);
      }
    };

    /* 屏不可见（滚动到其他屏）时暂停动画循环，可见时恢复 */
    if (section && typeof IntersectionObserver !== 'undefined') {
      observeActive(section, function (isActive) {
        active = isActive;
        if (isActive) start(); else stop();
      }, ctl);
    }

    start();
    return ctl;
  }

  /* ============================================================
     启动
     DOMContentLoaded → fetch site-config.json → 渲染导航/背景/页脚
                      → dispatch('ssb-config-ready') → 各页面 initPage
     ============================================================ */
  document.addEventListener('DOMContentLoaded', function () {
    BlogUtils.fetchJSON(ROOT + 'site-config.json')
      .then(function (config) {
        /* 本地模式：站点设置页保存的整份配置覆盖仓库文件。
           只在文件本身声明 localMode 时才读覆盖，避免线上配置被本机残留干扰 */
        if (config.localMode) {
          var localConfig = BlogUtils.readLocalJSON(BlogUtils.LS_SITE_KEY);
          if (localConfig) config = localConfig;
        }
        BlogUtils.config = config;

        /* 配置到达后校准主题（theme.dark 默认值在没有手动选择时生效），
           再注入主题色，避免首屏闪一下默认蓝。
           背景改由屏级背景系统在 apps.js 渲染完 ssb-page-rendered 后初始化 */
        document.documentElement.dataset.theme = resolveTheme(config);
        applyTheme(config);

        document.title = document.title.replace(/\s*-\s*My Blog\s*$/, '') +
          (document.title.indexOf(config.siteName) > -1 ? '' : ' - ' + config.siteName);

        renderHeader(config);
        renderFooter(config);

        /* 通知其他脚本 config 已就绪（如 about.html 的邮箱填充） */
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
