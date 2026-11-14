"""Staffing decisions (reference for docs/staffing.js).

* Erlang C per interval with a staffing search: the fewest agents whose
  service level meets the target (Gans, Koole & Mandelbaum, "Telephone
  call centers: tutorial, review, and research prospects", M&SOM 2003).
* An occupancy cap: agents are added until occupancy (offered load /
  agents) is at or below the cap, because sustained occupancy above about
  90% raises handle times and attrition.
* Shrinkage: people to schedule = ceil(agents / (1 - shrinkage)).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .erlang import mmc


@dataclass
class Staffing:
    agents: int
    agents_for_service: int
    binding: str            # "service" or "occupancy"
    service_level: float
    asa_minutes: float
    occupancy: float


def staff_erlang(lam: float, aht: float, target_minutes: float, level: float,
                 occ_cap: float) -> Staffing:
    """lam calls per minute, aht minutes."""
    a = lam * aht
    c = max(1, math.floor(a) + 1)
    while mmc(lam, 1 / aht, c).service_level(target_minutes) < level:
        c += 1
    c_service = c
    while a / c > occ_cap:
        c += 1
    r = mmc(lam, 1 / aht, c)
    return Staffing(c, c_service, "occupancy" if c > c_service else "service",
                    r.service_level(target_minutes), r.mean_wait_q, a / c)


def scheduled(agents: int, shrinkage: float) -> int:
    return math.ceil(agents / (1 - shrinkage) - 1e-9)


def day_plan(calls: list[float], interval_minutes: float, aht: float,
             target_minutes: float, level: float, occ_cap: float,
             shrinkage: float, min_agents: int = 1) -> dict:
    rows = []
    for n in calls:
        if n <= 0:
            rows.append({"calls": 0, "agents": min_agents,
                         "scheduled": scheduled(min_agents, shrinkage), "sl": 1.0})
            continue
        s = staff_erlang(n / interval_minutes, aht, target_minutes, level, occ_cap)
        c = max(min_agents, s.agents)
        sl = mmc(n / interval_minutes, 1 / aht, c).service_level(target_minutes)
        rows.append({"calls": n, "agents": c, "scheduled": scheduled(c, shrinkage), "sl": sl})
    h = interval_minutes / 60
    total = sum(r["calls"] for r in rows)
    return {
        "rows": rows,
        "agent_hours": sum(r["agents"] for r in rows) * h,
        "paid_hours": sum(r["scheduled"] for r in rows) * h,
        "day_sl": (sum(r["calls"] * r["sl"] for r in rows) / total) if total else 1.0,
    }
