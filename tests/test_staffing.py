"""Tests for the staffing planner: Python reference, JavaScript engine, and
the browser simulation against the SimPy simulator."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from queuesim.simulate import QueueConfig, run_replications
from queuesim.staffing import day_plan, scheduled, staff_erlang

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node not available")


def _js(expr: str):
    script = ("const Q=require('./docs/qsim.js'); globalThis.erlangC=Q.erlangC; globalThis.mmc=Q.mmc;"
              "const S=require('./docs/staffing.js'); console.log(JSON.stringify(%s));" % expr)
    proc = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=300, cwd=ROOT)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def test_textbook_case():
    s = staff_erlang(2.0, 6.0, 20 / 60, 0.80, 0.90)   # 120 calls/h, 6 min
    assert s.agents == 16 and s.binding == "service"
    assert 0.80 <= s.service_level < 0.86


def test_occupancy_cap_adds_agents():
    loose = staff_erlang(10.0, 4.5, 20 / 60, 0.80, 1.0)
    capped = staff_erlang(10.0, 4.5, 20 / 60, 0.80, 0.85)
    assert capped.agents > loose.agents and capped.binding == "occupancy"
    assert capped.occupancy <= 0.85


def test_shrinkage():
    assert scheduled(16, 0.30) == 23
    assert scheduled(14, 0.30) == 20       # 14 / 0.7 = 20 exactly: no extra person
    assert scheduled(5, 0.0) == 5


def test_day_plan_totals():
    p = day_plan([60, 120, 0], 60, 6, 20 / 60, 0.8, 0.9, 0.3, min_agents=2)
    assert p["agent_hours"] == sum(r["agents"] for r in p["rows"])
    assert p["rows"][2]["agents"] == 2 and p["rows"][2]["calls"] == 0
    assert all(r["sl"] >= 0.8 for r in p["rows"])


@needs_node
@pytest.mark.parametrize("lam,aht,T,level,cap", [(2.0, 6.0, 1 / 3, 0.8, 0.9), (0.5, 5.0, 1 / 3, 0.8, 0.9),
                                                 (10.0, 4.5, 0.25, 0.9, 0.85), (4.0, 3.0, 0.5, 0.9, 0.9)])
def test_js_staffing_matches_python(lam, aht, T, level, cap):
    js = _js("S.staffErlang(%r,%r,%r,%r,%r)" % (lam, aht, T, level, cap))
    py = staff_erlang(lam, aht, T, level, cap)
    assert js["c"] == py.agents and js["binding"] == py.binding
    assert js["sl"] == pytest.approx(py.service_level, abs=1e-9)
    assert js["asa"] == pytest.approx(py.asa_minutes, rel=1e-9)


@needs_node
def test_js_day_plan_matches_python():
    calls = [40, 95, 160, 150, 120, 0, 60]
    js = _js("S.dayPlan(%s,60,6,1/3,0.8,0.9,0.3,2)" % json.dumps(calls))
    py = day_plan(calls, 60, 6, 1 / 3, 0.8, 0.9, 0.3, min_agents=2)
    assert [r["c"] for r in js["rows"]] == [r["agents"] for r in py["rows"]]
    assert js["paidHours"] == pytest.approx(py["paid_hours"])


@needs_node
@pytest.mark.parametrize("servers,lam,mean,patience", [(6, 1.0, 5.0, 3.0), (26, 4.0, 6.0, 2.0)])
def test_browser_simulation_matches_simpy(servers, lam, mean, patience):
    """The browser's hang-up simulation agrees with the SimPy simulator."""
    js = _js("S.simulate(%r,%r,%r,%r,{reps:40,minutes:480,warmup:60})" % (lam, mean, servers, patience))
    py = run_replications(QueueConfig(servers=servers, service_mean=mean, arrival_rate=lam,
                                      patience_mean=patience, warmup=60, duration=540), 30)["summary"]
    pairs = [("abandon", "abandon_rate"), ("pctOver", "pct_over_target"), ("asa", "mean_wait_q"), ("occ", "utilisation")]
    for jk, pk in pairs:
        diff = abs(js[jk]["mean"] - py[pk]["mean"])
        tol = 1.5 * (js[jk]["half"] + py[pk]["ci_half"]) + 1e-3
        assert diff <= tol, (jk, js[jk], py[pk])


@needs_node
def test_simulation_without_hangups_matches_erlang_c():
    js = _js("[S.simulate(2,6,16,null,{reps:40}), S.erlangMetrics(2,6,16,1/3)]")
    sim, formula = js
    assert abs(sim["sl"]["mean"] - formula["sl"]) <= sim["sl"]["half"] * 1.5 + 0.005


@needs_node
def test_live_queue_matches_simulation_on_average():
    js = _js("(()=>{let off=0,w=0;for(let r=0;r<30;r++){const L=S.makeLive(2,6,16,null,1/3,50+r);L.step(60);L.resetCounters();L.step(480);off+=L.answered+L.abandoned;w+=L.within;} return w/off;})()")
    assert js == pytest.approx(staff_erlang(2.0, 6.0, 1 / 3, 0.8, 0.9).service_level, abs=0.03)
