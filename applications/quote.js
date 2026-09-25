/* ============================================================
   SSB 应用：随机名言（quote）
   数据文件：data/quotes.json（一行一条）
   硬性规则：预留 N 行高度；超过 N 行字号自动缩小直到容下，绝不截断
   ============================================================ */
SSBApps.define({
  id: 'quote',
  name: '随机名言',
  desc: '从名言库随机取一条，打字机效果逐字展示',
  hero: true,
  dataFile: 'data/quotes.json',
  configSchema: [
    { key: 'speed', label: '打字速度（每字间隔毫秒，越小越快）', type: 'number', min: 0, max: 1000, step: 10, def: 60 },
    { key: 'lines', label: '预留行数（超出自动缩小字号，绝不截断）', type: 'number', min: 1, max: 6, step: 1, def: 3 },
    { key: 'lineHeight', label: '行高（em，需与下方 CSS 的 line-height 保持一致）', type: 'number', min: 1, max: 3, step: 0.1, def: 1.7 },
    { key: 'fsMax', label: '起始字号 px', type: 'number', min: 14, max: 40, step: 1, def: 22 },
    { key: 'fsMin', label: '最小字号 px', type: 'number', min: 10, max: 30, step: 1, def: 13 }
  ],
  css: `
:root {
  --quote-fs: 22px;        /* 名言字号（JS 自适应会内联覆盖） */
  /* 标语描边色：取当前模式的页面底色、略透明。
     标语压在粒子/壁纸背景上，容易被背景花纹干扰；
     一圈与底色同色的细描边把字形「切」出背景，又不发光、不发糊 */
  --quote-stroke: rgba(255, 255, 255, .78);
}
html[data-theme="dark"] {
  --quote-stroke: rgba(15, 18, 23, .82);
}
/* 3 行高度预留（硬性规则）：min-height = N × 行高，em 跟随元素自身
   字号，JS 缩小字号时预留高度同步缩放。flex-end 底对齐：文字换行
   时向上生长，不影响下方内容位置 */
.hero-quote {
  width: 100%;
  max-width: 680px;
  min-height: calc(1.7em * 3);
  margin: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  font-size: var(--quote-fs);
  font-weight: 700;
  color: var(--text-2);
  text-align: center;
  line-height: 1.7;
  overflow: hidden;
  /* 8 方向 1px、0 模糊 = 纯色细描边（不是发光阴影）：
     描边色随亮/暗主题切换；量很小，近看只有一圈干净轮廓 */
  text-shadow:
    -1px -1px 0 var(--quote-stroke),
     1px -1px 0 var(--quote-stroke),
    -1px  1px 0 var(--quote-stroke),
     1px  1px 0 var(--quote-stroke),
     0   -1px 0 var(--quote-stroke),
     0    1px 0 var(--quote-stroke),
    -1px  0   0 var(--quote-stroke),
     1px  0   0 var(--quote-stroke);
}
/* 打字过程中显示光标（CSS 动画闪烁） */
.hero-quote.typing::after {
  content: '|';
  color: var(--text-2);
  margin-left: 2px;
  animation: q-cursor-blink 0.9s step-end infinite;
}
/* 打完后光标自动消失（JS 把 typing 类移除） */
@keyframes q-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
`,
  render: function (mount, ctx) {
    var conf = ctx.cfg || {};
    /* 打字速度：应用参数表单维护（schema 默认 60ms） */
    var SPEED = conf.speed != null ? Number(conf.speed) : 60;
    var LINES = Number(conf.lines) || 3;
    var LINE_HEIGHT = Number(conf.lineHeight) || 1.7;
    var FS_MAX = Number(conf.fsMax) || 22;
    var FS_MIN = Number(conf.fsMin) || 13;

    var el = document.createElement('p');
    el.className = 'hero-quote';
    mount.appendChild(el);

    return U.loadDataFile('data/quotes.json')
      .then(function (arr) {
        if (!arr || !arr.length) return;
        var text = arr[Math.floor(Math.random() * arr.length)];
        fitQuoteLines(el, text);
        typeWriter(el, text, SPEED);
      })
      .catch(function () { el.remove(); });

    /* 字号自适应：让 text 在 LINES 行内容下。
       必须在打字机开始前完成（此时 el 已在 DOM 中，可以测量） */
    function fitQuoteLines(el, text) {
      var fs = FS_MAX;
      el.style.fontSize = fs + 'px';
      el.textContent = text;   /* 临时放入完整文字用于测量，随后打字机会重置 */
      var maxH = Math.round(LINES * LINE_HEIGHT * fs);
      while (el.scrollHeight > maxH + 1 && fs > FS_MIN) {
        fs -= 1;
        el.style.fontSize = fs + 'px';
        maxH = Math.round(LINES * LINE_HEIGHT * fs);
      }
    }

    /* 打字机：逐字追加，末尾闪烁光标，打完移除 .typing 类（CSS ::after 消失） */
    function typeWriter(el, text, speed) {
      var i = 0;
      el.textContent = '';
      el.classList.add('typing');
      function step() {
        if (i < text.length) {
          el.textContent += text.charAt(i);
          i++;
          setTimeout(step, speed);
        } else {
          el.classList.remove('typing');
        }
      }
      step();
    }
  }
});
