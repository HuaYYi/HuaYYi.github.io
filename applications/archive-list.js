/* ============================================================
   SSB 应用：归档列表（archive-list）
   cfg = schema 默认 ∪ pages.json 的 apps['archive-list'] ∪ 实例 cfg
   groupBy=year|month|flat / filters=分类筛选条 / order=newest|oldest
   筛选状态闭包在实例内，支持同页多个归档列表
   ============================================================ */
SSBApps.define({
  id: 'archive-list',
  name: '归档列表',
  desc: '按年/月分组的文章归档，可带分类筛选条',
  hero: false,
  configSchema: [
    { key: 'groupBy', label: '分组方式', type: 'select',
      options: [['year', '按年 → 月分组'], ['month', '按年-月分组'], ['flat', '平铺不分组']], def: 'year' },
    { key: 'order', label: '排序', type: 'select',
      options: [['newest', '最新在前'], ['oldest', '最早在前']], def: 'newest' },
    { key: 'filters', label: '显示分类筛选条', type: 'boolean', def: true }
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
`,
  render: function (mount, ctx) {
    var conf = ctx.cfg || {};
    var activeCat = '全部';
    var allPosts = [];

    var wrap = document.createElement('div');
    wrap.className = 'archive-list-app';
    wrap.innerHTML = '<div class="archive-filters"></div>' +
      '<div class="archive-list-body"><p class="list-loading">加载中…</p></div>';
    mount.appendChild(wrap);
    var bar = wrap.querySelector('.archive-filters');
    var body = wrap.querySelector('.archive-list-body');

    return U.getPosts()
      .then(function (posts) {
        allPosts = posts.slice();
        if (conf.order === 'oldest') allPosts.reverse();

        if (!allPosts.length) {
          body.innerHTML = '<p class="list-empty">还没有文章。</p>';
          return;
        }
        renderArchFilters();
        renderArchList(allPosts);
      })
      .catch(function (err) {
        console.error(err);
        body.innerHTML = '<p class="list-empty">文章列表加载失败：posts-list.json</p>';
      });

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
        var filtered = activeCat === '全部'
          ? allPosts
          : allPosts.filter(function (p) { return (p.category || '未分类') === activeCat; });
        renderArchList(filtered);
      });
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

      /* 默认 year：年 → 月两级分组 */
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
