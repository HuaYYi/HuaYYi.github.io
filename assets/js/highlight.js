/* ============================================================
   highlight.js —— 零依赖代码高亮（约 100 行）
   由 post.js 检测到 <pre><code> 后动态注入，脚本加载即执行，
   本地文章（posts/view.html）同样生效。

   设计取舍：
   - 只做「词法级」着色（注释 / 字符串 / 关键字 / 数字），
     不做语法树解析。JS、JSON、CSS、HTML 混排都能得到七八成像样效果，
     体积为 0 依赖、零网络请求，比引入 Prism/highlight.js（上百 KB）划算。
   - 先 escape HTML 再分词，避免代码里的 < / & 被当成标签。
   - 颜色用语义 class（tok-*），深浅色主题在 post.css 里分别给色值。
   ============================================================ */

(function () {
  'use strict';

  /* JS 系关键字（含 ES2017 async/await）；刻意保持精简，
     命中太多反而花。CSS 属性值、HTML 标签不染色也很干净 */
  var KEYWORDS = (
    'var let const function return if else for while do switch case break continue ' +
    'new try catch finally throw typeof instanceof in of this class extends super ' +
    'import export default async await yield delete void static get set ' +
    'true false null undefined NaN Infinity'
  ).split(' ');

  /* 一条正则走完：注释 | 字符串 | 关键字 | 数字。
     字符串匹配内含转义处理，避免引号配对错乱 */
  var TOKEN_RE = new RegExp(
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)' +                    // 1 注释
    '|("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)' + // 2 字符串
    '|\\b(' + KEYWORDS.join('|') + ')\\b' +                       // 3 关键字
    '|\\b(0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b',                   // 4 数字
    'g'
  );

  var CLASS_BY_GROUP = ['', 'tok-com', 'tok-str', 'tok-kw', 'tok-num'];

  function escapeHTML(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlightText(code) {
    /* 先转义，后续正则在纯文本上跑，&lt; 之类不会被误当标签 */
    var safe = escapeHTML(code);
    var out = '';
    var last = 0;
    var m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(safe)) !== null) {
      out += safe.slice(last, m.index);
      /* 找到命中的是第几个捕获组，决定 span 类型 */
      var cls = '';
      for (var g = 1; g < m.length; g++) {
        if (m[g] !== undefined) { cls = CLASS_BY_GROUP[g]; break; }
      }
      out += cls ? '<span class="' + cls + '">' + m[0] + '</span>' : m[0];
      last = m.index + m[0].length;
      if (m[0].length === 0) TOKEN_RE.lastIndex++;  /* 防御零宽死循环 */
    }
    out += safe.slice(last);
    return out;
  }

  function highlightAll(root) {
    var blocks = (root || document).querySelectorAll('pre code');
    Array.prototype.forEach.call(blocks, function (el) {
      /* data-highlighted 防重复高亮（视图切换/热加载场景） */
      if (el.getAttribute('data-highlighted')) return;
      el.setAttribute('data-highlighted', '1');
      el.innerHTML = highlightText(el.textContent);
    });
  }

  window.SSBHighlight = { all: highlightAll, text: highlightText };

  /* post.js 动态插入本脚本时 DOMContentLoaded 早已触发，
     所以直接自执行一次即可 */
  highlightAll();
})();
