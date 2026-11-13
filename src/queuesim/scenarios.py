"""The 15 LLM-check scenarios and their ground truth.

Structure (see DECISIONS.md #1): 5 plain formula scenarios (F1-F5) where
Erlang C applies directly, 5 trap scenarios (T1-T5) where Erlang C still
applies but only after a unit conversion, a derived arrival rate, or
care with a near-saturated system, and 5 beyond-formula scenarios
(B1-B5) where the truth comes from 200 replications of the SimPy model.
Together F+T are the spec's "10 where Erlang C applies"; B is its "5
where it doesn't", with the rho >= 1 trap inside B4.

Canonical parameters are per minute. The description shown to the model
is written in the units stated in `description` (the traps live there).
Every scenario also defines a 20-customer hand-simulation instance:
explicit arrival and service times (minutes, 2 decimals) generated with
a per-scenario seed, scored against `compute_waits` on the same numbers.
"""
from __future__ import annotations

import math
import random
import zlib
from dataclasses import dataclass, field

from . import erlang
from .simulate import QueueConfig, compute_waits, run_replications

TARGET_MIN = 20.0 / 60.0  # 20 seconds


@dataclass
class Question:
    key: str          # output-line key the model must print
    label: str        # human-readable label used in prompts and reports


@dataclass
class Scenario:
    id: str
    kind: str                       # formula | trap | beyond
    title: str
    description: str                # wording given to the model
    servers: int
    questions: list[Question]
    lam: float | None = None        # canonical arrivals/minute (steady cases)
    mu: float | None = None         # canonical services/minute/server
    sim_config: QueueConfig | None = None  # truth by simulation (beyond kind)
    hand_kind: str = "mmc"          # mmc | lognormal | abandon | day | unstable | priority

    @property
    def is_unstable(self) -> bool:
        return self.id == "B4"


Q_WAIT = Question("MEAN_WAIT_MIN", "average waiting time before service starts, in minutes")
Q_PCT = Question("PCT_OVER_20S", "percentage of customers who wait more than 20 seconds")
Q_ABANDON = Question("ABANDON_PCT", "percentage of arriving customers who give up and leave without being served")
Q_STABLE = Question("STEADY_STATE", "whether a steady-state average wait exists (answer yes or no)")
Q_PRIO = Question("PRIORITY_MEAN_WAIT_MIN", "average waiting time of priority customers, in minutes")
Q_REG = Question("REGULAR_MEAN_WAIT_MIN", "average waiting time of regular customers, in minutes")

_STD = [Q_WAIT, Q_PCT]


def _f(id_, title, desc, c, lam_h, mu_h, hand="mmc"):
    return Scenario(id=id_, kind="formula", title=title, description=desc,
                    servers=c, questions=list(_STD),
                    lam=lam_h / 60.0, mu=mu_h / 60.0, hand_kind=hand)


def _t(id_, title, desc, c, lam_h, mu_h):
    return Scenario(id=id_, kind="trap", title=title, description=desc,
                    servers=c, questions=list(_STD),
                    lam=lam_h / 60.0, mu=mu_h / 60.0, hand_kind="mmc")


