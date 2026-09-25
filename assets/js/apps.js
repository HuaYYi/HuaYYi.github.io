/* ============================================================
   apps.js —— 应用注册表 / 应用加载器 / 页面渲染引擎
   ============================================================
   心智模型（v3）：
     页面 page → 多个屏 screen → 多个盒子 box → 多个板块实例 app
   - 每个页面默认一屏；超过一屏时各屏整屏高，非末屏底部自动出现「下滑」
     提示按钮（点击整屏对齐到下一屏，html scroll-padding 让开固定头部），
     末屏不放回顶按钮；滚轮翻屏状态机在 screen-scroll.js（短屏任意
     滚即翻页、长屏两段式夹取、导航板块内翻导航页），不用 CSS scroll-snap。
   - 盒子控制宽度（px/%）与水平对齐；屏控制盒组的垂直分布；
     板块实例控制自己在盒内的水平对齐。
   - 同类型板块可重复添加（如多个文章列表 / 多个富文本），靠 uid 区分。

   应用体系（v3.5 模块化）：
     每个应用是 applications/<id>.js 里的一次 SSBApps.define({...})
     调用，声明 name/hero/configSchema/css/render；清单在
     applications/applications.json（内置/自定义、数据文件路由）。
     - 仓库文件 applications/<id>.js 即唯一基线；本地模式可丢弃浏览器修改恢复它
     - 应用代码的本地覆盖存
       localStorage（ssb.local.app.appcode.<id>），线上模式提交到仓库
     - 加载逐个隔离：单个应用代码语法/执行错误只影响它自己（进错误
       清单，不进注册表），其余应用照常注册渲染
     - 实例配置三层合并：configSchema 默认 ∪ pages.json 的 apps[id]
       全局默认 ∪ 实例自身 cfg
     - 数据读取统一走 BlogUtils.loadDataFile（本地模式自动读本地覆盖）
   ============================================================ */

