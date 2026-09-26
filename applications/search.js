/* ============================================================
   SSB 应用：外站搜索框（search）
   数据文件：data/search-engines.json（{name, url 前缀} 数组）
   引擎选择存 localStorage（多实例共享同一选择）；
   图标用 assets/icons/sites/<域名>.webp 本地副本，无本地图标/加载失败
   固定回退首字母，前台不直连外站 favicon；后台保存时自动匹配。所有 DOM
   操作按 box 作用域，支持多实例
   ============================================================ */
(function () {
  /* 模块私有状态：引擎列表与当前选择在多个搜索实例间共享 */
  var engines = [];
  var currentEngine = 0;

  SSBApps.define({
    id: 'search',
    name: '外站搜索框',
    desc: '可选搜索引擎的大号搜索框，回车/点击新标签页打开结果',
    hero: true,
    dataFile: 'data/search-engines.json',
    configSchema: [],
    css: `
:root {
  --bigsearch-h: 60px;     /* 大搜索框高度 */
  --bigsearch-maxw: 640px; /* 大搜索框最大宽度 */
}
/* 整体是一个 flex 行：引擎选择 | 分隔线 | 输入框 | 搜索按钮 */
.big-search {
  position: relative;
  display: flex;
  align-items: center;
  height: var(--bigsearch-h);
  width: 100%;
  max-width: var(--bigsearch-maxw);
  margin: 0 auto 28px;
  background: var(--surface);
  border-radius: 30px;
  box-shadow: 0 10px 36px rgba(31, 45, 68, .16);
  padding: 0 8px 0 4px;
  text-align: left;
}
/* 左侧搜索引擎选择按钮（含 favicon 或首字母 badge） */
.bs-engine {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  height: 44px;
  padding: 0 16px;
  border: none;
  border-radius: 22px;
  background: transparent;
  font-size: 15.5px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}
.bs-engine:hover { background: var(--bg-soft); }
/* 引擎图标容器：22×22，里面可能是 <img>（favicon）或 <span>（首字母回退） */
.bs-engine .bs-engine-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 下拉箭头 SVG，展开时旋转 180° */
.bs-engine svg {
  width: 14px;
  height: 14px;
  color: var(--text-3);
  transition: transform .2s;
}
.big-search.engine-open .bs-engine svg { transform: rotate(180deg); }
/* 引擎和输入框之间的竖线分隔 */
.bs-divider {
  width: 1px;
  height: 26px;
  background: var(--border);
  flex-shrink: 0;
}
/* 搜索输入框：flex:1 占满剩余空间；min-width:0 防止撑破父容器 */
.bs-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  padding: 0 14px;
  font-size: 16px;
  color: var(--text);
  background: transparent;
}
.bs-input::placeholder { color: var(--text-3); }
/* 右侧圆形搜索按钮 */
.bs-go {
  flex-shrink: 0;
  width: 46px;
  height: 46px;
  border: none;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .2s, transform .15s;
}
.bs-go:hover { background: var(--primary-dark); }
.bs-go:active { transform: scale(.94); }
.bs-go svg { width: 20px; height: 20px; }
/* 引擎下拉菜单（点击 .bs-engine 展开，JS 切换 .engine-open 类） */
.bs-menu {
  position: absolute;
  top: 70px;
  left: 0;
  width: 200px;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border);
  padding: 6px;
  display: none;
  z-index: 5;
}
.big-search.engine-open .bs-menu { display: block; }
/* 菜单里的每个引擎选项 */
.bs-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 7px;
  background: transparent;
  font-size: 15px;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.bs-menu-item:hover {
  background: var(--primary-light);
  color: var(--primary);
}
.bs-menu-item.active {
  color: var(--primary);
  font-weight: 600;
}
.bs-menu-item .bs-engine-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
@media (max-width: 720px) {
  .big-search {
    height: 54px;
    margin-bottom: 20px;
  }
  .bs-engine {
    height: 40px;
    padding: 0 10px;
    font-size: 14px;
  }
  .bs-engine .bs-engine-icon { display: none; }
  .bs-go {
    width: 40px;
    height: 40px;
  }
}
/* 当前屏有背景时：搜索框半透明毛玻璃，透出背景 */
.big-search { transition: background .25s; }
.cur-bg-on .big-search {
  background: rgba(255, 255, 255, .55);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  backdrop-filter: blur(14px) saturate(160%);
}
html[data-theme="dark"].cur-bg-on .big-search {
  background: rgba(18, 22, 30, .5);
}
`,
    render: function (mount) {
      var box = document.createElement('div');
      box.className = 'big-search';
      mount.appendChild(box);

      return U.loadDataFile('data/search-engines.json')
        .then(function (list) {
          engines = list || [];
          if (!engines.length) return;

          /* 记住上次选择的引擎名字，下次打开直接用 */
          var savedName = null;
          try { savedName = localStorage.getItem('bs-engine'); } catch (e) {}
          var savedIdx = engines.findIndex(function (e) { return e.name === savedName; });
          if (savedIdx > -1) currentEngine = savedIdx;

          box.innerHTML =
            '<button class="bs-engine" type="button">' +
              '<span class="bs-engine-icon"></span>' +
              '<span class="bs-engine-name"></span>' +
              U.icon('chevron') +
            '</button>' +
            '<span class="bs-divider"></span>' +
            '<input class="bs-input" type="text" placeholder="输入搜索内容" autocomplete="off">' +
            '<button class="bs-go" type="button" aria-label="搜索">' + U.icon('search') + '</button>' +
            '<div class="bs-menu"></div>';

          renderEngine(box);
          bindSearchEvents(box);
        })
        .catch(function (err) {
          console.error('搜索引擎列表加载失败', err);
          box.remove();
        });
    }
  });

  /* 引擎图标：条目带 __icon（本地已保存未提交的临时匹配）优先用临时 dataURL；
     否则用仓库本地图标 assets/icons/sites/<hostname>.webp（同域快）。
     无 URL/非法协议/加载失败固定回退首字母——运行时不直连外站 favicon。
     img 用 DOM API 创建并以 addEventListener 挂 error（避免在 innerHTML
     字符串里拼接站点名，引号可破坏属性） */
  function engineBadge(item) {
    var name = item.name;
    if (item.__icon) return { type: 'img', src: item.__icon };
    if (!item.url) return { type: 'text', text: (name || '?').slice(0, 1) };
    try {
      var u = new URL(item.url);
      if (!/^https?:$/.test(u.protocol)) return { type: 'text', text: (name || '?').slice(0, 1) };
      return { type: 'img', src: U.ROOT + 'assets/icons/sites/' + u.hostname + '.webp' };
    } catch (e) {
      return { type: 'text', text: (name || '?').slice(0, 1) };
    }
  }

  /* 把本地图标/首字母画进 .bs-engine-icon 容器（当前引擎按钮与菜单项共用） */
  function paintBadge(iconEl, item) {
    iconEl.textContent = '';
    var badge = engineBadge(item);
    if (badge.type === 'img') {
      var img = document.createElement('img');
      img.src = badge.src;
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
      img.addEventListener('error', function () {
        iconEl.textContent = (item.name || '?').slice(0, 1);
      });
      iconEl.appendChild(img);
    } else {
      iconEl.textContent = badge.text;
    }
  }

  function renderEngine(box) {
    var e = engines[currentEngine];
    paintBadge(box.querySelector('.bs-engine-icon'), e);
    box.querySelector('.bs-engine-name').textContent = e.name;

    box.querySelector('.bs-menu').innerHTML = engines.map(function (item, i) {
      return '<button class="bs-menu-item' + (i === currentEngine ? ' active' : '') +
             '" type="button" data-idx="' + i + '">' +
               '<span class="bs-engine-icon"></span>' +
               '<span>' + U.escapeHTML(item.name) + '</span>' +
             '</button>';
    }).join('');
    /* 菜单项图标需逐个 DOM 绘制（含 img 失败回退） */
    box.querySelectorAll('.bs-menu-item').forEach(function (btn) {
      var item = engines[Number(btn.dataset.idx)];
      paintBadge(btn.querySelector('.bs-engine-icon'), item);
    });
  }

  function bindSearchEvents(box) {
    var input = box.querySelector('.bs-input');

    box.querySelector('.bs-engine').addEventListener('click', function (e) {
      e.stopPropagation();
      /* 多实例：切换一个实例时同步其他实例的菜单开合状态无意义，只控自己 */
      box.classList.toggle('engine-open');
    });

    box.querySelector('.bs-menu').addEventListener('click', function (e) {
      var btn = e.target.closest('.bs-menu-item');
      if (!btn) return;
      currentEngine = Number(btn.dataset.idx);
      try { localStorage.setItem('bs-engine', engines[currentEngine].name); } catch (err) {}
      /* 同步刷新页面上所有搜索实例的引擎外观 */
      document.querySelectorAll('.big-search').forEach(function (b) {
        if (b.querySelector('.bs-menu').children.length) renderEngine(b);
      });
      box.classList.remove('engine-open');
      input.focus();
    });

    /* 点击搜索框外部 → 关闭所有下拉菜单（全页只绑一次） */
    if (!window.__bsOutsideBound) {
      window.__bsOutsideBound = true;
      document.addEventListener('click', function (e) {
        if (e.target && typeof e.target.closest === 'function' &&
            e.target.closest('.big-search')) return;
        document.querySelectorAll('.big-search.engine-open').forEach(function (b) {
          b.classList.remove('engine-open');
        });
      });
    }

    function go() {
      var kw = input.value.trim();
      var engine = engines[currentEngine];
      var url = engine.url + (kw ? encodeURIComponent(kw) : '');
      window.open(url, '_blank', 'noopener');
    }

    box.querySelector('.bs-go').addEventListener('click', go);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') go();
    });
  }
})();
