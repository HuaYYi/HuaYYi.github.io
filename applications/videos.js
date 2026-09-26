/* ============================================================
   SSB 背景应用：动态壁纸（videos）
   数据文件：data/bg-videos.json —— { videos:[{file,name,tone}] }
     file  仓库内视频相对路径（建议放 assets/videos/，mp4/webm）
     name  显示名称；tone=light|dark 视频明暗基调（可自动切主题）
   视频文件体积大，后台「数据」只做登记：先把视频文件放进仓库目录，
   再新增一条记录（不经浏览器上传，避免超大 base64 提交失败）。
   切换体验：新片就绪前旧片继续在画面上播放（.video-linger 短暂占位），
   就绪瞬间交接；播放过的视频入池复用，来回切换秒切。
   ============================================================ */
SSBApps.define({
  id: 'videos',
  name: '动态壁纸',
  desc: '全屏循环静音视频背景，在「数据」中登记维护',
  kind: 'background',
  dataFile: 'data/bg-videos.json',
  css: `
/* 切换期间旧片在屏内的短暂占位：定位与 .screen-bg 相同 */
.video-linger {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  transition: opacity .25s;
}
.screen-bg-img { transition: opacity .25s; }
/* 首帧缩略图：铺满方式与视频一致，压在视频下层做加载期兜底 */
.video-poster {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  filter: blur(2px);            /* 低清小图轻微模糊，等待视频接管 */
  transition: opacity .3s;
}
`,
  variants: function () {
    return U.loadDataFile('data/bg-videos.json')
      .then(function (data) {
        var list = (data && Array.isArray(data.videos)) ? data.videos : [];
        posterMap = {};
        return list.map(function (v) {
          if (v.posterURL) posterMap[v.file] = v.posterURL;
          return { value: v.file, label: v.name || String(v.file || '').split('/').pop(), tone: v.tone };
        });
      })
      .catch(function () { return []; });
  },
  render: function (layer, ctx) {
    var file = ctx.variant;
    var section = ctx.section;
    if (!file) return false;

    /* 接管上一次未到期的占位旧片（clearLayer 已销毁旧控制器，但元素
       被我们移出 layer 暂存在屏内） */
    var linger = lingerMap.get(section);
    if (linger) { clearTimeout(linger.timer); lingerMap.delete(section); }
    var pendingOld = linger && linger.el;

    var v;
    if (pendingOld && pendingOld.dataset.file === file) {
      /* 切回的就是占位片本身：直接取回 */
      v = pendingOld;
      pendingOld = null;
      v.classList.remove('video-linger');
    } else {
      v = pool.has(file) ? pool.get(file) : makeVideo(file);
      pool.delete(file);

      if (pendingOld) {
        if (v.readyState >= 3) {
          /* 池内复用，立即可播：旧片直接回收，无空白 */
          recycle(pendingOld.dataset.file, pendingOld);
          pendingOld = null;
        } else {
          /* 新片下载期间保持透明，旧片继续可见，canplay 瞬间交接 */
          v.style.opacity = '0';
          v.addEventListener('canplay', function onReady() {
            v.removeEventListener('canplay', onReady);
            v.style.opacity = '';
            if (pendingOld && pendingOld.parentNode) pendingOld.remove();
            if (pendingOld) recycle(pendingOld.dataset.file, pendingOld);
            pendingOld = null;
          });
          v.addEventListener('error', function onErr() {
            v.removeEventListener('error', onErr);
            layer.classList.add('screen-bg-empty');
            if (v.parentNode) v.remove();
            /* 保留旧片兜底：登记为普通占位，到期后入池 */
            if (pendingOld && pendingOld.parentNode) registerLinger(section, pendingOld);
            pendingOld = null;
          });
        }
      } else {
        /* 无旧片可占位（首次开启背景）：加载失败回退底色 */
        v.addEventListener('error', function () {
          layer.classList.add('screen-bg-empty');
          if (v.parentNode) v.remove();
        });
      }
    }

    layer.appendChild(v);

    /* 首帧缩略图兜底：视频未可播时先把海报铺满，canplay 瞬间视频淡入盖住，
       避免「开启背景 → 视频下载期间一片空白」的等待 */
    var posterEl = null;
    var posterURL = posterMap[file] || '';
    if (posterURL && v.readyState < 3) {
      posterEl = document.createElement('img');
      posterEl.className = 'screen-bg-img video-poster';
      posterEl.src = posterURL;
      posterEl.alt = '';
      layer.appendChild(posterEl);
      v.style.opacity = '0';
      var onPosterReady = function () {
        v.removeEventListener('canplay', onPosterReady);
        v.style.opacity = '';
        /* 视频画面稳定后淡出海报再移除，避免闪 */
        setTimeout(function () {
          if (posterEl) {
            posterEl.style.opacity = '0';
            setTimeout(function () { if (posterEl && posterEl.parentNode) posterEl.remove(); }, 300);
          }
        }, 120);
      };
      v.addEventListener('canplay', onPosterReady);
      v.addEventListener('error', function () {
        if (posterEl && posterEl.parentNode) posterEl.remove();
      });
    }

    try { v.currentTime = 0; } catch (e) {}
    var p = v.play();
    if (p && p.catch) p.catch(function () {});

    /* 屏不可见时暂停播放省 CPU，可见时恢复（静音自动播放一般不会被拦） */
    var io = null;
    if (section && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(function (entries) {
        var visible = entries[0] && entries[0].isIntersecting;
        if (visible) {
          var pp = v.play();
          if (pp && pp.catch) pp.catch(function () {});
        } else {
          v.pause();
        }
      }, { threshold: 0.02 });
      io.observe(section);
    }

    var destroyed = false;
    return function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (io) io.disconnect();
      if (posterEl && posterEl.parentNode) posterEl.remove();
      try { v.pause(); } catch (e) {}

      /* 新片未就绪就被销毁：先把它的占位旧片收回，避免旧片无主永驻 */
      if (pendingOld) {
        if (pendingOld.parentNode) pendingOld.remove();
        recycle(pendingOld.dataset.file, pendingOld);
        pendingOld = null;
      }

      if (section && v.parentNode === layer && document.body.contains(section)) {
        /* 移出 layer（紧接着 innerHTML 会清空它），在屏内短暂占位：
           新的 videos render 会立刻接管；否则到期入池 */
        v.classList.add('video-linger');
        section.appendChild(v);
        registerLinger(section, v);
      } else {
        recycle(file, v);
      }
    };
  }
});

/* ---------- 模块私有：视频池 + 占位登记 ---------- */
var pool = new Map();        /* file → 已下载、detached 的视频元素 */
var lingerMap = new Map();   /* section → { el, timer } */
var posterMap = {};          /* file → 首帧缩略图 dataURL（variants 时填充） */

function makeVideo(file) {
  var v = document.createElement('video');
  v.className = 'screen-bg-img';
  v.dataset.file = file;
  v.src = U.ROOT + file;
  v.autoplay = true;
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  return v;
}

/* 入池：暂停、摘除、复位透明度；池内元素保留解码数据，复用瞬时可播 */
function recycle(file, v) {
  try { v.pause(); } catch (e) {}
  if (v.parentNode) v.remove();
  v.classList.remove('video-linger');
  v.style.opacity = '';
  if (file) pool.set(file, v);
}

function registerLinger(section, el) {
  var timer = setTimeout(function () {
    lingerMap.delete(section);
    recycle(el.dataset.file, el);
  }, 600);
  lingerMap.set(section, { el: el, timer: timer });
}
