---
name: looot-intent
description: Score company domains for buying intent and rank them with an explainable score and stage, using the looot-intent CLI. Use when asked to rank accounts by intent, find accounts that are in market, or replace a 6sense-style account scoring list.
---

# looot-intent

Runs the looot-intent CLI from a clone of https://github.com/loootai/looot-intent.

Setup (Node 20.9+, `npm install --ignore-scripts`, token and balance) is in the README under "What you need". Troubleshooting messages are under "Troubleshooting".

1. Put the domains in a text file, one per line, or a CSV with a `domain` column.
2. Quote first, no charge:
   `npm run intent -- <file> --icp "<ICP in one sentence>" --max-spend <usd> --dry-run`
   Show the user the total and the per-signal table. Ask before spending.
3. Real run, needs `LOOOT_TOKEN` in the environment:
   `npm run intent -- <file> --icp "<ICP>" --max-spend <usd>`
   Exit code 2 means refused (quote above the cap, or no token). Do not raise the cap on your own.
4. Read `out/intent-<run>.md` and report the top accounts with their stage and the reasons. Name the provider behind each reason.
5. If the summary line shows pending calls, run the same command again within the week. Finished calls replay at no charge.

To try it without a key: `npm run intent -- --demo`.

Scoring weights and stage thresholds are in `config/intent.config.json`. Change them only when the user asks.
