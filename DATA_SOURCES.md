# Data sources

## NYC 311 service requests (arrival-rate shape)

- **What:** counts of NYC 311 service requests by hour of day,
  created 2024-01-01 to 2024-01-31 (31 days), fetched from the NYC
  Open Data Socrata API (dataset `erm2-nwe9`, "311 Service Requests
  from 2010 to Present") with a `date_extract_hh` aggregation query.
- **File:** `data/nyc311_hourly_raw_jan2024.json` (the 24 aggregated
  counts, exactly as returned). Re-fetch with
  `scripts/download_nyc311.py`.
- **Terms:** NYC Open Data Terms of Use — the data is provided for
  public use; the City makes no claim of copyright on the raw data.
  https://www.nyc.gov/site/opensource/guidelines/terms-of-use.page
- **How it is used:** only to set hourly arrival *rates* — the shape
  of a service day. The counts are averaged over the 31 days and
  scaled to a call centre averaging 60 calls/hour
  (`data/nyc311_profile_scaled.json`, produced by
  `python -m queuesim.validate`). No individual requests are used,
  and 311 requests are not calls to a single centre; the write-up
  says so wherever the profile appears.

## Technion SEE Lab call-centre data (checked, not used)

- The spec's first-choice source. Checked 2026-11-13: the SEE Lab's
  bank call-centre data is served through the SEEServer, free for
  academic use after personal registration; there is no public direct
  download of the timestamped records, and mirrors elsewhere have
  unclear redistribution terms. Per the spec's decision rule the
  project moved to its second choice (above). See DECISIONS.md #3.
  https://seelab.net.technion.ac.il/

## Everything else

All other numbers in this repo are simulated by the code in `src/`
from the parameters in `config.yaml` and `src/queuesim/scenarios.py`.
No other external data is used. No dataset is redistributed beyond
the 24 aggregated hourly counts above.
