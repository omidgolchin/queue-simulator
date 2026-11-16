# Call Center Staffing Planner

For anyone who runs a phone line (a support desk, a clinic, a help line): enter your calls per hour and call length, get how many agents to put on the phones and how many people to schedule to hit your service target, for one hour or a whole day.

![The planner on three examples (a support desk, a clinic line where callers hang up, a Monday rush), the explanation of shrinkage, and the whole-day plan](docs/hero.gif)

![The planner on a desktop: the compact form above the live simulation, the recommendation as a large number over the queue, and its checks](docs/screenshots/desktop.png)

**Use it:** https://omidgolchin.github.io/queue-simulator/ (runs in your browser; nothing you type leaves it)

## What it does

- **Plan one hour.** Calls per hour, average handle time and your service target (for example 80% answered within 20 seconds) give the agents to put on the phones, the people to schedule after shrinkage, and the expected service level, average wait and how busy agents will be.
- **Plan a whole day.** Calls per day and the shape of the day (a typical weekday, flat, or your own hourly counts) give agents hour by hour, total agent-hours and paid hours, cost, and a CSV to take into a scheduling tool.
- **Watch the hour.** The recommended staffing runs live, one second per minute; remove an agent and watch the queue build.
- **Fill from my description.** Describe your center in plain words or paste an interval report from your phone system; a language model (your key, or copy the prompt into any assistant) fills the form, quoting the phrase each number came from. The model never computes the answer.
- **Copy summary / Copy link / Download CSV.**
- **Start here.** The page opens with the question it answers and three steps; a list of common situations fills the form; and a section says when to use the tool and when not.
- **Help where you need it.** Each mode opens with a line saying what to enter and what you get; every input has a line under it saying what the number is, why it matters and where to find it; and every technical term in the inputs and results has a **?** that opens a plain-language explanation.

## Built-in checks

| Check | What it does |
|---|---|
| Occupancy cap | Never recommends agents busier than the cap (default 90%): meeting the target with agents at 95% is not a schedulable plan. The verdict says when the cap, not the target, set the number. |
| Callers who hang up | Erlang C assumes nobody hangs up and overstates waits when they do. With a patience set, the recommendation comes from simulation, and hung-up calls count as missed. |
| Shrinkage | Converts agents on the phones into people to schedule. |
| Busier than forecast | What 10% more calls or 10% longer calls would need, and what service drops to if they arrive. |
| One agent short | The service level with one fewer agent: how much margin the plan has. |
| Hour by hour (day plan) | Shows what staffing the whole day for its average hour would do to the peak. |

## Design decisions

- **Erlang C per hour, then a staffing search.** The standard workforce-management method (Gans, Koole & Mandelbaum 2003): the fewest agents whose service level meets the target, interval by interval.
- **Occupancy cap after the service search.** The target and the cap are separate constraints; the recommendation is the larger of the two answers, and the page says which one bound.
- **Simulation only where the formula fails.** With callers who hang up, the planner simulates the queue (20 independent 8-hour runs after a 1-hour warm-up, the same random numbers for every agent count so the curve is smooth). The browser engine agrees with this repository's SimPy simulator within confidence intervals on abandonment, waits and occupancy (tested).
- **Hung-up calls count against the service level.** The conservative convention: a caller who gave up was not served within the target.
- **The day plan uses Erlang C.** It ignores hang-ups, which makes it slightly generous; a busy hour can be checked by simulation in the one-hour view.
- **What-ifs use the same engine as the recommendation** (simulation when callers hang up, Erlang C otherwise), so the margins are comparable.

## Validation

