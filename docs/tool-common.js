/* omid-tools-kit / tool-common.js: helpers shared by every tool (v3).
 *
 *   Tool.readParams(defaults)      inputs from the URL query, typed like defaults
 *   Tool.writeParams(obj)          inputs into the URL (replaceState, no reload)
 *   Tool.copy(text, toastEl)       copy to clipboard with a short confirmation
 *   Tool.fmt.*                     number formatting
 *   Tool.lineChart(el, spec)       a small, dependency-free SVG line chart
 *   Tool.assist(config)            the "Fill from description" AI assist
 *   Tool.explain(glossary)         "?" buttons that open a plain-language explanation
 *   Tool.siblings(currentRepo)     the "More tools" footer line, from one shared list
 *   Tool.tabs(tablist)             arrow-key support for a mode switch
 *   Tool.exampleBanner(form, text) marks prefilled example content where it sits
 *   Tool.exampleWatch(form, text)  same, and hides it at the visitor's first edit
 *
 * No dependencies. Works from file:// and on GitHub Pages.
 */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";

  /* ---------------- URL state ---------------- */
  function readParams(defaults) {
    var q = new URLSearchParams(location.search), out = {};
    Object.keys(defaults).forEach(function (k) {
      var d = defaults[k];
      if (!q.has(k)) { out[k] = d; return; }
      var v = q.get(k);
      if (typeof d === "number") { var n = Number(v); out[k] = isFinite(n) ? n : d; }
      else if (typeof d === "boolean") out[k] = v === "1" || v === "true";
      else out[k] = v;
    });
    return out;
  }
  function writeParams(obj) {
    var q = new URLSearchParams();
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v === null || v === undefined || v === "") return;
      q.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
    });
    var url = location.pathname + "?" + q.toString() + location.hash;
    try { history.replaceState(null, "", url); } catch (e) { /* file:// in some browsers */ }
  }

  /* ---------------- clipboard ---------------- */
  function copy(text, toastEl, message) {
    function done(ok) {
      if (!toastEl) return;
      toastEl.textContent = ok ? (message || "Copied.") : "Could not copy. Select and copy by hand.";
      clearTimeout(toastEl._t);
      toastEl._t = setTimeout(function () { toastEl.textContent = ""; }, 2200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta); done(ok);
    }
  }

  /* ---------------- formatting ---------------- */
  var fmt = {
    int: function (x) { return Math.round(x).toLocaleString("en-US"); },
    num: function (x, d) { return Number(x).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); },
    pct: function (x, d) { return (100 * x).toFixed(d == null ? 1 : d) + "%"; },
    pts: function (x, d) { var v = (100 * x).toFixed(d == null ? 2 : d); return (x > 0 ? "+" : "") + v; },
    money: function (x) {
      var a = Math.abs(x), s = x < 0 ? "−$" : "$";
      return s + (a >= 100 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2));
    }
  };

  /* ---------------- SVG line chart ----------------
   * spec: {
   *   series: [{ label, color, points: [[x,y],...], dash, width, markers, ci: [[lo,hi],...], step }],
   *   bands:  [{ y0, y1, color, opacity }]   horizontal shaded bands
   *   hLines: [{ y, label, color, dash }]    vLines: [{ x, label, color, dash }]
   *   xTitle, yTitle, xMin, xMax, yMin, yMax, xTicks (array), yTicks (array),
   *   xFormat(v), yFormat(v), height (px, default 260), legend (bool)
   * }
   */
  function css(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function color(c) {
    var map = { accent: "--accent", series2: "--series-2", neutral: "--neutral", bad: "--bad", good: "--good", grid: "--grid", muted: "--muted", fg: "--fg" };
    return map[c] ? css(map[c], "#888") : (c || css("--accent", "#0b5fa5"));
  }
  function niceTicks(lo, hi, count) {
    var span = hi - lo; if (!(span > 0)) return [lo];
    var step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = (count * step) / span;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    var t = [], v = Math.ceil(lo / step - 1e-9) * step;
    for (; v <= hi + step * 1e-9; v += step) t.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return t;
  }
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function lineChart(host, spec) {
    host.innerHTML = "";
    var W = Math.max(280, host.clientWidth || 600), H = spec.height || 260;
    var narrow = W < 480;
    var m = { l: spec.yTitle ? 58 : 44, r: 14, t: 12, b: spec.xTitle ? 46 : 28 };
    var legendPos = [];
    if (spec.legend) {
      var lx0 = m.l, ly0 = 12;
      (spec.series || []).forEach(function (s) {
        if (!s.label) { legendPos.push(null); return; }
        var w = 23 + s.label.length * 6.6 + 18;
        if (lx0 + w > W - m.r && lx0 > m.l) { lx0 = m.l; ly0 += 17; }
        legendPos.push([lx0, ly0]); lx0 += w;
      });
      m.t = ly0 + 18;
    }
    var xs = [], ys = [];
    (spec.series || []).forEach(function (s) {
      s.points.forEach(function (p, i) {
        xs.push(p[0]); ys.push(p[1]);
        if (s.ci && s.ci[i]) { ys.push(s.ci[i][0]); ys.push(s.ci[i][1]); }
      });
    });
    (spec.hLines || []).forEach(function (h) { ys.push(h.y); });
    (spec.bands || []).forEach(function (b) { ys.push(b.y0); ys.push(b.y1); });
    var xMin = spec.xMin != null ? spec.xMin : Math.min.apply(null, xs);
    var xMax = spec.xMax != null ? spec.xMax : Math.max.apply(null, xs);
    var yMin = spec.yMin != null ? spec.yMin : Math.min.apply(null, ys);
    var yMax = spec.yMax != null ? spec.yMax : Math.max.apply(null, ys);
    if (yMax === yMin) { yMax += 1; yMin -= 1; }
    if (spec.yMax == null) yMax += (yMax - yMin) * 0.06;
    // category labels that do not fit side by side are slanted, with room made below
    var slant = false;
    if (spec.xTicks && spec.xFormat && spec.xTicks.length > 1) {
      var maxLen = 0;
      spec.xTicks.forEach(function (v) { maxLen = Math.max(maxLen, String(spec.xFormat(v)).length); });
      var room = (W - m.l - m.r) / spec.xTicks.length;
      if (maxLen * 6.3 > room - 6) { slant = true; m.b += Math.min(78, maxLen * 4.4); }
    }
    var X = function (v) { return m.l + (v - xMin) / (xMax - xMin || 1) * (W - m.l - m.r); };
    var Y = function (v) { return H - m.b - (v - yMin) / (yMax - yMin) * (H - m.t - m.b); };
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": spec.aria || spec.yTitle || "chart" }, host);
    var grid = color("grid"), muted = color("muted");
    var xFmt = spec.xFormat || function (v) { return String(v); };
    var yFmt = spec.yFormat || function (v) { return String(v); };
    var yt = spec.yTicks || niceTicks(yMin, yMax, narrow ? 4 : 5);
    yt.forEach(function (v) {
      if (v < yMin - 1e-12 || v > yMax + 1e-12) return;
      el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: grid, "stroke-width": 1 }, svg);
      var t = el("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end" }, svg); t.textContent = yFmt(v);
    });
    var xt = spec.xTicks || niceTicks(xMin, xMax, narrow ? 4 : 7);
    xt.forEach(function (v) {
      if (v < xMin - 1e-12 || v > xMax + 1e-12) return;
      el("line", { x1: X(v), x2: X(v), y1: H - m.b, y2: H - m.b + 4, stroke: muted }, svg);
      var t = slant ? el("text", { x: X(v) + 4, y: H - m.b + 13, "text-anchor": "end", transform: "rotate(-38 " + (X(v) + 4) + " " + (H - m.b + 13) + ")" }, svg)
        : el("text", { x: X(v), y: H - m.b + 17, "text-anchor": "middle" }, svg);
      t.textContent = xFmt(v);
    });
    el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: muted }, svg);
    if (spec.xTitle) { var xtT = el("text", { x: (m.l + W - m.r) / 2, y: H - 6, "text-anchor": "middle", class: "title" }, svg); xtT.textContent = spec.xTitle; }
    if (spec.yTitle) { var ytT = el("text", { x: 14, y: (m.t + H - m.b) / 2, "text-anchor": "middle", class: "title", transform: "rotate(-90 14 " + ((m.t + H - m.b) / 2) + ")" }, svg); ytT.textContent = spec.yTitle; }
    (spec.bands || []).forEach(function (b) {
      var y0 = Y(Math.max(yMin, Math.min(b.y0, b.y1))), y1 = Y(Math.min(yMax, Math.max(b.y0, b.y1)));
      el("rect", { x: m.l, y: y1, width: W - m.l - m.r, height: Math.max(0, y0 - y1), fill: color(b.color || "good"), opacity: b.opacity || 0.1 }, svg);
    });
    (spec.hLines || []).forEach(function (h) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(h.y), y2: Y(h.y), stroke: color(h.color || "fg"), "stroke-width": 1.2, "stroke-dasharray": h.dash || "5 4" }, svg);
      if (h.label) { var t = el("text", { x: h.labelLeft ? m.l + 6 : W - m.r - 2, y: Y(h.y) - 6, "text-anchor": h.labelLeft ? "start" : "end", class: "title halo" }, svg); t.textContent = h.label; }
    });
    (spec.vLines || []).forEach(function (v) {
      el("line", { x1: X(v.x), x2: X(v.x), y1: m.t, y2: H - m.b, stroke: color(v.color || "fg"), "stroke-width": 1.2, "stroke-dasharray": v.dash || "4 3" }, svg);
      if (v.label) {
        var right = X(v.x) > (W - m.l) * 0.7;
        var t = el("text", { x: X(v.x) + (right ? -5 : 5), y: m.t + 12, "text-anchor": right ? "end" : "start", class: "title" }, svg); t.textContent = v.label;
      }
    });
    (spec.series || []).forEach(function (s, si) {
      var c = color(s.color || ["accent", "series2", "neutral"][si % 3]);
      if (s.ci) s.ci.forEach(function (ci, i) {
        if (!ci) return; var x = X(s.points[i][0]);
        el("line", { x1: x, x2: x, y1: Y(ci[0]), y2: Y(ci[1]), stroke: c, "stroke-width": 1.5 }, svg);
        el("line", { x1: x - 4, x2: x + 4, y1: Y(ci[0]), y2: Y(ci[0]), stroke: c, "stroke-width": 1.5 }, svg);
        el("line", { x1: x - 4, x2: x + 4, y1: Y(ci[1]), y2: Y(ci[1]), stroke: c, "stroke-width": 1.5 }, svg);
      });
      if (s.bars) {
        var step = s.points.length > 1 ? Math.abs(X(s.points[1][0]) - X(s.points[0][0])) : 20;
        var bw = Math.max(2, step * (s.barWidth || 0.72)), base0 = Y(Math.max(yMin, 0));
        s.points.forEach(function (p, i) {
          var hl = s.highlight != null && (Array.isArray(s.highlight) ? s.highlight.indexOf(i) >= 0 : s.highlight === i);
          el("rect", { x: X(p[0]) - bw / 2, y: Math.min(Y(p[1]), base0), width: bw, height: Math.abs(base0 - Y(p[1])), fill: c, opacity: hl ? 1 : 0.55, rx: 1 }, svg);
        });
        return;
      }
      var d = "";
      s.points.forEach(function (p, i) {
        if (s.step && i > 0) d += "L" + X(p[0]) + " " + Y(s.points[i - 1][1]);
        d += (i ? "L" : "M") + X(p[0]) + " " + Y(p[1]);
      });
      if (s.area) {
        var base = Y(Math.max(yMin, 0));
        el("path", { d: d + "L" + X(s.points[s.points.length - 1][0]) + " " + base + "L" + X(s.points[0][0]) + " " + base + "Z", fill: c, opacity: 0.12 }, svg);
      }
      if (!s.markersOnly) el("path", { d: d, fill: "none", stroke: c, "stroke-width": s.width || 2, "stroke-dasharray": s.dash || "none", "stroke-linejoin": "round" }, svg);
      if (s.markers || s.markersOnly) s.points.forEach(function (p, i) {
        var hl = s.highlight === i;
        el("circle", { cx: X(p[0]), cy: Y(p[1]), r: hl ? 5.5 : 3.2, fill: hl ? c : color("fg") === c ? c : c, stroke: hl ? css("--card", "#fff") : "none", "stroke-width": hl ? 2 : 0 }, svg);
      });
    });
    if (spec.legend) {
      (spec.series || []).forEach(function (s, si) {
        var pos = legendPos[si]; if (!pos) return;
        var c = color(s.color || ["accent", "series2", "neutral"][si % 3]);
        if (s.markersOnly) el("circle", { cx: pos[0] + 9, cy: pos[1], r: 3.5, fill: c }, svg);
        else el("line", { x1: pos[0], x2: pos[0] + 18, y1: pos[1], y2: pos[1], stroke: c, "stroke-width": 2.5, "stroke-dasharray": s.dash || "none" }, svg);
        var t = el("text", { x: pos[0] + 23, y: pos[1] + 4 }, svg); t.textContent = s.label;
      });
    }
    return { X: X, Y: Y, svg: svg };
  }

  /* ---------------- AI assist ----------------
   * config: {
   *   mount: element, title, placeholder, examples: [{label, text}],
   *   fields: [{ key, label, type: "number"|"text"|"boolean"|"array", help }],
   *   instructions: string (what to extract, domain rules),
   *   apply: function(values) -> void (values: {key: value} for confirmed fields)
   * }
   * The verdict is never produced here: the model only fills inputs, and every
   * filled value carries the quote it came from.
   */
  function buildPrompt(cfg, text) {
    var lines = cfg.fields.map(function (f) {
      return '  "' + f.key + '": {"value": <' + f.type + " or null>, \"quote\": <exact short phrase from the text, or null>}  // " + f.label + (f.help ? ". " + f.help : "");
    });
    return [
      "You extract inputs for a calculator from a user's own text. You do not compute results.",
      cfg.instructions,
      "",
      "Rules:",
      "- Use only what the text states or what follows by simple unit conversion. Do not guess.",
      "- If a value is not stated, return null for value and quote.",
      "- quote must be copied exactly from the text (a short phrase).",
      "- Put anything ambiguous a careful analyst would ask about in \"questions\" (short sentences).",
      "",
      "Return only JSON in this shape:",
      "{",
      '  "fields": {',
      lines.join(",\n"),
      "  },",
      '  "questions": [<string>, ...]',
      "}",
      "",
      "TEXT:",
      "\"\"\"",
      text,
      "\"\"\""
    ].join("\n");
  }
  function parseReply(raw) {
    if (!raw) throw new Error("Empty reply.");
    var s = String(raw).trim();
    var fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
    if (fence) s = fence[1];
    var a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("No JSON object found in the reply.");
    var obj = JSON.parse(s.slice(a, b + 1));
    if (!obj.fields || typeof obj.fields !== "object") throw new Error("Reply has no \"fields\" object.");
    return obj;
  }
  function coerce(field, v) {
    if (v === null || v === undefined || v === "") return null;
    if (field.type === "number") {
      var n = typeof v === "number" ? v : Number(String(v).replace(/[, $%]/g, ""));
      return isFinite(n) ? n : null;
    }
    if (field.type === "boolean") return v === true || v === "true" || v === "yes";
    if (field.type === "array") return Array.isArray(v) ? v : null;
    return String(v);
  }
  function quoteFound(text, quote) {
    if (!quote) return false;
    var norm = function (x) { return String(x).toLowerCase().replace(/\s+/g, " ").trim(); };
    return norm(text).indexOf(norm(quote)) >= 0;
  }
  async function callModel(provider, key, model, baseUrl, prompt) {
    if (provider === "anthropic") {
      var r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({ model: model, max_tokens: 1500, temperature: 0, messages: [{ role: "user", content: prompt }] })
      });
      var j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || ("HTTP " + r.status));
      return (j.content || []).map(function (c) { return c.text || ""; }).join("");
    }
    var url = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "") + "/chat/completions";
    var r2 = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + key },
      body: JSON.stringify({ model: model, temperature: 0, messages: [{ role: "user", content: prompt }] })
    });
    var j2 = await r2.json();
    if (!r2.ok) throw new Error((j2.error && (j2.error.message || j2.error)) || ("HTTP " + r2.status));
    return j2.choices && j2.choices[0] && j2.choices[0].message ? j2.choices[0].message.content : "";
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function assist(cfg) {
    var root = cfg.mount;
    var id = "as" + Math.random().toString(36).slice(2, 7);
    root.innerHTML =
      '<div class="assist" hidden>' +
      '<p class="small" style="margin-top:0"><b>' + esc(cfg.title) + "</b> " + esc(cfg.lede || "") + "</p>" +
      '<textarea id="' + id + '-text" placeholder="' + esc(cfg.placeholder || "") + '"></textarea>' +
      (cfg.examples && cfg.examples.length ? '<p class="note">Try a sample: ' + cfg.examples.map(function (e, i) { return '<button type="button" class="linkish" data-ex="' + i + '">' + esc(e.label) + "</button>"; }).join(" · ") + "</p>" : "") +
      '<div class="row">' +
      '<div class="field"><label for="' + id + '-prov">Provider</label><select id="' + id + '-prov"><option value="anthropic">Anthropic</option><option value="openai">OpenAI-compatible</option></select></div>' +
      '<div class="field"><label for="' + id + '-model">Model</label><input id="' + id + '-model" type="text" value="claude-haiku-5-5" autocomplete="off"></div>' +
      '<div class="field ' + id + '-base" hidden><label for="' + id + '-base">Base URL</label><input id="' + id + '-base" type="text" value="https://api.openai.com/v1" autocomplete="off"></div>' +
      '<div class="field"><label for="' + id + '-key">Your API key</label><input id="' + id + '-key" type="password" autocomplete="off" placeholder="sk-..."></div>' +
      '<button type="button" class="primary" id="' + id + '-run">Read my text</button>' +
      "</div>" +
      '<p class="note">Your key stays in this tab: it is sent only to the provider you pick, never stored. No key? <button type="button" class="linkish" id="' + id + '-copyp">Copy the prompt</button> into any chat assistant, then <button type="button" class="linkish" id="' + id + '-pastebtn">paste its reply</button>.</p>' +
      '<div id="' + id + '-paste" hidden style="margin-top:8px"><textarea id="' + id + '-reply" placeholder="Paste the assistant\'s JSON reply here"></textarea><div class="row"><button type="button" id="' + id + '-usereply">Use this reply</button></div></div>' +
      '<p class="toast" id="' + id + '-toast"></p>' +
      '<div class="assist-result" id="' + id + '-out"></div>' +
      "</div>";
    var box = root.querySelector(".assist");
    var $ = function (s) { return root.querySelector("#" + id + "-" + s); };
    var last = null;
    if (cfg.toggle) cfg.toggle.addEventListener("click", function () { box.hidden = !box.hidden; if (!box.hidden) $("text").focus(); });
    $("prov").addEventListener("change", function () {
      var oa = $("prov").value === "openai";
      root.querySelector("." + id + "-base").hidden = !oa;
      $("model").value = oa ? "" : "claude-haiku-5-5";
      $("model").placeholder = oa ? "model name" : "";
    });
    root.querySelectorAll("[data-ex]").forEach(function (b) {
      b.addEventListener("click", function () { $("text").value = cfg.examples[+b.getAttribute("data-ex")].text; });
    });
    $("copyp").addEventListener("click", function () {
      if (!$("text").value.trim()) { $("toast").textContent = "Paste your text first."; return; }
      copy(buildPrompt(cfg, $("text").value), $("toast"), "Prompt copied. Paste it into any assistant, then paste the reply here.");
      $("paste").hidden = false;
    });
    $("pastebtn").addEventListener("click", function () { $("paste").hidden = false; $("reply").focus(); });
    $("usereply").addEventListener("click", function () { show($("reply").value); });
    $("run").addEventListener("click", async function () {
      var text = $("text").value.trim();
      if (!text) { $("toast").textContent = "Paste your text first."; return; }
      if (!$("key").value.trim()) { $("toast").textContent = "Add your API key, or use Copy the prompt."; return; }
      if (!$("model").value.trim()) { $("toast").textContent = "Add a model name."; return; }
      $("run").disabled = true; $("toast").textContent = "Reading…";
      try {
        var reply = await callModel($("prov").value, $("key").value.trim(), $("model").value.trim(), $("base").value.trim(), buildPrompt(cfg, text));
        show(reply);
      } catch (e) {
        $("toast").textContent = "";
        $("out").innerHTML = '<p class="bad-text small">The provider returned an error: ' + esc(e.message || e) + ". Nothing was changed.</p>";
      } finally { $("run").disabled = false; }
    });
    function show(raw) {
      var text = $("text").value;
      $("toast").textContent = "";
      try { last = parseReply(raw); } catch (e) {
        $("out").innerHTML = '<p class="bad-text small">Could not read that reply: ' + esc(e.message) + "</p>"; return;
      }
      var rows = cfg.fields.map(function (f) {
        var item = last.fields[f.key] || {};
        var v = coerce(f, item.value);
        var q = item.quote;
        var verified = v === null || quoteFound(text, q);
        var shown = v === null ? '<span class="ns">Not stated</span>' : '<span class="num">' + esc(f.format ? f.format(v) : (Array.isArray(v) ? v.join(", ") : (typeof v === "number" ? v.toLocaleString("en-US") : v))) + "</span>";
        var quote = v === null ? "" : (q ? '<div class="quote">\u201c' + esc(q) + "\u201d" + (verified ? "" : ' <span class="bad-text">not found in your text: check it</span>') + "</div>" : '<div class="bad-text">No source phrase given: check it.</div>');
        return '<div class="as-item"><label><input type="checkbox" data-k="' + f.key + '" ' + (v !== null && verified ? "checked" : "") + (v === null ? " disabled" : "") + "> <span>" + esc(f.label) + ":</span> " + shown + "</label>" + quote + "</div>";
      }).join("");
      var qs = (last.questions || []).filter(Boolean);
      $("out").innerHTML = '<div class="as-list">' + rows + "</div>" +
        (qs.length ? '<div class="callout" style="margin-top:8px"><b>Worth checking:</b><ul style="margin:4px 0 0 18px;padding:0">' + qs.map(function (q) { return "<li>" + esc(q) + "</li>"; }).join("") + "</ul></div>" : "") +
        '<div class="row"><button type="button" class="primary" id="' + id + '-apply">Fill the form</button></div><p class="note">Only ticked values are used. The tool then computes the result itself; the model never sees it.</p>';
      $("apply").addEventListener("click", function () {
        var vals = {};
        root.querySelectorAll("input[data-k]").forEach(function (cb) {
          if (!cb.checked) return;
          var f = cfg.fields.filter(function (x) { return x.key === cb.getAttribute("data-k"); })[0];
          vals[f.key] = coerce(f, last.fields[f.key].value);
        });
        cfg.apply(vals);
        $("toast").textContent = "Filled " + Object.keys(vals).length + " input" + (Object.keys(vals).length === 1 ? "" : "s") + ".";
      });
    }
    return { buildPrompt: function (t) { return buildPrompt(cfg, t); }, parseReply: parseReply };
  }


  /* ---------------- explanations ("?" buttons) ----------------
   * Markup: <button type="button" class="tip" data-tip="key">?</button>
   * placed next to a label or result. glossary[key] = { t: "Term", d: "Plain explanation" }.
   * The explanation opens as a small card under the button; Esc, a click
   * elsewhere, or switching modes closes it. No layout shift: the card floats.
   */
  var tipCard = null, tipOwner = null;
  function closeTip() {
    if (tipCard) { tipCard.remove(); tipCard = null; }
    if (tipOwner) { tipOwner.setAttribute("aria-expanded", "false"); tipOwner = null; }
  }
  function placeTip(btn) {
    if (!tipCard) return;
    var r = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    var w = Math.min(340, vw - 24);
    tipCard.style.width = w + "px";
    var left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, vw - w - 12));
    tipCard.style.left = (left + window.scrollX) + "px";
    tipCard.style.top = (r.bottom + window.scrollY + 6) + "px";
  }
  var GLOSS = {};
  function decorate(root) {
    (root.querySelectorAll ? root : document).querySelectorAll("[data-tip]:not(.tip)").forEach(function (btn) {
      var g = GLOSS[btn.getAttribute("data-tip")];
      if (!g) return;
      btn.classList.add("tip");
      if (btn.tagName === "BUTTON") btn.type = "button";
      if (!btn.textContent.trim()) btn.textContent = "?";
      btn.setAttribute("aria-label", "What is " + g.t.replace(/[.?:]$/, "") + "?");
      btn.title = "Explain: " + g.t.replace(/[.?:]$/, "");
      btn.setAttribute("aria-expanded", "false");
      // keep the "?" on the same line as the last word before it
      var prev = btn.previousSibling;
      if (prev && prev.nodeType === 3 && /\S/.test(prev.nodeValue) && !(btn.parentNode.classList && btn.parentNode.classList.contains("nowrap"))) {
        var m = prev.nodeValue.match(/^([\s\S]*?)(\S+)(\s*)$/);
        if (m) {
          prev.nodeValue = m[1];
          var span = document.createElement("span"); span.className = "nowrap";
          span.appendChild(document.createTextNode(m[2] + (m[3] ? "\u00a0" : "")));
          btn.parentNode.insertBefore(span, btn); span.appendChild(btn);
        }
      }
    });
  }
  /* Align labels, inputs and hints across the two input columns (CSS subgrid). */
  function alignFields(root) {
    if (typeof CSS === "undefined" || !CSS.supports || !CSS.supports("grid-template-rows", "subgrid")) return;
    (root || document).querySelectorAll(".fields").forEach(function (grid) {
      grid.classList.add("sg-on");
      Array.prototype.forEach.call(grid.children, function (f) {
        if (!f.classList.contains("field") || f.classList.contains("full") || f.classList.contains("sg")) return;
        var kids = Array.prototype.slice.call(f.children);
        if (!kids.length || kids[0].tagName !== "LABEL" || kids.length < 2) return;
        var after = document.createElement("div"); after.className = "field-after";
        kids.slice(2).forEach(function (k) { after.appendChild(k); });
        f.appendChild(after); f.classList.add("sg");
      });
    });
  }
  function explain(glossary) {
    Object.keys(glossary || {}).forEach(function (k) { GLOSS[k] = glossary[k]; });
    decorate(document);
    if (explain._wired) return;
    explain._wired = true;
    new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.hasAttribute("data-tip")) decorate(n.parentNode || document); else decorate(n); } }); }); })
      .observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-tip]") : null;
      if (btn && GLOSS[btn.getAttribute("data-tip")]) {
        e.preventDefault();
        var same = tipOwner === btn; closeTip(); if (same) return;
        var g = GLOSS[btn.getAttribute("data-tip")];
        tipCard = document.createElement("div");
        tipCard.className = "tip-card"; tipCard.setAttribute("role", "note");
        tipCard.id = "tipc-" + Math.random().toString(36).slice(2, 8);
        btn.setAttribute("aria-describedby", tipCard.id);
        tipCard.innerHTML = '<p class="tip-t">' + esc(g.t) + '</p><p class="tip-d">' + g.d + "</p>";
        document.body.appendChild(tipCard);
        tipOwner = btn; btn.setAttribute("aria-expanded", "true"); placeTip(btn);
        return;
      }
      if (tipCard && !tipCard.contains(e.target)) closeTip();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && tipCard) { var o = tipOwner; closeTip(); if (o) o.focus(); } });
    window.addEventListener("resize", function () { if (tipOwner) placeTip(tipOwner); });
  }

  /* ---------------- the shared tool list ---------------- */
  var TOOLS = [
    ["bayesian-ab-lab", "A/B Test Decision Tool"],
    ["queue-simulator", "Call Center Staffing Planner"],
    ["experiment-hazard-simulator", "Agent Eval Planner"],
    ["llm-eval-error-bars", "Error Bars for LLM Evals"],
    ["ordering-policy-tester", "Ordering Policy Tester"],
    ["order-quantity-planner", "Order Quantity Planner"],
    ["production-line-simulator", "Production Line Bottleneck Finder"],
    ["persuasion-checker", "Which Draft Persuades?"],
    ["gpu-budget-planner", "GPU Budget Planner"]
  ];
  function siblings(current) {
    var host = document.querySelector(".kit-siblings");
    if (!host) return;
    host.innerHTML = '<span class="kit-siblings-label">More tools:</span> ' + TOOLS.map(function (t) {
      return t[0] === current ? '<a href="https://omidgolchin.github.io/' + t[0] + '/" aria-current="page">' + t[1] + "</a>"
        : '<a href="https://omidgolchin.github.io/' + t[0] + '/">' + t[1] + "</a>";
    }).join(" · ");
  }

  /* ---------------- tabs: arrow keys, panels ---------------- */
  function tabs(list) {
    list = list || document.querySelector("[role=tablist]");
    if (!list) return;
    var items = Array.prototype.slice.call(list.querySelectorAll("[role=tab]"));
    items.forEach(function (t) {
      t.addEventListener("click", function () { closeTip(); });
      t.addEventListener("keydown", function (e) {
        var i = items.indexOf(t), j = -1;
        if (e.key === "ArrowRight") j = (i + 1) % items.length;
        else if (e.key === "ArrowLeft") j = (i - 1 + items.length) % items.length;
        else if (e.key === "Home") j = 0; else if (e.key === "End") j = items.length - 1;
        if (j < 0) return;
        e.preventDefault(); items[j].focus(); items[j].click();
      });
    });
    var sync = function () { items.forEach(function (t) { t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1; }); };
    sync(); new MutationObserver(sync).observe(list, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
  }


  /* ---------------- example banner, jump to result ---------------- */
  // Marks prefilled example content where it sits, so a first-time visitor
  // does not read the demo verdict as their own. text = null hides it.
  function exampleBanner(form, text) {
    if (!form) return;
    var b = form.querySelector(":scope > .ex-banner");
    if (!text) { if (b) b.hidden = true; return; }
    if (!b) {
      b = document.createElement("p"); b.className = "ex-banner"; b.setAttribute("role", "status");
      var head = form.querySelector(":scope > .panel-head");
      if (head && head.nextSibling) form.insertBefore(b, head.nextSibling); else form.insertBefore(b, form.firstChild);
    }
    b.hidden = false;
    b.innerHTML = '<span class="ex-tag">Example</span> ' + text;
  }
  // Show the banner now and hide it at the visitor's first real edit of the form.
  // Programmatic fills (examples, URL state) do not fire trusted events, and the
  // example menu itself (.example) is ignored, so loading another example keeps it.
  function exampleWatch(form, text) {
    if (!form) return;
    exampleBanner(form, text);
    if (form._exWatch) return;
    form._exWatch = true;
    var off = function (e) {
      if (!e.isTrusted) return;
      var t = e.target;
      if (t && t.classList && (t.classList.contains("example") || t.closest(".ex-keep"))) return;
      exampleBanner(form, null);
    };
    form.addEventListener("input", off);
    form.addEventListener("change", off);
  }
  // On narrow screens the inputs come first; give a way straight to the result.
  function jumpLinks() {
    document.querySelectorAll(".work").forEach(function (w, i) {
      var form = w.querySelector("form.panel"), v = w.querySelector(".verdict");
      if (!form || !v || form.querySelector(".jump")) return;
      if (!v.id) v.id = "result-" + i;
      var a = document.createElement("a"); a.className = "jump"; a.href = "#" + v.id; a.textContent = "Skip to the result ↓";
      var head = form.querySelector(":scope > .panel-head");
      if (head && head.nextSibling) form.insertBefore(a, head.nextSibling); else form.insertBefore(a, form.firstChild);
    });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", function () {
      var m = location.pathname.match(/\/([^\/]+)\/(?:docs\/)?(?:index\.html)?$/);
      siblings(m ? m[1] : "");
      tabs();
      alignFields();
      jumpLinks();
    });
  }

  var api = { explain: explain, alignFields: alignFields, exampleBanner: exampleBanner, exampleWatch: exampleWatch, jumpLinks: jumpLinks, closeTip: closeTip, siblings: siblings, tabs: tabs, TOOLS: TOOLS, readParams: readParams, writeParams: writeParams, copy: copy, fmt: fmt, lineChart: lineChart, niceTicks: niceTicks, assist: assist, _buildPrompt: buildPrompt, _parseReply: parseReply, _quoteFound: quoteFound, _coerce: coerce };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Tool = api;
})();
