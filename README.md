<p align="center"><img src="assets/hero.png" alt="looot-intent" width="100%"></p>

# looot-intent

[![License](https://img.shields.io/github/license/loootai/looot-intent)](LICENSE) [![Release](https://img.shields.io/github/v/release/loootai/looot-intent)](https://github.com/loootai/looot-intent/releases) [![Docs](https://img.shields.io/badge/docs-docs.looot.ai-12A06A)](https://docs.looot.ai)

An open-source alternative to [6sense](https://6sense.com) for account intent and buying-stage scoring. 6sense publishes no price for paid plans and has a free plan with 50 credits a month; the only paid-plan figure found is a third-party estimate of about $25,000 a year (read 2026-10-10), not a 6sense number. looot-intent scores a list of company domains on one [looot](https://looot.ai) key and shows what each score cost.

> **Security notice.** Versions 0.1.3 and older had no admin sign-in. Anyone who could reach a deployed copy could read the saved run and start paid looot runs on your token. If you run v0.1.3 or older on a reachable host, upgrade to v0.1.4 and set `LOOOT_INTENT_ADMIN_PASSWORD`. See [Securing a deployment](#securing-a-deployment).

![Ranked accounts, light](docs/screenshots/dashboard-light.png)

## What it does

Give it company domains and an ICP description. For each account it calls eleven looot endpoints from ten signal categories, turns the answers into a 0 to 100 intent score and a buying stage (unaware, aware, considering, deciding), and ranks the accounts.

- Every score lists the signals behind it, the provider that supplied each one, its weight in points and what the call cost.
- Weights, half-lives and stage thresholds live in `config/intent.config.json`. Edit the file, re-run.
- The quote comes first. A per-run spend cap is enforced before each call, and a stable idempotency key means a re-run in the same window replays finished calls at no charge.
- A call still running when waiting stops is `pending`, never "failed at $0".

Three ways to run it: a demo with sample data, a headless CLI, and a web UI on the same engine.

| Page | Light | Dark |
| --- | --- | --- |
| Ranking, quote and cost panel | ![](docs/screenshots/dashboard-light.png) | ![](docs/screenshots/dashboard-dark.png) |
| Account page with timeline | ![](docs/screenshots/account-light.png) | ![](docs/screenshots/account-dark.png) |

## What you need

- Node.js 20.9 or later to run the app and the CLI (Next.js 16 requires it). The tests need Node 22.12 or later (vitest 5). The repo has no `engines` field or `.nvmrc`; I ran everything on Node 24.18.
- Git and npm.
- For real runs only, a looot account and token. Sign up at https://looot.ai/auth/sign-up. Then either run `npm i -g looot` and `looot login`, which opens a browser approval, or open the looot web app, go to Settings, "Agent tokens" and create one ([sign-in docs](https://docs.looot.ai/get-started/sign-in)). With no browser (CI), create the token in Settings > Agent tokens and `export LOOOT_TOKEN=...`.
- The token needs the scopes `runs.execute`, `catalog.read`, `runs.read` and `usage.read`.
- A funded balance. The minimum top-up is $5 and signing up adds no credit ([money docs](https://docs.looot.ai/money)).

No other account is used. There is no Supabase, no database and no LLM key.

## Try it in one minute

```bash
git clone https://github.com/loootai/looot-intent && cd looot-intent
npm install --ignore-scripts
npm run demo
```

Open http://localhost:3271. The demo has no sign-in and shows a "Demo, no sign-in" badge. It refuses to start if `LOOOT_TOKEN` is set or a saved run exists, unless you also set an admin password. The demo uses generated accounts on the reserved `.example` domain, needs no token, makes no network call and costs nothing. Stop it with Ctrl+C.

Prefer the terminal? `npm run intent -- --demo` prints the same ranking and writes the reports to `./out`.

## Run it with your own data

The web UI reads `.env.local`, the CLI does not. For the CLI, `export` the variables in your shell.

```bash
cp .env.example .env.local     # web UI only
```

| Variable | Needed | What it does | Where to get it |
| --- | --- | --- | --- |
| `LOOOT_TOKEN` | Required for real runs | Your looot key. Not needed for `--demo` or `--dry-run`. | looot Settings > Agent tokens, or `looot login` |
| `LOOOT_INTENT_ADMIN_PASSWORD` | Required for the web UI outside the demo | Admin password, 12 characters or more. Without it every page and API route except `/login` and `/api/health` is closed and `/login` shows a setup page. The CLI does not use it. | Choose one |
| `LOOOT_INTENT_ADMIN_PASSWORD_HASH` | Alternative | `scrypt$salt$key` instead of the plain password. Wins if both are set. | `npm run hash-password -- 'your password'` |
| `LOOOT_INTENT_SESSION_SECRET` | Optional | Key that signs session cookies. Default: derived from the password, so changing the password signs everyone out. | `openssl rand -hex 32` |
| `LOOOT_INTENT_MAX_RUN_USD` | Optional | Most one web run may spend, in dollars. Default 5. The browser cannot raise it. | Any number above 0 |
| `LOOOT_INTENT_COOKIE_SECURE` | Optional | Set to `0` only to test over plain http in production mode. | Leave unset |
| `LOOOT_API_URL` | Optional | Overrides the API base. Default `https://api.looot.ai`. | Leave unset |
| `LOOOT_INTENT_CONFIG` | Optional | Path to a scoring config for the web UI. Default `config/intent.config.json`. The CLI takes `--config` instead. | Copy `config/intent.config.json` |
| `LOOOT_INTENT_DIR` | Optional | Folder for the saved run (`state.json`). Default `.looot-intent` in the working directory. | Any writable folder |
| `LOOOT_INTENT_DEMO` | Optional | `1` runs the web UI on sample data. `npm run demo` sets it. | Leave unset for real data |

Example inputs are in `examples/`. `examples/domains.txt` is one domain per line, `examples/accounts.csv` has a `domain` column. Both use `.example` domains, so the calls would find nothing. Swap in your own accounts.

Quote first. The CLI reads live prices from the public looot catalog, which needs no token. This is the real output of the dry run:

```bash
npm run intent -- examples/accounts.csv --column domain --icp "B2B SaaS, 50 to 500 employees" --max-spend 5 --dry-run
```

```text
3 accounts, 11 signals each.
  Hiring and job ads         predictleads   jobs.company                 $0.0100 x    3 =   $0.0300
  Funding                    predictleads   company.funding              $0.0100 x    3 =   $0.0300
  Company news               predictleads   company.news                 $0.0100 x    3 =   $0.0300
  Tech stack changes         predictleads   company.technographics       $0.0100 x    3 =   $0.0300
  SEO movement               dataforseo     keywords.domain.overview     $0.0120 x    3 =   $0.0360
  Web traffic                datagma        company.traffic             $0.06532 x    3 =  $0.19596
  Google ads                 scrapecreators google.company.ads          $0.00188 x    3 =  $0.00564
  LinkedIn ads               scrapecreators ads.linkedin.search         $0.00188 x    3 =  $0.00564
  Reddit mentions            scrapecreators reddit.post.search          $0.00188 x    3 =  $0.00564
  Headcount growth           companyenrich  company.workforce            $0.0490 x    3 =   $0.1470
  Third-party buying intent  theirstack     companies.buying-intents     $0.0981 x    3 =   $0.2943
  Total                                                                 $0.27006 per account     $0.81
  Third-party buying intent: the price is per result. The app asks for 1 result per account, so $0.0981 is the most one account costs. The catalog says nothing found means no charge.
  Prices: read from the public looot catalog
Quoted $0.81 at list price. Cap $5.00.
Dry run: no run was made and nothing was charged.
```

Add `--offline` to skip the catalog read and use the dated prices. When the live catalog has no readable price for an endpoint, the CLI prints "Source unavailable" for it and skips those calls, and the web UI shows a "source unavailable" chip on that signal.

Then the real run:

```bash
export LOOOT_TOKEN=...
npm run intent -- examples/accounts.csv --column domain --icp "B2B SaaS, 50 to 500 employees" --max-spend 5
```

Results go to `./out` as `intent-<run>.json`, `.csv` and `.md` (change the folder with `--out`, the formats with `--format json,csv,md`). The latest run is also saved to `.looot-intent/state.json`, which the web UI reads and which the next run uses as the growth baseline. Run `npm run intent -- --help` for all flags. Exit codes are 0 done, 1 error, 2 refused (over the cap or no token).

The web UI on a live key: put `LOOOT_TOKEN` and `LOOOT_INTENT_ADMIN_PASSWORD` in `.env.local` and run `npm run dev` (http://localhost:3000). It asks for the admin password. Without the password it shows a setup page and nothing else.

## Spending

Four limits stand between a request and a charge, checked in this order: the quote, the cap per run, the period budget, then the call.

- The quote is printed first. A real run is refused (exit 2) when the quote is above `--max-spend`. Pass `--partial` to run until the cap instead.
- `--max-spend` is in dollars. The default is 5. The web UI takes its cap from the server (`LOOOT_INTENT_MAX_RUN_USD`, default 5), not from the browser.
- The cap counts list price for calls in flight and the real charge once a call ends, so a run does not go over it. With up to 16 calls in flight in one process, each call counts its list price against the cap before it waits on anything else.
- The period budget caps all runs together: a daily and a monthly amount (UTC), $10 and $50 until you change them. The owner changes them on the Costs page of the web UI, or sets the starting values with `LOOOT_INTENT_DAILY_USD` and `LOOOT_INTENT_MONTHLY_USD`. A request to `/api/run` cannot carry a budget: any budget field in it is ignored. The CLI refuses a run whose quote is above what is left, unless you pass `--partial`.
- Before each paid call, one call at a time, the app reserves its list price in `budget.json` (in `LOOOT_INTENT_DIR`), under a lock file, and refuses the call if used plus reserved plus the price would pass the daily or the monthly budget. Calls and runs started together cannot both pass. When the call ends the reservation becomes the real charge. A call looot answered with an error releases it. A call still running at looot (`pending`) keeps its reservation: it is never recorded as failed at $0 and the budget is never handed back early.
- The next run looks up every pending call with `GET /v1/runs/{id}` and settles the ones that ended, to their real cost. If looot cannot be reached, or the app died before it got a run id, the reservation stays for 24 hours and is then released.
- The sidebar and the Costs page show used, reserved and remaining for today and this month. At the budget the call is skipped with a message that names the limit.
- Every call has a stable key made from the account, the signal, the normalised input and the refresh period. The refresh period is the freshness window from the config (a week by default), taken from the clock only to name the period, with no date or time salt inside it. A finished call is stored under its key for 40 days. Repeating the same request inside the window is answered from the stored result: no call, no reservation, no charge. When the window rolls over, the same account gets a new explicit request with its own stable key, and that one is charged once.
- The looot token balance is the final limit. Fund a dedicated token with only what you are willing to spend, and keep the budget below it.
- All eleven signals cost $0.2701 per account at list price: $0.17196 for the ten per-call signals plus $0.0981 for third-party buying intent, which is priced per result. 25 accounts is $6.75 and 100 accounts is $27.01. The default web cap of $5 covers 18 accounts; for 25 pass `--max-spend 7` or raise `LOOOT_INTENT_MAX_RUN_USD`. Switch a signal off in the config to drop its cost: without buying intent a run is back to $0.1720 per account, $4.30 for 25.
- Buying intent is priced per result, not per call. The app sends `limit: 1`, so one account costs at most one result ($0.0981), and the quote and the spend cap both reserve that full price before the call. The catalog description says nothing found means no charge. No live run has confirmed that, so the quote is the worst case.
- A failed call is not charged. A call still running when waiting stops is `pending` and keeps its reservation. Run the same command again inside the freshness window (`freshnessWindow` in the config, a week by default) and finished calls replay at no charge.

The budget lives in a file, so run one instance on a disk that persists. Several instances, or a serverless host with a throwaway disk, do not share it.

## Deploy

I have not deployed this to Vercel. The steps below follow the code.

1. Push a copy of the repo to your own GitHub account.
2. In Vercel choose Add New > Project, import the repo. Next.js is detected, there is no `vercel.json`.
3. Add the environment variables `LOOOT_TOKEN` and `LOOOT_INTENT_ADMIN_PASSWORD` (or `LOOOT_INTENT_ADMIN_PASSWORD_HASH`). Add `LOOOT_INTENT_DIR` too (see below).
4. Deploy.

Two things to know first.

- Without `LOOOT_INTENT_ADMIN_PASSWORD` the app serves no admin route. It shows the setup page at `/login` and nothing else. Set the password before you put the URL anywhere. See [Securing a deployment](#securing-a-deployment).
- A live run saves its result with `writeState` after the calls are paid. The default folder is `.looot-intent` next to the app, which a serverless function may not be able to write. Set `LOOOT_INTENT_DIR` to a writable folder. On Vercel that is `/tmp`, which does not persist between invocations. For history across runs use the CLI, or a host with a persistent disk.

There is no scheduled workflow in this repo.

## Securing a deployment

Versions 0.1.3 and older had no admin authentication. From 0.1.4 every route is either public on purpose or admin, and the admin routes are closed unless you set a password.

### Route map

The routes are listed in `src/lib/auth/routes.ts`. A test reads `src/app` and fails if a route is missing from that file or if an admin route does not call the gate. A path that is not listed is treated as admin.

| Kind | Count | Routes |
| --- | --- | --- |
| Public by design | 4 routes | `/login`, `/api/auth/login`, `/api/auth/logout`, `/api/health` |
| Admin pages | 3 | `/` (ranking, quote and run panel), `/accounts/[domain]`, `/costs` (budget and cost) |
| Admin API | 3 | `/api/quote` (reads the public catalog, free), `/api/run` (paid looot run), `/api/budget` (read, and change the period budget) |

There are no server actions and no export routes. The CLI runs on your own machine and does not go through the web gate.

### How the gate works

- `src/proxy.ts` checks every request. Each admin page, the root layout and each admin route handler checks again with the same function, so a path the matcher misses is still closed.
- Not set up (no password, and not a clean demo): admin routes answer 503, admin pages redirect to `/login`, which says what to set. Nothing stored is rendered.
- Demo (`npm run demo`): no sign-in, a "Demo, no sign-in" badge, sample data only. It refuses to open when `LOOOT_TOKEN` is set or a saved run exists, unless an admin password is also set.
- Sign-in: constant-time password comparison. A session is a signed token in an httpOnly, SameSite=Lax cookie, Secure in production, valid for 8 hours. 5 wrong passwords from one address lock that address for 15 minutes. 40 wrong passwords from anywhere lock sign-in for everyone for 15 minutes, which also lets an attacker delay you, so use a long password.
- State-changing admin requests need a same-origin `Origin` header and the per-session token in `x-intent-csrf`. The layout puts the token in a meta tag and the app's own fetch calls send it.
- Admin responses carry `Cache-Control: no-store`. All responses carry a Content-Security-Policy (`frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. The CSP allows inline scripts because Next.js needs them.

### Spending

`POST /api/run` takes its ceiling from the server: `LOOOT_INTENT_MAX_RUN_USD`, default 5. The browser sends the quote total it saw as `confirmedMaxMicros`, which only checks the price: it neither lowers nor raises the ceiling. The server prices the list again before any paid call and refuses when that price is above the server cap or above the confirmed quote. A `capUsd` field in the body is ignored. Then comes the period budget: a daily and a monthly amount, changed only by the signed-in owner (`PUT /api/budget`, session and CSRF token), never by a run request. Each paid call reserves its price against the budget before it is made. See [Spending](#spending). The looot token balance is the final limit, so give the app a token funded with only what you are willing to spend, and run one instance on a persistent disk, because the budget file is not shared between hosts. Each session may start 6 runs in 10 minutes, then gets a 429. The limiter is in memory, so behind several instances also rate limit at your proxy.

### Setup

```bash
export LOOOT_INTENT_ADMIN_PASSWORD='a password of 12 or more characters'
# or keep it out of the environment as plain text:
npm run hash-password -- 'a password of 12 or more characters'   # prints LOOOT_INTENT_ADMIN_PASSWORD_HASH=...
```

Rotate the password by changing the variable and restarting. Changing it signs every session out. The saved run (`.looot-intent/state.json`, or `LOOOT_INTENT_DIR`) is a plain file on the server's disk. The cookie is `Secure` in production, so use https.

### The stronger option

A shared password is the floor. For anything people other than you can reach, put the app behind a VPN, a private network or an identity-aware proxy (Cloudflare Access, Tailscale, Google IAP, oauth2-proxy), and keep the app's password on as well.

### Not covered

No per-user accounts, no roles, no record of who signed in. The app has one admin.

## Signals

Job ids and prices are from the public looot catalog, read 2026-10-10. Prices are per call in USD, except buying intent, which is per result.

| Signal | Provider | looot job | Endpoint | Price |
| --- | --- | --- | --- | --- |
| Hiring and job ads | PredictLeads | `jobs.company` | `predictleads-companies-job-openings` | $0.0100 |
| Funding | PredictLeads | `company.funding` | `predictleads-companies-financing-events` | $0.0100 |
| Company news | PredictLeads | `company.news` | `predictleads-companies-news-events` | $0.0100 |
| Tech stack changes | PredictLeads | `company.technographics` | `predictleads-companies-technology-detections` | $0.0100 |
| SEO movement | DataForSEO | `keywords.domain.overview` | `dataforseo-dataforseo-labs-google-domain-rank-overview-live-ai` | $0.0120 |
| Web traffic | Datagma | `company.traffic` | `datagma-website-traffic` | $0.06532 |
| Google ads | Scrape Creators | `google.company.ads` | `scrapecreators-google-company-ads` | $0.00188 |
| LinkedIn ads | Scrape Creators | `ads.linkedin.search` | `scrapecreators-linkedin-ads-search` | $0.00188 |
| Reddit mentions | Scrape Creators | `reddit.post.search` | `scrapecreators-reddit-search` | $0.00188 |
| Headcount growth | CompanyEnrich | `company.workforce` | `companyenrich-companies-workforce` | $0.0490 |
| Third-party buying intent | TheirStack | `companies.buying-intents` | `theirstack-companies-buying-intents` | $0.0981 per result, 1 result per account |

All eleven together cost $0.27006 per account at list price (the ten per-call signals $0.17196, plus $0.0981 for one buying-intent result). A typical run of 25 accounts is 25 x $0.27006 = $6.75 and 100 accounts is $27.01. Turn a signal off in the config to drop its cost: buying intent is $0.0981 of the $0.2701, and web traffic and headcount together are $0.1143.

Buying intent was added in 0.1.5. It reads the topics TheirStack detects in a company's job posts, each with a confidence level, a job-post count and first and last dates seen. The catalog lists no response fields for it, so the parser is tolerant (it accepts a list of topics under `buying_intents`, `intents`, `keywords`, `technologies` or `topics`, or a flat list) and the signal is marked unverified, like the other ten. A hand-written fixture is in `src/engine/fixtures/theirstackBuyingIntents.json`. It is job-post based intent, not the bidstream or content-consumption data 6sense sells.

LinkedIn ads moved on 2026-10-10. `adyntel-linkedin` returns 404 on the live catalog, so the signal now runs `scrapecreators-linkedin-ads-search` at $0.00188 per call. It searches by company name, so the app sends the first label of the domain (`acme.com` becomes `acme`), which can match the wrong company for common words. The response shape has not been checked against a real run, so the signal stays marked unverified.

## How a score is built

1. Each enabled signal gets points out of 100, in proportion to its weight. Weights of the enabled signals are scaled to add up to 100.
2. Event signals (jobs, funding, news, tech, ads, Reddit): every event counts `0.5^(age / half-life)`, at 40% when it does not match the ICP. The sum divided by the signal's `saturation` is its strength, capped at 1.
3. Growth signals (traffic, headcount) compare this reading with the one saved from your last run. The first run records a baseline and scores zero for that signal. SEO movement uses the share of ranking keywords that moved up net of down, which the provider returns in one call.
4. Stage: `aware` from 20, `considering` from 45, `deciding` from 70 and only when at least 3 categories show signal. Otherwise the account stays `considering`.

There is no model and no hidden constant. The ICP description is stored with the run and shown, but matching uses the keyword lists in the config (job title words, technologies, news categories), so the result is the same every time for the same data.

## What is dropped

- No first-party visitor tracking, no bidstream or content-consumption intent (Bombora-style topic surge), no CRM sync, no ad orchestration. 6sense has these. Searches of the looot catalog for `bombora`, `6sense`, `g2 intent`, `intent topics`, `topic surge` and `buyer intent` found no such source. The one third-party intent source the catalog has is TheirStack buying intent (now a signal), which is derived from job posts. `dataforseo` search-intent endpoints classify what a keyword means (informational, commercial) and say nothing about an account, so they are not used.
- No G2, Capterra or Trustpilot review signal. Searches for `g2`, `capterra`, `trustpilot`, `software reviews`, `review site` and `company reviews` found no such source. The review endpoints that exist (Google Maps, App Store, Tripadvisor, Facebook page, Google Shopping, Amazon) take a place, app, product or page id, not a company domain or name, and the Better Business Bureau endpoints take a BBB id or a keyword plus a location. None can be keyed from a domain through a documented input, so none is used.
- Demo accounts use the reserved `.example` domain. The data is generated, not real.

## Troubleshooting

Messages are quoted from the code. The CLI prints them as shown. Messages that begin "Stopped:" carry the text looot returned.

| You see | What it means | What to do |
| --- | --- | --- |
| `LOOOT_TOKEN is not set. Create a key at https://looot.ai, or try --demo or --dry-run.` | No token in the environment. Exit code 2. | `export LOOOT_TOKEN=...` in the same shell. The CLI does not read `.env.local`. |
| `LOOOT_TOKEN is not set on the server. Set it, or start the demo with npm run demo.` (HTTP 503) | The web UI has no token. | Put it in `.env.local` and restart `npm run dev`, or add it in Vercel. |
| `Stopped: <message from looot>` after a 401 or code `unauthorized`, `invalid_token`, `missing_token` | looot rejected the token. The run stops at the first one. | Create a new token in Settings > Agent tokens with the four scopes listed above. |
| `Stopped: <message from looot>` after a 402 or code `insufficient_funds`, `payment_required` | The balance is too low. | Top up (minimum $5) at https://docs.looot.ai/money, then run again. Finished calls replay free. |
| `Run <id> is blocked.` or status `failed` with the error code looot gave | A call was blocked or failed. It is counted in "calls failed" and not charged. | Read the code in the report, then retry. |
| `Run <id> is queued.` / `running` / `pending_provider`, shown as `pending` | The provider had not finished when waiting stopped (60 s). Not a failure. | Run the same command again in the same window. |
| `unreadable` next to a signal (status `parse_error`) | The response did not match what the parser expects. | See "How to file an issue". |
| `Source unavailable: <endpoint> has no readable price in the catalog.` | The public catalog has no readable call price for that endpoint, so the calls are skipped and the signal scores zero. | Use `--offline` for the dated prices, or turn the signal off in the config. |
| `Refused: the quote is above the cap. Raise --max-spend, score fewer accounts, or pass --partial to run until the cap.` | The quote is above `--max-spend`. Exit code 2. | Do what it says. |
| `Unknown option --x. Run with --help.` | A flag typo. The CLI stops so a typo never runs with defaults. | Fix the flag. |

How to file an issue. Open one at https://github.com/loootai/looot-intent/issues with the run id (printed in the report and shown in the web UI), the command you used, and the raw response body with secrets removed.

## Status

No paid looot run was made. Request fields follow each endpoint's documented parameters in the catalog. Response parsers are built from provider docs and fixtures and read defensively, but no real response body has been checked against them. `shapeVerified` is `false` for all eleven signals in `src/engine/signals.ts`. Expect to adjust a parser after your first live run, and run `--dry-run` and a 2-domain run first.
- The PredictLeads path parameter is sent as `company_id_or_domain`, as its description says. The catalog parameter list does not show it.

If a parser fails on a real response, open an issue with the raw body (see Troubleshooting).

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