SCENARIOS: list[Scenario] = [
    _f("F1", "Small support desk",
       "A support desk receives 30 calls per hour. Each call takes 5 minutes "
       "on average. There are 4 agents. Calls arrive at random (Poisson), call "
       "lengths are exponential, callers never hang up, and the desk has been "
       "running for a long time.",
       c=4, lam_h=30, mu_h=12),
    _f("F2", "Bank call centre",
       "A bank call centre receives 60 calls per hour. Each call takes "
       "4 minutes on average. There are 6 agents. Calls arrive at random "
       "(Poisson), call lengths are exponential, callers never hang up, and "
       "the centre is in steady state.",
       c=6, lam_h=60, mu_h=15),
    _f("F3", "Clinic phone line",
       "A clinic's phone line receives 10 calls per hour. Each call takes "
       "10 minutes on average. There are 3 staff answering. Calls arrive at "
       "random (Poisson), call lengths are exponential, callers never hang "
       "up, and the line is in steady state.",
       c=3, lam_h=10, mu_h=6),
    _f("F4", "Busy help line",
       "A help line receives 120 calls per hour. Each call takes 3 minutes "
       "on average. There are 8 agents. Calls arrive at random (Poisson), "
       "call lengths are exponential, callers never hang up, and the line is "
       "in steady state.",
       c=8, lam_h=120, mu_h=20),
    _f("F5", "Loaded service desk",
       "A service desk receives 50 calls per hour. Each call takes 6 minutes "
       "on average. There are 6 agents. Calls arrive at random (Poisson), "
       "call lengths are exponential, callers never hang up, and the desk is "
       "in steady state.",
       c=6, lam_h=50, mu_h=10),
    _t("T1", "Per-minute arrivals, seconds for service",
       "A chat-support team gets 2 new chats per minute. The average chat "
       "lasts 240 seconds. There are 10 agents. Chats arrive at random "
       "(Poisson), chat lengths are exponential, nobody gives up, and the "
       "team is in steady state.",
       c=10, lam_h=120, mu_h=15),
    _t("T2", "One call every 30 seconds",
       "On average, one call arrives every 30 seconds. Each call lasts "
       "3 minutes on average. There are 8 agents. Calls arrive at random "
       "(Poisson), call lengths are exponential, callers never hang up, and "
       "the centre is in steady state.",
       c=8, lam_h=120, mu_h=20),
    _t("T3", "Nearly saturated centre",
       "A call centre receives 57 calls per hour. Each call takes 10 minutes "
       "on average. There are 10 agents. Calls arrive at random (Poisson), "
       "call lengths are exponential, callers never hang up, and the centre "
       "is in steady state.",
       c=10, lam_h=57, mu_h=6),
    _t("T4", "Utilisation given, arrival rate hidden",
       "A call centre has 5 agents. The average call lasts 6 minutes. The "
       "centre runs at 90% utilisation (each agent is busy 90% of the time). "
       "Calls arrive at random (Poisson), call lengths are exponential, "
       "callers never hang up, and the centre is in steady state.",
       c=5, lam_h=45, mu_h=10),
    _t("T5", "The 20-second target",
       "A call centre receives 80 calls per hour. Each call takes 3.75 "
       "minutes on average. There are 7 agents. Calls arrive at random "
       "(Poisson), call lengths are exponential, callers never hang up, and "
       "the centre is in steady state. The service target is about the share "
       "of callers who wait more than 20 seconds.",
       c=7, lam_h=80, mu_h=16),
    Scenario(
        id="B1", kind="beyond", title="Very variable call lengths",
        description=(
            "A support desk receives 30 calls per hour. Call lengths are NOT "
            "exponential: they are lognormal with an average of 5 minutes and "
            "a coefficient of variation of 2 (a few very long calls, many "
            "short ones). There are 4 agents. Calls arrive at random "
            "(Poisson), callers never hang up, and the desk is in steady state."),
        servers=4, questions=list(_STD), hand_kind="lognormal",
        sim_config=QueueConfig(servers=4, service_mean=5.0, arrival_rate=30 / 60,
                               service_dist="lognormal", service_cv=2.0,
                               warmup=600, duration=6600)),
    Scenario(
        id="B2", kind="beyond", title="Callers hang up",
        description=(
            "A call centre receives 38 calls per hour. Each call takes "
            "7.5 minutes on average (exponential). There are 5 agents. "
            "Callers are impatient: while waiting, each caller hangs up after "
            "an exponential patience time with an average of 10 minutes. "
            "Calls arrive at random (Poisson) and the centre is in steady "
            "state."),
        servers=5, questions=[Q_WAIT, Q_PCT, Q_ABANDON], hand_kind="abandon",
        sim_config=QueueConfig(servers=5, service_mean=7.5, arrival_rate=38 / 60,
                               patience_mean=10.0, warmup=600, duration=6600)),
    Scenario(
        id="B3", kind="beyond", title="Rush hours",
        description=(
            "A call centre is open for 8 hours. For the first 4 hours it "
            "receives 20 calls per hour; then for 2 rush hours it receives "
            "50 calls per hour; then for the last 2 hours it is back to "
            "20 calls per hour. Each call takes 6 minutes on average "
            "(exponential). There are 4 agents all day. Calls arrive at "
            "random (Poisson within each hour), callers never hang up, and "
            "the centre starts the day empty. The questions ask about the "
            "whole day, averaged over all callers."),
        servers=4, questions=list(_STD), hand_kind="day",
        sim_config=QueueConfig(servers=4, service_mean=6.0,
                               hourly_rates=[20 / 60] * 4 + [50 / 60] * 2 + [20 / 60] * 2,
                               warmup=0, duration=480)),
    Scenario(
        id="B4", kind="beyond", title="More calls than the team can handle",
        description=(
            "A call centre receives 50 calls per hour. Each call takes "
            "6 minutes on average (exponential). There are only 4 agents. "
            "Calls arrive at random (Poisson) and callers never hang up."),
        servers=4, questions=[Q_STABLE, Q_WAIT], hand_kind="unstable",
        sim_config=QueueConfig(servers=4, service_mean=6.0, arrival_rate=50 / 60,
                               warmup=0, duration=480)),
    Scenario(
        id="B5", kind="beyond", title="Priority customers",
        description=(
            "A call centre receives 40 calls per hour. Each call takes "
            "5 minutes on average (exponential). There are 5 agents. 20% of "
            "callers are priority customers: whenever an agent frees up, a "
            "waiting priority customer is served before any waiting regular "
            "customer (service is never interrupted once started). Calls "
            "arrive at random (Poisson), callers never hang up, and the "
            "centre is in steady state."),
        servers=5, questions=[Q_PRIO, Q_REG], hand_kind="priority",
        sim_config=QueueConfig(servers=5, service_mean=5.0, arrival_rate=40 / 60,
                               priority_share=0.2, warmup=600, duration=6600)),
]

