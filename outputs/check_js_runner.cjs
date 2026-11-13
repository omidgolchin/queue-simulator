
const q = require(process.argv[2]);
const input = JSON.parse(process.argv[3]);
const out = {};
if (input.kind === "waits") {
  const res = q.computeWaits(input.arrivals, input.services, input.servers,
                             input.patience || null, input.priority || null);
  out.waits = res.map(r => r.abandoned ? null : r.wait);
  out.abandoned = res.map(r => r.abandoned);
} else if (input.kind === "mmc") {
  const r = q.mmc(input.lam, input.mu, input.c);
  out.meanWaitQ = r.meanWaitQ; out.pWait = r.pWait;
}
console.log(JSON.stringify(out));
