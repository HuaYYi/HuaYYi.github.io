/* ============================================================
   SSB 应用：顶部公告条（notice）
   ------------------------------------------------------------
   应用文件约定（所有 applications/*.js 相同）：
     SSBApps.define({
       id, name, desc, hero, dataFile, configSchema, css, render
     })
     - render(mount, ctx)：mount=挂载点 DOM；ctx.cfg=配置（schema 默认
       ∪ data/pages.json 的 apps[id] ∪ 实例 cfg 三层合并）；返回 false
       表示无内容（引擎自动移除挂载壳）；可返回 Promise 或销毁函数
     - 依赖注入：函数内可直接用 BlogUtils（别名 U），无需 import
     - 仓库文件即唯一基线：本地模式
       下改坏了可一键丢弃本浏览器修改、恢复为仓库版本
   ============================================================ */
SSBApps.define({
  id: 'notice',
  name: '顶部公告条',
  desc: 'Hero 区的胶囊式公告，文字留空则自动隐藏',
  hero: true,
  configSchema: [
    { key: 'text', label: '公告文字（留空 = 隐藏）', type: 'textarea', def: '' }
  ],
  css: `
.hero-notice {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 22px;
  font-size: 14.5px;
  font-weight: 400;        /* h1 语义但视觉是胶囊提示条，压回常规字重 */
  margin: 0;
  color: var(--text);
  background: var(--primary-light);
  border-radius: 999px;
}
/* 公告左侧的蓝色小竖条，纯装饰 */
.hero-notice .notice-bar {
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: var(--primary);
  flex-shrink: 0;
}
@media (max-width: 720px) {
  .hero-notice {
    padding: 7px 16px;
    font-size: 13px;
  }
}
`,
  render: function (mount, ctx) {
    /* 公告文字：应用参数表单维护（留空=隐藏） */
    var text = ctx.cfg.text != null ? ctx.cfg.text : '';
    text = String(text).trim();
    if (!text) return false;   /* 没文字不渲染（留空则隐藏） */
    mount.innerHTML = '<h1 class="hero-notice"><span class="notice-bar"></span>' +
      U.escapeHTML(text) + '</h1>';
  }
});
