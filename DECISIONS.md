# Decisions

Choices the spec left open, settled by its decision rules or by the
more conservative option, with reasons. (Program rule: no human
checkpoints; log and continue.)

1. **Scenario split.** The spec's LLM check has 15 scenarios — "10 where
   Erlang C applies, 5 where it doesn't" — while the build brief grouped
   them 5/5/5 with traps. Built as: 5 plain formula (F1–F5), 5 traps
   where Erlang C still applies after a unit conversion, a derived
   arrival rate, or care near saturation (T1–T5), and 5 beyond-formula
   (B1–B5), with the ρ ≥ 1 trap inside B4. F+T = the spec's 10; the
   brief's three groups are all represented.

2. **A fourth beyond-formula case.** The spec names three cases the
   formulas cannot handle (non-exponential service, abandonment,
   time-varying arrivals); the build brief also named priority classes.
   All four are built: the three as simulation studies, priority as
   scenario B5 plus per-class wait statistics in the simulator. The
   README's "one queue, no priorities" limitation refers to the
   staffing tool's scope, not to this demonstration.

3. **Arrival data.** The spec's decision rule, followed in order:
   (1) Technion SEE Lab bank call-centre data — checked 2026-11-13:
   access is through the SEEServer, free for academic use but only
   after personal registration, and there is no public direct download
   of the timestamped data; third-party mirrors have unclear
   redistribution terms. Not used. (2) NYC 311 hourly call counts —
   used: service requests created in January 2024, aggregated by hour
   of day through the NYC Open Data API (public, no key). Only the
   *shape* of the day is used (hourly counts scaled to a centre
   averaging 60 calls/hour); 311 requests are not calls to one centre,
   and the write-up says so.

4. **Time unit.** Minutes inside all code; hours only at the
   description boundary. The LLM scenarios state their units in words,
   which is where the traps live.

5. **Hand-simulation instances.** 20 customers per scenario, generated
   with a per-scenario seed from the scenario's own distributions and
   rounded to 2 decimals; the checker scores exactly the numbers the
   model was shown. B5's instance has exactly 4 priority customers
   (20%). For B3 the instance's arrivals come from the day profile, so
   the hand task stays a pure state-tracking exercise.

6. **Ground truth for B4.** Offered load 5 erlangs on 4 servers has no
   steady state, so there is no number to be "close" to. Truth is the
   label "no steady state"; a Direct/Code answer scores only when it
   says so (Code must print STEADY_STATE: no). The 200-replication
   finite-day numbers are reported as documentation of what actually
   happens, never as the target.

7. **Verdict thresholds** (pre-specified before the main run, in
   PLAN.md): a mean-wait answer is "close" at ≤ 25% relative error
   (against max(truth, 0.05) min); a percentage answer is "close"
   within 10 points; a hand-simulated customer is "tracked" at
   ≤ 0.11 min absolute error. Raw errors are always reported too.

8. **Temperature 0.7** for all LLM calls, matching the sibling
   projects (P01/P14), with per-call seeds recorded. This is a test of
   typical use, not of best-case decoding.

9. **Model pool for the pilot.** Six candidates from six families,
   cheapest first within family, all confirmed reachable through the
   Together serverless API on 2026-11-13 with a one-word probe:
   together/Tev1-4B-experimental, openai/gpt-oss-120b, Qwen/Qwen3.5-9B,
   zai-org/GLM-5.3-Flash, MiniMaxAI/MiniMax-M3.1-Flash,
   deepseek-ai/DeepSeek-V4.1-Flash. (gpt-oss-20b and Mistral-Small-24B
   were probed and rejected by the API as non-serverless.) Final
   selection follows the spec's rule on the pilot results and is
   recorded in PLAN.md before the freeze.

10. **Waiting-time statistics** count served customers only; abandoned
    customers are reported as their own rate. This matches how call
    centres report "average wait" and is stated wherever it matters.

11. **Playground curves** are precomputed for three preset scenarios
    (the spec's playground standard: charts from Python results). The
    sliders drive the in-browser simulation and the live Erlang C
    staffing answer; the wait-vs-servers chart switches between the
    three precomputed presets. Patience affects the browser simulation
    only, and the page says the formula assumes nobody hangs up.

12. **GitHub**: the repo is local only. Creating/pushing the private
    GitHub repo waits on Omid's repository-access selection (program
    state, 2026-11-13); recorded as pending in REPORT_FOR_REVIEW.md.

13. **Hand-instance windows.** A 20-customer instance drawn from an
    empty system usually contains no waiting at all when the scenario
    has many servers (6 of the 15 first draws were all-zero), and an
    instance with no events tests no state tracking. Rule, fixed
    before the freeze and applied uniformly: draw a 300-customer
    stream from the scenario's own process and take the first
    20-customer window which, simulated on its own from empty, has at
    least 5 customers who wait (> 0.05 min) or abandon; re-zero the
    times. (An earlier draft of this rule keyed on waiting inside the
    long stream, which mostly reflects customers outside the window;
    the standalone-window version above is the one in force.) B5
    priority flags are Bernoulli(20%) over the stream, so a window
    holds roughly — not exactly — 4 priority customers;
    DECISIONS.md #5's "exactly 4" is superseded by this entry. The
    pilot had already used the un-windowed instances for its hand
    calls; the pilot's purpose is model selection (code-failure rule
    and format compliance), and this change is recorded in PLAN.md's
    pilot note.

14. **Model selection (pilot, 2026-11-13).** Six candidates, 5 pilot
    scenarios × 3 modes each (90 calls, $0.1444). Per the spec's rule,
    together/Tev1-4B-experimental is dropped: its code failed to run
    in 5 of 5 pilot scenarios. Qwen/Qwen3.5-9B's code ran 5/5 but its
    Direct answers followed the required format in only 1 of 5
    scenarios, so it fails the plan's "answers in format" test and is
    not carried into the main run (its pilot behaviour is reported in
    PLAN.md). No candidate met the draft hand-format bar (≥16 of 20
    customers parsed in ≥4 of 5 scenarios; best was 3 of 5), so that
    bar is treated as report-only rather than a gate — the main run
    measures hand performance instead of selecting on it. Chosen, the
    three cheapest remaining models from three families:
    openai/gpt-oss-120b, zai-org/GLM-5.3-Flash,
    MiniMaxAI/MiniMax-M3.1-Flash. Projected main-run cost ≈ $0.22
    against the $5 cap.

## 2026-11-13: v2, rebuilt as the Call Center Staffing Planner

- The page mixed a simulator, a staffing question, a theory section and an LLM table. v2 does one job: how many agents to put on the phones and schedule, for one hour or a day. Studies moved to the README's Research notes and `results/`.
- Staffing rule: Erlang C staffing search for the service target, then raised for the occupancy cap (default 90%); the page says which constraint bound.
- With callers who hang up, the recommendation comes from simulation of the M/M/c+M queue (memoryless, so simulated as a Markov chain with FIFO customers; 20 runs of 8 h after 1 h warm-up, common random numbers across agent counts). Hung-up calls count as missed in the service level. Checked against the SimPy simulator in tests.
- The live animation uses the same chain (the v1 animation engine was replaced; its counters did not match the simulator).
- Day plan: Erlang C per hour (standard interval staffing), minimum agents per hour, shrinkage, CSV export. It ignores hang-ups and says so.
