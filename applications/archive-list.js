/* ============================================================
   SSB 应用：归档列表（archive-list）
   cfg = schema 默认 ∪ data/pages.json 的 apps['archive-list'] ∪ 实例 cfg
   groupBy=year|month|flat / filters=分类筛选条 / order=newest|oldest
   pageSize=每页篇数（0=不分页，一页显示全部）/ showTotal=是否显示文章总数
   筛选与页码状态闭包在实例内，支持同页多个归档列表
   ============================================================ */
SSBApps.define({
  id: 'archive-list',
  name: '归档列表',
  desc: '按年/月分组的文章归档，可带分类筛选条与分页',
  hero: false,
  configSchema: [
    { key: 'groupBy', label: '分组方式', type: 'select',
      options: [['year', '按年 → 月分组'], ['month', '按年-月分组'], ['flat', '平铺不分组']], def: 'year' },
    { key: 'order', label: '排序', type: 'select',
      options: [['newest', '最新在前'], ['oldest', '最早在前']], def: 'newest' },
    { key: 'filters', label: '显示分类筛选条', type: 'boolean', def: true },
    { key: 'pageSize', label: '每页篇数（0=不分页，一页全部显示）', type: 'number',
      def: 10, min: 0, max: 999, step: 1 },
    { key: 'showTotal', label: '显示文章总数（分页栏右侧“共 N 篇”）', type: 'boolean', def: true }
  ],
  css: `
/* ---------- 分类筛选 chips ---------- */
.archive-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 26px;
}
.filter-chip {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-2);
  font-size: 13.5px;
  font-family: inherit;
  line-height: 1;
  padding: 7px 13px;
  border-radius: 999px;
  cursor: pointer;
  transition: all .18s;
}
.filter-chip:hover {
  border-color: var(--primary);
  color: var(--primary);
}
.filter-chip.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.filter-chip .chip-count {
  font-size: 12px;
  opacity: .75;
  margin-left: 2px;
}
.list-loading,
.list-empty {
  color: var(--text-3);
  padding: 40px 0;
  text-align: center;
}
.archive-year {
  margin-bottom: 38px;
}
.archive-year > h2 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  padding-bottom: 10px;
  border-bottom: 2px solid var(--primary);
  margin-bottom: 18px;
}
.archive-month {
  margin-bottom: 22px;
}
.archive-month > h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 8px;
}
.archive-item {
  display: flex;
  align-items: baseline;
  gap: 18px;
  padding: 9px 0;
  font-size: 15.5px;
}
.archive-item .item-date {
  flex-shrink: 0;
  width: 52px;
  color: var(--text-3);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.archive-item a {
  color: var(--text);
  flex: 1;
  min-width: 0;
  transition: color .2s;
}
.archive-item a:hover {
  color: var(--primary);
}
.archive-item .item-category {
  flex-shrink: 0;
  font-size: 12.5px;
  color: var(--primary);
  background: var(--primary-light);
  padding: 1px 9px;
  border-radius: 11px;
}
/* ---------- 分页栏 ---------- */
.archive-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 30px;
}
.archive-pager:empty {
  display: none;
}
.pager-btn {
  min-width: 34px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-2);
  font-size: 14px;
  font-family: inherit;
  line-height: 1;
  border-radius: 8px;
  cursor: pointer;
  transition: all .18s;
}
.pager-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}
.pager-btn:disabled {
  opacity: .45;
  cursor: default;
}
.pager-btn.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.pager-ellipsis {
  color: var(--text-3);
  padding: 0 3px;
  user-select: none;
}
.pager-total {
  margin-left: 12px;
  color: var(--text-3);
  font-size: 13.5px;
  font-variant-numeric: tabular-nums;
}
`,
  render: function (mount, ctx) {
    var conf = ctx.cfg || {};
    var activeCat = '全部';
    var allPosts = [];
    var currentPage = 0;   /* 0 基页码 */

    var wrap = document.createElement('div');
    wrap.className = 'archive-list-app';
    wrap.innerHTML = '<div class="archive-filters"></div>' +
      '<div class="archive-list-body"><p class="list-loading">加载中…</p></div>' +
      '<nav class="archive-pager" aria-label="归档分页"></nav>';
    mount.appendChild(wrap);
    var bar = wrap.querySelector('.archive-filters');
    var body = wrap.querySelector('.archive-list-body');
    var pager = wrap.querySelector('.archive-pager');

    /* 翻页事件委托必须在 return 之前绑定——下面的 getPosts 链会提前返回。
       pager 每次整体重渲染 innerHTML，监听挂在 pager 节点上无需解绑 */
    pager.addEventListener('click', onPagerClick);

    return U.getPosts()
      .then(function (posts) {
        allPosts = posts.slice();
        if (conf.order === 'oldest') allPosts.reverse();

        if (!allPosts.length) {
          body.innerHTML = '<p class="list-empty">还没有文章。</p>';
          return;
        }
        renderArchFilters();
        renderView(filteredPosts());
      })
      .catch(function (err) {
        console.error(err);
        body.innerHTML = '<p class="list-empty">文章列表加载失败：data/posts-list.json</p>';
      });

    /* ---------- 当前分类筛选后的文章 ---------- */
    function filteredPosts() {
      return activeCat === '全部'
        ? allPosts
        : allPosts.filter(function (p) { return (p.category || '未分类') === activeCat; });
    }

    /* 每页篇数：非法/非正一律按 0=不分页处理 */
    function getPageSize() {
      var n = parseInt(conf.pageSize, 10);
      return isNaN(n) || n <= 0 ? 0 : Math.min(n, 999);
    }

    /* ---------- 列表 + 分页栏一起渲染（翻页、筛选后共用此入口） ---------- */
    function renderView(posts) {
      var size = getPageSize();
      var totalPages = size ? Math.ceil(posts.length / size) : 1;
      if (currentPage > totalPages - 1) currentPage = totalPages - 1;
      if (currentPage < 0) currentPage = 0;

      var start = size ? currentPage * size : 0;
      var pagePosts = size ? posts.slice(start, start + size) : posts;
      renderArchList(pagePosts);
      renderPager(totalPages, posts.length);
    }

    /* ---------- 分类筛选条（filters=false 或只有一个分类时不渲染） ---------- */
    function renderArchFilters() {
      if (conf.filters === false) { bar.style.display = 'none'; return; }

      var cats = [];
      allPosts.forEach(function (p) {
        var c = p.category || '未分类';
        if (cats.indexOf(c) === -1) cats.push(c);
      });
      if (cats.length <= 1) { bar.style.display = 'none'; return; }

      bar.innerHTML = ['全部'].concat(cats).map(function (c) {
        var count = c === '全部'
          ? allPosts.length
          : allPosts.filter(function (p) { return (p.category || '未分类') === c; }).length;
        return '<button type="button" class="filter-chip' +
               (c === activeCat ? ' active' : '') +
               '" data-cat="' + U.escapeHTML(c) + '">' +
               U.escapeHTML(c) + ' <span class="chip-count">' + count + '</span></button>';
      }).join('');

      bar.addEventListener('click', function (e) {
        var chip = e.target.closest('.filter-chip');
        if (!chip) return;
        activeCat = chip.dataset.cat;
        bar.querySelectorAll('.filter-chip').forEach(function (el) {
          el.classList.toggle('active', el.dataset.cat === activeCat);
        });
        /* 切换分类后回到第一页，避免停在“该分类不存在的页码”上 */
        currentPage = 0;
        renderView(filteredPosts());
      });
    }

    /* ---------- 分页栏：上一页 + 页码（多页省略号窗口）+ 下一页 + 总数 ---------- */
    function renderPager(totalPages, totalCount) {
      /* 单页且不显示总数：分页栏留空（:empty 自动隐藏） */
      if (totalPages <= 1 && conf.showTotal === false) { pager.innerHTML = ''; return; }

      var html = '';
      if (totalPages > 1) {
        html += '<button type="button" class="pager-btn" data-act="prev"' +
                (currentPage === 0 ? ' disabled' : '') + '>上一页</button>';
        pageNumberList(totalPages).forEach(function (n) {
          if (n === '…') {
            html += '<span class="pager-ellipsis">…</span>';
          } else {
            html += '<button type="button" class="pager-btn' +
                    (n - 1 === currentPage ? ' active' : '') +
                    '" data-page="' + n + '">' + n + '</button>';
          }
        });
        html += '<button type="button" class="pager-btn" data-act="next"' +
                (currentPage === totalPages - 1 ? ' disabled' : '') + '>下一页</button>';
      }
      if (conf.showTotal !== false) {
        html += '<span class="pager-total">共 ' + totalCount + ' 篇</span>';
      }
      pager.innerHTML = html;
    }

    /* 页码窗口：≤7 页全显示；否则首尾常驻，当前页前后各 1 页，缺口用省略号 */
    function pageNumberList(totalPages) {
      if (totalPages <= 7) {
        var all = [];
        for (var i = 1; i <= totalPages; i++) all.push(i);
        return all;
      }
      var cur = currentPage + 1;
      var win = [1];
      var lo = Math.max(2, cur - 1);
      var hi = Math.min(totalPages - 1, cur + 1);
      if (lo > 2) win.push('…');
      for (var j = lo; j <= hi; j++) win.push(j);
      if (hi < totalPages - 1) win.push('…');
      win.push(totalPages);
      return win;
    }

    /* ---------- 翻页点击处理（prev/next/页码，非法点击忽略） ---------- */
    function onPagerClick(e) {
      var btn = e.target.closest('.pager-btn');
      if (!btn || btn.disabled) return;
      var size = getPageSize();
      var totalPages = size ? Math.ceil(filteredPosts().length / size) : 1;

      if (btn.dataset.act === 'prev') {
        if (currentPage > 0) currentPage--;
      } else if (btn.dataset.act === 'next') {
        if (currentPage < totalPages - 1) currentPage++;
      } else if (btn.dataset.page) {
        currentPage = parseInt(btn.dataset.page, 10) - 1;
      } else {
        return;
      }
      renderView(filteredPosts());
      scrollToListTop();
    }

    /* 翻页后回到归档列表顶部：头部是 fixed，按 --header-h 手工算位置，
       避免内容被头部遮挡 */
    function scrollToListTop() {
      var headerH = 60;
      try {
        var v = getComputedStyle(document.documentElement).getPropertyValue('--header-h');
        var n = parseInt(v, 10);
        if (!isNaN(n)) headerH = n;
      } catch (e) {}
      var top = wrap.getBoundingClientRect().top + window.scrollY - headerH - 16;
      window.scrollTo(0, Math.max(0, top));
    }

    /* ---------- 列表渲染：groupBy 决定分组结构（全部限制在本实例 wrap 内） ---------- */
    function renderArchList(posts) {
      if (!posts.length) {
        body.innerHTML = '<p class="list-empty">该分类下还没有文章。</p>';
        return;
      }

      var groupBy = conf.groupBy || 'year';

      if (groupBy === 'flat') {
        /* 不分组：平铺列表，日期显示完整年月日 */
        body.innerHTML = posts.map(function (p) {
          return archItemHTML(p, (p.date || '').slice(0, 10));
        }).join('');
        return;
      }

      if (groupBy === 'month') {
        /* 按年-月分组：一个月一个区块 */
        var byMonth = {};
        posts.forEach(function (p) {
          var key = (p.date || '').slice(0, 7) || '未分类';
          (byMonth[key] = byMonth[key] || []).push(p);
        });
        body.innerHTML = Object.keys(byMonth).map(function (key) {
          return '<section class="archive-year"><h2>' + U.escapeHTML(key) + '</h2>' +
                 byMonth[key].map(function (p) {
                   return archItemHTML(p, (p.date || '').slice(8, 10));
                 }).join('') +
                 '</section>';
        }).join('');
        return;
      }

      /* 默认 year：年 → 月两级分组。
         分页先按文章切片再分组，跨页的同一年份标题会自然重复 */
      var grouped = {};
      posts.forEach(function (p) {
        var date = p.date || '';
        var year = date.slice(0, 4) || '未分类';
        var month = date.slice(5, 7) || '';
        (grouped[year] = grouped[year] || {});
        (grouped[year][month] = grouped[year][month] || []).push(p);
      });

      body.innerHTML = Object.keys(grouped).map(function (year) {
        var monthsHtml = Object.keys(grouped[year]).map(function (month) {
          return '<div class="archive-month"><h3>' + U.escapeHTML(month) + ' 月</h3>' +
                 grouped[year][month].map(function (p) {
                   return archItemHTML(p, (p.date || '').slice(8, 10));
                 }).join('') +
                 '</div>';
        }).join('');
        return '<section class="archive-year"><h2>' + U.escapeHTML(year) + '</h2>' +
               monthsHtml + '</section>';
      }).join('');
    }

    function archItemHTML(p, dateText) {
      var category = p.category
        ? '<span class="item-category">' + U.escapeHTML(p.category) + '</span>'
        : '';
      return '<div class="archive-item">' +
               '<span class="item-date">' + U.escapeHTML(dateText || '') + '</span>' +
               '<a href="' + U.postHref(p.file) + '">' + U.escapeHTML(p.title) + '</a>' +
               category +
             '</div>';
    }
  }
});