- **36 tests** (`make test`): Erlang C against the raw-sum formula; the staffing search, occupancy cap, shrinkage and day plan in Python; the JavaScript against the Python on four staffing cases and a day plan; the browser simulation against SimPy on two settings with hang-ups; the browser simulation against Erlang C without hang-ups; the live animation against the simulation on average; the AI assist's prompt and reply handling.
- **The simulator behind it** reproduces Erlang C in 12 of 12 settings (inside the 95% interval) and Little's law within 0.12% ([results/summary.md](results/summary.md)).
- **AI assist extraction:** a 20-item test set (`assist/testset.json`: descriptions, interval reports, seconds vs minutes, shrinkage given as parts, cost per day instead of per hour, text with no numbers). Score any model with `ANTHROPIC_API_KEY=... node scripts/eval_assist.js`. Not yet run for this release.
- Checked on desktop and phone widths, in light and dark themes.

## What I learned

- The spread of call lengths matters as much as the average. At the
  same average call length, very variable calls (CV 2) more than
  doubled the wait. I now distrust any staffing table that quotes
  only averages.
- My first hand-simulation test instances were useless: drawn from an
  empty system, most had nobody waiting at all, so they tested no
  state tracking. The instance rule had to change (take a busy
  20-customer window from a longer stream) before the plan could
  freeze.
- For the overloaded center I nearly scored models against a
  finite-day average wait. There is no steady state there, so the
  only right answer is to say so, and the check now scores exactly
  that.
- The standard bank call-center dataset is registration-gated, so I
  used NYC 311 counts for the shape of a day instead. Only the shape
  is borrowed, and the write-up has to keep saying so.

- Planning one hour well is not enough: the planner needed a day view because the rush hour is where averages fail.

## Common situations

The form opens with "Start from a common situation". Each entry fills the form with illustrative settings and says why they differ from the standard case:

| Situation | What changes |
|---|---|
| Customer service line, the 80/20 standard | The textbook case: 120 calls an hour, 6 minutes, 80% within 20 seconds, nobody hangs up. |
| Support desk (30 calls an hour) | Small teams need agents idle more of the time for the same promise, so more agents per call. |
| Technical support, long calls | 12-minute calls and a looser promise (80% within a minute). |
| Sales line, callers hang up fast | Patience of 1.5 minutes, so the answer comes from simulation and hung-up calls count as missed. |
| Clinic phone line, callers hang up | Short calls, 90% within 30 seconds, callers give up after about 3 minutes. |
| Urgent line, strict target | 90% within 15 seconds: expect agents idle about half the time. |
| Monday rush (75 an hour) | The busiest hour planned on its own. |
| Retail peak season | Twice the volume, impatient callers, more shrinkage. |
| Large center, tight target | Large centers keep a strict promise with busier agents; watch the occupancy cap. |

The settings are illustrative, not industry data. To add a situation, append an entry `{label, why, v}` to `EXAMPLES` in `docs/app.js`; `v` holds the form fields to change.

## When to use it, and when not

Use it to size an inbound phone queue: a first head count for a busy hour, a whole-day roster, a check on a number from a vendor or a spreadsheet, or the margin a plan has.

| It assumes | If yours differs |
|---|---|
| Calls arrive at random within the hour, at a steady rate. | Bursts (an outage, a mailing, a TV ad) bring more waiting than shown. Plan the burst as its own short, busier period. |
| One queue: every agent can take every call. | Separate skills or languages are smaller queues and need more agents in total. Plan each group separately as a first cut. |
| Call lengths vary like a typical center's (exponential). | Very uneven calls wait longer: in the study, CV 2 roughly doubled the average wait (2.05 against 1.07 minutes). Steadier calls wait less. |
| An agent handles one call at a time. | Chat agents with several sessions at once are outside this model. |
| Callers who hang up do not call back. | Add repeat calls to calls per hour. |
| Each hour stands alone. | After an understaffed hour, the backlog carries into the next. |
| Shrinkage is one flat share of paid time. | If breaks and training cluster, add people in those hours by hand. |

Do not use it for work that can wait (email, tickets, back-office tasks: plan those by workload, not waiting time), outbound or blended dialing, callback or virtual-hold systems, or multi-skill routing you need to plan exactly. A workforce-management system with multi-skill simulation is the right tool for those.

## The study behind it, and how the tool was extracted

