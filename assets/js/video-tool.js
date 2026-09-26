/* ============================================================
   video-tool.js —— 后台「视频压缩工具」界面逻辑（仅后台加载）
   ============================================================
   交互：拖放/选文件 → 预览与源信息 → 设置 质量/分辨率/帧率/倍速/
   输出格式（选项按本机编码能力过滤）→ 实时预估大小 → 开始压缩 →
   下载成品。压缩核心在 video-compress.js（SSBVideo.transcode）。
   ============================================================ */

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function even(n) { return Math.max(2, n - (n % 2)); }

  function fmtSize(bytes) {
    if (bytes < 1048576) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
  function fmtDur(s) {
    var m = Math.floor(s / 60);
    var ss = Math.round(s % 60);
    return (m ? m + ' 分 ' : '') + ss + ' 秒';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var state = {
    file: null, info: null,
    srcURL: null, resultURL: null,
    containers: [], busy: false
  };

  /* 按当前选项推导输出规格（预估与实际压缩共用同一口径） */
  function planned() {
    var info = state.info;
    var longEdge = Number($('vt-resolution').value);
    var scale = longEdge
      ? Math.min(1, longEdge / Math.max(info.width, info.height)) : 1;
    var w = even(Math.round(info.width * scale));
    var h = even(Math.round(info.height * scale));
    var quality = $('vt-quality').value;
    var speed = Number($('vt-speed').value);
    var container = $('vt-format').value || 'mp4';
    return {
      w: w, h: h,
      bitrate: SSBVideo.bitrateFor(w, h, quality),
      speed: speed,
      outDur: info.duration / speed,
      fps: Number($('vt-fps').value),
      container: container
    };
  }

  function refreshAnalysis() {
    if (!state.info) return;
    var p = planned();
    var estBytes = p.bitrate * p.outDur / 8;
    $('vt-analysis').innerHTML =
      '<span>输出分辨率：' + p.w + ' × ' + p.h + '</span>' +
      '<span>帧率：' + (p.fps ? p.fps + ' fps' : '保持原始') + '</span>' +
      '<span>倍速：' + p.speed + '×（输出时长约 ' + fmtDur(p.outDur) + '）</span>' +
      '<span>输出格式：' + p.container.toUpperCase() +
        '，目标码率 ' + (p.bitrate / 1e6).toFixed(1) + ' Mbps</span>' +
      '<span class="vt-est">预估大小：≈ ' + fmtSize(estBytes) +
        '（实际可能上下浮动约 10%）</span>';
  }

  function showError(msg) {
    $('vt-analysis').innerHTML = '<span class="vt-err">⚠ ' + esc(msg) + '</span>';
  }

  /* ---------- 选择 / 拖放文件 ---------- */

  function loadFile(file) {
    if (state.busy || !file) return;
    if (!/^video\//.test(file.type)) { showError('请选择视频文件'); return; }

    if (state.resultURL) { URL.revokeObjectURL(state.resultURL); state.resultURL = null; }

    SSBVideo.probe(file).then(function (info) {
      state.file = file;
      state.info = info;
      if (state.srcURL) URL.revokeObjectURL(state.srcURL);
      state.srcURL = URL.createObjectURL(file);

      var pv = $('vt-preview');
      pv.src = state.srcURL;

      $('vt-src-info').innerHTML =
        '<div class="vt-name">' + esc(file.name) + '</div>' +
        '<div>' + info.width + ' × ' + info.height + ' · 时长 ' +
        fmtDur(info.duration) + ' · ' + fmtSize(file.size) + '</div>';

      $('vt-result').classList.add('hidden');
      $('vt-progress').classList.add('hidden');
      $('vt-drop').classList.add('hidden');
      $('vt-work').classList.remove('hidden');
      refreshAnalysis();
    }).catch(function (e) { showError((e && e.message) || String(e)); });
  }

  /* ---------- 开始压缩 ---------- */

  function startCompress() {
    if (state.busy || !state.file) return;
    var p = planned();

    state.busy = true;
    $('vt-start').disabled = true;
    $('vt-reset').disabled = true;
    $('vt-result').classList.add('hidden');
    var bar = $('vt-progress');
    bar.classList.remove('hidden');
    $('vt-bar-fill').style.width = '0%';
    $('vt-pct').textContent = '0%';

    SSBVideo.transcode(state.file, {
      longEdge: Number($('vt-resolution').value) || 0,
      fps: p.fps, speed: p.speed, container: p.container,
      quality: $('vt-quality').value
    }, function (f) {
      var pct = Math.round(f * 100) + '%';
      $('vt-bar-fill').style.width = pct;
      $('vt-pct').textContent = pct;
    }).then(function (r) {
      if (state.resultURL) URL.revokeObjectURL(state.resultURL);
      state.resultURL = URL.createObjectURL(r.blob);

      var saved = (1 - r.blob.size / state.file.size) * 100;
      var dot = state.file.name.lastIndexOf('.');
      var stem = dot > -1 ? state.file.name.slice(0, dot) : state.file.name;
      var dlName = stem + '-compressed.' + (p.container === 'webm' ? 'webm' : 'mp4');

      $('vt-result').innerHTML =
        '✅ 压缩完成：' + fmtSize(state.file.size) + ' → ' + fmtSize(r.blob.size) +
        (saved > 0 ? '（减小约 ' + Math.round(saved) + '%）' : '') +
        '，输出 ' + r.width + ' × ' + r.height +
        '<a class="btn btn-primary vt-download" href="' + state.resultURL +
          '" download="' + esc(dlName) + '">⬇ 下载视频</a>';
      $('vt-result').classList.remove('hidden');
    }).catch(function (e) {
      showError((e && e.message) || String(e));
    }).then(function () {
      state.busy = false;
      $('vt-start').disabled = false;
      $('vt-reset').disabled = false;
    });
  }

  /* ---------- 重置 ---------- */

  function resetAll() {
    if (state.busy) return;
    var pv = $('vt-preview');
    pv.pause();
    pv.removeAttribute('src');
    pv.load();
    if (state.srcURL) { URL.revokeObjectURL(state.srcURL); state.srcURL = null; }
    if (state.resultURL) { URL.revokeObjectURL(state.resultURL); state.resultURL = null; }
    state.file = null; state.info = null;

    $('vt-quality').value = 'standard';
    $('vt-resolution').value = '0';
    $('vt-fps').value = '0';
    $('vt-speed').value = '1';
    $('vt-format').selectedIndex = 0;

    $('vt-work').classList.add('hidden');
    $('vt-result').classList.add('hidden');
    $('vt-progress').classList.add('hidden');
    $('vt-drop').classList.remove('hidden');
  }

  /* ---------- 初始化 ---------- */

  function init() {
    if (!window.SSBVideo || !SSBVideo.supported()) {
      $('vt-drop').innerHTML =
        '<div class="vt-drop-ic">⚠️</div>' +
        '<p class="vt-drop-title">当前浏览器不支持网页视频压缩</p>' +
        '<p class="vt-drop-sub">请使用新版 Chrome / Edge / Safari，或换一台设备打开本后台</p>';
      return;
    }

    /* 输出格式：只列出本机真正有编码器的容器 */
    SSBVideo.detectContainers().then(function (list) {
      state.containers = list;
      var sel = $('vt-format');
      list.forEach(function (c) {
        var label = c.id === 'mp4'
          ? 'MP4 · H.264（兼容性最好）'
          : 'WebM · VP9（同质量体积更小）';
        sel.add(new Option(label, c.id));
      });
    });

    $('vt-pick').addEventListener('click', function () { $('vt-file').click(); });
    $('vt-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';   /* 重选同一文件也能触发 */
      loadFile(f);
    });

    /* 拖放 */
    var drop = $('vt-drop');
    drop.addEventListener('dragover', function (e) {
      e.preventDefault();
      drop.classList.add('vt-drag');
    });
    drop.addEventListener('dragleave', function () {
      drop.classList.remove('vt-drag');
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('vt-drag');
      loadFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });

    /* 参数变化即时刷新预估 */
    ['vt-quality', 'vt-resolution', 'vt-fps', 'vt-speed', 'vt-format']
      .forEach(function (id) {
        $(id).addEventListener('change', refreshAnalysis);
      });

    $('vt-start').addEventListener('click', startCompress);
    $('vt-reset').addEventListener('click', resetAll);
  }

  init();
})();
