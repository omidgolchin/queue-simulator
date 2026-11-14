/* Call Center Staffing Planner: page logic. Engine in staffing.js and qsim.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var F = Tool.fmt;
  var DEFAULTS = {
    mode: "hour", calls: 120, aht: 6, tPct: 80, tSec: 20, patience: "", shrink: 30, occCap: 90, cost: "",
    dCalls: 1800, dShape: "nyc", dOpen: 8, dClose: 20, dPaste: "", dAht: 6, dShrink: 30, dPct: 80, dSec: 20, dMin: 2, dCost: 28
  };
  var EXAMPLES = [
    { label: "Support desk (30 calls an hour)", v: { calls: 30, aht: 5, tPct: 80, tSec: 20, patience: "", shrink: 30 } },
    { label: "Clinic phone line, callers hang up", v: { calls: 40, aht: 4, tPct: 90, tSec: 30, patience: 3, shrink: 25 } },
    { label: "Monday rush (75 an hour)", v: { calls: 75, aht: 5, tPct: 80, tSec: 20, patience: "", shrink: 30 } },
    { label: "Retail peak season", v: { calls: 240, aht: 6, tPct: 80, tSec: 20, patience: 2, shrink: 35 } },
    { label: "Large center, tight target", v: { calls: 600, aht: 4.5, tPct: 90, tSec: 15, patience: "", shrink: 32 } }
  ];
  var IDS_H = ["calls", "aht", "tPct", "tSec", "patience", "shrink", "occCap", "cost"];
  var IDS_D = ["dCalls", "dShape", "dOpen", "dClose", "dPaste", "dAht", "dShrink", "dPct", "dSec", "dMin", "dCost"];
  var state = Tool.readParams(DEFAULTS);
  var last = null, lastDay = null, live = null;

  for (var h = 0; h <= 24; h++) {
    var lab = (h < 10 ? "0" : "") + h + ":00";
    if (h < 24) { var o = document.createElement("option"); o.value = h; o.textContent = lab; $("dOpen").appendChild(o); }
    if (h > 0) { var o2 = document.createElement("option"); o2.value = h; o2.textContent = lab; $("dClose").appendChild(o2); }
  }
  function setInputs(v) { Object.keys(v).forEach(function (k) { var e = $(k); if (e) e.value = v[k] === null ? "" : v[k]; }); }
  setInputs(state);
  EXAMPLES.forEach(function (ex, i) { var o = document.createElement("option"); o.value = i; o.textContent = ex.label; $("example").appendChild(o); });
  $("example").addEventListener("change", function () {
    if (this.value === "") return; setInputs(EXAMPLES[+this.value].v); this.value = "";
    document.querySelectorAll(".field.filled").forEach(function (f) { f.classList.remove("filled"); }); runHour();
  });
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  IDS_H.forEach(function (id) { $(id).addEventListener("input", debounce(runHour, 250)); });
  IDS_D.forEach(function (id) { $(id).addEventListener("input", debounce(runDay, 200)); $(id).addEventListener("change", runDay); });
  function setMode(m) {
    state.mode = m;
    $("tab-hour").classList.toggle("active", m === "hour"); $("tab-hour").setAttribute("aria-selected", m === "hour");
    $("tab-day").classList.toggle("active", m === "day"); $("tab-day").setAttribute("aria-selected", m === "day");
    $("view-hour").hidden = m !== "hour"; $("view-day").hidden = m !== "day";
    if (m === "day") { stopLive(); runDay(); } else runHour();
  }
  $("tab-hour").addEventListener("click", function () { setMode("hour"); });
  $("tab-day").addEventListener("click", function () { setMode("day"); });
  window.addEventListener("resize", debounce(function () { if (state.mode === "day") runDay(); else if (last) drawChart(); }, 200));
  if (window.KitTheme) KitTheme.onChange(function () { setTimeout(function () { if (state.mode === "day") runDay(); else if (last) drawChart(); }, 0); });
  function num(id) { var v = $(id).value; return v === "" ? null : Number(v); }
  function fieldError(id, msg) {
    var f = $(id).closest(".field"); var e = f.querySelector(".err");
    f.classList.toggle("invalid", !!msg);
    if (msg) { if (!e) { e = document.createElement("div"); e.className = "err"; f.appendChild(e); } e.textContent = msg; }
    else if (e) e.remove();
  }
  function secs(min) { var s = min * 60; return s < 10 ? s.toFixed(1) + " s" : s < 120 ? Math.round(s) + " s" : (s / 60).toFixed(1) + " min"; }

  /* ---------- AI assist ---------- */
  Tool.assist(Object.assign({}, window.ASSIST_CONFIG, {
    mount: $("assistMount"), toggle: $("assistToggle"),
    apply: function (vals) {
      document.querySelectorAll(".field.filled").forEach(function (f) { f.classList.remove("filled"); });
      var mark = function (id, v) { if (v === undefined || v === null) return; $(id).value = v; var f = $(id).closest(".field"); if (f) f.classList.add("filled"); };
      mark("calls", vals.calls); mark("aht", vals.aht); mark("tPct", vals.tPct); mark("tSec", vals.tSec); mark("patience", vals.patience); mark("shrink", vals.shrink); mark("cost", vals.cost);
      mark("dAht", vals.aht); mark("dPct", vals.tPct); mark("dSec", vals.tSec); mark("dShrink", vals.shrink); mark("dCost", vals.cost);
      mark("dOpen", vals.openFrom); mark("dClose", vals.openTo);
      if (vals.hourly && vals.hourly.length) {
        $("dShape").value = "custom"; mark("dPaste", vals.hourly.join(", "));
        mark("dCalls", vals.hourly.reduce(function (a, b) { return a + Number(b); }, 0));
      } else mark("dCalls", vals.callsPerDay);
      if (vals.hourly && vals.hourly.length && vals.calls == null) setMode("day"); else runHour();
    }
  }));

  /* ---------- one hour ---------- */
  function readHour() {
    var v = { calls: num("calls"), aht: num("aht"), tPct: num("tPct"), tSec: num("tSec"), patience: num("patience"), shrink: num("shrink"), occCap: num("occCap"), cost: num("cost") };
    var ok = true;
    function need(id, cond, msg) { fieldError(id, cond ? "" : msg); if (!cond) ok = false; }
    need("calls", v.calls > 0 && v.calls <= 20000, "Between 1 and 20,000.");
    need("aht", v.aht > 0 && v.aht <= 240, "Minutes, above 0.");
    need("tPct", v.tPct > 0 && v.tPct < 100, "1 to 99.9.");
    need("tSec", v.tSec > 0 && v.tSec <= 3600, "Seconds, above 0.");
    need("patience", v.patience === null || v.patience > 0, "Minutes above 0, or empty for never.");
    need("shrink", v.shrink !== null && v.shrink >= 0 && v.shrink < 80, "0 to 79.");
    need("occCap", v.occCap >= 50 && v.occCap <= 100, "50 to 100.");
    if (ok && v.patience === null && v.calls / 60 * v.aht > 3000) { need("calls", false, "Too large to plan here."); }
    return ok ? v : null;
  }
  function runHour() {
    var v = readHour();
    var urlState = { mode: "hour" }; IDS_H.forEach(function (k) { urlState[k] = $(k).value; }); Tool.writeParams(urlState);
    if (!v) { $("vTitle").textContent = "Check the highlighted inputs"; $("vBody").textContent = ""; $("kpis").innerHTML = ""; $("checks").innerHTML = ""; $("verdict").className = "panel verdict v-neutral"; return; }
    var lam = v.calls / 60, T = v.tSec / 60, level = v.tPct / 100, cap = v.occCap / 100, sh = v.shrink / 100;
    var e = Staffing.staffErlang(lam, v.aht, T, level, cap);
    var res = { v: v, lam: lam, T: T, level: level, cap: cap, sh: sh, erlang: e };
    if (v.patience) {
      var s = Staffing.staffSim(lam, v.aht, T, level, cap, v.patience, { reps: 20, minutes: 480, warmup: 60 });
      res.c = s.c; res.binding = s.binding; res.sl = s.sim.sl.mean; res.slHalf = s.sim.sl.half; res.asa = s.sim.asa.mean; res.occ = s.sim.occ.mean; res.abandon = s.sim.abandon.mean; res.sim = s;
    } else { res.c = e.c; res.binding = e.binding; res.sl = e.sl; res.asa = e.asa; res.occ = e.occ; res.pWait = e.pWait; }
    res.sched = Staffing.scheduled(res.c, sh);
    // what-ifs (Erlang C; quick and conservative)
    if (v.patience) {
      var so = { reps: 20, minutes: 480, warmup: 60 };
      res.more10 = Staffing.staffSim(lam * 1.1, v.aht, T, level, cap, v.patience, so).c;
      res.longer10 = Staffing.staffSim(lam, v.aht * 1.1, T, level, cap, v.patience, so).c;
      res.slIfBusier = Staffing.simulate(lam * 1.1, v.aht, res.c, v.patience, Object.assign({ T: T }, so)).sl.mean;
    } else {
      res.more10 = Staffing.staffErlang(lam * 1.1, v.aht, T, level, cap).c;
      res.longer10 = Staffing.staffErlang(lam, v.aht * 1.1, T, level, cap).c;
      res.slIfBusier = Staffing.erlangMetrics(lam * 1.1, v.aht, res.c, T).sl;
    }
    var minus1 = v.patience ? Staffing.simulate(lam, v.aht, Math.max(1, res.c - 1), v.patience, { reps: 20, T: T }).sl.mean : Staffing.erlangMetrics(lam, v.aht, res.c - 1, T).sl;
    res.slMinus1 = minus1;
    last = res;
    renderHour(); drawChart(); startLive(res.c);
  }
  function renderHour() {
    var r = last, v = r.v;
    var title = "Put " + r.c + " agent" + (r.c === 1 ? "" : "s") + " on the phones";
    var body = "Schedule " + r.sched + " " + (r.sched === 1 ? "person" : "people") + " to cover " + v.shrink + "% shrinkage. Expected: " + F.pct(r.sl, 0) + " of calls answered within " + v.tSec + " seconds, an average wait of " + secs(r.asa) + ", agents busy " + F.pct(r.occ, 0) + " of the time.";
    if (r.binding === "occupancy") body += " The service target alone needs " + (r.sim ? r.sim.cService : r.erlang.cService) + "; the extra agents keep everyone under " + v.occCap + "% busy.";
    if (r.sim) body += " Callers hang up after about " + v.patience + " minutes, so this comes from simulation; about " + F.pct(r.abandon, 1) + " of callers hang up. " + (r.c !== r.erlang.c ? "The formula, which assumes nobody hangs up, would say " + r.erlang.c + "." : "The formula agrees.");
    if (v.cost) body += " Cost: " + F.money(r.sched * v.cost) + " for the hour.";
    $("vTitle").textContent = title; $("vBody").textContent = body; $("verdict").className = "panel verdict v-good";
    r.title = title; r.body = body;
    var k = [[F.pct(r.sl, 0), "answered within " + v.tSec + " s"], [secs(r.asa), "average wait"], [F.pct(r.occ, 0), "agents busy"]];
    k.push(r.sim ? [F.pct(r.abandon, 1), "callers who hang up"] : [F.pct(r.pWait, 0), "callers who wait at all"]);
    $("kpis").innerHTML = k.map(function (x) { return '<div class="kpi"><span class="k-val">' + x[0] + '</span><span class="k-lbl">' + x[1] + "</span></div>"; }).join("");
    var c = [];
    c.push(r.binding === "occupancy" ? ["warn", "RAISED", "Occupancy", "Meeting the target alone would keep agents over " + v.occCap + "% busy, which burns people out and slows calls. Staffed up to stay under the cap."] : ["ok", "OK", "Occupancy", F.pct(r.occ, 0) + " busy, under your " + v.occCap + "% cap."]);
    c.push(r.sim ? ["ok", "SIMULATED", "Hang-ups", "20 simulated 8-hour runs: service level " + F.pct(r.sl, 0) + " ± " + (100 * r.slHalf).toFixed(1) + " points. Erlang C ignores hang-ups and would say " + r.erlang.c + "."] : ["info", "NOTE", "Hang-ups", "Assuming nobody hangs up. If callers do, add their patience: the formula then overstaffs and the simulation takes over."]);
    c.push(["info", "WHAT IF", "Busier than forecast", "10% more calls needs " + r.more10 + " agents; with " + r.c + ", service drops to " + F.pct(r.slIfBusier, 0) + "."]);
    c.push(["info", "WHAT IF", "One agent short", "With " + (r.c - 1) + " agents, service drops to " + F.pct(Math.max(0, r.slMinus1), 0) + ". Longer calls (+10%) need " + r.longer10 + "."]);
    c.push(["info", "NOTE", "Call length spread", "Assumes call lengths vary as much as in a typical center. Very variable calls (a few very long ones) can double waits at the same average: add a margin if yours do."]);
    $("checks").innerHTML = c.map(function (x) { return '<div class="check is-' + x[0] + '"><span class="badge">' + x[1] + '</span><div><span class="c-name">' + x[2] + '.</span> <span class="c-text">' + x[3] + "</span></div></div>"; }).join("");
    r.checks = c;
  }
  function drawChart() {
    var r = last, v = r.v, a = r.lam * v.aht;
    var lo = Math.max(1, r.c - 4), hi = r.c + 4, formula = [], simPts = [], ci = [];
    for (var c = lo; c <= hi; c++) {
      if (c > a) formula.push([c, 100 * Staffing.erlangMetrics(r.lam, v.aht, c, r.T).sl]);
      var s = Staffing.simulate(r.lam, v.aht, c, v.patience || null, { reps: 12, T: r.T, minutes: 480, warmup: 60, seed: 3 });
      simPts.push([c, 100 * s.sl.mean]); ci.push([100 * (s.sl.mean - s.sl.half), 100 * Math.min(1, s.sl.mean + s.sl.half)]);
    }
    var series = [];
    if (formula.length) series.push({ label: v.patience ? "Erlang C (nobody hangs up)" : "Erlang C formula", color: "neutral", points: formula, dash: v.patience ? "5 4" : null });
    series.push({ label: "Simulation (95% interval)", color: "accent", points: simPts, ci: ci, markersOnly: true, markers: true, highlight: r.c - lo });
    Tool.lineChart($("slChart"), {
      series: series, legend: true, yMin: 0, yMax: 100, height: 260,
      hLines: [{ y: v.tPct, label: "target " + v.tPct + "%", color: "series2", labelLeft: true }],
      xTitle: "agents on the phones", yTitle: "% answered within " + v.tSec + " s",
      xTicks: (function () { var t = []; for (var k = lo; k <= hi; k++) t.push(k); return t; })(),
      xFormat: function (x) { return String(x); }, yFormat: function (y) { return y + "%"; }
    });
    $("slCaption").textContent = "Each added agent buys less: from " + (r.c - 1) + " to " + r.c + " agents the service level moves " + Math.round(100 * (r.sl - Math.max(0, r.slMinus1))) + " points. Points are simulated (12 runs each); " + (v.patience ? "the dashed line is what Erlang C would predict if nobody hung up." : "the line is Erlang C, and the two agree.");
  }

  /* ---------- live queue ---------- */
  var raf = null, liveC = null;
  function startLive(c) {
    liveC = c;
    live = Staffing.makeLive(last.lam, last.v.aht, c, last.v.patience || null, last.T, 7);
    live.step(30); live.resetCounters(); // warm start: the floor is busy from the first frame
    if (!raf) loop();
  }
  function stopLive() { if (raf) cancelAnimationFrame(raf); raf = null; }
  var lastTs = null;
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (state.mode !== "hour" || !live) return;
    if (lastTs == null) lastTs = ts || 0;
    var dt = Math.min(0.1, ((ts || 0) - lastTs) / 1000); lastTs = ts || 0;
    if (live.now - live.t0 < 60) live.step(Math.min(60 - (live.now - live.t0), dt * Number($("speed").value))); // simulated minutes per real second
    drawLive();
  }
  function drawLive() {
    var n = liveC, fl = $("floor");
    if (fl.children.length !== n) { fl.innerHTML = ""; for (var i = 0; i < n; i++) { var d = document.createElement("div"); d.className = "agent"; fl.appendChild(d); } }
    var busy = 0;
    for (var j = 0; j < n; j++) { fl.children[j].classList.toggle("busy", live.agents[j]); if (live.agents[j]) busy++; }
    var q = live.queue.length, html = ""; for (var k = 0; k < Math.min(q, 60); k++) html += '<span class="caller"></span>'; if (q > 60) html += '<span class="caller more">+' + (q - 60) + "</span>";
    $("qbar").innerHTML = html; $("qn").textContent = q;
    var mins = Math.min(60, live.now - live.t0);
    $("liveLabel").textContent = n + " agents · " + last.v.calls + " calls an hour · minute " + Math.floor(mins) + " of 60" + (mins >= 60 ? " (hour done: press Restart)" : "");
    $("liveStats").innerHTML = "<span>Answered <b>" + live.answered + "</b></span><span>Within " + last.v.tSec + " s <b>" + (live.answered ? Math.round(100 * live.within / live.answered) + "%" : "\u2013") + "</b></span><span>Hung up <b>" + live.abandoned + "</b></span><span>Agents busy now <b>" + busy + " of " + n + "</b></span>";
  }
  $("minus").addEventListener("click", function () { if (liveC > 1) startLive(liveC - 1); });
  $("plus").addEventListener("click", function () { startLive(liveC + 1); });
  $("restart").addEventListener("click", function () { startLive(liveC); });
  $("copyLink").addEventListener("click", function () { Tool.copy(location.href, $("toast"), "Link copied: it opens with these inputs."); });
  $("copySummary").addEventListener("click", function () {
    if (!last) return; var r = last, v = r.v;
    Tool.copy(["Staffing: " + r.title, r.body, "", "Inputs: " + v.calls + " calls/hour, " + v.aht + " min handle time, target " + v.tPct + "% in " + v.tSec + " s, " + (v.patience ? "patience " + v.patience + " min, " : "") + "shrinkage " + v.shrink + "%, occupancy cap " + v.occCap + "%", "What if: " + r.checks.slice(2).map(function (c) { return c[3]; }).join(" "), "", "Open with these inputs: " + location.href].join("\n"), $("toast"), "Summary copied.");
  });

  /* ---------- day ---------- */
  function dayCalls() {
    var open = Number($("dOpen").value), close = Number($("dClose").value), total = num("dCalls");
    var hours = []; for (var h = open; h < close; h++) hours.push(h);
    if ($("dShape").value === "custom") {
      var nums = ($("dPaste").value.match(/-?\d+(\.\d+)?/g) || []).map(Number);
      $("pasteHint").textContent = nums.length + " number" + (nums.length === 1 ? "" : "s") + " for " + hours.length + " open hour" + (hours.length === 1 ? "" : "s") + ".";
      if (nums.length !== hours.length) return { err: "Enter one number per open hour (" + hours.length + ")." };
      return { hours: hours, calls: nums };
    }
    var shape = $("dShape").value === "flat" ? hours.map(function () { return 1; }) : hours.map(function (h) { return window.NYC_SHAPE[h]; });
    var s = shape.reduce(function (a, b) { return a + b; }, 0);
    return { hours: hours, calls: shape.map(function (x) { return total * x / s; }) };
  }
  function runDay() {
    $("pasteWrap").hidden = $("dShape").value !== "custom";
    var urlState = { mode: "day" }; IDS_D.forEach(function (k) { urlState[k] = $(k).value; }); Tool.writeParams(urlState);
    var ok = true;
    function need(id, cond, msg) { fieldError(id, cond ? "" : msg); if (!cond) ok = false; }
    need("dCalls", $("dShape").value === "custom" || num("dCalls") > 0, "Above 0.");
    need("dAht", num("dAht") > 0, "Minutes, above 0.");
    need("dShrink", num("dShrink") >= 0 && num("dShrink") < 80, "0 to 79.");
    need("dPct", num("dPct") > 0 && num("dPct") < 100, "1 to 99.9.");
    need("dMin", num("dMin") >= 1, "1 or more.");
    need("dClose", Number($("dClose").value) > Number($("dOpen").value), "After the opening hour.");
    var dc = ok ? dayCalls() : null;
    if (dc && dc.err) { fieldError("dPaste", dc.err); ok = false; } else fieldError("dPaste", "");
    if (!ok) { $("dTitle").textContent = "Check the highlighted inputs"; $("dBody").textContent = ""; $("dKpis").innerHTML = ""; $("dChecks").innerHTML = ""; return; }
    var aht = num("dAht"), T = num("dSec") / 60, level = num("dPct") / 100, sh = num("dShrink") / 100, cap = (num("occCap") || 90) / 100;
    var plan = Staffing.dayPlan(dc.calls, 60, aht, T, level, cap, sh, num("dMin"));
    plan.hours = dc.hours; lastDay = plan;
    var peakC = plan.peak.c, peakHours = plan.rows.filter(function (r) { return r.c === peakC; }).map(function (r) { return dc.hours[r.i]; });
    var span = peakHours.length ? fmtH(peakHours[0]) + "–" + fmtH(peakHours[peakHours.length - 1] + 1) : "";
    var cost = num("dCost");
    $("dTitle").textContent = "Peak: " + peakC + " agents, " + span;
    $("dBody").textContent = "Across the day: " + Math.round(plan.agentHours) + " agent-hours on the phones and " + Math.round(plan.paidHours) + " paid hours after " + num("dShrink") + "% shrinkage" + (cost ? " (" + F.money(plan.paidHours * cost) + " at " + F.money(cost) + " an hour)" : "") + ". Expected: " + F.pct(plan.daySL, 0) + " of the day's " + F.int(plan.totalCalls) + " calls answered within " + num("dSec") + " seconds.";
    var flat = Staffing.staffErlang(plan.totalCalls / dc.hours.length / 60, aht, T, level, cap).c;
    var peakLam = Math.max.apply(null, dc.calls) / 60, slFlat = Staffing.erlangMetrics(peakLam, aht, flat, T).sl;
    $("dKpis").innerHTML = [[peakC, "agents at the peak"], [Math.round(plan.agentHours), "agent-hours"], [Math.round(plan.paidHours), "paid hours"], [F.pct(plan.daySL, 0), "of calls within target"]].map(function (x) { return '<div class="kpi"><span class="k-val">' + x[0] + '</span><span class="k-lbl">' + x[1] + "</span></div>"; }).join("");
    var cks = [["info", "WHY", "Hour by hour", "Staffing the whole day for the average hour (" + flat + " agents) would leave the peak at " + F.pct(Math.max(0, slFlat), 0) + " within target."]];
    var capped = plan.rows.filter(function (r) { return r.binding === "occupancy"; }).length;
    cks.push(capped ? ["warn", "RAISED", "Occupancy", capped + " hour" + (capped === 1 ? "" : "s") + " staffed up to keep agents under " + Math.round(cap * 100) + "% busy."] : ["ok", "OK", "Occupancy", "Every hour under " + Math.round(cap * 100) + "% busy."]);
    var minned = plan.rows.filter(function (r) { return r.binding === "minimum"; }).length;
    if (minned) cks.push(["info", "FLOOR", "Quiet hours", minned + " hour" + (minned === 1 ? "" : "s") + " held at your minimum of " + num("dMin") + " agents."]);
    $("dChecks").innerHTML = cks.map(function (x) { return '<div class="check is-' + x[0] + '"><span class="badge">' + x[1] + '</span><div><span class="c-name">' + x[2] + '.</span> <span class="c-text">' + x[3] + "</span></div></div>"; }).join("");
    lastDay.title = $("dTitle").textContent; lastDay.body = $("dBody").textContent;
    var peakIdx = plan.rows.map(function (r, i) { return r.c === peakC ? i : -1; }).filter(function (i) { return i >= 0; });
    Tool.lineChart($("dayChart"), {
      series: [{ points: plan.rows.map(function (r, i) { return [dc.hours[i], r.c]; }), bars: true, color: "accent", highlight: peakIdx }],
      xTitle: "hour of day", yTitle: "agents on the phones", yMin: 0, height: 250,
      xMin: dc.hours[0] - 0.6, xMax: dc.hours[dc.hours.length - 1] + 0.6,
      xTicks: dc.hours.filter(function (h, i) { return dc.hours.length <= 12 || i % 2 === 0; }),
      xFormat: function (x) { return fmtH(x); }, yFormat: function (y) { return String(Math.round(y)); }
    });
    $("dTable").innerHTML = "<thead><tr><th>Hour</th><th class=\"num\">Calls</th><th class=\"num\">Agents</th><th class=\"num\">Schedule</th><th class=\"num\">Within target</th><th class=\"num\">Avg wait</th></tr></thead><tbody>" +
      plan.rows.map(function (r, i) { return "<tr><td>" + fmtH(dc.hours[i]) + "</td><td class=\"num\">" + Math.round(r.calls) + "</td><td class=\"num\">" + r.c + "</td><td class=\"num\">" + r.sched + "</td><td class=\"num\">" + F.pct(r.sl, 0) + "</td><td class=\"num\">" + (r.calls ? secs(r.asa) : "–") + "</td></tr>"; }).join("") + "</tbody>";
  }
  function fmtH(h) { return (h < 10 ? "0" : "") + h + ":00"; }
  $("dLink").addEventListener("click", function () { Tool.copy(location.href, $("dToast"), "Link copied."); });
  $("dCopy").addEventListener("click", function () { if (lastDay) Tool.copy(["Day plan: " + lastDay.title, lastDay.body, "", "Open this plan: " + location.href].join("\n"), $("dToast"), "Plan copied."); });
  $("dCsv").addEventListener("click", function () {
    if (!lastDay) return;
    var rows = [["hour", "calls", "agents_on_phones", "people_to_schedule", "service_level", "avg_wait_seconds"]].concat(lastDay.rows.map(function (r, i) { return [fmtH(lastDay.hours[i]), Math.round(r.calls), r.c, r.sched, r.sl.toFixed(3), (r.asa * 60).toFixed(1)]; }));
    var blob = new Blob([rows.map(function (r) { return r.join(","); }).join("\n")], { type: "text/csv" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "staffing-plan.csv"; document.body.appendChild(a); a.click(); a.remove();
    $("dToast").textContent = "CSV downloaded.";
  });

  setMode(state.mode === "day" ? "day" : "hour");
})();
