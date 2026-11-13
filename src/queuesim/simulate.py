"""Discrete-event queue simulation with SimPy, plus an independent
deterministic event-by-event checker.

Time unit is minutes everywhere.

The simulator models a single queue feeding `servers` identical servers:
Poisson or hour-by-hour time-varying arrivals, exponential / lognormal /
uniform service, optional exponential patience (abandonment), and an
optional two-class non-preemptive priority discipline. Statistics are
collected after a warm-up period over independent replications; every
replication also reports the ingredients of Little's law (L, lambda, W)
measured from its own counters so the law can be checked run by run.

`compute_waits` is a separate, small event loop that computes exact waits
for a fixed list of arrivals and service times. It shares no code with
the SimPy model, so the two can be checked against each other
(`simulate_scripted` feeds the same fixed lists through SimPy).
"""
from __future__ import annotations

import heapq
import math
import random
import statistics
from dataclasses import dataclass, field

import simpy


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

@dataclass
class QueueConfig:
    servers: int
    service_mean: float                      # minutes
    arrival_rate: float | None = None        # per minute (constant arrivals)
    hourly_rates: list[float] | None = None  # per minute, one value per hour
    service_dist: str = "exp"                # exp | lognormal | uniform
    service_cv: float = 1.0                  # coefficient of variation (non-exp)
    patience_mean: float | None = None       # minutes; None = nobody abandons
    priority_share: float = 0.0              # share of arrivals in priority class
    warmup: float = 0.0                      # minutes excluded from statistics
    duration: float = 480.0                  # minutes simulated
    target_minutes: float = 20.0 / 60.0      # "answered within 20 seconds"
    record_series: bool = False              # sample queue length over time

    def validate(self) -> None:
        if self.servers < 1:
            raise ValueError("servers must be >= 1")
        if self.service_mean <= 0:
            raise ValueError("service_mean must be positive")
        if (self.arrival_rate is None) == (self.hourly_rates is None):
            raise ValueError("give exactly one of arrival_rate / hourly_rates")
        if self.arrival_rate is not None and self.arrival_rate <= 0:
            raise ValueError("arrival_rate must be positive")
        if self.hourly_rates is not None and (not self.hourly_rates
                                              or min(self.hourly_rates) < 0
                                              or max(self.hourly_rates) <= 0):
            raise ValueError("hourly_rates must be non-empty, >= 0, with a positive max")
        if self.service_dist not in ("exp", "lognormal", "uniform"):
            raise ValueError("service_dist must be exp, lognormal or uniform")
        if self.duration <= self.warmup:
            raise ValueError("duration must exceed warmup")


def _service_sampler(cfg: QueueConfig, rng: random.Random):
    m = cfg.service_mean
    if cfg.service_dist == "exp" or cfg.service_cv == 1.0 and cfg.service_dist == "exp":
        return lambda: rng.expovariate(1.0 / m)
    if cfg.service_dist == "lognormal":
        sigma2 = math.log(1.0 + cfg.service_cv ** 2)
        mu_ln = math.log(m) - sigma2 / 2.0
        sigma = math.sqrt(sigma2)
        return lambda: rng.lognormvariate(mu_ln, sigma)
    if cfg.service_dist == "uniform":
        half = m * cfg.service_cv * math.sqrt(3.0)
        lo, hi = max(0.0, m - half), m + half
        return lambda: rng.uniform(lo, hi)
    return lambda: rng.expovariate(1.0 / m)


# --------------------------------------------------------------------------
# SimPy model
# --------------------------------------------------------------------------

class _Tracker:
    """Time-averaged counts (number in system, busy servers) with warm-up."""

    def __init__(self, warmup: float):
        self.warmup = warmup
        self.n_sys = 0
        self.n_busy = 0
        self.area_sys = 0.0
        self.area_busy = 0.0
        self.last_t = 0.0

    def _advance(self, t: float) -> None:
        start = max(self.last_t, self.warmup)
        if t > start:
            span = t - start
            self.area_sys += self.n_sys * span
            self.area_busy += self.n_busy * span
        self.last_t = t

    def arrive(self, t: float) -> None:
        self._advance(t)
        self.n_sys += 1

    def start(self, t: float) -> None:
        self._advance(t)
        self.n_busy += 1

    def depart(self, t: float) -> None:
        self._advance(t)
        self.n_busy -= 1
        self.n_sys -= 1

    def abandon(self, t: float) -> None:
        self._advance(t)
        self.n_sys -= 1

    def close(self, t: float) -> None:
        self._advance(t)


