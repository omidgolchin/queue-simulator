# Plan — P11 queue-simulator

Written and frozen before the LLM-check main run (see
`FREEZE_MANIFEST.txt`). Pilots before the freeze were used only for
model selection, the decision the spec names. Post-freeze changes go
in the amendment log at the bottom, with "Outputs seen? Yes/No".

## The question

How many servers keep waits acceptable in a simple service queue —
and can an LLM work that out? The project builds a discrete-event
simulator, checks it against the textbook formulas it should reproduce,
uses it where the formulas stop working, and then tests LLMs on the
same questions three ways: direct estimation, writing code, and
simulating a queue by hand, event by event.

## Design

**Simulator** (`src/queuesim/simulate.py`, SimPy 4.1.2). One queue,
c identical servers; Poisson or hour-by-hour time-varying arrivals;
exponential / lognormal / uniform service; optional exponential
patience (abandonment); optional two-class non-preemptive priority.
Statistics come from independent replications with a warm-up period
and t confidence intervals (Law, ch. 9, output analysis) — never one
long run. Every replication also reports L, λ and W from its own
counters so Little's law can be checked run by run.

**Validation.** 12 M/M/c settings (c = 1..10, ρ = 0.5..0.95, listed
in `validate.py`), 16 replications each: simulated mean wait against
Erlang C, plus P(wait > 20 s) and the Little ratio. Pre-specified
reading: the simulator is validated if the Erlang value lies inside
the 95% CI in at least 10 of 12 settings and the Little ratio is
within 2% on average.

**Beyond the formulas.** (a) Service variability: exponential vs
uniform (CV 0.5) vs lognormal (CV 2) at identical means. (b)
Abandonment at ρ = 0.95: patience ∞ / 10 / 4 min. (c) A day shaped
like the NYC 311 hourly profile vs the same day flattened, staffed at
the average hour's 80/20 answer. (d) Priority classes (scenario B5's
ground truth). 40 replications per contrast case.

**Arrival data.** Decision rule from the spec, in order: Technion
SEE Lab bank data (checked — registration-gated, no public download;
DECISIONS.md #3), then NYC 311 hourly counts (used; January 2024,
shape only, scaled to 60 calls/hour average), then synthetic. Terms
and provenance in `DATA_SOURCES.md`.

**Staffing tool / playground.** Erlang C staffing for "80% answered
within 20 seconds"; wait-vs-servers curves precomputed in Python
(20 replications per point) for three presets; a JavaScript twin of
the simulator and formulas runs the live animation, checked against
Python on three fixed cases (`scripts/check_js.py`).

**LLM check.** 15 scenarios (`src/queuesim/scenarios.py`):
F1–F5 plain formula, T1–T5 formula-with-trap (unit slips, a hidden
arrival rate, near-saturation, a seconds-vs-minutes target), B1–B5
beyond-formula (lognormal service, abandonment, rush hours, ρ > 1,
priority classes). Three modes per scenario:
- *Direct*: estimate the quantities from the description.
- *Code*: write a Python program (sandboxed: subprocess, no network,
  60 s) whose printed lines are the answer.
- *Hand simulation*: 20 customers with explicit arrival/service
  times; report each customer's wait, event by event.
