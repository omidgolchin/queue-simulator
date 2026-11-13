/* omid-tools-kit — one chart style, two renderers.
 *
 * Every tool draws the same chart two ways: Chart.js when its CDN loads,
 * a hand-drawn canvas fallback when it does not. This file is the shared
 * implementation of both, so the two look like the same chart:
 *
 *   KitChart.makeLine(canvas, series, opts)   -> "chartjs" | "fallback"
 *   KitChart.makeBars(canvas, series, opts)   -> "chartjs" | "fallback"
 *   KitChart.applyChartDefaults()             -> style Chart.js globally
 *   KitChart.errorBarPlugin                   -> Chart.js CI-whisker plugin
 *   KitChart.palette()                        -> colours from the CSS tokens
 *
 * series: [{ label, color, points: [[x, y], ...], dash, fill, ci, markers }]
 *   color   a palette key ("accent", "series2", "neutral", "bad", "good")
 *           or any CSS colour. Default: palette order.
 *   ci      optional array of CI half-widths, one per point; drawn as
 *           whiskers in both renderers.
 *   fill    fill under the line (densities); its label sits at the peak.
 * opts: { xTitle, yTitle, xDigits, yDigits, yMin, yMax, legend,
 *         labels (category names, for makeBars), renderer }
 *   Axis titles are part of the house style: if you pass xTitle/yTitle,
 *   both renderers draw them, with units. renderer: "fallback" forces the
 *   hand-drawn path (the preview page uses this to show both side by side).
 */
