/* ============================================================
   SSB 应用：富文本内容（rich-content）
   正文 html 存在实例 cfg.html 中（与文章正文同一信任级别）。
   可重复添加，每个实例存自己的正文。
   排版复用文章页 .post-content 样式（post.css，容器页均已引入），
   因此本应用无需自带 CSS
   ============================================================ */
SSBApps.define({
  id: 'rich-content',
  name: '富文本内容',
  desc: '自由排版的 HTML 内容块，正文在「页面管理」的实例上编辑',
  hero: false,
  configSchema: [],
  css: '',
  render: function (mount, ctx) {
    var html = ctx.cfg && ctx.cfg.html;
    if (!html || !String(html).trim()) return false;
    mount.innerHTML = '<div class="rich-content-body post-content">' + html + '</div>';
  }
});
