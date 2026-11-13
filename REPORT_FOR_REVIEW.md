# Report for review — P11 queue-simulator

## For Omid (the spec's template)

**Project:** P11 — queue-simulator
**Question:** How many staff does a queue need — and can an LLM work
that out?
**Headline result:** The simulator matches Erlang C on all 12
validation settings; staffing for the average hour fails badly on a
real-shaped day (41% of rush-hour callers wait over 20 s); LLMs
estimate queues passably (9/15 scenarios) but only one model's code
was reliable (14/15).
**Playground:** docs/ (open docs/index.html with any static server)
**Time spent:** ~1 day (background build, 2026-11-13)
**Money spent:** $0.39 of the $5 cap
**Anything surprising:** Asked directly, all three models scored
exactly 9/15 — but on different scenarios' strengths: perfect on
formula questions, weak exactly where the formula breaks. And asked
to simulate by hand, a model that listed a customer usually had the
arithmetic exactly right; the failures were customers never listed.
**Needs from Omid:** repo creation/push approval (GitHub access) —
everything else is done locally.

## 1. What was built

`~/workspace/queue-simulator/` — a SimPy discrete-event queue
simulator (Poisson or time-varying arrivals; exponential, lognormal
or uniform service; caller abandonment; two-class non-preemptive
priority), a JavaScript twin for the playground, and the program's
three-way LLM check. Repo contents per the program standard:
README.md, LICENSE (MIT), CITATION.cff, PLAN.md (frozen,
FREEZE_MANIFEST.txt), DECISIONS.md (14 entries), SPEND.md,
DATA_SOURCES.md, this report, `src/queuesim/` (erlang, simulate,
scenarios, validate, llm, sandbox, score, analyze), `tests/`
(19 tests), `docs/` playground with local screenshots, `results/`
(summary + 5 figures), `outputs/` (all raw runs, study cache, price
snapshot), `.github/workflows/ci.yml` (tests + smoke, no API calls).

Headline numbers: Erlang C fell inside the simulation's 95% CI in
12/12 M/M/c settings; Little's law held within 0.2%. Beyond the
formula: lognormal service (CV 2) doubles the wait (2.05 vs 1.07
min); abandonment at ρ = 0.95 cuts the served wait from 26.9 to
1.3 min with 14.7% hanging up; on an NYC-311-shaped day, the
mean-rate staffing answer (8 agents) leaves 41.4% of callers over
20 s and day-average waits of 2.92 min against the formula's
0.28 min at the average rate. Arrival study (NYC 311, Jan 2024):
peak hour 5.53× the trough; 80/20 staffing ranges 3–11 agents across
the day against 8 at the mean. LLM check: Direct 9/15 for all three
models; Code 14/15 (gpt-oss-120b), 7/15 (MiniMax), 2/15 (GLM);
Hand tracked 58%/50%/45% of customers; B4's "no steady state"
recognised in 5 of 6 numeric runs.

## 2. Deviations from the spec, and judgment calls

All 14 are in DECISIONS.md; the material ones:

- **Arrival data (spec decision rule applied):** first choice
  (Technion SEE Lab bank data) is registration-gated with no public
  direct download, so per the rule's ordering I used the spec-listed
  public set that works: NYC 311 hourly counts (dataset erm2-nwe9,
  Jan 2024), shape only, scaled to 60 calls/hour.