(function () {
  "use strict";

  var FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  var TICK_FONT = "12px " + FONT_STACK;
  var FALLBACKS = {           /* light-theme values if kit.css is missing */
    accent: "#0b5fa5", series2: "#b26a00", neutral: "#767c84",
    bad: "#b3261e", good: "#1e6b30", grid: "#e4e4dc",
    muted: "#5d5d57", fg: "#1b1b18", border: "#dbdbd3", card: "#ffffff"
  };
  var VAR_FOR = {
    accent: "--accent", series2: "--series-2", neutral: "--neutral",
    bad: "--bad", good: "--good", grid: "--grid",
    muted: "--muted", fg: "--fg", border: "--border", card: "--card"
  };
  var ORDER = ["accent", "series2", "neutral", "bad", "good"];

  function palette() {
    var cs = getComputedStyle(document.documentElement);
    var out = {};
    Object.keys(VAR_FOR).forEach(function (k) {
      out[k] = cs.getPropertyValue(VAR_FOR[k]).trim() || FALLBACKS[k];
    });
    return out;
  }
  function colorOf(s, i) {
    if (s.color && FALLBACKS[s.color]) return palette()[s.color];
    if (s.color) return s.color;
    return palette()[ORDER[i % ORDER.length]];
  }
  function withAlpha(color, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!m) return color;
    var n = parseInt(m[1], 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," +
      (n & 255) + "," + a + ")";
  }

  /* ---------------- Chart.js side ---------------- */

  function applyChartDefaults() {
    if (!window.Chart) return false;
    var p = palette();
    Chart.defaults.font.family = FONT_STACK;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = p.muted;
    Chart.defaults.borderColor = p.grid;
    Chart.defaults.animation = false;
    return true;
  }

  /* Whisker plugin: any dataset may carry ci: [half-widths]. Also reads
   * the legacy chart.$ciHalf for dataset 0 (the queue simulator's shape). */
  var errorBarPlugin = {
    id: "kitErrorBars",
    afterDatasetsDraw: function (chart) {
      var ctx = chart.ctx;
      chart.data.datasets.forEach(function (ds, di) {
        var halves = ds.ci || (di === 0 ? chart.$ciHalf : null);
        if (!halves) return;
        var meta = chart.getDatasetMeta(di);
        ctx.save();
        ctx.strokeStyle = ds.borderColor || palette().accent;
        ctx.lineWidth = 1.5;
        meta.data.forEach(function (pt, i) {
          var h = halves[i];
          if (!h) return;
          var v = ds.data[i];
          var yVal = (typeof v === "object" && v !== null) ? v.y : v;
          var yTop = chart.scales.y.getPixelForValue(yVal + h);
          var yBot = chart.scales.y.getPixelForValue(yVal - h);
          ctx.beginPath();
          ctx.moveTo(pt.x - 4, yTop); ctx.lineTo(pt.x + 4, yTop);
          ctx.moveTo(pt.x, yTop); ctx.lineTo(pt.x, yBot);
          ctx.moveTo(pt.x - 4, yBot); ctx.lineTo(pt.x + 4, yBot);
          ctx.stroke();
        });
        ctx.restore();
      });
    }
  };

  function legendOpts(show) {
    return { display: !!show, position: "top", align: "start",
      labels: { boxWidth: 22, boxHeight: 2, usePointStyle: false,
        padding: 12, font: { size: 12 } } };
  }
  function scalesOpts(opts, categorical) {
    var p = palette();
    var x = { title: { display: !!opts.xTitle, text: opts.xTitle || "" },
      grid: { display: false }, ticks: { maxTicksLimit: 8 } };
    if (!categorical) x.type = "linear";
    var y = { title: { display: !!opts.yTitle, text: opts.yTitle || "" },
      grid: { color: p.grid }, border: { display: false } };
    if (opts.yMin != null) y.min = opts.yMin;
    if (opts.yMax != null) y.max = opts.yMax;
    return { x: x, y: y };
  }

  function chartJsLine(canvas, series, opts) {
    if (canvas._kitChart) canvas._kitChart.destroy();
    var chart = new Chart(canvas, {
      type: "line",
      data: { datasets: series.map(function (s, i) {
        var c = colorOf(s, i);
        return { label: s.label, ci: s.ci || null,
          data: s.points.map(function (pt) { return { x: pt[0], y: pt[1] }; }),
          borderColor: c, backgroundColor: withAlpha(c, 0.16),
          borderWidth: 2, borderDash: s.dash ? [5, 4] : [],
          pointRadius: s.markers || s.points.length <= 25 ? 3 : 0,
          tension: 0.15, fill: !!s.fill };
      }) },
      options: { responsive: true, maintainAspectRatio: false,
        animation: false,
        plugins: { legend: legendOpts(opts.legend !== false && series.length > 1) },
        scales: scalesOpts(opts, false) },
      plugins: [errorBarPlugin]
    });
    canvas._kitChart = chart;
    return "chartjs";
  }

  function chartJsBars(canvas, series, opts) {
    if (canvas._kitChart) canvas._kitChart.destroy();
    var chart = new Chart(canvas, {
      type: "bar",
      data: { labels: opts.labels || [],
        datasets: series.map(function (s, i) {
          var c = colorOf(s, i);
          return { label: s.label, data: s.values,
            backgroundColor: withAlpha(c, 0.8), borderColor: c,
            borderWidth: 1 };
        }) },
      options: { responsive: true, maintainAspectRatio: false,
        animation: false,
        plugins: { legend: legendOpts(opts.legend !== false && series.length > 1) },
        scales: scalesOpts(opts, true) },
      plugins: [errorBarPlugin]
    });
    canvas._kitChart = chart;
    return "chartjs";
  }

  /* ---------------- Hand-drawn fallback ---------------- */

  function setup(canvas, opts) {
    var dpr = window.devicePixelRatio || 1;
    var W = canvas.clientWidth || 600;
    var H = opts.height || canvas.clientHeight || 300;
    canvas.width = W * dpr; canvas.height = H * dpr;
    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.font = TICK_FONT;
    return { ctx: ctx, W: W, H: H, p: palette() };
  }

  /* Draws gridlines, tick labels and axis titles; returns the plot box
   * and the X/Y mapping functions. Shared by lines and bars so the two
   * chart kinds share one frame. */
  function frame(env, opts, ext) {
    var ctx = env.ctx, W = env.W, H = env.H, p = env.p;
    var rows = ext.legendRows || 0;
    var padL = opts.yTitle ? 60 : 46, padR = ext.padR != null ? ext.padR : 10;
    var padT = 8 + rows * 20, padB = opts.xTitle ? 42 : 28;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    function X(v) { return padL + (v - ext.x0) / (ext.x1 - ext.x0) * plotW; }
    function Y(v) { return padT + plotH - (v - ext.y0) / (ext.y1 - ext.y0) * plotH; }
    ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var yv = ext.y0 + (ext.y1 - ext.y0) * i / 4, yy = Y(yv);
      ctx.strokeStyle = p.grid;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      var tick = yv.toFixed(opts.yDigits == null ? 2 : opts.yDigits);
      ctx.fillStyle = p.muted; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(tick, padL - 6, yy);
    }
    ctx.strokeStyle = p.border;
    ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(W - padR, Y(0)); ctx.stroke();
    if (opts.yTitle) {
      ctx.save();
      ctx.translate(14, padT + plotH / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = p.muted; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(opts.yTitle, 0, 0);
      ctx.restore();
    }
    if (opts.xTitle) {
      ctx.fillStyle = p.muted; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(opts.xTitle, padL + plotW / 2, H - 18);
    }
    /* Legend in the top margin: a line swatch and label per series,
     * wrapping to a second row when the entries do not fit. */
    if (rows) {
      var lx = padL, ly = 12;
      ext.legend.forEach(function (e) {
        var w = 22 + 6 + ctx.measureText(e.label).width + 18;
        if (lx + w > W - padR && lx > padL) { lx = padL; ly += 20; }
        ctx.strokeStyle = e.color; ctx.lineWidth = 2;
        ctx.setLineDash(e.dash ? [5, 4] : []);
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 22, ly); ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 1;
        ctx.fillStyle = p.muted; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(e.label, lx + 28, ly);
        lx += w;
      });
    }
    return { X: X, Y: Y, padL: padL, padR: padR, padT: padT, W: W, H: H };
  }

  function legendEntries(series) {
    return series.map(function (s, i) {
      return { label: s.label, color: colorOf(s, i), dash: s.dash };
    });
  }
  function legendRows(series, W) {
    /* rough pre-measure with an offscreen context */
    var c = document.createElement("canvas").getContext("2d");
    c.font = TICK_FONT;
    var total = series.reduce(function (a, s) {
      return a + 22 + 6 + c.measureText(s.label).width + 18;
    }, 0);
    return total > W - 70 ? 2 : 1;
  }

  function fallbackLine(canvas, series, opts) {
    var env = setup(canvas, opts), ctx = env.ctx;
    var xs = [], ys = [];
    series.forEach(function (s) {
      s.points.forEach(function (pt, j) {
        xs.push(pt[0]); ys.push(pt[1]);
        if (s.ci && s.ci[j]) { ys.push(pt[1] + s.ci[j]); ys.push(pt[1] - s.ci[j]); }
      });
    });
    var ext = {
      x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
      y0: opts.yMin != null ? opts.yMin : Math.min(0, Math.min.apply(null, ys)),
      y1: opts.yMax != null ? opts.yMax : Math.max.apply(null, ys) * 1.06 || 1,
      legend: opts.legend === false || series.length < 2 ? null : legendEntries(series)
    };
    ext.legendRows = ext.legend ? legendRows(series, env.W) : 0;
    if (!ext.legend) ext.legend = [];
    var xd = opts.xDigits;
    if (xd == null) xd = (ext.x1 - ext.x0) % 1 === 0 && ext.x1 - ext.x0 <= 30 ? 0 : 1;
    /* The last x tick label is centred on the final point, so half of
     * it would fall past the plot's right edge and clip (seen on the
     * A/B Lab peeking chart, whose final tick "40.0" was cut off).
     * Reserve exactly the room that half-label needs; charts whose
     * last label is short keep the usual 10px. */
    ext.padR = Math.max(10,
      Math.ceil(ctx.measureText(ext.x1.toFixed(xd)).width / 2) + 2);
    var f = frame(env, opts, ext);
    /* x tick labels: at most 6, evenly spaced over the range */
    ctx.fillStyle = env.p.muted; ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (var i = 0; i <= 5; i++) {
      var xv = ext.x0 + (ext.x1 - ext.x0) * i / 5;
      ctx.fillText(xv.toFixed(xd), f.X(xv), f.Y(ext.y0) + 6);
    }
    var placements = [];
    series.forEach(function (s, si) {
      var c = colorOf(s, si);
      if (s.fill) {
        ctx.beginPath();
        s.points.forEach(function (pt, j) {
          j ? ctx.lineTo(f.X(pt[0]), f.Y(pt[1])) : ctx.moveTo(f.X(pt[0]), f.Y(pt[1]));
        });
        ctx.lineTo(f.X(s.points[s.points.length - 1][0]), f.Y(Math.max(ext.y0, 0)));
        ctx.lineTo(f.X(s.points[0][0]), f.Y(Math.max(ext.y0, 0)));
        ctx.closePath();
        ctx.fillStyle = withAlpha(c, 0.16); ctx.fill();
      }
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2;
      ctx.setLineDash(s.dash ? [5, 4] : []);
      ctx.beginPath();
      s.points.forEach(function (pt, j) {
        j ? ctx.lineTo(f.X(pt[0]), f.Y(pt[1])) : ctx.moveTo(f.X(pt[0]), f.Y(pt[1]));
      });
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
      if (s.ci) {
        ctx.strokeStyle = c; ctx.lineWidth = 1.5;
        s.points.forEach(function (pt, j) {
          var h = s.ci[j]; if (!h) return;
          var x = f.X(pt[0]);
          ctx.beginPath();
          ctx.moveTo(x - 4, f.Y(pt[1] + h)); ctx.lineTo(x + 4, f.Y(pt[1] + h));
          ctx.moveTo(x, f.Y(pt[1] + h)); ctx.lineTo(x, f.Y(pt[1] - h));
          ctx.moveTo(x - 4, f.Y(pt[1] - h)); ctx.lineTo(x + 4, f.Y(pt[1] - h));
          ctx.stroke();
        });
        ctx.lineWidth = 1;
      }
      if (s.markers || s.points.length <= 25) {
        s.points.forEach(function (pt) {
          ctx.beginPath(); ctx.arc(f.X(pt[0]), f.Y(pt[1]), 3, 0, 7); ctx.fill();
        });
      }
      /* Series label: at the peak for filled curves, at the last point
       * for plain lines; clamped inside the plot. Placement is resolved
       * after all series are drawn so labels never overlap. */
      if (opts.labels !== false) {
        var anchor = s.points[s.points.length - 1];
        if (s.fill) s.points.forEach(function (pt) { if (pt[1] > anchor[1]) anchor = pt; });
        var tw = ctx.measureText(s.label).width;
        var lx2 = s.fill
          ? Math.max(f.padL, Math.min(f.X(anchor[0]) - tw / 2, env.W - f.padR - tw))
          : Math.max(f.padL, Math.min(f.X(anchor[0]) - tw - 2, env.W - f.padR - tw));
        placements.push({ text: s.label, color: c, x: lx2, y: f.Y(anchor[1]) - 6, w: tw });
      }
    });
    /* Resolve label collisions: where two labels share x-range and sit
     * within 14px vertically, push the lower one down; if the stack
     * would cross the axis, shift the whole stack up instead. */
    placements.sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < placements.length; i++) {
      var prev = placements[i - 1], cur = placements[i];
      var overlapX = cur.x < prev.x + prev.w && prev.x < cur.x + cur.w;
      if (overlapX && cur.y - prev.y < 14) cur.y = prev.y + 14;
    }
    if (placements.length) {
      var axisY = f.Y(ext.y0);
      var last = placements[placements.length - 1];
      if (last.y > axisY - 2) {
        var shift = last.y - (axisY - 2);
        placements.forEach(function (pl) { pl.y -= shift; });
      }
    }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    placements.forEach(function (pl) {
      ctx.fillStyle = pl.color;
      ctx.fillText(pl.text, pl.x, pl.y);
    });
    return "fallback";
  }

  function fallbackBars(canvas, series, opts) {
    var env = setup(canvas, opts), ctx = env.ctx;
    var vals = [];
    series.forEach(function (s) { s.values.forEach(function (v) { vals.push(v); }); });
    var ext = {
      x0: 0, x1: 1,
      y0: opts.yMin != null ? opts.yMin : Math.min(0, Math.min.apply(null, vals)),
      y1: opts.yMax != null ? opts.yMax : Math.max.apply(null, vals) * 1.08 || 1,
      legend: opts.legend === false || series.length < 2 ? null : legendEntries(series)
    };
    ext.legendRows = ext.legend ? legendRows(series, env.W) : 0;
    if (!ext.legend) ext.legend = [];
    var f = frame(env, opts, ext);
    var labels = opts.labels || [];
    var n = labels.length || (series[0] ? series[0].values.length : 0);
    var plotW = env.W - f.padL - f.padR;
    var groupW = plotW / n, barW = groupW / (series.length + 0.6);
    var zeroY = f.Y(0);
    series.forEach(function (s, si) {
      var c = colorOf(s, si);
      ctx.fillStyle = withAlpha(c, 0.8);
      ctx.strokeStyle = c; ctx.lineWidth = 1;
      s.values.forEach(function (v, j) {
        var gx = f.padL + groupW * j + groupW / 2;
        var x = gx + (si - (series.length - 1) / 2) * barW - barW / 2;
        var y = f.Y(v);
        ctx.fillRect(x, Math.min(y, zeroY), barW, Math.abs(zeroY - y));
        ctx.strokeRect(x, Math.min(y, zeroY), barW, Math.abs(zeroY - y));
      });
    });
    /* Category labels sit under the plot box, clear of the bars. */
    var plotBottom = env.H - (opts.xTitle ? 42 : 28);
    ctx.fillStyle = env.p.muted; ctx.textAlign = "center"; ctx.textBaseline = "top";
    labels.forEach(function (lab, j) {
      ctx.fillText(lab, f.padL + groupW * j + groupW / 2, plotBottom + 6);
    });
    return "fallback";
  }

  /* ---------------- Public entry points ---------------- */

  function makeLine(canvas, series, opts) {
    opts = opts || {};
    if (!canvas) return null;
    if (opts.renderer !== "fallback" && window.Chart) {
      applyChartDefaults();
      return chartJsLine(canvas, series, opts);
    }
    return fallbackLine(canvas, series, opts);
  }
  function makeBars(canvas, series, opts) {
    opts = opts || {};
    if (!canvas) return null;
    if (opts.renderer !== "fallback" && window.Chart) {
      applyChartDefaults();
      return chartJsBars(canvas, series, opts);
    }
    return fallbackBars(canvas, series, opts);
  }

  window.KitChart = {
    palette: palette,
    applyChartDefaults: applyChartDefaults,
    errorBarPlugin: errorBarPlugin,
    makeLine: makeLine,
    makeBars: makeBars
  };
})();
