# HEARTH — Project Context
Last updated: **2026-07-03** (Session 6 — QC review, audited line-by-line against the code)

Self-hosted home finance app. FastAPI backend + SQLite + React SPA.
Run at `~/home-finance/`. Web UI served at `/hearth` via nginx reverse proxy.

> This file was rewritten in Session 6 after it had drifted badly from the code
> (it documented endpoints that didn't exist and a bcrypt pin that wasn't real).
> **If you change the code, change this file in the same session.**

---

## Services

| Service | Port | Config |
|---------|------|--------|
| Backend (FastAPI) | 8100 | `sudo systemctl restart hearth` |
| Frontend (nginx) | — | `sudo cp -r dist/. /var/www/hearth/` |

**Backend entry:** `~/home-finance/backend/main.py`
**Frontend entry:** `~/home-finance/frontend/src/App.jsx`

Build + deploy frontend:
```bash
cd ~/home-finance/frontend && source ~/.nvm/nvm.sh && npm run build && sudo cp -r dist/. /var/www/hearth/
```

> **IMPORTANT:** nginx serves Hearth from `/var/www/hearth/` — NOT `/var/www/finance/`.

Backend restart (after any `main.py` / `sync.py` change):
```bash
sudo systemctl restart hearth
```

## Version control & backups (Session 6)

- `~/home-finance` is a **git repository** (branch `main`). Commit after every working change.
  `finance.db`, its backups, `dist/`, and `node_modules/` are gitignored — never force-add them.
- **Nightly DB backup** at 3:30am (APScheduler job in `sync.py::backup_database`) to
  `backend/backups/finance-YYYYMMDD-HHMMSS.db`, keeping the newest 14. Uses sqlite's online
  backup API, safe while the app runs.
- Not yet pushed to GitHub. If pushing: **private repo only**; the DB is gitignored but review
  history before pushing anything.

---

## Tech Stack

- **Backend:** Python 3 (system python, no venv), FastAPI, SQLite (WAL mode), `python-jose` (JWT), `passlib`+`bcrypt` (password hashing), `slowapi` (rate limiting, currently only on `/api/ai/chat`), SimpleFin bank sync, APScheduler
- **Frontend:** React + Vite, no Tailwind, Apple-style CSS variables
- **CSS classes:** `apple-card`, `apple-btn-primary`, `apple-btn-secondary`, `apple-btn-danger`, `apple-input`, `apple-label`, `apple-select`
- **Auth:** JWT (8h expiry) stored in localStorage; `/hearth/api/*` prefixed via nginx; frontend uses `const API = '/hearth/api'`; `api.js` monkey-patches `window.fetch` to inject the Bearer token and broadcast 401s
- **Dependencies:** `backend/requirements.txt` is pinned to the versions actually installed (verified via pip freeze 2026-07-03). bcrypt is **3.2.2** (not 4.0.1 as this file previously claimed). passlib 1.7.4 breaks with bcrypt ≥ 4.1 — keep bcrypt below that.

## AI Gateway

Backend proxies AI calls to `https://10.0.0.24/gateway/api` (hardcoded `GATEWAY_URL` in main.py),
self-signed cert, hence `verify=False` on those httpx calls. NOTE: `verify=False` is currently
also applied to SimpleFin calls — known issue, see Known Issues.

---

## Database

**Path:** `/home/austin/home-finance/backend/finance.db` (gitignored)
All migrations are idempotent `ALTER TABLE … ADD COLUMN` wrapped in `try/except` inside `init_db()`. Safe to re-run on restart. **Never ALTER the production DB by hand — add a migration.** (Session 6 fixed two hand-added columns, `accounts.nickname` and `bills.display_name`, that crashed fresh installs.)

### Key Tables

**`bills`** — recurring/loan/debt payment obligations
```
id, name, display_name, expected_amount, confidence (fixed|estimated),
day_of_month, day_of_week, frequency (monthly|weekly),
account_id, is_active,
bill_type (TEXT legacy: required|optional — no longer used by Bills.jsx),
payment_type (TEXT: Recurring|Loan|Debt),
from_debt_budget (INTEGER 0/1),
linked_loan_id (→ loans.id, for payment_type='Loan'),
linked_account_id (→ accounts.id, for payment_type='Debt'),
notes
```

