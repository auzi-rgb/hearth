# Hearth — Source of Truth

**This file describes what Hearth is and how it works, as it currently stands.**
It has no history and no to-do list. When something changes, update this file to
match reality, and record what changed in a dated session file (see *Documentation
workflow* at the bottom). Open bugs live in `KNOWN-ISSUES.md`, not here.

---

## What it is

A self-hosted home finance app for one household. FastAPI backend + SQLite + a React SPA.
Runs on the app server (`home-app-server`, 10.0.0.24), served at `https://10.0.0.24/hearth/`
via nginx reverse proxy.

**Purpose:** help the household live month-to-month instead of paycheck-to-paycheck, pay
off debt first, then build savings. All income lands in the **Bills account**; bills and
debt payments come off the top (on autopay); the leftover budget is transferred to the
**Food account** for day-to-day living. The number the household optimizes is the
**surplus to debt**.

**The equation the whole app obeys:**

```
s = P − B − D − C − U
```

- **P** = baseline income (a normal month) · **B** = monthly bills · **D** = debt payoff
- **C** = contributions (savings/investment transfers) · **U** = committed living budget
- **s** = surplus to debt (grows as bills shrink or spending drops)

Also: **Y = P − B − D − C** (available to live on); **s = Y − U**. Break-even spend is
`L = Y`, so the surplus `s` is the entire margin between the budget and going into the red.

---

## Running & deploying

| Service | Port | Restart / deploy |
|---------|------|------------------|
| Backend (FastAPI, systemd unit `hearth`) | 8100 | `sudo systemctl restart hearth` |
| Frontend (static, served by nginx from `/var/www/hearth/`) | — | build, then `sudo cp -r dist/. /var/www/hearth/` |

- **Backend entry:** `~/home-finance/backend/main.py` (+ `sync.py`)
- **Frontend entry:** `~/home-finance/frontend/src/App.jsx`
- **Build + deploy frontend:**
  ```bash
  cd ~/home-finance/frontend && source ~/.nvm/nvm.sh && npm run build && sudo cp -r dist/. /var/www/hearth/
  ```
- nginx serves from `/var/www/hearth/` — **not** `/var/www/finance/`.
- `sudo` is interactive on this host, so deploy/restart steps are run by the user.

## Version control & backups

- `~/home-finance` is a git repo (branch `main`), pushed to private GitHub `auzi-rgb/hearth`
  over SSH. `finance.db`, `backups/`, `dist/`, and `node_modules/` are gitignored.
- Commit after every working change. Never commit `finance.db`.
- Nightly DB backup at 3:30am (`sync.py::backup_database`, SQLite online-backup API) to
  `backend/backups/finance-YYYYMMDD-HHMMSS.db`, keeping the newest 14.

## Tech stack

- **Backend:** Python 3 (system python, no venv), FastAPI, SQLite (WAL), `python-jose` (JWT,
  8h expiry), `passlib`+`bcrypt` (passwords), `slowapi` (rate limiting — currently only on
  `/api/ai/chat`), APScheduler, SimpleFin bank sync. Dependencies pinned in
  `backend/requirements.txt`.
- **Frontend:** React + Vite, no Tailwind, Apple-style CSS variables. Shared classes:
  `apple-card`, `apple-btn-{primary,secondary,danger}`, `apple-input`, `apple-label`,
  `apple-select`.
- **Auth:** JWT in localStorage; all `/hearth/api/*` routes require a Bearer token except
  `/api/health`, `/api/auth/login`, `/api/auth/change-password`. `src/api.js` patches
  `window.fetch` to attach the token and broadcast 401s. `jwt_secret` and a default `admin`
  user are bootstrapped on first run (temp password printed to the systemd journal once).
- **AI:** the backend proxies AI calls to the gateway at `https://10.0.0.24/gateway/api`
  (`GATEWAY_URL`, hardcoded), which routes to Ollama on austin-ai (10.0.0.8, MacBook Pro,
  CPU/Metal). Self-signed cert → `verify=False` on those calls. **Principle: the AI only
  phrases numbers Python has already computed; it never calculates.**

---

## Database

**Path:** `backend/finance.db` (gitignored). All schema changes are idempotent
`ALTER TABLE … ADD COLUMN` in `try/except` inside `init_db()`, safe to re-run on restart.
**Never ALTER the production DB by hand — add a migration.**

