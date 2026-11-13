"use strict";
/* app.js — wires the controls, the live simulation, the staffing
 * answer and the precomputed chart. All simulation/formula logic lives
 * in qsim.js and is checked against the Python implementation. */

const $ = (id) => document.getElementById(id);
const TARGET_MIN = 20 / 60;

let sim = null;
let simSpeed = 3; // simulated minutes per real second

function patienceValue() {
  const v = Number($("in-pat").value);
  return v >= 31 ? null : v;
}

function currentParams() {
  return {
    lamPerHour: Number($("in-lam").value),
    serviceMin: Number($("in-svc").value),
    servers: Number($("in-srv").value),
    patienceMean: patienceValue(),
  };
}

function newSim(seed) {
  const p = currentParams();
  sim = new LiveSim({
    lamPerMin: p.lamPerHour / 60,
    serviceMean: p.serviceMin,
    servers: p.servers,
    patienceMean: p.patienceMean,
    seed: seed || (Math.floor(Math.random() * 1e9) + 1),
  });
}

function syncOutputs() {
  const p = currentParams();
  $("o-lam").textContent = p.lamPerHour;
  $("o-svc").textContent = p.serviceMin;
  $("o-srv").textContent = p.servers;
  $("o-pat").textContent = p.patienceMean === null
    ? "never give up" : `${p.patienceMean} min on average`;
}

function syncSim() {
  const p = currentParams();
  sim.configure({
    lamPerMin: p.lamPerHour / 60,
    serviceMean: p.serviceMin,
    servers: p.servers,
    patienceMean: p.patienceMean,
  });
}

function formulaPanel() {
  const p = currentParams();
  const lam = p.lamPerHour / 60, mu = 1 / p.serviceMin;
  const a = lam / mu;
  if (a >= p.servers) {
    $("st-fw").textContent = "no steady state";
    $("staffing").innerHTML =
      `<span class="warn">The queue never settles:</span> ` +
      `${p.lamPerHour} calls/hour × ${p.serviceMin} min needs ` +
      `${a.toFixed(1)} agents' worth of work, so ${p.servers} agents ` +
      `fall behind all day. The formula has no answer — the simulation ` +
      `shows the queue growing.`;
    return;
  }
  const r = mmc(lam, mu, p.servers);
  $("st-fw").textContent = `${r.meanWaitQ.toFixed(2)} min`;
  const need = serversNeeded(lam, mu, TARGET_MIN, 0.80);
  $("staffing").textContent =
    `You need ${need} agents to answer 80% of calls within 20 seconds ` +
    `(formula). With ${p.servers}: average wait ${r.meanWaitQ.toFixed(2)} min, ` +
    `${(100 * r.pWaitOver(TARGET_MIN)).toFixed(0)}% of callers wait over 20 s.`;
}

function renderSim() {
  const s = sim.stats();
  const busy = sim.serving.filter(Boolean).length;
  const label = $("agents-label");
  if (s.arrivals === 0 && busy === 0) {
    // Before the first call the tiles alone read as a glitch; say
    // plainly that this is the idle state and how the day starts.
    label.textContent =
      `${sim.servers} agents idle; press Start to begin the day`;
  } else {
    label.textContent =
      `${sim.servers} agents: ${busy} on a call, ${sim.servers - busy} idle`;
  }
  const srv = $("servers");
  srv.innerHTML = "";
  for (let i = 0; i < sim.servers; i++) {
    const d = document.createElement("div");
    d.className = "server" + (sim.serving[i] ? " busy" : "");
    d.textContent = sim.serving[i] ? "on a call" : "idle";
    srv.appendChild(d);
  }
  $("queue").textContent = "●".repeat(Math.min(s.queueLen, 120)) +
    (s.queueLen > 120 ? ` …(${s.queueLen})` : "");
  $("st-wait").textContent = s.served >= 5 ? `${s.meanWait.toFixed(2)} min` : "–";
  $("st-over").textContent = s.served >= 5 ? `${s.pctOverTarget.toFixed(0)}%` : "–";
  $("st-aband").textContent = s.arrivals ? `${s.abandoned} (${(100 * s.abandoned / Math.max(1, s.arrivals)).toFixed(0)}%)` : "0";
  $("st-util").textContent = s.now > 1 ? `${(100 * s.utilisation).toFixed(0)}%` : "–";
}

let lastTs = null;
function tick(ts) {
  if (lastTs === null) lastTs = ts;
  const dtReal = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  sim.step(dtReal * simSpeed);
  renderSim();
  requestAnimationFrame(tick);
}

/* --- precomputed chart -------------------------------------------------- */

let chartData = null;

