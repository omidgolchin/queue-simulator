# Spend — queue-simulator (P11)

Cap: **$5.00** (project). All figures USD, computed from the usage
the API returned per call and the list prices in
`outputs/model_prices.json` (snapshot taken 2026-11-13; output tokens
for `together/Tev1-4B-experimental` are listed at $0 and costed as
such). Generated from `outputs/pilot_runs.jsonl` and
`outputs/llm_runs.jsonl` by `queuesim.analyze`.

## Model calls

| run | calls | cost | notes |
|---|---:|---:|---|
| availability probes | 21 | < $0.01 (est.) | one-word prompts to check which catalogue models answer serverless; the probe helper does not retain usage, so this is an upper-bound estimate |
| pilot | 90 | $0.1444 | 6 models × 5 scenarios × 3 modes |
| main run | 135 | $0.2342 | 3 models × 15 scenarios × 3 modes |
| **total** | | **≈ $0.39** | of the $5.00 cap |

By model (pilot + main): openai/gpt-oss-120b $0.0895;
zai-org/GLM-5.3-Flash $0.1018; MiniMaxAI/MiniMax-M3.1-Flash $0.1154;
deepseek-ai/DeepSeek-V4.1-Flash $0.0567 (pilot only);
Qwen/Qwen3.5-9B $0.0151 (pilot only);
together/Tev1-4B-experimental $0.0002 (pilot only).

## Free tiers / other

- NYC Open Data (Socrata): free public API, no key, no cost.
- GitHub Actions (CI): not used yet — the repository is local-only
  (hosting pending). The CI workflow makes no API calls.
- No other paid services. All simulation ran locally.