**`bill_paid_months`** — per-month payment tracking: `id, bill_id, month (YYYY-MM), paid_date`, UNIQUE(bill_id, month)

**`accounts`** — bank/credit/loan accounts (synced via SimpleFin)
```
id, name, nickname, type (checking|savings|credit|loan|personal_loan|investment),
institution, simplefin_id, is_active,
current_balance, balance_date, interest_rate, minimum_payment, created_at
```

**`loans`** — manually-tracked loan amortization
```
id, name, type, original_balance, current_balance, interest_rate,
monthly_payment, payments_made, total_payments, start_date
```

**`paychecks`** — income log: `id, person, expected_amount, actual_amount, expected_date, actual_date, is_third_friday_period, notes`. Rows with notes='auto-detected' come from sync. **No DELETE endpoint exists** — known issue.

**`transactions`** — ledger: `id, account_id, amount, description, category, transaction_date, posted_date, is_pending, is_transfer, category_confirmed, created_at`

**`settings`** — key-value store. Keys in use:
- `jwt_secret`, `simplefin_access_url` (both hidden from GET /api/settings and blocked from PUT)
- `household_members` — **JSON list** of `{key, label, payroll_keywords[], amount_min, amount_max, default_frequency}`; seeded on startup from `sync.DEFAULT_HOUSEHOLD`; edited in Settings → Household. Drives paycheck detection/attribution. (Session 6 — replaced hardcoded names/employers/pay-ranges.)
- `bills_account_id`, `food_account_id` — explicit account roles, set via Role selector on each account card (Accounts page). Empty = legacy fallback of matching "bills"/"food" in the account name (`find_role_account` in main.py).
- `payday_dow_{member_key}`, `payday_frequency_{member_key}`, `payday_anchor_{member_key}`
- `safe_spend_buffer` — edited inline on the Dashboard's "Bills buffer" row; also drives Calendar red-day coloring. (`low_balance_threshold` retired in Session 7 — the static threshold banner was superseded by the cash-flow simulation's `overdraft_warnings`.)
- `ai_default_model`, `ai_system_prompt`, `ai_temperature`, `ai_autorun`, `ai_autorun_prompt`
- TMRS keys: `tmrs_account_balance`, `tmrs_your_contributions`, `tmrs_interest`, `tmrs_city_contributions`, `tmrs_monthly_deposit`, `tmrs_retirement_eligible_date`
  (previous versions of this file listed different TMRS key names — these are the real ones)

Other tables: `budgets`, `merchant_rules`, `categories` (primary/secondary taxonomy), `net_worth_history`, `sync_log`, `users`, `ignored_bill_patterns` (created but currently unused by any endpoint), `ai_facts`, `ai_sessions`.

---

## Backend API Endpoints (verified against code 2026-07-03)

### Public (no auth)
- `GET /api/health`
- `POST /api/auth/login` · `POST /api/auth/change-password`

### Accounts
- `GET /api/accounts` (`?include_inactive=true`) — each row includes computed `balance` and `display_name` (nickname or name)
- `POST /api/accounts` · `PUT /api/accounts/{id}` · `DELETE /api/accounts/{id}` (soft-delete, marks txns is_transfer=1)
- `POST /api/accounts/{id}/reactivate` · `PUT /api/accounts/{id}/nickname` · `PUT /api/accounts/{id}/type` · `PUT /api/accounts/{id}/debt-details`

### Dashboard & Calendar
- `GET /api/dashboard` — balances, net worth, upcoming bills, payday projections per household member (`next_income` = `{<member_key>: …, soonest: …}`), day-by-day cash-flow simulation, `overdraft_warnings`, `suggested_transfer`. Fields `encumbered_30d`, `recommended_transfer`, `spendable_in_food` are **dead stubs always returning 0** (nothing in the frontend reads them). Session 7 removed `spendable`, `safe_to_spend`, `low_balance_warning`, `low_balance_threshold` — the simulation's `overdraft_warnings` is the only warning source.
- `GET /api/calendar?month=YYYY-MM` — returns `safe_spend_buffer` (not the retired threshold) for running-balance coloring