function drawFallbackChart(canvas, pts) {
  /* Hand-drawn version used when the Chart.js CDN is unreachable.
   * Draws the same chart: y-axis values and label, gridlines, error
   * bars on the simulation points, a line-swatch legend, and the
   * x-axis title below the tick labels, clear of them. */
  const ctx = canvas.getContext("2d");
  const W = canvas.width = canvas.clientWidth * 2;
  const H = canvas.height = 440;
  ctx.clearRect(0, 0, W, H);
  const L = 100, R = 28, T = 78, B = 84; // margins: left, right, top, bottom
  const plotW = W - L - R, plotH = H - T - B;
  const maxY = Math.max(...pts.map((p) =>
    Math.max(p.sim_wait_min + (p.sim_wait_ci_half || 0),
             p.formula_wait_min))) * 1.12;
  const minX = Math.min(...pts.map((p) => p.servers));
  const maxX = Math.max(...pts.map((p) => p.servers));
  const X = (c) => L + (c - minX) / (maxX - minX) * plotW;
  const Y = (v) => T + plotH - (v / maxY) * plotH;
  ctx.font = "20px system-ui";
  // y gridlines, tick values and axis label
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const v = maxY * i / 4, y = Y(v);
    ctx.strokeStyle = "rgba(136,136,136,0.35)"; ctx.beginPath();
    ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
    ctx.fillStyle = "#888";
    ctx.fillText(v.toFixed(1), L - 10, y);
  }
  ctx.save();
  ctx.translate(26, T + plotH / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center"; ctx.fillStyle = "#888";
  ctx.fillText("average wait (min)", 0, 0);
  ctx.restore();
  // axes
  ctx.strokeStyle = "#888"; ctx.beginPath();
  ctx.moveTo(L, T); ctx.lineTo(L, T + plotH); ctx.lineTo(W - R, T + plotH);
  ctx.stroke();
  // x tick labels, then the axis title on its own line below them
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = "#888";
  pts.forEach((p) => ctx.fillText(String(p.servers), X(p.servers), T + plotH + 8));
  ctx.fillText("agents →", L + plotW / 2, T + plotH + 38);
  // the two lines, with 95% CI error bars on the simulation points
  const line = (key, color, dashed) => {
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.setLineDash(dashed || []); ctx.beginPath();
    pts.forEach((p, i) => { const x = X(p.servers), y = Y(p[key]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke(); ctx.setLineDash([]);
    pts.forEach((p) => { ctx.beginPath(); ctx.arc(X(p.servers), Y(p[key]), 5, 0, 7); ctx.fill(); });
  };
  line("formula_wait_min", "#b3261e", [7, 5]);
  line("sim_wait_min", "#0b5fa5");
  ctx.strokeStyle = "#0b5fa5"; ctx.lineWidth = 2;
  pts.forEach((p) => {
    const h = p.sim_wait_ci_half || 0, x = X(p.servers);
    if (!h) return;
    ctx.beginPath();
    ctx.moveTo(x - 6, Y(p.sim_wait_min + h)); ctx.lineTo(x + 6, Y(p.sim_wait_min + h));
    ctx.moveTo(x, Y(p.sim_wait_min + h)); ctx.lineTo(x, Y(p.sim_wait_min - h));
    ctx.moveTo(x - 6, Y(p.sim_wait_min - h)); ctx.lineTo(x + 6, Y(p.sim_wait_min - h));
    ctx.stroke();
  });
  ctx.lineWidth = 1;
  // legend: one entry per row in the top margin, so both entries fit
  // even on a narrow (phone-width) canvas
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  const legend = (y, color, dashed, text) => {
    ctx.strokeStyle = color; ctx.setLineDash(dashed || []);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + 44, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.fillText(text, L + 54, y);
  };
  legend(20, "#0b5fa5", null, "simulation (Python, 20 reps, error bars = 95% CI)");
  legend(48, "#b3261e", [7, 5], "Erlang C formula");
}

/* Chart.js has no built-in error bars; this plugin draws the 95% CI
 * whiskers for dataset 0 (the simulation points) from chart.$ciHalf,
 * so the caption's "error bars = 95% CI" is what the chart shows. */
const ciErrorBarPlugin = {
  id: "ciErrorBars",
  afterDatasetsDraw(chart) {
    const halves = chart.$ciHalf;
    if (!halves) return;
    const meta = chart.getDatasetMeta(0);
    const { ctx, scales } = chart;
    ctx.save();
    ctx.strokeStyle = "#0b5fa5"; ctx.lineWidth = 1.5;
    meta.data.forEach((pt, i) => {
      const h = halves[i];
      if (!h) return;
      const v = chart.data.datasets[0].data[i];
      const yTop = scales.y.getPixelForValue(v + h);
      const yBot = scales.y.getPixelForValue(v - h);
      ctx.beginPath();
      ctx.moveTo(pt.x - 4, yTop); ctx.lineTo(pt.x + 4, yTop);
      ctx.moveTo(pt.x, yTop); ctx.lineTo(pt.x, yBot);
      ctx.moveTo(pt.x - 4, yBot); ctx.lineTo(pt.x + 4, yBot);
      ctx.stroke();
    });
    ctx.restore();
  },
};

function drawChart() {
  if (!chartData) return;
  const preset = chartData.presets[$("in-preset").value];
  const pts = preset.points;
  $("chart-note").textContent =
    `${preset.label}: ${preset.lam_h} calls/hour, ${preset.service_min}-minute calls. ` +
    `The formula's staffing answer for 80% within 20 s is ${preset.staffing_80_20} agents. ` +
    `Points: Python simulation (20 replications each, error bars = 95% CI) and the Erlang C formula.`;
  const canvas = $("chart");
  if (typeof Chart !== "undefined") {
    if (canvas._chart) canvas._chart.destroy();
    canvas._chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: pts.map((p) => p.servers),
        datasets: [
          { label: "SimPy simulation", data: pts.map((p) => p.sim_wait_min), borderColor: "#0b5fa5", backgroundColor: "#0b5fa5" },
          { label: "Erlang C formula", data: pts.map((p) => p.formula_wait_min), borderColor: "#b3261e", backgroundColor: "#b3261e", borderDash: [5, 4] },
        ],
      },
      plugins: [ciErrorBarPlugin],
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { boxWidth: 12, boxHeight: 2,
                              font: { size: 11 } } },
        },
        scales: {
          x: { title: { display: true, text: "agents" } },
          y: { beginAtZero: true,
               title: { display: true, text: "average wait (min)" } },
        },
      },
    });
    canvas._chart.$ciHalf = pts.map((p) => p.sim_wait_ci_half);
    canvas._chart.update();
  } else {
    drawFallbackChart(canvas, pts);
  }
}

