"""The simulation studies: validation against Erlang C, the
beyond-the-formula cases, the arrival-data study, LLM-check ground
truth, and the playground's precomputed curves.

Each section is computed once and cached in outputs/studies.json; a
re-run skips finished sections (the environment restarts occasionally,
and the 200-replication ground truths are the expensive part).
Replications run two at a time in worker processes.

Usage: python -m queuesim.validate [--sections validation beyond ...]
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from . import erlang
from .simulate import QueueConfig, _mean_ci, run_replication

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "outputs" / "studies.json"
TARGET_MIN = 20.0 / 60.0


def run_reps_parallel(cfg: QueueConfig, n_reps: int, seed0: int) -> dict:
    with ProcessPoolExecutor(max_workers=2) as ex:
        reps = list(ex.map(run_replication, [cfg] * n_reps,
                           range(seed0, seed0 + n_reps)))
    keys = ["mean_wait_q", "pct_over_target", "utilisation", "abandon_rate",
            "mean_number_system", "little_ratio",
            "mean_wait_q_priority", "mean_wait_q_regular"]
    summary: dict[str, dict] = {}
    for k in keys:
        vals = [r[k] for r in reps if k in r and not math.isnan(r[k])]
        if vals:
            mean, half = _mean_ci(vals)
            summary[k] = {"mean": mean, "ci_half": float(half), "n": len(vals)}
    return {"summary": summary, "reps": reps}


def _strip_reps(block: dict) -> dict:
    """Drop per-replication series before saving (keep the file small)."""
    block = dict(block)
    reps = []
    for r in block.get("reps", []):
        r = dict(r)
        r.pop("mean_queue_len_series", None)
        reps.append(r)
    block["reps"] = reps
    return block


# ---------------------------------------------------------------------------
# 1. Validation: 12 M/M/c settings against Erlang C
# ---------------------------------------------------------------------------

VALIDATION_SETTINGS = [
    # (servers, rho)
    (1, 0.50), (1, 0.80), (1, 0.95),
    (2, 0.60), (2, 0.90),
    (3, 0.70),
    (4, 0.85),
    (5, 0.50), (5, 0.95),
    (7, 0.80),
    (10, 0.60), (10, 0.90),
]


def section_validation() -> dict:
    rows = []
    for idx, (c, rho) in enumerate(VALIDATION_SETTINGS):
        mu = 1.0                       # one service per minute
        lam = rho * c * mu
        duration = min(30000.0, max(4000.0, 12000.0 / lam))
        cfg = QueueConfig(servers=c, service_mean=1.0, arrival_rate=lam,
                          warmup=duration / 8.0, duration=duration)
        res = run_reps_parallel(cfg, 16, seed0=1000 + 100 * idx)
        f = erlang.mmc(lam, mu, c)
        sim_wq = res["summary"]["mean_wait_q"]
        rows.append({
            "servers": c, "rho": rho, "lambda_per_min": lam,
            "erlang_wait_min": f.mean_wait_q,
            "sim_wait_min": sim_wq["mean"], "sim_wait_ci_half": sim_wq["ci_half"],
            "rel_err_pct": 100.0 * (sim_wq["mean"] - f.mean_wait_q) / f.mean_wait_q,
            "erlang_in_ci": abs(sim_wq["mean"] - f.mean_wait_q) <= sim_wq["ci_half"],
            "erlang_pct_over_20s": 100.0 * f.p_wait_over(TARGET_MIN),
            "sim_pct_over_20s": 100.0 * res["summary"]["pct_over_target"]["mean"],
            "little_ratio": res["summary"]["little_ratio"]["mean"],
            "utilisation": res["summary"]["utilisation"]["mean"],
        })
        print(f"validation c={c} rho={rho}: sim {sim_wq['mean']:.3f} "
              f"vs erlang {f.mean_wait_q:.3f}", flush=True)
    return {"settings": rows}


# ---------------------------------------------------------------------------
# 2. Beyond the formulas
# ---------------------------------------------------------------------------

def section_beyond() -> dict:
    out: dict = {}

    # (a) Service-time variability, same means: exp vs uniform vs lognormal.
    base = dict(servers=4, service_mean=5.0, arrival_rate=30 / 60,
                warmup=600, duration=6600)
    f = erlang.mmc(30 / 60, 1 / 5.0, 4)
    cases = {}
    for name, kw in [("exponential", {}),
                     ("uniform_cv0.5", {"service_dist": "uniform", "service_cv": 0.5}),
                     ("lognormal_cv2", {"service_dist": "lognormal", "service_cv": 2.0})]:
        res = run_reps_parallel(QueueConfig(**base, **kw), 40, seed0=5000)
        cases[name] = {
            "sim_wait_min": res["summary"]["mean_wait_q"]["mean"],
            "sim_wait_ci_half": res["summary"]["mean_wait_q"]["ci_half"],
            "sim_pct_over_20s": 100.0 * res["summary"]["pct_over_target"]["mean"],
        }
    out["variability"] = {"erlang_wait_min": f.mean_wait_q,
                          "erlang_pct_over_20s": 100.0 * f.p_wait_over(TARGET_MIN),
                          "cases": cases}

    # (b) Abandonment at rho = 0.95: no patience vs mean patience 10 vs 4.
    base_b = dict(servers=5, service_mean=7.5, arrival_rate=38 / 60,
                  warmup=600, duration=6600)
    fb = erlang.mmc(38 / 60, 1 / 7.5, 5)
    cases_b = {}
    for name, patience in [("no_abandonment", None), ("patience_10", 10.0),
                           ("patience_4", 4.0)]:
        res = run_reps_parallel(QueueConfig(**base_b, patience_mean=patience),
                                40, seed0=6000)
        cases_b[name] = {
            "sim_wait_min": res["summary"]["mean_wait_q"]["mean"],
            "sim_pct_over_20s": 100.0 * res["summary"]["pct_over_target"]["mean"],
            "abandon_pct": 100.0 * res["summary"]["abandon_rate"]["mean"],
        }
    out["abandonment"] = {"erlang_wait_min_no_abandonment": fb.mean_wait_q,
                          "erlang_pct_over_20s": 100.0 * fb.p_wait_over(TARGET_MIN),
                          "cases": cases_b}

    # (c) A day shaped like the NYC 311 profile vs the same day flattened.
    profile = json.loads((ROOT / "data" / "nyc311_profile_scaled.json").read_text())
    rates_min = profile["hourly_rates_per_min"]
    c_day = profile["staffing_at_mean_rate"]["servers_for_80_in_20s"]
    cfg_var = QueueConfig(servers=c_day, service_mean=5.0, hourly_rates=rates_min,
                          warmup=0, duration=1440)
    res_var = run_reps_parallel(cfg_var, 30, seed0=7000)
    cfg_flat = QueueConfig(servers=c_day, service_mean=5.0, arrival_rate=1.0,
                           warmup=120, duration=1440)
    res_flat = run_reps_parallel(cfg_flat, 30, seed0=8000)
    fmean = erlang.mmc(1.0, 1 / 5.0, c_day)
    out["time_varying"] = {
        "servers": c_day,
        "formula_at_mean_rate": {
            "wait_min": fmean.mean_wait_q,
            "pct_over_20s": 100.0 * fmean.p_wait_over(TARGET_MIN),
        },
        "flat_day_sim": {
            "wait_min": res_flat["summary"]["mean_wait_q"]["mean"],
            "pct_over_20s": 100.0 * res_flat["summary"]["pct_over_target"]["mean"],
        },
        "profile_day_sim": {
            "wait_min": res_var["summary"]["mean_wait_q"]["mean"],
            "pct_over_20s": 100.0 * res_var["summary"]["pct_over_target"]["mean"],
        },
    }
    return out


# ---------------------------------------------------------------------------
# 3. Arrival-data study: NYC 311, January 2024
# ---------------------------------------------------------------------------

def section_arrivals() -> dict:
    raw = json.loads((ROOT / "data" / "nyc311_hourly_raw_jan2024.json").read_text())
    counts = {int(r["hour"]): int(r["n"]) for r in raw}
    days = 31
    mean_per_hour = {h: counts[h] / days for h in range(24)}
    total_per_day = sum(counts.values()) / days
    mean_rate_h = total_per_day / 24.0
    peak_h = max(mean_per_hour, key=mean_per_hour.get)
    trough_h = min(mean_per_hour, key=mean_per_hour.get)
    # Scale the shape to a call centre averaging 60 calls/hour, 5-min calls.
    scale = 60.0 / mean_rate_h
    rates_h = [mean_per_hour[h] * scale for h in range(24)]
    staffing = []
    for h in range(24):
        lam_m = rates_h[h] / 60.0
        mu_m = 1 / 5.0
        c_need = erlang.servers_needed(lam_m, mu_m, TARGET_MIN, 0.80)
        staffing.append({"hour": h, "calls_per_hour": rates_h[h],
                         "servers_for_80_in_20s": c_need})
    c_mean = erlang.servers_needed(1.0, 1 / 5.0, TARGET_MIN, 0.80)
    profile_doc = {
        "source": "NYC 311 service requests, January 2024 (NYC Open Data)",
        "shape_note": ("Only the shape of the day is used: hourly counts "
                       "scaled to a call centre averaging 60 calls/hour."),
        "hourly_rates_per_min": [r / 60.0 for r in rates_h],
        "staffing_at_mean_rate": {"servers_for_80_in_20s": c_mean},
    }
    (ROOT / "data" / "nyc311_profile_scaled.json").write_text(
        json.dumps(profile_doc, indent=1))
    return {
        "days": days,
        "requests_per_day": total_per_day,
        "mean_requests_per_hour": mean_rate_h,
        "peak_hour": peak_h, "peak_mean_per_hour": mean_per_hour[peak_h],
        "trough_hour": trough_h, "trough_mean_per_hour": mean_per_hour[trough_h],
        "peak_to_trough_ratio": mean_per_hour[peak_h] / mean_per_hour[trough_h],
        "scaled_staffing_by_hour": staffing,
        "servers_at_mean_rate": c_mean,
        "min_staff": min(s["servers_for_80_in_20s"] for s in staffing),
        "max_staff": max(s["servers_for_80_in_20s"] for s in staffing),
    }


# ---------------------------------------------------------------------------
# 4. LLM-check ground truth (formula instantly; beyond by 200 replications)
# ---------------------------------------------------------------------------

def section_truth() -> dict:
    from .scenarios import SCENARIOS, formula_truth

    out: dict = {}
    for s in SCENARIOS:
        if s.kind in ("formula", "trap"):
            out[s.id] = formula_truth(s)
            continue
        res = run_reps_parallel(s.sim_config, 200, seed0=777000)
        sm = res["summary"]
        row: dict = {"n_reps": 200}
        if s.id == "B4":
            row["STEADY_STATE"] = "no"
            row["MEAN_WAIT_MIN"] = sm["mean_wait_q"]["mean"]
            row["PCT_OVER_20S"] = 100.0 * sm["pct_over_target"]["mean"]
            row["note"] = ("Unstable: offered load 5 erlangs on 4 servers. "
                           "The day-average wait is a finite-horizon number "
                           "that grows with the horizon; there is no "
                           "steady-state average wait.")
        elif s.id == "B5":
            row["PRIORITY_MEAN_WAIT_MIN"] = sm["mean_wait_q_priority"]["mean"]
            row["REGULAR_MEAN_WAIT_MIN"] = sm["mean_wait_q_regular"]["mean"]
        else:
            row["MEAN_WAIT_MIN"] = sm["mean_wait_q"]["mean"]
            row["MEAN_WAIT_MIN_CI"] = sm["mean_wait_q"]["ci_half"]
            row["PCT_OVER_20S"] = 100.0 * sm["pct_over_target"]["mean"]
            if s.id == "B2":
                row["ABANDON_PCT"] = 100.0 * sm["abandon_rate"]["mean"]
        out[s.id] = row
        print(f"truth {s.id} done", flush=True)
    return out


# ---------------------------------------------------------------------------
# 5. Playground curves: wait vs servers for three presets (Python results)
# ---------------------------------------------------------------------------

PLAYGROUND_PRESETS = [
    {"id": "desk", "label": "Support desk", "lam_h": 30.0, "service_min": 5.0},
    {"id": "bank", "label": "Bank call centre", "lam_h": 60.0, "service_min": 4.0},
    {"id": "busy", "label": "Busy help line", "lam_h": 120.0, "service_min": 3.0},
]


def section_playground() -> dict:
    out: dict = {}
    for preset in PLAYGROUND_PRESETS:
        lam_m = preset["lam_h"] / 60.0
        mu_m = 1.0 / preset["service_min"]
        a = lam_m / mu_m
        c_min = int(math.floor(a)) + 1
        points = []
        for c in range(c_min, c_min + 8):
            duration = 4000.0 / lam_m
            cfg = QueueConfig(servers=c, service_mean=preset["service_min"],
                              arrival_rate=lam_m, warmup=duration / 8.0,
                              duration=duration)
            res = run_reps_parallel(cfg, 20, seed0=20000 + c)
            f = erlang.mmc(lam_m, mu_m, c)
            points.append({
                "servers": c,
                "sim_wait_min": res["summary"]["mean_wait_q"]["mean"],
                "sim_wait_ci_half": res["summary"]["mean_wait_q"]["ci_half"],
                "sim_pct_over_20s": 100.0 * res["summary"]["pct_over_target"]["mean"],
                "formula_wait_min": f.mean_wait_q,
                "formula_pct_over_20s": 100.0 * f.p_wait_over(TARGET_MIN),
            })
        out[preset["id"]] = {
            "label": preset["label"], "lam_h": preset["lam_h"],
            "service_min": preset["service_min"],
            "staffing_80_20": erlang.servers_needed(lam_m, mu_m, TARGET_MIN, 0.80),
            "points": points,
        }
        print(f"playground preset {preset['id']} done", flush=True)
    return out


SECTIONS = {
    "arrivals": section_arrivals,       # first: beyond + playground use its file
    "validation": section_validation,
    "beyond": section_beyond,
    "truth": section_truth,
    "playground": section_playground,
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sections", nargs="+", default=list(SECTIONS))
    args = ap.parse_args()
    studies: dict = {}
    if OUT.exists():
        studies = json.loads(OUT.read_text())
    for name in args.sections:
        if name in studies:
            print(f"skip {name} (cached)", flush=True)
            continue
        print(f"running section {name} ...", flush=True)
        studies[name] = SECTIONS[name]()
        OUT.write_text(json.dumps(studies, indent=1))
        print(f"saved section {name}", flush=True)
    print("done")


if __name__ == "__main__":
    main()
