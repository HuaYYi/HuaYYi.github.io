/* ============================================================
   SSB 应用：文章列表（posts）
   cfg = schema 默认 ∪ data/pages.json 的 apps.posts ∪ 实例 cfg（三层合并）
   title=板块标题（缺省「最新文章」，通常在实例上配）/ count=篇数(0全部)
   summary / cover / order=newest|oldest / category=只显示某分类
   可重复添加：首页「最新文章」+ 另一个屏「随笔分类文章」互不影响
   ============================================================ */
SSBApps.define({
  id: 'posts',
  name: '文章列表',
  desc: '按配置展示文章卡片（封面、摘要、分类过滤），可多次挂载',
  hero: false,
  configSchema: [
    { key: 'title', label: '板块标题（留空显示「最新文章」）', type: 'text', def: '最新文章' },
    { key: 'count', label: '显示篇数（0 = 全部）', type: 'number', min: 0, max: 100, step: 1, def: 6 },
    { key: 'order', label: '排序', type: 'select', options: [['newest', '最新在前'], ['oldest', '最早在前']], def: 'newest' },
    { key: 'cover', label: '显示封面图', type: 'boolean', def: true },
    { key: 'summary', label: '显示摘要', type: 'boolean', def: true },
    { key: 'category', label: '限定分类（留空 = 全部）', type: 'text', def: '' }
  ],
  css: `
.section-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  padding-bottom: 14px;
  border-bottom: 2px solid var(--primary);
  display: inline-block;
  margin-bottom: 8px;
}
.post-list .list-loading,
.post-list .list-empty {
  color: var(--text-3);
  padding: 40px 0;
  text-align: center;
}
/* ---------- 文章卡片（参考 Keep 主题） ---------- */
.post-item {
  display: block;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;                  /* 封面圆角要生效 */
  background: var(--surface);
  box-shadow: 0 1px 3px rgba(31, 45, 68, .06);
  margin-bottom: 20px;
  transition: transform .2s, box-shadow .2s, border-color .2s;
}
.post-item:last-child { margin-bottom: 0; }
.post-item:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 24px rgba(31, 45, 68, .14);
  border-color: var(--primary-light);
}
/* 封面：默认 16:9，但 max-height 封顶 220px，避免卡片宽时封面过高 */
.post-cover {
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: 220px;
  overflow: hidden;
  background: var(--bg-soft);
}
.post-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform .35s ease;
}
.post-item:hover .post-cover img {
  transform: scale(1.04);
}
/* 文字内容区（无封面时顶到上） */
.post-item h3,
.post-item .item-meta,
.post-item .item-summary,
.post-item .read-more {
  padding-left: 24px;
  padding-right: 24px;
}
.post-item h3 {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  padding-top: 20px;
  margin: 0 0 6px;
  transition: color .2s;
}
.post-item:hover h3 { color: var(--primary); }
.post-item .item-meta {
  font-size: 13px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.post-item .item-category {
  color: var(--primary);
  background: var(--primary-light);
  padding: 1px 9px;
  border-radius: 11px;
}
.post-item .item-summary {
  font-size: 14.5px;
  color: var(--text-2);
  line-height: 1.75;
  padding-bottom: 14px;
  /* 最多显示 2 行，超出省略号 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.post-item .read-more {
  display: inline-block;
  padding-bottom: 20px;
  font-size: 13px;
  color: var(--primary);
  font-weight: 600;
  opacity: 0;                         /* 默认隐藏，hover 显示（Keep 主题风格） */
  transform: translateX(-6px);
  transition: opacity .25s, transform .25s;
}
.post-item:hover .read-more {
  opacity: 1;
  transform: translateX(0);
}
`,
  render: function (mount, ctx) {
    var conf = ctx.cfg || {};
    var wrap = document.createElement('div');
    var title = conf.title != null ? conf.title : '最新文章';
    wrap.innerHTML = (title ? '<h2 class="section-title">' + U.escapeHTML(title) + '</h2>' : '') +
      '<div class="post-list"><p class="list-loading">加载中…</p></div>';
    mount.appendChild(wrap);
    var listEl = wrap.querySelector('.post-list');

    return U.getPosts()
      .then(function (posts) {
        var list = posts.slice();
        if (conf.order === 'oldest') list.reverse();
        if (conf.category) {
          list = list.filter(function (p) { return p.category === conf.category; });
        }
        var count = Number(conf.count) > 0 ? Number(conf.count) : list.length;
        list = list.slice(0, count);

        if (!list.length) {
          listEl.innerHTML = '<p class="list-empty">还没有文章。</p>';
          return;
        }

        listEl.innerHTML = list.map(function (p) {
          var category = p.category
            ? '<span class="item-category">' + U.escapeHTML(p.category) + '</span>'
            : '';
          /* 封面：本地文章 cover 可能是 dataURL，线上文章是相对路径 */
          var cover = conf.cover === false ? '' : (p.cover ? U.escapeHTML(p.cover) : '');
          var coverHtml = cover
            ? '<div class="post-cover"><img src="' + cover + '" alt="cover" loading="lazy"></div>'
            : '';
          var summaryHtml = conf.summary === false
            ? ''
            : '<p class="item-summary">' + U.escapeHTML(p.summary || '') + '</p>';
          return '<a class="post-item" href="' + U.postHref(p.file) + '">' +
                   coverHtml +
                   '<h3>' + U.escapeHTML(p.title) + '</h3>' +
                   '<div class="item-meta">' +
                     '<span>' + U.escapeHTML(p.date || '') + '</span>' +
                     category +
                   '</div>' +
                   summaryHtml +
                   '<span class="read-more">Read more ›</span>' +
                 '</a>';
        }).join('');
      })
      .catch(function (err) {
        console.error(err);
        listEl.innerHTML = '<p class="list-empty">文章列表加载失败：data/posts-list.json</p>';
      });
  }
});