/* --- LLM check + check cases -------------------------------------------- */

async function loadJson(path) {
  try {
    const r = await fetch(path);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fillLlm() {
  const data = await loadJson("data/llm_check.json");
  const box = $("llm-table");
  if (!data) { box.innerHTML = "<p class='muted'>Results pending.</p>"; return; }
  const rows = data.models_modes;
  const modes = ["direct", "code", "hand"];
  const byKey = {};
  rows.forEach((r) => { byKey[`${r.model}|${r.mode}`] = r; });
  const models = [...new Set(rows.map((r) => r.model))];
  let html = "<table><tr><th>model</th><th>Direct: scenarios close</th>" +
    "<th>Code: close (code failed)</th><th>Hand sim: customers tracked</th></tr>";
  for (const m of models) {
    const d = byKey[`${m}|direct`] || {}, c = byKey[`${m}|code`] || {}, h = byKey[`${m}|hand`] || {};
    html += `<tr><td>${m}</td><td>${d.close ?? "–"}/${d.n ?? "–"}</td>` +
      `<td>${c.close ?? "–"}/${c.n ?? "–"} (${c.code_failed ?? 0} failed)</td>` +
      `<td>${h.mean_hand_tracked != null ? (100 * h.mean_hand_tracked).toFixed(0) + "%" : "–"}</td></tr>`;
  }
  box.innerHTML = html + "</table>";
  const code = rows.filter((r) => r.mode === "code");
  const direct = rows.filter((r) => r.mode === "direct");
  const hand = rows.filter((r) => r.mode === "hand");
  const avg = (arr, k) => arr.reduce((s, r) => s + (r[k] || 0), 0) / Math.max(1, arr.length);
  $("llm-verdict").textContent =
    `In plain terms: writing code is the reliable route (on average ` +
    `${avg(code, "close").toFixed(1)} of 15 scenarios close, vs ` +
    `${avg(direct, "close").toFixed(1)} for direct estimates), and no mode ` +
    `is good at everything — the hand simulation tracks only about ` +
    `${(100 * avg(hand, "mean_hand_tracked")).toFixed(0)}% of customers ` +
    `exactly. Full numbers: results/summary.md in the repository.`;
}

async function fillChecks() {
  const data = await loadJson("data/check_cases.json");
  const el = $("check-cases");
  if (!data) { el.textContent = "Check cases pending."; return; }
  const items = data.cases.map((c) =>
    `<li>${c.name}: Python ${c.python} — JavaScript ${c.javascript} — ` +
    `<b>${c.agree ? "agree" : "DISAGREE"}</b></li>`).join("");
  el.innerHTML = `The JavaScript on this page and the Python package are
  run on the same fixed inputs by <code>scripts/check_js.py</code>:<ul>${items}</ul>`;
}

/* --- wiring --------------------------------------------------------------- */

const PRESETS = {
  desk: { lam: 30, svc: 5, srv: 4, pat: 31 },
  under: { lam: 30, svc: 5, srv: 3, pat: 31 },
  impatient: { lam: 38, svc: 7.5, srv: 5, pat: 4 },
  rush: { lam: 75, svc: 5, srv: 7, pat: 31 },
};

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  $("in-lam").value = p.lam; $("in-svc").value = p.svc;
  $("in-srv").value = p.srv; $("in-pat").value = p.pat;
  syncOutputs(); newSim(); formulaPanel();
}

async function init() {
  for (const id of ["in-lam", "in-svc", "in-srv", "in-pat"]) {
    $(id).addEventListener("input", () => { syncOutputs(); syncSim(); formulaPanel(); });
  }
  document.querySelectorAll("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => applyPreset(b.dataset.preset)));
  $("btn-reset").addEventListener("click", () => newSim());
  $("in-preset").addEventListener("change", drawChart);
  syncOutputs();
  newSim(20261113);
  formulaPanel();
  requestAnimationFrame(tick);
  chartData = await loadJson("data/curves.json");
  drawChart();
  fillLlm();
  fillChecks();
}

init();
