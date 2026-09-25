/* ============================================================
   SSB 背景应用：图片壁纸（wallpapers）
   数据文件：data/wallpapers.json —— { wallpapers:[{file,name,tone}] }
     file  仓库内图片相对路径（assets/wallpapers/ 下，原图不压缩）
     name  显示名称；tone=light|dark 壁纸明暗基调（可自动切主题）
   「参数」无可调项，壁纸库在「应用管理 → 数据」中维护（支持上传）。
   variants 把图库暴露给后台背景选择与右键菜单；具体渲染哪一张由
   SSBScreenBG 解析（作者指定 / 屏级稳定随机 / 访客选择）后经 ctx 传入。
   ============================================================ */
SSBApps.define({
  id: 'wallpapers',
  name: '图片壁纸',
  desc: '全屏图片壁纸库，在「数据」中上传维护，支持明暗基调跟随',
  kind: 'background',
  dataFile: 'data/wallpapers.json',
  variants: function () {
    return U.loadDataFile('data/wallpapers.json')
      .then(function (data) {
        var list = (data && Array.isArray(data.wallpapers)) ? data.wallpapers : [];
        return list.map(function (w) {
          return { value: w.file, label: w.name || String(w.file || '').split('/').pop(), tone: w.tone };
        });
      })
      .catch(function () { return []; });
  },
  render: function (layer, ctx) {
    var file = ctx.variant;
    if (!file) return false;   /* 图库为空等异常：无内容，SSBScreenBG 留空层 */

    layer.classList.add('screen-bg-wallpaper');

    var img = document.createElement('img');
    img.className = 'screen-bg-img';
    img.alt = '';
    /* 加载失败：回退普通底色（移除 wallpaper 类避免遮罩盖住页面） */
    img.addEventListener('error', function () {
      layer.classList.remove('screen-bg-wallpaper');
      layer.classList.add('screen-bg-empty');
      img.remove();
    });
    img.src = U.ROOT + file;
    layer.appendChild(img);

    /* 半透明遮罩：压暗壁纸保证前景文字可读（亮/暗档不同，见 common.css） */
    var overlay = document.createElement('div');
    overlay.className = 'screen-bg-overlay';
    layer.appendChild(overlay);

    /* 静态图片无需运行时清理，仍返回 destroy 保持背景协议一致 */
    return function destroy() {};
  }
});
