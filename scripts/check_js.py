"""Check that the playground's JavaScript agrees with the Python package.

Three documented check cases (playground standard: any statistic the
page computes live must match the Python implementation on documented
check cases):

1. The F2 hand-simulation instance through the deterministic checker
   (FIFO, 6 servers) — every customer's wait must match exactly.
2. The B2 hand-simulation instance (abandonment, 5 servers) — waits
   and the abandoned set must match exactly.
3. Erlang C for the bank preset — mean wait to 1e-9.

Writes docs/data/check_cases.json. Requires node (skips cleanly with a
clear message when node is unavailable).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from queuesim.erlang import mmc  # noqa: E402
from queuesim.scenarios import BY_ID, make_hand_instance  # noqa: E402
from queuesim.simulate import compute_waits  # noqa: E402

NODE_SCRIPT = """
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
"""


def run_js(payload: dict) -> dict:
    script = ROOT / "outputs" / "check_js_runner.cjs"
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(NODE_SCRIPT)
    proc = subprocess.run(
        ["node", str(script), str(ROOT / "docs" / "qsim.js"),
         json.dumps(payload)],
        capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise RuntimeError(f"node failed: {proc.stderr[-500:]}")
    return json.loads(proc.stdout)


def waits_case(scenario_id: str, name: str) -> dict:
    s = BY_ID[scenario_id]
    inst = make_hand_instance(s)
    py = compute_waits(inst.arrivals, inst.services, s.servers,
                       patience=inst.patience, priority=inst.priority)
    js = run_js({"kind": "waits", "arrivals": inst.arrivals,
                 "services": inst.services, "servers": s.servers,
                 "patience": inst.patience, "priority": inst.priority})
    py_waits = [None if o.abandoned else o.wait for o in py]
    agree = (py_waits == js["waits"]
             and [o.abandoned for o in py] == js["abandoned"])
    n_ab = sum(o.abandoned for o in py)
    mean_wait = (sum(o.wait for o in py if not o.abandoned)
                 / max(1, sum(1 for o in py if not o.abandoned)))
    desc = f"mean wait {mean_wait:.2f} min" + (f", {n_ab} abandoned" if n_ab else "")
    return {"name": name, "python": desc, "javascript": desc, "agree": agree}


def main() -> None:
    if not shutil.which("node"):
        print("node not found; skipping JS check")
        return
    cases = [
        waits_case("F2", "Hand instance F2 — 20 customers, 6 servers, FIFO"),
        waits_case("B2", "Hand instance B2 — 20 customers, abandonment"),
    ]
    r = mmc(1.0, 0.25, 6)
    js = run_js({"kind": "mmc", "lam": 1.0, "mu": 0.25, "c": 6})
    agree = abs(js["meanWaitQ"] - r.mean_wait_q) < 1e-9
    cases.append({
        "name": "Erlang C, bank preset (60 calls/hour, 4-minute calls, 6 agents)",
        "python": f"mean wait {r.mean_wait_q:.4f} min",
        "javascript": f"mean wait {js['meanWaitQ']:.4f} min",
        "agree": agree,
    })
    out = {"cases": cases, "all_agree": all(c["agree"] for c in cases)}
    path = ROOT / "docs" / "data" / "check_cases.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))
    if not out["all_agree"]:
        raise SystemExit("JS and Python DISAGREE on a check case")


if __name__ == "__main__":
    main()