def run_replication(cfg: QueueConfig, seed: int) -> dict:
    """Run one replication and return its statistics."""
    cfg.validate()
    rng = random.Random(seed)
    env = simpy.Environment()
    if cfg.priority_share > 0:
        resource = simpy.PriorityResource(env, capacity=cfg.servers)
    else:
        resource = simpy.Resource(env, capacity=cfg.servers)
    tracker = _Tracker(cfg.warmup)
    sample_service = _service_sampler(cfg, rng)

    waits: list[float] = []              # queue waits of served customers
    waits_by_class: dict[int, list[float]] = {0: [], 1: []}  # priority class
    system_times: list[float] = []       # arrival -> departure, served only
    n_arrivals = 0
    n_abandoned = 0
    n_arrivals_window = 0                # arrivals at/after warm-up
    series: list[tuple[float, int]] = []

    def customer(arrival_t: float, service_t: float, is_priority: bool,
                 patience_t: float | None):
        nonlocal n_abandoned
        tracker.arrive(env.now)
        if cfg.priority_share > 0:
            req = resource.request(priority=0 if is_priority else 1)
        else:
            req = resource.request()
        if patience_t is None:
            yield req
            abandoned = False
        else:
            result = yield req | env.timeout(patience_t)
            abandoned = req not in result
        if abandoned:
            req.cancel()
            tracker.abandon(env.now)
            if arrival_t >= cfg.warmup:
                n_abandoned += 1
            return
        start_t = env.now
        tracker.start(start_t)
        yield env.timeout(service_t)
        resource.release(req)
        tracker.depart(env.now)
        if arrival_t >= cfg.warmup:
            waits.append(start_t - arrival_t)
            waits_by_class[0 if is_priority else 1].append(start_t - arrival_t)
            system_times.append(env.now - arrival_t)

    def arrivals():
        nonlocal n_arrivals, n_arrivals_window
        if cfg.hourly_rates is not None:
            rates = cfg.hourly_rates
            lam_max = max(rates)
            t = 0.0
            while True:
                t += rng.expovariate(lam_max)
                if t >= cfg.duration:
                    return
                yield env.timeout(t - env.now)
                hour = min(int(env.now // 60), len(rates) - 1)
                if rng.random() > rates[hour] / lam_max:
                    continue  # thinned out
                _spawn()
        else:
            while True:
                yield env.timeout(rng.expovariate(cfg.arrival_rate))
                if env.now >= cfg.duration:
                    return
                _spawn()

    def _spawn():
        nonlocal n_arrivals, n_arrivals_window
        n_arrivals += 1
        if env.now >= cfg.warmup:
            n_arrivals_window += 1
        is_priority = cfg.priority_share > 0 and rng.random() < cfg.priority_share
        patience_t = None
        if cfg.patience_mean is not None:
            patience_t = rng.expovariate(1.0 / cfg.patience_mean)
        env.process(customer(env.now, sample_service(), is_priority, patience_t))

    def monitor():
        while True:
            yield env.timeout(1.0)
            if env.now >= cfg.warmup:
                series.append((env.now, len(resource.queue)))

    env.process(arrivals())
    if cfg.record_series:
        env.process(monitor())
    env.run(until=cfg.duration)
    tracker.close(cfg.duration)

    t_meas = cfg.duration - cfg.warmup
    n_served = len(waits)
    out = {
        "seed": seed,
        "n_arrivals": n_arrivals,
        "n_arrivals_window": n_arrivals_window,
        "n_served": n_served,
        "n_abandoned_window": n_abandoned,
        "abandon_rate": (n_abandoned / n_arrivals_window) if n_arrivals_window else 0.0,
        "mean_wait_q": statistics.fmean(waits) if waits else float("nan"),
        "pct_over_target": (
            sum(1 for w in waits if w > cfg.target_minutes) / n_served
            if n_served else float("nan")),
        "mean_system_time": statistics.fmean(system_times) if system_times else float("nan"),
        "mean_wait_q_priority": (statistics.fmean(waits_by_class[0])
                                 if waits_by_class[0] else float("nan")),
        "mean_wait_q_regular": (statistics.fmean(waits_by_class[1])
                                if waits_by_class[1] else float("nan")),
        "utilisation": tracker.area_busy / (cfg.servers * t_meas),
        "mean_number_system": tracker.area_sys / t_meas,
        "mean_queue_len_series": series,
    }
    # Little's law from this run's own counters: L (time-averaged number in
    # system) against lambda (arrivals per minute in the window) x W (mean
    # time in system of the served customers who arrived in the window).
    if n_arrivals_window and system_times:
        lam_l = n_arrivals_window / t_meas
        out["little_lhs"] = out["mean_number_system"]
        out["little_rhs"] = lam_l * out["mean_system_time"]
        out["little_ratio"] = out["little_lhs"] / out["little_rhs"]
    return out


def _mean_ci(values: list[float], conf: float = 0.95) -> tuple[float, float]:
    """Mean and half-width of a t confidence interval."""
    from scipy import stats as _stats
    n = len(values)
    mean = statistics.fmean(values)
    if n < 2:
        return mean, float("nan")
    half = _stats.t.ppf(0.5 + conf / 2.0, n - 1) * statistics.stdev(values) / math.sqrt(n)
    return mean, half


def run_replications(cfg: QueueConfig, n_reps: int, seed0: int = 1) -> dict:
    """Independent replications with confidence intervals (Law, ch. 9:
    replication/deletion is the standard way to analyse terminating and
    steady-state output; one long run hides the run-to-run spread)."""
    reps = [run_replication(cfg, seed0 + i) for i in range(n_reps)]
    keys = ["mean_wait_q", "pct_over_target", "utilisation", "abandon_rate",
            "mean_number_system", "little_ratio"]
    summary: dict[str, dict] = {}
    for k in keys:
        vals = [r[k] for r in reps if k in r and not math.isnan(r[k])]
        if vals:
            mean, half = _mean_ci(vals)
            summary[k] = {"mean": mean, "ci_half": half, "n": len(vals)}
    return {"config": cfg.__dict__, "n_reps": n_reps, "reps": reps, "summary": summary}


# --------------------------------------------------------------------------
# Deterministic event-by-event checker (no SimPy, no randomness)
# --------------------------------------------------------------------------

@dataclass
class CustomerOutcome:
    index: int
    arrival: float
    wait: float | None        # None when the customer abandoned
    start: float | None
    end: float | None
    abandoned: bool = False


def compute_waits(arrivals: list[float], services: list[float], servers: int,
                  patience: list[float] | None = None,
                  priority: list[int] | None = None) -> list[CustomerOutcome]:
    """Exact waits for fixed arrival/service lists.

    Rules (the same wording the LLM hand-simulation prompt uses):
    - Customers are served by `servers` identical servers, one queue.
    - Without priorities: first-come-first-served. With priorities: a
      waiting priority customer (class 0) is always picked before a
      regular one (class 1); within a class, first-come-first-served.
      Service is never interrupted.
    - A customer whose wait would exceed their patience leaves at
      arrival + patience without being served. If a server frees exactly
      at the deadline, the customer is served (start == deadline is OK).
    """
    n = len(arrivals)
    if len(services) != n:
        raise ValueError("arrivals and services must have the same length")
    prio = priority if priority is not None else [0] * n
    outcomes: dict[int, CustomerOutcome] = {}
    # events: (time, kind, seq, index); kind order at equal times:
    # 0 = server frees, 1 = abandon deadline, 2 = arrival
    events: list[tuple[float, int, int, int]] = []
    seq = 0
    for i in range(n):
        heapq.heappush(events, (arrivals[i], 2, seq, i))
        seq += 1
        if patience is not None:
            heapq.heappush(events, (arrivals[i] + patience[i], 1, seq, i))
            seq += 1
    waiting: list[int] = []       # indices currently in the queue
    free = servers
    state: dict[int, str] = {}    # index -> waiting | serving | done | abandoned

    def try_assign(now: float) -> None:
        nonlocal free, seq
        while free > 0 and waiting:
            best = min(waiting, key=lambda j: (prio[j], arrivals[j], j))
            deadline = (arrivals[best] + patience[best]) if patience is not None else math.inf
            if now > deadline:
                waiting.remove(best)
                state[best] = "abandoned"
                outcomes[best] = CustomerOutcome(best, arrivals[best], None, None, None, True)
                continue
            waiting.remove(best)
            state[best] = "serving"
            free -= 1
            start = now
            end = now + services[best]
            outcomes[best] = CustomerOutcome(best, arrivals[best], start - arrivals[best],
                                             start, end, False)
            heapq.heappush(events, (end, 0, seq, best))
            seq += 1

    while events:
        t, kind, _, i = heapq.heappop(events)
        if kind == 2:      # arrival
            state[i] = "waiting"
            waiting.append(i)
            try_assign(t)
        elif kind == 0:    # server frees
            state[i] = "done"
            free += 1
            try_assign(t)
        else:              # abandon deadline
            if state.get(i) == "waiting":
                waiting.remove(i)
                state[i] = "abandoned"
                outcomes[i] = CustomerOutcome(i, arrivals[i], None, None, None, True)
    return [outcomes[i] for i in range(n)]


def simulate_scripted(arrivals: list[float], services: list[float], servers: int,
                      patience: list[float] | None = None,
                      priority: list[int] | None = None) -> list[CustomerOutcome]:
    """Feed fixed arrival/service/patience lists through the SimPy model.

    Used to check SimPy and `compute_waits` against each other on identical
    input. Patience values here are exact per-customer deadlines, not draws.
    """
    env = simpy.Environment()
    if priority is not None:
        resource = simpy.PriorityResource(env, capacity=servers)
    else:
        resource = simpy.Resource(env, capacity=servers)
    outcomes: dict[int, CustomerOutcome] = {}

    def customer(i: int):
        yield env.timeout(arrivals[i] - env.now)
        if priority is not None:
            req = resource.request(priority=priority[i])
        else:
            req = resource.request()
        if patience is None:
            yield req
            abandoned = False
        else:
            result = yield req | env.timeout(patience[i])
            abandoned = req not in result
        if abandoned:
            req.cancel()
            outcomes[i] = CustomerOutcome(i, arrivals[i], None, None, None, True)
            return
        start = env.now
        yield env.timeout(services[i])
        resource.release(req)
        outcomes[i] = CustomerOutcome(i, arrivals[i], start - arrivals[i],
                                      start, env.now, False)

    for i in range(len(arrivals)):
        env.process(customer(i))
    env.run()
    return [outcomes[i] for i in range(len(arrivals))]