This tool was built from a study, which lives in its own repository: [Where the call-center formula breaks, and can an LLM do queueing math?](https://github.com/omidgolchin/call-center-queueing-study). The study built a queue simulator, checked it against Erlang C (12 of 12 settings inside the 95% interval), then used it where the formula stops working. Three findings shaped the tool:

- **Callers who hang up** break the formula (a 26-minute predicted wait against about 1.3 minutes simulated, with 15% giving up), so the tool simulates whenever a patience is set.
- **Rush hours** break average-hour planning (41% of callers over 20 seconds at the peak of a 311-shaped day staffed for its average hour), so the day plan staffs each hour on its own.
- **Uneven call lengths** double waits; the tool keeps the typical spread and says so rather than guess yours.

The study fixed one center (60 calls an hour, a 311-shaped day). The tool keeps the validated engine, turns those fixed settings into inputs, and adds what a planner needs that the study did not: the occupancy cap, shrinkage, cost and margin checks. The study's language-model half did not become part of the tool; the AI fill only reads a description into the form. The copies of the study's scripts and outputs kept here are what this tool's tests check against.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
make test        # all tests, including the JavaScript engine
cd docs && python3 -m http.server 8000   # the tool at http://localhost:8000
make validate    # the simulation studies (cached; slow the first time)
make reproduce   # results/summary.md, figures and docs/data from outputs/
```

## Layout

- `docs/`: the tool (plain HTML and JavaScript, no build step). `staffing.js` holds the staffing search, the hang-up simulation and the live queue; `qsim.js` Erlang C and the event checker; `tool-common.js` and `tool.css` the shared tool kit; `assist-config.js` the AI assist's prompt; `nyc-shape.js` the weekday shape.
- `src/queuesim/`: `staffing.py` (reference for the planner), `erlang.py`, `simulate.py` (SimPy), and the research-notes studies and LLM check.
- `assist/` and `scripts/eval_assist.js`: the assist's test set and scorer.
- `PLAN.md`, `FREEZE_MANIFEST.txt`, `DECISIONS.md`, `SPEND.md`: the frozen plan, its hashes, every judgment call and the costs of the research experiments.

## Limitations

- One queue, identical agents, no skills-based routing.
- Calls are assumed to vary in length like a typical center (exponential). Steadier calls need fewer agents and very variable calls need more; the research notes show by how much.
- The weekday shape is borrowed from NYC 311 requests, which are not calls to one center: it is a realistic shape, not a forecast. Use your own counts for planning.

## References

1. Law, A. M. *Simulation Modeling and Analysis*, 6th edition,
   McGraw-Hill Education, 2024. ISBN 9781264268245.
   https://www.mheducation.com/highered/product/simulation-modeling-analysis-law.html
2. Hillier, F. S., Lieberman, G. J., Nag, B., Basu, P.
   *Introduction to Operations Research*, 12th edition, McGraw Hill,
   2024. Chapter 17 (Queueing Theory).
   https://www.mheducation.com/highered/product/introduction-operations-research-hillier.html
3. Little, J. D. C. (1961). "A Proof for the Queuing Formula:
   L = λW." *Operations Research* 9(3), 383–387.
   https://doi.org/10.1287/opre.9.3.383
4. SimPy documentation, version 4.1.2. https://simpy.readthedocs.io/en/latest/
5. Gans, N., Koole, G., & Mandelbaum, A. (2003). Telephone call centers: Tutorial, review, and research prospects. *Manufacturing & Service Operations Management*, 5(2), 79–141.
6. Garnett, O., Mandelbaum, A., & Reiman, M. (2002). Designing a call center with impatient customers. *Manufacturing & Service Operations Management*, 4(3), 208–227.
7. NYC Open Data, "311 Service Requests from 2010 to Present".
   https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9

## Citation and license

Omid Golchin. *Call Center Staffing Planner* (repository queue-simulator), 2026. See `CITATION.cff`.
Code: MIT License (`LICENSE`). The aggregated NYC 311 hourly counts
in `data/` are public open data; see `DATA_SOURCES.md`.