**`bills`** — payment obligations
```
id, name, display_name, expected_amount, confidence (fixed|estimated),
day_of_month, day_of_week, frequency (monthly|weekly), account_id, is_active,
payment_type (Recurring | Loan | Debt | Contribution),
autopay (INTEGER, default 1), merchant_pattern (TEXT, links bill→transactions),
from_debt_budget, linked_loan_id (→loans.id), linked_account_id (→accounts.id),
notes, bill_type (legacy, unused)
```

**`accounts`** — bank/credit/loan accounts (SimpleFin-synced or manual)
```
id, name, nickname, type (checking|savings|credit|loan|personal_loan|investment),
institution, simplefin_id, is_active, current_balance, balance_date,
interest_rate, minimum_payment, created_at
```

**`transactions`** — `id, account_id, amount (neg=debit), description, category,
transaction_date, posted_date, is_pending, is_transfer, category_confirmed, created_at`

**`paychecks`** — `id, person, expected_amount, actual_amount, expected_date, actual_date,
is_third_friday_period, notes`. Auto-detected rows have notes='auto-detected'.

**`transfers`** — recorded Bills→Food transfers: `id, transfer_date, amount,
suggested_amount, notes, created_at`

**`loans`** — manual amortization: `id, name, type, original_balance, current_balance,
interest_rate, monthly_payment, payments_made, total_payments, start_date`

**`bill_paid_months`** — per-month paid marks: `id, bill_id, month (YYYY-MM), paid_date`,
UNIQUE(bill_id, month). The single source of paid truth (Calendar + Bills checkmarks).

**`budgets`** — `id, category, monthly_limit`. **`categories`** — primary/secondary taxonomy.
**`monthly_reports`** — Month-in-Review JSON per month. **`ai_briefings`** — nightly coach
briefings. **`ai_facts`**, **`ai_sessions`** — AI memory. **`merchant_rules`**,
**`net_worth_history`**, **`sync_log`**, **`users`**, **`ignored_bill_patterns`** (unused).

### `settings` (key-value)

- `jwt_secret`, `simplefin_access_url` — hidden from GET and blocked from PUT.
- `household_members` — JSON list of `{key, label, payroll_keywords[], amount_min,
  amount_max, default_frequency}`. Drives paycheck detection/attribution. Seeded from
  `sync.DEFAULT_HOUSEHOLD`; edited in Settings → Household.
- `bills_account_id`, `food_account_id` — account roles (set via Role selector on Accounts
  cards; empty falls back to name-matching "bills"/"food" via `find_role_account`).
- `payday_dow_{key}`, `payday_frequency_{key}`, `payday_anchor_{key}` — per member.
- `committed_budget`, `committed_budget_at` — the committed living budget (y).
- `transfer_schedule` — JSON `{"mode":"days","days":[1,15]}` or `{"mode":"payday"}`.
- `transfer_window_days` (default 3), `safe_spend_buffer` (default 200),
  `paycheck_min_amount` (default 500), `transfer_detection_phrases`,
  `budget_baseline_income` (optional override).
- `ai_default_model`, `ai_system_prompt`, `ai_temperature`, `ai_autorun`,
  `ai_autorun_prompt`, `ai_coach_enabled` (default true), `ai_coach_model` (default
  `qwen2.5:14b`).
- `ical_token` — secret for the calendar subscription feed.
- TMRS: `tmrs_account_balance`, `tmrs_your_contributions`, `tmrs_interest`,
  `tmrs_city_contributions`, `tmrs_monthly_deposit`, `tmrs_retirement_eligible_date`.

---

## API endpoints

