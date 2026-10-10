<p align="center"><img src="assets/hero.png" alt="looot-intent" width="100%"></p>

# looot-intent

[![License](https://img.shields.io/github/license/loootai/looot-intent)](LICENSE) [![Release](https://img.shields.io/github/v/release/loootai/looot-intent)](https://github.com/loootai/looot-intent/releases) [![Docs](https://img.shields.io/badge/docs-docs.looot.ai-12A06A)](https://docs.looot.ai)

An open-source alternative to [6sense](https://6sense.com) for account intent and buying-stage scoring. 6sense publishes no price for paid plans and has a free plan with 50 credits a month; the only paid-plan figure found is a third-party estimate of about $25,000 a year (read 2026-10-10), not a 6sense number. looot-intent scores a list of company domains on one [looot](https://looot.ai) key and shows what each score cost.

![Ranked accounts, light](docs/screenshots/dashboard-light.png)

## What it does

Give it company domains and an ICP description. For each account it calls ten looot endpoints from nine signal categories, turns the answers into a 0 to 100 intent score and a buying stage (unaware, aware, considering, deciding), and ranks the accounts.

- Every score lists the signals behind it, the provider that supplied each one, its weight in points and what the call cost.
- Weights, half-lives and stage thresholds live in `config/intent.config.json`. Edit the file, re-run.
- The quote comes first. A per-run spend cap is enforced before each call, and a stable idempotency key means a re-run in the same window replays finished calls at no charge.
- A call still running when waiting stops is `pending`, never "failed at $0".

Three ways to run it: a demo with sample data, a headless CLI, and a web UI on the same engine.

| Page | Light | Dark |
| --- | --- | --- |
| Ranking, quote and cost panel | ![](docs/screenshots/dashboard-light.png) | ![](docs/screenshots/dashboard-dark.png) |
| Account page with timeline | ![](docs/screenshots/account-light.png) | ![](docs/screenshots/account-dark.png) |

## Quick start

```bash
npm install --ignore-scripts
npm run demo          # http://localhost:3271, sample data, no token, no network, no cost
```

Headless, with your key:

```bash
export LOOOT_TOKEN=...                       # from https://looot.ai
npm run intent -- accounts.csv --column website --icp "B2B SaaS, 50 to 500 employees" --max-spend 5 --dry-run
npm run intent -- accounts.csv --column website --max-spend 5
```

`--dry-run` prints the list-price quote and makes no run. Without `--dry-run` the CLI prints the quote, refuses if it is above `--max-spend` (pass `--partial` to run until the cap), and writes `intent-<run>.json`, `.csv` and `.md` into `./out`. Run `npm run intent -- --help` for all flags. Exit codes: 0 done, 1 error, 2 refused (over the cap or no token).

The web UI on a live key: set `LOOOT_TOKEN` and run `npm run dev`. Results are saved to `.looot-intent/state.json`, shared with the CLI. Supabase auth is not used.

## Signals

Job ids and prices are from the public looot catalog, read 2026-10-10. Prices are per call in USD.

| Signal | Provider | looot job | Endpoint | Price |
| --- | --- | --- | --- | --- |
| Hiring and job ads | PredictLeads | `jobs.company` | `predictleads-companies-job-openings` | $0.0100 |
| Funding | PredictLeads | `company.funding` | `predictleads-companies-financing-events` | $0.0100 |
| Company news | PredictLeads | `company.news` | `predictleads-companies-news-events` | $0.0100 |
| Tech stack changes | PredictLeads | `company.technographics` | `predictleads-companies-technology-detections` | $0.0100 |
| SEO movement | DataForSEO | `keywords.domain.overview` | `dataforseo-dataforseo-labs-google-domain-rank-overview-live-ai` | $0.0120 |
| Web traffic | Datagma | `company.traffic` | `datagma-website-traffic` | $0.06532 |
| Google ads | Scrape Creators | `google.company.ads` | `scrapecreators-google-company-ads` | $0.00188 |
| LinkedIn ads | Adyntel | `ads.linkedin.search` | `adyntel-linkedin` | $0.00642 |
| Reddit mentions | Scrape Creators | `reddit.post.search` | `scrapecreators-reddit-search` | $0.00188 |
| Headcount growth | CompanyEnrich | `company.workforce` | `companyenrich-companies-workforce` | $0.0490 |

All ten together cost $0.1765 per account at list price. A typical run of 25 accounts is $4.41 and 100 accounts is $17.65. Turn a signal off in the config to drop its cost (web traffic and headcount are $0.114 of the $0.1765).

## How a score is built

1. Each enabled signal gets points out of 100, in proportion to its weight. Weights of the enabled signals are scaled to add up to 100.
2. Event signals (jobs, funding, news, tech, ads, Reddit): every event counts `0.5^(age / half-life)`, at 40% when it does not match the ICP. The sum divided by the signal's `saturation` is its strength, capped at 1.
3. Growth signals (traffic, headcount) compare this reading with the one saved from your last run. The first run records a baseline and scores zero for that signal. SEO movement uses the share of ranking keywords that moved up net of down, which the provider returns in one call.
4. Stage: `aware` from 20, `considering` from 45, `deciding` from 70 and only when at least 3 categories show signal. Otherwise the account stays `considering`.

There is no model and no hidden constant. The ICP description is stored with the run and shown, but matching uses the keyword lists in the config (job title words, technologies, news categories), so the result is the same every time for the same data.

## What is dropped, and what is not tested

- No first-party visitor tracking, no bidstream or keyword-research intent from third-party data pools, no CRM sync, no ad orchestration. 6sense has these. looot has no job that supplies them.
- No G2, Capterra or Trustpilot review signal. The catalog has none. Google Maps and App Store reviews need a place or app id, not a domain, so they are not used.
- No paid looot run was made. Request fields follow each endpoint's documented parameters in the catalog. Response parsers are built from provider docs and fixtures and read defensively, but no real response body has been checked against them. `shapeVerified` is `false` for every signal in `src/engine/signals.ts`. Expect to adjust a parser after your first live run, and run `--dry-run` and a 2-domain run first.
- The PredictLeads path parameter is sent as `company_id_or_domain`, as its description says. The catalog parameter list does not show it.
- Demo accounts use the reserved `.example` domain. The data is generated, not real.

## Install for agents

```bash
git clone https://github.com/loootai/looot-intent && cd looot-intent && npm install --ignore-scripts
```

Claude Code: copy `skills/looot-intent` to `~/.claude/skills/looot-intent`. The skill runs the CLI with `--dry-run` first, then the real run with a cap. Other agents: read [llms.txt](llms.txt).

## Develop

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run leak-scan                 # also runs from .githooks/pre-commit: git config core.hooksPath .githooks
```

Layout: `src/engine` (client, signals, scoring, run loop, reports, no framework imports), `src/cli`, `src/server` and `src/app` (Next.js App Router), `config/intent.config.json`.

MIT licence, copyright looot.

## Related

Other open-source projects built on [looot](https://looot.ai):

- [looot-score](https://github.com/loootai/looot-score): lead and ICP fit scoring (MadKudu)
- [looot-reveal](https://github.com/loootai/looot-reveal): which companies visit your site (RB2B, Clearbit Reveal)
- [looot-techstack](https://github.com/loootai/looot-techstack): website technologies from several providers (BuiltWith, Wappalyzer)
- [looot-signals](https://github.com/loootai/looot-signals): hiring, funding and news triggers (TheirStack, Harmonic)
- [looot-lookalike](https://github.com/loootai/looot-lookalike): lookalike company search (Ocean.io)
- [looot-ads](https://github.com/loootai/looot-ads): competitor ad board (Foreplay)
- [looot-reviews](https://github.com/loootai/looot-reviews): review themes and weak spots (ReviewTrackers)
- [looot-battlecards](https://github.com/loootai/looot-battlecards): competitor battlecards (Klue, Crayon)
- [looot-mentions](https://github.com/loootai/looot-mentions): brand and keyword listening (Brand24)
- [looot-warm-leads](https://github.com/loootai/looot-warm-leads): warm leads from LinkedIn intent signals (Gojiberry)
- [looot-crm](https://github.com/loootai/looot-crm): a small CRM with buying signals built in
- [looot-seo](https://github.com/loootai/looot-seo): self-hosted SEO workspace
- [looot-monitor](https://github.com/loootai/looot-monitor): brand and competitor monitoring with alerts
