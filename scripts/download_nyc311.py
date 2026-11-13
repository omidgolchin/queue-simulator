"""Re-fetch the NYC 311 hourly counts used for the arrival profile.

Queries the NYC Open Data Socrata API for service requests created in
January 2024, aggregated by hour of day, and writes the raw response to
data/nyc311_hourly_raw_jan2024.json. No API key is required.
"""

import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

QUERY = {
    "$select": "date_extract_hh(created_date) AS hour, count(*) AS n",
    "$where": "created_date between '2024-01-01T00:00:00' "
              "and '2024-01-31T23:59:59'",
    "$group": "hour",
    "$order": "hour",
    "$limit": "100",
}
URL = ("https://data.cityofnewyork.us/resource/erm2-nwe9.json?"
       + urllib.parse.urlencode(QUERY))


def main() -> None:
    with urllib.request.urlopen(URL, timeout=120) as resp:
        rows = json.load(resp)
    out = ROOT / "data" / "nyc311_hourly_raw_jan2024.json"
    out.write_text(json.dumps(rows, indent=1))
    print(f"wrote {len(rows)} hourly rows to {out}")


if __name__ == "__main__":
    main()