BY_ID = {s.id: s for s in SCENARIOS}


# ---------------------------------------------------------------------------
# Ground truth
# ---------------------------------------------------------------------------

def formula_truth(s: Scenario) -> dict:
    """Erlang C ground truth for formula/trap scenarios."""
    r = erlang.mmc(s.lam, s.mu, s.servers)
    return {
        "MEAN_WAIT_MIN": r.mean_wait_q,
        "PCT_OVER_20S": 100.0 * r.p_wait_over(TARGET_MIN),
        "erlang_c": r.p_wait,
        "rho": r.rho,
    }


TRUTH_REPS = 200  # spec: ground truth for beyond-formula cases


def simulation_truth(s: Scenario, reps: int = TRUTH_REPS, seed0: int = 777000) -> dict:
    """SimPy ground truth for beyond-formula scenarios."""
    res = run_replications(s.sim_config, reps, seed0=seed0)
    sm = res["summary"]
    out: dict = {"n_reps": reps}
    if s.id == "B4":
        out["STEADY_STATE"] = "no"
        # Document what actually happens over one 8-hour day: the queue
        # grows all day, so any 'average wait' keeps growing with the day.
        out["MEAN_WAIT_MIN"] = sm["mean_wait_q"]["mean"]
        out["mean_number_system_end_note"] = (
            "queue grows without bound; the day-average wait below is a "
            "finite-horizon number, not a steady state")
        out["PCT_OVER_20S"] = 100.0 * sm["pct_over_target"]["mean"]
        return out
    if s.id == "B5":
        # Per-class means are not in the generic summary; average the reps.
        pr = [r["mean_wait_q_priority"] for r in res["reps"]]
        rg = [r["mean_wait_q_regular"] for r in res["reps"]]
        out["PRIORITY_MEAN_WAIT_MIN"] = sum(pr) / len(pr)
        out["REGULAR_MEAN_WAIT_MIN"] = sum(rg) / len(rg)
        return out
    out["MEAN_WAIT_MIN"] = sm["mean_wait_q"]["mean"]
    out["MEAN_WAIT_MIN_CI"] = sm["mean_wait_q"]["ci_half"]
    out["PCT_OVER_20S"] = 100.0 * sm["pct_over_target"]["mean"]
    if s.id == "B2":
        out["ABANDON_PCT"] = 100.0 * sm["abandon_rate"]["mean"]
    return out


