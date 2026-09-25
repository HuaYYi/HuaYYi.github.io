/* ============================================================
   SSB 背景应用：循环视频（videos）
   数据文件：data/bg-videos.json —— { videos:[{file,name,tone}] }
     file  仓库内视频相对路径（建议放 assets/videos/，mp4/webm）
     name  显示名称；tone=light|dark 视频明暗基调（可自动切主题）
   视频文件体积大，后台「数据」只做登记：先把视频文件放进仓库目录，
   再新增一条记录（不经浏览器上传，避免超大 base64 提交失败）。
   ============================================================ */
SSBApps.define({
  id: 'videos',
  name: '循环视频',
  desc: '全屏循环静音视频背景，在「数据」中登记维护',
  kind: 'background',
  dataFile: 'data/bg-videos.json',
  variants: function () {
    return U.loadDataFile('data/bg-videos.json')
      .then(function (data) {
        var list = (data && Array.isArray(data.videos)) ? data.videos : [];
        return list.map(function (v) {
          return { value: v.file, label: v.name || String(v.file || '').split('/').pop(), tone: v.tone };
        });
      })
      .catch(function () { return []; });
  },
  render: function (layer, ctx) {
    var file = ctx.variant;
    if (!file) return false;

    var v = document.createElement('video');
    v.className = 'screen-bg-img';
    v.src = U.ROOT + file;
    v.autoplay = true;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    /* 加载失败：回退普通底色 */
    v.addEventListener('error', function () {
      layer.classList.add('screen-bg-empty');
      v.remove();
    });
    layer.appendChild(v);

    /* 屏不可见时暂停播放省 CPU，可见时恢复（静音自动播放一般不会被拦） */
    var io = null;
    if (ctx.section && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(function (entries) {
        var visible = entries[0] && entries[0].isIntersecting;
        if (visible) {
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        } else {
          v.pause();
        }
      }, { threshold: 0.02 });
      io.observe(ctx.section);
    }

    return function destroy() {
      try { v.pause(); } catch (e) {}
      if (io) io.disconnect();
    };
  }
});
