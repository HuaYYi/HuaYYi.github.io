/* ============================================================
   SSB 背景应用：颜色壁纸（colors）
   数据文件：data/bg-colors.json —— { colors:[{value,name,tone}] }
     value  CSS 背景值：纯色（#ffffff）/ 渐变（linear-gradient(...)）等；
            特殊值 'none' = 无背景（访客选它即清空屏背景，
            右键弹窗因此不再需要单独的「无背景」开关）
     name   显示名称；tone=light|dark 明暗基调（可自动切主题），空=不切换
   颜色/渐变零加载成本：弹窗格子直接用内联 background 实时预览，
   不参与图片/视频那套按需缓存。
   ============================================================ */
SSBApps.define({
  id: 'colors',
  name: '颜色壁纸',
  desc: '纯色/渐变色背景库，含「无」（无背景）；在「数据」中维护',
  kind: 'background',
  dataFile: 'data/bg-colors.json',
  variants: function () {
    return U.loadDataFile('data/bg-colors.json')
      .then(function (data) {
        var list = (data && Array.isArray(data.colors)) ? data.colors : [];
        return list.map(function (c) {
          return { value: c.value, label: c.name || c.value, tone: c.tone };
        });
      })
      .catch(function () { return []; });
  },
  render: function (layer, ctx) {
    var v = ctx.variant;
    /* 'none' 与空值都表示无背景：返回 false，SSBScreenBG 留空层 */
    if (!v || v === 'none') return false;
    layer.style.background = v;
    return function destroy() {
      layer.style.background = '';
    };
  }
});