**Public:** `GET /api/health` · `POST /api/auth/login` · `POST /api/auth/change-password`
**iCal:** `GET /api/calendar.ics?token=…` (token-auth, no JWT — calendar apps can't send headers)

Everything else requires a Bearer token:

- **Accounts:** `GET /api/accounts` (`?include_inactive`) · `POST` · `PUT/DELETE /{id}` ·
  `POST /{id}/reactivate` · `PUT /{id}/{nickname,type,debt-details}`
- **Dashboard/Calendar:** `GET /api/dashboard` · `GET /api/calendar?month=YYYY-MM` ·
  `GET /api/calendar/ical-url`
- **Bills:** `GET/POST /api/bills` · `PUT/DELETE /{id}` · `PATCH /{id}/type` ·
  `PUT /{id}/paid` · `GET /api/bills/history` · `GET /api/bills/creep` ·
  `POST /api/bills/link-transaction`
- **Loans/Debt:** `GET/POST /api/loans` · `PUT/DELETE /{id}` · `POST /{id}/set-bill` ·
  `GET /api/debt/summary` · `POST /api/debt/set-bill` · `GET /api/debt/payoff-projection` ·
  `GET /api/debt/strategies?extra_monthly=N&cards_first=bool`
- **Transactions/Spending:** `GET/POST /api/transactions` · `PUT /{id}/category` ·
  `POST /api/transactions/dedup-pending` · `GET /api/spending/{summary,transactions,
  top-merchants,merchants-by-category}`
- **Budget/Categories/Rules:** `GET /api/budgets` · `GET /api/budgets/{primary}/breakdown` ·
  `PUT/DELETE /api/budgets/{category}` · `POST /api/budget/commit` · `GET /api/budget/committed` ·
  `GET/POST /api/categories` · `DELETE /api/categories/{name}` · `GET /api/merchant-rules` ·
  `DELETE /api/merchant-rules/{id}`
- **Transfers:** `GET/POST /api/transfers` · `DELETE /{id}`
- **Reports:** `GET /api/reports` · `POST /api/reports/generate`
- **Paychecks:** `GET /api/paychecks` · `GET /api/paychecks/upcoming` · `POST` · `PUT /{id}`
- **Income:** `GET /api/income/summary`
- **Settings/Sync/Import/Net worth/TMRS:** `GET /api/settings` · `PUT /api/settings/{key}` ·
  `GET/PUT /api/tmrs` · `POST /api/sync` · `GET /api/sync/log` ·
  `POST /api/simplefin/{setup,reset}` · `POST /api/import/csv?account_id=N` (USAA/Chase) ·
  `POST /api/net-worth/snapshot`
- **AI:** `POST /api/ai/chat` (streams, 20/min) · `GET /api/ai/{health,models,context,
  briefing,memory}` · `POST /api/ai/{test,suggest-categories,briefing/generate}` ·
  memory CRUD under `/api/ai/memory/*`

---

## Pages (`frontend/src/pages/`)

**Dashboard** · **Overview** · **Accounts** · **Calendar** · **Spending** · **Budget** ·
**Bills** · **Debt** · **About** · **AI** (Assistant) · **Settings** · **Login**.

`src/lib/dashboardFields.js` holds shared getters (`getMonthlyIncome`, `getBaselineIncome`)
for dashboard payload fields read by more than one page — add a getter there rather than
reading a field by name in multiple places.

### Where controls live (design rule)
**Setup lives in Settings; daily-use controls live on the page that uses them.**
- **Settings** is a hub of cards → sub-pages (breadcrumb in the top strip via `onCrumb`):
  Connections (SimpleFin + transfer phrases), AI Assistant, Household (members, payroll
  keywords, pay ranges, per-member pay schedule, paycheck minimum), Security, Phone Calendar
  Feed (iCal subscribe link).
- **Accounts** — Income card (paycheck counts/dates, typical-month average); Role selector
  (Bills/Food) on each cash-account card; CSV import.
- **Spending** — Auto-Category Rules; "+ bill" on any transaction to link it to a bill.
- **Assistant** — ◐ Memory panel (facts, sessions).
- **Dashboard** — safe-spend buffer inline; transfer schedule inline.
- **Budget** — Commit Budget button (draft vs committed).

---

## Key behaviors

- **Baseline income (P):** `compute_baseline_income` = usual paycheck count (2 biweekly / 4
  weekly) × median of each member's last 4 actual checks. This is the planning number
  (stable across extra-paycheck months, tracks raises). `compute_month_income` gives the
  actual calendar-month figure, used only for display, never budgeting.
- **Paycheck detection (`sync.py::_detect_paychecks`):** a checking deposit ≥
  `paycheck_min_amount` is a paycheck if it matches payroll keywords, else if it lands on a
  configured payday (±1 day). Attribution: keywords → closest match to recent actual
  paychecks (within 15%) → static pay-range → first member.
- **Payday projection (`detect_next_payday`):** anchored to configured day-of-week +
  frequency, so a holiday-shifted deposit doesn't drift the schedule.
- **Cash-flow projection (`cash_flow_projection`):** ONE day-by-day projection of the Bills
  account from today forward (all bill occurrences + projected paychecks, running balance).
  Both the Dashboard's safe-to-transfer and the Calendar overlay read it, so months carry
  forward and never disagree. `safe_today` = lowest projected balance − buffer;
  `suggested_transfer` = max(0, safe_today); `overdraft_warnings` when a bill would breach
  the buffer.
  - **Same-day events apply income first.** Banks don't publish intra-day posting order, so
    the only knowable figure is the end-of-day balance; income-first ordering makes each
    day's low equal that. Sorting by date alone left bills ahead of paychecks and produced
    phantom dips that zeroed safe-to-transfer and fired false overdraft warnings.
  - **It starts from `get_available_balance` (posted + pending), not the posted balance.**
    SimpleFin's balance snapshot runs up to a day behind its transaction feed, so a paycheck
    that has arrived as a pending deposit is real money the posted figure hasn't caught up
    with. A paycheck dated today is projected only if `_deposit_already_landed` finds no
    matching deposit — closing both halves of the double-count. Pendings older than 14 days
    are ignored, and `sync` clears the pending flag when the settled version arrives.
- **The Bills card identity (`X = Y + Z`):** what's in Bills (`bills_balance`) = free to move
  (`suggested_transfer`) + needed for bills (`bills_needed`). `bills_needed` is the deepest
  cumulative dip between now and `bills_low_date` plus the buffer — a property of the
  bill/income *schedule*, so it holds steady while the other two move together. When the
  balance can't cover it, `suggested_transfer` pins at 0 and `bills_shortfall` says how far
  short. All three come from the one projection, so they always reconcile.
- **Committed budget (U) & planned transfers:** U is set by Commit Budget; editing category
  limits is a draft until committed. `compute_planned_transfers` funds Food with U split
  50/50 across the two transfer days; each transfer may shift within `transfer_window_days`
  to the earliest day it's fully safe (e.g. waits for a paycheck the day after) — only
  capped if no day in the window works.
- **CSV import dedup:** `import_csv` matches on (date, amount) *count-aware* — only as many
  CSV rows as the DB already holds for that pair count as already-present, so a genuine second
  same-priced purchase on the same day still imports. Matching on description alone let every
  row SimpleFin had already delivered back in as a duplicate (the bank's CSV text never equals
  SimpleFin's). CSV-imported rows are identifiable by `posted_date IS NULL`.
- **Bill tiers:** `Recurring` (monthly bill), `Loan`/`Debt` (debt payoff, linked to a loan
  or credit account), `Contribution` (chosen savings/investment). Monthly Bills + Debt =
  the hardline. Weekly bills use `frequency='weekly'`+`day_of_week`; monthly cost is
  `monthly_equivalent` (×52/12).
- **Autopay:** bills default to `autopay=1`. Autopay bills are muted on the Calendar, never
  ask to be marked paid, and don't nag. Manual bills (autopay=0) keep the paid workflow and
  surface as action items. Paid status is always manual (via `bill_paid_months`), never
  guessed from transactions.
- **Bill↔transaction linking:** a bill's `merchant_pattern` (set by Spending's "+ bill")
  connects it to its transactions for history/creep/rolling stats; falls back to the bill
  name's first 8 characters if unset.
- **Squeeze guard:** if baseline − hardline − contributions leaves less to live on than the
  household actually spends, the Budget/Bills pages warn and direct cuts at Contributions
  first, never food.
- **Scheduler (`sync.py`, started from FastAPI lifespan):** 2:00am SimpleFin sync · 3:00am
  net-worth snapshot · 3:30am DB backup · 3:45am AI coach briefing · 1st-of-month 4:00am
  Month-in-Review.

---

## Constraints & gotchas

- **bcrypt must stay < 4.1** (passlib 1.7.4 incompatibility). Installed: 3.2.2.
- Deploy target is `/var/www/hearth/`.
- Load Node via `source ~/.nvm/nvm.sh` before any `npm` command.
- All API routes need a Bearer token — curl tests need one, or query SQLite directly.
- The AI runs on austin-ai (10.0.0.8) via the gateway; keep AI to phrasing precomputed
  numbers, not calculating.
- Google Calendar can't subscribe to the iCal feed (its servers can't reach the LAN); Apple
  Calendar on the home network can.

---

## Documentation workflow

- **This `README.md`** is the source of truth: current state only, present tense, no history
  and no to-do list. Update it whenever the app changes.
- **`KNOWN-ISSUES.md`** holds open bugs and planned fixes.
- **`HEARTH-CHANGES-YYYY-MM.md`** files record what each work session did. A session ends by
  writing/appending its changes there and updating this README to match. The next session
  reads the README to learn how things are — not the change files.