def ground_truth(s: Scenario) -> dict:
    if s.kind in ("formula", "trap"):
        return formula_truth(s)
    return simulation_truth(s)


# ---------------------------------------------------------------------------
# Hand-simulation instances (20 customers, explicit times)
# ---------------------------------------------------------------------------

@dataclass
class HandInstance:
    arrivals: list[float]
    services: list[float]
    patience: list[float] | None = None
    priority: list[int] | None = None   # 0 = priority, 1 = regular


def _seed_for(scenario_id: str) -> int:
    return 20261113 + zlib.crc32(scenario_id.encode())


def make_hand_instance(s: Scenario) -> HandInstance:
    """Generate the fixed 20-customer instance for a scenario.

    A long stream (300 customers) is drawn from the scenario's own
    process; the instance is the first 20-customer window of that
    stream which, simulated on its own from an empty system, has at
    least 5 customers who wait (> 0.05 min) or abandon — re-zeroed to
    start near t = 0. A window taken blindly from an empty system
    usually contains no waiting at all when there are many servers,
    and an instance with no events tests nothing (DECISIONS.md #13).
    Times are minutes, rounded to 2 decimals; the checker and the
    model see exactly the same numbers.
    """
    rng = random.Random(_seed_for(s.id))
    n_stream = 300

    def exp(rate_per_min: float) -> float:
        return rng.expovariate(rate_per_min)

    if s.hand_kind == "day":
        rates = [20 / 60] * 4 + [50 / 60] * 2 + [20 / 60] * 2
        lam_max = max(rates)
        arrivals = []
        t = 0.0
        while len(arrivals) < n_stream:
            t += rng.expovariate(lam_max)
            hour = int(t // 60) % 8          # the 8-hour day repeats
            if rng.random() <= rates[hour] / lam_max:
                arrivals.append(round(t, 2))
        services = [round(exp(10 / 60), 2) for _ in range(n_stream)]
        patience = priority = None
    else:
        lam = s.lam if s.lam is not None else 40 / 60
        mu = s.mu if s.mu is not None else 12 / 60
        if s.id == "B1":
            lam, mu = 30 / 60, 12 / 60
        if s.id == "B2":
            lam, mu = 38 / 60, 8 / 60
        if s.id == "B4":
            lam, mu = 50 / 60, 10 / 60
        if s.id == "B5":
            lam, mu = 40 / 60, 12 / 60

        arrivals = []
        t = 0.0
        for _ in range(n_stream):
            t += exp(lam)
            arrivals.append(round(t, 2))

        if s.hand_kind == "lognormal":
            mean, cv = 5.0, 2.0
            sigma2 = math.log(1 + cv ** 2)
            mu_ln = math.log(mean) - sigma2 / 2
            services = [round(rng.lognormvariate(mu_ln, math.sqrt(sigma2)), 2)
                        for _ in range(n_stream)]
        else:
            services = [round(exp(mu), 2) for _ in range(n_stream)]

        patience = None
        if s.hand_kind == "abandon":
            patience = [round(exp(1 / 10.0), 2) for _ in range(n_stream)]
        priority = None
        if s.hand_kind == "priority":
            priority = [0 if rng.random() < 0.2 else 1
                        for _ in range(n_stream)]

    def window_is_busy(start: int) -> bool:
        t0 = arrivals[start]
        w_arr = [round(a - t0, 2) for a in arrivals[start:start + 20]]
        out = compute_waits(
            w_arr, services[start:start + 20], s.servers,
            patience=patience[start:start + 20] if patience else None,
            priority=priority[start:start + 20] if priority else None)
        return sum(1 for o in out
                   if o.abandoned or (o.wait or 0) > 0.05) >= 5

    start = next((i for i in range(n_stream - 19) if window_is_busy(i)), 0)
    t0 = arrivals[start]
    return HandInstance(
        arrivals=[round(a - t0, 2) for a in arrivals[start:start + 20]],
        services=services[start:start + 20],
        patience=patience[start:start + 20] if patience else None,
        priority=priority[start:start + 20] if priority else None,
    )
