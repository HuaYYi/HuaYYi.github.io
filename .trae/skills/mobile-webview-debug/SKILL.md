---
name: mobile-webview-debug
description: 排查本静态博客在手机浏览器（安卓 WebView 内核，如 X浏览器）上的视觉兼容问题，包括强制变暗、点击高亮方块、原生控件不绘制、尺寸布局差异。用户反馈手机端与桌面端表现不一致时使用。不用于站点功能开发或纯桌面端问题。
---

# 手机 WebView 视觉兼容排查

本技能解决「桌面 Chromium 正常、手机安卓 WebView 异常」的视觉问题。
本地服务器：PowerShell `scripts\serve.ps1`（端口 4321；启动报 prefix 冲突说明旧实例仍存活，直接用）。

## 工作流

1. **先拿运行时证据，再改代码**。不要凭现象猜：用 375px iframe 探针在桌面复现媒体查询/布局层；浏览器内核专有行为复现不了时，按「已知坑位」逐条比对。
2. **只改权威位置**：亮暗/控件兼容样式收敛进 `assets/css/common.css`（变量块、基础重置、对应组件规则），不要在多个文件写重复规则。
3. **改后量化验证**：读 `getComputedStyle` 值，不要只靠截图；视觉类再补一张截图。
4. **探针文件用完即删**（仓库根的 `_probe.html` 不能进提交）；提醒用户 GitHub Desktop 推送 + 手机强刷（X浏览器缓存顽固，必要时清缓存）。

## 375px 探针用法

把 `assets/probe.template.html` 复制为仓库根 `_probe.html`，浏览器打开：

- `_probe.html?p=posts/native-js-blog.html&dark=1`（模拟系统暗色）
- `_probe.html?p=index.html`（默认亮色系统）

iframe 同域，375px 下媒体查询按窄屏生效；页面靠 `clientWidth<560` 兜底注入的「⋯」按钮也会出现。
验证脚本在**顶层 return**（IIFE 会返回 undefined），例如：

```js
return window.probe(function (w) {
  var d = w.document, hb = d.getElementById('hamburger');
  return {
    display: w.getComputedStyle(hb).display,
    rect: hb.getBoundingClientRect().width + 'x' + hb.getBoundingClientRect().height
  };
});
```

注意：合成 contextmenu/MouseEvent 的 target 可能是 document（无 `closest`），要在 `elementFromPoint(x,y)` 等真实元素上派发；`getComputedStyle` 在 window 上、不在 document 上。

## 已知坑位与标准解法（本仓库实测）

| 现象 | 根因 | 解法 |
|---|---|---|
| 手机暗色系统下选亮色仍暗、手动暗色「更暗」 | WebView FORCE_DARK_AUTO 算法强制压暗，无视 data-theme | `html{color-scheme:only light}` + `html[data-theme="dark"]{color-scheme:dark}`，声明亮暗作者自理；旧内核忽略无副作用 |
| 点链接/卡片/按钮出现方块高亮 | WebView 默认触摸高亮层 | `html{-webkit-tap-highlight-color:transparent}`（可继承，全站一次生效） |
| 汉堡按钮区域可点但三条线不可见 | 原生 button 外观下自定义子元素不绘制 | 按钮加 `-webkit-appearance:none`，内部 span 显式 `width:100%`（不依赖 flex 拉伸） |
| 首页标语被背景花纹干扰 | 文字压在粒子/彩圆上缺对比 | 主题感知细描边：8 方向 1px、**0 模糊** text-shadow（用户要描边、不要发光模糊） |
| 窄屏目录抽屉打开后关不掉 | 只有点目录链接才收起，缺遮罩关闭入口 | post.js 注入 `#toc-mask`（点击移除 toc-open），post.css 窄屏块内按 `body.toc-open #toc-mask` 淡入，z-index 94 低于抽屉 95 |
| 遮罩/浮层看不见也点不到 | 旧 WebView（Chrome 87 前）不认 `inset` 简写，元素尺寸为 0 | 保留 inset 同时显式写 `top/right/bottom/left:0` 兜底；common.css 的 .drawer-mask 同理 |

## 排查新问题时的检查顺序

1. computed style：`display/visibility/opacity/z-index/-webkit-appearance`；
2. 几何证据：`getBoundingClientRect()` + `elementFromPoint(中心)`（被遮挡/被裁切/同色不可见）；
3. 主题变量是否被暗色块重映射、是否存在同名选择器重复定义；
4. 浏览器内核专有行为：`color-scheme`、`tap-highlight`、`appearance`、`-webkit-` 前缀；
5. 仍无法解释 → 提示用户检查浏览器**自有设置**（夜间模式/工具箱开关独立于站点主题，站点无法控制）。

## 边界

- 仅排查视觉兼容，不重构组件、不改主题三态的数据结构（LS key `ssb.theme`：auto/light/dark）。
- 后台 `/admin/` 不接管右键菜单；不在后台目录套用本流程。
