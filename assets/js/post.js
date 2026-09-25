/* ============================================================
   post.js —— 文章页
   1. 读取文章内嵌的 .post-data 元数据，渲染封面与元信息行
   2. 自动从 h2/h3 生成右侧多级目录（编号样式见 post.css）
   3. 滚动时高亮当前章节
   4. 左侧悬浮工具：目录开关（窄屏抽屉）、回到顶部
   ============================================================ */

(function () {
  'use strict';

  var U = window.BlogUtils;

  window.initPage = function (config) {
    var metaEl = document.querySelector('.post-data');
    var meta = {};
    try { meta = JSON.parse(metaEl.textContent); } catch (e) {
      console.error('文章元数据解析失败', e);
    }

    var article = document.querySelector('.post-content');

    renderCover(meta);
    renderMeta(meta, config, article);
    renderTools();
    buildTOC(article);
    injectSEO(meta, article);
    renderPager();
    loadHighlight(article);
  };

  /* ---------- 代码高亮：只有存在代码块时才动态加载 highlight.js ----------
     为什么动态加载而不是每篇都 <script src>：
     没代码的文章不付出这次请求；脚本零依赖、加载即自执行高亮 */
  function loadHighlight(article) {
    if (!article || !article.querySelector('pre code')) return;
    if (window.SSBHighlight) { window.SSBHighlight.all(); return; }
    var s = document.createElement('script');
    s.src = U.ROOT + 'assets/js/highlight.js';
    document.body.appendChild(s);
  }

  /* ---------- SEO / 分享卡片 meta：从正文首段提取描述 ----------
     静态 HTML 已保证标题可被抓取，这里补上 description / og / twitter，
     JS 注入对现代爬虫与社交分享抓取均有效 */
  function injectSEO(meta, article) {
    var desc = meta.summary;
    if (!desc && article) {
      var p = article.querySelector('p');
      if (p) desc = p.textContent.trim().replace(/\s+/g, ' ').slice(0, 140);
    }
    if (!desc) return;

    function setMeta(attr, key, content) {
      var el = document.querySelector('meta[' + attr + '="' + key + '"]');
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    }

    var title = (meta.title || document.title).trim();
    setMeta('name', 'description', desc);
    setMeta('property', 'og:type', 'article');
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', desc);
    setMeta('name', 'twitter:card', 'summary');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', desc);
  }

  /* ---------- 上一篇/下一篇（posts-list 已按日期倒序） ----------
     约定：「较新」= 列表中前一篇，「较旧」= 后一篇。
     本地文章 URL 带 ?file= 参数，用 U.postHref 统一生成链接 */
  function renderPager() {
    /* 当前文章文件名：本地动态页取 ?file=，静态页取路径末段 */
    var params = new URLSearchParams(location.search);
    var current = params.get('file') || (location.pathname.split('/').pop() || 'index.html');

    U.getPosts().then(function (posts) {
      var idx = -1;
      for (var i = 0; i < posts.length; i++) {
        if (posts[i].file === current) { idx = i; break; }
      }
      if (idx === -1) return;

      var newer = posts[idx - 1];   /* 倒序：索引越小越新 */
      var older = posts[idx + 1];

      function side(label, p, cls) {
        if (!p) return '<span class="pager-side pager-disabled ' + cls + '">' + label + '<span>没有了</span></span>';
        return '<a class="pager-side ' + cls + '" href="' + U.postHref(p.file) + '">' +
               '<span class="pager-label">' + label + '</span>' +
               '<span class="pager-title">' + U.escapeHTML(p.title) + '</span></a>';
      }

      var nav = document.createElement('nav');
      nav.className = 'post-pager';
      nav.innerHTML = side('← 较新一篇', newer, 'pager-prev') +
                      side('较旧一篇 →', older, 'pager-next');

      var container = document.querySelector('.post-container');
      if (container) container.appendChild(nav);
    });
  }

  /* ---------- 封面图（没有配置则不显示） ---------- */
  function renderCover(meta) {
    if (!meta.cover) return;
    var container = document.querySelector('.post-container');
    var div = document.createElement('div');
    div.className = 'post-cover';
    div.innerHTML = '<img src="' + U.escapeHTML(meta.cover) + '" alt="封面">';
    container.insertBefore(div, container.firstChild);
  }

  /* ---------- 元信息行 ---------- */
  function renderMeta(meta, config, article) {
    var wrap = document.getElementById('post-meta');
    var author = config.author || '博主';

    /* 头像：配置了图片用图片，否则用名字首字 */
    var avatar = config.avatar
      ? '<img class="meta-avatar" src="' + U.escapeHTML(config.avatar) + '" alt="avatar">'
      : '<span class="meta-avatar-text">' + U.escapeHTML(author.slice(0, 1)) + '</span>';

    var html = avatar +
      '<span class="meta-author">' + U.escapeHTML(author) + '</span>';

    /* 发布日期 */
    if (meta.date) {
      html += '<span class="meta-dot"></span>' +
        '<span class="meta-item">' + U.icon('calendar') + U.escapeHTML(meta.date) + '</span>';
    }

    /* 更新日期（与发布日期不同才显示） */
    if (meta.updated && meta.updated !== meta.date) {
      html += '<span class="meta-item">' + U.icon('refresh') +
        U.escapeHTML(meta.updated) + '</span>';
    }

    /* 分类 */
    if (meta.category) {
      html += '<span class="meta-dot"></span>' +
        '<span class="meta-item">' + U.icon('folder') +
        '<span class="meta-category">' + U.escapeHTML(meta.category) + '</span></span>';
    }

    /* 字数与阅读时长（由正文实时计算，中文按字符） */
    var chars = article ? article.textContent.replace(/\s+/g, '').length : 0;
    var minutes = Math.max(1, Math.round(chars / 400));
    html += '<span class="meta-dot"></span>' +
      '<span class="meta-item">' + U.icon('word') + chars + ' 字</span>' +
      '<span class="meta-item">' + U.icon('clock') + minutes + ' 分钟</span>';

    wrap.innerHTML = html;
  }

  /* ---------- 左侧悬浮工具 ---------- */
  function renderTools() {
    var tools = document.getElementById('post-tools');
    tools.innerHTML =
      '<button type="button" id="tool-toc" title="目录" aria-label="目录">' + U.icon('list') + '</button>' +
      '<button type="button" id="tool-top" title="回到顶部" aria-label="回到顶部">' + U.icon('top') + '</button>';

    var isNarrow = function () { return window.matchMedia('(max-width: 1000px)').matches; };
    var tocBtn = document.getElementById('tool-toc');
    var topBtn = document.getElementById('tool-top');

    /* 宽屏：显示/隐藏右侧目录；窄屏：右侧抽屉 */
    tocBtn.addEventListener('click', function () {
      if (isNarrow()) {
        document.body.classList.toggle('toc-open');
      } else {
        document.body.classList.toggle('toc-hidden');
      }
    });

    /* 窄屏点击目录链接后自动收起抽屉 */
    document.getElementById('post-toc').addEventListener('click', function (e) {
      if (isNarrow() && e.target.closest('a')) {
        document.body.classList.remove('toc-open');
      }
    });

    topBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    window.addEventListener('scroll', function () {
      topBtn.classList.toggle('show', window.scrollY > 400);
    }, { passive: true });
  }

  /* ---------- 生成右侧目录 ---------- */
  function buildTOC(article) {
    var tocWrap = document.getElementById('post-toc');
    var headings = Array.prototype.slice.call(article.querySelectorAll('h2, h3'));
    if (!headings.length) {
      tocWrap.style.display = 'none';
      document.body.classList.add('toc-hidden');
      return;
    }

    /* 给没有 id 的标题补一个锚点 id */
    headings.forEach(function (h, i) {
      if (!h.id) h.id = 'toc-heading-' + (i + 1);
    });

    /* 构造两级嵌套列表：h2 为一级项，其后连续的 h3 收进它的子 <ol>。
       注意每个 <li> 都显式闭合（旧实现漏写 </li> 靠浏览器容错，
       曾导致目录编号异常等诡异问题） */
    var html = '<ol class="toc-list">';
    var subOpen = false;

    function link(h) {
      return '<li><a href="#' + h.id + '" data-target="' + h.id + '">' +
             U.escapeHTML(h.textContent) + '</a>';
    }

    headings.forEach(function (h, i) {
      var next = headings[i + 1];
      if (h.tagName === 'H2') {
        if (subOpen) { html += '</ol></li>'; subOpen = false; }
        html += link(h);
        /* 下一个标题是 h3：本 li 保持打开，接子列表；否则直接闭合 */
        if (next && next.tagName === 'H3') { html += '<ol>'; subOpen = true; }
        else { html += '</li>'; }
      } else {
        html += link(h) + '</li>';
        /* h3 序列结束（下一个不是 h3）：收掉子列表和父 h2 的 li */
        if (!next || next.tagName !== 'H3') { html += '</ol></li>'; subOpen = false; }
      }
    });
    html += '</ol>';
    tocWrap.innerHTML = html;

    /* 平滑滚动并避开固定头部（scroll-margin-top 已在 CSS 中设置） */
    tocWrap.addEventListener('click', function (e) {
      var link = e.target.closest('a');
      if (!link) return;
      e.preventDefault();
      var target = document.getElementById(link.dataset.target);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + link.dataset.target);
    });

    bindScrollSpy(headings);
  }

  /* ---------- 滚动高亮当前章节 ---------- */
  function bindScrollSpy(headings) {
    var links = Array.prototype.slice.call(
      document.querySelectorAll('#post-toc a[data-target]')
    );

    function onScroll() {
      var offset = 90;   /* 固定头部高度 + 余量 */
      var currentId = '';

      for (var i = 0; i < headings.length; i++) {
        if (headings[i].getBoundingClientRect().top <= offset) {
          currentId = headings[i].id;
        } else {
          break;
        }
      }

      links.forEach(function (a) {
        a.classList.toggle('active', a.dataset.target === currentId);
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
})();
