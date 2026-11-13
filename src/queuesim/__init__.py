"""queuesim: a discrete-event queue simulator checked against the formulas."""
from .erlang import erlang_b, erlang_c, mmc, servers_needed  # noqa: F401
from .simulate import QueueConfig, compute_waits, run_replication, run_replications  # noqa: F401

__version__ = "1.0.0"