Ground truth: Erlang C for F/T; 200 SimPy replications for B
(B4's truth is the label "no steady state"). Verdict thresholds,
fixed here before the main run: mean-wait answers "close" at
≤ 25% relative error (against max(truth, 0.05) min); percentages
"close" within 10 points; hand-simulated customers "tracked" at
≤ 0.11 min absolute error. Raw errors are always reported.
Temperature 0.7, per-call seeds, full raw text and usage recorded;
runs resumable by (model, scenario, mode).

**Model selection rule (from the spec).** 2–3 models from different
families; drop any whose code fails to run in more than half of 5
pilot scenarios; among the rest prefer the cheapest that answer in
format (Direct answers parse on ≥ 4 of 5 pilot scenarios; Hand
answers parse for ≥ 16 of 20 customers on ≥ 4 of 5). Pilot: scenarios
F2, F4, T1, B1, B4 × all 3 modes × 6 candidate models.

### Pilot results (filled in before the freeze)

Pilot: scenarios F2, F4, T1, B1, B4 × Direct/Code/Hand × 6 models =
90 calls, $0.1444 total, no API errors. "Code failed" counts sandbox
runs that errored or timed out. "Direct parsed" counts answers that
followed the required output lines. The pilot ran before the
hand-instance windowing rule (DECISIONS.md #13) was finalised, so
pilot Hand rows used the earlier instances; Hand is used here only
for format compliance (could the model produce 20 parseable lines at
all), which does not depend on the instance.

| model | code failed /5 | direct parsed /5 (close) | hand ≥16/20 lines in /5 | pilot cost |
|---|---|---|---|---|
| together/Tev1-4B-experimental | 5 | 5 (0) | 0 | $0.0002 |
| openai/gpt-oss-120b | 1 | 5 (4) | 3 | $0.0196 |
| Qwen/Qwen3.5-9B | 0 | 1 (1) | 0 | $0.0151 |
| zai-org/GLM-5.3-Flash | 0 | 4 (4) | 2 | $0.0248 |
| MiniMaxAI/MiniMax-M3.1-Flash | 0 | 4 (4) | 2 | $0.0281 |
| deepseek-ai/DeepSeek-V4.1-Flash | 0 | 4 (4) | 3 | $0.0567 |

Selection (DECISIONS.md #14): Tev1-4B dropped by the spec's rule
(code failed in more than half the pilot scenarios). Qwen3.5-9B not
carried forward: its Direct answers ignored the required format in
4 of 5 scenarios. No model met the hand-format bar (≥16/20 lines in
≥4/5 scenarios), so that bar is report-only, not a gate.

**Models chosen for the main run:** openai/gpt-oss-120b,
zai-org/GLM-5.3-Flash, MiniMaxAI/MiniMax-M3.1-Flash (three families).

Projected main-run cost from pilot usage: ≈ $0.22 for 135 calls
(3 models × 15 scenarios × 3 modes), against the $5 cap. The pilot
itself is reported in `SPEND.md`.

## Related work and what is different

Online Erlang C calculators are common (for example the ones bundled
with call-centre staffing sites); they return the formula's numbers
and nothing else — no simulation, no check of the formula's
assumptions, no uncertainty. Textbook and SimPy documentation
examples build small queue models but do not validate them against
the formulas with replication confidence intervals, and do not test
LLMs against them. LLM benchmarks test arithmetic and code
generation, but a queue is a state-tracking problem: the
hand-simulation mode here is, in effect, a small benchmark of whether
a model can maintain evolving state over 20 events, scored exactly.
This repo's contribution is the combination, in learner framing:
simulator + validation + staffing tool + the three-way LLM check on
identical scenarios.

## References (verified 2026-11-13)

1. Law, A. M. *Simulation Modeling and Analysis*, 6th edition,
   McGraw-Hill Education, 2024. ISBN 9781264268245. (Output analysis:
   replication and warm-up — the basis for this project's statistics.)
   https://www.mheducation.com/highered/product/simulation-modeling-analysis-law.html
2. Hillier, F. S., Lieberman, G. J., Nag, B., Basu, P.
   *Introduction to Operations Research*, 12th edition (2024 release),
   McGraw Hill. Chapter 17, Queueing Theory (M/M/s model in §17.6;
   priority-discipline models in §17.8).
   https://www.mheducation.com/highered/product/introduction-operations-research-hillier.html
3. Little, J. D. C. (1961). "A Proof for the Queuing Formula:
   L = λW." *Operations Research* 9(3), 383–387.
   https://doi.org/10.1287/opre.9.3.383
4. SimPy documentation (version 4.1.2). Process-based discrete-event
   simulation framework, MIT License.
   https://simpy.readthedocs.io/en/latest/
5. NYC Open Data, "311 Service Requests from 2010 to Present"
   (dataset erm2-nwe9) and NYC Open Data Terms of Use.
   https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9
6. Technion SEE Lab (Service Enterprise Engineering), data access
   via the SEEServer (checked, not used — DECISIONS.md #3).
   https://seelab.net.technion.ac.il/

## Amendment log

| date | change | outputs seen? |
|---|---|---|
| 2026-11-13 | analyze.py: the summary's LLM table now prints "–" instead of a misleading 0/15 in the "scenarios close" column for Hand mode (hand runs are scored per customer, never per scenario). Presentation only; no scoring code, threshold, prompt or ground truth changed. Manifest re-issued. | Partially — the main run was in progress; no scored results had been computed. |
