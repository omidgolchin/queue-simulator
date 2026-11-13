"""Run model-written Python in a subprocess sandbox.

Guards: a fresh temporary working directory inside the project's
outputs folder, a scrubbed environment (no API keys), a 60-second
timeout, and `unshare -n` network isolation when available. This is a
convenience sandbox for generated statistics code, not a security
boundary against a determined adversary; the generated code is also
read by a human before anything is published.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TMP_PARENT = ROOT / "outputs" / "sandbox_tmp"


def run_code(code: str, timeout: int = 60) -> dict:
    """Execute `code`; return {ok, stdout, stderr, returncode}."""
    TMP_PARENT.mkdir(parents=True, exist_ok=True)
    tmpdir = tempfile.mkdtemp(prefix="qsandbox-", dir=TMP_PARENT)
    script = os.path.join(tmpdir, "solution.py")
    with open(script, "w") as f:
        f.write(code)
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": tmpdir,
        "PYTHONNOUSERSITE": "1",
        "MPLBACKEND": "Agg",
    }
    cmd = [sys.executable, script]
    if shutil.which("unshare"):
        cmd = ["unshare", "-n", sys.executable, script]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            cwd=tmpdir, env=env,
        )
        return {
            "ok": proc.returncode == 0,
            "stdout": proc.stdout[-4000:],
            "stderr": proc.stderr[-2000:],
            "returncode": proc.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "stdout": "", "stderr": "timeout",
                "returncode": None}
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
