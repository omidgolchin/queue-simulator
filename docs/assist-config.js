/* The AI assist's prompt configuration: what the model is asked to extract.
 * Shared by the page (app.js) and the extraction test (scripts/eval_assist.js),
 * so the test scores exactly the prompt visitors get. */
(function (g) {
  "use strict";
  var ASSIST_CONFIG = {
    title: "Fill from my description.",
    lede: "Describe your center in your own words, or paste an interval report from your phone system. The model only fills the form; every value shows the phrase it came from, and you choose what to keep.",
    placeholder: "e.g. We take about 1,200 calls a day, busiest Monday 9 to 11 with around 160 an hour. Calls run about 6 minutes including notes. We promise 80% answered in 30 seconds. People hang up after 2-3 minutes. Breaks and training take about a third of the day.",
    examples: [
      { label: "A description", text: "We're a 12-person support team. On a normal weekday we get about 1,200 calls between 8am and 8pm, busiest mid-morning around 160 an hour. Calls average 5 and a half minutes plus about 30 seconds of notes. Our promise is 80% answered within 30 seconds. Most people give up after roughly 3 minutes on hold. Breaks, training and meetings eat about 30% of paid time. An agent costs us about $27 an hour." },
      { label: "Interval report", text: "Interval report, Tue\n08:00 64\n09:00 118\n10:00 151\n11:00 147\n12:00 120\n13:00 126\n14:00 131\n15:00 109\n16:00 88\n17:00 61\nAHT 372s | SL target 80/20 | Avg abandon time 145s" }
    ],
    instructions: "The tool plans staffing for a phone queue. Extract what the text states. Handle time is in minutes (convert seconds: 372s = 6.2). Service target is a percentage and a number of seconds ('80/20' means 80% within 20 seconds). Patience is the average time callers wait before hanging up, in minutes. Shrinkage is a percentage of paid time agents are unavailable. 'Calls per hour' is the busiest hour if one is stated, otherwise the typical hour. If the text lists calls for each hour, put them in 'hourly' in order, and set openFrom and openTo (24-hour clock; openTo is the hour after the last listed hour). callsPerDay is the daily total if stated, or the sum of the hourly list.",
    fields: [
      { key: "calls", label: "Calls per hour (busiest or typical)", type: "number" },
      { key: "aht", label: "Average handle time (min)", type: "number" },
      { key: "tPct", label: "Target: % answered", type: "number" },
      { key: "tSec", label: "Target: within seconds", type: "number" },
      { key: "patience", label: "Callers hang up after (min)", type: "number" },
      { key: "shrink", label: "Shrinkage (%)", type: "number" },
      { key: "callsPerDay", label: "Calls per day", type: "number" },
      { key: "openFrom", label: "Open from (hour, 0-23)", type: "number" },
      { key: "openTo", label: "Open until (hour, 1-24)", type: "number" },
      { key: "hourly", label: "Calls in each hour", type: "array" },
      { key: "cost", label: "Cost of one agent-hour ($)", type: "number" }
    ]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = ASSIST_CONFIG;
  g.ASSIST_CONFIG = ASSIST_CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