- **Scenario split:** the assignment described 5 formula / 5 beyond /
  5 traps; the spec text says 10 Erlang-applicable + 5 beyond. Built
  5 plain formula + 5 traps (Erlang C applies if handled correctly)
  + 5 beyond — satisfying both readings (DECISIONS #1).
- **Priority classes** were added as a fourth beyond-formula case
  (the assignment named them; the spec's §5 lists three) — the
  beyond set is variable service, abandonment, time-varying arrivals,
  overload (the ρ ≥ 1 trap), and priority.
- **Model selection:** spec rule dropped Tev1-4B (code failed 5/5 in
  the pilot). Qwen3.5-9B was not carried forward — its Direct answers
  ignored the required format in 4/5 pilot scenarios (its code ran
  fine; reported in PLAN.md). No model met the draft hand-format
  bar, so it became report-only. Chosen: gpt-oss-120b,
  GLM-5.3-Flash, MiniMax-M3.1-Flash (DECISIONS #14).
- **Hand instances** use a seeded busy-window rule (first 20-customer
  window whose standalone simulation has ≥5 waiting/abandoning
  customers), after the raw first-20 windows produced several
  no-wait instances that test nothing (DECISIONS #13).
- Temperature 0.7 for all LLM calls (program consistency with P01;
  the spec doesn't fix it) — DECISIONS #8.
- One post-freeze amendment, logged in PLAN.md: a presentation fix
  in the summary table's Hand-mode column. Manifest re-issued; no
  scoring, prompts, thresholds or ground truth changed.

## 3. Spend

Total ≈ **$0.39** of the $5 cap (SPEND.md): probes < $0.01 (est.),
pilot $0.1444 (90 calls), main run $0.2342 (135 calls). By model:
MiniMax $0.1154, GLM $0.1018, gpt-oss-120b $0.0895, DeepSeek $0.0567
(pilot only), Qwen $0.0151 (pilot only), Tev1-4B $0.0002 (pilot
only). Simulation compute was local; NYC Open Data is free.

## 4. Tests, CI, reproducibility

- `tests/test_queuesim.py`: 19 tests — Erlang C against the raw-sum
  formula and M/M/1 known values, servers_needed brute-forced,
  deterministic checker on hand-worked examples, checker ≡ SimPy on
  identical fixed input (FIFO, abandonment, priority), simulator vs
  Erlang C inside CIs on 3 settings, Little's law within 2%.
- JS↔Python: `scripts/check_js.py` — all 3 fixed cases agree exactly
  (2 hand instances + 1 Erlang case); results in
  `docs/data/check_cases.json`. The browser LiveSim was additionally
  driven headlessly for 100,000 simulated minutes and matches Erlang
  C (mean wait 1.14 vs 1.07 min; utilisation 0.628 vs 0.625).
- CI workflow (`.github/workflows/ci.yml`): pytest + CLI smoke test,
  no API calls. Not yet run on GitHub (repo is local-only).
- REPRODUCE: verified from a fresh clone (2026-11-13): new venv,
  `pip install -r requirements.txt`, 19/19 tests pass, and the
  analyze step regenerates `results/summary.md` byte-identical to
  the committed one (modulo its Generated timestamp) with all 5
  figures and the same $0.3786 spend total.

## 5. Known issues and uncertainties

- The committed screenshots catch the browser's live-simulation
  panel at its first frame (headless virtual-time capture), so its
  running averages show as dashes; the panel animates in a real
  browser and the underlying JS simulator is verified as above.
  Chart.js loads from a CDN with a hand-drawn fallback (the
  screenshots show the fallback); offline, the fallback is what
  readers get.
- B4's simulation "truth" (mean wait ≈ 49.9 min) is a finite-horizon
  day average for a queue with no steady state — labelled as such
  everywhere it appears; the scored question is the steady-state
  recognition.
- GLM's code-mode answers ran but were usually close on only one of
  the two numbers asked (median errors near zero, few scenarios with
  both close) — the per-question detail is in
  `outputs/llm_scores.json`; I did not dig into which of its programs
  went wrong where.
- The (c = 1, ρ = 0.95) validation point differs from Erlang C by
  −11.8% (inside a wide CI): near-saturated single-server queues are
  intrinsically slow to converge at 16 replications; reported, not
  hidden.
- gpt-oss-120b and MiniMax are slow (up to ~3.5 min for one call);
  nothing in the results depends on latency.
- NYC 311 requests are not calls to one centre; only the day's shape
  is used, and every write-up says so.

## 6. Playground screenshots

- `docs/screenshots/desktop.png` (1280 px)
- `docs/screenshots/phone.png` (375 px, no horizontal scroll)

## 7. Draft LinkedIn post (not posted)

I wanted to learn queueing properly, so I built a call-centre
simulator and checked it the way textbooks insist: against the
Erlang C formula on 12 settings (it agrees), and against Little's
law in its own counters (within 0.2%).

Then I used it where the formula can't go. Staffing for the
*average* hour, on a day shaped like real NYC 311 arrivals, leaves
41% of rush-hour callers waiting over 20 seconds. Impatient callers
change the answer completely — the formula can't see them at all.

I also gave 15 queue scenarios to three LLMs: estimate directly,
write code, or simulate 20 customers by hand. Direct: 9/15 each.
Code: one model hit 14/15. By hand they tracked about half the
customers before drifting.

Link in comments when live. #OperationsResearch #Simulation #Python

(118 words, 3 hashtags — within the program's limits.)

## 8. Before anything goes public — Omid's checklist

- [ ] Read the README's result paragraph against `results/summary.md`.
- [ ] Check the LinkedIn draft (above) — edit or drop it.
- [ ] Decide the repository name (`queue-simulator` suggested) and
      create/approve it so the push can happen — **GitHub repo
      creation and push are pending your repository-access
      selection; nothing has been pushed or posted.**
- [ ] Set the playground link in README/docs once hosted (the docs
      footer currently says the link goes there when published).
- [ ] Confirm you are happy with the "inspired by the textbooks"
      framing: Law (2024) and Hillier & Lieberman ch. 17 are the
      named sources; no professor's work is referenced.
