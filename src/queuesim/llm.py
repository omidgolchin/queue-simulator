"""Run the LLM check on Together AI (OpenAI-compatible).

Design rules, shared with the other projects in this portfolio:

* The API key comes from the environment variable TOGETHER_API_KEY (a
  git-ignored local .env file is allowed). Inside Muse, a credential
  surrogate for the connected Together account is used instead: the
  surrogate is not the real key; Muse's egress layer swaps in the real
  key for api.together.xyz. The key is never printed or logged.
* Runs are resumable: a run's ID is (model, scenario_id, mode); IDs
  already in the output file are skipped.
* Every call records the model ID returned, the seed, the temperature,
  the finish reason, token usage, latency, and the full raw text.
* Code-mode answers are executed in the sandbox at run time and the
  outcome (ok / stdout / stderr tail) is stored in the run row.
* --dry-run writes placeholder rows to outputs/dry_run.jsonl only. A
  real run refuses to start if the real output file holds placeholders.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import zlib
from pathlib import Path

BASE_URL = "https://api.together.xyz/v1"
ROOT = Path(__file__).resolve().parents[2]
PROMPTS = ROOT / "prompts"

TEMPERATURE = 0.7
MAX_TOKENS = 4000
SEED_BASE = 20261113

_FORMAT_HINTS = {
    "MEAN_WAIT_MIN": "MEAN_WAIT_MIN: <average wait in minutes, a number; "
                     "or the word none if no steady-state average exists>",
    "PCT_OVER_20S": "PCT_OVER_20S: <percentage 0-100, a number>",
    "ABANDON_PCT": "ABANDON_PCT: <percentage 0-100, a number>",
    "STEADY_STATE": "STEADY_STATE: <yes or no>",
    "PRIORITY_MEAN_WAIT_MIN": "PRIORITY_MEAN_WAIT_MIN: <average wait in minutes, a number>",
    "REGULAR_MEAN_WAIT_MIN": "REGULAR_MEAN_WAIT_MIN: <average wait in minutes, a number>",
}


def _surrogate_key() -> str | None:
    import sys

    bin_dir = "/opt/muse/skills/custom-connector-setup/bin"
    try:
        if bin_dir not in sys.path:
            sys.path.insert(0, bin_dir)
        from dynamic_credentials import dynamic_credential_entry

        entry = dynamic_credential_entry("custom.together", "access_token")
        return str(entry["surrogate"])
    except Exception:
        return None


def get_client():
    from dotenv import load_dotenv
    from openai import OpenAI

    for var in ("NO_PROXY", "no_proxy"):
        raw = os.environ.get(var)
        if raw and "[" in raw:
            kept = [p for p in raw.split(",") if "[" not in p and p.strip()]
            os.environ[var] = ",".join(kept) or "localhost"

    load_dotenv(ROOT / ".env")
    key = os.environ.get("TOGETHER_API_KEY") or _surrogate_key()
    if not key:
        raise RuntimeError(
            "TOGETHER_API_KEY is not set and no connected Together account "
            "was found."
        )
    return OpenAI(api_key=key, base_url=BASE_URL)


def _questions_block(scenario) -> str:
    return "\n".join(f"- {q.label}." for q in scenario.questions)


def _format_block(scenario) -> str:
    return "\n".join(_FORMAT_HINTS[q.key] for q in scenario.questions)


def render_prompt(mode: str, scenario) -> str:
    from .scenarios import make_hand_instance

    template = (PROMPTS / f"{mode}.md").read_text()
    if mode in ("direct", "code"):
        return template.format(
            description=scenario.description,
            questions_block=_questions_block(scenario),
            format_block=_format_block(scenario),
        )
    # hand mode
    inst = make_hand_instance(scenario)
    rules = []
    if inst.priority is not None:
        rules.append(
            "- Priority rule: whenever a server frees up, a waiting "
            "PRIORITY customer is served before any waiting REGULAR "
            "customer; within each class, first-come-first-served. "
            "Service is never interrupted once it has started.")
    else:
        rules.append(
            "- Customers are served first-come-first-served: whenever a "
            "server frees up, the customer who has been waiting longest "
            "goes next.")
    if inst.patience is not None:
        rules.append(
            "- Each customer has a patience limit. If their service has "
            "not started by (arrival time + patience), they leave at that "
            "moment and are never served. If a server frees exactly at "
            "the deadline, the customer is served.")
    header = ["Customer | Arrival (min) | Service (min)"]
    if inst.patience is not None:
        header[0] += " | Patience (min)"
    if inst.priority is not None:
        header[0] += " | Class"
    lines = [" | ".join(header)]
    for i in range(len(inst.arrivals)):
        row = [str(i + 1), f"{inst.arrivals[i]:.2f}", f"{inst.services[i]:.2f}"]
        if inst.patience is not None:
            row.append(f"{inst.patience[i]:.2f}")
        if inst.priority is not None:
            row.append("PRIORITY" if inst.priority[i] == 0 else "REGULAR")
        lines.append(" | ".join(row))
    return template.format(
        servers=scenario.servers,
        rules_block="\n".join(rules),
        table="\n".join(lines),
    )


def _run_id(model: str, scenario_id: str, mode: str) -> str:
    return f"{model}|{scenario_id}|{mode}"


def _existing_ids(path: Path) -> set[str]:
    ids: set[str] = set()
    if path.exists():
        with path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                if row.get("dry_run"):
                    raise RuntimeError(
                        f"{path} contains dry-run placeholder rows. Move "
                        "or delete it before starting a real run."
                    )
                ids.add(row["run_id"])
    return ids


def _one_call(client, model: str, prompt: str, seed: int) -> dict:
    started = time.time()
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                seed=seed,
                temperature=TEMPERATURE,
                max_tokens=MAX_TOKENS,
            )
            choice = resp.choices[0]
            usage = resp.usage
            return {
                "status": "ok",
                "model_returned": resp.model,
                "text": choice.message.content or "",
                "finish_reason": choice.finish_reason,
                "prompt_tokens": usage.prompt_tokens if usage else None,
                "completion_tokens": usage.completion_tokens if usage else None,
                "latency_s": round(time.time() - started, 3),
                "attempts": attempt + 1,
            }
        except Exception as exc:  # noqa: BLE001 - record and retry any API error
            last_error = exc
            time.sleep(2 ** attempt)
    return {
        "status": "error",
        "model_returned": None,
        "text": "",
        "finish_reason": None,
        "prompt_tokens": None,
        "completion_tokens": None,
        "latency_s": round(time.time() - started, 3),
        "attempts": 3,
        "error": f"{type(last_error).__name__}: {last_error}",
    }


def extract_code(text: str) -> str:
    """Strip markdown fences if the model added them anyway."""
    t = text.strip()
    if "```" in t:
        parts = t.split("```")
        for p in parts:
            if "import" in p or "print" in p:
                code = p
                if code.startswith("python"):
                    code = code[len("python"):]
                return code.strip()
    return t


def run_batch(models: list[str], scenario_ids: list[str], modes: list[str],
              out_path: Path, dry_run: bool = False) -> list[dict]:
    from .sandbox import run_code
    from .scenarios import BY_ID

    client = None if dry_run else get_client()
    done = set() if dry_run else _existing_ids(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    written: list[dict] = []
    with out_path.open("a") as f:
        for model in models:
            for scenario_id in scenario_ids:
                for mode in modes:
                    rid = _run_id(model, scenario_id, mode)
                    if rid in done:
                        continue
                    scenario = BY_ID[scenario_id]
                    prompt = render_prompt(mode, scenario)
                    seed = SEED_BASE + zlib.crc32(rid.encode()) % 100_000
                    if dry_run:
                        row = {
                            "run_id": rid, "dry_run": True, "status": "dry_run",
                            "model_requested": model, "scenario_id": scenario_id,
                            "mode": mode, "seed": seed,
                            "temperature": TEMPERATURE, "text": "<placeholder>",
                            "model_returned": None, "finish_reason": None,
                            "prompt_tokens": None, "completion_tokens": None,
                            "latency_s": 0.0,
                        }
                    else:
                        result = _one_call(client, model, prompt, seed)
                        row = {
                            "run_id": rid, "status": result["status"],
                            "model_requested": model, "scenario_id": scenario_id,
                            "mode": mode, "seed": seed,
                            "temperature": TEMPERATURE,
                            "text": result["text"],
                            "model_returned": result["model_returned"],
                            "finish_reason": result["finish_reason"],
                            "prompt_tokens": result["prompt_tokens"],
                            "completion_tokens": result["completion_tokens"],
                            "latency_s": result["latency_s"],
                            "attempts": result["attempts"],
                        }
                        if result["status"] == "error":
                            row["error"] = result["error"]
                        if mode == "code" and result["status"] == "ok":
                            sb = run_code(extract_code(result["text"]))
                            row["code_ok"] = sb["ok"]
                            row["code_stdout"] = sb["stdout"]
                            row["code_stderr_tail"] = sb["stderr"][-500:]
                    f.write(json.dumps(row) + "\n")
                    f.flush()
                    written.append(row)
    return written


def main() -> None:
    ap = argparse.ArgumentParser(description="Run the LLM queue check.")
    ap.add_argument("--models", nargs="+", required=True)
    ap.add_argument("--scenarios", nargs="+", required=True)
    ap.add_argument("--modes", nargs="+", default=["direct", "code", "hand"])
    ap.add_argument("--out", default=str(ROOT / "outputs" / "llm_runs.jsonl"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    if args.dry_run:
        out = ROOT / "outputs" / "dry_run.jsonl"
    rows = run_batch(args.models, args.scenarios, args.modes, out,
                     dry_run=args.dry_run)
    print(f"wrote {len(rows)} rows to {out}")


if __name__ == "__main__":
    main()
