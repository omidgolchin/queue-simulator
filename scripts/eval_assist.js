#!/usr/bin/env node
/* Scores the page's AI assist ("Fill from description") on a fixed test set.
 *
 * It builds exactly the prompt the page sends (docs/tool-common.js +
 * docs/assist-config.js), calls a model, parses the reply the way the page
 * does, and compares each field with the expected value.
 *
 *   ANTHROPIC_API_KEY=... node scripts/eval_assist.js [model]
 *   OPENAI_API_KEY=... OPENAI_BASE_URL=https://.../v1 node scripts/eval_assist.js <model>
 *
 * Writes results/assist_eval.json. Scoring per field:
 *   correct  value matches (numbers within 0.5% or 0.5 absolute), or both null
 *   missed   expected a value, got null
 *   wrong    got a different value
 *   invented expected null (not stated in the text), got a value
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const Tool = require(path.join(ROOT, "docs", "tool-common.js"));
const CFG = require(path.join(ROOT, "docs", "assist-config.js"));
const TESTS = JSON.parse(fs.readFileSync(path.join(ROOT, "assist", "testset.json"), "utf8"));

async function call(prompt, model) {
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1500, temperature: 0, messages: [{ role: "user", content: prompt }] })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(j));
    return j.content.map((c) => c.text || "").join("");
  }
  if (process.env.OPENAI_API_KEY) {
    const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + process.env.OPENAI_API_KEY },
      body: JSON.stringify({ model, temperature: 0, messages: [{ role: "user", content: prompt }] })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(j));
    return j.choices[0].message.content;
  }
  throw new Error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
}

function same(field, got, want) {
  if (want === null || want === undefined) return got === null;
  if (got === null) return false;
  if (field.type === "number") return Math.abs(got - want) <= Math.max(0.5, Math.abs(want) * 0.005);
  if (field.type === "array") return JSON.stringify(got) === JSON.stringify(want);
  return String(got).toLowerCase() === String(want).toLowerCase();
}

(async () => {
  const model = process.argv[2] || (process.env.ANTHROPIC_API_KEY ? "claude-haiku-5-5" : "");
  if (!model) throw new Error("Pass a model name.");
  const tally = { correct: 0, missed: 0, wrong: 0, invented: 0 };
  const items = [];
  for (const t of TESTS) {
    const prompt = Tool._buildPrompt(CFG, t.text);
    let parsed = null, error = null;
    try { parsed = Tool._parseReply(await call(prompt, model)); } catch (e) { error = String(e.message || e); }
    const fields = {};
    for (const f of CFG.fields) {
      const want = t.expected[f.key] === undefined ? null : t.expected[f.key];
      const item = parsed && parsed.fields[f.key] ? parsed.fields[f.key] : {};
      const got = Tool._coerce(f, item.value);
      const quoteOk = got === null || Tool._quoteFound(t.text, item.quote);
      let verdict;
      if (same(f, got, want)) verdict = "correct";
      else if (want === null) verdict = "invented";
      else if (got === null) verdict = "missed";
      else verdict = "wrong";
      tally[verdict]++;
      fields[f.key] = { want, got, verdict, quoteOk };
    }
    items.push({ id: t.id, error, fields, questions: parsed ? parsed.questions : null });
    process.stdout.write(".");
  }
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const out = { model, date: new Date().toISOString().slice(0, 10), items: TESTS.length, fields: total, tally,
    accuracy: tally.correct / total, invented_rate: tally.invented / total, results: items };
  fs.mkdirSync(path.join(ROOT, "results"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "results", "assist_eval.json"), JSON.stringify(out, null, 2));
  console.log("\n" + model + ": " + (100 * out.accuracy).toFixed(1) + "% of fields correct; invented " + tally.invented + ", missed " + tally.missed + ", wrong " + tally.wrong + " (of " + total + ").");
})().catch((e) => { console.error(e); process.exit(1); });
