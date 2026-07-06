# Hearth — Change Log (July 2026 work sessions)

**Server:** home-app-server (10.0.0.24) · **Repo:** `~/home-finance/` → GitHub `auzi-rgb/hearth` (private, SSH)
**Span:** 2026-07-03 → 2026-07-06 · **Baseline commit:** `60a562d` (as-built before any fixes)
**Net:** 17 files, +4,431 / −1,249 lines across 20 commits.

This file is a session narrative of what changed and *why*. For the authoritative
current-state reference (schema, endpoints, constraints), see `HEARTH-CONTEXT.md`.

---

## How this started

A QC/debugging pass on Hearth (built by Sonnet) for the household that runs it —
two adults, one child, looking to live month-to-month instead of paycheck-to-paycheck,
pay off debt first, then save. Recurring theme across every session: **finding places
where two parts of the app computed the same thing differently and reconciling them to
one source of truth.**

---

## Safety net & correctness (2026-07-03)

- **Version control from scratch** — `git init`, `.gitignore` (finance.db, backups, dist, node_modules), baseline commit, later pushed to private GitHub `auzi-rgb/hearth` over SSH.
- **requirements.txt fixed** — was missing 4 of the real dependencies; pinned all to installed versions. Corrected the false "bcrypt 4.0.1" claim (actually 3.2.2; must stay < 4.1 for passlib).
- **Nightly DB backups** — `sync.py` 3:30am job, SQLite online-backup API, keeps 14, to `backend/backups/`.
- **Fresh-install crash fixed** — `accounts.nickname` and `bills.display_name` had been hand-ALTERed on prod only; added real migrations so a rebuilt DB works.
- **HEARTH-CONTEXT.md rewritten** — line-by-line audit; removed endpoints that never existed, fixed TMRS keys, added a Known Issues list.

## Configurable household (2026-07-03)

- Names, employers, and pay-range heuristics moved out of code into a `household_members` setting (Settings → Household). Paycheck attribution now learns from **recent actual paychecks in the DB** (median of last checks) rather than static ranges — self-updating after a COLA raise.
- Bills/Food **account roles** made explicit (Settings, later moved to per-account badges on the Accounts page).
- Paycheck detection floor and bank transfer-detection phrases exposed as settings.

## Information-architecture pass (2026-07-03, Session 7)

- **Retired the legacy low-balance banner** — it tested one number ("spendable") but displayed another (raw balance), so its sentence was always wrong. The day-by-day cash-flow simulation's `overdraft_warnings` is now the only warning source.
- **Settings became a hub** of cards → sub-pages with clickable breadcrumbs.
- **Setup-vs-use rule:** controls live on the page that uses them — account roles + CSV import → Accounts; category rules → Spending; AI memory → Assistant; safe-spend buffer inline on Dashboard.

## Goal-oriented features (2026-07-03, Session 8)

- **Transfer workflow** — record transfers; configurable schedule (replaced an invented hardcoded 1st/15th).
- **Debt countdown** on the Dashboard (debt-free date from a shared avalanche sim).
- **Food runway** — daily allowance vs 14-day actual pace.
- **Bill-creep watchdog** + annual-cost ranking on the Bills page.
- **Month in Review** reports (Overview), auto-generated on the 1st.
- **Nightly AI coach briefing** — 3:45am job builds a Python-computed context and has `qwen2.5:14b` (via the 10.0.0.24 gateway → austin-ai) *phrase* it, never compute. Guardrails added after live tests (it said "last year" for "last month", and coached about already-paid bills — fixed by feeding it `bill_paid_months` and explicit field meanings).

## The income model — three layers (2026-07-03 → 07-05)

The user caught monthly income reading $14,992 when it's normally ~$11k. Not a bug — July is a
double extra-paycheck month — but there was no way to inspect it. This drove a rework:

