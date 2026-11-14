"use strict";
/* qsim.js — the browser twin of the Python queuesim package.
 *
 * - erlangC / mmc / serversNeeded mirror src/queuesim/erlang.py.
 * - computeWaits mirrors the deterministic event checker in
 *   src/queuesim/simulate.py, rule for rule; scripts/check_js.py
 *   verifies the two agree exactly on fixed cases (see
 *   docs/data/check_cases.json).
 * - The animation and the hang-up simulation live in staffing.js.
 */

function erlangB(c, a) {
  let b = 1.0;
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
  return b;
}

function erlangC(c, a) {
  if (a >= c) throw new Error("unstable: a must be < c");
  const rho = a / c;
  const b = erlangB(c, a);
  return b / (1.0 - rho * (1.0 - b));
}

/* lam, mu per minute. Returns steady-state M/M/c results. */
function mmc(lam, mu, c) {
  const a = lam / mu;
  const pw = erlangC(c, a);
  const wq = pw / (c * mu - lam);
  return {
    servers: c, lam, mu, offeredLoad: a, rho: a / c, pWait: pw,
    meanWaitQ: wq, meanTimeSystem: wq + 1 / mu,
    pWaitOver: (t) => pw * Math.exp(-(c * mu - lam) * t),
    serviceLevel: (t) => 1 - pw * Math.exp(-(c * mu - lam) * t),
  };
}

function serversNeeded(lam, mu, targetT, level = 0.80, maxC = 500) {
  let c = Math.floor(lam / mu) + 1;
  while (c <= maxC) {
    if (mmc(lam, mu, c).serviceLevel(targetT) >= level) return c;
    c++;
  }
  throw new Error("no server count reaches the target");
}

/* Deterministic event-by-event checker. patience/priority are arrays
 * or null. Mirrors compute_waits in the Python package, including the
 * tie rules (a server freeing exactly at a patience deadline serves
 * the customer). Returns [{wait, start, end, abandoned}] with wait
 * null for abandoned customers. */
function computeWaits(arrivals, services, servers, patience = null, priority = null) {
  const n = arrivals.length;
  const prio = priority || new Array(n).fill(0);
  const outcomes = new Array(n).fill(null);
  const state = new Array(n).fill("");
  const waiting = [];
  let free = servers;
  // events: [time, kind, seq, index]; kind 0 = server frees, 1 = deadline, 2 = arrival
  const events = [];
  let seq = 0;
  const push = (e) => { events.push(e); };
  for (let i = 0; i < n; i++) {
    push([arrivals[i], 2, seq++, i]);
    if (patience) push([arrivals[i] + patience[i], 1, seq++, i]);
  }
  const cmp = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
  events.sort(cmp);
  function tryAssign(now) {
    while (free > 0 && waiting.length > 0) {
      let bestPos = 0;
      for (let j = 1; j < waiting.length; j++) {
        const cand = waiting[j], best = waiting[bestPos];
        if (prio[cand] < prio[best] ||
            (prio[cand] === prio[best] &&
             (arrivals[cand] < arrivals[best] ||
              (arrivals[cand] === arrivals[best] && cand < best)))) {
          bestPos = j;
        }
      }
      const idx = waiting[bestPos];
      const deadline = patience ? arrivals[idx] + patience[idx] : Infinity;
      waiting.splice(bestPos, 1);
      if (now > deadline) {
        state[idx] = "abandoned";
        outcomes[idx] = { wait: null, start: null, end: null, abandoned: true };
        continue;
      }
      state[idx] = "serving";
      free--;
      const start = now, end = now + services[idx];
      outcomes[idx] = { wait: start - arrivals[idx], start, end, abandoned: false };
      // insert departure event keeping sort order
      const ev = [end, 0, seq++, idx];
      let lo = 0, hi = events.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(events[mid], ev) < 0) lo = mid + 1; else hi = mid; }
      events.splice(lo, 0, ev);
    }
  }
  while (events.length > 0) {
    const [t, kind, , i] = events.shift();
    if (kind === 2) { state[i] = "waiting"; waiting.push(i); tryAssign(t); }
    else if (kind === 0) { state[i] = "done"; free++; tryAssign(t); }
    else if (state[i] === "waiting") {
      waiting.splice(waiting.indexOf(i), 1);
      state[i] = "abandoned";
      outcomes[i] = { wait: null, start: null, end: null, abandoned: true };
    }
  }
  return outcomes;
}

/* Seeded RNG (mulberry32) so animation runs are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { erlangB, erlangC, mmc, serversNeeded, computeWaits, mulberry32 };
}
