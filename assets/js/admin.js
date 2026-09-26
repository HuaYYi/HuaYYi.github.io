/* ============================================================
   admin.js —— 博客管理后台
   纯原生 JS，直连 GitHub REST API（无 CORS 问题，原生支持）
   工作流：所有改动（文章/配置/页面/应用）先写入浏览器 localStorage，
           可立刻在前台反复测试；确认可靠后在「提交管理」勾选改动、
           填入 Fine-grained PAT，通过 Git Trees API 一次性提交。
   PAT 策略：仅保存在内存变量中，不持久化，刷新即失效。
   图片策略：编辑器内先以 dataURL 本地预览，提交时统一抽出为
             assets/images/ 下的独立文件并替换为相对路径。
   ============================================================ */

(function () {
  'use strict';

  /* admin/ 在站点二级目录，引用仓库内文件需要 ../ */
  var ROOT = '../';
  var API = 'https://api.github.com';

  /* ---------- 可调整的内部配置 ---------- */
  var INTERNAL = {
    toastMs: 2600              /* Toast 轻提示自动关闭毫秒 */
  };

  /* ---------------- 状态 ---------------- */
  var config = null;            // site-config.json
  var postsCache = [];          // 文章列表缓存（仓库 + 本地合并后）
  var repoPostsCache = [];      // 仓库文章基线（不含本地），用于判断本地文章线上是否存在
  var pat = '';                 // PAT 仅存在于此内存变量
  var editingFile = null;       // 正在编辑的文件名；null = 新建
  var coverDataURL = null;      // 新选封面（本地 dataURL，保存时上传）
  var coverRemote = '';         // 编辑时已有封面（远程相对路径）
  var isPreview = false;

  /* 本地存储：
     文章写入浏览器 localStorage，不直接写 GitHub；
     提交统一走「提交管理」。键约定与 common.js / posts/view.html 一致 */
  var LS_LIST_KEY = 'ssb.local.posts';
  var LS_CONTENT_KEY = 'ssb.local.content.';

  /* 站点配置与应用数据的本地覆盖键（与 common.js 中保持一致，修改请同步）：
     ssb.local.site-config        整份 site-config.json 的本地覆盖
     ssb.local.app.<文件名去后缀>  首页应用数据（search-engines / quotes / nav-links） */
  var LS_SITE_KEY = 'ssb.local.site-config';
  var LS_APP_PREFIX = 'ssb.local.app.';

  /* 站点设置只管理 site-config.json；
     首页三个应用的数据（search-engines/quotes/nav-links）归「应用管理」 */
  var SITE_CONFIG_FILE = 'site-config.json';
  var SAVE_TEXT = '保存到本地';   /* 保存失败时按钮恢复的统一文案 */

  /* DOM 快捷方式 */
  var $ = function (id) { return document.getElementById(id); };

  /* ============================================================
     工具函数
     ============================================================ */

  function escapeHTML(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function nowSlug() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return 'post-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
           '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function rand6() {
    return Math.random().toString(36).slice(2, 8);
  }

  /* UTF-8 字符串 -> base64（支持中文，GitHub Blob API 需要） */
  function utf8ToBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  /* 解析 dataURL：data:image/webp;base64,xxxx */
  function parseDataURL(url) {
    var m = /^data:([\w./+-]+);base64,([\s\S]*)$/.exec(url);
    if (!m) return null;
    var extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
                   'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
                   'video/mp4': 'mp4' };
    return { mime: m[1], b64: m[2], ext: extMap[m[1]] || 'png' };
  }

  /* ---------------- 本地存储（localStorage 文章） ---------------- */

  function readLocalList() {
    try {
      var list = JSON.parse(localStorage.getItem(LS_LIST_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocalList(list) {
    localStorage.setItem(LS_LIST_KEY, JSON.stringify(list, null, 2));
    /* 登记待提交（面板会与仓库列表对比，无差异自动剔除） */
    pendingMark('data/posts-list.json', '文章列表（新增 / 删除）', '文章');
    commitLoaded = false;
  }

  /* 读取 localStorage 中的 JSON 覆盖；不存在返回 null，损坏也按不存在处理 */
  function readLocalJSON(key) {
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { return null; }
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /* 站点设置数据文件读取：
     始终优先读 localStorage 覆盖，没有再走 readRepoFile
     （GitHub API 最新 → 同源静态文件兜底） */
  function readDataFile(filename) {
    /* LS 键只取文件名（data/ 目录不进键名），与前台 loadDataFile 约定一致 */
    var base = filename === SITE_CONFIG_FILE ? filename : filename.split('/').pop();
    var key = filename === SITE_CONFIG_FILE
      ? LS_SITE_KEY
      : LS_APP_PREFIX + base.replace(/\.json$/, '');
    var local = readLocalJSON(key);
    if (local !== null) return Promise.resolve(local);
    return readRepoFile(filename).then(function (f) {
      if (!f) return null;
      return JSON.parse(f.text);
    });
  }

  /* ---------------- Toast 轻提示 ---------------- */
  var toastTimer = null;
  function toast(msg, isErr) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, INTERNAL.toastMs);
  }

  /* ============================================================
     GitHub API 封装
     ============================================================ */

  function repoParts() {
    var r = (config.repo || '').trim().split('/');
    return { owner: r[0], name: r[1] };
  }

  function gh(path, options) {
    options = options || {};
    var headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (pat) headers.Authorization = 'Bearer ' + pat;
    if (options.body) headers['Content-Type'] = 'application/json';

    return fetch(API + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = { message: text }; }
        if (!res.ok) {
          var msg = (data && (data.message || JSON.stringify(data))) || ('HTTP ' + res.status);
          var err = new Error('GitHub API 错误 ' + res.status + '：' + msg);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /* 读取仓库中的文本文件，返回 { text, sha }；文件不存在返回 null
     全站统一相对路径：同源 fetch，本地服务器读本地文件，线上自然读线上部署
     的仓库文件（dist 即仓库内容的构建产物），无需 GitHub API。
     sha 恒为 null（写入走 Git Trees API，不依赖读取时的 sha） */
  function readRepoFile(path) {
    return fetch(ROOT + path, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) return null;
      return res.text().then(function (t) { return { text: t, sha: null }; });
    }).catch(function () { return null; });
  }

  /* Git Trees API：多个文件一次 commit
     files: [{ path, content, encoding }]；deletes: [path, ...] */
  function commitFiles(files, deletes, message) {
    var rp = repoParts();
    var base = '/repos/' + rp.owner + '/' + rp.name;

    /* 1. 取分支最新提交 */
    return gh(base + '/git/ref/heads/' + encodeURIComponent(config.branch)).then(function (ref) {
      var parentSha = ref.object.sha;

      /* 2. 取父提交对应的 tree */
      return gh(base + '/git/commits/' + parentSha).then(function (parentCommit) {
        var baseTree = parentCommit.tree.sha;

        /* 3. 每个文件创建 blob（图片走 base64，文本走 utf-8） */
        var blobJobs = files.map(function (f) {
          return gh(base + '/git/blobs', {
            method: 'POST',
            body: { content: f.content, encoding: f.encoding || 'utf-8' }
          }).then(function (blob) {
            return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
          });
        });

        /* 删除项：sha 传 null */
        deletes.forEach(function (path) {
          blobJobs.push(Promise.resolve({
            path: path, mode: '100644', type: 'blob', sha: null
          }));
        });

        return Promise.all(blobJobs).then(function (tree) {
          /* 4. 基于旧 tree 创建新 tree */
          return gh(base + '/git/trees', {
            method: 'POST',
            body: { base_tree: baseTree, tree: tree }
          }).then(function (newTree) {
            /* 5. 创建提交并移动分支指针 */
            return gh(base + '/git/commits', {
              method: 'POST',
              body: { message: message, tree: newTree.sha, parents: [parentSha] }
            }).then(function (commit) {
              return gh(base + '/git/refs/heads/' + encodeURIComponent(config.branch), {
                method: 'PATCH',
                body: { sha: commit.sha }
              });
            });
          });
        });
      });
    });
  }

  /* ============================================================
     视图切换
     ============================================================ */

  var VIEW_TITLES = { posts: '文章管理', editor: '编辑文章', site: '站点设置',
    pages: '页面管理', 'page-editor': '编辑页面', apps: '应用管理',
    'video-tool': '视频压缩工具', commit: '提交管理' };

  function showView(name) {
    ['posts', 'editor', 'site', 'pages', 'page-editor', 'apps', 'video-tool', 'commit']
      .forEach(function (v) {
        $('view-' + v).classList.toggle('hidden', v !== name);
      });
    /* 页面编辑视图是页面管理的子视图，侧边栏高亮保持在「页面管理」 */
    var navView = name === 'page-editor' ? 'pages' : name;
    document.querySelectorAll('.nav-item').forEach(function (a) {
      a.classList.toggle('active', a.dataset.view === navView);
    });
    $('topbar-title').textContent = name === 'editor'
      ? (editingFile ? '编辑文章' : '新建文章')
      : VIEW_TITLES[name] || '';
    /* 首次进入数据视图时加载表单数据，之后保留用户未保存的编辑
       （保存成功后会互相置 false：站点设置/应用管理共用 site-config.json，
        页面管理/应用管理共用 data/pages.json，避免快照过期互相覆盖） */
    if (name === 'site' && !siteLoaded) loadSiteSettings();
    if (name === 'pages' && !pagesLoaded) loadPagesData();
    if (name === 'apps' && !appsLoaded) loadAppsData();
    if (name === 'commit' && !commitLoaded) loadCommitPanel();
    window.scrollTo(0, 0);
  }

  /* ============================================================
     文章列表
     ============================================================ */

  function loadPosts() {
    var tbody = $('posts-tbody');
    tbody.innerHTML = '<tr><td colspan="4" class="table-loading">加载中…</td></tr>';

    readRepoFile('data/posts-list.json').then(function (file) {
      var list = [];
      if (file) {
        try { list = JSON.parse(file.text); } catch (e) {
          throw new Error('data/posts-list.json 解析失败：' + e.message);
        }
      }
      repoPostsCache = list.slice();   /* 本地合并前的仓库基线 */
      /* 把浏览器里保存的本地文章并入列表。
         按 file 去重：正在本地编辑的线上文章由本地条目覆盖，
         避免同一篇文章出现两行（提交后本地条目清除即回落仓库版本）。
         与前台 common.js 的同名逻辑重复，但后台不加载 common.js，
         跨文件抽取反而够不到（曾因此回归，见 C5 教训） */
      var localMap = {};
      readLocalList().forEach(function (p) {
        p.local = true;
        localMap[p.file] = p;
      });
      list = list.filter(function (p) { return !localMap[p.file]; })
        .concat(Object.keys(localMap).map(function (f) { return localMap[f]; }));
      /* 已登记删除的线上文章立即从列表消失（提交前只存在于待提交区） */
      var pending = pendingStore();
      var deletedFiles = {};
      pending.deletes.forEach(function (d) {
        if (isPostHtmlPath(d.path)) deletedFiles[d.path.slice('posts/'.length)] = 1;
      });
      list = list.filter(function (p) { return !deletedFiles[p.file]; });
      postsCache = list.slice().sort(function (a, b) {
        return new Date(b.date) - new Date(a.date);
      });
      renderPostsTable();
    }).catch(function (err) {
      tbody.innerHTML = '<tr><td colspan="4" class="table-loading">加载失败：' +
        escapeHTML(err.message) + '<br>网络异常时可稍后重试，读取不影响已保存的本地文章</td></tr>';
    });
  }

  function renderPostsTable() {
    var tbody = $('posts-tbody');
    if (!postsCache.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="table-empty">还没有文章，点击右上角「新建文章」开始</td></tr>';
      return;
    }

    tbody.innerHTML = postsCache.map(function (p) {
      var cat = p.category ? '<span class="cat-badge">' + escapeHTML(p.category) + '</span>' : '—';
      var localBadge = p.local ? '<span class="cat-badge local-badge">本地</span>' : '';
      /* 所有文章均可编辑 / 删除：线上文章的改动会登记到「提交管理」 */
      var ops = '<button type="button" class="btn-link btn" data-edit="' + escapeHTML(p.file) + '">编辑</button>' +
          '<button type="button" class="btn-danger btn" data-del="' + escapeHTML(p.file) + '">删除</button>';
      return '<tr>' +
        '<td><strong>' + escapeHTML(p.title) + '</strong>' + localBadge + '</td>' +
        '<td>' + escapeHTML(p.date || '') + '</td>' +
        '<td>' + cat + '</td>' +
        '<td class="ops-cell">' + ops + '</td>' +
      '</tr>';
    }).join('');
  }

  /* ============================================================
     新建 / 编辑表单
     ============================================================ */

  function resetCoverState() {
    coverDataURL = null;
    coverRemote = '';
    $('cover-preview').innerHTML = '';
    $('f-cover-url').value = '';
  }

  function newPost() {
    editingFile = null;
    resetCoverState();
    $('f-title').value = '';
    $('f-slug').value = nowSlug();
    $('f-date').value = todayStr();
    $('f-category').value = '';
    $('f-summary').value = '';
    $('editor-body').innerHTML = '';
    exitPreview();
    showView('editor');
    setTimeout(function () { $('f-title').focus(); }, 50);
  }

  function editPost(file) {
    var item = postsCache.filter(function (p) { return p.file === file; })[0];

    /* 本地文章：内容直接来自 localStorage，不走 GitHub */
    if (item && item.local) { editLocalPost(file, item); return; }

    editingFile = file;
    resetCoverState();
    toast('正在加载文章…');

    readRepoFile('posts/' + file).then(function (f) {
      if (!f) {
        toast('文章文件不存在：posts/' + file, true);
        return;
      }

      var doc = new DOMParser().parseFromString(f.text, 'text/html');
      var meta = {};
      var metaEl = doc.querySelector('.post-data');
      if (metaEl) {
        try { meta = JSON.parse(metaEl.textContent); } catch (e) { meta = {}; }
      }
      var contentEl = doc.querySelector('.post-content');

      /* 表单只认文件内 post-data；列表项不再作为字段兜底（旧文章数据不齐
         就在编辑器里显空，保存时以填写值为准） */
      var item = postsCache.filter(function (p) { return p.file === file; })[0] || {};
      $('f-title').value = meta.title || '';
      $('f-slug').value = file.replace(/\.html$/, '');
      $('f-date').value = meta.date || '';
      $('f-category').value = meta.category || '';
      $('f-summary').value = item.summary || '';

      /* 封面：远程路径 */
      coverRemote = meta.cover || '';
      if (coverRemote) {
        $('cover-preview').innerHTML =
          '<img src="' + escapeHTML(ROOT + coverRemote.replace(/^\.\.\//, '')) + '" alt="封面">' +
          '<div class="cover-tip">当前封面，不更换则保持不变</div>';
      }

      $('editor-body').innerHTML = contentEl ? contentEl.innerHTML : '';
      exitPreview();
      showView('editor');
      toast('加载完成');
    }).catch(function (err) {
      toast('加载失败：' + err.message, true);
    });
  }

  /* 编辑本地文章：元数据取自 localStorage 列表项 */
  function editLocalPost(file, item) {
    editingFile = file;
    resetCoverState();

    var content = localStorage.getItem(LS_CONTENT_KEY + file);
    if (content === null) {
      toast('本地文章内容不存在', true);
      editingFile = null;
      return;
    }

    $('f-title').value = item.title || '';
    $('f-slug').value = file.replace(/\.html$/, '');
    $('f-date').value = item.date || todayStr();
    $('f-category').value = item.category || '';
    $('f-summary').value = item.summary || '';

    /* 封面可能是 dataURL（本地图片）或普通地址 */
    coverRemote = item.cover || '';
    if (coverRemote) {
      $('cover-preview').innerHTML =
        '<img src="' + escapeHTML(coverRemote) + '" alt="封面">' +
        '<div class="cover-tip">当前封面，不更换则保持不变</div>';
    }

    $('editor-body').innerHTML = content;
    exitPreview();
    showView('editor');
    toast('已加载本地文章');
  }

  function deletePost(file) {
    var item = postsCache.filter(function (p) { return p.file === file; })[0];

    /* 本地保存过的文章（含新文章与正在编辑的线上文章）：只清本地 */
    if (item && item.local) {
      if (!confirm('确定删除本地文章《' + (item.title || file) + '》吗？\n（仅从本浏览器删除，不影响 GitHub 仓库）')) return;
      /* 先判断线上是否存在同名文章：存在则删除后只是丢弃本地修改、
         文章回落到仓库版本；不存在（纯本地新文章）才是真正消失 */
      var existsOnline = repoPostsCache.some(function (p) { return p.file === file; });
      var rest = readLocalList().filter(function (p) { return p.file !== file; });
      try {
        localStorage.removeItem(LS_CONTENT_KEY + file);
        writeLocalList(rest);
        /* 撤销待提交登记：本地内容没了，提交行不应残留 */
        pendingForget('posts/' + file);
      } catch (e) {}
      loadPosts();
      toast(existsOnline
        ? '本地修改已丢弃，文章回落到线上版本；如要删除线上文章请再次点击删除'
        : '本地文章已删除');
      return;
    }

    /* 线上文章：不直接访问 GitHub，登记为「待提交删除」，
       勾选提交后才真正从仓库删除（列表记录也在提交时同步剔除） */
    if (!confirm('确定删除线上文章《' + (item ? item.title : file) + '》吗？\n（会登记到「提交管理」，勾选提交后才从 GitHub 删除，已上传的图片保留）')) return;
    pendingDelete('posts/' + file, item ? item.title : file, '文章');
    commitLoaded = false;
    loadPosts();
    toast('已登记删除，请到「提交管理」勾选提交');
  }

  /* ============================================================
     富文本工具栏（基于 contenteditable + execCommand）
     ============================================================ */

  /* [显示文字, title提示, 类型(cmd/block/action/sep), 命令值] */
  var TOOLBAR = [
    ['B', '加粗', 'cmd', 'bold'],
    ['I', '斜体', 'cmd', 'italic'],
    ['S', '删除线', 'cmd', 'strikeThrough'],
    ['', '', 'sep'],
    ['H2', '二级标题', 'block', 'h2'],
    ['H3', '三级标题', 'block', 'h3'],
    ['H4', '四级标题', 'block', 'h4'],
    ['P', '正文段落', 'block', 'p'],
    ['', '', 'sep'],
    ['• 列表', '无序列表', 'cmd', 'insertUnorderedList'],
    ['1. 列表', '有序列表', 'cmd', 'insertOrderedList'],
    ['', '', 'sep'],
    ['❝ 引用', '引用块', 'block', 'blockquote'],
    ['</> 代码块', '代码块', 'block', 'pre'],
    ['⌨ 行内代码', '行内代码', 'action', 'inlineCode'],
    ['', '', 'sep'],
    ['🔗 链接', '插入链接', 'action', 'link'],
    ['🖼 图片', '插入本地图片（保存时上传）', 'action', 'image'],
    ['— 分割线', '水平分割线', 'cmd', 'insertHorizontalRule'],
    ['', '', 'sep'],
    ['↶', '撤销', 'cmd', 'undo'],
    ['↷', '重做', 'cmd', 'redo'],
    ['✕ 清除格式', '清除格式', 'action', 'clear']
  ];

  /* 工具栏命令执行前调用：聚焦编辑器并保证里面有一个块级元素、
     且光标确实落在编辑器内。空 contenteditable / 焦点在按钮上时
     直接执行 execCommand 会静默失败。
     editor 参数化：文章编辑器与关于页编辑器共用同一套逻辑 */
  function focusEditorWithCaret(editor) {
    editor.focus();
    var sel = window.getSelection();

    /* 光标已在编辑器内：缺块就补一个 */
    if (sel.anchorNode && editor.contains(sel.anchorNode)) {
      if (!editor.querySelector('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div')) {
        document.execCommand('insertHTML', false, '<p><br></p>');
      }
      return;
    }

    /* 编辑器完全没有块级元素：直接放一个空段落 */
    if (!editor.querySelector('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div')) {
      editor.innerHTML = '<p><br></p>';
    }

    /* 把光标移到最后一个块的末尾 */
    var last = editor.lastElementChild || editor;
    var range = document.createRange();
    range.selectNodeContents(last);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* 初始化一个富文本编辑器实例：渲染工具栏 + 绑定全部编辑行为。
     文章编辑器与页面编辑中的每个 rich-content 板块实例共用本逻辑，
     只传元素不写死 ID，调用方负责保证元素是当前文档中存在的新节点 */
  function initRichEditor(bar, editor, fileInput) {
    bar.innerHTML = TOOLBAR.map(function (b, i) {
      if (b[2] === 'sep') return '<span class="tb-sep"></span>';
      return '<button type="button" class="tb-btn" data-i="' + i + '" title="' +
             escapeHTML(b[1]) + '">' + b[0] + '</button>';
    }).join('');

    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.tb-btn');
      if (!btn) return;
      var b = TOOLBAR[Number(btn.dataset.i)];
      focusEditorWithCaret(editor);
      if (b[2] === 'cmd') {
        document.execCommand(b[3], false, null);
      } else if (b[2] === 'block') {
        /* '<h2>' 这种写法 Chrome / Firefox 都兼容；裸 'H2' 在 Firefox 无效 */
        document.execCommand('formatBlock', false, '<' + b[3] + '>');
      } else {
        runAction(b[3], editor, fileInput);
      }
    });

    /* 让回车产生 <p>（Chrome 默认会产生 <div>）；该状态按文档生效，
       多个编辑器实例重复设置无副作用 */
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}

    /* 空编辑器首次聚焦时放入一个段落块并设置回车段落符，
       避免在空内容上执行 formatBlock（标题/引用/代码块）静默失败 */
    editor.addEventListener('focus', function () {
      try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
      if (!editor.textContent.trim() &&
          !editor.querySelector('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div')) {
        editor.innerHTML = '<p><br></p>';
        var p = editor.querySelector('p');
        var range = document.createRange();
        range.setStart(p, 0);
        range.collapse(true);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });

    /* 粘贴图片：拦截剪贴板中的图片项 */
    editor.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (/^image\//.test(items[i].type)) {
          e.preventDefault();
          insertImageFile(items[i].getAsFile(), editor);
          break;
        }
      }
    });

    /* 工具栏图片按钮选择文件 */
    fileInput.addEventListener('change', function () {
      if (this.files && this.files[0]) insertImageFile(this.files[0], editor);
      this.value = '';
    });
  }

  /* 自定义动作 */
  function runAction(name, editor, fileInput) {
    if (name === 'link') {
      var url = prompt('输入链接地址（含 http:// 或 https://）：', 'https://');
      if (url && url !== 'https://') {
        document.execCommand('createLink', false, url);
      }
      return;
    }

    if (name === 'image') {
      fileInput.click();
      return;
    }

    if (name === 'clear') {
      document.execCommand('removeFormat', false, null);
      document.execCommand('unlink', false, null);
      return;
    }

    if (name === 'inlineCode') {
      wrapInlineCode();
    }
  }

  /* 将选区文字包成 <code>，或在光标处插入占位 code */
  function wrapInlineCode() {
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var range = sel.getRangeAt(0);

    /* 已在 code 内则取消包裹 */
    var node = sel.anchorNode;
    var parentCode = node && node.nodeType === 1 ? node.closest('code')
      : (node && node.parentElement ? node.parentElement.closest('code') : null);
    if (parentCode) {
      var docFrag = document.createDocumentFragment();
      while (parentCode.firstChild) docFrag.appendChild(parentCode.firstChild);
      parentCode.parentNode.replaceChild(docFrag, parentCode);
      return;
    }

    var code = document.createElement('code');
    if (range.collapsed) {
      code.textContent = 'code';
      range.insertNode(code);
      range.setStartAfter(code);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      try {
        code.appendChild(range.extractContents());
        range.insertNode(code);
        sel.selectAllChildren(code);
        sel.collapseToEnd();
      } catch (e) {
        document.execCommand('insertHTML', false, '<code>code</code>');
      }
    }
  }

  /* ============================================================
     图片：粘贴 / 选择 —— 先本地 dataURL 预览，保存时才上传
     ============================================================ */

  /* 图片文件 → WebP dataURL（文章插图 / 封面 / 壁纸三处共用）：
     长边超过 maxSide 时等比缩小后 canvas 重编码为 WebP——同画质下体积
     通常比 PNG/JPEG 小 25~60%，现代浏览器全支持。文章图 maxSide=1024、
     壁纸 maxSide=2560，清晰度足够且控制仓库体积。
     GIF / SVG 原样直传：canvas 重编码会砍掉动画、丢失矢量特性 */
  function fileToWebpDataURL(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
          resolve(reader.result);
          return;
        }
        var im = new Image();
        im.onload = function () {
          var w = im.naturalWidth, h = im.naturalHeight;
          var scale = Math.min(1, maxSide / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * scale));
          c.height = Math.max(1, Math.round(h * scale));
          var g = c.getContext('2d');
          g.imageSmoothingEnabled = true;
          g.imageSmoothingQuality = 'high';
          g.drawImage(im, 0, 0, c.width, c.height);
          try { resolve(c.toDataURL('image/webp', quality)); } catch (e) { reject(e); }
        };
        im.onerror = function () { reject(new Error('decode fail')); };
        im.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('read fail')); };
      reader.readAsDataURL(file);
    });
  }

  function insertImageFile(file, editor) {
    if (!file || !/^image\//.test(file.type)) {
      toast('请选择图片文件', true);
      return;
    }
    /* 摄入时就压成 WebP（长边≤1024），落库的 dataURL 即最终格式，
       保存上传时按扩展名 .webp 直接出文件，无需二次转换 */
    fileToWebpDataURL(file, 1024, 0.85).then(function (dataURL) {
      editor.focus();
      var img = '<img src="' + dataURL + '" alt="">';
      document.execCommand('insertHTML', false, img);
    }).catch(function () {
      toast('图片读取失败，请换一张试试', true);
    });
  }

  /* 封面选择：仅暂存 + 预览，保存时上传（编辑器行为已移入 initRichEditor） */
  function bindCoverInputs() {
    $('btn-cover-upload').addEventListener('click', function () {
      $('cover-file').click();
    });

    $('cover-file').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        toast('请选择图片文件', true);
        return;
      }
      /* 与正文插图同一管线：摄入即 WebP（长边≤1024），保存时直接出 .webp 文件 */
      fileToWebpDataURL(file, 1024, 0.85).then(function (dataURL) {
        coverDataURL = dataURL;
        coverRemote = '';
        $('f-cover-url').value = '';
        $('cover-preview').innerHTML =
          '<img src="' + coverDataURL + '" alt="封面预览">' +
          '<div class="cover-tip">已选择本地封面，保存文章时自动上传</div>';
      }).catch(function () {
        toast('图片读取失败，请换一张试试', true);
      });
      this.value = '';
    });
  }

  /* ============================================================
     预览：iframe 引入与文章页完全相同的 CSS
     ============================================================ */

  function togglePreview() {
    if (isPreview) {
      exitPreview();
    } else {
      enterPreview();
    }
  }

  function enterPreview() {
    var html = $('editor-body').innerHTML;
    var iframe = $('editor-preview');
    /* srcdoc 中的相对路径相对于父页面（/admin/）解析，../assets 正确 */
    iframe.srcdoc =
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
      '<link rel="stylesheet" href="../assets/css/common.css">' +
      '<link rel="stylesheet" href="../assets/css/post.css">' +
      '<style>body{padding:26px 20px;}.post-content{max-width:740px;margin:0 auto;}' +
      'pre{white-space:pre-wrap;word-break:break-word;}</style></head>' +
      '<body><article class="post-content">' + html + '</article></body></html>';
    iframe.classList.add('show');
    $('editor-body').classList.add('hidden');
    $('btn-preview').textContent = '✎ 编辑';
    isPreview = true;
  }

  function exitPreview() {
    $('editor-preview').classList.remove('show');
    $('editor-body').classList.remove('hidden');
    $('btn-preview').textContent = '👁 预览';
    isPreview = false;
  }

  /* ============================================================
     本地保存
     ============================================================ */

  function savePost() {
    /* 1. 校验表单 */
    var title = $('f-title').value.trim();
    var slug = $('f-slug').value.trim().toLowerCase();
    var date = $('f-date').value || todayStr();
    var category = $('f-category').value.trim();
    var summary = $('f-summary').value.trim();
    var coverUrlInput = $('f-cover-url').value.trim();

    if (!title) { toast('请填写文章标题', true); $('f-title').focus(); return; }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      toast('slug 只能包含英文小写字母、数字和短横线', true);
      $('f-slug').focus();
      return;
    }
    if (!summary) { toast('请填写摘要', true); $('f-summary').focus(); return; }

    var file = slug + '.html';

    /* 新建时禁止与已有文件重名（postsCache 已包含仓库 + 本地文章） */
    if (!editingFile && postsCache.some(function (p) { return p.file === file; })) {
      toast('slug 已存在，请换一个（或在列表中编辑原文章）', true);
      $('f-slug').focus();
      return;
    }

    /* 统一写入浏览器 localStorage，不直接访问 GitHub */
    saveLocalPost({
      title: title, slug: slug, date: date, category: category,
      summary: summary, coverUrl: coverUrlInput, file: file
    });
  }

  /* 本地保存：文章与封面全部写入浏览器 localStorage，不直接写 GitHub。
     图片不做上传，dataURL 直接内嵌在内容里（受 localStorage 约 5MB 限制） */
  function saveLocalPost(v) {
    var btn = $('btn-save');
    btn.disabled = true;
    btn.textContent = '保存中…';

    var editor = $('editor-body');
    var content = editor.innerHTML;

    /* 封面优先级：新选本地图 > 已有封面 > 手填 URL */
    var cover = coverDataURL || coverRemote || v.coverUrl || '';

    var entry = {
      title: v.title,
      date: v.date,
      updated: editingFile ? todayStr() : v.date,
      file: v.file,
      summary: v.summary,
      category: v.category,
      cover: cover,
      local: true
    };

    var list = readLocalList().filter(function (p) { return p.file !== v.file; });
    if (editingFile && editingFile !== v.file) {
      /* slug 改名：移除旧记录与旧内容 */
      list = list.filter(function (p) { return p.file !== editingFile; });
      localStorage.removeItem(LS_CONTENT_KEY + editingFile);
    }
    list.push(entry);

    try {
      /* 先写内容再写列表：万一空间不足，最多留下一段孤儿内容，不会出现指向空内容的记录 */
      localStorage.setItem(LS_CONTENT_KEY + v.file, content);
      writeLocalList(list);
      /* 登记待提交：文章 HTML 在提交时由 renderPostHtml 现拼（图片抽出为独立文件） */
      pendingMark('posts/' + v.file, v.title, '文章');
      if (editingFile && editingFile !== v.file) {
        pendingForget('posts/' + editingFile);
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = SAVE_TEXT;
      toast('保存失败：浏览器 localStorage 空间不足（约 5MB），请压缩或减少图片', true);
      return;
    }

    editingFile = v.file;
    coverDataURL = null;
    coverRemote = cover;

    /* 重新合并线上 + 本地列表并刷新表格 */
    loadPosts();

    if (cover) {
      $('cover-preview').innerHTML =
        '<img src="' + escapeHTML(cover) + '" alt="封面">' +
        '<div class="cover-tip">当前封面，不更换则保持不变</div>';
    }
    btn.disabled = false;
    btn.textContent = SAVE_TEXT;
    toast('已保存到本浏览器，可在前台直接预览');
  }

  /* 文章 HTML 模板（与 posts/welcome.html 结构保持一致） */
  function renderPostHtml(meta, content) {
    var data = JSON.stringify({
      title: meta.title,
      date: meta.date,
      updated: meta.updated,
      category: meta.category,
      cover: meta.cover
    }).replace(/</g, '\\u003c');   /* 防止 </script> 注入打断元数据节点 */

    return '<!DOCTYPE html>\n' +
'<html lang="zh-CN">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'  <title>' + escapeHTML(meta.title) + ' - ' + escapeHTML(config.siteName) + '</title>\n' +
'  <meta name="description" content="' + escapeHTML(meta.title) + '">\n' +
'  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">\n' +
'  <!-- 文章元数据，请勿手工修改此 script -->\n' +
'  <script type="application/json" class="post-data">\n' +
'  ' + data + '\n' +
'  <\/script>\n' +
'  <link rel="stylesheet" href="../assets/css/common.css">\n' +
'  <link rel="stylesheet" href="../assets/css/post.css">\n' +
'</head>\n' +
'<body>\n' +
'  <header id="site-header"></header>\n\n' +
'  <div class="post-layout">\n' +
'    <main class="post-container">\n' +
'      <h1 class="post-title">' + escapeHTML(meta.title) + '</h1>\n' +
'      <div class="post-meta" id="post-meta"></div>\n\n' +
'      <article class="post-content">' + content + '</article>\n' +
'    </main>\n\n' +
'    <aside class="post-toc" id="post-toc"></aside>\n' +
'  </div>\n\n' +
'  <footer id="site-footer"></footer>\n\n' +
'  <script src="../assets/js/common.js"></script>\n' +
'  <script src="../assets/js/post.js"></script>\n' +
'  <script src="../assets/js/context-menu.js"></script>\n' +
'</body>\n' +
'</html>\n';
  }

  /* ============================================================
     站点设置（表单 UI）
     只管理 site-config.json；首页应用的参数与数据在「应用管理」。
     保存只写入 localStorage 覆盖键并登记待提交，前台读取时优先使用；
     统一到「提交管理」里向 GitHub 提交
     ============================================================ */
  var siteLoaded = false;
  var siteData = null;   /* 最近一次加载的快照（保存成功后同步），用于差异比较 */

  /* 页面管理（data/pages.json）状态：完全复用站点设置的「快照 + 差异保存」模式。
     本地覆盖键自动遵循 readDataFile 的推导规则 → ssb.local.app.pages。
     pagesData 是文件快照（保存时深拷贝以保留 _comment 等表外字段）；
     pagesWork 是页面卡片的工作副本（结构性操作先从 DOM 同步文本，再改这里后重渲染） */
  var pagesLoaded = false;
  var pagesData = null;
  var pagesWork = null;
  /* v4：editIndex 为正在编辑的页下标（-1 = 列表视图）；
     bgVariantMap 缓存各背景应用的变体清单（如壁纸/视频），供屏背景下拉使用 */
  var editIndex = -1;
  var bgVariantMap = {};
  /* v3.1 响应式模板库（data/pages.json 顶层 responsive）：respWork 为工作副本随页面一起保存；
     respEdit = null | {mode:'new'|'edit', idx} 表示模板编辑器展开中 */
  var respWork = null;
  var respEdit = null;

  /* 应用管理状态：appsLoaded 控制首次进入视图时加载（快照 appsData 的
     声明与加载逻辑在文末「应用管理 v3.5」大段）。
     与「页面管理」共用 data/pages.json，任一视图保存成功后都会把对方
     loaded 置 false 强制重载，防止快照互相覆盖 */
  var appsLoaded = false;

  function showSiteMsg(text, isErr) {
    var el = $('site-msg');
    el.className = 'form-msg ' + (isErr ? 'err' : 'ok');
    el.textContent = text || '';
  }

  /* ---------- 重复行 / 分组的 HTML 构造 ---------- */

  /* 行首图标格初始 HTML（数据 tab 用）：
     已有 __icon（本浏览器匹配/上传后）→ 直接显示 dataURL；
     否则按 hostname 乐观显示仓库图标（../assets/icons/sites/<host>.webp，
     加载失败由捕获阶段 error 委托换成首字母）；连 host 都没有显示「？」 */
  function riBoxHTML(item) {
    item = item || {};
    var letter = escapeHTML((item.name || '?').slice(0, 1));
    if (item.__icon) {
      return '<span class="ri-box" data-state="icon">' +
        '<img class="ri-img" src="' + escapeHTML(item.__icon) + '" alt=""></span>';
    }
    var host = itemHost(item);
    if (host) {
      return '<span class="ri-box" data-state="repo">' +
        '<img class="ri-img" src="' + ROOT + 'assets/icons/sites/' + host + '.webp" alt="">' +
        '<span class="ri-letter" style="display:none">' + letter + '</span>' +
      '</span>';
    }
    return '<span class="ri-box" data-state="empty"><span class="ri-letter">?</span></span>';
  }

  /* 带站点图标的结构化行（搜索引擎 + 导航链接共用）：图标格 + 名称 + URL +
     重试/上传/删除，仅占位符随场景不同 */
  function iconSiteRowHTML(item, namePh, urlPh) {
    item = item || {};
    return '<div class="repeat-row">' +
      riBoxHTML(item) +
      '<input class="r-name" placeholder="' + namePh + '" value="' + escapeHTML(item.name) + '">' +
      '<input class="r-url" placeholder="' + urlPh + '" value="' + escapeHTML(item.url) + '">' +
      '<button type="button" class="btn btn-link icon-retry" title="网站更新图标后，强制重新抓取并替换；抓取失败保留原图">重试</button>' +
      '<button type="button" class="btn btn-link icon-upload" title="自动匹配不到时可上传本地图标，会自动压成 32×32 WebP">上传</button>' +
      '<button type="button" class="btn btn-danger row-del">删除</button>' +
    '</div>';
  }

  function engineRowHTML(e) {
    return iconSiteRowHTML(e, '名称，如：百度', '搜索 URL 前缀，如 https://www.baidu.com/s?wd=');
  }

  function socialRowHTML(s) {
    s = s || {};
    return '<div class="repeat-row">' +
      '<input class="r-name" placeholder="名称，如：GitHub" value="' + escapeHTML(s.name) + '">' +
      '<select class="r-icon">' +
        '<option value="github"' + (s.icon === 'github' ? ' selected' : '') + '>GitHub 图标</option>' +
        '<option value="mail"' + (s.icon === 'mail' ? ' selected' : '') + '>邮箱图标</option>' +
      '</select>' +
      '<input class="r-url" placeholder="链接，如 https://github.com/your-name 或 mailto:you@x.com" value="' + escapeHTML(s.url) + '">' +
      '<button type="button" class="btn btn-danger row-del">删除</button>' +
    '</div>';
  }

  function navLinkRowHTML(l) {
    return iconSiteRowHTML(l, '网站名称', '网址，如 https://www.baidu.com/');
  }

  function navGroupHTML(g) {
    g = g || { links: [] };
    return '<div class="nav-group">' +
      '<div class="nav-group-head">' +
        '<input class="g-name" placeholder="分类名称，如：设计工具" value="' + escapeHTML(g.category) + '">' +
        '<button type="button" class="btn btn-danger group-del">删除分类</button>' +
      '</div>' +
      '<div class="nav-link-rows">' +
        (g.links || []).map(navLinkRowHTML).join('') +
      '</div>' +
      '<button type="button" class="btn btn-link link-add">＋ 添加链接</button>' +
    '</div>';
  }

  /* ---------- 表单骨架（静态字段；动态列表由 fillSiteForm 填充） ---------- */
  function siteFormHTML() {
    return '' +
    '<section class="site-section">' +
      '<h2>站点信息</h2>' +
      '<div class="form-grid form-grid-2">' +
        '<label class="form-field"><span>站点名称</span>' +
          '<input type="text" id="st-siteName" autocomplete="off"></label>' +
        '<label class="form-field"><span>站点起始日期（页脚版权/运行天数用）</span>' +
          '<input type="date" id="st-startDate" autocomplete="off"></label>' +
        '<label class="form-field"><span>作者名</span>' +
          '<input type="text" id="st-author" autocomplete="off"></label>' +
        '<label class="form-field"><span>Logo 图片地址（留空显示纯文字站名）</span>' +
          '<input type="text" id="st-logo" placeholder="assets/images/logo.png" autocomplete="off"></label>' +
        '<label class="form-field"><span>作者头像地址（可选）</span>' +
          '<input type="text" id="st-avatar" placeholder="assets/images/avatar.png" autocomplete="off"></label>' +
      '</div>' +
    '</section>' +

    '<section class="site-section">' +
      '<h2>主题外观</h2>' +
      '<div class="form-grid form-grid-2">' +
        '<label class="form-field"><span>主题色</span>' +
          '<div class="color-row">' +
            '<input type="color" id="st-primary-color" class="color-input" title="点此选色">' +
            '<input type="text" id="st-primary" placeholder="#1d6ff2" autocomplete="off">' +
          '</div></label>' +
        '<label class="form-field"><span>默认外观（访客在「自动跟随系统 / 亮色 / 暗色」间自行选择并记住）</span>' +
          '<select id="st-dark">' +
            '<option value="auto">跟随系统外观</option>' +
            '<option value="light">默认亮色</option>' +
            '<option value="dark">默认暗色</option>' +
          '</select></label>' +
      '</div>' +
    '</section>' +

    '<section class="site-section">' +
      '<h2>背景设置</h2>' +
      '<p class="section-hint">粒子动画、图片壁纸、动态壁纸都已改为「背景类应用」：' +
      '到「应用管理」编辑——粒子参数在 particles 的「参数」页；壁纸在 wallpapers 的「数据」页上传；' +
      '视频在 videos 的「数据」页登记。各屏使用哪种背景，在「页面管理」对应屏的「背景类型」中选择。</p>' +
    '</section>' +

    '<section class="site-section">' +
      '<h2>页脚社交链接</h2>' +
      '<p class="section-hint">显示在页脚收藏横条右侧。icon=mail 时 url 直接填你的邮箱地址（mailto: 前缀可省略），访客点击会弹窗展示地址供复制；icon=github 时为普通外链。</p>' +
      '<div id="st-social"></div>' +
      '<button type="button" class="btn" id="st-social-add">＋ 添加社交链接</button>' +
    '</section>' +

    '<p class="section-hint" style="margin-top:14px">首页应用（公告 / 名言 / 搜索引擎 / 网址导航）的数据与配置已移至「应用管理」；页面结构与模块挂载在「页面管理」中维护。</p>';
  }

  /* ---------- 加载并填充 ---------- */
  function loadSiteSettings() {
    $('site-card').innerHTML = '<div class="site-loading">加载中…</div>';
    showSiteMsg('');

    /* 站点设置瘦身后只管 site-config.json；
       引擎/名言/导航数据由「应用管理」负责 */
    readDataFile(SITE_CONFIG_FILE).then(function (cfg) {
      siteData = { config: cfg || {} };
      siteLoaded = true;
      fillSiteForm(siteData);
      bindSiteSettingsEvents();
    }).catch(function (err) {
      $('site-card').innerHTML = '<div class="site-loading">加载失败：' +
        escapeHTML(err.message) + '</div>';
    });
  }

  function fillSiteForm(data) {
    var c = data.config || {};

    $('site-card').innerHTML = siteFormHTML();

    $('st-siteName').value = c.siteName || '';
    $('st-startDate').value = c.startDate || '';
    $('st-author').value = c.author || '';
    $('st-logo').value = c.logo || '';
    $('st-avatar').value = c.avatar || '';

    var primary = (c.theme && c.theme.primary) || '';
    $('st-primary').value = primary;
    /* 颜色选择器只接受合法 #rrggbb，非法时给个默认色但保留文本框原值 */
    $('st-primary-color').value = /^#[0-9a-fA-F]{6}$/.test(primary) ? primary : '#1d6ff2';
    $('st-dark').value = (c.theme && /^(auto|light|dark)$/.test(c.theme.dark)) ? c.theme.dark : 'auto';

    $('st-social').innerHTML = (c.social || []).map(socialRowHTML).join('') || socialRowHTML();
  }

  /* ---------- 事件绑定（只绑一次；容器 innerHTML 重建后靠委托生效） ---------- */
  function bindSiteSettingsEvents() {
    if (window.__siteEventsBound) return;
    window.__siteEventsBound = true;

    $('btn-site-save').addEventListener('click', saveSiteSettings);
    $('btn-site-reload').addEventListener('click', function () {
      if (confirm('重新加载将丢弃当前页未保存的修改，确定吗？')) {
        siteLoaded = false;
        loadSiteSettings();
      }
    });
    $('btn-site-reset').addEventListener('click', function () {
      if (!confirm('确定删除本浏览器里保存的站点设置覆盖，恢复为仓库文件中的默认配置吗？')) return;
      try { localStorage.removeItem(LS_SITE_KEY); } catch (e) {}
      location.reload();
    });

    /* 列表的增删统一用事件委托：fillSiteForm 重建 innerHTML 后无需重绑
       （站点设置瘦身后只剩社交链接一种行编辑器） */
    $('site-card').addEventListener('click', function (e) {
      var rowDel = e.target.closest('.row-del');
      if (rowDel) { rowDel.closest('.repeat-row').remove(); return; }

      if (e.target.closest('#st-social-add')) {
        $('st-social').insertAdjacentHTML('beforeend', socialRowHTML());
      }
    });

    /* 主题色：取色器 ↔ 文本框双向同步 */
    document.addEventListener('input', function (e) {
      if (e.target.id === 'st-primary-color') $('st-primary').value = e.target.value;
      if (e.target.id === 'st-primary' && /^#[0-9a-fA-F]{6}$/.test(e.target.value.trim())) {
        $('st-primary-color').value = e.target.value.trim();
      }
    });
  }

  /* ---------- 收集 + 校验 ---------- */

  /* 读取 name/url 行；整行空跳过，只填一半返回错误提示。
     attachRow(item, rowEl)：engines/nav 传入，把行内图标实时状态带进数据 */
  function collectPairs(container, where, attachRow) {
    var rows = [];
    var bad = null;
    container.querySelectorAll('.repeat-row').forEach(function (row) {
      var name = (row.querySelector('.r-name') || {}).value || '';
      var url = (row.querySelector('.r-url') || {}).value || '';
      name = name.trim(); url = url.trim();
      if (!name && !url) return;
      if (!name || !url) { bad = where + '存在只填了一半的条目，请补全或删除该行'; return; }
      /* 键序与 site-config.json 文档保持 {name, icon, url}：
         保存时的差异比较基于 JSON.stringify，键序不同会误判为改动 */
      var iconSel = row.querySelector('.r-icon');
      var item = iconSel ? { name: name, icon: iconSel.value, url: url } : { name: name, url: url };
      if (attachRow) attachRow(item, row);
      rows.push(item);
    });
    return { rows: rows, bad: bad };
  }

  function collectSiteData() {
    var c = JSON.parse(JSON.stringify(siteData.config || {}));  /* 深拷贝，保留 repo/_comment 等表外字段 */

    var siteName = $('st-siteName').value.trim();
    if (!siteName) return { error: '请填写站点名称' };
    c.siteName = siteName;
    c.startDate = $('st-startDate').value || '';
    c.author = $('st-author').value.trim();
    c.logo = $('st-logo').value.trim();
    c.avatar = $('st-avatar').value.trim();

    var primary = $('st-primary').value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(primary)) return { error: '主题色必须是 #rrggbb 形式的十六进制颜色' };
    c.theme = { primary: primary, dark: $('st-dark').value };

    /* 站点设置瘦身后：背景（粒子/壁纸/视频）归「背景类应用」管辖，
       heroNotice/quoteSpeed/navPanel 等归对应应用；这里只覆盖表单管辖字段，其余原样保留 */
    var social = collectPairs($('st-social'), '社交链接');
    if (social.bad) return { error: social.bad };
    c.social = social.rows;

    return { config: c };
  }

  /* ---------- 保存 ---------- */
  function saveSiteSettings() {
    var data = collectSiteData();
    if (data.error) { showSiteMsg(data.error, true); return; }

    /* 差异比较：没有改动直接返回 */
    if (JSON.stringify(data.config) === JSON.stringify(siteData.config || {})) {
      showSiteMsg('没有检测到改动', false);
      return;
    }

    var btn = $('btn-site-save');
    btn.disabled = true;
    btn.textContent = '保存中…';
    showSiteMsg('');

    try {
      localStorage.setItem(LS_SITE_KEY, JSON.stringify(data.config, null, 2));
      pendingMark(SITE_CONFIG_FILE, '站点配置', '站点配置');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '保存设置';
      showSiteMsg('保存失败：浏览器 localStorage 空间不足', true);
      return;
    }
    commitLoaded = false;
    config = data.config;    /* 同步后台内存配置（保存文章时站点名等要用最新值） */
    $('admin-brand').textContent = config.siteName ? config.siteName + ' · 管理' : '管理后台';
    siteData = { config: data.config };
    btn.disabled = false;
    btn.textContent = '保存设置';
    showSiteMsg('已保存到本浏览器，刷新前台即可看到效果', false);
    toast('站点设置已保存');
  }

  /* ============================================================
     页面管理 v3：页面列表 + 单页编辑（屏 screen → 盒子 box → 板块实例 app）
     页面 = 容器（模板/标题/挂载应用），应用 = 积木（数据与配置在
     「应用管理」中维护）。数据结构见 apps.js 顶部心智模型；加载时
     统一过 window.SSBApps.normalizeV3 清洗，后台不重复实现。
     加载/保存模式与站点设置一致：本地写 localStorage 覆盖键，
     线上走 Git Trees 提交（data/pages.json + 新建页面的静态 HTML）
     ============================================================ */

  /* 板块元数据 v3.5：不再硬编码，改由「应用清单 + 应用代码 define」
     动态探测得到（adminRegistry，加载逻辑见文末「应用管理」大段）。
     init 拿到站点配置后预载，应用列表与页面管理的「添加板块」下拉共用。
     hero 类在新建实例时默认居中对齐；同类板块可重复挂载，靠 uid 区分 */

  /* 落地页唯一且锁定：template=landing 的页面不可删除，slug/模板锁定，
     file 固定 index.html；其余页面全部是可改可删的动态页，
     统一由 page.html?slug=<id> 渲染 */
  function isBuiltinPage(p) {
    return p.template === 'landing';
  }

  function appLabel(id) {
    var d = adminRegistry[id];
    return d ? d.name : id;
  }

  function isHeroApp(id) {
    return !!(adminRegistry[id] && adminRegistry[id].hero);
  }

  /* 板块实例 uid 生成器（同一页面内不允许重复，复制页面时全部重发） */
  var peUidSeq = 0;
  function genUID() {
    peUidSeq += 1;
    return 'u' + Date.now().toString(36) + peUidSeq;
  }

  /* 盒子宽度只接受 px / %（前台用 min(宽度,100%) 兜底防溢出，见 common.css） */
  var BOX_WIDTH_RE = /^\d+(\.\d+)?(px|%)$/;

  function showPagesMsg(text, isErr) {
    /* 列表视图与编辑视图各有一个消息条，同时写保证两个入口的保存都有反馈 */
    ['pages-msg', 'pe-msg'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.className = 'form-msg ' + (isErr ? 'err' : 'ok');
      el.textContent = text || '';
    });
  }

  /* 页面文件统一过 apps.js normalizeV3 清洗（v3 结构）。
     已不再兼容 v1/v2 旧数据：无 pages 时 normalizeV3 返回内置兜底 */
  function normalizePagesFile(data) {
    return window.SSBApps.normalizeV3(data);
  }

  /* 把富文本 HTML 过一遍浏览器序列化，使工作副本与 contenteditable 的
     innerHTML 形态一致，避免「没改动却提示有改动」 */
  var __htmlNorm = document.createElement('div');
  function normalizeHTML(html) {
    __htmlNorm.innerHTML = String(html == null ? '' : html);
    return __htmlNorm.innerHTML;
  }

  function forEachInst(pages, fn) {
    pages.forEach(function (p) {
      (p.screens || []).forEach(function (sc) {
        (sc.boxes || []).forEach(function (box) {
          (box.apps || []).forEach(function (inst) { fn(inst, p, sc, box); });
        });
      });
    });
  }

  function normalizeRichInPages(pages) {
    forEachInst(pages, function (inst) {
      if (inst.id === 'rich-content' && inst.cfg) {
        inst.cfg.html = normalizeHTML(inst.cfg.html || '');
      }
    });
  }

  /* 空屏 / 空盒：新增时按模板给默认垂直布局与默认宽度（对齐 apps.js） */
  function emptyBox(tpl) {
    var w = tpl === 'landing' ? '1000px' : (tpl === 'content' ? '740px' : '760px');
    return { width: w, hAlign: 'center', apps: [] };
  }

  function emptyScreen(tpl) {
    /* 无背景的屏不带 bg 字段（与 apps.js 新约定一致） */
    return { vAlign: tpl === 'landing' ? 'center' : 'start',
             boxes: [emptyBox(tpl)] };
  }

  /* 新建页面的默认结构：复刻内置三页的首装体验，用户可再自由增删 */
  function defaultScreens(tpl) {
    function inst(id, extra) {
      var o = { uid: genUID(), id: id, enable: true, align: isHeroApp(id) ? 'center' : 'left' };
      if (extra) o.cfg = extra;
      return o;
    }
    if (tpl === 'landing') {
      return [
        { bg: { app: 'particles' }, vAlign: 'center', boxes: [
          { width: '1000px', hAlign: 'center', apps: [
            inst('quote'), inst('search'), inst('nav')] }
        ] },
        { vAlign: 'start', boxes: [
          { width: '760px', hAlign: 'center', apps: [
            inst('posts', { title: '最新文章' })] }
        ] }
      ];
    }
    if (tpl === 'content') {
      return [{ vAlign: 'start', boxes: [
        { width: '740px', hAlign: 'center', apps: [inst('rich-content', { html: '' })] }] }];
    }
    return [{ vAlign: 'start', boxes: [
      { width: '760px', hAlign: 'center', apps: [inst('archive-list')] }] }];
  }

  function regenerateUIDs(page) {
    forEachInst([page], function (inst) { inst.uid = genUID(); });
  }

  /* ---------- 页面列表（摘要行：详细结构在编辑页中维护） ---------- */

  function tplOptions(selected, builtin) {
    /* 落地页全站唯一：只有在编辑落地页本身时可选（其整个 select 其实已禁用）；
       编辑其他页面时 landing 选项禁用，防止保存时出现第二个落地页 */
    var list = [
      { v: 'landing', t: '落地页 landing（唯一，不可再选）', lock: !builtin },
      { v: 'list',    t: '列表页 list', lock: false },
      { v: 'content', t: '内容页 content', lock: false }
    ];
    return list.map(function (o) {
      return '<option value="' + o.v + '"' +
        (o.v === selected ? ' selected' : '') + (o.lock ? ' disabled' : '') + '>' +
        o.t + '</option>';
    }).join('');
  }

  function countPageApps(p) {
    var n = 0;
    (p.screens || []).forEach(function (sc) {
      (sc.boxes || []).forEach(function (box) {
        n += (box.apps || []).length;
      });
    });
    return n;
  }

  function pageRowHTML(p, idx) {
    var builtin = isBuiltinPage(p);
    var badges =
      '<span class="pl-badge pl-tpl">' + p.template + '</span>' +
      (builtin ? '<span class="pl-badge pl-builtin">落地页</span>'
               : '<span class="pl-badge pl-dyn">动态页</span>');
    /* 落地页锚定首位：自身不可下移；其他页面也不能上移越过它（idx=1 的上移禁用） */
    var upDisabled = idx <= 1;
    var downDisabled = builtin || idx === pagesWork.length - 1;
    return '<div class="card pl-row" data-idx="' + idx + '">' +
      '<span class="pl-grip" title="页面顺序即顶部导航顺序">≡</span>' +
      '<div class="pl-main">' +
        '<b>' + escapeHTML(p.title) + '</b>' +
        '<span class="pl-sum">' + (p.screens || []).length + ' 屏 · ' +
          countPageApps(p) + ' 个板块</span>' +
      '</div>' +
      '<span class="pl-badges">' + badges + '</span>' +
      '<span class="pl-acts">' +
        '<button type="button" class="btn btn-primary pl-act" data-pl-edit>编辑</button>' +
        (builtin ? '' :
          '<button type="button" class="btn pl-act" data-pl-copy title="复制页面">复制</button>') +
        '<button type="button" class="btn pl-act" data-pl-up title="上移（导航顺序）" ' +
          (upDisabled ? 'disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn pl-act" data-pl-down title="下移（导航顺序）" ' +
          (downDisabled ? 'disabled' : '') + '>↓</button>' +
        (builtin ? '' :
          '<button type="button" class="btn btn-danger pl-act" data-pl-del>删除</button>') +
      '</span>' +
    '</div>';
  }

  function renderPagesList() {
    var box = $('pages-list');
    if (!pagesWork || !pagesWork.length) {
      box.innerHTML = '<div class="card site-card"><div class="site-loading">暂无页面，点击右上角「新建页面」</div></div>';
      return;
    }
    box.innerHTML = pagesWork.map(pageRowHTML).join('');
  }

  /* ============================================================
     响应式模板库（v3.1）：模板 CRUD + 规则行编辑器 + 三级挂载控件。
     清洗逻辑复用 apps.js 的 SSBApps.sanitizeRule（admin/index.html 已引入）
     ============================================================ */
  var RESP_LEVEL_NAMES = { screen: '屏级', box: '盒级', app: '应用级' };
  /* 盒子水平位置：比板块对齐多一个「跟随屏」（auto = 跟随屏的九宫格水平位） */
  var BOX_HALIGN_PAIRS = [['auto', '跟随屏'], ['left', '靠左'], ['center', '居中'], ['right', '靠右']];
  var G9_VALS = ['start', 'center', 'end'];
  var G9_NAMES = { start: '靠上', center: '居中', end: '靠下' };
  /* 九宫格水平位取值与屏 hAlign 同域（start/center/end），区别于板块的 left/right */
  var G9_H_PAIRS = [['start', '靠左'], ['center', '居中'], ['end', '靠右']];

  function respTplList() { return (respWork && respWork.templates) || []; }
  function respTplOptions(level, selected) {
    var opts = '<option value="">无</option>';
    respTplList().forEach(function (t) {
      if (t.appliesTo !== level) return;
      opts += '<option value="tpl:' + escapeHTML(t.id) + '"' +
        (selected === 'tpl:' + t.id ? ' selected' : '') + '>' + escapeHTML(t.name) + '</option>';
    });
    opts += '<option value="custom"' + (selected === 'custom' || (selected && typeof selected === 'object') ? ' selected' : '') +
      '>自定义规则…</option>';
    return opts;
  }

  /* 单档规则行：max + 按层级展开的属性输入。空值 = 该档不改此属性 */
  function respRuleRowHTML(level, r) {
    r = r || {};
    var v = function (x) { return x == null ? '' : escapeHTML(String(x)); };
    var f = '<label class="pe-rr"><span>宽度 ≤</span>' +
      '<input type="number" class="pe-r-max" min="1" step="1" value="' + v(r.max) + '" placeholder="720">' +
      '<em>px</em></label>';
    if (level === 'screen') {
      f += '<label class="pe-rr"><span>上下边距</span>' +
        '<input type="number" class="pe-r-num" data-k="padV" min="0" step="1" value="' + v(r.padV) + '"></label>' +
        '<label class="pe-rr"><span>左右边距</span>' +
        '<input type="number" class="pe-r-num" data-k="padH" min="0" step="1" value="' + v(r.padH) + '"></label>' +
        '<label class="pe-rr"><span>盒间距</span>' +
        '<input type="number" class="pe-r-num" data-k="gap" min="0" step="1" value="' + v(r.gap) + '"></label>' +
        '<label class="pe-rr"><span>垂直</span><select class="pe-r-sel" data-k="vAlign">' +
        '<option value="">不变</option>' + selOptions(VALIGN_PAIRS, r.vAlign || '') + '</select></label>' +
        '<label class="pe-rr"><span>水平</span><select class="pe-r-sel" data-k="hAlign">' +
        '<option value="">不变</option>' + selOptions(G9_H_PAIRS, r.hAlign || '') + '</select></label>';
    } else if (level === 'box') {
      f += '<label class="pe-rr"><span>宽度改为</span>' +
        '<input type="text" class="pe-r-width" data-k="width" value="' + v(r.width) + '" placeholder="100% / 92%" maxlength="12"></label>' +
        '<label class="pe-rr"><span>上下边距</span>' +
        '<input type="number" class="pe-r-num" data-k="padV" min="0" step="1" value="' + v(r.padV) + '"></label>' +
        '<label class="pe-rr"><span>左右边距</span>' +
        '<input type="number" class="pe-r-num" data-k="padH" min="0" step="1" value="' + v(r.padH) + '"></label>' +
        '<label class="pe-rr"><span>垂直间距</span>' +
        '<input type="number" class="pe-r-num" data-k="gap" min="0" step="1" value="' + v(r.gap) + '"></label>';
    } else {
      f += '<label class="pe-rr"><span>上下外边距</span>' +
        '<input type="number" class="pe-r-num" data-k="marginV" min="0" step="1" value="' + v(r.marginV) + '"></label>' +
        '<label class="pe-rr"><span>左右外边距</span>' +
        '<input type="number" class="pe-r-num" data-k="marginH" min="0" step="1" value="' + v(r.marginH) + '"></label>' +
        '<label class="pe-rr pe-rr-check"><input type="checkbox" class="pe-r-hidden" data-k="hidden"' +
        (r.hidden ? ' checked' : '') + '><span>此档宽度下隐藏</span></label>';
    }
    return '<div class="pe-resp-row">' + f +
      '<button type="button" class="btn btn-danger pe-mini" data-act="resp-rule-del" title="删除该档">×</button>' +
    '</div>';
  }

  /* 三级挂载控件：下拉（无/模板/自定义）+ 自定义规则行容器。
     level=screen 挂屏卡片，box 挂盒卡片，app 挂板块行 */
  function respAttachHTML(level, ref) {
    var isCustom = ref && typeof ref === 'object';
    var selVal = typeof ref === 'string' ? ref : (isCustom ? 'custom' : '');
    var rows = isCustom ? (ref.rules || []).map(function (r) {
      return respRuleRowHTML(level, r);
    }).join('') : '';
    return '<div class="pe-resp" data-level="' + level + '">' +
      '<select class="pe-resp-sel" title="响应式模板（窄屏断点规则）">' +
        respTplOptions(level, selVal) + '</select>' +
      '<div class="pe-resp-rules' + (isCustom ? '' : ' hidden') + '">' + rows +
        '<button type="button" class="btn pe-mini" data-act="resp-rule-add">＋ 加一档断点</button>' +
      '</div>' +
    '</div>';
  }

  /* 读取一条响应式规则行（屏/盒附件编辑器与模板库编辑器共用）：
     校验失败 throw（errPrefix 拼错误归属，如「模板」/「盒子的响应式」）；
     整档留空或属性被 sanitizeRule 剥光 → 返回 null，调用方跳过 */
  function readRuleRow(row, i, level, errPrefix) {
    var r = {};
    var hasAny = false;
    var maxRaw = row.querySelector('.pe-r-max').value.trim();
    row.querySelectorAll('.pe-r-num').forEach(function (inp) {
      if (inp.value.trim() === '') return;
      hasAny = true;
      var n = Number(inp.value);
      if (isNaN(n) || n < 0 || n > 9999) {
        throw new Error(errPrefix + '第 ' + (i + 1) + ' 档数值需为 0~9999');
      }
      r[inp.dataset.k] = n;
    });
    var w = row.querySelector('.pe-r-width');
    if (w && w.value.trim() !== '') {
      hasAny = true;
      var s = w.value.trim();
      if (!/^\d+(\.\d+)?(px|%)$/.test(s)) {
        throw new Error(errPrefix + '第 ' + (i + 1) + ' 档宽度格式应为 1000px 或 92%');
      }
      r.width = s;
    }
    row.querySelectorAll('.pe-r-sel').forEach(function (sel) {
      if (sel.value) { hasAny = true; r[sel.dataset.k] = sel.value; }
    });
    var hid = row.querySelector('.pe-r-hidden');
    if (hid && hid.checked) { hasAny = true; r.hidden = true; }
    if (!hasAny && maxRaw === '') return null;
    var max = Number(maxRaw);
    if (isNaN(max) || max <= 0 || max > 99999) {
      throw new Error(errPrefix + '第 ' + (i + 1) + ' 档断点宽度需为正整数');
    }
    r.max = Math.round(max);
    return window.SSBApps.sanitizeRule(level, r);
  }

  /* 读取一个挂载控件：返回 undefined（无）/ 'tpl:id' / {rules}。
     行校验失败 throw Error，由 syncPageEditor 统一捕获转保存错误 */
  function readRespAttach(container, where) {
    if (!container) return undefined;
    var v = container.querySelector('.pe-resp-sel').value;
    if (v !== 'custom') return v || undefined;
    var rules = [];
    var rows = container.querySelectorAll('.pe-resp-row');
    for (var i = 0; i < rows.length; i++) {
      var clean = readRuleRow(rows[i], i, container.dataset.level, where + '的响应式');
      if (clean) rules.push(clean);
    }
    return rules.length ? { rules: rules } : undefined;
  }

  /* ---------- 模板库视图 ---------- */
  function respSummary(t) {
    if (!t.rules.length) return '（无有效档位）';
    return t.rules.map(function (r) {
      var parts = Object.keys(r).filter(function (k) { return k !== 'max'; })
        .map(function (k) { return k + '=' + r[k]; });
      return '≤' + r.max + 'px（' + parts.join(' ') + '）';
    }).join('，');
  }

  function respLibHTML() {
    var list = respTplList();
    var html = '';
    if (list.length) {
      html = '<div class="resp-lib-list">' + list.map(function (t, i) {
        return '<div class="resp-row" data-idx="' + i + '">' +
          '<span class="resp-badge">' + RESP_LEVEL_NAMES[t.appliesTo] + '</span>' +
          '<b>' + escapeHTML(t.name) + '</b>' +
          '<span class="resp-sum">' + escapeHTML(respSummary(t)) + '</span>' +
          '<span class="pl-acts">' +
            '<button type="button" class="btn pe-mini" data-act="tpl-edit" data-idx="' + i + '">编辑</button>' +
            '<button type="button" class="btn btn-danger pe-mini" data-act="tpl-del" data-idx="' + i + '">删除</button>' +
          '</span>' +
        '</div>';
      }).join('') + '</div>';
    } else {
      html = '<p class="section-hint">还没有模板。新建一个，比如盒级模板「标准盒子」：≤720px 时宽度改为 100%。</p>';
    }
    if (respEdit) html += respTplEditorHTML();
    else html += '<button type="button" class="btn" data-act="tpl-new">＋ 新建模板</button>';
    return html;
  }

  function respTplEditorHTML() {
    var isNew = respEdit.mode === 'new';
    var t = isNew ? null : respTplList()[respEdit.idx];
    var level = t ? t.appliesTo : 'box';
    var levelOpts = window.SSBApps.respMeta.levels.map(function (lv) {
      return '<option value="' + lv + '"' + (lv === level ? ' selected' : '') + '>' +
        RESP_LEVEL_NAMES[lv] + '</option>';
    }).join('');
    var rows = (t ? t.rules : []).map(function (r) { return respRuleRowHTML(level, r); }).join('');
    return '<div class="resp-edit" data-mode="' + (isNew ? 'new' : 'edit') + '"' +
      (isNew ? '' : ' data-idx="' + respEdit.idx + '"') + '>' +
      '<div class="resp-edit-head">' +
        '<label class="pe-rr"><span>模板名称</span>' +
          '<input type="text" class="pe-t-name" maxlength="20" placeholder="如：标准盒子" value="' +
          (t ? escapeHTML(t.name) : '') + '"></label>' +
        '<label class="pe-rr"><span>适用层级（保存后不可改）</span>' +
          '<select class="pe-t-level"' + (isNew ? '' : ' disabled') + '>' + levelOpts + '</select></label>' +
      '</div>' +
      '<div class="pe-resp-rules" id="tpl-rules" data-level="' + level + '">' + rows +
        '<button type="button" class="btn pe-mini" data-act="t-rule-add">＋ 加一档断点</button>' +
      '</div>' +
      '<div class="action-row">' +
        '<button type="button" class="btn btn-primary" data-act="tpl-save">保存模板</button>' +
        '<button type="button" class="btn" data-act="tpl-cancel">取消</button>' +
        '<span class="pe-add-hint">保存模板只写入下方草稿，还需点右上角「保存页面」才会持久化</span>' +
      '</div>' +
    '</div>';
  }

  function renderRespLib() {
    var box = $('resp-lib-body');
    if (!box || !respWork) return;
    box.innerHTML = respLibHTML();
  }

  /* 读取模板编辑器（校验失败 throw）；成功返回写入 respWork 的模板对象 */
  function readTplEditor() {
    var ed = document.querySelector('.resp-edit');
    var isNew = ed.dataset.mode === 'new';
    var name = ed.querySelector('.pe-t-name').value.trim();
    if (!name) throw new Error('模板名称不能为空');
    var level = ed.querySelector('.pe-t-level').value;
    var rules = [];
    var rows = ed.querySelectorAll('#tpl-rules .pe-resp-row');
    for (var i = 0; i < rows.length; i++) {
      var clean = readRuleRow(rows[i], i, level, '');
      if (clean) rules.push(clean);
    }
    if (!rules.length) throw new Error('模板至少要有一档有效规则（填断点宽度 + 至少一个属性）');
    var id;
    if (isNew) {
      id = 't' + Date.now().toString(36);
      while (respTplList().some(function (t) { return t.id === id; })) id += 'x';
    } else {
      id = respTplList()[respEdit.idx].id;
    }
    return { id: id, name: name, appliesTo: level, rules: rules };
  }

  /* ---------- 单页编辑：屏 / 盒子 / 板块实例 ---------- */

  function openPageEditor(idx) {
    editIndex = idx;
    renderPageEditor();
    showView('page-editor');
    window.scrollTo(0, 0);
  }

  function buildUidMap(p) {
    var map = {};
    forEachInst([p], function (inst) { map[inst.uid] = inst; });
    return map;
  }

  /* select 选项小工具 */
  function selOptions(pairs, value) {
    return pairs.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === value ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
  }

  var ALIGN_PAIRS = [['left', '左对齐'], ['center', '居中'], ['right', '右对齐']];
  var VALIGN_PAIRS = [['start', '靠上'], ['center', '上下居中'], ['end', '靠下']];
  /* v4：屏背景类型改为后台背景应用清单动态生成，不再有写死的类型对 */
  var ORDER_PAIRS = [['newest', '最新在前'], ['oldest', '最早在前']];
  var GROUP_PAIRS = [['year', '按年 → 月'], ['month', '按年-月'], ['flat', '平铺不分组']];

  /* 板块的实例级配置区：posts / archive-list 有表单，rich-content 是富文本编辑器，
     其余板块（notice/quote/search/nav）的数据在「应用管理」中维护，这里无实例配置 */
  function instCfgHTML(inst) {
    var g = (pagesData.apps || {})[inst.id] || {};
    var c = inst.cfg || {};

    if (inst.id === 'posts') {
      var count = c.count != null ? c.count : (g.count != null ? g.count : 6);
      var cover = c.cover != null ? c.cover : (g.cover !== false);
      var summary = c.summary != null ? c.summary : (g.summary !== false);
      var order = c.order || g.order || 'newest';
      var cat = c.category != null ? c.category : (g.category || '');
      return '<div class="pe-cfg">' +
        '<label class="pe-cf pe-cf-title"><span>区块标题（留空=默认“最新文章”）</span>' +
          '<input type="text" class="pe-cfg-title" value="' + escapeHTML(c.title || '') + '" maxlength="30"></label>' +
        '<label class="pe-cf"><span>显示篇数（0=全部）</span>' +
          '<input type="number" class="pe-cfg-count" min="0" max="100" step="1" value="' + count + '"></label>' +
        '<label class="pe-cf"><span>排序</span>' +
          '<select class="pe-cfg-order">' + selOptions(ORDER_PAIRS, order) + '</select></label>' +
        '<label class="pe-cf"><span>限定分类（留空=全部）</span>' +
          '<input type="text" class="pe-cfg-category" value="' + escapeHTML(cat) + '" maxlength="20"></label>' +
        '<label class="pe-cf pe-cf-check"><input type="checkbox" class="pe-cfg-cover"' +
          (cover ? ' checked' : '') + '><span>封面图</span></label>' +
        '<label class="pe-cf pe-cf-check"><input type="checkbox" class="pe-cfg-summary"' +
          (summary ? ' checked' : '') + '><span>摘要</span></label>' +
      '</div>';
    }

    if (inst.id === 'archive-list') {
      var groupBy = ['year', 'month', 'flat'].indexOf(c.groupBy) > -1
        ? c.groupBy : (g.groupBy || 'year');
      var aOrder = c.order || g.order || 'newest';
      var filters = c.filters != null ? c.filters : (g.filters !== false);
      var pageSize = c.pageSize != null ? c.pageSize : (g.pageSize != null ? g.pageSize : 10);
      var showTotal = c.showTotal != null ? c.showTotal : (g.showTotal !== false);
      return '<div class="pe-cfg">' +
        '<label class="pe-cf"><span>分组方式</span>' +
          '<select class="pe-cfg-groupby">' + selOptions(GROUP_PAIRS, groupBy) + '</select></label>' +
        '<label class="pe-cf"><span>排序</span>' +
          '<select class="pe-cfg-order">' + selOptions(ORDER_PAIRS, aOrder) + '</select></label>' +
        '<label class="pe-cf"><span>每页篇数（0=不分页）</span>' +
          '<input type="number" class="pe-cfg-pagesize" min="0" max="999" step="1" value="' + pageSize + '"></label>' +
        '<label class="pe-cf pe-cf-check"><input type="checkbox" class="pe-cfg-filters"' +
          (filters ? ' checked' : '') + '><span>分类筛选条</span></label>' +
        '<label class="pe-cf pe-cf-check"><input type="checkbox" class="pe-cfg-total"' +
          (showTotal ? ' checked' : '') + '><span>显示文章总数</span></label>' +
      '</div>';
    }

    if (inst.id === 'rich-content') {
      /* 正文在渲染后按 uid 填进 .pe-rich-body，不直接拼 HTML 字符串 */
      return '<details class="pe-rich" open><summary>富文本正文（图片可直接 Ctrl+V 粘贴）</summary>' +
        '<div class="editor-toolbar pe-rich-bar"></div>' +
        '<div class="editor-body pe-rich-body" contenteditable="true" ' +
          'placeholder="写下正文内容…保存时图片自动上传"></div>' +
        '<input type="file" class="pe-rich-file" accept="image/*" hidden></details>';
    }

    return '';
  }

  function appRowHTML(p, sc, box, inst, si, bi) {
    var m = { label: appLabel(inst.id) };
    var idxInBox = box.apps.indexOf(inst);
    var num = function (x) { return x == null ? '' : String(x); };

    /* 盒内移动：同屏有多个盒子时才显示，目标为盒子序号 */
    var moveHTML = '';
    if (sc.boxes.length > 1) {
      var opts = '';
      sc.boxes.forEach(function (b, i) {
        opts += '<option value="' + i + '"' + (i === bi ? ' selected' : '') + '>盒子 ' + (i + 1) + '</option>';
      });
      moveHTML = '<label class="pe-amove"><span>移至</span>' +
        '<select class="pe-amove-sel" data-si="' + si + '" data-bi="' + bi + '">' + opts + '</select></label>';
    }

    return '<div class="pe-app" data-ui="' + escapeHTML(inst.uid) + '" data-aid="' + inst.id + '">' +
      '<input type="checkbox" class="pe-aon" title="启用 / 停用"' +
        (inst.enable !== false ? ' checked' : '') + '>' +
      '<span class="pe-a-name"><b>' + m.label + '</b><i>' + inst.id + '</i></span>' +
      instCfgHTML(inst) +
      '<label class="pe-a-align"><span>对齐</span>' +
        '<select class="pe-aalign">' + selOptions(ALIGN_PAIRS, inst.align || 'left') + '</select></label>' +
      '<label class="pe-a-mg"><span>边距↕</span>' +
        '<input type="number" class="pe-amgv" min="0" max="9999" step="1" placeholder="0" value="' + num(inst.marginV) + '"></label>' +
      '<label class="pe-a-mg"><span>边距↔</span>' +
        '<input type="number" class="pe-amgh" min="0" max="9999" step="1" placeholder="0" value="' + num(inst.marginH) + '"></label>' +
      '<span class="pe-a-resp">' + respAttachHTML('app', inst.responsive) + '</span>' +
      moveHTML +
      '<span class="pe-app-acts">' +
        '<button type="button" class="btn pe-mini" data-act="app-up" title="上移" ' +
          (idxInBox === 0 ? 'disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn pe-mini" data-act="app-down" title="下移" ' +
          (idxInBox === box.apps.length - 1 ? 'disabled' : '') + '>↓</button>' +
        '<button type="button" class="btn btn-danger pe-mini" data-act="app-del" title="移除">×</button>' +
      '</span>' +
    '</div>';
  }

  function appAddHTML(si, bi) {
    var opts = '<option value="">＋ 添加板块…</option>';
    /* 下拉直接来自应用注册表（清单 + define 探测），自定义应用自动出现；
       kind=background 的背景应用只能作为屏背景，不能挂进盒子 */
    Object.keys(adminRegistry).forEach(function (id) {
      if (adminRegistry[id].kind === 'background') return;
      opts += '<option value="' + id + '">' + appLabel(id) + '（' + id + '）</option>';
    });
    return '<select class="pe-app-add" data-si="' + si + '" data-bi="' + bi + '">' + opts + '</select>';
  }

  function boxEditorHTML(p, sc, box, si, bi) {
    var num = function (x) { return x == null ? '' : String(x); };
    return '<div class="pe-box" data-bi="' + bi + '">' +
      '<div class="pe-box-head">' +
        '<b>盒子 ' + (bi + 1) + '</b>' +
        '<label class="pe-bw"><span>宽度</span>' +
          '<input type="text" class="pe-bw-input" value="' + escapeHTML(box.width || '') + '" ' +
            'placeholder="1000px / 92%" maxlength="12"></label>' +
        '<label class="pe-bh"><span>水平位置</span>' +
          '<select class="pe-bh-select">' + selOptions(BOX_HALIGN_PAIRS, box.hAlign || 'center') + '</select></label>' +
        '<span class="pe-box-acts">' +
          '<button type="button" class="btn pe-mini" data-act="box-up" title="上移" ' +
            (bi === 0 ? 'disabled' : '') + '>↑</button>' +
          '<button type="button" class="btn pe-mini" data-act="box-down" title="下移" ' +
            (bi === sc.boxes.length - 1 ? 'disabled' : '') + '>↓</button>' +
          '<button type="button" class="btn btn-danger pe-mini" data-act="box-del" title="删除盒子" ' +
            (sc.boxes.length === 1 ? 'disabled' : '') + '>×</button>' +
        '</span>' +
      '</div>' +
      '<div class="pe-box-props">' +
        '<label class="pe-bp"><span>内边距 上下</span>' +
          '<input type="number" class="pe-bpadv" min="0" max="9999" step="1" placeholder="默认 0" value="' + num(box.padV) + '"></label>' +
        '<label class="pe-bp"><span>内边距 左右</span>' +
          '<input type="number" class="pe-bpadh" min="0" max="9999" step="1" placeholder="默认 0" value="' + num(box.padH) + '"></label>' +
        '<label class="pe-bp"><span>垂直间距（盒内板块间隔）</span>' +
          '<input type="number" class="pe-bgap" min="0" max="9999" step="1" placeholder="默认 16" value="' + num(box.gap) + '"></label>' +
        '<div class="pe-bp pe-bp-resp"><span>响应式</span>' + respAttachHTML('box', box.responsive) + '</div>' +
      '</div>' +
      '<div class="pe-apps">' +
        box.apps.map(function (inst) { return appRowHTML(p, sc, box, inst, si, bi); }).join('') +
      '</div>' +
      appAddHTML(si, bi) +
    '</div>';
  }

  /* 屏级布局九宫格：3×3 按钮一格同时定 vAlign（纵）与 hAlign（横） */
  function grid9HTML(v, h) {
    var html = '<div class="pe-grid9">';
    G9_VALS.forEach(function (vv) {
      G9_VALS.forEach(function (hh) {
        var on = vv === v && hh === h;
        html += '<button type="button" class="pe-g9' + (on ? ' on' : '') +
          '" data-act="g9" data-v="' + vv + '" data-h="' + hh + '" title="垂直' +
          G9_NAMES[vv] + '·水平' + (hh === 'start' ? '靠左' : hh === 'end' ? '靠右' : '居中') + '"></button>';
      });
    });
    return html + '</div>';
  }

  function screenEditorHTML(p, sc, si, screenCount) {
    var multi = screenCount > 1;
    /* v4 屏背景为「背景应用」：{app, variant?}；开关只认 app 非空 */
    var bgApp = (sc.bg && sc.bg.app) || '';
    var bgOn = !!bgApp;
    var bgVariant = (sc.bg && sc.bg.variant) || '';
    var bgDef = bgApp ? adminRegistry[bgApp] : null;
    var hasVariants = !!(bgDef && bgDef.variants);
    /* 未开启时默认选中清单第一个应用，开启即可直接保存 */
    var selApp = bgApp || ((adminBackgroundApps()[0] || {}).id || '');
    var bgTypeOpts = adminBackgroundApps().map(function (d) {
      return '<option value="' + d.id + '"' + (d.id === selApp ? ' selected' : '') + '>' +
        escapeHTML(d.name) + '</option>';
    }).join('');
    /* 当前 app 指向已卸载应用时追加保留项，避免静默丢失 */
    if (bgApp && !adminRegistry[bgApp]) {
      bgTypeOpts += '<option value="' + escapeHTML(bgApp) + '" selected>' +
        escapeHTML(bgApp) + '（未安装）</option>';
    }
    return '<div class="card pe-card pe-screen" data-si="' + si + '">' +
      '<div class="pe-sc-head">' +
        '<b>第 ' + (si + 1) + ' 屏</b>' +
        '<span class="pe-sc-hint">' +
          (multi ? '多屏模式：各屏整屏高 + 轻吸附，本屏底部自动出现下滑按钮'
                 : (p.template === 'landing' ? '单屏（落地页始终整屏展示）' : '单屏：保持普通文档流，再加一屏即进入整屏模式')) +
        '</span>' +
        '<span class="pe-sc-acts">' +
          '<button type="button" class="btn pe-mini" data-act="sc-up" title="上移" ' +
            (si === 0 ? 'disabled' : '') + '>↑</button>' +
          '<button type="button" class="btn pe-mini" data-act="sc-down" title="下移" ' +
            (si === screenCount - 1 ? 'disabled' : '') + '>↓</button>' +
          '<button type="button" class="btn btn-danger pe-mini" data-act="sc-del" title="删除本屏" ' +
            (screenCount === 1 ? 'disabled' : '') + '>×</button>' +
        '</span>' +
      '</div>' +
      '<div class="form-grid form-grid-3 pe-sc-grid">' +
        '<label class="form-field"><span>屏背景</span>' +
          '<span class="pe-bg-on"><input type="checkbox" class="pe-bgon"' + (bgOn ? ' checked' : '') + '>' +
          '<em>开启' + (bgOn ? '' : '（关闭后此屏无背景）') + '</em></span></label>' +
        '<label class="form-field pe-bg-ops' + (bgOn ? '' : ' hidden') + '"><span>背景类型</span>' +
          '<select class="pe-bgtype">' + bgTypeOpts + '</select></label>' +
        '<label class="form-field pe-bgvariant-wrap' + (bgOn && hasVariants ? '' : ' hidden') + '">' +
          '<span>变体（壁纸 / 视频条目，在应用「数据」页维护）</span>' +
          '<select class="pe-bgvariant">' + bgVariantOptionsHTML(bgApp || selApp, bgVariant) + '</select></label>' +
        '<div class="form-field"><span>布局方式（九宫格：盒组在屏内的位置）</span>' +
          grid9HTML(sc.vAlign || 'start', sc.hAlign || 'center') + '</div>' +
      '</div>' +
      '<div class="pe-sc-extra"><div class="form-field">' +
        '<span>响应式（窄屏断点规则，在模板库中选择或自定义）</span>' +
        respAttachHTML('screen', sc.responsive) +
      '</div></div>' +
      sc.boxes.map(function (box, bi) { return boxEditorHTML(p, sc, box, si, bi); }).join('') +
      '<button type="button" class="btn pe-box-add" data-act="box-add" data-si="' + si + '">＋ 添加盒子</button>' +
    '</div>';
  }

  function pageFileHint(p) {
    if (isBuiltinPage(p)) return '落地页固定入口：index.html（全站唯一，不可删除）';
    /* 自建页统一走动态页 page.html?slug=，无需在仓库生成静态外壳 */
    return '动态页：page.html?slug=' + escapeHTML(p.id);
  }

  function renderPageEditor() {
    var box = $('pe-body');
    var p = pagesWork[editIndex];
    if (!p) { box.innerHTML = ''; return; }
    var builtin = isBuiltinPage(p);

    /* 无 screens 的异常数据：编辑器就地兜底出一屏（保存时自然补进数据），
       不在读取层改写原数据 */
    var pScreens = (p.screens && p.screens.length)
      ? p.screens : [emptyScreen(p.template)];
    var screenCards = pScreens.map(function (sc, si) {
      return screenEditorHTML(p, sc, si, pScreens.length);
    }).join('');

    var html = '<div class="card pe-card pe-meta">' +
      '<h2>页面信息</h2>' +
      '<div class="form-grid form-grid-3">' +
        '<label class="form-field"><span>页面标题（导航文字 + 列表页 h1）</span>' +
          '<input type="text" class="pe-title" value="' + escapeHTML(p.title) + '" maxlength="20"></label>' +
        '<label class="form-field"><span>页面标识 slug' + (builtin ? '（落地页锁定）' : '') + '</span>' +
          '<input type="text" class="pe-id" value="' + escapeHTML(p.id) + '"' +
            (builtin ? ' readonly' : '') + '></label>' +
        '<label class="form-field"><span>页面模板' + (builtin ? '（落地页锁定）' : '') + '</span>' +
          '<select class="pe-template"' + (builtin ? ' disabled' : '') + '>' +
            tplOptions(p.template, builtin) + '</select></label>' +
        '<label class="form-field checkbox-field">' +
          '<input type="checkbox" class="pe-showtitle"' + (p.showTitle === true ? ' checked' : '') + '>' +
          '<span>显示页面大标题 h1</span></label>' +
      '</div>' +
      '<p class="pe-file-hint">' + pageFileHint(p) + '</p>' +
    '</div>' +
    screenCards +
    '<div class="pe-add-screen-row">' +
      '<button type="button" class="btn" data-act="sc-add">＋ 添加一屏</button>' +
      '<span class="pe-add-hint">超过一屏后，前台各屏整屏展示并支持滚动吸附，屏底出现下滑动画按钮</span>' +
    '</div>';
    box.innerHTML = html;

    /* 富文本实例逐个绑定工具栏并填入已有正文（HTML 走 DOM 注入，与文章编辑器同一信任级别） */
    var uidMap = buildUidMap(p);
    box.querySelectorAll('.pe-app[data-aid="rich-content"]').forEach(function (row) {
      var inst = uidMap[row.dataset.ui];
      var body = row.querySelector('.pe-rich-body');
      initRichEditor(row.querySelector('.pe-rich-bar'), body, row.querySelector('.pe-rich-file'));
      body.innerHTML = (inst && inst.cfg && inst.cfg.html) || '';
    });
  }

  /* 结构性操作后的重渲染：保持当前滚动位置，减少跳动 */
  function rerenderEditor() {
    var y = window.scrollY;
    renderPageEditor();
    window.scrollTo(0, y);
  }

  /* 把编辑视图 DOM 收回到 pagesWork[editIndex]；所有结构性操作 / 保存前必调，
     防止输入框与富文本中未落盘的内容在重渲染时丢失。返回 error 中止操作。
     响应式规则行校验失败以 throw 传导，这里统一捕获转 {error} */
  function syncPageEditor() {
    if (editIndex < 0) return { ok: true };
    var root = $('pe-body');
    var p = pagesWork[editIndex];
    if (!root || !p) return { ok: true };

    try {
      p.title = root.querySelector('.pe-title').value.trim();
      /* 大标题显隐：编辑器始终写显式布尔值，页面配置不再依赖模板隐式推导 */
      p.showTitle = root.querySelector('.pe-showtitle').checked;
      /* 内置页模板 select 被禁用，值仍可读；自建页正常更新 */
      p.template = root.querySelector('.pe-template').value;
      var idEl = root.querySelector('.pe-id');
      if (idEl && !idEl.readOnly) p.id = idEl.value.trim();

      var screens = [];
      var scEls = root.querySelectorAll('.pe-screen');
      for (var s = 0; s < scEls.length; s++) {
        var scEl = scEls[s];
        /* 背景开关开启={app, variant?}；关闭=不带 bg 字段 */
        var bgOn = scEl.querySelector('.pe-bgon').checked;
        /* 九宫格当前格：一格同时定垂直与水平 */
        var g9 = scEl.querySelector('.pe-grid9 .on');
        var sc = { vAlign: g9 ? g9.dataset.v : 'start',
                   hAlign: g9 ? g9.dataset.h : 'center',
                   boxes: [] };
        if (bgOn) sc.bg = { app: scEl.querySelector('.pe-bgtype').value };
        var vwrap = scEl.querySelector('.pe-bgvariant-wrap');
        if (bgOn && !vwrap.classList.contains('hidden')) {
          var bgVariantVal = scEl.querySelector('.pe-bgvariant').value;
          if (bgVariantVal) sc.bg.variant = bgVariantVal;
        }
        sc.responsive = readRespAttach(scEl.querySelector('.pe-resp[data-level="screen"]'), '第 ' + (s + 1) + ' 屏');

        var boxEls = scEl.querySelectorAll('.pe-box');
        for (var b = 0; b < boxEls.length; b++) {
          var boxEl = boxEls[b];
          var where = '第 ' + (s + 1) + ' 屏盒子 ' + (b + 1);
          var box = { width: boxEl.querySelector('.pe-bw-input').value.trim(),
                      hAlign: boxEl.querySelector('.pe-bh-select').value, apps: [] };
          var padV = boxEl.querySelector('.pe-bpadv').value.trim();
          var padH = boxEl.querySelector('.pe-bpadh').value.trim();
          var bgap = boxEl.querySelector('.pe-bgap').value.trim();
          if (padV !== '') box.padV = readNum(padV, where + '的「内边距 上下」');
          if (padH !== '') box.padH = readNum(padH, where + '的「内边距 左右」');
          if (bgap !== '') box.gap = readNum(bgap, where + '的「垂直间距」');
          box.responsive = readRespAttach(boxEl.querySelector('.pe-resp[data-level="box"]'), where);

          var rows = boxEl.querySelectorAll('.pe-app');
          for (var a = 0; a < rows.length; a++) {
            var row = rows[a];
            var inst = { uid: row.dataset.ui, id: row.dataset.aid,
                         enable: row.querySelector('.pe-aon').checked,
                         align: row.querySelector('.pe-aalign').value };
            var mgv = row.querySelector('.pe-amgv').value.trim();
            var mgh = row.querySelector('.pe-amgh').value.trim();
            if (mgv !== '') inst.marginV = readNum(mgv, where + '板块的外边距↕');
            if (mgh !== '') inst.marginH = readNum(mgh, where + '板块的外边距↔');
            inst.responsive = readRespAttach(row.querySelector('.pe-resp[data-level="app"]'),
              where + '的「' + appLabel(inst.id) + '」');
            if (inst.id === 'posts') {
              var n = parseInt(row.querySelector('.pe-cfg-count').value, 10);
              if (isNaN(n) || n < 0 || n > 100) {
                throw new Error(where + '的文章列表「显示篇数」需为 0~100 的整数');
              }
              var cfg = {
                count: n,
                order: row.querySelector('.pe-cfg-order').value === 'oldest' ? 'oldest' : 'newest',
                category: row.querySelector('.pe-cfg-category').value.trim(),
                cover: row.querySelector('.pe-cfg-cover').checked,
                summary: row.querySelector('.pe-cfg-summary').checked
              };
              var title = row.querySelector('.pe-cfg-title').value.trim();
              if (title) cfg.title = title;   /* 留空时前台回落到默认「最新文章」 */
              inst.cfg = cfg;
            } else if (inst.id === 'archive-list') {
              var ps = parseInt(row.querySelector('.pe-cfg-pagesize').value, 10);
              if (isNaN(ps) || ps < 0 || ps > 999) {
                throw new Error(where + '的归档列表「每页篇数」需为 0~999 的整数');
              }
              inst.cfg = {
                groupBy: row.querySelector('.pe-cfg-groupby').value,
                order: row.querySelector('.pe-cfg-order').value === 'oldest' ? 'oldest' : 'newest',
                pageSize: ps,
                filters: row.querySelector('.pe-cfg-filters').checked,
                showTotal: row.querySelector('.pe-cfg-total').checked
              };
            } else if (inst.id === 'rich-content') {
              inst.cfg = { html: row.querySelector('.pe-rich-body').innerHTML };
            }
            box.apps.push(inst);
          }
          sc.boxes.push(box);
        }
        screens.push(sc);
      }
      p.screens = screens;
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  }

  /* 数字输入通用校验（盒内边距/间距、应用外边距） */
  function readNum(raw, where) {
    var n = Number(raw);
    if (isNaN(n) || n < 0 || n > 9999) throw new Error(where + '需为 0~9999 的数值');
    return Math.round(n * 10) / 10;
  }

  function validatePages(pages) {
    var seen = {};
    var landingCount = 0;
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      if (p.template === 'landing') landingCount++;
      if (!p.id) return '第 ' + (i + 1) + ' 个页面缺少页面标识 id';
      if (!/^[a-z0-9-]+$/.test(p.id)) return '页面标识只能是英文/数字/短横线：' + p.id;
      if (seen[p.id]) return '存在重复的页面标识：' + p.id;
      seen[p.id] = true;
      if (!p.title) return '页面「' + p.id + '」缺少标题';
      if (!p.screens || !p.screens.length) return '页面「' + p.id + '」至少要有一屏';
      for (var s = 0; s < p.screens.length; s++) {
        var sc = p.screens[s];
        if (!sc.boxes || !sc.boxes.length) {
          return '页面「' + p.id + '」第 ' + (s + 1) + ' 屏至少要有一个盒子';
        }
        for (var b = 0; b < sc.boxes.length; b++) {
          var box = sc.boxes[b];
          if (!BOX_WIDTH_RE.test(box.width)) {
            return '页面「' + p.id + '」第 ' + (s + 1) + ' 屏盒子 ' + (b + 1) +
              ' 的宽度非法：「' + box.width + '」，需为如 1000px 或 92% 的 px/百分比值';
          }
        }
      }
    }
    if (landingCount === 0) return '必须保留一个落地页（template=landing，首页 index.html）';
    if (landingCount > 1) return '落地页只能有一个，检测到 ' + landingCount + ' 个';
    return null;
  }

  /* ---------- 背景应用（后台不执行应用代码，避免前台 CSS/define 副作用污染后台；
     清单与变体全部来自 probe 出的 adminRegistry） ---------- */

  /* 背景应用清单，顺序与 applications.json 一致 */
  function adminBackgroundApps() {
    return adminManifest.apps
      .map(function (m) { return adminRegistry[m.id]; })
      .filter(function (d) { return d && d.kind === 'background'; });
  }

  /* 预拉所有带变体的背景应用清单（壁纸/视频）；单个失败只置空，不阻塞页面编辑 */
  function preloadBgVariants() {
    return Promise.all(adminBackgroundApps().map(function (d) {
      if (!d.variants) return Promise.resolve();
      return d.variants()
        .then(function (list) { bgVariantMap[d.id] = Array.isArray(list) ? list : []; })
        .catch(function () { bgVariantMap[d.id] = []; });
    }));
  }

  /* 变体下拉 HTML：空值 = 不指定（默认随机一张）；
     指向已被移出数据文件的变体时追加一项保留原值，避免静默丢失 */
  function bgVariantOptionsHTML(appId, selected) {
    var opts = '<option value="">— 不指定（默认随机）—</option>';
    var hit = false;
    (bgVariantMap[appId] || []).forEach(function (v) {
      var on = v.value === selected;
      if (on) hit = true;
      var toneTag = v.tone === 'dark' ? '暗' : v.tone === 'light' ? '亮' : '';
      opts += '<option value="' + escapeHTML(v.value) + '"' + (on ? ' selected' : '') + '>' +
        escapeHTML(v.label || v.value) + (toneTag ? '（' + toneTag + '）' : '') + '</option>';
    });
    if (selected && !hit) {
      opts += '<option value="' + escapeHTML(selected) + '" selected>' + escapeHTML(selected) + '</option>';
    }
    return opts;
  }

  /* ---------- 加载 ---------- */

  function loadPagesData() {
    $('pages-list').innerHTML =
      '<div class="card site-card"><div class="site-loading">加载中…</div></div>';
    showPagesMsg('');
    editIndex = -1;

    /* 先确保应用注册表就绪：页面编辑器的板块名称/「添加板块」下拉都读它 */
    loadAdminApps()
      .then(function () { return Promise.all([readDataFile('data/pages.json'), preloadBgVariants()]); })
      .then(function (r) {
      var data = normalizePagesFile(r[0]);
      /* pagesData 保留整份文件快照（含顶层 _comment），保存时深拷贝回写，
         避免后台提交把注释字段抹掉 */
      pagesData = data;
      pagesWork = JSON.parse(JSON.stringify(data.pages));
      /* 响应式模板库工作副本（normalizePagesFile 已就地清洗过） */
      respWork = JSON.parse(JSON.stringify(data.responsive || { templates: [] }));
      respEdit = null;
      /* 富文本统一为浏览器序列化形态，防止首次保存误判「有改动」 */
      normalizeRichInPages(pagesWork);
      renderPagesList();
      renderRespLib();
      pagesLoaded = true;
    }).catch(function (err) {
      $('pages-list').innerHTML = '<div class="card site-card"><div class="site-loading">加载失败：' +
        escapeHTML(err.message) + '</div></div>';
      showPagesMsg(err.message, true);
    });
  }

  /* ---------- 收集 + 保存 ---------- */

  function collectPagesData() {
    /* 编辑视图开着时先把 DOM 收回工作副本（列表视图无输入项，同步为 no-op） */
    var synced = syncPageEditor();
    if (synced.error) return { error: synced.error };
    var err = validatePages(pagesWork);
    if (err) return { error: err };

    /* file 收敛：落地页固定 index.html；其余页面一律动态渲染，file 置空，
       仓库中不为任何普通页面保留静态外壳 */
    pagesWork.forEach(function (p) {
      p.file = isBuiltinPage(p) ? 'index.html' : '';
    });

    /* 基于整份快照深拷贝（保留 _comment 等表外字段），
       只覆盖 pages 数组与 responsive 模板库；顶层 apps 节点归「应用管理」管辖，原样保留 */
    var next = JSON.parse(JSON.stringify(pagesData));
    next.pages = JSON.parse(JSON.stringify(pagesWork));
    next.responsive = JSON.parse(JSON.stringify(respWork || { templates: [] }));

    /* 悬空引用清理：模板被删除或改了层级后，仍指向它的挂载引用直接摘除。
       前台 normalize 虽能自愈忽略，但后台保存就应保持 data/pages.json 数据干净 */
    var validTpl = {};
    (next.responsive.templates || []).forEach(function (t) { validTpl[t.id] = t.appliesTo; });
    function pruneRef(holder, level) {
      var ref = holder.responsive;
      if (typeof ref === 'string' && ref.indexOf('tpl:') === 0) {
        if (validTpl[ref.slice(4)] !== level) delete holder.responsive;
      }
    }
    next.pages.forEach(function (p) {
      (p.screens || []).forEach(function (sc) {
        pruneRef(sc, 'screen');
        (sc.boxes || []).forEach(function (bx) {
          pruneRef(bx, 'box');
          (bx.apps || []).forEach(function (inst) { pruneRef(inst, 'app'); });
        });
      });
    });
    return next;
  }

  /* 收集所有 rich-content 实例正文中的本地图片（dataURL）。
     富文本渲染在根级页面，图片路径不带 posts/ 用的 ../ 前缀 */
  function collectRichImageUploads(pages) {
    var map = {};
    var files = [];
    /* base64 字符集内匹配；src 属性值到引号自然结束 */
    var re = /data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g;
    var ym = todayStr().slice(0, 7).replace('-', '/');
    forEachInst(pages, function (inst) {
      if (inst.id !== 'rich-content' || !inst.cfg) return;
      var html = inst.cfg.html || '';
      var m;
      while ((m = re.exec(html))) {
        var url = m[0];
        if (map[url]) continue;
        var parsed = parseDataURL(url);
        if (!parsed) continue;
        var path = 'assets/images/' + ym + '/page-' + rand6() + '.' + parsed.ext;
        map[url] = path;
        files.push({ path: path, content: parsed.b64, encoding: 'base64' });
      }
    });
    return { map: map, files: files };
  }

  function applyRichImageReplacements(pages, map) {
    forEachInst(pages, function (inst) {
      if (inst.id !== 'rich-content' || !inst.cfg || !inst.cfg.html) return;
      Object.keys(map).forEach(function (url) {
        inst.cfg.html = inst.cfg.html.split(url).join(map[url]);
      });
    });
  }

  function savePagesSettings() {
    if (!pagesData) { showPagesMsg('数据尚未加载完成', true); return; }
    var data = collectPagesData();
    if (data.error) { showPagesMsg(data.error, true); return; }

    /* 差异比较：整份 JSON 无变化就不提交 */
    if (JSON.stringify(data) === JSON.stringify(pagesData)) {
      showPagesMsg('没有检测到改动', false);
      return;
    }

    var btn = editIndex >= 0 ? $('btn-pe-save') : $('btn-pages-save');
    btn.disabled = true;
    btn.textContent = '保存中…';
    showPagesMsg('');

    try {
      localStorage.setItem(LS_APP_PREFIX + 'pages', JSON.stringify(data, null, 2));
      pendingMark('data/pages.json', '页面结构', '页面结构');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '保存页面';
      showPagesMsg('保存失败：浏览器 localStorage 空间不足（富文本内嵌图片过大时也会如此）', true);
      return;
    }
    commitLoaded = false;
    pagesData = data;
    pagesWork = JSON.parse(JSON.stringify(data.pages));
    respWork = JSON.parse(JSON.stringify(data.responsive || { templates: [] }));
    btn.disabled = false;
    btn.textContent = '保存页面';
    if (editIndex >= 0) renderPageEditor();
    showPagesMsg('已保存到本浏览器，刷新前台即可看到效果', false);
    toast('页面管理已保存');
    /* data/pages.json 的 apps 节点同时被「应用管理」编辑，保存后使其快照失效 */
    appsLoaded = false;
  }

  /* ---------- 新建页面 / 复制页面 ---------- */

  function openPageNewCard() {
    $('page-new-card').classList.remove('hidden');
    $('f-page-id').value = '';
    $('f-page-title').value = '';
    $('f-page-template').value = 'list';
    $('f-page-id').focus();
  }

  function createPage() {
    var slug = $('f-page-id').value.trim();
    var title = $('f-page-title').value.trim();
    var tpl = $('f-page-template').value;

    if (!/^[a-z0-9-]+$/.test(slug)) {
      showPagesMsg('页面标识只能是英文/数字/短横线', true);
      return;
    }
    if (!title) { showPagesMsg('请填写页面标题', true); return; }
    /* 落地页全站唯一且已存在，新建页只允许 list/content（表单已去掉该选项，此处兜底） */
    if (tpl === 'landing') {
      showPagesMsg('落地页已存在且唯一，不能新建第二个落地页', true);
      return;
    }
    if (pagesWork.some(function (p) { return p.id === slug; })) {
      showPagesMsg('已存在同标识页面：' + slug, true);
      return;
    }

    /* v3：新页面直接带默认屏/盒/板块结构；file 留空走动态页 page.html?slug=。
       showTitle 新建页默认显示，后台可随时关闭 */
    var np = {
      id: slug,
      title: title,
      template: tpl,
      file: '',
      showTitle: true,
      screens: defaultScreens(tpl)
    };

    pagesWork.push(np);
    $('page-new-card').classList.add('hidden');
    showPagesMsg('页面已创建，编辑完成后点击「保存页面」', false);
    openPageEditor(pagesWork.length - 1);
  }

  /* 复制页面：深拷贝结构并全部重发 uid（uid 在全站范围内必须唯一）。
     落地页不允许复制（列表行无复制按钮，此处兜底防唯一约束被绕过） */
  function duplicatePage(idx) {
    var src = pagesWork[idx];
    if (isBuiltinPage(src)) {
      showPagesMsg('落地页唯一，不能复制', true);
      return;
    }
    var base = src.id + '-copy';
    var id = base;
    var n = 2;
    while (pagesWork.some(function (p) { return p.id === id; })) {
      id = base + '-' + n;
      n += 1;
    }
    var clone = JSON.parse(JSON.stringify(src));
    clone.id = id;
    clone.title = src.title + ' 副本';
    clone.file = '';
    regenerateUIDs(clone);
    pagesWork.push(clone);
    renderPagesList();
    showPagesMsg('已复制为「' + clone.title + '」（标识 ' + id + '），可点编辑继续调整，记得保存', false);
  }

  /* ---------- 页面管理事件（只绑一次，列表 / 编辑两套事件委托） ---------- */
  function bindPagesEvents() {
    if (window.__pagesEventsBound) return;
    window.__pagesEventsBound = true;

    /* 列表视图顶部按钮 */
    $('btn-pages-save').addEventListener('click', savePagesSettings);
    $('btn-pages-reload').addEventListener('click', function () {
      if (confirm('重新加载将丢弃未保存的修改，确定吗？')) {
        pagesLoaded = false;
        loadPagesData();
      }
    });
    $('btn-pages-reset').addEventListener('click', function () {
      if (!confirm('确定删除本浏览器里保存的页面管理覆盖，恢复为仓库 data/pages.json 的默认内容吗？')) return;
      try {
        localStorage.removeItem(LS_APP_PREFIX + 'pages');
        pendingForget('data/pages.json');
      } catch (e) {}
      location.reload();
    });
    $('btn-page-new').addEventListener('click', openPageNewCard);
    $('btn-page-cancel').addEventListener('click', function () {
      $('page-new-card').classList.add('hidden');
    });
    $('btn-page-create').addEventListener('click', createPage);

    /* 列表行：编辑 / 复制 / 排序 / 删除（列表无输入项，无需先同步 DOM） */
    $('pages-list').addEventListener('click', function (e) {
      var rowEl = e.target.closest('.pl-row');
      if (!rowEl) return;
      var idx = parseInt(rowEl.dataset.idx, 10);
      var page = pagesWork[idx];

      if (e.target.closest('[data-pl-edit]')) {
        openPageEditor(idx);
      } else if (e.target.closest('[data-pl-copy]')) {
        duplicatePage(idx);
      } else if (e.target.closest('[data-pl-up]') && idx > 1) {
        pagesWork.splice(idx - 1, 0, pagesWork.splice(idx, 1)[0]);
        renderPagesList();
      } else if (e.target.closest('[data-pl-down]') &&
                 !isBuiltinPage(page) && idx < pagesWork.length - 1) {
        pagesWork.splice(idx + 1, 0, pagesWork.splice(idx, 1)[0]);
        renderPagesList();
      } else if (e.target.closest('[data-pl-del]')) {
        if (!confirm('确定删除页面「' + page.title + '」吗？删除后该页入口导航消失、链接无法访问。')) return;
        pagesWork.splice(idx, 1);
        renderPagesList();
      }
    });

    /* 编辑视图：返回 / 保存 */
    $('btn-pe-back').addEventListener('click', function () {
      var res = syncPageEditor();
      if (res.error) { toast(res.error, true); return; }
      editIndex = -1;
      renderPagesList();
      showView('pages');
    });
    $('btn-pe-save').addEventListener('click', savePagesSettings);

    /* 编辑视图结构性操作：所有按钮带 data-act，下标从最近的 .pe-screen/.pe-box 读取。
       操作前必须先 sync，把输入框 / 富文本中的未落盘内容收回 pagesWork */
    $('pe-body').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.dataset.act;

      /* 响应式自定义规则行增删：纯 DOM 操作不入数据（空行在 sync 时自动忽略，
         填了值的行由 sync 收进 {rules}），不重渲染以免刚加的空行被清掉 */
      if (act === 'resp-rule-add') {
        var wrap = btn.closest('.pe-resp-rules');
        var lv = wrap.dataset.level || wrap.closest('.pe-resp').dataset.level;
        btn.insertAdjacentHTML('beforebegin', respRuleRowHTML(lv));
        return;
      }
      if (act === 'resp-rule-del') {
        var rw = btn.closest('.pe-resp-row');
        if (rw) rw.remove();
        return;
      }

      if (act === 'sc-add') {
        var res0 = syncPageEditor();
        if (res0.error) { toast(res0.error, true); return; }
        pagesWork[editIndex].screens.push(emptyScreen(pagesWork[editIndex].template));
        rerenderEditor();
        return;
      }

      var res = syncPageEditor();
      if (res.error) { toast(res.error, true); return; }
      var p = pagesWork[editIndex];
      var scEl = btn.closest('.pe-screen');
      var si = parseInt(scEl.dataset.si, 10);

      if (act === 'g9') {
        /* 九宫格：一格同时定盒组的垂直与水平位置 */
        p.screens[si].vAlign = btn.dataset.v;
        p.screens[si].hAlign = btn.dataset.h;
      } else if (act === 'sc-up' && si > 0) {
        p.screens.splice(si - 1, 0, p.screens.splice(si, 1)[0]);
      } else if (act === 'sc-down' && si < p.screens.length - 1) {
        p.screens.splice(si + 1, 0, p.screens.splice(si, 1)[0]);
      } else if (act === 'sc-del' && p.screens.length > 1) {
        if (!confirm('确定删除第 ' + (si + 1) + ' 屏吗？屏内盒子与板块会一并删除。')) return;
        p.screens.splice(si, 1);
      } else if (act === 'box-add') {
        p.screens[si].boxes.push(emptyBox(p.template));
      } else {
        /* 盒子 / 板块操作都发生在某个盒子内 */
        var boxEl = btn.closest('.pe-box');
        var bi = parseInt(boxEl.dataset.bi, 10);
        var box = p.screens[si].boxes[bi];

        if (act === 'box-up' && bi > 0) {
          p.screens[si].boxes.splice(bi - 1, 0, p.screens[si].boxes.splice(bi, 1)[0]);
        } else if (act === 'box-down' && bi < p.screens[si].boxes.length - 1) {
          p.screens[si].boxes.splice(bi + 1, 0, p.screens[si].boxes.splice(bi, 1)[0]);
        } else if (act === 'box-del' && p.screens[si].boxes.length > 1) {
          if (!confirm('确定删除盒子 ' + (bi + 1) + ' 吗？盒内板块会一并删除。')) return;
          p.screens[si].boxes.splice(bi, 1);
        } else if (act === 'app-up' || act === 'app-down' || act === 'app-del') {
          var appEl = btn.closest('.pe-app');
          var ai = -1;
          for (var k = 0; k < box.apps.length; k++) {
            if (box.apps[k].uid === appEl.dataset.ui) { ai = k; break; }
          }
          if (ai < 0) return;
          if (act === 'app-up' && ai > 0) {
            box.apps.splice(ai - 1, 0, box.apps.splice(ai, 1)[0]);
          } else if (act === 'app-down' && ai < box.apps.length - 1) {
            box.apps.splice(ai + 1, 0, box.apps.splice(ai, 1)[0]);
          } else if (act === 'app-del') {
            box.apps.splice(ai, 1);
          }
        } else {
          return;   /* 未识别的动作，不重渲染（保留原生控件状态） */
        }
      }
      rerenderEditor();
    });

    /* 编辑视图 change：背景开关/类型与变体行显隐 / 添加板块 / 跨盒移动。
       用 change 而非 click：select 展开时也会触发 click（旧版已踩过） */
    $('pe-body').addEventListener('change', function (e) {
      var el = e.target;

      /* 背景总开关：关=只留开关；开=恢复类型行，变体行按应用能力显隐 */
      if (el.classList.contains('pe-bgon')) {
        var sc0 = el.closest('.pe-screen');
        var on = el.checked;
        sc0.querySelector('.pe-bg-ops').classList.toggle('hidden', !on);
        var def0 = adminRegistry[sc0.querySelector('.pe-bgtype').value];
        sc0.querySelector('.pe-bgvariant-wrap')
          .classList.toggle('hidden', !(on && def0 && def0.variants));
        el.nextElementSibling.textContent = on ? '开启' : '开启（关闭后此屏无背景）';
        return;
      }

      /* 切换背景应用：变体行只对带 variants 的应用出现，并重建变体选项 */
      if (el.classList.contains('pe-bgtype')) {
        var screenEl = el.closest('.pe-screen');
        var def = adminRegistry[el.value];
        var vwrap = screenEl.querySelector('.pe-bgvariant-wrap');
        vwrap.classList.toggle('hidden', !(def && def.variants));
        vwrap.querySelector('.pe-bgvariant').innerHTML = bgVariantOptionsHTML(el.value, '');
        return;
      }

      if (el.classList.contains('pe-app-add')) {
        var id = el.value;
        if (!id) return;
        var res = syncPageEditor();
        if (res.error) { toast(res.error, true); return; }
        var si = parseInt(el.dataset.si, 10);
        var bi = parseInt(el.dataset.bi, 10);
        var inst = { uid: genUID(), id: id, enable: true,
                     align: isHeroApp(id) ? 'center' : 'left' };
        if (id === 'rich-content') inst.cfg = { html: '' };
        pagesWork[editIndex].screens[si].boxes[bi].apps.push(inst);
        rerenderEditor();
        return;
      }

      if (el.classList.contains('pe-amove-sel')) {
        var res2 = syncPageEditor();
        if (res2.error) { toast(res2.error, true); return; }
        var mSi = parseInt(el.dataset.si, 10);
        var fromBi = parseInt(el.dataset.bi, 10);
        var toBi = parseInt(el.value, 10);
        if (toBi === fromBi) return;
        var rowEl2 = el.closest('.pe-app');
        var boxes = pagesWork[editIndex].screens[mSi].boxes;
        var moveIdx = -1;
        for (var j = 0; j < boxes[fromBi].apps.length; j++) {
          if (boxes[fromBi].apps[j].uid === rowEl2.dataset.ui) { moveIdx = j; break; }
        }
        if (moveIdx < 0) return;
        var moved = boxes[fromBi].apps.splice(moveIdx, 1)[0];
        boxes[toBi].apps.push(moved);
        rerenderEditor();
        return;
      }

      /* 三级「响应式」挂载下拉：无 / 模板引用 / 自定义（展开规则行编辑器） */
      if (el.classList.contains('pe-resp-sel')) {
        var res3 = syncPageEditor();
        if (res3.error) { toast(res3.error, true); return; }
        var wp = pagesWork[editIndex];
        var cont = el.closest('.pe-resp');
        var level = cont.dataset.level;
        var ref = el.value === 'custom' ? { rules: [] } : (el.value || undefined);
        var scEl2 = el.closest('.pe-screen');
        var sI = parseInt(scEl2.dataset.si, 10);
        if (level === 'screen') {
          wp.screens[sI].responsive = ref;
        } else if (level === 'box') {
          var bI = parseInt(el.closest('.pe-box').dataset.bi, 10);
          wp.screens[sI].boxes[bI].responsive = ref;
        } else {
          var uid = el.closest('.pe-app').dataset.ui;
          forEachInst([wp], function (inst) { if (inst.uid === uid) inst.responsive = ref; });
        }
        rerenderEditor();
      }
    });

    /* ---------- 响应式模板库（列表视图内，独立于 pe-body 的委托） ---------- */
    $('resp-lib-card').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.dataset.act;

      if (act === 'tpl-new') {
        respEdit = { mode: 'new', idx: -1 };
        renderRespLib();
      } else if (act === 'tpl-edit') {
        respEdit = { mode: 'edit', idx: parseInt(btn.dataset.idx, 10) };
        renderRespLib();
      } else if (act === 'tpl-del') {
        var idx = parseInt(btn.dataset.idx, 10);
        var t = respTplList()[idx];
        if (!t) return;
        if (!confirm('确定删除模板「' + t.name + '」吗？已挂载它的位置会回落为默认表现。')) return;
        respWork.templates.splice(idx, 1);
        if (respEdit && respEdit.mode === 'edit' && respEdit.idx === idx) respEdit = null;
        renderRespLib();
        showPagesMsg('模板已删除（草稿状态，记得点「保存页面」持久化）', false);
      } else if (act === 't-rule-add') {
        var wrap = btn.closest('.pe-resp-rules');
        btn.insertAdjacentHTML('beforebegin', respRuleRowHTML(wrap.dataset.level));
      } else if (act === 't-rule-del') {
        var row = btn.closest('.pe-resp-row');
        if (row) row.remove();
      } else if (act === 'tpl-save') {
        try {
          var tpl = readTplEditor();
          if (respEdit.mode === 'new') respWork.templates.push(tpl);
          else respWork.templates[respEdit.idx] = tpl;
          respEdit = null;
          renderRespLib();
          showPagesMsg('模板已存入草稿，还需点右上角「保存页面」才会写入 data/pages.json', false);
        } catch (err) {
          toast(err.message, true);
        }
      } else if (act === 'tpl-cancel') {
        respEdit = null;
        renderRespLib();
      }
    });

    /* 新建模板时切换适用层级：字段集随层级不同，直接重置规则行 */
    $('resp-lib-card').addEventListener('change', function (e) {
      if (!e.target.classList.contains('pe-t-level')) return;
      var wrap = document.querySelector('#tpl-rules');
      if (!wrap) return;
      wrap.dataset.level = e.target.value;
      wrap.innerHTML = '<button type="button" class="btn pe-mini" data-act="t-rule-add">＋ 加一档断点</button>';
    });
  }

  /* ============================================================
     应用管理 v3.5：清单驱动 + 应用列表 + 代码/参数/数据编辑
     ------------------------------------------------------------
     - 每个应用 = applications/<id>.js 中一次 SSBApps.define({...})
     - 清单 applications/applications.json 只路由（builtin / dataFile）
     - admin 页没有 common.js（BlogUtils 不存在），这里用沙箱 mock
       依赖探测应用代码，得到与前台同构的注册表 adminRegistry
     - 代码保存前必须通过语法 + 注册校验；单个应用损坏不影响其他
     ============================================================ */

  var MANIFEST_PATH = 'applications/applications.json';
  var APP_ID_RE = /^[a-z0-9_-]+$/;

  var adminRegistry = {};        /* id → define 探测结果（含 code/builtin/dataFile/loadError） */
  var adminManifest = { apps: [] };
  var adminAppsPromise = null;

  /* ---------- 应用代码读取（admin 在二级目录，fetch 统一加 ROOT='../'） ---------- */

  function adminReadAppCode(id) {
    /* 后台编辑保存的 localStorage 覆盖优先于仓库文件 */
    try {
      var raw = localStorage.getItem(window.SSBApps.appCodeKey + id);
      if (raw != null) return Promise.resolve(raw);
    } catch (e) {}
    return fetch(ROOT + window.SSBApps.appsDir + encodeURIComponent(id) + '.js',
                 { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('代码文件读取失败（HTTP ' + res.status + '）');
        return res.text();
      });
  }

  /* 探测期 mock 依赖：只跑 define 注册、不跑 render。
     未列出的工具经 Proxy 给静默空桩，避免个别应用顶层触碰工具时误伤校验 */
  function mockBlogUtils() {
    var base = {
      ROOT: ROOT,
      config: config || {},
      escapeHTML: escapeHTML,
      /* variants（壁纸/视频库）需要真实数据，走后台同一读取链：
         LS 覆盖 → GitHub 远端 → 本地静态兜底，失败按空数据处理 */
      loadDataFile: function (filename) {
        return readDataFile(filename).catch(function () { return null; });
      }
    };
    return new Proxy(base, {
      get: function (t, k) {
        if (k in t) return t[k];
        return function () { return undefined; };
      }
    });
  }

  /* 沙箱执行应用代码并截获 define 对象；语法/注册错误包装后抛出 */
  function probeAppCode(code, expectId) {
    var captured = null;
    var fakeSSB = {
      define: function (d) { captured = d; },
      navGo: function () {}
    };
    var fn;
    try {
      fn = new Function('SSBApps', 'BlogUtils', 'U', '\n' + code + '\n');
    } catch (e) {
      throw new Error('代码语法错误：' + e.message);
    }
    var mu = mockBlogUtils();
    try {
      fn(fakeSSB, mu, mu);
    } catch (e) {
      throw new Error('注册执行失败：' + e.message);
    }
    if (!captured) throw new Error('代码中未调用 SSBApps.define({...})');
    if (!captured.id || typeof captured.id !== 'string') throw new Error('define 缺少合法 id');
    if (expectId && captured.id !== expectId) {
      throw new Error('define 的 id「' + captured.id + '」与应用 id「' + expectId + '」不一致');
    }
    if (typeof captured.render !== 'function') throw new Error('define 缺少 render 函数');
    return captured;
  }

  /* 加载清单 → 逐个隔离探测代码（单个失败只记 loadError，不阻塞其他应用） */
  function loadAdminApps(force) {
    if (adminAppsPromise && !force) return adminAppsPromise;
    adminRegistry = {};
    adminAppsPromise = readDataFile(MANIFEST_PATH)
      .then(function (mf) {
        adminManifest = mf && Array.isArray(mf.apps) ? mf : { apps: [] };
        return Promise.all(adminManifest.apps.map(function (meta) {
          return adminReadAppCode(meta.id)
            .then(function (code) {
              var def;
              try {
                def = probeAppCode(code, meta.id);
              } catch (e) {
                def = { id: meta.id, name: meta.id, configSchema: [], loadError: e.message };
              }
              adminRegistry[meta.id] = {
                id: meta.id,
                name: String(def.name || meta.id),
                desc: String(def.desc || ''),
                hero: def.hero === true,
                kind: def.kind === 'background' ? 'background' : 'app',
                configSchema: Array.isArray(def.configSchema) ? def.configSchema : [],
                variants: typeof def.variants === 'function' ? def.variants : null,
                builtin: meta.builtin === true,
                dataFile: meta.dataFile || '',
                code: code,
                loadError: def.loadError || ''
              };
            })
            .catch(function (err) {
              adminRegistry[meta.id] = {
                id: meta.id, name: meta.id, desc: '', hero: false, configSchema: [],
                builtin: meta.builtin === true, dataFile: meta.dataFile || '',
                code: '', loadError: (err && err.message) || String(err)
              };
            });
        }));
      })
      .then(function () { return { registry: adminRegistry, manifest: adminManifest }; });
    return adminAppsPromise;
  }

  /* ---------- 视图：应用列表 + 编辑器 ---------- */

  function showAppsMsg(text, isErr) {
    var el = $('apps-msg');
    el.className = 'form-msg ' + (isErr ? 'err' : 'ok');
    el.textContent = text || '';
  }

  /* appsData = { manifest, pagesFile, apps:data/pages.json 顶层 apps, data:{数据文件名:JSON} } */
  var appsData = null;
  var appEdit = null;    /* {id, isNew, paramsSig, dataRendered} */

  function loadAppsData() {
    showAppsMsg('');
    $('apps-grid').innerHTML = '<div class="site-loading">加载中…</div>';
    Promise.all([
      loadAdminApps(true),                 /* 强制重读：代码可能被别处改过 */
      readDataFile('data/pages.json')
    ]).then(function (r) {
      var pagesFile = r[1] || {};
      /* 与「页面管理」手中的快照形态保持一致，避免本视图保存时把旧节点写回去；
         无 pages 的陈旧数据由 normalizeV3 回落内置兜底 */
      pagesFile = window.SSBApps.normalizeV3(pagesFile);

      /* 各应用的数据文件（清单里登记了 dataFile 的） */
      var dataFiles = {};
      adminManifest.apps.forEach(function (m) {
        if (m.dataFile) dataFiles[m.dataFile] = 1;
      });
      return Promise.all(Object.keys(dataFiles).map(function (f) {
        return readDataFile(f).then(function (d) { return { f: f, d: d }; });
      })).then(function (list) {
        var data = {};
        list.forEach(function (x) { data[x.f] = x.d; });
        appsData = {
          manifest: adminManifest,
          pagesFile: pagesFile,
          apps: pagesFile.apps || {},
          data: data
        };
        appsLoaded = true;
        showAppsList();
      });
    }).catch(function (err) {
      $('apps-grid').innerHTML =
        '<div class="site-loading">加载失败：' + escapeHTML(err.message) + '</div>';
      showAppsMsg('加载失败：' + err.message, true);
    });
  }

  function showAppsList() {
    $('apps-list-wrap').classList.remove('hidden');
    $('app-edit-wrap').classList.add('hidden');
    appEdit = null;
    var ids = adminManifest.apps.map(function (m) { return m.id; });
    if (!ids.length) {
      $('apps-grid').innerHTML =
        '<div class="site-loading">暂无应用，点右上角「＋ 新建应用」开始</div>';
      return;
    }
    $('apps-grid').innerHTML = ids.map(appCardHTML).join('');
  }

  function appCardHTML(id) {
    var d = adminRegistry[id] || { name: id, desc: '', loadError: '清单存在但注册表缺失' };
    var badges = d.builtin
      ? '<span class="app-badge app-badge-builtin">内置</span>'
      : '<span class="app-badge app-badge-custom">自定义</span>';
    if (d.hero) badges += '<span class="app-badge app-badge-hero">首屏</span>';
    if (d.kind === 'background') badges += '<span class="app-badge app-badge-bg">背景</span>';
    if (d.loadError) badges += '<span class="app-badge app-badge-error">代码异常</span>';
    var extra = '';
    if (d.dataFile) {
      extra += '<div class="app-manage-meta">数据文件：' + escapeHTML(d.dataFile) + '</div>';
    }
    if (d.loadError) {
      extra += '<div class="app-manage-meta" style="color:#e5484d">' +
        escapeHTML(d.loadError) + '</div>';
    }
    return '<div class="app-manage-item' + (d.loadError ? ' is-error' : '') + '">' +
      '<div class="app-manage-head"><b>' + escapeHTML(d.name || id) + '</b>' + badges + '</div>' +
      '<p class="app-manage-desc">' + escapeHTML(d.desc || '') + '</p>' +
      extra +
      '<div class="app-manage-acts">' +
        '<button type="button" class="btn btn-primary" data-act="edit" data-id="' +
        escapeHTML(id) + '">编辑应用</button>' +
      '</div>' +
    '</div>';
  }

  /* ---------- 编辑器：代码 / 参数 / 数据 三个标签页 ---------- */

  function openAppEditor(id) {
    var d = adminRegistry[id];
    if (!d) return;
    appEdit = { id: id, isNew: !!d.isNew, paramsSig: null, dataRendered: null, repoHasCode: false };
    $('apps-list-wrap').classList.add('hidden');
    $('app-edit-wrap').classList.remove('hidden');
    $('btn-ae-delete').classList.toggle('hidden', d.builtin);
    syncRestoreBtn();
    /* 探测仓库中是否存在同文件（决定能否「恢复仓库代码」） */
    fetch(ROOT + window.SSBApps.appsDir + encodeURIComponent(id) + '.js',
          { method: 'GET', cache: 'no-cache' })
      .then(function (res) {
        if (appEdit && appEdit.id === id) {
          appEdit.repoHasCode = res.ok;
          syncRestoreBtn();
        }
      }).catch(function () {});
    $('ae-code').value = d.code || '';
    showAppsMsg('');
    renderAppTabs();
    renderParamsTab(false);
    renderDataTab(adminRegistry[id].dataFile || '');
    switchAppTab('code');
    window.scrollTo(0, 0);
  }

  /* 「恢复仓库代码」：本浏览器对该应用代码有覆盖、
     且仓库里存在同文件时才显示。参数/数据不受此按钮影响 */
  function syncRestoreBtn() {
    if (!appEdit) return;
    var hasLocal = false;
    try {
      hasLocal = localStorage.getItem(window.SSBApps.appCodeKey + appEdit.id) != null;
    } catch (e) {}
    var show = hasLocal && !!appEdit.repoHasCode;
    $('btn-ae-restore').classList.toggle('hidden', !show);
  }

  /* 以编辑器当前代码实时探测 define；代码有问题时回落到上次保存的注册表定义 */
  function editorDef() {
    try {
      return probeAppCode($('ae-code').value, appEdit.id);
    } catch (e) {
      return adminRegistry[appEdit.id];
    }
  }

  function appDataKind(dataFile) {
    /* dataFile 现在带 data/ 目录，取文件名再判断编辑器类型 */
    var base = String(dataFile || '').split('/').pop();
    if (base === 'search-engines.json') return 'engines';
    if (base === 'nav-links.json') return 'nav';
    if (base === 'quotes.json') return 'quotes';
    if (base === 'wallpapers.json') return 'wallpapers';
    if (base === 'bg-videos.json') return 'videos';
    if (base === 'bg-colors.json') return 'colors';
    return dataFile ? 'json' : '';
  }

  /* ============================================================
     站点图标自动匹配（2026-09-25）
     前台（nav / search）不再运行时直连外站 favicon（慢且不可控），
     改在后台保存时为缺图标的条目匹配：
       主源 icon.horse（256px），备源 yandex（16px），
       拿到后统一用 canvas 压成 32×32 WebP，暂存条目 __icon（data:URL）。
     两源对无图标/不存在域名都返回固定占位图，用 SHA-256 识别后放弃，
     该条目前台固定显示首字母徽章；以后每次保存都会自动重试。
     提交时（buildIconDataCommit）__icon 转 assets/icons/sites/<host>.webp
     独立文件上传并从 JSON 剥离，仓库里不留临时字段。
     ============================================================ */
  var ICON_FALLBACK_HASH = {
    /* yandex 空白占位（16×16/70B，2026-09-25 实测，字节稳定）。
       icon.horse 2026-09 起对无图域名改发「按域名首字母生成的灰底字母头像」，
       每个域名字节都不同、哈希失效，改用像素特征判定（见 isHorseLetterPlaceholder） */
    yandex: '9681c0a0a13d8581f202bfaf62e53563ea6d0d6bd8e542b35b6d7c09b0e7b41b'
  };
  var ICON_SOURCES = [
    { name: 'horse', build: function (host) { return 'https://icon.horse/icon/' + host; } },
    { name: 'yandex', build: function (host) { return 'https://favicon.yandex.net/favicon/' + host; } }
  ];

  /* ArrayBuffer → SHA-256 十六进制（crypto.subtle，现代浏览器均支持） */
  function sha256Hex(buf) {
    return crypto.subtle.digest('SHA-256', buf).then(function (digest) {
      return Array.prototype.map.call(new Uint8Array(digest), function (b) {
        return ('00' + b.toString(16)).slice(-2);
      }).join('');
    });
  }

  /* 带超时的 fetch：外站服务不可控，8 秒不回就放弃、换下一个源 */
  function fetchBytes(url) {
    return new Promise(function (resolve, reject) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); reject(new Error('timeout')); }, 8000);
      fetch(url, { signal: ctrl.signal, cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) { reject(new Error('HTTP ' + r.status)); return; }
          r.arrayBuffer().then(function (buf) { clearTimeout(timer); resolve(buf); });
        })
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  /* 图片字节 → 32×32 WebP data URL：
     取合规中间档（16/32/64）：16 太虚，64 用不上——前台导航图标 16px、
     后台行内图标 30px（高倍屏翻倍也仅 32/60，32 源在两档场景清晰度足够），
     图标数量会持续增长，32 能把仓库体积控制在低位。
     用 WebP 而非 PNG：同视觉质量体积小约一半，且支持透明底。
     经 blob:URL 本地解码，字节已由本页持有，canvas 不会被跨域污染 */
  function bytesToIconDataURL(buf) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([buf]));
      var im = new Image();
      im.onload = function () {
        var c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        var g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(im, 0, 0, 32, 32);
        URL.revokeObjectURL(url);
        try { resolve(c.toDataURL('image/webp', 0.9)); } catch (e) { reject(e); }
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode fail')); };
      im.src = url;
    });
  }

  /* 识别 icon.horse 的「灰底首字母」占位图（2026-09 起，无固定字节）。
     实测特征：256×256，背景像素 (226,226,226)，背景覆盖 ≥91%，全图零彩色；
     同期真实图标（notion 白/67%、figma 黑/76%、stripe 彩色）均不满足。
     判定条件刻意全部用「与」，宁可漏判（显示其字母，仍合理）也不误伤真图标 */
  function isHorseLetterPlaceholder(buf) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(new Blob([buf]));
      var im = new Image();
      im.onload = function () {
        var c = document.createElement('canvas');
        c.width = im.naturalWidth;
        c.height = im.naturalHeight;
        var g = c.getContext('2d');
        g.drawImage(im, 0, 0);
        URL.revokeObjectURL(url);
        var d = g.getImageData(0, 0, c.width, c.height).data;
        var cr = d[0], cg = d[1], cb = d[2];
        /* 角像素必须接近 horse 占位的浅灰底 (226,226,226) */
        var grayBg = cr >= 214 && cr <= 238 &&
          Math.abs(cr - cg) <= 4 && Math.abs(cg - cb) <= 4;
        if (!grayBg) { resolve(false); return; }
        var graySum = 0, bgCount = 0, n = d.length / 4;
        for (var i = 0; i < d.length; i += 4) {
          var r = d[i], gg = d[i + 1], b = d[i + 2];
          graySum += (Math.abs(r - gg) + Math.abs(gg - b)) / 2;
          if (Math.abs(r - cr) < 14 && Math.abs(gg - cg) < 14 && Math.abs(b - cb) < 14) bgCount++;
        }
        resolve(graySum / n < 8 && bgCount / n >= 0.88);
      };
      /* 解码失败不当占位处理：交给后续流程（多半也会失败 → 首字母） */
      im.onerror = function () { URL.revokeObjectURL(url); resolve(false); };
      im.src = url;
    });
  }

  /* 为单个域名匹配图标：按源顺序尝试，两源都失败/都是占位 → null（前台走首字母） */
  function matchSiteIcon(host) {
    var chain = Promise.resolve(null);
    ICON_SOURCES.forEach(function (src) {
      chain = chain.then(function (got) {
        if (got) return got;
        return fetchBytes(src.build(host))
          .then(function (buf) {
            if (src.name === 'horse') {
              /* horse 占位按域名动态生成，只能解码后看像素特征 */
              return isHorseLetterPlaceholder(buf).then(function (isPh) {
                return isPh ? null : bytesToIconDataURL(buf);
              });
            }
            /* yandex 占位字节固定，SHA-256 识别 */
            return sha256Hex(buf).then(function (hex) {
              if (hex === ICON_FALLBACK_HASH.yandex) return null; /* 无图占位，放弃 */
              return bytesToIconDataURL(buf);
            });
          })
          .catch(function () { return null; });
      });
    });
    return chain;
  }

  /* 从收集后的数据取全部条目：engines=条目数组；nav=各分类 links 摊平 */
  function iconDataItems(dataOut, kind) {
    if (kind === 'engines') return Array.isArray(dataOut) ? dataOut : [];
    if (kind === 'nav') {
      var items = [];
      (Array.isArray(dataOut) ? dataOut : []).forEach(function (g) {
        (g.links || []).forEach(function (l) { items.push(l); });
      });
      return items;
    }
    return [];
  }

  /* 条目 → hostname（非法/非 http(s) 返回 ''） */
  function itemHost(item) {
    try {
      var u = new URL(String(item.url || '').trim());
      return /^https?:$/.test(u.protocol) ? u.hostname : '';
    } catch (e) { return ''; }
  }

  /* 域名图标是否已在仓库（assets/icons/sites/<host>.webp）：
     相对路径直接探测本地文件即可——本地服务器/线上 dist 都直接服务该目录，
     结果按 host 缓存（一会话内同批条目只探一次）。
     三态：true=存在 / false=不存在 / null=探测失败（调用方退化为只抓新增，绝不盲抓） */
  var iconExistsCache = {};
  function iconExistsInRepo(host) {
    if (host in iconExistsCache) return Promise.resolve(iconExistsCache[host]);
    return fetch(ROOT + 'assets/icons/sites/' + host + '.webp', { cache: 'no-cache' })
      .then(function (res) {
        /* 只认真实图片：404 或兜底 HTML 一律视为不存在 */
        var ok = res.ok && /^image\//.test(res.headers.get('Content-Type') || '');
        iconExistsCache[host] = ok;
        return ok;
      })
      .catch(function () { return null; });   /* 失败不缓存，下次可重试 */
  }

  /* 保存前自动匹配：本地已有图标的跳过；探测失败时只抓本次新增条目。
     匹配到的 dataURL 写入 item.__icon；并发 3 路，避免一次性打满连接数 */
  function autoMatchIcons(dataOut, kind, btn) {
    var items = iconDataItems(dataOut, kind);
    /* 保存前的旧条目（按编辑器打开时的数据文件），探测失败时用作兜底判定 */
    var file = (adminRegistry[appEdit.id] || {}).dataFile;
    var oldURLs = {};
    iconDataItems(appsData.data[file] || [], kind)
      .forEach(function (it) { oldURLs[it.url] = 1; });

    /* 先按 host 去重，逐个探测本地图标存在性 */
    var hosts = {};
    items.forEach(function (it) {
      if (it.__icon) return;
      var host = itemHost(it);
      if (host) hosts[host] = 1;
    });
    var existMap = {};
    return Promise.all(Object.keys(hosts).map(function (host) {
      return iconExistsInRepo(host).then(function (r) { existMap[host] = r; });
    })).then(function () {
      var todo = [];
      var seen = {};
      items.forEach(function (it) {
        if (it.__icon) return;        /* 上次保存已匹配待提交，不重复抓 */
        var host = itemHost(it);
        if (!host || seen[host]) return;
        seen[host] = 1;
        if (existMap[host] === true) return;                     /* 有图标：跳过 */
        if (existMap[host] === null && oldURLs[it.url]) return;  /* 探测失败：老条目不重抓 */
        todo.push({ host: host, item: it });
      });
      if (!todo.length) return;

      var done = 0;
      function runBatch(rest) {
        return Promise.all(rest.slice(0, 3).map(function (job) {
          return matchSiteIcon(job.host).then(function (dataURL) {
            if (dataURL) job.item.__icon = dataURL;
            done++;
            btn.textContent = '匹配图标中 ' + done + '/' + todo.length + '…';
          });
        })).then(function () {
          if (rest.length > 3) return runBatch(rest.slice(3));
        });
      }
      btn.textContent = '匹配图标中 0/' + todo.length + '…';
      return runBatch(todo);
    });
  }

  /* 提交组装：engines/nav 数据里的临时 __icon（data:URL）转独立 WebP 文件，
     JSON 剥离全部 __icon——仓库只保留干净数据，前台按 hostname 找本地图标。
     删除登记（op=del）无需内容：文件删除由勾选行统一处理，返回空文件组 */
  function buildIconDataCommit(path, op, text) {
    var kind = appDataKind(path);
    if (op === 'del' || text == null) return { kind: 'file', path: path, files: [] };
    var data;
    try { data = JSON.parse(text); }
    catch (e) { return { kind: 'file', path: path, files: [{ path: path, content: text }] }; }

    var extraFiles = [];
    var seenIcon = {};
    iconDataItems(data, kind).forEach(function (it) {
      if (typeof it.__icon === 'string' &&
          it.__icon.indexOf('data:image/webp') === 0) {
        /* 图标统一 32×32 WebP，提交路径扩展名固定；同域名只上传一次 */
        var host = itemHost(it);
        if (host && !seenIcon[host]) {
          seenIcon[host] = 1;
          extraFiles.push({
            path: 'assets/icons/sites/' + host + '.webp',
            content: it.__icon.slice(it.__icon.indexOf(',') + 1),
            encoding: 'base64'
          });
        }
      }
      delete it.__icon;
      delete it.__iconHost;
      delete it.__iconManual;
    });

    var cleanJSON = JSON.stringify(data, null, 2) + '\n';
    return {
      kind: 'file',
      path: path,
      files: [{ path: path, content: cleanJSON }].concat(extraFiles)
    };
  }

  /* data/wallpapers.json 提交：行内 __upload dataURL 转 assets/wallpapers/ 下的
     独立文件（base64；上传时已压成 WebP ≤2K，GIF/SVG 直通），
     再从 JSON 剥离——同图标的临时字段处理约定 */
  function buildWallpaperDataCommit(path, op, text) {
    if (op === 'del' || text == null) return { kind: 'file', path: path, files: [] };
    var data;
    try { data = JSON.parse(text); }
    catch (e) { return { kind: 'file', path: path, files: [{ path: path, content: text }] }; }

    var extraFiles = [];
    (data.wallpapers || []).forEach(function (w) {
      if (typeof w.__upload === 'string' && w.__upload.indexOf('data:image/') === 0) {
        var parsed = parseDataURL(w.__upload);
        if (parsed && w.file) {
          extraFiles.push({ path: w.file, content: parsed.b64, encoding: 'base64' });
        }
      }
      delete w.__upload;
    });

    return {
      kind: 'file',
      path: path,
      files: [{ path: path, content: JSON.stringify(data, null, 2) + '\n' }].concat(extraFiles)
    };
  }

  /* data/bg-videos.json 提交：行内 __upload（网页压缩成片 dataURL）
     转 assets/videos/ 下独立 MP4，再剥离 __upload（posterURL 保留供缩略图） */
  function buildVideoDataCommit(path, op, text) {
    if (op === 'del' || text == null) return { kind: 'file', path: path, files: [] };
    var data;
    try { data = JSON.parse(text); }
    catch (e) { return { kind: 'file', path: path, files: [{ path: path, content: text }] }; }

    var extraFiles = [];
    (data.videos || []).forEach(function (v) {
      if (typeof v.__upload === 'string' && v.__upload.indexOf('data:video/') === 0) {
        var parsed = parseDataURL(v.__upload);
        if (parsed && v.file) {
          extraFiles.push({ path: v.file, content: parsed.b64, encoding: 'base64' });
        }
      }
      delete v.__upload;
    });

    return {
      kind: 'file',
      path: path,
      files: [{ path: path, content: JSON.stringify(data, null, 2) + '\n' }].concat(extraFiles)
    };
  }

  /* ============================================================
     数据编辑器行内图标（2026-09-25）
     编辑过程中就能看到每行图标：网址输入停顿 0.8s 自动匹配；
     匹配失败显示首字母、可点「上传」自选图片（压 32×32 WebP）。
     匹配状态按行 DOM 存在 liveIconMap（WeakMap），收集时带进数据，
     保存后由基线 __icon 接管，提交时全部转独立 WebP 并剥离。
       st = {dataURL, host, manual}
       manual=true 用户手动上传：改网址也不自动覆盖
     ============================================================ */
  var liveIconMap = new WeakMap();
  var iconUploadRow = null;

  /* 按视图重绘某行的图标格 */
  function renderRiBox(row, view) {
    var box = row.querySelector('.ri-box');
    if (!box) return;
    box.dataset.state = view.state;
    if (view.state === 'loading') {
      box.innerHTML = '<span class="ri-spinner" aria-label="匹配中"></span>';
    } else if (view.state === 'icon') {
      box.innerHTML = '<img class="ri-img" src="' + escapeHTML(view.dataURL) + '" alt="">';
    } else if (view.state === 'repo') {
      box.innerHTML =
        '<img class="ri-img" src="' + ROOT + 'assets/icons/sites/' + view.host + '.webp" alt="">' +
        '<span class="ri-letter" style="display:none"></span>';
    } else if (view.state === 'letter') {
      box.innerHTML = '<span class="ri-letter">' + escapeHTML(view.text || '?') + '</span>';
    } else { /* empty */
      box.innerHTML = '<span class="ri-letter">?</span>';
    }
  }

  /* 取行内首字母（名称输入变化时联动） */
  function rowLetter(row) {
    var name = (row.querySelector('.r-name') || {}).value || '';
    return name.trim().slice(0, 1) || '?';
  }

  /* 网址变化后的实时匹配（由 input 事件防抖调用）。
     force=true（「重试」按钮）：绕过手动锁定/同 host 跳过/仓库短路，
     强制重新抓取；失败时恢复进入前的旧图标，不无故降级成字母 */
  function liveMatchRow(row, force) {
    var host = itemHost({ url: (row.querySelector('.r-url') || {}).value });
    var st = liveIconMap.get(row);

    if (force) {
      if (!host) { toast('请先填写有效网址', true); return; }
      var prev = st;   /* 旧图快照：行内匹配/手动上传的都记住，失败原样恢复 */
      renderRiBox(row, { state: 'loading' });
      matchSiteIcon(host).then(function (dataURL) {
        if (dataURL) {
          liveIconMap.set(row, { dataURL: dataURL, host: host, manual: false });
          renderRiBox(row, { state: 'icon', dataURL: dataURL });
          return;
        }
        /* 没获取到新图：行内旧图 → 仓库图 → 首字母，逐级恢复而非直接降级 */
        var restore = function () { toast('未获取到新图标，已保留原有图标'); };
        if (prev) {
          liveIconMap.set(row, prev);
          renderRiBox(row, { state: 'icon', dataURL: prev.dataURL });
          restore();
        } else {
          iconExistsInRepo(host).then(function (exists) {
            if (exists) {
              renderRiBox(row, { state: 'repo', host: host });
            } else {
              liveIconMap.delete(row);
              renderRiBox(row, { state: 'letter', text: rowLetter(row) });
            }
            restore();
          });
        }
      });
      return;
    }

    if (st && st.manual) return;                 /* 手动上传：锁定，不覆盖 */
    if (st && st.host === host && host) return;  /* 同 host 已匹配过 */

    if (!host) {
      liveIconMap.delete(row);
      renderRiBox(row, { state: 'empty' });
      return;
    }
    /* 仓库已有该 host 图标 → 直接显示本地路径，不发外站请求 */
    iconExistsInRepo(host).then(function (exists) {
      if (exists) {
        liveIconMap.delete(row);
        renderRiBox(row, { state: 'repo', host: host });
        return;
      }
      renderRiBox(row, { state: 'loading' });
      matchSiteIcon(host).then(function (dataURL) {
        if (dataURL) {
          liveIconMap.set(row, { dataURL: dataURL, host: host, manual: false });
          renderRiBox(row, { state: 'icon', dataURL: dataURL });
        } else {
          liveIconMap.delete(row); /* 失败不缓存：保存时 autoMatchIcons 会再试 */
          renderRiBox(row, { state: 'letter', text: rowLetter(row) });
        }
      });
    });
  }

  /* 手动上传处理（文件读取 + 32×32 压缩 + 行内预览） */
  function handleIconFile(file) {
    var row = iconUploadRow;
    iconUploadRow = null;
    if (!row || !file) return;
    if (!/^image\//.test(file.type)) { toast('请选择图片文件', true); return; }
    renderRiBox(row, { state: 'loading' });
    var reader = new FileReader();
    reader.onload = function () {
      bytesToIconDataURL(reader.result)
        .then(function (dataURL) {
          var host = itemHost({ url: (row.querySelector('.r-url') || {}).value });
          liveIconMap.set(row, { dataURL: dataURL, host: host, manual: true });
          renderRiBox(row, { state: 'icon', dataURL: dataURL });
        })
        .catch(function () {
          renderRiBox(row, { state: 'letter', text: rowLetter(row) });
          toast('图片读取失败，请换 PNG/JPG 试试', true);
        });
    };
    reader.onerror = function () { toast('图片读取失败', true); };
    reader.readAsArrayBuffer(file);
  }

  /* 收集时把行内实时状态（自动匹配/手动上传）复制到数据条目 */
  function attachLiveIcon(item, row) {
    var st = liveIconMap.get(row);
    if (!st) return;
    item.__icon = st.dataURL;
    item.__iconHost = st.host;
    if (st.manual) item.__iconManual = 1;
  }

  /* 收集后按 URL 继承基线（上次保存时的数据）图标：
     未提交前再次保存，已匹配的条目不重抓，省 icon.horse 配额 */
  function carryBaselineIcons(rows, file, kind) {
    var byURL = {};
    iconDataItems(appsData.data[file] || [], kind).forEach(function (it) {
      if (it.__icon) byURL[it.url] = it;
    });
    rows.forEach(function (r) {
      if (r.__icon || !byURL[r.url]) return;
      r.__icon = byURL[r.url].__icon;
      r.__iconHost = byURL[r.url].__iconHost;
      if (byURL[r.url].__iconManual) r.__iconManual = 1;
    });
  }

  function renderAppTabs() {
    var d = editorDef();
    var fileInput = $('ae-datafile');
    var dataFile = fileInput ? fileInput.value.trim() : (d ? (d.dataFile || '') : '');
    var tabs = [{ k: 'code', label: '代码' }];
    if (d && d.configSchema && d.configSchema.length) {
      tabs.push({ k: 'params', label: '参数（' + d.configSchema.length + '）' });
    }
    if (d && appDataKind(dataFile)) tabs.push({ k: 'data', label: '数据' });
    $('ae-tabs').innerHTML = tabs.map(function (t) {
      return '<button type="button" class="ae-tab" data-tab="' + t.k + '">' + t.label + '</button>';
    }).join('');
  }

  function switchAppTab(k) {
    document.querySelectorAll('.ae-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === k);
    });
    document.querySelectorAll('.ae-tabpane').forEach(function (p) {
      p.classList.toggle('hidden', p.dataset.pane !== k);
    });
    if (k === 'params') {
      /* 代码里的 schema 可能刚被改动：键集合变化时重绘并保留同名字段已填值 */
      var def = editorDef();
      var sig = (def && def.configSchema ? def.configSchema : []).map(function (s) {
        return s.key;
      }).join('|');
      if (appEdit.paramsSig === null) {
        renderParamsTab(false);
      } else if (sig !== appEdit.paramsSig) {
        renderParamsTab(true);
      }
      appEdit.paramsSig = sig;
    }
    if (k === 'data') {
      var d = adminRegistry[appEdit.id];
      var fileInput2 = $('ae-datafile');
      var file = fileInput2 ? fileInput2.value.trim() : (d ? (d.dataFile || '') : '');
      /* 数据文件名变化（自定义应用）才重绘数据编辑器，避免切 tab 丢输入 */
      if (file !== appEdit.dataRendered) renderDataTab(file);
    }
  }

  function paramFieldId(key) {
    return 'ae-p-' + String(key).replace(/[^a-zA-Z0-9]/g, '_');
  }

  function schemaFieldHTML(s, val) {
    var fid = paramFieldId(s.key);
    var keyAttr = escapeHTML(s.key);
    var label = escapeHTML(s.label || s.key);
    if (s.type === 'boolean') {
      return '<label class="form-field ae-param-boolean">' +
        '<input type="checkbox" id="' + fid + '" data-key="' + keyAttr + '"' +
        (val === true ? ' checked' : '') + '><span>' + label + '</span></label>';
    }
    if (s.type === 'textarea') {
      return '<label class="form-field"><span>' + label + '</span>' +
        '<textarea id="' + fid + '" rows="3" data-key="' + keyAttr +
        '" autocomplete="off">' + escapeHTML(val == null ? '' : String(val)) + '</textarea></label>';
    }
    if (s.type === 'select') {
      var opts = (s.options || []).map(function (o) {
        return '<option value="' + escapeHTML(o[0]) + '"' +
          (String(val) === String(o[0]) ? ' selected' : '') + '>' + escapeHTML(o[1]) + '</option>';
      }).join('');
      return '<label class="form-field"><span>' + label + '</span>' +
        '<select id="' + fid + '" data-key="' + keyAttr + '">' + opts + '</select></label>';
    }
    if (s.type === 'number') {
      var attrs = '';
      if (s.min != null) attrs += ' min="' + escapeHTML(s.min) + '"';
      if (s.max != null) attrs += ' max="' + escapeHTML(s.max) + '"';
      if (s.step != null) attrs += ' step="' + escapeHTML(s.step) + '"';
      return '<label class="form-field"><span>' + label + '</span>' +
        '<input type="number" id="' + fid + '" data-key="' + keyAttr + '"' + attrs +
        ' value="' + escapeHTML(val == null ? '' : String(val)) + '"></label>';
    }
    return '<label class="form-field"><span>' + label + '</span>' +
      '<input type="text" id="' + fid + '" data-key="' + keyAttr + '" autocomplete="off" value="' +
      escapeHTML(val == null ? '' : String(val)) + '"></label>';
  }

  function renderParamsTab(preserve) {
    var def = editorDef();
    var draft = {};
    if (preserve) {
      document.querySelectorAll('#ae-params [data-key]').forEach(function (el) {
        draft[el.dataset.key] = el.type === 'checkbox' ? el.checked : el.value;
      });
    }
    var globalCfg = appsData.apps[appEdit.id] || {};
    var defaults = def ? window.SSBApps.appDefaults(def) : {};
    var schema = def && def.configSchema ? def.configSchema : [];

    var warning = '';
    try {
      probeAppCode($('ae-code').value, appEdit.id);
    } catch (e) {
      warning = '<div class="form-msg err" style="margin-bottom:12px">当前代码未通过校验，' +
        '下方显示的是上次保存版本的参数结构：' + escapeHTML(e.message) + '</div>';
    }

    var shortFields = [];
    var fullFields = [];
    schema.forEach(function (s) {
      var val;
      if (preserve && Object.prototype.hasOwnProperty.call(draft, s.key)) {
        val = draft[s.key];                       /* 切 tab 重绘：优先保住用户已填值 */
      } else if (window.SSBApps.getPath(globalCfg, s.key) !== undefined) {
        val = window.SSBApps.getPath(globalCfg, s.key);   /* data/pages.json 全局值 */
      } else {
        val = window.SSBApps.getPath(defaults, s.key);   /* schema 默认值 */
      }
      var html = schemaFieldHTML(s, val);
      if (s.type === 'textarea') fullFields.push(html);
      else shortFields.push(html);
    });

    var body = '';
    if (shortFields.length) body += '<div class="form-grid form-grid-2">' + shortFields.join('') + '</div>';
    if (fullFields.length) body += '<div class="form-grid">' + fullFields.join('') + '</div>';
    if (!schema.length) {
      body = '<div class="site-loading">该应用没有声明可调参数（configSchema 为空）</div>';
    }
    $('ae-params').innerHTML = warning + body;
  }

  /* ---------- 壁纸 / 视频数据行 ---------- */

  /* 当前等待接收上传图片的壁纸行（点「上传壁纸」时记下，文件选择回调里用） */
  var wallpaperUploadRow = null;

  /* 明暗基调下拉（壁纸/视频/颜色三类行共用）：
     cls=收集时绑定的 class 名；tone=当前值（''=无，不锁定主题）。
     选项文案统一在此维护，三处不再各拼一份 */
  function toneSelectHTML(cls, tone) {
    return '<select class="' + cls + '">' +
      '<option value=""' + (!tone ? ' selected' : '') + '>无（不锁定主题）</option>' +
      '<option value="light"' + (tone === 'light' ? ' selected' : '') + '>亮（锁定亮色）</option>' +
      '<option value="dark"' + (tone === 'dark' ? ' selected' : '') + '>暗（锁定暗色）</option>' +
    '</select>';
  }

  /* 壁纸行：缩略图 + 名称/明暗/路径 + 上传。
     __upload 是上传图的临时 dataURL（提交时转 assets/wallpapers/ 独立图片并剥离，同图标机制）；
     上传时已压成 WebP（长边≤2560，GIF/SVG 直通）——壁纸是全屏图，不用图标那套 32px 压缩 */
  function wallpaperRowHTML(w) {
    w = w || {};
    var thumbSrc = w.__upload || (w.file ? '../' + w.file : '');
    return '<div class="media-row">' +
      '<div class="media-thumb">' +
        (thumbSrc ? '<img class="m-thumb-img" src="' + escapeHTML(thumbSrc) + '" alt="">'
                  : '<span class="media-empty">无图</span>') +
      '</div>' +
      '<div class="media-fields">' +
        '<label class="form-field"><span>名称</span>' +
          '<input class="m-name" value="' + escapeHTML(w.name || '') + '" placeholder="便于识别的名称"></label>' +
        '<label class="form-field"><span>明暗基调</span>' +
          toneSelectHTML('m-tone', w.tone) + '</label>' +
        '<label class="form-field"><span>文件路径</span>' +
          '<input class="m-file" value="' + escapeHTML(w.file || '') + '" placeholder="assets/wallpapers/xxx.webp"></label>' +
      '</div>' +
      '<div class="media-acts">' +
        '<button type="button" class="btn m-upload">上传壁纸</button>' +
        '<button type="button" class="btn btn-danger m-del" title="移除登记（不会删除图片文件）">×</button>' +
      '</div>' +
      (w.__upload ? '<input type="hidden" class="m-upload-data" value="' + escapeHTML(w.__upload) + '">' : '') +
    '</div>';
  }

  /* 视频行：网页选原片→自动压成 1080p MP4（video-compress.js），
     __upload = 压缩成片 dataURL（提交时转 assets/videos/ 独立文件并剥离）；
     posterURL = 首帧海报；路径未压缩前只登记已放入仓库的文件 */
  function videoRowHTML(v) {
    v = v || {};
    var poster = v.posterURL || '';
    return '<div class="media-row">' +
      '<div class="media-thumb media-thumb-video">' +
        (poster ? '<img class="m-thumb-img" src="' + escapeHTML(poster) + '" alt="">'
                : '<span class="media-empty">视频</span>') +
      '</div>' +
      '<div class="media-fields">' +
        '<label class="form-field"><span>名称</span>' +
          '<input class="m-name" value="' + escapeHTML(v.name || '') + '" placeholder="便于识别的名称"></label>' +
        '<label class="form-field"><span>明暗基调（上传时自动判定）</span>' +
          toneSelectHTML('m-tone', v.tone) + '</label>' +
        '<label class="form-field"><span>文件路径</span>' +
          '<input class="m-file" value="' + escapeHTML(v.file || '') + '" placeholder="assets/videos/xxx.mp4"></label>' +
      '</div>' +
      '<div class="media-acts">' +
        '<button type="button" class="btn v-upload">上传视频</button>' +
        '<button type="button" class="btn btn-danger m-del" title="移除登记（不会删除视频文件）">×</button>' +
        '<span class="v-status"></span>' +
      '</div>' +
      (v.__upload ? '<input type="hidden" class="v-upload-data" value="' + escapeHTML(v.__upload) + '">' : '') +
      (v.posterURL ? '<input type="hidden" class="v-poster-data" value="' + escapeHTML(v.posterURL) + '">' : '') +
    '</div>';
  }

  /* 颜色壁纸行：色块实时预览 + 名称/颜色值/明暗 + 删除。
     value 支持纯色与 CSS 渐变（内联进 style，escapeHTML 会转义引号）；
     特殊值 none = 无背景（前台选它即清空屏背景） */
  function colorRowHTML(c) {
    c = c || {};
    var hasBg = c.value && c.value !== 'none';
    return '<div class="media-row">' +
      '<div class="media-thumb media-thumb-color">' +
        '<span class="color-swatch' + (hasBg ? '"'  : ' color-swatch-none"') +
          (hasBg ? ' style="background:' + escapeHTML(c.value) + '"' : '') + '></span>' +
      '</div>' +
      '<div class="media-fields">' +
        '<label class="form-field"><span>名称</span>' +
          '<input class="c-name" value="' + escapeHTML(c.name || '') + '" placeholder="便于识别的名称"></label>' +
        '<label class="form-field"><span>颜色值 / 渐变（none = 无背景）</span>' +
          '<input class="c-value" value="' + escapeHTML(c.value || '') + '" placeholder="#ffffff 或 linear-gradient(135deg,#74ebd5,#9face6)"></label>' +
        '<label class="form-field"><span>明暗基调</span>' +
          toneSelectHTML('c-tone', c.tone) + '</label>' +
      '</div>' +
      '<div class="media-acts">' +
        '<button type="button" class="btn btn-danger m-del" title="移除该颜色">×</button>' +
      '</div>' +
    '</div>';
  }

  /* 接收选中的壁纸图片：压成 WebP（长边≤2560，GIF/SVG 直通），
     生成 assets/wallpapers/ 下的目标路径并回填行内 */
  function handleWallpaperFile(file) {
    var row = wallpaperUploadRow;
    wallpaperUploadRow = null;
    if (!file || !row) return;
    if (!/^image\//.test(file.type)) { toast('请选择图片文件', true); return; }

    /* 文件名只留英文/数字/点/_-（中文与空格进 URL 麻烦）；清空则用随机名。
       扩展名不看原文件——以转换后 dataURL 的实际类型为准（webp/gif/svg） */
    var raw = String(file.name || '');
    var dot = raw.lastIndexOf('.');
    var stem = (dot > -1 ? raw.slice(0, dot) : raw)
      .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!stem) stem = 'wp-' + rand6();

    fileToWebpDataURL(file, 2560, 0.85).then(function (dataURL) {
      var parsed = parseDataURL(dataURL);
      var ext = '.' + (parsed ? parsed.ext : 'webp');
      var path = 'assets/wallpapers/' + stem + ext;
      /* 与已登记路径撞名（常见：同名文件换图）→ 加随机后缀，避免覆盖旧图 */
      var taken = Array.prototype.map.call(
        document.querySelectorAll('#ae-wallpapers .m-file'),
        function (i) { return i.value.trim(); });
      if (taken.indexOf(path) > -1) {
        path = 'assets/wallpapers/' + stem + '-' + rand6() + ext;
      }

      row.querySelector('.m-file').value = path;
      var hid = row.querySelector('.m-upload-data');
      if (!hid) {
        hid = document.createElement('input');
        hid.type = 'hidden';
        hid.className = 'm-upload-data';
        row.appendChild(hid);
      }
      hid.value = dataURL;
      var thumbImg = document.createElement('img');
      thumbImg.className = 'm-thumb-img';
      thumbImg.alt = '';
      thumbImg.src = dataURL;
      row.querySelector('.media-thumb').innerHTML = '';
      row.querySelector('.media-thumb').appendChild(thumbImg);
    }).catch(function () {
      toast('图片读取失败，请换一张试试', true);
    });
  }

  /* 视频上传：网页压缩 → 回填路径/tone/成片 dataURL/海报（机制同壁纸） */
  var videoUploadRow = null;
  function handleVideoFile(file) {
    var row = videoUploadRow;
    videoUploadRow = null;
    if (!file || !row) return;
    if (!window.SSBVideo || !SSBVideo.supported()) {
      toast('当前浏览器不支持网页压缩，请用新版 Chrome/Edge/Safari', true);
      return;
    }

    var btn = row.querySelector('.v-upload');
    var status = row.querySelector('.v-status');
    btn.disabled = true;
    status.textContent = '压缩中 0%';

    SSBVideo.compress(file, function (p) {
      status.textContent = '压缩中 ' + Math.round(p * 100) + '%';
    }).then(function (r) {
      /* 原文件名只留英文/数字/点/_-，成品统一 mp4 */
      var raw = String(file.name || '');
      var dot = raw.lastIndexOf('.');
      var stem = (dot > -1 ? raw.slice(0, dot) : raw)
        .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!stem) stem = 'vid-' + rand6();
      var path = 'assets/videos/' + stem + '.mp4';
      var taken = Array.prototype.map.call(
        document.querySelectorAll('#ae-videos .m-file'),
        function (i) { return i.closest('.media-row') === row ? null : i.value.trim(); });
      if (taken.indexOf(path) > -1) {
        path = 'assets/videos/' + stem + '-' + rand6() + '.mp4';
      }

      row.querySelector('.m-file').value = path;
      row.querySelector('.m-tone').value = r.tone;

      var ensureHidden = function (cls) {
        var h = row.querySelector('.' + cls);
        if (!h) {
          h = document.createElement('input');
          h.type = 'hidden';
          h.className = cls;
          row.appendChild(h);
        }
        return h;
      };
      ensureHidden('v-upload-data').value = r.dataURL;
      ensureHidden('v-poster-data').value = r.posterURL;

      var thumbBox = row.querySelector('.media-thumb');
      thumbBox.innerHTML = '';
      var img = document.createElement('img');
      img.className = 'm-thumb-img';
      img.alt = '';
      img.src = r.posterURL;
      thumbBox.appendChild(img);

      status.textContent = Math.round(r.blob.size / 1048576) + 'MB 待提交';
    }).catch(function (e) {
      status.textContent = '';
      toast((e && e.message) || String(e), true);
    }).then(function () { btn.disabled = false; });
  }

  function renderDataTab(file) {
    var d = adminRegistry[appEdit.id];
    var kind = appDataKind(file);
    appEdit.dataRendered = file;

    var html = '';
    /* 自定义应用可自行登记数据文件；内置三应用路由锁定，不显示输入框 */
    if (d && !d.builtin) {
      html += '<label class="form-field ae-datafile-row">' +
        '<span>数据文件（仓库根目录下的 JSON 文件名，留空 = 无独立数据；保存后生效）</span>' +
        '<input id="ae-datafile" value="' + escapeHTML(file) + '" placeholder="例如 my-data.json" autocomplete="off">' +
      '</label>';
    }

    if (kind === 'engines') {
      var eng = appsData.data[file];
      var rows = (Array.isArray(eng) && eng.length) ? eng.map(engineRowHTML).join('') : engineRowHTML();
      html += '<p class="section-hint">每行一个引擎，URL 前缀会拼上搜索词，' +
        '例如 https://www.baidu.com/s?wd= ；整行留空保存时忽略。</p>' +
        '<div id="ae-engines">' + rows + '</div>' +
        '<button type="button" class="btn" id="ae-engine-add">＋ 添加搜索引擎</button>';
    } else if (kind === 'nav') {
      var nav = appsData.data[file];
      var groups = (Array.isArray(nav) && nav.length) ? nav.map(navGroupHTML).join('') : navGroupHTML();
      html += '<p class="section-hint">每个分类对应导航的一个标签页；分类名为空或分类下没有链接的整块保存时忽略。</p>' +
        '<div id="ae-nav-groups">' + groups + '</div>' +
        '<button type="button" class="btn" id="ae-nav-add">＋ 添加分类</button>';
    } else if (kind === 'quotes') {
      var q = Array.isArray(appsData.data[file]) ? appsData.data[file] : [];
      html += '<p class="section-hint">每行一条，前台随机取一条展示。</p>' +
        '<textarea id="ae-quotes" rows="12" autocomplete="off">' +
        escapeHTML(q.join('\n')) + '</textarea>';
    } else if (kind === 'wallpapers') {
      var wf = appsData.data[file] || {};
      var wlist = Array.isArray(wf.wallpapers) ? wf.wallpapers : [];
      html += '<p class="section-hint">壁纸上传时自动压成 WebP（长边≤2560，GIF/SVG 原样保留），存入 assets/wallpapers/；' +
        '点「上传壁纸」选择本地图片后路径自动填入。移除条目只清除登记，不会删除仓库里的图片。</p>' +
        '<div id="ae-wallpapers">' + wlist.map(wallpaperRowHTML).join('') + '</div>' +
        '<button type="button" class="btn" id="ae-wallpaper-add">＋ 添加壁纸</button>' +
        '<input type="file" id="ae-wallpaper-file" style="display:none" accept="image/*">';
    } else if (kind === 'videos') {
      var vf = appsData.data[file] || {};
      var vlist = Array.isArray(vf.videos) ? vf.videos : [];
      html += '<p class="section-hint">点「上传视频」选择本地原片（手机 4K 也可），' +
        '网页自动压成 1080p 静音 MP4 并存入 assets/videos/，明暗基调自动判定；' +
        '也可自行放入文件后只登记路径。移除条目只清除登记。</p>' +
        '<div id="ae-videos">' + vlist.map(videoRowHTML).join('') + '</div>' +
        '<button type="button" class="btn" id="ae-video-add">＋ 添加视频</button>' +
        '<input type="file" id="ae-video-file" style="display:none" accept="video/*">';
    } else if (kind === 'colors') {
      var cf = appsData.data[file] || {};
      var clist = Array.isArray(cf.colors) ? cf.colors : [];
      html += '<p class="section-hint">每行一个颜色：纯色填 #ffffff 这类色值，渐变填 linear-gradient(...) 等 CSS 背景写法；' +
        '特殊值 none 表示无背景（建议保留在第一行，作为访客关闭背景的入口）。</p>' +
        '<div id="ae-colors">' + clist.map(colorRowHTML).join('') + '</div>' +
        '<button type="button" class="btn" id="ae-color-add">＋ 添加颜色</button>';
    } else if (kind === 'json') {
      var raw = appsData.data[file];
      html += '<p class="section-hint">该数据文件的 JSON 内容，应用代码内通过 ' +
        '<code>U.loadDataFile("' + escapeHTML(file) + '")</code> 读取。</p>' +
        '<textarea id="ae-json-data" class="code-editor data-editor" spellcheck="false">' +
        escapeHTML(raw == null ? '{}' : JSON.stringify(raw, null, 2)) + '</textarea>';
    } else {
      html += '<div class="site-loading">该应用没有数据文件' +
        (d && !d.builtin ? '；在上方填写文件名并保存后，应用代码即可通过 U.loadDataFile 读取' : '') +
        '</div>';
    }
    $('ae-data').innerHTML = html;
    /* engines/nav：行内「上传」共用的隐藏文件选择框（change 委托统一处理） */
    if (kind === 'engines' || kind === 'nav') {
      $('ae-data').insertAdjacentHTML('beforeend',
        '<input type="file" id="ae-icon-file" style="display:none" ' +
        'accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon">');
    }
  }

  /* ---------- 收集 + 保存 ---------- */

  function collectAppEditor() {
    var id = appEdit.id;
    var code = $('ae-code').value;
    var def;
    try {
      def = probeAppCode(code, id);
    } catch (e) {
      return { error: e.message };
    }

    /* 参数：按当前代码的 configSchema 收集；点路径经 setPath 组装嵌套 */
    var patch = {};
    var errMsg = null;
    (def.configSchema || []).forEach(function (s) {
      if (errMsg) return;
      var el = document.getElementById(paramFieldId(s.key));
      if (!el) return;
      var v;
      if (s.type === 'boolean') {
        v = el.checked;
      } else if (s.type === 'number') {
        var n = parseFloat(el.value);
        if (isNaN(n)) n = s.def !== undefined ? Number(s.def) : 0;
        if ((s.min != null && n < s.min) || (s.max != null && n > s.max)) {
          errMsg = (s.label || s.key) + ' 需要在 ' +
            (s.min != null ? s.min : '…') + ' ~ ' + (s.max != null ? s.max : '…') + ' 之间';
          return;
        }
        v = Math.round(n * 1000) / 1000;
      } else if (s.type === 'select') {
        v = el.value;
      } else {
        v = s.type === 'text' ? el.value.trim() : el.value;
      }
      window.SSBApps.setPath(patch, s.key, v);
    });
    if (errMsg) return { error: errMsg };

    /* 数据文件路由以清单为准：内置锁定，自定义读输入框 */
    var d = adminRegistry[id];
    var dataFile = d && !d.builtin && $('ae-datafile')
      ? $('ae-datafile').value.trim()
      : (d ? (d.dataFile || '') : '');
    if (dataFile && !/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*\.json$/.test(dataFile)) {
      return { error: '数据文件名需形如 my-data.json（英文/数字/-/_，可含子目录）' };
    }

    var dataOut = null;
    var kind = appDataKind(dataFile);
    if (kind === 'engines') {
      var eng = collectPairs($('ae-engines'), '搜索引擎', attachLiveIcon);
      if (eng.bad) return { error: eng.bad };
      carryBaselineIcons(eng.rows, dataFile, kind);
      dataOut = eng.rows;
    } else if (kind === 'nav') {
      var nav = [];
      var navBad = null;
      document.querySelectorAll('#ae-nav-groups .nav-group').forEach(function (grp) {
        var cat = ((grp.querySelector('.g-name') || {}).value || '').trim();
        var links = collectPairs(grp.querySelector('.nav-link-rows'), '导航链接', attachLiveIcon);
        if (links.bad) navBad = links.bad;
        if (!cat || !links.rows.length) return;
        nav.push({ category: cat, links: links.rows });
      });
      if (navBad) return { error: navBad };
      /* 基线继承跨全部分类按 URL 匹配（用户可能移动过链接的分类） */
      var navAll = [];
      nav.forEach(function (g) { g.links.forEach(function (l) { navAll.push(l); }); });
      carryBaselineIcons(navAll, dataFile, kind);
      dataOut = nav;
    } else if (kind === 'quotes') {
      dataOut = $('ae-quotes').value.split('\n')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
    } else if (kind === 'wallpapers') {
      var wps = [];
      var wErr = null;
      document.querySelectorAll('#ae-wallpapers .media-row').forEach(function (row) {
        var file = (row.querySelector('.m-file') || {}).value || '';
        file = file.trim();
        if (!file) return;   /* 整行没路径视为空行忽略（名称/明暗随之丢弃） */
        var up = row.querySelector('.m-upload-data');
        if (up && up.value && up.value.indexOf('data:') !== 0) wErr = '壁纸上传数据损坏，请重新上传';
        var wTone = (row.querySelector('.m-tone') || {}).value;
        wps.push({
          file: file,
          name: (row.querySelector('.m-name') || {}).value || '',
          tone: wTone === 'light' || wTone === 'dark' ? wTone : '',
          __upload: up ? up.value : undefined
        });
      });
      if (wErr) return { error: wErr };
      /* 保留 _comment 等表外字段：基于快照浅拷贝，只覆盖 wallpapers 数组 */
      dataOut = Object.assign({}, appsData.data[dataFile] || {}, { wallpapers: wps });
    } else if (kind === 'videos') {
      var vds = [];
      var vErr = null;
      document.querySelectorAll('#ae-videos .media-row').forEach(function (row) {
        var file = ((row.querySelector('.m-file') || {}).value || '').trim();
        if (!file) return;   /* 整行没路径视为空行忽略 */
        var vup = row.querySelector('.v-upload-data');
        if (vup && vup.value && vup.value.indexOf('data:video/') !== 0) {
          vErr = '视频上传数据损坏，请重新上传';
        }
        var vposter = row.querySelector('.v-poster-data');
        var vTone = (row.querySelector('.m-tone') || {}).value;
        var item = {
          file: file,
          name: (row.querySelector('.m-name') || {}).value || '',
          tone: vTone === 'light' || vTone === 'dark' ? vTone : ''
        };
        if (vup && vup.value) item.__upload = vup.value;
        if (vposter && vposter.value) item.posterURL = vposter.value;
        vds.push(item);
      });
      if (vErr) return { error: vErr };
      /* 保留 _comment 等表外字段：基于快照浅拷贝，只覆盖 videos 数组 */
      dataOut = Object.assign({}, appsData.data[dataFile] || {}, { videos: vds });
    } else if (kind === 'colors') {
      var cls = [];
      document.querySelectorAll('#ae-colors .media-row').forEach(function (row) {
        var val = ((row.querySelector('.c-value') || {}).value || '').trim();
        if (!val) return;   /* 没填颜色值的行视为空行忽略 */
        var tone = (row.querySelector('.c-tone') || {}).value;
        cls.push({
          value: val,
          name: ((row.querySelector('.c-name') || {}).value || '').trim(),
          tone: tone === 'light' || tone === 'dark' ? tone : ''
        });
      });
      /* 保留 _comment 等表外字段：基于快照浅拷贝，只覆盖 colors 数组 */
      dataOut = Object.assign({}, appsData.data[dataFile] || {}, { colors: cls });
    } else if (kind === 'json') {
      var txt = $('ae-json-data').value.trim();
      if (!txt) return { error: '数据内容不能为空；不需要数据文件请清空上方文件名' };
      try {
        dataOut = JSON.parse(txt);
      } catch (e) {
        return { error: '数据不是合法 JSON：' + e.message };
      }
    }

    return { def: def, code: code, patch: patch, dataFile: dataFile, dataOut: dataOut };
  }

  /* 仓库提交路径 → localStorage 键（与前台 apps.js / common.js 约定一致） */
  function localAppKey(path) {
    if (path === MANIFEST_PATH) return LS_APP_PREFIX + 'applications/applications';
    if (path === 'data/pages.json') return LS_APP_PREFIX + 'pages';
    if (path === SITE_CONFIG_FILE) return LS_SITE_KEY;
    if (path.indexOf(window.SSBApps.appsDir) === 0 && /\.js$/.test(path)) {
      return window.SSBApps.appCodeKey +
        path.slice(window.SSBApps.appsDir.length).replace(/\.js$/, '');
    }
    /* 数据文件统一取文件名做 LS 键（data/ 目录不进键名） */
    return LS_APP_PREFIX + path.split('/').pop().replace(/\.json$/, '');
  }

  function saveAppEditor() {
    if (!appEdit || !appsData) return;
    var c = collectAppEditor();
    if (c.error) { showAppsMsg(c.error, true); return; }

    /* engines/nav 保存前先自动匹配站点图标（异步，按钮显示进度），
       匹配结果写在 c.dataOut 条目上，随后统一进保存流程 */
    var preKind = appDataKind(c.dataFile);
    if (preKind === 'engines' || preKind === 'nav') {
      var preBtn = $('btn-ae-save');
      preBtn.disabled = true;
      showAppsMsg('');
      autoMatchIcons(c.dataOut, preKind, preBtn).then(function () {
        finishSaveAppEditor(c);
      }).catch(function () {
        preBtn.disabled = false;
        preBtn.textContent = '保存';
      });
      return;
    }
    finishSaveAppEditor(c);
  }

  function finishSaveAppEditor(c) {
    var id = appEdit.id;
    var files = [];

    /* 1. 应用代码（与已存原文相同则跳过；新应用必交） */
    var oldReg = adminRegistry[id] || {};
    if (appEdit.isNew || c.code !== oldReg.code) {
      files.push({ path: window.SSBApps.appsDir + id + '.js', content: c.code });
    }

    /* 2. 清单：新应用登记；自定义应用 dataFile 变化（内置路由锁定不动） */
    var mf = JSON.parse(JSON.stringify(adminManifest));
    var meta = mf.apps.filter(function (m) { return m.id === id; })[0];
    if (!meta) {
      meta = { id: id, builtin: false };
      if (c.dataFile) meta.dataFile = c.dataFile;
      mf.apps.push(meta);
    } else if (!meta.builtin && (meta.dataFile || '') !== c.dataFile) {
      if (c.dataFile) meta.dataFile = c.dataFile;
      else delete meta.dataFile;
    }
    if (JSON.stringify(mf) !== JSON.stringify(adminManifest)) {
      files.push({ path: MANIFEST_PATH, content: JSON.stringify(mf, null, 2) + '\n' });
    }

    /* 3. data/pages.json：schema 参数合入顶层 apps[id]，保留表外键与 pages 数组。
       无参应用（壁纸/公告等）patch 为空，不写空配置节点污染 pages.json */
    var pf = JSON.parse(JSON.stringify(appsData.pagesFile || {}));
    pf.apps = pf.apps || {};
    if (Object.keys(c.patch).length) {
      pf.apps[id] = Object.assign({}, pf.apps[id] || {}, c.patch);
    }
    if (JSON.stringify(pf) !== JSON.stringify(appsData.pagesFile || {})) {
      files.push({ path: 'data/pages.json', content: JSON.stringify(pf, null, 2) + '\n' });
    }

    /* 4. 数据文件（与现值相同则跳过） */
    if (c.dataFile && c.dataOut !== null) {
      if (JSON.stringify(appsData.data[c.dataFile] || null) !== JSON.stringify(c.dataOut)) {
        files.push({ path: c.dataFile, content: JSON.stringify(c.dataOut, null, 2) + '\n' });
      }
    }

    if (!files.length) { showAppsMsg('没有检测到改动', false); return; }

    var btn = $('btn-ae-save');
    btn.disabled = true;
    btn.textContent = '保存中…';
    showAppsMsg('');

    function done() {
      /* 内存状态就地更新，无需整页重拉 */
      adminManifest = mf;
      adminRegistry[id] = {
        id: id,
        name: String(c.def.name || id),
        desc: String(c.def.desc || ''),
        hero: c.def.hero === true,
        kind: c.def.kind === 'background' ? 'background' : 'app',
        configSchema: Array.isArray(c.def.configSchema) ? c.def.configSchema : [],
        variants: typeof c.def.variants === 'function' ? c.def.variants : null,
        builtin: meta.builtin === true,
        dataFile: c.dataFile,
        code: c.code,
        loadError: ''
      };
      appsData.manifest = adminManifest;
      appsData.pagesFile = pf;
      appsData.apps = pf.apps || {};
      if (c.dataFile) appsData.data[c.dataFile] = c.dataOut;
      appEdit.isNew = false;
      appEdit.paramsSig = null;
      appEdit.dataRendered = c.dataFile;

      btn.disabled = false;
      btn.textContent = '保存';
      $('btn-ae-delete').classList.toggle('hidden', meta.builtin === true);
      syncRestoreBtn();
      renderAppTabs();
      renderParamsTab(false);
      if (appEdit.dataRendered !== c.dataFile) renderDataTab(c.dataFile);
      var activeTab = document.querySelector('.ae-tab.active');
      switchAppTab(activeTab ? activeTab.dataset.tab : 'code');
      showAppsMsg('已保存 ' + files.length + ' 个文件，刷新前台即可看到效果', false);
      toast('应用已保存');
    }

    try {
      files.forEach(function (f) {
        localStorage.setItem(localAppKey(f.path), f.content);
        /* 登记到待提交区（渲染时会与仓库版对比，无差异自动剔除） */
        pendingMark(f.path, appPendingTitle(f.path, id), pendingGroup(f.path));
      });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '保存';
      showAppsMsg('保存失败：浏览器 localStorage 空间不足', true);
      return;
    }
    commitLoaded = false;
    done();
  }

  /* ---------- 删除自定义应用 / 恢复仓库代码 ---------- */

  function deleteCustomApp() {
    if (!appEdit) return;
    var id = appEdit.id;
    var d = adminRegistry[id];
    if (!d || d.builtin) return;

    /* 提示仍在使用该应用的页面（删除后这些位置显示「未加载」占位） */
    var used = [];
    (((appsData.pagesFile || {}).pages) || []).forEach(function (p) {
      (p.screens || []).forEach(function (sc) {
        (sc.boxes || []).forEach(function (b) {
          (b.apps || []).forEach(function (a) {
            if (a.id === id) used.push(p.title || p.id);
          });
        });
      });
    });
    var msg = '确定删除自定义应用「' + (d.name || id) + '」？\n' +
      '将从清单移除并删除代码文件 applications/' + id + '.js。';
    if (used.length) {
      msg += '\n\n以下页面仍挂载该应用：' + used.join('、') +
        '，删除后这些位置会显示「未加载」占位，请到「页面管理」移除。';
    }
    msg += '\n全局参数与数据文件内容保留在原处，不会一起删除。';
    if (!confirm(msg)) return;

    var mf = JSON.parse(JSON.stringify(adminManifest));
    mf.apps = mf.apps.filter(function (m) { return m.id !== id; });
    var files = [];
    if (JSON.stringify(mf) !== JSON.stringify(adminManifest)) {
      files.push({ path: MANIFEST_PATH, content: JSON.stringify(mf, null, 2) + '\n' });
    }

    function done() {
      adminManifest = mf;
      appsData.manifest = adminManifest;
      delete adminRegistry[id];
      showAppsMsg('应用「' + id + '」已删除', false);
      toast('应用已删除');
      showAppsList();
    }

    try {
      files.forEach(function (f) {
        localStorage.setItem(localAppKey(f.path), f.content);
        /* 清单改动登记待提交；代码文件删除另存到 deletes 待提交区 */
        pendingMark(f.path, '应用清单', pendingGroup(f.path));
      });
      localStorage.removeItem(window.SSBApps.appCodeKey + id);
      pendingDelete(window.SSBApps.appsDir + id + '.js',
                    '应用代码 ' + id, '应用代码');
    } catch (e) {
      showAppsMsg('删除失败：localStorage 写入异常', true);
      return;
    }
    commitLoaded = false;
    done();
  }

  /* 丢弃本浏览器中对应用代码的修改，恢复为仓库文件（不触碰参数/数据） */
  function discardAppCode() {
    if (!appEdit) return;
    var id = appEdit.id;
    var d = adminRegistry[id];
    if (!d) return;
    if (!confirm('丢弃本浏览器中对应用「' + (d.name || id) + '」代码的修改，\n' +
                 '恢复为仓库文件 applications/' + id + '.js？\n参数与数据不受影响。')) return;

    fetch(ROOT + window.SSBApps.appsDir + encodeURIComponent(id) + '.js',
          { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('仓库中没有该文件（尚未提交的新应用无法恢复，请直接删除）');
        return res.text();
      })
      .then(function (code) {
        var def;
        try {
          def = probeAppCode(code, id);
        } catch (e) {
          showAppsMsg('仓库代码校验失败：' + e.message, true);
          return;
        }
        try { localStorage.removeItem(window.SSBApps.appCodeKey + id); } catch (e) {}
        pendingForget(window.SSBApps.appsDir + id + '.js');
        adminRegistry[id] = {
          id: id,
          name: String(def.name || id),
          desc: String(def.desc || ''),
          hero: def.hero === true,
          configSchema: Array.isArray(def.configSchema) ? def.configSchema : [],
          builtin: d.builtin === true,
          dataFile: d.dataFile || '',
          code: code,
          loadError: ''
        };
        $('ae-code').value = code;
        appEdit.paramsSig = null;
        appEdit.dataRendered = d.dataFile || '';
        renderAppTabs();
        renderParamsTab(false);
        switchAppTab('code');
        syncRestoreBtn();
        commitLoaded = false;
        showAppsMsg('已丢弃本地修改，恢复为仓库代码，刷新前台即生效', false);
        toast('已恢复仓库代码');
      })
      .catch(function (err) {
        showAppsMsg(err.message, true);
      });
  }

  /* ---------- 新建应用 ---------- */

  function newAppTemplate(id, name) {
    return '' +
'/* ============================================================\n' +
'   SSB 自定义应用：' + name + '（' + id + '）\n' +
'   ------------------------------------------------------------\n' +
'   render(mount, ctx)：ctx.cfg 是三层合并后的参数（schema 默认 ∪\n' +
'   data/pages.json 全局 ∪ 板块实例 cfg）；ctx.inst 是板块实例。\n' +
'   返回 false = 无内容（自动隐藏壳）；也可返回 Promise 或销毁函数。\n' +
'   U = BlogUtils：U.escapeHTML / U.config / U.loadDataFile 等。\n' +
'   需要独立数据时，保存后在「数据」标签里登记一个 .json 文件名。\n' +
'   ============================================================ */\n' +
"SSBApps.define({\n" +
"  id: '" + id + "',\n" +
"  name: '" + name.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "',\n" +
"  desc: '',\n" +
"  hero: false,                 /* true = 首屏居中类（如搜索/导航） */\n" +
"  configSchema: [\n" +
"    // { key: 'title', label: '标题', type: 'text', def: '你好' }\n" +
"    // type 支持 text / textarea / number / select / boolean\n" +
"  ],\n" +
"  css: `\n" +
".my-app {\n" +
"  font-size: 16px;\n" +
"  color: var(--text-2);\n" +
"}\n" +
"`,\n" +
"  render: function (mount, ctx) {\n" +
"    mount.innerHTML = '<div class=\"my-app\">' +\n" +
"      U.escapeHTML(ctx.cfg.title || '我的新应用') + '</div>';\n" +
"  }\n" +
"});\n";
  }

  function createApp() {
    if (!appsData) { showAppsMsg('数据尚未加载完成', true); return; }
    var id = prompt('新应用 id（小写英文/数字/-/_），将作为 applications/<id>.js 文件名：');
    if (id == null) return;
    id = id.trim().toLowerCase();
    if (!APP_ID_RE.test(id)) {
      alert('id 只能包含小写英文、数字、-、_');
      return;
    }
    if (adminRegistry[id] || adminManifest.apps.some(function (m) { return m.id === id; })) {
      alert('已存在 id「' + id + '」');
      return;
    }
    var name = prompt('应用显示名称（可留空，默认同 id）：', id);
    if (name == null) return;
    name = name.trim() || id;

    var code = newAppTemplate(id, name);
    try {
      probeAppCode(code, id);
    } catch (e) {
      alert('模板代码异常：' + e.message);
      return;
    }
    /* 先入注册表（isNew 标记），保存时才真正落清单与代码文件 */
    adminRegistry[id] = {
      id: id, name: name, desc: '', hero: false, configSchema: [],
      builtin: false, dataFile: '', code: code, loadError: '', isNew: true
    };
    openAppEditor(id);
    showAppsMsg('新应用草稿已生成，修改后点「保存」正式创建', false);
  }

  /* ============================================================
     提交管理
     ------------------------------------------------------------
     所有保存点同时把仓库路径登记到 ssb.local.pending 暂存区；
     打开面板时逐条与仓库最新版本对比，无差异自动剔除。
     用户勾选条目 → 组装文件（文章/页面的内嵌图片会抽出上传、
     自动套用线上模板）→ commitFiles 一次提交 → 清理本地覆盖。
     ============================================================ */

  var PENDING_KEY = 'ssb.local.pending';
  var commitLoaded = false;
  var commitRows = [];        /* 修剪后：{path, title, group, op, size} */
  var commitBase = {};        /* path -> 仓库基线文本（null = 仓库中不存在） */

  var CM_GROUP_ORDER = ['应用代码', '应用清单与数据', '页面结构', '站点配置', '文章'];

  function pendingStore() {
    try {
      var s = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
      if (!s || typeof s !== 'object') return { files: {}, deletes: [] };
      if (!s.files) s.files = {};
      if (!Array.isArray(s.deletes)) s.deletes = [];
      return s;
    } catch (e) {
      return { files: {}, deletes: [] };
    }
  }
  function pendingSave(s) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(s)); } catch (e) {}
    updateLsUsage();
  }
  /* 登记一个「新增/修改」待提交项 */
  function pendingMark(path, title, group) {
    var s = pendingStore();
    s.files[path] = { ts: Date.now(), title: title || '', group: group || pendingGroup(path) };
    pendingSave(s);
  }
  /* 登记一个「删除」待提交项 */
  function pendingDelete(path, title, group) {
    var s = pendingStore();
    delete s.files[path];
    if (!s.deletes.some(function (d) { return d.path === path; })) {
      s.deletes.push({ path: path, title: title || '', group: group || pendingGroup(path), ts: Date.now() });
    }
    pendingSave(s);
  }
  /* 撤销某个路径的全部待提交登记 */
  function pendingForget(path) {
    var s = pendingStore();
    delete s.files[path];
    s.deletes = s.deletes.filter(function (d) { return d.path !== path; });
    pendingSave(s);
  }
  /* 按路径谓词批量清除（恢复仓库默认时用） */
  function pendingClear(filterFn) {
    var s = pendingStore();
    Object.keys(s.files).forEach(function (p) {
      if (filterFn(p)) delete s.files[p];
    });
    s.deletes = s.deletes.filter(function (d) { return !filterFn(d.path); });
    pendingSave(s);
  }

  function pendingGroup(path) {
    if (/^applications\/.+\.js$/.test(path)) return '应用代码';
    if (path === 'data/pages.json') return '页面结构';
    if (path === 'site-config.json') return '站点配置';
    if (path === 'data/posts-list.json' || /^posts\//.test(path)) return '文章';
    return '应用清单与数据';
  }
  function appPendingTitle(path, appId) {
    if (/\.js$/.test(path)) return '应用代码：' + appId;
    if (path === MANIFEST_PATH) return '应用清单 applications.json';
    if (path === 'data/pages.json') return '页面结构（含应用全局参数）';
    return '应用数据：' + path;
  }
  function isAppJsPath(p) { return /^applications\/.+\.js$/.test(p); }
  function isPostHtmlPath(p) { return /^posts\/.+\.html$/.test(p); }

  /* 读取某路径在本地的覆盖内容（文本）；不存在返回 null。
     JSON 做归一化，保证与仓库版可比 */
  function pendingLocalText(path) {
    try {
      if (path === 'data/posts-list.json') {
        return localStorage.getItem(LS_LIST_KEY);
      }
      if (isPostHtmlPath(path)) {
        return localStorage.getItem(LS_CONTENT_KEY + path.slice('posts/'.length));
      }
      var raw = localStorage.getItem(localAppKey(path));
      if (raw == null) return null;
      if (/\.json$/.test(path)) {
        try { return JSON.stringify(JSON.parse(raw)); } catch (e) { return raw; }
      }
      return raw;
    } catch (e) {
      return null;
    }
  }

  function jsonSame(a, b) {
    try {
      return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
    } catch (e) {
      return a === b;
    }
  }

  function fmtSize(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function showCommitMsg(msg, isErr) {
    var el = $('cm-msg');
    if (!el) return;
    el.className = 'form-msg ' + (isErr ? 'err' : 'ok');
    el.textContent = msg || '';
  }

  /* ---------- 面板加载：拉仓库基线 → 修剪 → 分组渲染 ---------- */

  function loadCommitPanel() {
    var wrap = $('cm-groups');
    wrap.innerHTML = '<div class="site-loading">正在对比本地改动与仓库版本…</div>';
    showCommitMsg('');

    var rp = repoParts();
    var repoConfigured = !!(rp.owner && rp.name && config.repo !== 'your-name/your-repo');
    $('cm-repo-warn').classList.toggle('hidden', repoConfigured);

    var store = pendingStore();
    var markPaths = Object.keys(store.files);
    var delItems = store.deletes.slice();

    var allPaths = markPaths.concat(delItems.map(function (d) { return d.path; }));
    Promise.all(allPaths.map(function (p) {
      return readRepoFile(p).then(function (f) {
        var text = f ? f.text : null;
        /* JSON 基线同样归一化 */
        if (text != null && /\.json$/.test(p)) {
          try { text = JSON.stringify(JSON.parse(text)); } catch (e) {}
        }
        return [p, text];
      });
    })).then(function (results) {
      commitBase = {};
      results.forEach(function (r) { commitBase[r[0]] = r[1]; });

      /* 修剪：本地覆盖已消失 / 与仓库版无差异 / 仓库已无待删文件 */
      var keptFiles = {};
      var rows = [];
      markPaths.forEach(function (p) {
        var local = pendingLocalText(p);
        var base = commitBase[p];
        var keep;
        if (isPostHtmlPath(p)) {
          keep = local != null;                 /* 本地文章：内容存在即为待提交 */
        } else if (local == null) {
          keep = false;
        } else if (base == null) {
          keep = true;                          /* 仓库没有 → 新增 */
        } else if (p === 'data/posts-list.json') {
          keep = (readLocalList().length > 0);
        } else if (/\.json$/.test(p)) {
          keep = !jsonSame(local, base);
        } else {
          keep = local !== base;
        }
        if (keep) {
          keptFiles[p] = store.files[p];
          rows.push({
            path: p,
            title: store.files[p].title || p,
            group: store.files[p].group || pendingGroup(p),
            op: base == null ? 'add' : 'mod',
            size: isPostHtmlPath(p) ? null : (local == null ? null : local.length)
          });
        }
      });

      var keptDeletes = [];
      delItems.forEach(function (d) {
        /* 仓库里已不存在该文件 → 无需再删 */
        if (commitBase[d.path] == null) return;
        keptDeletes.push(d);
        rows.push({
          path: d.path, title: d.title || d.path,
          group: d.group || pendingGroup(d.path), op: 'del', size: null
        });
      });

      /* 写回修剪后的暂存区 */
      var pruned = { files: keptFiles, deletes: keptDeletes };
      pendingSave(pruned);

      commitRows = rows;
      commitLoaded = true;
      renderCommitPanel(rows);
    }).catch(function (err) {
      wrap.innerHTML = '';
      showCommitMsg('改动检测失败：' + err.message, true);
    });
  }

  function renderCommitPanel(rows) {
    /* 侧边栏角标 */
    var nav = $('nav-commit');
    if (nav) {
      var badge = nav.querySelector('.nav-cm-count');
      if (rows.length) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'nav-cm-count';
          nav.appendChild(badge);
        }
        badge.textContent = rows.length;
      } else if (badge) {
        badge.remove();
      }
    }

    var wrap = $('cm-groups');
    if (!rows.length) {
      wrap.innerHTML =
        '<div class="card cm-empty">本浏览器中暂无待提交改动。<br>' +
        '写文章、改应用或改配置并保存后，改动会出现在这里。</div>';
      return;
    }

    var groups = {};
    rows.forEach(function (r) {
      groups[r.group] = groups[r.group] || [];
      groups[r.group].push(r);
    });

    wrap.innerHTML = CM_GROUP_ORDER.filter(function (g) {
      return groups[g] && groups[g].length;
    }).map(function (g) {
      var body = groups[g].map(function (r) {
        var badgeClass = r.op === 'add' ? 'cm-badge-add'
          : r.op === 'del' ? 'cm-badge-del' : 'cm-badge-mod';
        var badgeText = r.op === 'add' ? '新增' : r.op === 'del' ? '删除' : '修改';
        var sizeNote = isPostHtmlPath(r.path)
          ? '<span class="cm-size">提交时自动套用文章模板并上传内嵌图片</span>'
          : '<span class="cm-size">' + fmtSize(r.size) + '</span>';
        return '<div class="cm-row">' +
          '<label class="cm-row-main">' +
            '<input type="checkbox" class="cm-check" data-path="' +
              escapeHTML(r.path) + '" data-op="' + r.op + '" checked>' +
            '<span class="cm-badge ' + badgeClass + '">' + badgeText + '</span>' +
            '<code class="cm-path">' + escapeHTML(r.path) + '</code>' +
            '<span class="cm-title">' + escapeHTML(r.title) + '</span>' +
            sizeNote +
          '</label>' +
          '<details class="cm-diff" data-path="' + escapeHTML(r.path) +
            '" data-op="' + r.op + '">' +
            '<summary>查看差异</summary><div class="cm-diff-body cm-diff-pending">' +
            '点击展开后加载…</div></details>' +
        '</div>';
      }).join('');
      return '<div class="card cm-group">' +
        '<div class="cm-group-head">' +
          '<label><input type="checkbox" class="cm-group-all" checked> ' +
          '<b>' + g + '</b></label>' +
          '<span class="cm-group-count">' + groups[g].length + ' 项</span>' +
        '</div>' +
        '<div class="cm-rows">' + body + '</div>' +
      '</div>';
    }).join('');
  }

  /* 差异区懒加载（toggle 事件不冒泡，用 summary 点击委托） */
  function loadCommitDiff(detailsEl) {
    var body = detailsEl.querySelector('.cm-diff-body');
    if (!body.classList.contains('cm-diff-pending')) return;
    body.classList.remove('cm-diff-pending');
    var p = detailsEl.dataset.path;
    var op = detailsEl.dataset.op;
    var base = commitBase[p];

    function pane(title, text, mono) {
      return '<div class="cm-diff-pane"><div class="cm-diff-pane-title">' + title + '</div>' +
        '<pre>' + escapeHTML(text == null ? '（无）' : text) + '</pre></div>';
    }

    if (isPostHtmlPath(p)) {
      var local = pendingLocalText(p);
      body.innerHTML =
        '<div class="cm-diff-note">本地文章为富文本片段，提交时自动抽取 dataURL 图片为 ' +
        'assets/images/ 下的独立文件，并套用与线上文章一致的 HTML 模板。</div>' +
        pane('本地正文片段（' + fmtSize(local ? local.length : null) + '）', local, true);
      return;
    }

    var localText = pendingLocalText(p);
    var prettyLocal = localText;
    var prettyBase = base;
    if (/\.json$/.test(p)) {
      try { prettyLocal = JSON.stringify(JSON.parse(localText), null, 2); } catch (e) {}
      try { prettyBase = JSON.stringify(JSON.parse(base), null, 2); } catch (e) {}
    }
    if (op === 'del') {
      body.innerHTML = pane('提交后将从仓库删除（以下为仓库当前内容）', prettyBase, true);
    } else if (base == null) {
      body.innerHTML = pane('仓库中尚无此文件，提交后新增', prettyLocal, true);
    } else {
      body.innerHTML = '<div class="cm-diff-cols">' +
        pane('仓库版本', prettyBase, true) +
        pane('本地版本', prettyLocal, true) + '</div>';
    }
  }

  /* ---------- 提交内容组装 ---------- */

  /* 干净的列表条目（去掉 local 等本地标志） */
  function cleanPostEntry(p, cover) {
    return {
      title: p.title, date: p.date, updated: p.updated,
      file: p.file, summary: p.summary || '', category: p.category || '',
      cover: cover != null ? cover : (p.cover || '')
    };
  }

  /* 提交用文章列表：仓库基线 + 仅本次勾选的本地文章。
     未勾选的本地文章绝不能写进线上列表（其 HTML 尚未提交，会造成 404），
     它们继续留在本地列表里 */
  function buildCommittedPostList(selectedEntries) {
    var base = [];
    if (commitBase['data/posts-list.json']) {
      try { base = JSON.parse(commitBase['data/posts-list.json']); } catch (e) {}
    }
    var selMap = {};
    selectedEntries.forEach(function (e) { selMap[e.file] = e; });
    var out = base.filter(function (p) { return !selMap[p.file]; })
      .concat(selectedEntries);
    return out.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
  }

  /* 单篇本地文章 → 提交文件（HTML + 抽出的图片 blob），
     提交时把本地条目组装为线上形态；返回 Promise<{files, entry}> */
  function buildPostCommit(file) {
    var item = readLocalList().filter(function (p) { return p.file === file; })[0];
    var rawContent = localStorage.getItem(LS_CONTENT_KEY + file) || '';
    var doc = new DOMParser().parseFromString(rawContent, 'text/html');
    var imgs = Array.prototype.slice.call(doc.querySelectorAll('img')).filter(function (img) {
      return /^data:image\//.test(img.src);
    });

    var files = [];
    var uploadMap = {};
    var ym = (item.date || todayStr()).slice(0, 7).replace('-', '/');
    var slug = file.replace(/\.html$/, '');

    imgs.forEach(function (img) {
      if (uploadMap[img.src]) return;
      var parsed = parseDataURL(img.src);
      if (!parsed) return;
      var repoPath = 'assets/images/' + ym + '/' + slug + '-' + rand6() + '.' + parsed.ext;
      uploadMap[img.src] = '../' + repoPath;
      files.push({ path: repoPath, content: parsed.b64, encoding: 'base64' });
    });

    var content = rawContent;
    Object.keys(uploadMap).forEach(function (dataUrl) {
      content = content.split(dataUrl).join(uploadMap[dataUrl]);
    });

    var finalCover = item.cover || '';
    if (/^data:image\//.test(finalCover)) {
      var cp = parseDataURL(finalCover);
      if (cp) {
        var coverPath = 'assets/images/' + ym + '/cover-' + slug + '-' + rand6() + '.' + cp.ext;
        files.push({ path: coverPath, content: cp.b64, encoding: 'base64' });
        finalCover = '../' + coverPath;
      }
    }

    var meta = {
      title: item.title,
      date: item.date,
      updated: item.updated,
      category: item.category || '',
      cover: finalCover
    };
    files.push({ path: 'posts/' + file, content: renderPostHtml(meta, content) });

    return Promise.resolve({ files: files, entry: cleanPostEntry(item, finalCover) });
  }

  /* data/pages.json → 提交文件：富文本图片抽出上传。
     自建页统一走动态页 page.html?slug=（file 为空），不生成静态外壳 */
  function buildPagesCommit() {
    var data = JSON.parse(pendingLocalText('data/pages.json'));
    var clone = JSON.parse(JSON.stringify(data));

    var uploads = collectRichImageUploads(clone.pages || []);
    applyRichImageReplacements(clone.pages || [], uploads.map);

    var files = uploads.files.slice();
    files.push({ path: 'data/pages.json', content: JSON.stringify(clone, null, 2) + '\n' });
    return { files: files };
  }

  /* ---------- 提交 ---------- */

  function submitCommit() {
    var checks = Array.prototype.slice.call(
      document.querySelectorAll('#cm-groups .cm-check'));
    var picked = checks.filter(function (cb) { return cb.checked; });
    if (!picked.length) {
      showCommitMsg('请先勾选要提交的改动', true);
      return;
    }

    var rp = repoParts();
    if (!(rp.owner && rp.name) || config.repo === 'your-name/your-repo') {
      showCommitMsg('仓库未配置：请先到「站点设置」填写真实 repo（owner/repo）并保存', true);
      return;
    }

    var token = $('cm-pat').value.trim();
    if (token) pat = token;
    if (!pat) {
      showCommitMsg('请填写有 Contents 写权限的 GitHub PAT（仅本页面内存保留）', true);
      $('cm-pat').focus();
      return;
    }

    var paths = picked.map(function (cb) { return cb.dataset.path; });
    var ops = {};
    picked.forEach(function (cb) { ops[cb.dataset.path] = cb.dataset.op; });
    var autoNotes = [];

    /* 依赖自动补齐：文章新增/编辑/删除都必须连同文章列表；删应用必须连同应用清单 */
    if (paths.some(isPostHtmlPath) && paths.indexOf('data/posts-list.json') === -1) {
      paths.push('data/posts-list.json');
      autoNotes.push('文章列表 data/posts-list.json');
    }
    if (paths.some(function (p) { return ops[p] === 'del' && isAppJsPath(p); }) &&
        paths.indexOf(MANIFEST_PATH) === -1 &&
        commitRows.some(function (r) { return r.path === MANIFEST_PATH; })) {
      paths.push(MANIFEST_PATH);
      autoNotes.push('应用清单 applications/applications.json');
    }

    var nPosts = paths.filter(isPostHtmlPath).length;
    var nPages = paths.indexOf('data/pages.json') !== -1 ? 1 : 0;
    var msg = $('cm-message').value.trim();
    if (!msg) {
      var bits = [];
      var groups = {};
      paths.forEach(function (p) {
        var g = pendingGroup(p);
        groups[g] = (groups[g] || 0) + 1;
      });
      Object.keys(groups).forEach(function (g) { bits.push(g + ' ' + groups[g] + ' 项'); });
      msg = 'chore: 提交本地改动（' + bits.join('、') + '）';
    }

    var confirmText = '将向 GitHub 仓库 ' + config.repo + '（' + (config.branch || 'main') +
      '）提交 ' + paths.length + ' 个改动。\n\n提交说明：' + msg +
      (nPosts ? '\n文章内嵌图片会一并上传。' : '') +
      (nPages ? '\n页面中的内嵌图片会一并上传，旧的静态页面外壳会被清理。' : '') +
      (autoNotes.length ? '\n\n已自动补齐必选项：' + autoNotes.join('、') : '') +
      '\n\n提交成功后，本地覆盖会被清除并刷新页面。确定继续？';
    if (!confirm(confirmText)) return;

    var btn = $('btn-cm-submit');
    btn.disabled = true;
    btn.textContent = '提交中…';
    showCommitMsg('正在上传文件并创建提交…');

    /* 组装全部文件 */
    var jobs = paths.map(function (p) {
      if (isPostHtmlPath(p)) {
        /* 删除登记没有本地正文，不组装文件，只占位供列表剔除 */
        if (ops[p] === 'del') {
          return Promise.resolve({ kind: 'post-del', path: p });
        }
        return buildPostCommit(p.slice('posts/'.length)).then(function (r) {
          return { kind: 'post', path: p, files: r.files, entry: r.entry };
        });
      }
      if (p === 'data/pages.json') {
        var r2 = buildPagesCommit();
        return Promise.resolve({
          kind: 'pages', path: p,
          files: r2.files, extraDeletes: r2.deletes
        });
      }
      /* engines/nav：临时 __icon 转独立 WebP 文件随提交上传，JSON 剥离 __icon */
      if (p === 'data/search-engines.json' || p === 'data/nav-links.json') {
        return Promise.resolve(buildIconDataCommit(p, ops[p], pendingLocalText(p)));
      }
      /* wallpapers：上传的 WebP dataURL 转 assets/wallpapers/ 文件，JSON 剥离 __upload */
      if (p === 'data/wallpapers.json') {
        return Promise.resolve(buildWallpaperDataCommit(p, ops[p], pendingLocalText(p)));
      }
      if (p === 'data/bg-videos.json') {
        return Promise.resolve(buildVideoDataCommit(p, ops[p], pendingLocalText(p)));
      }
      var content = pendingLocalText(p);
      if (/\.json$/.test(p)) {
        try { content = JSON.stringify(JSON.parse(content), null, 2) + '\n'; } catch (e) {}
      }
      return Promise.resolve({ kind: 'file', path: p, files: [{ path: p, content: content }] });
    });

    Promise.all(jobs).then(function (results) {
      var files = [];
      var seen = {};
      var deletes = [];
      results.forEach(function (r) {
        r.files.forEach(function (f) {
          if (!seen[f.path]) { seen[f.path] = 1; files.push(f); }
        });
        (r.extraDeletes || []).forEach(function (d) {
          if (deletes.indexOf(d) === -1) deletes.push(d);
        });
      });
      picked.forEach(function (cb) {
        if (cb.dataset.op === 'del') deletes.push(cb.dataset.path);
      });

      /* 文章列表：仓库基线 + 本次勾选文章覆盖 - 本次删除文章 */
      if (paths.indexOf('data/posts-list.json') !== -1) {
        var selectedEntries = results.filter(function (r) {
          return r.kind === 'post';
        }).map(function (r) { return r.entry; });
        var deletedFiles = {};
        picked.forEach(function (cb) {
          if (cb.dataset.op === 'del' && isPostHtmlPath(cb.dataset.path)) {
            deletedFiles[cb.dataset.path.slice('posts/'.length)] = 1;
          }
        });
        var list = buildCommittedPostList(selectedEntries)
          .filter(function (e) { return !deletedFiles[e.file]; });
        files = files.filter(function (f) { return f.path !== 'data/posts-list.json'; });
        files.push({ path: 'data/posts-list.json', content: JSON.stringify(list, null, 2) + '\n' });
      }
      return commitFiles(files, deletes, msg);
    }).then(function () {
      /* 成功：清理本地覆盖与待提交登记 */
      var pickedSet = {};
      paths.forEach(function (p) { pickedSet[p] = 1; });
      var remainPosts = {};
      readLocalList().forEach(function (p) {
        if (!pickedSet['posts/' + p.file]) remainPosts[p.file] = p;
      });

      paths.forEach(function (p) {
        try {
          if (isPostHtmlPath(p)) {
            localStorage.removeItem(LS_CONTENT_KEY + p.slice('posts/'.length));
          } else if (p === 'data/posts-list.json') {
            if (Object.keys(remainPosts).length) {
              writeLocalList(Object.keys(remainPosts).map(function (f) { return remainPosts[f]; }));
            } else {
              localStorage.removeItem(LS_LIST_KEY);
            }
          } else {
            localStorage.removeItem(localAppKey(p));
          }
        } catch (e) {}
        pendingForget(p);
      });
      /* writeLocalList 会重新登记 data/posts-list.json，未提交完时保留该登记 */
      if (!Object.keys(remainPosts).length) pendingForget('data/posts-list.json');

      btn.disabled = false;
      btn.textContent = '提交选中项到 GitHub';
      alert('提交成功！\nGitHub Actions 通常 1~2 分钟后自动构建上线。\n' +
            '本地覆盖已清除，页面将刷新以加载仓库版本。');
      location.reload();
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = '提交选中项到 GitHub';
      showCommitMsg('提交失败：' + err.message, true);
    });
  }

  function bindCommitEvents() {
    if (window.__commitEventsBound) return;
    window.__commitEventsBound = true;

    $('btn-cm-refresh').addEventListener('click', function () {
      commitLoaded = false;
      loadCommitPanel();
    });
    $('btn-cm-submit').addEventListener('click', submitCommit);
    /* 清空本地数据：删掉本浏览器中全部 ssb.* 站点数据
       （文章/正文/配置/应用代码/待提交登记），页面随即回到仓库线上状态 */
    $('btn-cm-clearall').addEventListener('click', function () {
      if (!confirm('确定清空本浏览器中的全部站点数据吗？\n' +
                   '包括未提交的文章、配置修改、应用代码与待提交登记，且无法恢复。')) return;
      var keys = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf('ssb.') === 0) keys.push(k);
        }
        keys.forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) {}
      location.reload();
    });
    $('cm-pat').addEventListener('input', function (e) {
      pat = e.target.value.trim();
    });

    /* 组全选 / 行勾选 / 差异懒加载，均为事件委托（面板每次重渲染） */
    $('cm-groups').addEventListener('click', function (e) {
      var groupAll = e.target.closest('.cm-group-all');
      if (groupAll) {
        var group = groupAll.closest('.cm-group');
        group.querySelectorAll('.cm-check').forEach(function (cb) {
          cb.checked = groupAll.checked;
        });
        return;
      }
      if (e.target.closest('.cm-check')) {
        var g2 = e.target.closest('.cm-group');
        if (!g2) return;
        var boxes = Array.prototype.slice.call(g2.querySelectorAll('.cm-check'));
        g2.querySelector('.cm-group-all').checked = boxes.every(function (cb) { return cb.checked; });
        return;
      }
      var summary = e.target.closest('.cm-diff > summary');
      if (summary) {
        loadCommitDiff(summary.parentElement);
      }
    });
  }

  /* ---------- 事件 ---------- */

  function bindAppsEvents() {
    if (window.__appsEventsBound) return;
    window.__appsEventsBound = true;

    $('btn-apps-reload').addEventListener('click', function () {
      if (confirm('重新加载将丢弃当前未保存的修改，确定吗？')) {
        appsLoaded = false;
        loadAppsData();
      }
    });

    $('btn-apps-new').addEventListener('click', createApp);

    /* 一键清掉所有应用代码覆盖 / 清单覆盖 / 数据覆盖（不动页面结构） */
    $('btn-apps-reset').addEventListener('click', function () {
      if (!confirm('确定清空本浏览器中所有应用代码的本地修改、自定义应用与应用数据，恢复为仓库文件吗？\n（页面结构请到「页面管理」单独恢复）')) return;
      try {
        var codeKeys = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(window.SSBApps.appCodeKey) === 0) codeKeys.push(k);
        }
        codeKeys.forEach(function (key) { localStorage.removeItem(key); });
        localStorage.removeItem(LS_APP_PREFIX + 'applications/applications');
        ['search-engines', 'quotes', 'nav-links'].forEach(function (n) {
          localStorage.removeItem(LS_APP_PREFIX + n);
        });
        /* 同步清掉这些路径的待提交登记 */
        pendingClear(function (p) {
          return p.indexOf('applications/') === 0 ||
                 p === 'data/search-engines.json' ||
                 p === 'data/quotes.json' ||
                 p === 'data/nav-links.json';
        });
      } catch (e) {}
      location.reload();
    });

    /* 列表：编辑按钮（事件委托） */
    $('apps-grid').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act="edit"]');
      if (btn) openAppEditor(btn.dataset.id);
    });

    $('btn-ae-back').addEventListener('click', function () {
      /* 未保存的新应用草稿：从注册表摘除再回列表 */
      if (appEdit && appEdit.isNew &&
          !adminManifest.apps.some(function (m) { return m.id === appEdit.id; })) {
        delete adminRegistry[appEdit.id];
      }
      showAppsList();
    });
    $('btn-ae-save').addEventListener('click', saveAppEditor);
    $('btn-ae-delete').addEventListener('click', deleteCustomApp);
    $('btn-ae-restore').addEventListener('click', discardAppCode);

    /* 标签页切换 */
    $('ae-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.ae-tab');
      if (b) switchAppTab(b.dataset.tab);
    });

    /* 数据 tab：结构化行/块的增删（复用站点设置同款类名与行构造器） */
    $('ae-data').addEventListener('click', function (e) {
      var rowDel = e.target.closest('.row-del');
      if (rowDel) { rowDel.closest('.repeat-row').remove(); return; }

      var grpDel = e.target.closest('.group-del');
      if (grpDel) { grpDel.closest('.nav-group').remove(); return; }

      /* 行内「重试」：强制重新抓取（网站换 logo 后可用）；转圈中不重复触发 */
      var rBtn = e.target.closest('.icon-retry');
      if (rBtn) {
        var rRow = rBtn.closest('.repeat-row');
        var rBox = rRow.querySelector('.ri-box');
        if (rBox.dataset.state !== 'loading') liveMatchRow(rRow, true);
        return;
      }

      /* 行内「上传」：记住目标行，打开共用文件选择框（change 事件处理压缩） */
      var upBtn = e.target.closest('.icon-upload');
      if (upBtn) {
        iconUploadRow = upBtn.closest('.repeat-row');
        var fileBox = $('ae-icon-file');
        if (fileBox) fileBox.click();
        return;
      }

      if (e.target.closest('#ae-engine-add')) {
        $('ae-engines').insertAdjacentHTML('beforeend', engineRowHTML());
        return;
      }
      if (e.target.closest('#ae-nav-add')) {
        $('ae-nav-groups').insertAdjacentHTML('beforeend', navGroupHTML());
        return;
      }
      if (e.target.closest('.link-add')) {
        e.target.closest('.nav-group').querySelector('.nav-link-rows')
          .insertAdjacentHTML('beforeend', navLinkRowHTML());
      }

      /* 壁纸 / 视频数据行 */
      var mDel = e.target.closest('.m-del');
      if (mDel) { mDel.closest('.media-row').remove(); return; }
      var vUp = e.target.closest('.v-upload');
      if (vUp) {
        videoUploadRow = vUp.closest('.media-row');
        var vBox = $('ae-video-file');
        if (vBox) vBox.click();
        return;
      }
      var mUp = e.target.closest('.m-upload');
      if (mUp) {
        wallpaperUploadRow = mUp.closest('.media-row');
        var wBox = $('ae-wallpaper-file');
        if (wBox) wBox.click();
        return;
      }
      if (e.target.closest('#ae-wallpaper-add')) {
        $('ae-wallpapers').insertAdjacentHTML('beforeend', wallpaperRowHTML());
        return;
      }
      if (e.target.closest('#ae-video-add')) {
        $('ae-videos').insertAdjacentHTML('beforeend', videoRowHTML());
        return;
      }
      if (e.target.closest('#ae-color-add')) {
        $('ae-colors').insertAdjacentHTML('beforeend', colorRowHTML());
      }
    });

    /* 文件类选择框：图标/视频/壁纸共用 change 委托，各自压缩处理 */
    $('ae-data').addEventListener('change', function (e) {
      if (e.target.id === 'ae-icon-file') {
        var file = e.target.files && e.target.files[0];
        e.target.value = '';   /* 选同一个文件也要能再次触发 change */
        handleIconFile(file);
        return;
      }
      if (e.target.id === 'ae-video-file') {
        var vfile = e.target.files && e.target.files[0];
        e.target.value = '';
        handleVideoFile(vfile);
        return;
      }
      if (e.target.id === 'ae-wallpaper-file') {
        var wpFile = e.target.files && e.target.files[0];
        e.target.value = '';
        handleWallpaperFile(wpFile);
      }
    });

    /* 网址输入防抖实时匹配；名称输入时联动首字母徽章。
       计时器按行存 WeakMap，连续打字只发最后一次请求 */
    var urlTimers = new WeakMap();
    $('ae-data').addEventListener('input', function (e) {
      var row = e.target.closest('.repeat-row');
      if (!row) return;
      if (e.target.classList.contains('r-url')) {
        clearTimeout(urlTimers.get(row));
        urlTimers.set(row, setTimeout(function () { liveMatchRow(row); }, 800));
      } else if (e.target.classList.contains('r-name')) {
        var box = row.querySelector('.ri-box');
        if (box && box.dataset.state === 'letter') {
          box.querySelector('.ri-letter').textContent =
            (e.target.value || '?').trim().slice(0, 1) || '?';
        }
      }
    });

    /* img 加载失败统一兜底（error 不冒泡，用捕获阶段）：
       壁纸缩略图（仓库文件缺失）→ 占位；站点图标 → 首字母徽章 */
    $('ae-data').addEventListener('error', function (e) {
      if (e.target.classList && e.target.classList.contains('m-thumb-img') &&
          e.target.src.indexOf('data:') !== 0) {
        e.target.closest('.media-thumb').innerHTML = '<span class="media-empty">未找到</span>';
        return;
      }
      if (!e.target.classList || !e.target.classList.contains('ri-img')) return;
      var box = e.target.closest('.ri-box');
      if (!box || box.dataset.state === 'icon') return; /* dataURL 失败不处理 */
      var row = box.closest('.repeat-row');
      box.dataset.state = 'letter';
      box.innerHTML = '<span class="ri-letter">' +
        escapeHTML(row ? rowLetter(row) : '?') + '</span>';
    }, true);

    /* 代码编辑器：Tab 键插入两个空格而不是跳焦 */
    $('ae-code').addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var el = this;
        var s = el.selectionStart;
        var en = el.selectionEnd;
        el.value = el.value.slice(0, s) + '  ' + el.value.slice(en);
        el.selectionStart = el.selectionEnd = s + 2;
      }
    });
  }

  /* ============================================================
     顶栏 localStorage 用量指示
     localStorage 容量按字符数（UTF-16）估算，浏览器常见上限 ~5MB。
     仅统计本站前缀 ssb. 的键，展示「已用 / 配额」与百分比进度。
     ============================================================ */
  var LS_USAGE_QUOTA = 5 * 1024 * 1024; /* 估算配额 5MB（字符数×2 字节≈字节数） */

  function fmtBytes(chars) {
    var bytes = chars * 2; /* JS 字符串按 UTF-16 存储 */
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function updateLsUsage() {
    var wrap = $('ls-usage');
    if (!wrap) return;
    var textEl = $('ls-usage-text');
    var fillEl = $('ls-usage-fill');
    var chars = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('ssb.') !== 0) continue;
        chars += k.length + String(localStorage.getItem(k) || '').length;
      }
    } catch (e) {}
    var pct = Math.min(100, Math.round((chars * 2) / LS_USAGE_QUOTA * 100));
    var label = '缓存 ' + fmtBytes(chars) + ' / ' + fmtBytes(LS_USAGE_QUOTA / 2) + '（' + pct + '%）';
    textEl.textContent = label;
    fillEl.style.width = pct + '%';
    wrap.classList.remove('warn', 'danger');
    if (pct >= 90) wrap.classList.add('danger');
    else if (pct >= 70) wrap.classList.add('warn');
    wrap.title = '本浏览器站点数据（ssb.* 前缀）占用估算\n' +
      'localStorage 上限约 5MB；接近上限时请到「提交管理」提交或丢弃本地改动以释放空间';
  }

  /* ============================================================
     初始化与事件绑定
     ============================================================ */

  function bindEvents() {
    /* 左侧导航 */
    document.querySelectorAll('.nav-item').forEach(function (a) {
      a.addEventListener('click', function () {
        showView(a.dataset.view);
      });
    });

    /* 列表操作（事件委托） */
    $('posts-tbody').addEventListener('click', function (e) {
      var editBtn = e.target.closest('[data-edit]');
      var delBtn = e.target.closest('[data-del]');
      if (editBtn) editPost(editBtn.dataset.edit);
      if (delBtn) deletePost(delBtn.dataset.del);
    });

    $('btn-new').addEventListener('click', newPost);
    $('btn-reload').addEventListener('click', loadPosts);
    $('btn-back').addEventListener('click', function () {
      if (isPreview) exitPreview();
      showView('posts');
    });
    $('btn-preview').addEventListener('click', togglePreview);
    $('btn-save').addEventListener('click', savePost);
  }

  function init() {
    fetch(ROOT + 'site-config.json', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('site-config.json 加载失败');
        return res.json();
      })
      .then(function (cfg) {
        /* 站点设置页保存的整份配置覆盖优先于仓库文件。
           这样后台保存文章时用到的 siteName 等也是最新值；
           访客浏览器无此键，自动回落仓库版本 */
        var localCfg = readLocalJSON(LS_SITE_KEY);
        if (localCfg) cfg = localCfg;
        config = cfg;
        $('admin-brand').textContent = config.siteName ? config.siteName + ' · 管理' : '管理后台';

        /* 富文本编辑器：文章编辑器；页面编辑里的 rich-content 实例在每次渲染编辑页时动态绑定 */
        initRichEditor($('editor-toolbar'), $('editor-body'), $('image-file'));
        bindCoverInputs();
        bindEvents();
        bindPagesEvents();
        bindAppsEvents();
        bindCommitEvents();
        updateLsUsage();
        showView('posts');
        loadPosts();
      })
      .catch(function (err) {
        document.body.innerHTML =
          '<div style="padding:60px;text-align:center;color:#dc2626;font-family:sans-serif">' +
          escapeHTML(err.message) + '</div>';
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
