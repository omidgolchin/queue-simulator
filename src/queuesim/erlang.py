"""Erlang C formulas for the M/M/c queue.

All rates are per minute internally unless a function says otherwise.
The formulas follow Hillier & Lieberman, *Introduction to Operations
Research*, ch. 17 (the M/M/s model), and are the textbook steady-state
results for Poisson arrivals, exponential service, c servers, one queue,
first-come-first-served, no abandonment, unlimited waiting room.

Definitions:
    a   = lambda / mu          offered load (erlangs)
    rho = a / c                utilisation; steady state needs rho < 1
    C(c, a)                    Erlang C: probability an arrival must wait
    E[Wq] = C / (c*mu - lambda)          mean wait in queue
    P(Wq > t) = C * exp(-(c*mu - lambda) * t)
    Lq = lambda * E[Wq]                  (Little's law applied to the queue)
"""
from __future__ import annotations

import math
from dataclasses import dataclass


def erlang_b(c: int, a: float) -> float:
    """Erlang B (blocking probability) by the stable recursion."""
    if c < 0:
        raise ValueError("c must be >= 0")
    b = 1.0
    for k in range(1, c + 1):
        b = (a * b) / (k + a * b)
    return b


def erlang_c(c: int, a: float) -> float:
    """Erlang C: probability that an arrival finds all servers busy.

    Uses the identity C = B / (1 - rho * (1 - B)) with B the Erlang B
    value, which is numerically stable for the sizes used here.
    Raises ValueError when the system is unstable (a >= c).
    """
    if c < 1:
        raise ValueError("c must be >= 1")
    if a >= c:
        raise ValueError("unstable: offered load a must be < number of servers c")
    rho = a / c
    b = erlang_b(c, a)
    return b / (1.0 - rho * (1.0 - b))


@dataclass(frozen=True)
class MMcResult:
    servers: int
    lam: float            # arrivals per minute
    mu: float             # services per minute per server
    offered_load: float   # a = lam / mu
    rho: float            # utilisation
    p_wait: float         # Erlang C
    mean_wait_q: float    # minutes in queue
    mean_time_system: float  # minutes, queue + service
    mean_queue_len: float    # Lq
    mean_number_system: float  # L

    def p_wait_over(self, t_minutes: float) -> float:
        """P(Wq > t) for the M/M/c queue."""
        return self.p_wait * math.exp(-(self.servers * self.mu - self.lam) * t_minutes)

    def service_level(self, t_minutes: float) -> float:
        """Share of arrivals whose wait is at most t (the '80/20' number)."""
        return 1.0 - self.p_wait_over(t_minutes)


def mmc(lam: float, mu: float, c: int) -> MMcResult:
    """Steady-state M/M/c results. lam and mu are per-minute rates."""
    if lam <= 0 or mu <= 0:
        raise ValueError("rates must be positive")
    a = lam / mu
    if a >= c:
        raise ValueError("unstable: lambda/mu must be < c")
    pw = erlang_c(c, a)
    wq = pw / (c * mu - lam)
    w = wq + 1.0 / mu
    return MMcResult(
        servers=c,
        lam=lam,
        mu=mu,
        offered_load=a,
        rho=a / c,
        p_wait=pw,
        mean_wait_q=wq,
        mean_time_system=w,
        mean_queue_len=lam * wq,
        mean_number_system=lam * w,
    )


def servers_needed(lam: float, mu: float, target_t_minutes: float,
                   target_level: float = 0.80, max_c: int = 500) -> int:
    """Smallest c whose service level at target_t reaches target_level.

    This is the classic '80% within 20 seconds' staffing question.
    Starts the search just above the offered load.
    """
    a = lam / mu
    c = int(math.floor(a)) + 1
    while c <= max_c:
        if mmc(lam, mu, c).service_level(target_t_minutes) >= target_level:
            return c
        c += 1
    raise ValueError("no server count up to max_c reaches the target")
