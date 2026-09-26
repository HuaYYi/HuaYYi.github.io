/* ============================================================
   video-compress.js —— 后台浏览器端视频压缩（仅后台加载）
   ============================================================
   两处使用，共用同一核心：
     1) 视频应用「上传视频」：自动压成背景片规格（1080p/≤30fps/
        静音 MP4），附首帧海报与 tone 明暗判定；
     2) 侧边栏「视频压缩工具」：可选 质量/分辨率/帧率/倍速/输出格式，
        压完下载到本地。
   链路：<video> 解码浏览器可播容器（mp4/mov/webm）→ canvas 缩放
   → WebCodecs VideoEncoder（系统硬件编码）→ mp4-muxer / webm-muxer。
   不引入解封装库：逐帧取画面（背景/工具都不需要音轨），时间戳用
   requestVideoFrameCallback 的 mediaTime；倍速通过缩放输出时间戳实现。
   正常速率逐帧取（快放会丢呈现帧），耗时≈源片时长。
   依赖：vendor/mp4-muxer.js、vendor/webm-muxer.js（先于本文件加载）。
   ============================================================ */

(function () {
  'use strict';

  var MAX_INPUT_MB = 500;       /* 原片选择上限（本地读取不占网络） */
  var MAX_OUTPUT_MB = 200;      /* 成品安全线（过大多为参数不合理） */

  /* 输出容器定义：编码串候选按级别高→低，取系统首个支持的。
     hwModes：尝试硬件加速的顺序。VP9 部分机器的硬件编码器可创建却
     静默不产出数据，强制优先软件（libvpx 可靠）；H.264 硬件编码器
     普遍可靠且 4K 下速度优势大，优先硬件 */
  var CONTAINERS = {
    mp4: {
      ext: 'mp4', mime: 'video/mp4',
      muxerLib: 'Mp4Muxer', muxerOpts: { codec: 'avc' },
      muxerBase: { fastStart: 'in-memory' },
      hwModes: ['prefer-hardware', 'no-preference'],
      codecStrings: ['avc1.640033', 'avc1.640028', 'avc1.4d4028',
                     'avc1.64001f', 'avc1.42c028']
    },
    webm: {
      ext: 'webm', mime: 'video/webm',
      muxerLib: 'WebMMuxer', muxerOpts: { codec: 'V_VP9' },
      muxerBase: {},
      hwModes: ['prefer-software', 'no-preference'],
      codecStrings: ['vp09.00.40.08', 'vp09.00.31.08', 'vp09.00.10.08']
    }
  };

  function supported() {
    return !!(window.VideoEncoder && window.VideoFrame &&
      HTMLCanvasElement.prototype.getContext &&
      HTMLVideoElement.prototype.requestVideoFrameCallback);
  }

  function even(n) { return Math.max(2, n - (n % 2)); }

  /* 码率模型：标准档每百万像素 ≈1.45Mbps（1080p≈3Mbps），
     质量档为乘数；封顶/封底避免极端值 */
  var QUALITY_FACTOR = { high: 1.55, standard: 1, small: 0.62, tiny: 0.38 };
  var MIN_BITRATE = { high: 800000, standard: 500000, small: 350000, tiny: 250000 };
  function bitrateFor(w, h, quality) {
    var f = QUALITY_FACTOR[quality] != null ? QUALITY_FACTOR[quality] : 1;
    var minB = MIN_BITRATE[quality] != null ? MIN_BITRATE[quality] : 250000;
    var b = 1450000 * f * (w * h) / 1e6;
    return Math.max(minB, Math.min(16000000, Math.round(b)));
  }

  /* 在某容器的编码串候选里取首个系统支持的完整编码配置（级别高→低）。
     每个编码串按容器 hwModes 顺序探测，连同硬件加速标记一起传给
     isConfigSupported，避免「报支持但编码器创建失败」 */
  function pickCodecString(container, w, h, fps, bitrate) {
    var c = CONTAINERS[container];
    function tryAt(i, hwIdx) {
      if (i >= c.codecStrings.length) return Promise.resolve(null);
      if (hwIdx >= c.hwModes.length) return tryAt(i + 1, 0);
      var cfg = { codec: c.codecStrings[i], width: w, height: h,
        bitrate: bitrate, framerate: Math.max(1, fps),
        hardwareAcceleration: c.hwModes[hwIdx] };
      return VideoEncoder.isConfigSupported(cfg).then(function (r) {
        if (r && r.supported) return cfg;
        return tryAt(i, hwIdx + 1);
      });
    }
    return tryAt(0, 0);
  }

  /* 探测各容器在本机是否可用（工具初始化时过滤输出格式选项） */
  function detectContainers() {
    var ids = Object.keys(CONTAINERS);
    return Promise.all(ids.map(function (id) {
      var c = CONTAINERS[id];
      var libOk = !!(window[c.muxerLib] && window[c.muxerLib].Muxer &&
        window[c.muxerLib].ArrayBufferTarget);
      if (!libOk) return null;
      return pickCodecString(id, 1920, 1080, 30, 3000000).then(function (s) {
        return s ? { id: id, ext: c.ext, mime: c.mime } : null;
      });
    })).then(function (list) {
      return list.filter(Boolean);
    });
  }

  /* 帧亮度采样（64×36 加权），背景视频 tone 判定 */
  function frameLuma(srcCanvas) {
    var c = document.createElement('canvas');
    c.width = 64; c.height = 36;
    var cctx = c.getContext('2d');
    cctx.drawImage(srcCanvas, 0, 0, 64, 36);
    var d = cctx.getImageData(0, 0, 64, 36).data;
    var sum = 0;
    for (var i = 0; i < d.length; i += 4) {
      sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    }
    return sum / (d.length / 4);
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('成品读取失败')); };
      r.readAsDataURL(blob);
    });
  }

  /* 读取源片基础信息（不播放、不展示） */
  function probe(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.src = url;
      v.addEventListener('loadedmetadata', function () {
        if (!isFinite(v.duration) || v.duration <= 0) {
          URL.revokeObjectURL(url); reject(new Error('读取不到视频时长，请换一个文件'));
          return;
        }
        var info = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
        URL.revokeObjectURL(url); resolve(info);
      });
      v.addEventListener('error', function () {
        URL.revokeObjectURL(url); reject(new Error('视频无法解码，请换 mp4 或换设备试试'));
      });
    });
  }

  /**
   * 通用转码核心
   * @param {File} file
   * @param {Object} opts {longEdge:0=原始, fps:0=原始, speed, container,
   *                       bitrate:0=按quality, quality, needPoster, needLuma}
   * @param {Function} onProgress 0~1
   * @returns {Promise<{blob,width,height,duration,posterURL?,tone?}>}
   */
  function transcode(file, opts, onProgress) {
    onProgress = onProgress || function () {};
    opts = opts || {};
    var speed = opts.speed > 0 ? opts.speed : 1;
    var container = CONTAINERS[opts.container] ? opts.container : 'mp4';
    var cdef = CONTAINERS[container];

    if (!supported()) {
      return Promise.reject(new Error('当前浏览器不支持网页压缩，请用新版 Chrome/Edge/Safari'));
    }
    if (!file || !/^video\//.test(file.type)) {
      return Promise.reject(new Error('请选择视频文件（mp4/mov/webm）'));
    }
    if (file.size > MAX_INPUT_MB * 1024 * 1024) {
      return Promise.reject(new Error('原片超过 ' + MAX_INPUT_MB + 'MB，请先截取较短片段'));
    }

    var url = URL.createObjectURL(file);
    var video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';

    var cleanup = function () {
      if (video.parentNode) video.parentNode.removeChild(video);
      URL.revokeObjectURL(url);
    };
    document.body.appendChild(video);

    return new Promise(function (resolve, reject) {
      video.addEventListener('loadedmetadata', function () {
        var duration = video.duration;
        if (!isFinite(duration) || duration <= 0) {
          reject(new Error('读取不到视频时长，请换一个文件')); return;
        }

        /* 输出尺寸：longEdge=0 保持原始（偶数化），否则按长边缩放不放大 */
        var scale = opts.longEdge
          ? Math.min(1, opts.longEdge / Math.max(video.videoWidth, video.videoHeight))
          : 1;
        var outW = even(Math.round(video.videoWidth * scale));
        var outH = even(Math.round(video.videoHeight * scale));
        var fps = opts.fps > 0 ? opts.fps : 60;   /* 原始档：编码配置取 60，逐帧全收 */
        var keepAll = !opts.fps;
        var bitrate = opts.bitrate > 0
          ? opts.bitrate : bitrateFor(outW, outH, opts.quality || 'standard');

        var canvas = document.createElement('canvas');
        canvas.width = outW; canvas.height = outH;
        var ctx = canvas.getContext('2d');

        pickCodecString(container, outW, outH, fps, bitrate).then(function (codecCfg) {
          if (!codecCfg) {
            reject(new Error('系统没有可用的 ' + cdef.ext.toUpperCase() + ' 编码器，请换格式或设备'));
            return;
          }

          var MuxerLib = window[cdef.muxerLib];
          var target = new MuxerLib.ArrayBufferTarget();
          var muxer = new MuxerLib.Muxer(Object.assign({}, cdef.muxerBase, {
            target: target,
            video: Object.assign({ width: outW, height: outH }, cdef.muxerOpts)
          }));

          var chunkCount = 0;
          var encoder = new VideoEncoder({
            output: function (chunk, meta) { chunkCount++; muxer.addVideoChunk(chunk, meta); },
            error: function (e) { reject(new Error('编码失败：' + (e.message || e))); }
          });
          encoder.configure(codecCfg);

          var posterURL = '';
          var lumaSum = 0, lumaN = 0, nextSample = 0.1;
          var finished = false;
          var lastOutT = -1;      /* 已编码帧的输出时间戳（秒） */
          var prevSrcT = -1;
          var baseOutT = -1;      /* 首帧零点：首个 rVFC 的 mediaTime 可能 ≠0 */

          function drainAndResume() {
            (function wait() {
              if (finished) return;
              if (encoder.encodeQueueSize === 0) {
                video.requestVideoFrameCallback(onFrame);
                var p = video.play();
                if (p && p.catch) p.catch(function () {});
              } else setTimeout(wait, 50);
            })();
          }

          function finish() {
            if (finished) return;
            finished = true;
            onProgress(1);
            encoder.flush().then(function () {
              /* 零产出兜底：个别硬件编码器可创建却不输出任何数据 */
              if (!chunkCount) {
                reject(new Error('编码器没有产出数据，请换一种输出格式重试'));
                return;
              }
              muxer.finalize();
              var blob = new Blob([target.buffer], { type: cdef.mime });
              if (blob.size > MAX_OUTPUT_MB * 1024 * 1024) {
                reject(new Error('成品 ' + Math.round(blob.size / 1048576) +
                  'MB 超过 ' + MAX_OUTPUT_MB + 'MB，请降低质量/分辨率或缩短时长'));
                return;
              }
              var out = { blob: blob, width: outW, height: outH,
                duration: duration / speed };
              if (opts.needPoster) out.posterURL = posterURL;
              if (opts.needLuma) {
                out.tone = (lumaN && lumaSum / lumaN >= 128) ? 'light' : 'dark';
              }
              cleanup();
              resolve(out);
            }).catch(function (e) { reject(new Error('编码收尾失败：' + (e.message || e))); });
          }

          function onFrame(now, metadata) {
            if (finished) return;
            var srcT = metadata.mediaTime;
            var outT = srcT / speed;       /* 倍速：缩放输出时间戳 */
            var frameGap = prevSrcT >= 0 ? (srcT - prevSrcT) / speed : 1 / fps;

            /* 帧率限制：输出时间轴推进不足 1/fps 则跳过此帧（原始档全收） */
            var skip = !keepAll && lastOutT >= 0 && (outT - lastOutT) < 1 / opts.fps;
            prevSrcT = srcT;

            onProgress(Math.max(0, Math.min(0.99, duration ? srcT / duration : 0)));
            if (skip) {
              if (video.ended) finish();
              else video.requestVideoFrameCallback(onFrame);
              return;
            }

            ctx.drawImage(video, 0, 0, outW, outH);
            lastOutT = outT;
            if (baseOutT < 0) baseOutT = outT;

            if (opts.needPoster && !posterURL) {
              /* 320px 小海报：缩略图用，体积小可随 JSON 保留 */
              var pc = document.createElement('canvas');
              pc.width = 320;
              pc.height = Math.round(320 * outH / outW);
              pc.getContext('2d').drawImage(canvas, 0, 0, pc.width, pc.height);
              posterURL = pc.toDataURL('image/jpeg', 0.72);
            }
            if (opts.needLuma) {
              var frac = duration ? srcT / duration : 0;
              if (frac >= nextSample && nextSample <= 0.9) {
                lumaSum += frameLuma(canvas);
                lumaN++;
                nextSample += 0.2;
              }
            }

            var vf = new VideoFrame(canvas, {
              timestamp: Math.round((outT - baseOutT) * 1e6),
              duration: Math.round(Math.max(0.001, frameGap) * 1e6)
            });
            if (encoder.state === 'configured') encoder.encode(vf);
            vf.close();

            if (video.ended) { finish(); return; }
            /* 编码积压：暂停等排空（正常速率下很少触发） */
            if (encoder.encodeQueueSize > 8) {
              video.pause();
              setTimeout(drainAndResume, 60);
            } else video.requestVideoFrameCallback(onFrame);
          }

          /* 兜底：末帧回调可能先于 ended 翻转，结束事件直接收尾 */
          video.addEventListener('ended', finish);
          video.requestVideoFrameCallback(onFrame);
          var p0 = video.play();
          if (p0 && p0.catch) p0.catch(function () {});
        }).catch(function (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });

      video.addEventListener('error', function () {
        reject(new Error('视频无法解码，请换 mp4 格式或换设备试试'));
      });
    });
  }

  /**
   * 上传管线专用：背景片固定规格 + 海报 + tone，dataURL 供提交
   */
  function compress(file, onProgress) {
    return transcode(file, {
      longEdge: 1920, fps: 30, speed: 1, container: 'mp4',
      bitrate: 3500000, needPoster: true, needLuma: true
    }, onProgress).then(function (r) {
      return blobToDataURL(r.blob).then(function (dataURL) {
        return { blob: r.blob, dataURL: dataURL, posterURL: r.posterURL,
          width: r.width, height: r.height, duration: r.duration, tone: r.tone };
      });
    });
  }

  window.SSBVideo = {
    supported: supported,
    detectContainers: detectContainers,
    bitrateFor: bitrateFor,
    probe: probe,
    transcode: transcode,
    compress: compress
  };
})();
