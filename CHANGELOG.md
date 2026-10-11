# Changelog

Built from the GitHub release notes. Each version links to its release page.

## 0.1.5 (2026-10-11)

#### Added: third-party buying intent

The catalog has a buying-intent source after all, so the README no longer lists it as dropped. A review-site signal is still dropped, see below.

- New signal `intent_topics`, "Third-party buying intent", from TheirStack. looot job `companies.buying-intents`, endpoint `theirstack-companies-buying-intents`. It lists the buying-intent topics TheirStack detects in a company's job posts, each with a confidence level, a job-post count and first and last dates seen.
- Price $0.0981 per result. The app sends `limit: 1`, so one account costs at most one result. The quote and the spend cap reserve that full price before the call, the idempotency key and signed quote flow are unchanged, and the caller cannot set the limit.
- Own weight (14), half-life (60 days) and saturation (3 topics) in `config/intent.config.json`. Set `enabled` to false to turn it off.
- Typical cost at list price rises from $0.1720 to $0.2701 per account. 25 accounts is $6.75 (was $4.30) and 100 accounts is $27.01 (was $17.20). The default $5 web cap covers 18 accounts; raise `LOOOT_INTENT_MAX_RUN_USD` or `--max-spend` for more, or switch the signal off.
- The price check now reads per-result prices for endpoints that are priced that way, so the live quote does not call the endpoint "source unavailable".
- The quote table, run panel and cost panel show the provider and a "/result" mark on the price.
- The response parser is tolerant and unverified: the catalog lists no response fields for this endpoint and no paid run was made. A hand-written fixture is in `src/engine/fixtures/`.
- Still dropped: Bombora-style topic surge and bidstream data, and G2, Capterra and Trustpilot review signals. Catalog searches found no source for them. The review endpoints that exist need a place, app or product id, not a domain.
- Tests: 106 before, 117 after.

## 0.1.4 (2026-10-11)

#### Security fix: the admin routes are now closed

Versions 0.1.3 and older had no admin authentication. Anyone who could reach a running copy could read the saved run and start paid looot runs on your token, with a spend cap they chose. If you run v0.1.3 or older on a host other than your own machine, upgrade to v0.1.4 and set `LOOOT_INTENT_ADMIN_PASSWORD` (12 characters or more).

What changed
- Every page and API route except `/login`, `/api/auth/login`, `/api/auth/logout` and `/api/health` needs a signed session. Without a password set, the web UI shows a setup page and serves nothing else.
- Sessions are signed httpOnly SameSite=Lax cookies (Secure in production) that last 8 hours. 5 wrong passwords lock an address for 15 minutes.
- State-changing requests need a same-origin check and a CSRF token.
- `POST /api/run` takes its ceiling from the server (`LOOOT_INTENT_MAX_RUN_USD`, default 5), not from the browser. It prices the list again before spending, refuses if the price is above the cap or the quote you confirmed, and allows 6 runs per session per 10 minutes.
- `npm run demo` stays open with a "Demo, no sign-in" badge and refuses to start next to a `LOOOT_TOKEN` or a saved run.
- Security headers on every response. Admin responses are never cached.

Upgrade steps
1. Set `LOOOT_INTENT_ADMIN_PASSWORD` (or `LOOOT_INTENT_ADMIN_PASSWORD_HASH` from `npm run hash-password`).
2. Optional: set `LOOOT_INTENT_MAX_RUN_USD`.
3. Restart. The web UI now asks for the password. The CLI is unchanged.

The README section "Securing a deployment" has the route map and the stronger option of a VPN or identity-aware proxy.

[Release page](https://github.com/loootai/looot-intent/releases/tag/v0.1.4)

## 0.1.3 (2026-10-10)

LinkedIn ads signal now uses scrapecreators-linkedin-ads-search, since the earlier endpoint left the looot catalog. A signal whose endpoint is missing shows as source unavailable instead of being skipped silently.

[Release page](https://github.com/loootai/looot-intent/releases/tag/v0.1.3)

## 0.1.2 (2026-10-10)

Sidebar layout: left sidebar that collapses to an icon rail, drawer on phones, spend panel, docs and GitHub links.

[Release page](https://github.com/loootai/looot-intent/releases/tag/v0.1.2)

## 0.1.1 (2026-10-10)

Dependency security bump. next and eslint-config-next 16.3.7 to 16.3.8, which fixes six Next.js advisories (GHSA-3w37-wq28-93x7, GHSA-4jqv-mc3x-m676, GHSA-39w2-rjm5-chcv, GHSA-f87g-xv8r-7p7x, GHSA-mcj8-r9mp-w47p, GHSA-cjq9-62q9-8jv4). No code changes. v0.1.0 is unchanged.

[Release page](https://github.com/loootai/looot-intent/releases/tag/v0.1.1)

## 0.1.0 (2026-10-09)

First release. Account intent scoring on looot: ten signals from nine categories, explainable score and buying stage, quote before run, spend cap, demo mode, CLI and web UI. No paid looot run has been made; response parsers are built from provider docs and fixtures. See the README section on what is not tested.

[Release page](https://github.com/loootai/looot-intent/releases/tag/v0.1.0)
