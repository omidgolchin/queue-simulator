/* Staffing engine for the Call Center Staffing Planner.
 * Mirrors src/queuesim/staffing.py (checked by tests/test_staffing.py).
 *
 *  - Erlang C (from qsim.js) for the no-hang-up case and the day plan.
 *  - A seeded Monte Carlo of the M/M/c+M queue (callers hang up after an
 *    exponential patience) for the case Erlang C cannot handle.
 *  - The staffing search: the fewest agents that meet the service target
 *    without pushing occupancy above the cap.
 */
(function (g) {
  "use strict";
  var Q = g.erlangC ? g : (typeof require !== "undefined" ? require("./qsim.js") : null);

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Erlang C metrics for c agents. lam per minute, aht minutes, T minutes. */
  function erlangMetrics(lam, aht, c, T) {
    var mu = 1 / aht, a = lam * aht;
    if (c <= a) return { c: c, stable: false, sl: 0, asa: Infinity, occ: 1, pWait: 1 };
    var r = Q.mmc(lam, mu, c);
    return { c: c, stable: true, sl: r.serviceLevel(T), asa: r.meanWaitQ, occ: a / c, pWait: r.pWait };
  }

  /* Smallest c meeting the service level, then raised until occupancy <= cap. */
  function staffErlang(lam, aht, T, level, occCap) {
    var a = lam * aht, c = Math.max(1, Math.floor(a) + 1), m;
    while (c < 5000) { m = erlangMetrics(lam, aht, c, T); if (m.sl >= level) break; c++; }
    var cService = c;
    while (a / c > occCap) c++;
    var out = erlangMetrics(lam, aht, c, T);
    out.cService = cService; out.binding = c > cService ? "occupancy" : "service";
    return out;
  }

  /* M/M/c+M queue as a continuous-time Markov chain, customers tracked FIFO.
   * Exponential service and patience are memoryless, so the next event is
   * drawn from the total rate; an abandoning caller is a uniformly random
   * waiting caller. Statistics after a warm-up. Returns per-replication
   * results and means with 95% t-intervals. */
  var T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042, 2.040, 2.037, 2.035, 2.032, 2.030, 2.028, 2.026, 2.024, 2.023, 2.021];
  function simulate(lam, aht, c, patience, opts) {
    opts = opts || {};
    var reps = opts.reps || 20, dur = opts.minutes || 480, warm = opts.warmup || 60, T = opts.T || 20 / 60, seed0 = opts.seed || 1;
    var mu = 1 / aht, theta = patience ? 1 / patience : 0;
    var res = [];
    for (var r = 0; r < reps; r++) {
      var rng = mulberry32(seed0 + 7919 * r);
      var t = 0, busy = 0, queue = [], qHead = 0;
      var offered = 0, answered = 0, within = 0, abandoned = 0, waitSum = 0, busyArea = 0, end = warm + dur;
      while (true) {
        var qLen = queue.length - qHead;
        var rate = lam + busy * mu + qLen * theta;
        var dt = -Math.log(1 - rng()) / rate;
        if (t + dt > end) { busyArea += busy * (end - Math.max(t, warm)); break; }
        var t0 = t; t += dt;
        if (t > warm) busyArea += busy * (t - Math.max(t0, warm));
        var u = rng() * rate;
        if (u < lam) { // arrival
          var counted = t >= warm;
          if (counted) offered++;
          if (busy < c && qLen === 0) { busy++; if (counted) { answered++; within++; } }
          else queue.push({ at: t, counted: counted });
        } else if (u < lam + busy * mu) { // service completion
          if (qLen > 0) {
            var cust = queue[qHead++], w = t - cust.at;
            if (cust.counted) { answered++; waitSum += w; if (w <= T) within++; }
          } else busy--;
        } else { // abandonment of a random waiting caller
          var k = qHead + Math.floor(rng() * qLen);
          if (queue[k].counted) abandoned++;
          queue[k] = queue[qHead]; qHead++;
        }
        if (qHead > 4096 && qHead * 2 > queue.length) { queue = queue.slice(qHead); qHead = 0; }
      }
      res.push({
        slOffered: offered ? within / offered : NaN,
        pctOverAnswered: answered ? 1 - within / answered : NaN,
        asa: answered ? waitSum / answered : NaN,
        abandon: offered ? abandoned / offered : 0,
        occ: busyArea / (c * dur)
      });
    }
    function summ(key) {
      var v = res.map(function (x) { return x[key]; }).filter(function (x) { return isFinite(x); });
      var n = v.length, m = v.reduce(function (a, b) { return a + b; }, 0) / n;
      var sd = Math.sqrt(v.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / Math.max(1, n - 1));
      return { mean: m, half: n > 1 ? T975[Math.min(n - 2, T975.length - 1)] * sd / Math.sqrt(n) : NaN };
    }
    return { reps: res, sl: summ("slOffered"), pctOver: summ("pctOverAnswered"), asa: summ("asa"), abandon: summ("abandon"), occ: summ("occ") };
  }

  /* Staffing by simulation when callers hang up. Searches upward from a
   * low start; common random numbers (same seeds) across agent counts. */
  function staffSim(lam, aht, T, level, occCap, patience, opts) {
    var a = lam * aht, e = staffErlang(lam, aht, T, level, occCap);
    var c = Math.max(1, Math.min(e.c, Math.floor(a * 0.7))), s;
    var cService = null;
    while (c < e.c + 50) {
      s = simulate(lam, aht, c, patience, Object.assign({ T: T }, opts));
      if (cService === null && s.sl.mean >= level) cService = c;
      if (cService !== null && s.occ.mean <= occCap) break;
      c++;
    }
    return { c: c, cService: cService, binding: c > cService ? "occupancy" : "service", sim: s, erlangC: e.c };
  }

  /* The live queue behind the animation: the same M/M/c+M chain as
   * simulate(), stepped in real time, with each agent tracked for display. */
  function makeLive(lam, aht, c, patience, T, seed) {
    var rng = mulberry32(seed || 7), mu = 1 / aht, theta = patience ? 1 / patience : 0;
    var L = { now: 0, agents: [], queue: [], answered: 0, within: 0, abandoned: 0, busyArea: 0, c: c };
    for (var i = 0; i < c; i++) L.agents.push(false);
    function busyIdx() { var o = []; for (var i = 0; i < c; i++) if (L.agents[i]) o.push(i); return o; }
    function freeIdx() { var o = []; for (var i = 0; i < c; i++) if (!L.agents[i]) o.push(i); return o; }
    L.step = function (dt) {
      var end = L.now + dt;
      while (true) {
        var b = busyIdx(), rate = lam + b.length * mu + L.queue.length * theta;
        var t = L.now - Math.log(1 - rng()) / rate;
        if (t > end) { L.busyArea += b.length * (end - L.now); L.now = end; return; }
        L.busyArea += b.length * (t - L.now); L.now = t;
        var u = rng() * rate;
        if (u < lam) {
          var f = freeIdx();
          if (f.length && !L.queue.length) { L.agents[f[Math.floor(rng() * f.length)]] = true; L.answered++; L.within++; }
          else L.queue.push(t);
        } else if (u < lam + b.length * mu) {
          var k = b[Math.floor(rng() * b.length)];
          if (L.queue.length) { var w = t - L.queue.shift(); L.answered++; if (w <= T) L.within++; }
          else L.agents[k] = false;
        } else { L.queue.splice(Math.floor(rng() * L.queue.length), 1); L.abandoned++; }
      }
    };
    L.resetCounters = function () { L.answered = 0; L.within = 0; L.abandoned = 0; L.busyArea = 0; L.t0 = L.now; };
    return L;
  }

  function scheduled(c, shrink) { return Math.ceil(c / (1 - shrink) - 1e-9); }

  /* Day plan with Erlang C per interval. calls: calls per interval. */
  function dayPlan(calls, intervalMin, aht, T, level, occCap, shrink, minAgents) {
    var rows = calls.map(function (n, i) {
      var lam = n / intervalMin;
      if (n <= 0) return { i: i, calls: 0, c: minAgents, sched: scheduled(minAgents, shrink), sl: 1, asa: 0, occ: 0 };
      var e = staffErlang(lam, aht, T, level, occCap);
      var c = Math.max(minAgents, e.c), m = erlangMetrics(lam, aht, c, T);
      return { i: i, calls: n, c: c, sched: scheduled(c, shrink), sl: m.sl, asa: m.asa, occ: m.occ, binding: c > e.c ? "minimum" : e.binding };
    });
    var hours = intervalMin / 60;
    var agentHours = rows.reduce(function (a, r) { return a + r.c * hours; }, 0);
    var paidHours = rows.reduce(function (a, r) { return a + r.sched * hours; }, 0);
    var totalCalls = rows.reduce(function (a, r) { return a + r.calls; }, 0);
    var answeredWithin = rows.reduce(function (a, r) { return a + r.calls * r.sl; }, 0);
    var peak = rows.reduce(function (a, r) { return r.c > a.c ? r : a; }, rows[0]);
    return { rows: rows, agentHours: agentHours, paidHours: paidHours, totalCalls: totalCalls, daySL: totalCalls ? answeredWithin / totalCalls : 1, peak: peak };
  }

  var api = { erlangMetrics: erlangMetrics, staffErlang: staffErlang, simulate: simulate, staffSim: staffSim, scheduled: scheduled, dayPlan: dayPlan, makeLive: makeLive, mulberry32: mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  g.Staffing = api;
})(typeof window !== "undefined" ? window : globalThis);
