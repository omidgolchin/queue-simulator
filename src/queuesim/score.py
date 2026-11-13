"""Score LLM-check run rows against ground truth.

Direct and Code answers are parsed from their printed lines. The verdict
thresholds are pre-specified in PLAN.md:

* a mean-wait answer is "close" when its relative error is at most 25%
  (relative to max(truth, 0.05) minutes, so near-zero truths stay fair);
* a percentage answer is "close" when it is within 10 percentage points;
* B4 is correct when the model states that no steady state exists;
* the hand simulation is scored per customer: |error| <= 0.11 minutes
  counts as "tracked" (answers are given to 2 decimals), with mean
  absolute error reported as well; for B2 an abandoned customer counts
  only when the model also marks them abandoned.

Errors are always reported raw, verdict or not.
"""

from __future__ import annotations

import math
import re

_NUM = r"(-?\d+(?:\.\d+)?)"


def parse_lines(text: str, keys: list[str]) -> dict[str, float | str | None]:
    """Pull 'KEY: value' lines out of a model answer."""
    out: dict[str, float | str | None] = {}
    for key in keys:
        m = re.search(rf"{key}\s*:\s*(.+)", text, flags=re.IGNORECASE)
        if not m:
            out[key] = None
            continue
        raw = m.group(1).strip().strip("*` ")
        if key == "STEADY_STATE":
            low = raw.lower()
            out[key] = "no" if low.startswith("no") else (
                "yes" if low.startswith("yes") else None)
            continue
        if raw.lower() in ("none", "n/a", "infinite", "infinity", "unbounded"):
            out[key] = "none"
            continue
        num = re.search(_NUM, raw)
        out[key] = float(num.group(1)) if num else None
    return out


def _wait_close(est: float, truth: float) -> bool:
    return abs(est - truth) / max(truth, 0.05) <= 0.25


def score_numeric(scenario, parsed: dict, truth: dict) -> dict:
    """Score a Direct or Code answer for one scenario."""
    per_q: dict[str, dict] = {}
    all_close = True
    any_parsed = False
    for q in scenario.questions:
        key = q.key
        est = parsed.get(key)
        if key == "STEADY_STATE":
            ok = est == truth.get("STEADY_STATE")
            per_q[key] = {"est": est, "truth": truth.get("STEADY_STATE"),
                          "close": bool(ok)}
            all_close = all_close and bool(ok)
            any_parsed = any_parsed or est is not None
            continue
        t = truth.get(key)
        if est is None or est == "none" or t is None:
            # For B4's MEAN_WAIT_MIN, answering "none" (no steady state)
            # when the truth is instability is the correct answer.
            if scenario.id == "B4" and key == "MEAN_WAIT_MIN" and est == "none":
                per_q[key] = {"est": "none", "truth": "no steady state",
                              "close": True}
                any_parsed = True
                continue
            per_q[key] = {"est": est, "truth": t, "close": False}
            all_close = False
            continue
        any_parsed = True
        if key.endswith("_PCT") or key == "PCT_OVER_20S":
            err = abs(est - t)
            close = err <= 10.0
            per_q[key] = {"est": est, "truth": t, "abs_err_points": err,
                          "close": close}
        else:
            rel = abs(est - t) / max(t, 0.05)
            close = rel <= 0.25
            per_q[key] = {"est": est, "truth": t, "rel_err": rel,
                          "close": close}
        all_close = all_close and close
    return {"per_question": per_q, "all_close": all_close,
            "any_parsed": any_parsed}


_HAND_WAIT = re.compile(r"CUSTOMER\s+(\d+)\s+WAIT\s*:\s*" + _NUM, re.IGNORECASE)
_HAND_ABANDONED = re.compile(r"CUSTOMER\s+(\d+)\s*:\s*ABANDONED", re.IGNORECASE)


def parse_hand(text: str, n: int) -> dict[int, float | str | None]:
    """Parse 'CUSTOMER n WAIT: x' / 'CUSTOMER n: ABANDONED' lines."""
    out: dict[int, float | str | None] = {i: None for i in range(n)}
    for m in _HAND_WAIT.finditer(text):
        idx = int(m.group(1)) - 1
        if 0 <= idx < n:
            out[idx] = float(m.group(2))
    for m in _HAND_ABANDONED.finditer(text):
        idx = int(m.group(1)) - 1
        if 0 <= idx < n:
            out[idx] = "abandoned"
    return out


def score_hand(scenario, parsed: dict, outcomes) -> dict:
    """Score a hand simulation against the deterministic checker."""
    errs: list[float] = []
    tracked = 0
    answered = 0
    for i, outcome in enumerate(outcomes):
        est = parsed.get(i)
        if est is None:
            continue
        answered += 1
        if outcome.abandoned:
            if est == "abandoned":
                tracked += 1
            continue
        if est == "abandoned":
            continue
        err = abs(est - outcome.wait)
        errs.append(err)
        if err <= 0.11:
            tracked += 1
    n = len(outcomes)
    return {
        "n_customers": n,
        "answered": answered,
        "tracked": tracked,
        "tracked_share": tracked / n if n else math.nan,
        "mae_min": (sum(errs) / len(errs)) if errs else math.nan,
        # Basis of the MAE: how many customer waits actually entered it,
        # out of the customers whose wait could be checked (served
        # customers; an abandoned customer's wait is not checkable).
        "n_errs": len(errs),
        "n_scorable": sum(1 for o in outcomes if not o.abandoned),
    }
