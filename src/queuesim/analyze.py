"""Regenerate results/summary.md, results/figures/ and docs/data/
from saved outputs (outputs/studies.json, outputs/llm_runs.jsonl,
outputs/model_prices.json). No API calls, no new simulation except the
deterministic hand-instance checker (instant).

Usage: python -m queuesim.analyze   (or: make reproduce)
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from . import score as score_mod  # noqa: E402
from .scenarios import BY_ID, SCENARIOS, make_hand_instance  # noqa: E402
from .simulate import compute_waits  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "outputs"
RESULTS = ROOT / "results"
FIGS = RESULTS / "figures"
DOCS_DATA = ROOT / "docs" / "data"


def _load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def _fmt(x, digits=2):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "–"
    return f"{x:.{digits}f}"


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_runs(rows: list[dict], truth: dict) -> list[dict]:
    scored = []
    for row in rows:
        if row.get("status") != "ok":
            scored.append({**row, "verdict": "api_error"})
            continue
        s = BY_ID[row["scenario_id"]]
        t = truth[row["scenario_id"]]
        entry = {k: row.get(k) for k in
                 ("run_id", "model_requested", "scenario_id", "mode",
                  "prompt_tokens", "completion_tokens", "latency_s")}
        if row["mode"] == "hand":
            inst = make_hand_instance(s)
            outcomes = compute_waits(inst.arrivals, inst.services, s.servers,
                                     patience=inst.patience,
                                     priority=inst.priority)
            parsed = score_mod.parse_hand(row["text"], len(inst.arrivals))
            entry["hand"] = score_mod.score_hand(s, parsed, outcomes)
            entry["verdict"] = "scored"
        else:
            if row["mode"] == "code":
                if not row.get("code_ok"):
                    entry["verdict"] = "code_failed"
                    entry["numeric"] = None
                    scored.append(entry)
                    continue
                text = row.get("code_stdout", "")
            else:
                text = row["text"]
            keys = [q.key for q in s.questions]
            parsed = score_mod.parse_lines(text, keys)
            entry["numeric"] = score_mod.score_numeric(s, parsed, t)
            entry["verdict"] = "scored"
        scored.append(entry)
    return scored


def _is_wait_key(key: str) -> bool:
    """Wait questions (as opposed to percentages or STEADY_STATE)."""
    return key != "STEADY_STATE" and key != "PCT_OVER_20S" \
        and not key.endswith("_PCT")


def aggregate(scored: list[dict]) -> dict:
    """Per (model, mode) aggregates over scenarios."""
    agg: dict[tuple[str, str], dict] = {}
    for e in scored:
        key = (e["model_requested"], e["mode"])
        a = agg.setdefault(key, {"n": 0, "close": 0, "code_failed": 0,
                                 "api_error": 0, "wait_rel_errs": [],
                                 "pct_abs_errs": [], "hand_tracked": [],
                                 "hand_mae": [], "wait_asked": 0,
                                 "hand_counted": 0, "hand_asked": 0})
        a["n"] += 1
        if e.get("verdict") == "code_failed":
            a["code_failed"] += 1
            continue
        if e.get("verdict") == "api_error":
            a["api_error"] += 1
            continue
        if e["mode"] == "hand":
            a["hand_tracked"].append(e["hand"]["tracked_share"])
            if not math.isnan(e["hand"]["mae_min"]):
                a["hand_mae"].append(e["hand"]["mae_min"])
            # The MAE rests only on the customers whose waits entered
            # it; count that basis so a thin one cannot read as perfect.
            a["hand_counted"] += e["hand"]["n_errs"]
            a["hand_asked"] += e["hand"]["n_scorable"]
        else:
            num = e["numeric"]
            if num["all_close"]:
                a["close"] += 1
            a["wait_asked"] += sum(
                1 for q in BY_ID[e["scenario_id"]].questions
                if _is_wait_key(q.key))
            for k, pq in num["per_question"].items():
                if "rel_err" in pq:
                    a["wait_rel_errs"].append(pq["rel_err"])
                if "abs_err_points" in pq:
                    a["pct_abs_errs"].append(pq["abs_err_points"])
    for a in agg.values():
        a["wait_counted"] = len(a["wait_rel_errs"])
        a["mean_wait_rel_err"] = (sum(a["wait_rel_errs"]) / len(a["wait_rel_errs"])
                                  if a["wait_rel_errs"] else None)
        a["mean_pct_abs_err"] = (sum(a["pct_abs_errs"]) / len(a["pct_abs_errs"])
                                 if a["pct_abs_errs"] else None)
        a["mean_hand_tracked"] = (sum(a["hand_tracked"]) / len(a["hand_tracked"])
                                  if a["hand_tracked"] else None)
        a["mean_hand_mae"] = (sum(a["hand_mae"]) / len(a["hand_mae"])
                              if a["hand_mae"] else None)
    return agg


def spend(rows_by_file: dict[str, list[dict]], prices: dict) -> dict:
    out = {}
    total = 0.0
    for name, rows in rows_by_file.items():
        cost = 0.0
        calls = 0
        per_model: dict[str, float] = {}
        for r in rows:
            if r.get("status") != "ok":
                continue
            p = prices.get(r["model_requested"], {})
            pin, pout = p.get("input_per_1m"), p.get("output_per_1m")
            if pin is None or pout is None:
                continue
            c = ((r.get("prompt_tokens") or 0) * pin
                 + (r.get("completion_tokens") or 0) * pout) / 1e6
            cost += c
            calls += 1
            per_model[r["model_requested"]] = per_model.get(r["model_requested"], 0.0) + c
        out[name] = {"cost": cost, "calls": calls, "per_model": per_model}
        total += cost
    out["total"] = total
    return out


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------

def figures(studies: dict, agg: dict) -> list[str]:
    FIGS.mkdir(parents=True, exist_ok=True)
    made = []

    # Validation: simulated vs formula waits across the 12 settings.
    rows = studies["validation"]["settings"]
    fig, ax = plt.subplots(figsize=(7, 4))
    x = range(len(rows))
    ax.errorbar([i - 0.15 for i in x], [r["sim_wait_min"] for r in rows],
                yerr=[r["sim_wait_ci_half"] for r in rows], fmt="o",
                label="SimPy (mean ± 95% CI)", capsize=3)
    ax.plot([i + 0.15 for i in x], [r["erlang_wait_min"] for r in rows], "s",
            label="Erlang C")
    ax.set_xticks(list(x))
    ax.set_xticklabels([f"c={r['servers']}\nρ={r['rho']}" for r in rows],
                       fontsize=7)
    ax.set_ylabel("average wait (min)")
    ax.set_title("Validation: simulated vs Erlang C average waits, 12 settings")
    ax.legend()
    fig.tight_layout()
    fig.savefig(FIGS / "validation.png", dpi=150)
    plt.close(fig)
    made.append("validation.png")

    # Key figure: wait vs servers, bank preset, sim vs formula.
    bank = studies["playground"]["bank"]
    pts = bank["points"]
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.errorbar([p["servers"] for p in pts], [p["sim_wait_min"] for p in pts],
                yerr=[p["sim_wait_ci_half"] for p in pts], fmt="o-",
                label="SimPy simulation", capsize=3)
    ax.plot([p["servers"] for p in pts], [p["formula_wait_min"] for p in pts],
            "s--", label="Erlang C formula")
    ax.set_xlabel("number of agents")
    ax.set_ylabel("average wait (min)")
    ax.set_title("Average wait vs agents — bank preset "
                 "(60 calls/hour, 4-minute calls)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(FIGS / "wait_vs_servers.png", dpi=150)
    plt.close(fig)
    made.append("wait_vs_servers.png")

    # Beyond: service variability.
    var = studies["beyond"]["variability"]
    names = ["Erlang C\n(exponential)", "Sim: exponential", "Sim: uniform\n(CV 0.5)",
             "Sim: lognormal\n(CV 2)"]
    vals = [var["erlang_wait_min"], var["cases"]["exponential"]["sim_wait_min"],
            var["cases"]["uniform_cv0.5"]["sim_wait_min"],
            var["cases"]["lognormal_cv2"]["sim_wait_min"]]
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.bar(names, vals)
    ax.set_ylabel("average wait (min)")
    ax.set_title("Same averages, different service-time variability "
                 "(30 calls/hour, 5-minute calls, 4 agents)")
    fig.tight_layout()
    fig.savefig(FIGS / "variability.png", dpi=150)
    plt.close(fig)
    made.append("variability.png")

    # Arrivals: staffing by hour.
    arr = studies["arrivals"]
    staff = arr["scaled_staffing_by_hour"]
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.bar([s["hour"] for s in staff],
           [s["servers_for_80_in_20s"] for s in staff])
    ax.axhline(arr["servers_at_mean_rate"], color="red", linestyle="--",
               label="staffing for the average hour")
    ax.set_xlabel("hour of day")
    ax.set_ylabel("agents needed for 80% within 20 s")
    ax.set_title("Staffing follows the day's shape (NYC 311 profile, "
                 "60 calls/hour average, 5-minute calls)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(FIGS / "staffing_by_hour.png", dpi=150)
    plt.close(fig)
    made.append("staffing_by_hour.png")

    # LLM check: mean relative error of mean-wait answers by model and mode.
    models = sorted({m for (m, _) in agg})
    modes = ["direct", "code"]
    if models and any(agg.get((m, "direct")) for m in models):
        fig, ax = plt.subplots(figsize=(7, 4))
        w = 0.38
        for i, mode in enumerate(modes):
            vals = []
            for m in models:
                a = agg.get((m, mode), {})
                v = a.get("mean_wait_rel_err")
                vals.append(100 * v if v is not None else 0)
            ax.bar([j + (i - 0.5) * w for j in range(len(models))], vals,
                   width=w, label=mode)
        ax.axhline(25, color="red", linestyle="--",
                   label='"close" threshold (25%)')
        ax.set_xticks(range(len(models)))
        ax.set_xticklabels([m.split("/")[-1] for m in models], fontsize=7,
                           rotation=20, ha="right")
        ax.set_ylabel("mean relative error of wait estimates (%)")
        ax.set_title("LLM check: how far off the wait estimates are, by mode")
        ax.legend()
        fig.tight_layout()
        fig.savefig(FIGS / "llm_check_errors.png", dpi=150)
        plt.close(fig)
        made.append("llm_check_errors.png")
    return made


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def write_summary(studies: dict, scored: list[dict], agg: dict,
                  spend_info: dict, figs: list[str]) -> None:
    L: list[str] = []
    add = L.append
    add("# Results — queue-simulator (P11)\n")
    add("All numbers below are regenerated by `python -m queuesim.analyze` "
        "from the saved outputs in `outputs/`. The plan is in `PLAN.md`; "
        "choices and deviations are in `DECISIONS.md`.\n")

    # --- Validation
    rows = studies["validation"]["settings"]
    n_in = sum(1 for r in rows if r["erlang_in_ci"])
    worst = max(rows, key=lambda r: abs(r["rel_err_pct"]))
    little_devs = [abs(r["little_ratio"] - 1) for r in rows]
    add("## 1. Validation against Erlang C\n")
    add(f"12 M/M/c settings (c from 1 to 10, utilisation 0.5–0.95), 16 "
        f"independent replications each. The Erlang C value falls inside "
        f"the simulation's 95% confidence interval in {n_in} of 12 "
        f"settings; the largest relative difference is "
        f"{worst['rel_err_pct']:+.1f}% (c={worst['servers']}, "
        f"ρ={worst['rho']}). Little's law, measured from each run's own "
        f"counters, deviates from L = λW by at most "
        f"{100 * max(little_devs):.2f}% across the 12 settings.\n")
    add("| servers | ρ | Erlang C wait (min) | simulated wait (min) | ±95% CI | rel. diff | P(wait>20 s): formula | simulated |")
    add("|---|---|---|---|---|---|---|---|")
    for r in rows:
        add(f"| {r['servers']} | {r['rho']} | {_fmt(r['erlang_wait_min'])} | "
            f"{_fmt(r['sim_wait_min'])} | {_fmt(r['sim_wait_ci_half'])} | "
            f"{r['rel_err_pct']:+.1f}% | {_fmt(r['erlang_pct_over_20s'], 1)}% | "
            f"{_fmt(r['sim_pct_over_20s'], 1)}% |")
    add("\n![validation](figures/validation.png)\n")

    # --- Beyond
    b = studies["beyond"]
    var = b["variability"]
    ab = b["abandonment"]
    tv = b["time_varying"]
    add("## 2. Where the formula stops working\n")
    add(f"**Service-time variability.** Same arrival rate, same average "
        f"call length, 4 agents: Erlang C (which assumes exponential "
        f"calls) says {_fmt(var['erlang_wait_min'])} min. The simulation "
        f"agrees for exponential calls "
        f"({_fmt(var['cases']['exponential']['sim_wait_min'])} min), gives "
        f"{_fmt(var['cases']['uniform_cv0.5']['sim_wait_min'])} min for "
        f"steadier uniform calls (CV 0.5), and "
        f"{_fmt(var['cases']['lognormal_cv2']['sim_wait_min'])} min for "
        f"very variable lognormal calls (CV 2). The average call length "
        f"is not enough; the spread changes the answer.\n")
    add(f"**Abandonment.** At ρ = 0.95 with 5 agents, Erlang C (nobody "
        f"hangs up) predicts {_fmt(ab['erlang_wait_min_no_abandonment'])} "
        f"min. With callers hanging up after 10 minutes on average, the "
        f"simulated wait of served callers is "
        f"{_fmt(ab['cases']['patience_10']['sim_wait_min'])} min and "
        f"{_fmt(ab['cases']['patience_10']['abandon_pct'], 1)}% of callers "
        f"give up; with 4-minute patience the wait is "
        f"{_fmt(ab['cases']['patience_4']['sim_wait_min'])} min and "
        f"{_fmt(ab['cases']['patience_4']['abandon_pct'], 1)}% give up. "
        f"The formula cannot see any of this.\n")
    add(f"**A day with rush hours.** Staffing a centre with "
        f"{tv['servers']} agents (the 80%-in-20-seconds answer for the "
        f"*average* hour of the NYC-311-shaped day): the formula at the "
        f"average rate predicts {_fmt(tv['formula_at_mean_rate']['wait_min'])} "
        f"min waits, a flat simulated day gives "
        f"{_fmt(tv['flat_day_sim']['wait_min'])} min, and the shaped day "
        f"gives {_fmt(tv['profile_day_sim']['wait_min'])} min with "
        f"{_fmt(tv['profile_day_sim']['pct_over_20s'], 1)}% of callers "
        f"waiting over 20 seconds. Averaging the day first and applying "
        f"the formula second understates the waits, because the rush "
        f"hours dominate.\n")
    add("![variability](figures/variability.png)\n")

    # --- Arrivals
    arr = studies["arrivals"]
    add("## 3. Arrival data: the shape of a service day\n")
    add(f"NYC 311 service requests, January 2024 "
        f"({arr['requests_per_day']:,.0f} requests/day): the busiest hour "
        f"({arr['peak_hour']}:00) averages "
        f"{arr['peak_mean_per_hour']:,.0f} requests/hour, the quietest "
        f"({arr['trough_hour']}:00) {arr['trough_mean_per_hour']:,.0f} — a "
        f"{arr['peak_to_trough_ratio']:.1f}× swing inside one day. Scaled "
        f"to a centre averaging 60 calls/hour with 5-minute calls, the "
        f"80%-in-20-seconds staffing ranges from {arr['min_staff']} agents "
        f"overnight to {arr['max_staff']} mid-morning; staffing flat for "
        f"the average hour ({arr['servers_at_mean_rate']}) is wrong in "
        f"both directions. (Only the shape is borrowed; 311 requests are "
        f"not calls to one centre. See `DATA_SOURCES.md`.)\n")
    add("![staffing by hour](figures/staffing_by_hour.png)\n")

    # --- LLM check
    add("## 4. The LLM check: can a model do this?\n")
    truth = studies["truth"]
    models = sorted({m for (m, _) in agg})
    add("15 scenarios × 3 modes. Ground truth: Erlang C for the 10 "
        "formula/trap scenarios; 200 SimPy replications for the 5 "
        "beyond-formula ones. A numeric answer counts as *close* at "
        "≤ 25% relative error on the wait and ≤ 10 points on the "
        "percentage. The hand simulation is scored per customer "
        "(≤ 0.11 min error = tracked).\n")
    add("The two error averages rest only on answers actually given: a "
        "wait error exists only where the model printed a number, and "
        "a hand MAE only over the customers whose waits could be "
        "checked. The 'answers counted / asked' column gives that "
        "basis for each row (wait answers behind the average, out of "
        "the wait questions in the runs that returned output; for "
        "hand rows, checked customer waits out of the served "
        "customers), so a small average on few answers does not read "
        "as a good average.\n")
    add("| model | mode | scenarios close | code failed | answers counted / asked | mean wait rel. err (answered items only) | mean pct err (pts) | hand: customers tracked | hand MAE (min, answered items only) |")
    add("|---|---|---|---|---|---|---|---|---|")
    for m in models:
        for mode in ("direct", "code", "hand"):
            a = agg.get((m, mode))
            if not a:
                continue
            close_str = f"{a['close']}/{a['n']}" if mode != "hand" else "–"
            if mode == "hand":
                counted_str = f"{a['hand_counted']}/{a['hand_asked']}"
            else:
                counted_str = f"{a['wait_counted']}/{a['wait_asked']}"
            add(f"| {m} | {mode} | {close_str} | {a['code_failed']} | "
                f"{counted_str} | "
                f"{_fmt(100 * a['mean_wait_rel_err'], 0) if a['mean_wait_rel_err'] is not None else '–'}"
                f"{'%' if a['mean_wait_rel_err'] is not None else ''} | "
                f"{_fmt(a['mean_pct_abs_err'], 1) if a['mean_pct_abs_err'] is not None else '–'} | "
                f"{_fmt(100 * a['mean_hand_tracked'], 0) + '%' if a['mean_hand_tracked'] is not None else '–'} | "
                f"{_fmt(a['mean_hand_mae']) if a['mean_hand_mae'] is not None else '–'} |")
    add("")
    add("Ground truth for each scenario, the numbers the answers were "
        "scored against (the full per-run scores are in "
        "`outputs/llm_scores.json`):\n")
    add("| scenario | kind | truth: wait (min) | truth: % over 20 s | note |")
    add("|---|---|---|---|---|")
    for s in SCENARIOS:
        t = truth[s.id]
        note = ""
        if s.id == "B4":
            note = "no steady state exists (ρ > 1)"
        if s.id == "B5":
            add(f"| {s.id} {s.title} | {s.kind} | "
                f"priority {_fmt(t.get('PRIORITY_MEAN_WAIT_MIN'))} / "
                f"regular {_fmt(t.get('REGULAR_MEAN_WAIT_MIN'))} | – | "
                f"two customer classes with separate waits (200 "
                f"replications); no single pooled wait or percentage |")
            continue
        add(f"| {s.id} {s.title} | {s.kind} | "
            f"{_fmt(t.get('MEAN_WAIT_MIN'))} | {_fmt(t.get('PCT_OVER_20S'), 1)}"
            f"{'%' if t.get('PCT_OVER_20S') is not None else ''} | {note} |")
    add("\n![llm check errors](figures/llm_check_errors.png)\n")

    # --- Playground
    add("## 5. Playground data\n")
    add("The wait-vs-servers curves in `docs/` are precomputed from the "
        "same simulator (20 replications per point) for three presets. "
        "The browser's JavaScript simulator and Erlang C implementation "
        "are checked against the Python ones on fixed cases; see "
        "`docs/data/check_cases.json`.\n")
    add("![wait vs servers](figures/wait_vs_servers.png)\n")

    # --- Spend
    add("## 6. Spend\n")
    for name, info in spend_info.items():
        if name == "total":
            continue
        add(f"- {name}: {info['calls']} priced calls, ${info['cost']:.4f} "
            f"(by model: " + ", ".join(
                f"{m} ${c:.4f}" for m, c in sorted(info["per_model"].items()))
            + ")")
    add(f"- **Total model spend: ${spend_info['total']:.4f}** of the "
        f"$5.00 project cap.\n")

    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "summary.md").write_text("\n".join(L))


def export_docs_data(studies: dict, agg: dict | None = None) -> None:
    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    (DOCS_DATA / "curves.json").write_text(json.dumps(
        {"presets": studies["playground"],
         "arrivals_staffing": studies["arrivals"]["scaled_staffing_by_hour"],
         "servers_at_mean_rate": studies["arrivals"]["servers_at_mean_rate"]},
        indent=1))
    if agg is not None:
        rows = []
        for (model, mode), a in sorted(agg.items()):
            rows.append({
                "model": model, "mode": mode, "n": a["n"],
                "close": a["close"], "code_failed": a["code_failed"],
                "wait_counted": a["wait_counted"],
                "wait_asked": a["wait_asked"],
                "hand_counted": a["hand_counted"],
                "hand_asked": a["hand_asked"],
                "mean_wait_rel_err": a["mean_wait_rel_err"],
                "mean_pct_abs_err": a["mean_pct_abs_err"],
                "mean_hand_tracked": a["mean_hand_tracked"],
                "mean_hand_mae": a["mean_hand_mae"],
            })
        (DOCS_DATA / "llm_check.json").write_text(json.dumps(
            {"models_modes": rows}, indent=1))


def main() -> None:
    studies = json.loads((OUT / "studies.json").read_text())
    prices = json.loads((OUT / "model_prices.json").read_text())
    rows = _load_jsonl(OUT / "llm_runs.jsonl")
    scored = score_runs(rows, studies["truth"]) if rows else []
    (OUT / "llm_scores.json").write_text(json.dumps(scored, indent=1))
    agg = aggregate(scored)
    spend_info = spend({"pilot": _load_jsonl(OUT / "pilot_runs.jsonl"),
                        "main run": rows}, prices)
    figs = figures(studies, agg)
    write_summary(studies, scored, agg, spend_info, figs)
    export_docs_data(studies, agg)
    print(f"summary written; figures: {figs}; spend total ${spend_info['total']:.4f}")


if __name__ == "__main__":
    main()
