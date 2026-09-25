/* ============================================================
   SSB 背景应用：Canvas 粒子动画（particles）
   无数据文件；全部参数在「应用管理 → 参数」中调整：
     count     粒子数量（数量大吃性能）
     speed     基础速度倍率，值越大飘得越快
     sizeMin / sizeMax  半径范围 px
     colorMode auto=跟随主题色+补充色；custom=自定义颜色池（colors）
     tone      明暗基调：''=无（不锁定主题）；light/dark=锁定整站主题
   每个粒子：大圆形、随机速度+加速度、淡入淡出生命周期、边界软反弹。
   渲染到 .screen-bg 层，返回 destroy：屏不可见时自停 RAF、
   切换背景时移除画布与监听，不留下后台循环。
   ============================================================ */
SSBApps.define({
  id: 'particles',
  name: '粒子动画',
  desc: 'Canvas 大颗粒漂浮动画，参数可在「参数」中调整',
  kind: 'background',
  configSchema: [
    { key: 'count', label: '粒子数量（数量大吃性能）', type: 'number', min: 1, max: 40, step: 1, def: 6 },
    { key: 'speed', label: '速度倍率（值越大飘得越快）', type: 'number', min: 0, max: 3, step: 0.1, def: 0.4 },
    { key: 'sizeMin', label: '最小半径 px', type: 'number', min: 5, max: 400, step: 1, def: 25 },
    { key: 'sizeMax', label: '最大半径 px', type: 'number', min: 5, max: 500, step: 1, def: 115 },
    { key: 'colorMode', label: '粒子配色', type: 'select',
      options: [
        ['auto', '自动（跟随主题色 + 补充色）'],
        ['custom', '自定义颜色池']
      ], def: 'auto' },
    { key: 'colors', label: '自定义颜色列表（每行一个十六进制颜色，仅自定义模式生效）',
      type: 'textarea', def: '' },
    { key: 'tone', label: '明暗基调（选定后锁定整站主题为对应亮暗）', type: 'select',
      options: [
        ['', '无（不锁定，访客可自由切换主题）'],
        ['light', '亮色（锁定为亮色主题）'],
        ['dark', '暗色（锁定为暗色主题）']
      ], def: '' }
  ],
  render: function (layer, ctx) {
    var conf = ctx.cfg || {};
    var canvas = document.createElement('canvas');
    canvas.className = 'bg-canvas';
    layer.appendChild(canvas);

    var c2d = canvas.getContext('2d');
    var shapes = [];

    /* 参数从应用配置读取（两层合并后的 cfg），给合理默认防止缺字段报错 */
    var count = Number(conf.count) || 6;
    var speedMul = Number(conf.speed) || 0.4;
    var sizeMin = Number(conf.sizeMin) || 25;
    var sizeMax = Number(conf.sizeMax) || 115;
    if (sizeMax < sizeMin) sizeMax = sizeMin;   /* 用户填反时兜底，避免随机区间负数 */

    /* 颜色池：null 特殊值 = 运行时取主题色（好让粒子跟主题走）。
       custom 模式按行解析；列表为空时退回主题色单色 */
    var palette;
    if (conf.colorMode === 'custom') {
      palette = String(conf.colors || '').split('\n')
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return /^#[0-9a-fA-F]{3,8}$/.test(s); });
      if (!palette.length) palette = [null];
    } else {
      palette = [null, '#f9cc46', '#ef6a5f', '#7cc98e', '#e0e6f0'];
    }

    function pickColor(i) {
      var c = palette[i % palette.length];
      if (c === null) {
        return getComputedStyle(document.documentElement)
          .getPropertyValue('--primary').trim() || '#1d6ff2';
      }
      return c;
    }

    function resize() {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
    }

    /* 创建一个粒子：圆形、随机位置/速度/半径/寿命 */
    function randomShape(index, W, H) {
      return {
        color: pickColor(index),
        baseAlpha: 0.66 + Math.random() * 0.22,   /* 0.66~0.88，重叠自然融合 */
        x: Math.random() * W,
        y: Math.random() * H,
        r: sizeMin + Math.random() * (sizeMax - sizeMin),
        vx: (Math.random() - 0.5) * speedMul,
        vy: (Math.random() - 0.5) * speedMul,
        ax: 0, ay: 0,
        life: 0,
        maxLife: 800 + Math.random() * 1200,      /* 存活 40~100 秒 */
        fadeIn: 120,
        fadeOut: 160
      };
    }

    function buildShapes() {
      shapes = [];
      var W = canvas.width;
      var H = canvas.height;
      for (var i = 0; i < count; i++) {
        shapes.push(randomShape(i, W, H));
        shapes[i].life = Math.random() * 200;     /* 初始随机年龄，避免同时出现 */
      }
    }

    var rafId = null;

    function onResize() {
      resize();
      buildShapes();
    }

    resize();
    buildShapes();
    window.addEventListener('resize', onResize);

    function drawShape(s) {
      c2d.save();
      c2d.translate(s.x, s.y);

      /* 淡入淡出 × 基础透明度：life < fadeIn 渐显，life > maxLife-fadeOut 渐隐 */
      var alpha = s.baseAlpha;
      if (s.life < s.fadeIn) alpha *= (s.life / s.fadeIn);
      else if (s.life > s.maxLife - s.fadeOut) alpha *= (s.maxLife - s.life) / s.fadeOut;
      alpha = Math.max(0, Math.min(s.baseAlpha, alpha));

      c2d.globalAlpha = alpha;
      c2d.fillStyle = s.color;
      c2d.beginPath();
      c2d.arc(0, 0, s.r, 0, Math.PI * 2);
      c2d.fill();
      c2d.restore();
    }

    function draw() {
      c2d.clearRect(0, 0, canvas.width, canvas.height);
      var W = canvas.width, H = canvas.height;

      for (var i = 0; i < shapes.length; i++) {
        var s = shapes[i];
        s.life++;

        /* 随机加速度：约 0.4% 概率改变方向，产生自然飘动感 */
        if (Math.random() < 0.004) {
          s.ax = (Math.random() - 0.5) * 0.025;
          s.ay = (Math.random() - 0.5) * 0.025;
        }
        s.vx += s.ax;
        s.vy += s.ay;
        /* 速度上限（按 speedMul 缩放），防止加速度叠加后飞出屏幕 */
        var sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
        if (sp > speedMul * 0.75) {
          s.vx *= (speedMul * 0.75) / sp;
          s.vy *= (speedMul * 0.75) / sp;
        }
        /* 加速度衰减，让速度逐渐趋于稳定 */
        s.ax *= 0.95;
        s.ay *= 0.95;

        s.x += s.vx;
        s.y += s.vy;

        /* 边界软反弹：出界 300px 再从另一侧进入，避免画面边缘粒子堆集 */
        var pad = 300;
        if (s.x < -pad) { s.x = W + pad; }
        if (s.x > W + pad) { s.x = -pad; }
        if (s.y < -pad) { s.y = H + pad; }
        if (s.y > H + pad) { s.y = -pad; }

        drawShape(s);

        /* 生命周期结束：在当前粒子位置重新随机化（不是移除，保持数量稳定） */
        if (s.life >= s.maxLife) {
          shapes[i] = randomShape(i, W, H);
        }
      }
      rafId = requestAnimationFrame(draw);
    }

    function start() {
      if (rafId == null) rafId = requestAnimationFrame(draw);
    }
    function stop() {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    /* 屏不可见（滚动到其他屏）时暂停动画循环，可见时恢复。
       应用自管观察器，destroy 时一并 disconnect */
    var io = null;
    if (ctx.section && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(function (entries) {
        var visible = entries[0] && entries[0].isIntersecting;
        if (visible) start(); else stop();
      }, { threshold: 0.02 });
      io.observe(ctx.section);
    }

    start();

    /* 销毁函数：停 RAF、移除画布与窗口监听、断开可见性观察 */
    return function destroy() {
      stop();
      window.removeEventListener('resize', onResize);
      if (io) io.disconnect();
    };
  }
});