### Bills
- `GET /api/bills` — computed: `next_due`, `days_until`, `rolling_min/max`, `paid_this_month`, `monthly_equivalent` (weekly×52/12), `linked_name`
- `POST /api/bills` · `PUT /api/bills/{id}` · `DELETE /api/bills/{id}` (soft-delete)
- `PATCH /api/bills/{id}/type` · `PUT /api/bills/{id}/paid` · `GET /api/bills/history`

> The bill auto-detect endpoints this file used to list (`detect-statistical`, `detect-ignore`, `detect-ai`) and `GET /api/line-items` and `GET /api/forecast` **do not exist in main.py**. Nothing in the frontend calls them.

### Loans & Debt
- `GET/POST /api/loans` · `PUT/DELETE /api/loans/{id}` · `POST /api/loans/{id}/set-bill`
- `GET /api/debt/summary` (includes `unlinked_debt_bills`) · `POST /api/debt/set-bill`
- `GET /api/debt/payoff-projection` · `GET /api/debt/strategies?extra_monthly=N&cards_first=bool` (snowball vs avalanche simulation)

### Transactions & Spending
- `GET/POST /api/transactions` · `PUT /api/transactions/{id}/category` (`apply_to_merchant` creates a merchant rule)
- `POST /api/transactions/dedup-pending`
- `GET /api/spending/summary` · `GET /api/spending/transactions` · `GET /api/spending/top-merchants` · `GET /api/spending/merchants-by-category`

### Budgets, Categories, Rules
- `GET /api/budgets` · `GET /api/budgets/{primary}/breakdown` · `PUT/DELETE /api/budgets/{category}`
- `GET/POST /api/categories` · `DELETE /api/categories/{name}` (base categories protected)
- `GET /api/merchant-rules` · `DELETE /api/merchant-rules/{id}`

### Paychecks
- `GET /api/paychecks` · `GET /api/paychecks/upcoming` · `POST /api/paychecks` · `PUT /api/paychecks/{id}`
- **No DELETE** — auto-detected false positives currently require SQL to remove (known issue)

### Settings / TMRS / Sync / Import / Net worth
- `GET /api/settings` · `PUT /api/settings/{key}` (jwt_secret and simplefin_access_url blocked)
- `GET/PUT /api/tmrs`
- `POST /api/sync` · `GET /api/sync/log` · `POST /api/simplefin/setup` · `POST /api/simplefin/reset`
- `POST /api/import/csv?account_id=N` (USAA or Chase format)
- `POST /api/net-worth/snapshot`

### AI
- `POST /api/ai/chat` (rate-limited 20/min, streams) · `GET /api/ai/health` · `GET /api/ai/models` · `POST /api/ai/test`
- `POST /api/ai/suggest-categories` · `GET /api/ai/context`
- Memory: `GET /api/ai/memory` · `POST /api/ai/memory/session` · `GET /api/ai/memory/sessions` · `GET /api/ai/memory/sessions/{id}/transcript` · `PUT/DELETE /api/ai/memory/facts/{id}` · `DELETE /api/ai/memory/facts` · `DELETE /api/ai/memory/sessions`

---

## Frontend Pages (`src/pages/`)

Dashboard, Overview, Accounts, Calendar, Spending, Budget, Bills, Debt, About, AI, Settings, Login.
(`LineItems.jsx`, listed in older versions of this file, does not exist.)

`src/lib/dashboardFields.js` — shared getters for dashboard payload fields displayed on multiple pages (currently `getMonthlyIncome`). Add a getter there for any field more than one page reads.