(function () {
  'use strict';

  /* 刷新/后退时禁止浏览器恢复上次滚动位置：多屏页必须从完整第一屏开始，
     浏览器恢复的位置曾稳定停在 64px（固定 header 高度），首屏顶部被吃。
     一次性设置即可，对单屏文章页也只是"刷新回顶"，无副作用 */
  if ('scrollRestoration' in history) {
    try { history.scrollRestoration = 'manual'; } catch (e) {}
  }

  var U = window.BlogUtils;

  /* 各模板单屏（未加屏）时盒子的默认宽度，兜底数据使用 */
  var DEFAULT_BOX_WIDTH = { landing: '1000px', list: '760px', content: '740px' };

  /* ============================================================
     应用注册表 + 加载器
     ============================================================ */

  var APPS_DIR = 'applications/';
  var MANIFEST_FILE = APPS_DIR + 'applications.json';
  var LS_APPCODE_PREFIX = 'ssb.local.app.appcode.';

  var registry = {};          /* id → 规范化后的应用定义 */
  var manifest = { apps: [] };/* 清单（builtin/dataFile 等路由信息） */
  var loadErrors = [];        /* 加载/注册失败的应用 [{id,error}] */
  var pendingMeta = null;     /* 当前正在执行代码的清单条目（define 校验用） */
  var appsPromise = null;     /* loadApplications 的去重句柄 */

  /* 应用注册：应用文件里调用 SSBApps.define(def)。
     def = { id, name, desc, hero, kind:'app'|'background',
             configSchema:[{key,label,type,def,...}], css:'样式字符串',
             variants?():Promise<[{value,label,tone}]>,
             render(mount,ctx), wheel?(delta,zoneEl) }
     kind='background' 的背景应用不挂盒子：渲染到屏的 .screen-bg 层，
     由 pages.json 的 screens[].bg.app 引用，参数只有两层（无实例 cfg）；
     variants 用于「一种背景内含多个可选项」（壁纸库/视频库），
     后台背景类型与右键菜单据此自动列出，新增背景类型无需改别处 */
  function define(def) {
    def = def || {};
    if (!def.id || typeof def.id !== 'string') throw new Error('define 缺少合法 id');
    if (pendingMeta && def.id !== pendingMeta.id) {
      throw new Error('应用 id 与清单/文件名不一致：应为「' + pendingMeta.id + '」，实际为「' + def.id + '」');
    }
    if (typeof def.render !== 'function') throw new Error('应用「' + def.id + '」缺少 render 函数');

    var norm = {
      id: def.id,
      name: String(def.name || def.id),
      desc: String(def.desc || ''),
      hero: def.hero === true,
      kind: def.kind === 'background' ? 'background' : 'app',
      /* 数据文件路由以清单为准（清单不管代码内部，只管仓库文件路由） */
      dataFile: (pendingMeta && pendingMeta.dataFile) ? String(pendingMeta.dataFile) : '',
      builtin: !!(pendingMeta && pendingMeta.builtin),
      configSchema: Array.isArray(def.configSchema) ? def.configSchema : [],
      css: typeof def.css === 'string' ? def.css : '',
      variants: typeof def.variants === 'function' ? def.variants : null,
      render: def.render,
      wheel: typeof def.wheel === 'function' ? def.wheel : null
    };
    registry[norm.id] = norm;
    injectAppCss(norm);
  }

  /* 应用自带 CSS 注入：每个应用一个 <style data-app-css=id>。
     注入位置在 common/home/archives/post.css 之后，页面级 ssb-page-style
     在 renderPage 时才追加（永远更靠后，可覆盖应用样式中的变量） */
  function injectAppCss(def) {
    var old = document.querySelector('style[data-app-css="' + cssEsc(def.id) + '"]');
    if (old) old.parentNode.removeChild(old);
    if (!def.css) return;
    var st = document.createElement('style');
    st.setAttribute('data-app-css', def.id);
    st.textContent = def.css;
    document.head.appendChild(st);
  }

  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  /* 加载全部应用：清单 → 逐个取代码 → 逐个隔离执行。
     任何一个失败都不影响其他（错误进 loadErrors）；整体永远 resolve */
  function loadApplications(force) {
    if (appsPromise && !force) return appsPromise;
    loadErrors = [];
    appsPromise = U.loadDataFile(MANIFEST_FILE)
      .catch(function () { return { apps: [] }; })
      .then(function (mf) {
        manifest = mf && Array.isArray(mf.apps) ? mf : { apps: [] };
        return Promise.all(manifest.apps.map(loadOneApp));
      })
      .then(function () { return { registry: registry, errors: loadErrors }; });
    return appsPromise;
  }

  function loadOneApp(meta) {
    return fetchAppCode(meta.id)
      .then(function (code) { executeAppCode(code, meta); })
      .catch(function (err) {
        console.error('应用「' + meta.id + '」加载失败：', err);
        loadErrors.push({ id: meta.id, error: err && err.message ? err.message : String(err) });
      });
  }

  /* 应用代码来源：始终优先 localStorage 覆盖（保存后即时生效），
     没有覆盖再 fetch applications/<id>.js（no-cache，改完强刷即生效） */
  function fetchAppCode(id) {
    try {
      var raw = localStorage.getItem(LS_APPCODE_PREFIX + id);
      if (raw != null) return Promise.resolve(raw);
    } catch (e) {}
    return fetch(U.ROOT + APPS_DIR + encodeURIComponent(id) + '.js', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('代码文件读取失败：' + APPS_DIR + id + '.js（HTTP ' + res.status + '）');
        return res.text();
      });
  }

  /* 受控执行：new Function 注入 SSBApps/BlogUtils（别名 U）。
     语法错误在编译期抛出，执行错误在运行期抛出，均被 loadOneApp 隔离 */
  function executeAppCode(code, meta) {
    var fn;
    try {
      fn = new Function('SSBApps', 'BlogUtils', 'U', '\n' + code + '\n');
    } catch (e) {
      throw new Error('代码语法错误：' + e.message);
    }
    pendingMeta = meta;
    try {
      fn(window.SSBApps, U, U);
    } catch (e) {
      throw new Error('注册执行失败：' + e.message);
    } finally {
      pendingMeta = null;
    }
  }

  /* 读取应用代码原文（不经过注册表）：
     与 fetchAppCode 同路径，但不依赖 initPage 流程 */
  function readAppCode(id) {
    try {
      var raw = localStorage.getItem(LS_APPCODE_PREFIX + id);
      if (raw != null) return Promise.resolve(raw);
    } catch (e) {}
    return fetch(U.ROOT + APPS_DIR + encodeURIComponent(id) + '.js', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      });
  }

  /* configSchema 点路径读写（key 支持 'panel.opacity' 两级嵌套） */
  function setPath(obj, path, val) {
    var ks = String(path).split('.');
    var t = obj;
    for (var i = 0; i < ks.length - 1; i++) {
      if (!(t[ks[i]] && typeof t[ks[i]] === 'object')) t[ks[i]] = {};
      t = t[ks[i]];   /* 游标必须下移，否则嵌套键会全写到根上 */
    }
    t[ks[ks.length - 1]] = val;
  }

  function getPath(obj, path) {
    var ks = String(path).split('.');
    var t = obj;
    for (var i = 0; i < ks.length; i++) {
      if (t == null) return undefined;
      t = t[ks[i]];
    }
    return t;
  }

  /* 应用默认参数（schema def 集合） */
  function appDefaults(def) {
    var out = {};
    (def.configSchema || []).forEach(function (s) {
      if (s.def !== undefined) setPath(out, s.key, s.def);
    });
    return out;
  }

  /* 两层深合并（panel 这类嵌套配置需要）；数组/标量整体覆盖 */
  function deepMerge(base, over) {
    Object.keys(over || {}).forEach(function (k) {
      var v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        deepMerge(base[k], v);
      } else {
        base[k] = v;
      }
    });
    return base;
  }

  /* pages.json 缺失 / 加载失败时的兜底（v3 形态） */
  var DEFAULT_DATA = {
    responsive: { templates: [] },
    apps: {
      posts: { count: 6, summary: true, cover: true, order: 'newest', category: '' },
      'archive-list': { groupBy: 'year', filters: true, order: 'newest' }
    },
    pages: [
      {
        id: 'home', title: '首页', template: 'landing', file: 'index.html',
        screens: [
          { bg: { type: 'particles' }, vAlign: 'center', boxes: [
            { width: '1000px', hAlign: 'center', apps: [
              { uid: 'd2', id: 'quote', enable: true, align: 'center' },
              { uid: 'd3', id: 'search', enable: true, align: 'center' },
              { uid: 'd4', id: 'nav', enable: true, align: 'center' }
            ] }
          ] },
          { bg: { type: 'none' }, vAlign: 'start', boxes: [
            { width: '760px', hAlign: 'center', apps: [
              { uid: 'd5', id: 'posts', enable: true, align: 'left', cfg: { title: '最新文章' } }
            ] }
          ] }
        ]
      },
      {
        id: 'archives', title: '归档', template: 'list', file: '',
        screens: [
          { bg: { type: 'none' }, vAlign: 'start', boxes: [
            { width: '760px', hAlign: 'center', apps: [
              { uid: 'e1', id: 'archive-list', enable: true, align: 'left' }
            ] }
          ] }
        ]
      },
      {
        id: 'about', title: '关于', template: 'content', file: '',
        screens: [
          { bg: { type: 'none' }, vAlign: 'start', boxes: [
            { width: '740px', hAlign: 'center', apps: [
              { uid: 'f1', id: 'rich-content', enable: true, align: 'left',
                cfg: { html: '<p>关于页暂无内容。</p>' } }
            ] }
          ] }
        ]
      }
    ]
  };

  /* uid 生成：v3 数据里实例缺失 uid 时就地补齐 */
  var uidSeq = 0;
  function genUID() { uidSeq += 1; return 'u' + Date.now().toString(36) + uidSeq; }

  /* ============================================================
     响应式模板库（v3.1）：模板按层级分类（screen|box|app），
     rules 为断点档位数组（max=生效的浏览器最大宽度 px）。
     屏/盒/应用通过 responsive 字段挂载："tpl:<id>" 引用模板，
     或 { rules:[...] } 自定义；渲染时编译为页面级 @media 样式。
     非法字段一律清洗掉，渲染端不需要再做防御
     ============================================================ */
  var BOX_W_RE = /^\d+(\.\d+)?(px|%)$/;
  var RESP_LEVELS = ['screen', 'box', 'app'];
  var ALIGN_KEYS = { vAlign: 1, hAlign: 1 };
  var RESP_PROPS = {
    screen: { padV: 1, padH: 1, gap: 1, vAlign: 1, hAlign: 1 },
    box: { width: 1, padV: 1, padH: 1, gap: 1 },
    app: { marginV: 1, marginH: 1, hidden: 1 }
  };

  /* 单档规则清洗：返回 null = max 非法或一个有效属性都没有 */
  function sanitizeRule(level, r) {
    if (!r || typeof r !== 'object') return null;
    var max = Math.round(Number(r.max));
    if (!isFinite(max) || max <= 0 || max > 99999) return null;
    var out = { max: max };
    Object.keys(RESP_PROPS[level]).forEach(function (k) {
      var v = r[k];
      if (v == null || v === '') return;
      if (k === 'hidden') {
        if (v === true || v === 'true') out.hidden = true;
        return;
      }
      if (k === 'width') {
        var s = String(v).trim();
        if (BOX_W_RE.test(s)) out.width = s;
        return;
      }
      if (ALIGN_KEYS[k]) {
        if (v === 'start' || v === 'center' || v === 'end') out[k] = v;
        return;
      }
      var n = Number(v);
      if (isFinite(n) && n >= 0 && n <= 9999) out[k] = Math.round(n * 10) / 10;
    });
    return Object.keys(out).length > 1 ? out : null;
  }

  /* 可选数值字段（盒 padV/padH/gap、应用 marginV/marginH 的基础值） */
  function optNum(v) {
    if (v == null || v === '') return undefined;
    var n = Number(v);
    return isFinite(n) && n >= 0 && n <= 9999 ? Math.round(n * 10) / 10 : undefined;
  }

  /* 挂载引用清洗：非法引用 / 悬空模板 id 一律归一为无（渲染回落默认表现） */
  function normalizeAttach(level, ref, templates) {
    if (!ref) return undefined;
    if (typeof ref === 'string') {
      if (ref.indexOf('tpl:') !== 0) return undefined;
      var id = ref.slice(4);
      var hit = templates.some(function (t) { return t.id === id && t.appliesTo === level; });
      return hit ? 'tpl:' + id : undefined;
    }
    if (typeof ref === 'object' && Array.isArray(ref.rules)) {
      var rules = [];
      ref.rules.forEach(function (r) {
        var c = sanitizeRule(level, r);
        if (c) rules.push(r);
      });
      return rules.length ? { rules: rules } : undefined;
    }
    return undefined;
  }

  /* 模板库整体清洗（id 去重、层级合法、规则逐档清洗）；返回清洗后的模板数组 */
  function normalizeResponsive(data) {
    var raw = data.responsive && Array.isArray(data.responsive.templates) ? data.responsive.templates : [];
    var seen = {};
    var templates = [];
    raw.forEach(function (t) {
      if (!t || typeof t.id !== 'string' || !t.id || seen[t.id]) return;
      if (RESP_LEVELS.indexOf(t.appliesTo) < 0) return;
      seen[t.id] = true;
      var rules = [];
      (Array.isArray(t.rules) ? t.rules : []).forEach(function (r) {
        var c = sanitizeRule(t.appliesTo, r);
        if (c) rules.push(c);
      });
      templates.push({ id: t.id, name: String(t.name || t.id), appliesTo: t.appliesTo, rules: rules });
    });
    data.responsive = { templates: templates };
    return templates;
  }

  /* v3 数据清洗（每次渲染前就地执行）：
     bg 取值收敛、响应式挂载清洗、布局数值夹取、实例 uid 补齐。
     已不再兼容 v1/v2 旧结构——异常数据（无 pages/无 screens）
     分别回落内置兜底与空屏 */
  function normalizeV3(data) {
    if (!data || !Array.isArray(data.pages)) return DEFAULT_DATA;
    var tplLib = normalizeResponsive(data);

    data.pages.forEach(function (page) {
      if (Array.isArray(page.screens) && page.screens.length) {
        /* 需要背景的屏由 pages.json 显式写 particles/wallpaper；
           响应式挂载与基础布局数值就地清洗 */
        page.screens.forEach(function (sc) {
          normalizeScreenBg(sc);
          sc.responsive = normalizeAttach('screen', sc.responsive, tplLib);
          (sc.boxes || []).forEach(function (box) {
            box.responsive = normalizeAttach('box', box.responsive, tplLib);
            box.padV = optNum(box.padV);
            box.padH = optNum(box.padH);
            box.gap = optNum(box.gap);
            (box.apps || []).forEach(function (inst) {
              if (!inst.uid) inst.uid = genUID();
              inst.responsive = normalizeAttach('app', inst.responsive, tplLib);
              inst.marginV = optNum(inst.marginV);
              inst.marginH = optNum(inst.marginH);
            });
          });
        });
        return;
      }

      /* 无 screens 的异常/陈旧数据：给一空屏，渲染端与后台表现一致 */
      var tpl = page.template === 'list' || page.template === 'content' ? page.template : 'landing';
      page.screens = [makeEmptyScreen(tpl)];
      delete page.apps;
    });

    return data;
  }

  /* 屏背景：app=背景应用 id（开启背景层），variant=该应用内具体选项
     （壁纸/视频文件，粒子无变体）；旧版 particles/wallpaper 自动迁移，
     缺失/非法归一为 none。
     不在此校验 app 是否注册——数据可能引用了已删除的应用：渲染时留空层、
     后台仍显示原值，避免静默丢失配置 */
  function normalizeScreenBg(sc) {
    var b = sc && sc.bg;
    if (b && typeof b.app === 'string' && b.app) {
      sc.bg = b.variant ? { app: b.app, variant: String(b.variant) } : { app: b.app };
      return;
    }
    var t = b && b.type;
    if (t === 'particles') { sc.bg = { app: 'particles' }; return; }
    if (t === 'wallpaper') {
      sc.bg = b.file ? { app: 'wallpapers', variant: String(b.file) } : { app: 'wallpapers' };
      return;
    }
    sc.bg = { type: 'none' };
  }

  function makeEmptyScreen(tpl) {
    return {
      bg: { type: 'none' },
      vAlign: tpl === 'landing' ? 'center' : 'start',
      boxes: [ { width: DEFAULT_BOX_WIDTH[tpl] || '760px', hAlign: 'center', apps: [] } ]
    };
  }

  /* ============================================================
     页面渲染引擎
     ============================================================ */

  /* 找到当前页面的元数据：
     1. page.html?slug=xxx 动态渲染（本地新建页面没有静态 HTML 文件）
     2. 按 pathname 文件名匹配 pages[].file */
  function findCurrentPage(data) {
    var slug = new URLSearchParams(location.search).get('slug');
    if (slug) {
      return data.pages.filter(function (p) { return p.id === slug; })[0] || null;
    }
    var file = location.pathname.split('/').pop() || 'index.html';
    return data.pages.filter(function (p) { return (p.file || '') === file; })[0] || null;
  }

  /* 每个页面生命周期只渲染一次；用它实现"首次渲染回到顶部"的一次性停靠 */
  var firstRenderDone = false;

  function renderPage(rawData, siteConfig) {
    var data = normalizeV3(rawData);
    var page = findCurrentPage(data);
    if (!page) return;   /* 不是容器页面（如文章页）→ 不做任何事 */

    var tpl = page.template === 'list' || page.template === 'content' ? page.template : 'landing';
    var screens = (page.screens && page.screens.length ? page.screens : [makeEmptyScreen(tpl)]);
    var multi = screens.length > 1;

    /* landing 始终整屏；list/content 只有一屏时保持普通文档流，
       加了多屏之后同样进入整屏 + 吸附模式 */
    var fullScreen = tpl === 'landing' || multi;

    var root = ensureRoot(tpl);

    /* 实例样式（基础变量 + 响应式 @media）统一编译进页面级 <style>，
       不用内联 style：媒体查询才能按选择器顺序覆盖基础值（无需 !important） */
    var tplLib = data.responsive && data.responsive.templates || [];
    var styleBase = [];
    var styleMedia = {};
    var FLEX_MAP = { start: 'flex-start', center: 'center', end: 'flex-end' };
    function pxs(v) { return (Math.round(Number(v) * 10) / 10) + 'px'; }
    function pushDecl(list, sel, decls) {
      if (decls.length) list.push(sel + '{' + decls.join(';') + '}');
    }
    function rulesOf(ref, level) {
      if (!ref) return [];
      if (typeof ref === 'string' && ref.indexOf('tpl:') === 0) {
        var hit = null;
        tplLib.forEach(function (t) { if (t.id === ref.slice(4) && t.appliesTo === level) hit = t; });
        return hit ? hit.rules : [];
      }
      return (ref && Array.isArray(ref.rules)) ? ref.rules : [];
    }

    /* 根节点状态类：CSS 据此决定全屏高度等 */
    root.classList.toggle('is-multi', multi);
    root.classList.toggle('is-landing', tpl === 'landing');
    document.documentElement.classList.add('page-tpl-' + tpl);

    /* 非落地页：页面 h1 + document.title 来自 pages.json */
    if (tpl !== 'landing') {
      var siteName = (U.config && U.config.siteName) || '';
      if (siteName) document.title = (page.title || '') + ' - ' + siteName;
    }

    screens.forEach(function (screen, si) {
      var sec = document.createElement('section');
      sec.className = 'page-screen' + (fullScreen ? ' is-full' : '');
      sec.dataset.screen = String(si);
      sec.dataset.si = String(si);

      /* 背景层：配置了背景应用（bg.app）才渲染。none（背景开关关闭）
         不出层——零渲染开销，访客右键菜单也据此隐藏背景组。
         层内容由 common.js 的 SSBScreenBG 在本页渲染后填充 */
      var bgConf = screen.bg || { type: 'none' };
      if (bgConf.app) {
        var bgEl = document.createElement('div');
        bgEl.className = 'screen-bg';
        bgEl.dataset.bgApp = bgConf.app;
        if (bgConf.variant) bgEl.dataset.bgVariant = bgConf.variant;
        sec.appendChild(bgEl);
      }

      var inner = document.createElement('div');
      inner.className = 'screen-inner screen-valign-' + (screen.vAlign || (tpl === 'landing' ? 'center' : 'start')) +
        ' screen-halign-' + (screen.hAlign || 'center');

      /* 屏级响应式：内边距/盒间距/九宫格位置随浏览器宽度变化 */
      rulesOf(screen.responsive, 'screen').forEach(function (r) {
        var d = [];
        if (r.padV != null) d.push('--scr-padv:' + pxs(r.padV));
        if (r.padH != null) d.push('--scr-padh:' + pxs(r.padH));
        if (r.gap != null) d.push('--scr-gap:' + pxs(r.gap));
        if (r.vAlign) d.push('justify-content:' + FLEX_MAP[r.vAlign]);
        if (r.hAlign) d.push('align-items:' + FLEX_MAP[r.hAlign]);
        pushDecl(styleMedia[r.max] = styleMedia[r.max] || [],
          '.page-screen[data-si="' + si + '"] .screen-inner', d);
      });

      /* 非 landing 的页面标题放在盒组上方（全宽，独立于盒子对齐） */
      if (tpl !== 'landing' && si === 0) {
        var h1 = document.createElement('h1');
        h1.className = 'page-heading ' + (tpl === 'content' ? 'post-title' : 'archive-page-title');
        h1.textContent = page.title || '';
        inner.appendChild(h1);
      }

      (screen.boxes || []).forEach(function (box, bi) {
        var boxEl = document.createElement('div');
        boxEl.className = 'page-box';
        boxEl.dataset.si = String(si);
        boxEl.dataset.bi = String(bi);
        /* hAlign=auto（跟随屏）不写 data-halign，align-self 回落到屏的 align-items */
        if (box.hAlign && box.hAlign !== 'auto') boxEl.dataset.halign = box.hAlign;

        /* 盒子基础样式变量（宽度/内边距/垂直间距） */
        var bSel = '.page-box[data-si="' + si + '"][data-bi="' + bi + '"]';
        var bDecl = [];
        if (box.width) bDecl.push('--box-w:' + box.width);
        if (box.padV != null) bDecl.push('--box-padv:' + pxs(box.padV));
        if (box.padH != null) bDecl.push('--box-padh:' + pxs(box.padH));
        if (box.gap != null) bDecl.push('--box-gap:' + pxs(box.gap));
        pushDecl(styleBase, bSel, bDecl);

        (box.apps || []).forEach(function (inst) {
          if (inst.enable === false) return;
          var def = registry[inst.id];
          /* 未注册（清单缺失/代码损坏）应用：显示可定位的错误占位，
             不再静默跳过——站长能直接在页面上发现坏板 */
          if (!def) {
            var ghost = document.createElement('div');
            ghost.className = 'app app-missing';
            ghost.dataset.uid = inst.uid || '';
            ghost.innerHTML = '<div class="app-error"><b>应用「' + U.escapeHTML(inst.id) +
              '」未加载</b><span>代码文件缺失或注册失败</span></div>';
            boxEl.appendChild(ghost);
            return;
          }

          var shell = document.createElement('div');
          shell.className = 'app app-' + def.id;
          shell.dataset.align = inst.align || 'left';
          if (inst.uid) shell.dataset.uid = inst.uid;
          boxEl.appendChild(shell);

          /* 应用基础外边距 + 应用级响应式（外边距 / 窄屏隐藏） */
          var aSel = '.app[data-uid="' + inst.uid + '"]';
          var aDecl = [];
          if (inst.marginV != null) aDecl.push('--app-mv:' + pxs(inst.marginV));
          if (inst.marginH != null) aDecl.push('--app-mh:' + pxs(inst.marginH));
          pushDecl(styleBase, aSel, aDecl);
          rulesOf(inst.responsive, 'app').forEach(function (r) {
            var d = [];
            if (r.marginV != null) d.push('--app-mv:' + pxs(r.marginV));
            if (r.marginH != null) d.push('--app-mh:' + pxs(r.marginH));
            if (r.hidden) d.push('display:none');
            pushDecl(styleMedia[r.max] = styleMedia[r.max] || [], aSel, d);
          });

          /* 三层配置合并：schema 默认 ∪ pages.json 全局 apps[id] ∪ 实例 cfg */
          var cfg = deepMerge(
            deepMerge(appDefaults(def), (data.apps || {})[inst.id] || {}),
            inst.cfg || {}
          );

          /* 统一渲染调度：同步抛错 / Promise reject 都收敛到错误占位；
             render 返回 false = 无内容（如公告为空）→ 移除挂载壳；
             返回 Promise 时等待其 resolve（false 同样移除） */
          var ret;
          try {
            ret = def.render(shell, { inst: inst, cfg: cfg, uid: inst.uid });
          } catch (err) {
            showAppError(shell, def, err);
            return;
          }
          if (typeof ret === 'function') shell.__appDestroy = ret;
          if (ret && typeof ret.then === 'function') {
            ret.then(function (v) { if (v === false && shell.parentNode) shell.remove(); })
              .catch(function (err) { showAppError(shell, def, err); });
          } else if (ret === false) {
            shell.remove();
          }
        });

        inner.appendChild(boxEl);
      });

      sec.appendChild(inner);

      /* 下滑提示：多屏时，非最后一屏显示「下滑到下一屏」。
         末屏不放「回到顶部」按钮（用户明确不需要；回顶仍可滚轮上翻或
         右键菜单「回到顶部」完成） */
      if (multi && si < screens.length - 1) {
        var hint = document.createElement('button');
        hint.type = 'button';
        hint.className = 'scroll-hint';
        hint.innerHTML =
          '<span class="scroll-hint-text">下滑</span>' +
          '<span class="scroll-mouse"><span class="scroll-wheel"></span></span>';
        hint.addEventListener('click', function () {
          var next = root.querySelector('.page-screen[data-screen="' + (si + 1) + '"]');
          if (next) next.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        sec.appendChild(hint);
      }

      root.appendChild(sec);
    });

    /* 编译页面级样式：基础规则在前，@media 断点按宽度从大到小排列，
       同选择器靠后者覆盖靠前（无需 !important）；无内容则不插节点 */
    var cssText = styleBase.join('');
    Object.keys(styleMedia).map(Number).sort(function (a, b) { return b - a; })
      .forEach(function (max) {
        cssText += '@media (max-width:' + max + 'px){' + styleMedia[max].join('') + '}';
      });
    var oldStyle = document.getElementById('ssb-page-style');
    if (oldStyle) oldStyle.parentNode.removeChild(oldStyle);
    if (cssText) {
      var styleEl = document.createElement('style');
      styleEl.id = 'ssb-page-style';
      styleEl.textContent = cssText;
      document.head.appendChild(styleEl);
    }

    /* 结构就绪：common.js 背景系统据此初始化各屏背景。
       globalApps 一并传出，背景应用参数（两层合并）不必再二次拉取 pages.json */
    document.dispatchEvent(new CustomEvent('ssb-page-rendered', {
      detail: { page: page, screens: screens, globalApps: data.apps || {} }
    }));

    /* 首次渲染一次性回顶：scrollRestoration=manual 已阻止恢复，
       这里兜底渲染完成瞬间把残留偏移归零。直接赋值 scrollTop 是 instant
       语义，不受 html scroll-behavior:smooth 影响（避免加载时回滑动画） */
    if (!firstRenderDone) {
      firstRenderDone = true;
      var se0 = document.scrollingElement || document.documentElement;
      if (se0.scrollTop > 0) se0.scrollTop = 0;
    }
  }

  /* 应用渲染失败占位：把错误显式画在板块位置（个人站，站长需要直接看到） */
  function showAppError(shell, def, err) {
    console.error('板块渲染失败：' + def.id, err);
    shell.classList.add('app-error-shell');
    shell.innerHTML =
      '<div class="app-error">' +
        '<b>应用「' + U.escapeHTML(def.name) + '」渲染失败</b>' +
        '<code>' + U.escapeHTML(err && err.message ? err.message : String(err)) + '</code>' +
      '</div>';
  }

  /* 渲染根节点：静态页（index/archives/about/page-*.html）自带 #app-screens；
     page.html 动态查看器只有 #page-shell 空壳，就地改造为根节点 */
  function ensureRoot(tpl) {
    var existing = document.getElementById('app-screens');
    if (existing) {
      existing.innerHTML = '';
      return existing;
    }
    var shell0 = document.getElementById('page-shell');
    if (shell0) {
      shell0.innerHTML = '';
      shell0.id = 'app-screens';
      return shell0;
    }
    /* 兜底：异常外壳时自行挂一个 */
    var made = document.createElement('main');
    made.id = 'app-screens';
    document.body.appendChild(made);
    return made;
  }

  /* 启动入口：common.js 读完 site-config.json 后调用 window.initPage。
     必须先加载完所有应用（注册 render）再渲染页面；应用加载各自隔离，
     单个失败不阻塞整体（未注册的实例渲染时显示缺失占位） */
  window.initPage = function (siteConfig) {
    loadApplications()
      .then(function () { return U.loadDataFile('data/pages.json'); })
      .then(function (data) {
        renderPage(data && Array.isArray(data.pages) ? data : DEFAULT_DATA, siteConfig);
      })
      .catch(function () { renderPage(DEFAULT_DATA, siteConfig); });
  };

  /* 对外工具接口（其他脚本复用） */
  window.SSBApps = {
    define: define,
    register: define,           /* 别名，语义等价 */
    registry: registry,
    manifest: function () { return manifest; },
    loadErrors: function () { return loadErrors; },
    loadApplications: loadApplications,
    readAppCode: readAppCode,
    appCodeKey: LS_APPCODE_PREFIX,
    appsDir: APPS_DIR,
    appDefaults: appDefaults,
    getPath: getPath,
    setPath: setPath,
    deepMerge: deepMerge,
    /* 背景类应用清单（后台背景类型 select / 右键菜单数据源），
       数组顺序 = 清单注册顺序（manifest 顺序，保证选项稳定） */
    backgroundApps: function () {
      return manifest.apps.map(function (m) { return registry[m.id]; })
        .filter(function (d) { return d && d.kind === 'background'; });
    },
    normalizeV3: normalizeV3,
    /* 响应式规则清洗 + 层级/属性元数据（构造模板与自定义规则编辑器） */
    sanitizeRule: sanitizeRule,
    respMeta: { levels: RESP_LEVELS, props: RESP_PROPS },
    /* screen-scroll.js 在导航板块内滚动滚轮时调用：翻该实例自己的页 */
    navGo: function (delta, zoneEl) {
      var nav = registry.nav;
      if (nav && nav.wheel) nav.wheel(delta, zoneEl);
    }
  };
})();
