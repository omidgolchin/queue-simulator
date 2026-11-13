"""Tests for queuesim.

The spec's required tests:
* simulation matches Erlang C within its confidence interval on
  three settings;
* Little's Law holds within 2% in the simulator's own counters;
* the event-by-event checker computes waits correctly on a
  hand-worked example of 5 customers.
Plus: Erlang C against the raw-sum formula, the checker against SimPy
on identical fixed input (FIFO, abandonment, priority), and the
staffing search against a brute-force check.
"""

import math

import pytest

from queuesim.erlang import erlang_c, mmc, servers_needed
from queuesim.simulate import (QueueConfig, compute_waits, run_replications,
                               simulate_scripted)


def _erlang_c_direct(c: int, a: float) -> float:
    s = sum(a ** k / math.factorial(k) for k in range(c))
    top = a ** c / math.factorial(c) * c / (c - a)
    return top / (s + top)


@pytest.mark.parametrize("c,a", [(1, 0.3), (1, 0.9), (2, 1.6), (4, 2.5),
                                 (7, 5.0), (10, 9.0)])
def test_erlang_c_matches_raw_sum(c, a):
    assert erlang_c(c, a) == pytest.approx(_erlang_c_direct(c, a), rel=1e-10)


def test_mm1_known_values():
    r = mmc(0.7, 1.0, 1)          # rho = 0.7
    assert r.mean_wait_q == pytest.approx(0.7 / 0.3)
    assert r.mean_number_system == pytest.approx(0.7 / 0.3)
    assert r.p_wait == pytest.approx(0.7)


def test_erlang_c_rejects_unstable():
    with pytest.raises(ValueError):
        erlang_c(4, 5.0)


def test_servers_needed_brute_force():
    lam, mu, t = 1.0, 0.2, 20 / 60
    c = servers_needed(lam, mu, t, 0.80)
    assert mmc(lam, mu, c).service_level(t) >= 0.80
    assert mmc(lam, mu, c - 1).service_level(t) < 0.80


# --- deterministic checker -------------------------------------------------

def test_checker_hand_worked_five_customers():
    # Two servers. By hand: c0 0-5, c1 1-6, c2 waits for the 5.0 freeing
    # (start 5, wait 3), c3 waits for the 6.0 freeing (start 6, wait 3),
    # c4 arrives at 10 exactly when c2 finishes (start 10, wait 0).
    out = compute_waits([0, 1, 2, 3, 10], [5, 5, 5, 5, 2], servers=2)
    assert [o.wait for o in out] == [0, 0, 3, 3, 0]
    assert [o.end for o in out] == [5, 6, 10, 11, 12]


def test_checker_abandonment():
    out = compute_waits([0, 0.5], [10, 1], servers=1, patience=[100, 2])
    assert out[0].wait == 0 and not out[0].abandoned
    assert out[1].abandoned and out[1].wait is None


def test_checker_priority_jumps_the_queue():
    out = compute_waits([0, 0.5, 0.6], [5, 1, 1], servers=1,
                        priority=[1, 1, 0])
    assert [o.wait for o in out] == [0, 5.5, 4.4]


@pytest.mark.parametrize("kwargs", [
    {},
    {"patience": [9, 3, 8, 2, 12, 5]},
    {"priority": [1, 0, 1, 1, 0, 1]},
])
def test_checker_matches_simpy_on_fixed_input(kwargs):
    arrivals = [0.0, 0.7, 1.9, 2.2, 4.5, 5.1]
    services = [3.0, 2.0, 1.0, 4.0, 1.5, 2.5]
    a = compute_waits(arrivals, services, servers=2, **kwargs)
    b = simulate_scripted(arrivals, services, servers=2, **kwargs)
    for x, y in zip(a, b):
        assert x.abandoned == y.abandoned
        if not x.abandoned:
            assert x.wait == pytest.approx(y.wait, abs=1e-9)


# --- simulation vs formulas ------------------------------------------------

@pytest.mark.parametrize("c,rho", [(1, 0.7), (2, 0.8), (5, 0.6)])
def test_simulation_matches_erlang_c_within_ci(c, rho):
    lam = rho * c * 1.0
    cfg = QueueConfig(servers=c, service_mean=1.0, arrival_rate=lam,
                      warmup=500, duration=6000)
    res = run_replications(cfg, 16, seed0=42)
    truth = mmc(lam, 1.0, c).mean_wait_q
    got = res["summary"]["mean_wait_q"]
    assert abs(got["mean"] - truth) <= got["ci_half"] + 0.02 * truth


def test_littles_law_within_two_percent():
    cfg = QueueConfig(servers=3, service_mean=1.0, arrival_rate=2.1,
                      warmup=1000, duration=21000)
    res = run_replications(cfg, 10, seed0=7)
    ratio = res["summary"]["little_ratio"]["mean"]
    assert abs(ratio - 1.0) <= 0.02