### Information architecture rule (Session 7)
**Setup lives in Settings; daily-use controls live on the page that uses them.** When adding a new control, place it by that rule:
- **Settings** is a hub of cards → sub-pages (`view` state in Settings.jsx; breadcrumb rendered in App.jsx's title strip via the `onCrumb` prop): **Connections** (SimpleFin) · **AI Assistant** (model/persona/temperature/auto-run/context) · **Household** (members + payroll keywords + pay ranges + per-member pay schedule, one Save) · **Security** (password)
- **Accounts** — Role selector on each checking/savings card (Bills/Food, exclusive; writes `bills_account_id`/`food_account_id`) + CSV Import card
- **Spending** — Auto-Category Rules card (rules are created here via "apply to merchant"); account filter defaults to the Food-role account
- **Assistant** — ◐ Memory toolbar button → inline MemoryPanel (facts, sessions, clear)
- **Dashboard** — safe-spend buffer edited inline on the "Bills buffer" row

---

## Key Business Logic

### Paycheck detection (sync.py `_detect_paychecks`)
Runs after each sync. A checking-account deposit > $500 is a paycheck if it matches generic payroll keywords or any household member's `payroll_keywords`; otherwise only if it lands on a configured payday day-of-week ±1 day (Session 6 — was hardcoded Thu/Fri). Attribution: member keywords first, then member pay-range (`amount_min`/`amount_max`), then first member. Skip keywords: interest/principal/transfer/zelle/venmo/refund.

### Payday projection (`detect_next_payday`)
Anchored to configured day-of-week + frequency per member, not "last paycheck + interval," so a holiday-shifted deposit doesn't permanently drift the schedule. Amounts averaged from recent actuals with outlier trim.

### Dashboard safe-to-spend
Day-by-day simulation of bills out / paychecks in over 60 days; `safe_today` = lowest projected balance minus `safe_spend_buffer`. `suggested_transfer = max(0, safe_today)`. Same simulation feeds `overdraft_warnings`.

### Bill `payment_type`
`Recurring` (default) · `Loan` (linked_loan_id) · `Debt` (linked_account_id). Weekly bills use `frequency='weekly'` + `day_of_week`; their monthly cost is `monthly_equivalent`.

### Scheduler (sync.py, started from lifespan)
2:00am daily SimpleFin sync · 3:00am net-worth snapshot · 3:30am DB backup (keep 14).

---

## Session 8 features (2026-07-03)

**The app's purpose** (per the household): live month to month, not paycheck to paycheck. All income lands in the Bills account; bills + debt come off the top; surplus transfers to Food for daily living. Goal order: spend < earn → pay off debt → then savings/retirement.

- **Transfer workflow**: `transfers` table; `GET/POST/DELETE /api/transfers`; Dashboard "Record transfer" button + last-transfer line; schedule configurable via `transfer_schedule` setting (JSON `{"mode":"days","days":[1,15]}` or `{"mode":"payday"}`), edited inline (✎ next to "Next transfer"). Dashboard payload: `next_transfer_date` (ISO), `last_transfer`.
- **Debt countdown**: dashboard payload `debt_total`, `debt_free_date/months` (avalanche sim via shared `_collect_debts`), `debt_change_month` (vs last net-worth snapshot before month start), `debt_focus`. Clickable strip on Dashboard → Debt tab.
- **Food runway**: `food_daily_allowance` (balance ÷ days to next transfer) vs `food_daily_pace` (14-day actual) in Spending Power card; red when over pace.
- **Bill creep**: `GET /api/bills/creep` — `drifting` (latest actual > expected +5%, matched by name[:8]) + `annual` ranking. Banner + collapsible annual view on Bills page.
- **Month in Review**: `monthly_reports` table; `compute_month_review` (income − obligations − discretionary = surplus; debt/net-worth change from snapshots); `GET /api/reports`, `POST /api/reports/generate`; auto-generated on the 1st at 4:00am; card on Overview.
- **Nightly AI coach**: `ai_briefings` table; sync.py `generate_coach_briefing()` at 3:45am — Python computes all numbers (`_coach_context`), model only phrases them (guardrail: never recalculate; explicit field-meaning notes because small models garble labels). Settings: `ai_coach_enabled` (default true), `ai_coach_model` (default qwen2.5:14b — the best model, fine overnight). `GET /api/ai/briefing`, `POST /api/ai/briefing/generate`. Collapsible "Morning Briefing" card on Dashboard.

## Tunable constants (in code, deliberately not in UI)

Settings-backed (editable in UI): `paycheck_min_amount` (default 500, Settings → Household), `transfer_detection_phrases` (USAA defaults, Settings → Connections), `transfer_schedule`, `safe_spend_buffer`, `ai_coach_model`.

Code-only (change requires an edit here + main.py/sync.py):
- Paycheck attribution: 15% tolerance vs last 6 actuals; expected amount = mean of last 5 with >40%-from-median outliers dropped; payday-match window ±3 days; detection window 60 days; payday DOW fallback ±1 day
- Cash-flow simulation lookahead 60 days; upcoming bills capped at 10; paycheck variance badge at >5%
- Debt: estimated min payment max($25, 2% of balance); progress floor interest + 1% of balance; sim cap 600 months; payoff dates use 30-day months
- Bills↔transactions matching: `description LIKE %name[:8]%` (rename a bill → history/creep/rolling stats break); rolling min/max = last 3 txns in 90 days; creep drift threshold +5% over 120 days
- sync.py: `CATEGORY_KEYWORDS` (keyword→category brain), `_map_account_type` keywords, `_SKIP_KEYWORDS`, SimpleFin window 90 days, fuzzy dedup ±1 day (known data-loss issue below)
- Schedule: sync 2:00am, net-worth 3:00am, backup 3:30am (keep 14), coach 3:45am, monthly report 1st 4:00am
- Infra: `GATEWAY_URL` hardcoded in main.py and sync.py; JWT expiry 8h; AI num_ctx 8192 (chat) / 4096 (coach)

## Calendar reframe (Session 8+, autopay model)

The household runs bills on **autopay** from a funded Bills account, so the bill-by-bill ledger is noise. The calendar is built around the two questions they actually monitor:
1. **Is Bills funded?** — will autopay bounce? = the projected low point of the Bills account (`cash_flow_projection` → `low_point`).
2. **Are we overspending living money?** — Food account balance vs sustainable pace (`food_daily_allowance` vs `food_daily_pace`, `runway_days`).

- `bills.autopay` column (default **1**). Autopay bills: no paid-checkbox, no "looks paid" confirmation nag, muted/faded on the calendar grid, show an "auto" tag in day detail. Manual bills (autopay=0, tagged MANUAL on Bills page) keep the paid workflow and surface in the calendar sidebar's "Needs you" list.
- `GET /api/calendar` returns a `health` block (current month only): `bills_status` (ok/tight/danger), `low_point`, `overdraft_warnings`, `suggested_transfer`, `living_status` (ok/over), `food_balance`, `food_daily_allowance/pace`, `runway_days`, `days_until_transfer`.
- Calendar sidebar bottom = **health panel** (Bills funded? + Living money? + transfer action + manual-bill action items), NOT an itemized agenda (tried that in the list-view sidebar; itemizing autopay bills was noise the household explicitly rejected). Grid/list view toggle and per-day detail (top of sidebar, capped height) remain.

## Committed budget model (Session 8+)

The household's planning equation, made real in the app:
- **y = committed budget** (`committed_budget` setting, currently $1,450) — the monthly living allocation the app plans against. Set by **Commit Budget** on the Budget page; editing category limits is a *draft* until committed (rest of the app keeps using the last committed y). `get_committed_budget()` falls back to the live category-limit sum before first commit. Endpoints: `POST /api/budget/commit` (snapshots the live sum or an explicit `value`), `GET /api/budget/committed` (returns committed / committed_at / live_total for the draft indicator).
- **Planned transfers** (`compute_planned_transfers`): fund Food with y split across the two scheduled transfer days (50/50), each capped so it never drops the projected Bills balance below the buffer (sequential — earlier transfers reduce later headroom). In the dashboard/calendar payload as `planned_transfers = {committed_budget, portion, transfers[{date, planned, amount, capped}], total_planned}`. Shown on Calendar transfer chips, the Calendar health panel, and the Dashboard "plan" strip; Record buttons prefill the planned amount for that date.
- **budget_surplus** = baseline_income − hardline − contributions − savings_goal − y. The surplus-to-debt that grows when a bill is trimmed or spending comes in under budget. Matches the Budget page's "Surplus to Debt" chip (currently ~$41). In dashboard + calendar-health payloads.

## The household equation (Session 8+) — pressure-tested

**s = P − B − D − C − U** — the identity the whole app obeys.
- P = baseline_income · B = bills_recurring_total · D = debt_payments_total · C = contributions_total (+ savings_goal; a budget "savings" category is folded into C so the equation can't drift) · U = committed_budget · s = budget_surplus.
- Verified numerically consistent across Dashboard, Budget, Calendar (all read `budget_surplus`; B+D+C conserve; hardline = B+D). On About page as a live equation + physics compact form + phase-transition chart.
- **Y = left_to_live = P − B − D − C** (available to budget). **s = Y − U.** Break-even spend is L = Y (= U + s), so the surplus s IS the entire margin between budget and going negative.
- **L (actual living spend) measurement is basis-dependent — a known tension:** `actual_living_median` counts ALL discretionary across all accounts (~$5.4k for this household); the food-runway uses Food-account outflow only (~$3.5k); U budgets just 4 primary categories (~$1.45k). They answer different questions (true living cost vs Food-account cash vs planned budget) but must be read with that in mind. The household's U is far below actual living spend — the budget is aspirational/incomplete, which the About phase-transition chart shows honestly (L sits deep in the red past break-even).
- **Two transfer numbers, disambiguated:** Dashboard "Safe to move now" = `suggested_transfer` (guardrail, max safe today); the Plan strip / Calendar "planned transfers" = U-based envelope funding. Money Flow "Cash beyond bills (this month)" = actual income − all bills (distinct from the plan's surplus-to-debt).

## Known Issues (from Session 6 QC review — not yet fixed)

1. **Sync fuzzy dedup can drop real transactions** — same account + amount within 1 day with different descriptions is treated as a duplicate (sync.py). Two distinct same-priced purchases on the same day → second one never imported.
2. **Account deactivate→reactivate corrupts is_transfer flags** — reactivation clears the flag on ALL the account's transactions, including genuine transfers.
3. **No rate limit on `/api/auth/login`** (slowapi is only on ai/chat). LAN-only deployment, so low urgency.
4. **`verify=False` on SimpleFin HTTPS calls** — TLS verification disabled for real banking traffic; only the internal AI gateway needs it.
5. **CORS `allow_origins=["*"]`**.
6. **No paycheck DELETE endpoint/UI** — phantom auto-detected paychecks require SQL to remove.
7. **No input validation** — endpoints parse raw JSON without Pydantic models; missing fields → 500.
8. DB connections leak when an endpoint raises (no try/finally); harmless single-user, sloppy pattern.

## Constraints & Gotchas

- **bcrypt must stay < 4.1** (passlib 1.7.4 incompat). Installed: 3.2.2, pinned in requirements.txt.
- **Deploy target is `/var/www/hearth/`** — `/var/www/finance/` exists but is not served.
- **Node via nvm** — `source ~/.nvm/nvm.sh` before any npm command.
- **Auth required on all API routes** — curl tests need a Bearer token; or query SQLite directly.
- **`sudo` is interactive** — deploy/restart steps must be given to the user to run.
- **Commit to git after every working change**; never commit finance.db.

## Session History

| Session | Date | Focus |
|---------|------|-------|
| 1–2 | ~2026-06-05 | Bills overhaul, Overview Loans/TMRS backend |
| 3–4 | ~2026-06-06 | Debt set-bill wiring, Dashboard 3-card rewrite |
| 5 | 2026-06-14 | Bills.jsx rewrite, Overview Loans/TMRS UI, deploy path fix |
| 6 | 2026-07-03 | QC review: git repo + .gitignore, pinned requirements.txt, nightly DB backups, nickname/display_name migrations, configurable household (Settings → Household), explicit Bills/Food account roles, payroll detection tied to configured paydays, this file audited & rewritten |
| 7 | 2026-07-03 | UX root-cause pass: retired the Gen-1 low-balance threshold banner (message displayed a different number than it tested; simulation `overdraft_warnings` is the only warning now), Settings rebuilt as hub + sub-pages with clickable breadcrumbs, setup-vs-use IA (roles/CSV → Accounts, rules → Spending, memory → Assistant, buffer inline on Dashboard), paycheck attribution learns from recent actual amounts in DB |
| 8 | 2026-07-03 | Goal-oriented features: transfer workflow (record + configurable schedule), Dashboard debt countdown + food runway, bill-creep watchdog + annual cost view, Month in Review reports, nightly AI coach briefing (qwen2.5:14b overnight via gateway, verified live), paycheck floor + transfer phrases exposed in Settings, tunable-constants section added to this doc |
