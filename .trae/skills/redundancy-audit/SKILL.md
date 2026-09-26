---
name: redundancy-audit
description: Audit this static blog for redundant code and clean selected items after confirmation. Use for redundancy, dead-code, legacy-branch, duplicate-implementation cleanup, or a small-and-refined pass. Do not use for feature development or generic code review.
---

# Redundancy Audit（静态博客冗余清理）

目标：在不破坏项目正常运行的前提下，让项目保持「小且精」。流程是**先审计出报告，用户勾选后才清理**，绝不边扫边改。

## 一、审计的四类目标

- **A 旧数据迁移 / 兜底**：localStorage 偏好的版本迁移、旧 schema 字段映射、`oldField || newField` 回退链。
- **B legacy 分支 / 死代码**：normalize 路径里针对异常旧结构的补救分支、未被调用的导出与函数。
- **C 跨文件重复实现**：同构 HTML 行构建、规则读取、剪贴板、下拉框、列表合并等。
- **D 隐性正确性缺陷**：清洗结果算出来却没用、静默吞错之类（发现即单列为疑似 bug，不修只报）。

## 二、工作流程

1. **只读取证**：用 Grep/Glob 定位，Read 核对；范围大或跨模块时可并行派发 search 子代理。不做任何修改。
2. **出编号清单**：每项给编号（A1、B2…）、文件与行号、现状、风险、建议动作。结尾列出「未改动/存疑」项。
3. **等用户勾选**：用户明确指定编号后才动；未选中的保持原样。
4. **最小补丁清理**：优先 Edit，只动目标点；不重构周边、不顺手改风格。
5. **验证**：
   - 改完调用 GetDiagnostics。
   - 浏览器实测（服务器 localhost:4321，勿重复启动；后台任务已在运行）：前台首页、`page.html?slug=` 动态页、`posts/*.html` 文章页、`/admin/` 后台相关视图，控制台无新增 error。
   - 注入脏数据验证清洗类改动；测完清掉测试用 localStorage / 草稿，确认待提交区没有幻影登记。
6. **汇报**：列明每项改动、实测结果、剩余未改动项。

## 三、本仓库的硬约定（清理时必须遵守）

### 脚本加载矩阵——抽 helper 前先核对，本仓库最大的回归来源

| 运行环境 | 加载的脚本 |
|---|---|
| 首页 / `page.html` 动态页 | common.js **+ apps.js** |
| 文章页 `posts/*.html` | common.js + post.js + context-menu.js（**无 apps.js**）|
| 后台 `/admin/` | apps.js + admin.js（**无 common.js**）|

- 前台与后台共享的 helper 只有在**所有消费页面都加载该文件**时才能抽取。文章页不加载 apps.js，所以 common.js 依赖的逻辑**不能**放进 apps.js（曾因此导致 getPosts 抛错、文章页上一篇/下一篇静默消失）。
- 前后台两份 ~8 行的轻度重复若处于脚本集合不相交的边界，保留重复并加注释说明，不要为消除重复强行共享或给页面加载整个引擎。

### 数据与偏好

- 不做任何版本迁移逻辑：旧格式一律改为**合法性校验**，非法值（含老访客缓存）直接丢弃并回落作者默认。
- 背景约定：无背景 = 不带 bg 字段；粒子 = `{app:'particles'}`；禁止 `{type:'none'}`。
- localStorage 键：`ssb.bg-pref`、`ssb.local.posts`、`ssb.local.pending`、`ssb.local.app.pages`。
- 本地完全独立：代码只读相对路径；GitHub API 仅用于后台提交写入。

### 渲染健壮性

- 依赖异步数据的渲染链路（如文章 pager）必须有错误可见性（至少 console.error），数据源失败不许无声跳过。
- 数据层不替异常数据做结构假设；需要兜底时由渲染端/编辑器就地处理。

## 四、操作经验

- 后台编辑器里同名控件可能分属不同容器（如 `t-rule-add` 在模板编辑器内、`resp-rule-add` 在附件编辑器内），测试前先确认点到了目标容器，用容器限定选择器。
- 快速切换标签时的 `net::ERR_ABORTED`（图标、文档请求）是旧请求被取消，不是文件缺失；用独立新请求 onload 验证文件真实可用性。
- browser_evaluate 复杂异步：结果写 `window.__result` 再读；避免多层模板字符串嵌套，拆成简单单行语句。
- 清理不产生 commit；所有改动由用户在 GitHub Desktop 核对后自行提交。