- **Income card** on Accounts showing per-member paycheck counts/dates and a typical-month average; single `compute_month_income` shared with the Dashboard.
- **Baseline income** (`compute_baseline_income` = usual paycheck count × median of last 4 checks) is now THE planning number. Budget/About plan against baseline; the actual month is a side annotation. Fixed the "extra paycheck = free money" fallacy — the user pushed back (a late-month check mostly funds next month's first bills), verified in data, and the coach now reasons only from the day-by-day simulation.
- **Freshness guard** — safe-to-transfer shows its sync timestamp; red if balances are > 26h stale.
- **Surplus sweep** — flags true surplus above the household's typical recorded transfer.

## Contribution tier & the squeeze guard (2026-07-05)

- New `Contribution` bill type for chosen savings/investment transfers (HYSA/Roth/529), separated from the hardline (Monthly Bills + Debt Payoff). Bills page became a grouped line-item ledger.
- **Squeeze guard** — when baseline − hardline − contributions leaves less to live on than the household actually spends, a red banner directs cuts at Contributions first, never food. (This surfaced that their budget is far below actual spending.)
- Baseline window 8→4 checks; weekly bills now render on the Calendar.

## Link spending → bills (2026-07-05)

- A recurring charge sitting in uncategorized spending (e.g. Wegovy "RO HEALTH GETROMAN.COM NY") can now be linked to a bill (existing or new) from the Spending page. Sets a `merchant_pattern` (fixes the fragile name[:8] matching), adds a merchant rule, and recategorizes history. Pattern picks the longest word ("getroman", not "ro" which would swallow Rosa's Cafe).

## Calendar overhaul (2026-07-05 → 07-06)

- Honest summary bar (full expected income, "Left after bills"), transfer-day chips, the simulation's **tight-day** marker, tier-colored bill chips, "looks-paid → confirm" suggestions, pay-period bands, and a subscribe-able **iCal feed** (tokened `/api/calendar.ics`; Apple Calendar on LAN works, Google's cloud fetch can't reach the LAN).
- **Cross-month carry-forward fix** — paging to next month restarted the projection from today's balance and slid negative. Extracted ONE `cash_flow_projection` used by both the Dashboard's safe-to-transfer AND the Calendar overlay, projecting continuously so July's month-end IS August 1st's start. (Also fixed a latent Dashboard bug: the 60-day window only counted the next occurrence of each monthly bill.)
- **Autopay reframe** — bills autopay from a funded Bills account, so the ledger was noise. Added an `autopay` flag; the sidebar became a **health panel** answering the two real questions (Is Bills funded? Are we overspending living money?). Autopay bills mute and stop nagging; only manual bills surface as action items.

## The committed-budget equation (2026-07-06)

- **`y` = committed budget** — a "Commit Budget" button on the Budget page saves the number the rest of the app plans against; editing category sliders is a draft until committed.
- **Planned transfers** fund Food with `y` split across two dates; each can **shift within a 3-day window** (`transfer_window_days`) to the earliest day it's fully safe — so a transfer scheduled the day before payday waits for the paycheck instead of being falsely capped (the user caught the phantom $191 cap on the 15th; now shifts to the 17th for the full $725).
- **Surplus to debt** = `s = P − B − D − C − U`, the number that grows as bills shrink or spending drops. Shown across Budget/Dashboard/Calendar.
- **Pressure-tested** the equation: identity holds everywhere ($41.02); reconciled two competing "transfer" labels; folded the savings goal into C so it can't drift. Big finding: **L (actual living spend, ~$5.4k) is measured on a different basis than U (budget, $1.45k)** — the budget is aspirational/incomplete. The **About page** now carries the physics compact form `s = P − (B+D+C+U) − (L−U)Θ(L−U) − ∮r·Q dt` with live values and a **phase-transition chart** showing where actual spend crosses break-even.

## Mobile review (2026-07-06)

- Real bug fixed: the **Bills table** (9 fixed columns) clipped its Edit/Delete buttons off-screen on phones — now horizontally scrollable.
- About padding and the Calendar legend tightened for small screens. Foundation (hamburger drawer, calendar stacking, 44px touch targets) was already solid.

---

## Standing constraints (reminders)

- `bcrypt` must stay < 4.1 (passlib 1.7.4). Installed 3.2.2.
- Deploy: `sudo systemctl restart hearth` (backend) + `sudo cp -r ~/home-finance/frontend/dist/. /var/www/hearth/` (frontend, after `npm run build` via nvm).
- `sudo` is interactive — deploy steps go to the user.
- Commit to git after every working change; never commit finance.db.
- AI coach/assistant run on austin-ai (MacBook Pro, CPU/Metal) via the gateway at `https://10.0.0.24/gateway/api`; keep AI work to phrasing precomputed numbers, not calculation.
