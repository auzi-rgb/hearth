# HEARTH — Project Context
Last updated: **2026-06-14** (Session 5)

Self-hosted home finance app. FastAPI backend + SQLite + React SPA.
Run at `~/home-finance/`. Web UI served at `/hearth` via nginx reverse proxy.

---

## Services

| Service | Port | Config |
|---------|------|--------|
| Backend (FastAPI) | 8100 | `sudo systemctl restart hearth` |
| Frontend (nginx) | — | `sudo cp -r dist/. /var/www/hearth/` |

**Backend entry:** `~/home-finance/backend/main.py` (~2430+ lines)
**Frontend entry:** `~/home-finance/frontend/src/App.jsx`

Build + deploy frontend:
```bash
cd ~/home-finance/frontend && source ~/.nvm/nvm.sh && npm run build && sudo cp -r dist/. /var/www/hearth/
```

> **IMPORTANT:** nginx serves Hearth from `/var/www/hearth/` — NOT `/var/www/finance/`.
> The `finance/` directory exists but is not served by nginx. Always deploy to `hearth/`.

Backend restart (after any `main.py` change):
```bash
sudo systemctl restart hearth
```

---

## Tech Stack

- **Backend:** Python 3, FastAPI, SQLite (WAL mode), `python-jose` (JWT), `slowapi` (rate limiting), SimpleFin bank sync
- **Frontend:** React + Vite 8, no Tailwind, Apple-style CSS variables
- **CSS classes:** `apple-card`, `apple-btn-primary`, `apple-btn-secondary`, `apple-input`, `apple-label`, `apple-select`
- **CSS vars:** `--text-primary`, `--text-secondary`, `--text-tertiary`, `--accent`, `--accent-text`, `--red`, `--blue`, `--border`, `--bg-subtle`
- **Auth:** JWT stored in localStorage; `/hearth/api/*` prefixed via nginx; frontend uses `const API = '/hearth/api'`
- **bcrypt pinned to `4.0.1`** — do NOT touch `requirements.txt`

---

## Database

**Path:** `/home/austin/home-finance/backend/finance.db`

### Key Tables

**`bills`** — recurring/loan/debt payment obligations
```
id, name, expected_amount, confidence (fixed|estimated),
day_of_month, account_id, is_active,
bill_type (TEXT legacy: required|optional),
payment_type (TEXT: Recurring|Loan|Debt),
from_debt_budget (INTEGER 0/1),
linked_loan_id (→ loans.id, for payment_type='Loan'),
linked_account_id (→ accounts.id, for payment_type='Debt'),
notes
```

**`bill_paid_months`** — per-month payment tracking
```
id, bill_id, month (YYYY-MM), paid_date
```

**`accounts`** — bank/credit/loan accounts (synced via SimpleFin)
```
id, name, type (checking|savings|credit|loan|personal_loan),
institution, simplefin_id, is_active,
current_balance, balance_date, interest_rate, minimum_payment
```

**`loans`** — manually-tracked loan amortization
```
id, name, type (auto|personal_loan|mortgage|student|other),
original_balance, current_balance, interest_rate,
monthly_payment, payments_made, total_payments, start_date
```

**`paychecks`** — income schedule
```
id, person, expected_amount, actual_amount,
expected_date, actual_date, is_third_friday_period, notes
```

**`settings`** — key-value store
```
key, value
```
Keys in use: `jwt_secret`, `simplefin_access_url`, `ai_default_model`, `custom_categories`
TMRS keys (written on first save via UI): `tmrs_contribution_balance`, `tmrs_monthly_benefit`, `tmrs_monthly_contribution`, `tmrs_years_of_service`

**`transactions`** — SimpleFin transaction ledger (10 cols)
**`budgets`** — monthly budget limits by category (3 cols)
**`merchant_rules`** — auto-categorization rules (4 cols)
**`net_worth_history`** — monthly snapshots (5 cols)

### DB Migration Pattern
All migrations are idempotent `ALTER TABLE … ADD COLUMN` wrapped in `try/except OperationalError` inside `init_db()`. Safe to re-run on restart.

---

## Accounts (Active)

| ID | Name | Type | Notes |
|----|------|------|-------|
| 1 | Holding (5253) | checking | Near-zero transit account |
| 2 | Food (5784) | checking | Grocery/food spending |
| 3 | Savings (5776) | savings | |
| 4 | Bills (0831) | checking | **Primary bills account** — dashboard key metric |
| 5 | UNSECURED FIXED RATE LOAN (3720) | loan | SimpleFin-synced, not in loans table |
| 6 | Platinum Visa (7608) | credit | |
| 7 | Anouk's - 529 (8198) | checking | 529 college savings |
| 8 | Individual - Legacy Wealth Building (1198) | checking | Brokerage |
| 9 | Anushka's Roth IRA Fidelity Go (3698) | checking | IRA |
| 10 | Citi®/AAdvantage® (9174) | credit | |
| 11 | Chase Freedom Unlimited (0406) | credit | Shows as checking type |
| 12 | Personal Loan (8337) | loan | SimpleFin-synced, not in loans table |

---

## Backend API Endpoints

### Auth
- `POST /api/auth/login`
- `POST /api/auth/change-password`
- `GET  /api/health`

### Dashboard
- `GET  /api/dashboard` — returns: `net_worth`, `assets`, `liabilities`, `net_worth_change`, `bills_balance`, `upcoming_bills[]`, `low_balance_warning`, `low_balance_threshold`, `has_simplefin`, `next_pay_date`, `accounts[]`, `encumbered_30d`, `recommended_transfer`, `food_balance`, `spendable_in_food`, `next_paycheck_date`, `days_until_paycheck`

### Accounts
- `GET  /api/accounts`
- `POST /api/accounts`
- `DELETE /api/accounts/{account_id}`
- `PUT  /api/accounts/{acct_id}/debt-details`

### Bills
- `GET  /api/bills` — returns active bills with all 13 columns + computed fields (`next_due`, `days_until`, `rolling_min`, `rolling_max`)
- `POST /api/bills` — accepts: `name`, `expected_amount`, `confidence`, `day_of_month`, `account_id`, `bill_type`, `payment_type`, `from_debt_budget`, `linked_loan_id`, `linked_account_id`, `notes`
- `PUT  /api/bills/{bill_id}` — same fields as POST
- `PATCH /api/bills/{bill_id}/type`
- `PUT  /api/bills/{bill_id}/paid` — mark paid for a month
- `DELETE /api/bills/{bill_id}`
- `POST /api/bills/detect-statistical` — auto-detect bills from transactions
- `POST /api/bills/detect-ignore`
- `POST /api/bills/detect-ai`
- `GET  /api/bills/history`
- `GET  /api/line-items` — legacy endpoint; bills with paid status for current month (used by Calendar, not Bills tab)

### Loans
- `GET  /api/loans` — returns loans with computed fields: `months_remaining`, `total_interest_remaining`, `payoff_date`, `linked_bill_id`, `linked_bill_amount`
- `POST /api/loans`
- `PUT  /api/loans/{loan_id}`
- `DELETE /api/loans/{loan_id}`
- `POST /api/loans/{loan_id}/set-bill` — creates/updates a `payment_type='Loan'` bill linked to this loan

### Debt
- `GET  /api/debt/summary` — credit cards + loans with `interest_rate`, `minimum_payment`, `linked_bill_id`, `linked_bill_amount`
- `POST /api/debt/set-bill` — creates/updates a `payment_type='Debt'` bill linked to a credit account
- `GET  /api/debt/payoff-projection`
- `GET  /api/debt/strategies?extra_monthly=N`

### Transactions
- `GET  /api/transactions`
- `POST /api/transactions`
- `PUT  /api/transactions/{txn_id}/category`
- `POST /api/transactions/dedup-pending`

### Spending
- `GET  /api/spending/summary`
- `GET  /api/spending/transactions`
- `GET  /api/spending/top-merchants`
- `GET  /api/spending/merchants-by-category`

### Budgets
- `GET  /api/budgets`
- `PUT  /api/budgets/{category}`
- `DELETE /api/budgets/{category}`

### Paychecks
- `GET  /api/paychecks/upcoming`
- `GET  /api/paychecks`
- `POST /api/paychecks`
- `PUT  /api/paychecks/{paycheck_id}`

### Categories & Rules
- `GET  /api/categories`
- `POST /api/categories`
- `DELETE /api/categories/{name}`
- `GET  /api/merchant-rules`
- `DELETE /api/merchant-rules/{rule_id}`

### Settings / TMRS
- `GET  /api/settings`
- `PUT  /api/settings/{key}`
- `GET  /api/tmrs` — reads 4 keys: `contribution_balance`, `monthly_benefit`, `monthly_contribution`, `years_of_service`
- `PUT  /api/tmrs` — writes provided non-null TMRS keys

### Calendar & Forecast
- `GET  /api/calendar`
- `GET  /api/forecast`

### Sync & Import
- `POST /api/sync` — trigger SimpleFin sync
- `GET  /api/sync/log`
- `POST /api/simplefin/setup`
- `POST /api/simplefin/reset`
- `POST /api/import/csv`

### Net Worth
- `POST /api/net-worth/snapshot`

### AI
- `POST /api/ai/chat`
- `GET  /api/ai/health`
- `GET  /api/ai/models`
- `POST /api/ai/test`
- `POST /api/ai/suggest-categories`
- `GET  /api/ai/context`
- `GET  /api/ai/memory`
- `POST /api/ai/memory/session`
- `GET  /api/ai/memory/sessions`
- `GET  /api/ai/memory/sessions/{session_id}/transcript`
- `PUT  /api/ai/memory/facts/{fact_id}`
- `DELETE /api/ai/memory/facts/{fact_id}`
- `DELETE /api/ai/memory/facts`
- `DELETE /api/ai/memory/sessions`

---

## Frontend Pages (`src/pages/`)

| File | Tab | Status |
|------|-----|--------|
| `Dashboard.jsx` | Dashboard | 3-card layout: Money Flow (Bills acct + encumbered + transfer), Spending Power (spendable_in_food + paycheck countdown), Accounts (collapsible). ✓ Session 4 |
| `Overview.jsx` | Overview | Net Worth → Assets/Liabilities → Debt Payoff Timeline → Loans card (full CRUD) → TMRS card. ✓ Session 5 |
| `Bills.jsx` | Bills | Flat ledger from `GET /api/bills`, TypeBadge (Recurring/Loan/Debt), ConfBadge (Fixed/Variable), Add/Edit/Delete modal. ✓ Session 5 |
| `Debt.jsx` | Debt | CreditCardDebtEditor + LoanCard. "Set as Bill" wired for both credit and loans. ✓ Session 3 |
| `Spending.jsx` | Spending | Transaction browser + merchant rules |
| `Budget.jsx` | Budget | Budget limits by category |
| `Calendar.jsx` | Calendar | Bill/paycheck calendar view, running balance toggle |
| `LineItems.jsx` | — | Legacy — old Bills UI, not routed in App.jsx, kept for reference |
| `AI.jsx` | AI | Chat with AI assistant |
| `Settings.jsx` | Settings | App settings + TMRS inputs |

---

## Key Business Logic

### Spendable / Transfer Calculation (in `GET /api/dashboard`)
1. `encumbered_30d` — sum of bill amounts due within 30 days
2. `recommended_transfer` = `max(0, bills_balance - encumbered_30d)` — safe to move from Bills → Food
3. `spendable_in_food` = `food_balance + recommended_transfer`
4. `next_paycheck_date` / `days_until_paycheck` — next `expected_date` from `paychecks` table

### Bill `payment_type` Field
- `Recurring` — standard recurring bill (default; all existing bills backfilled to this)
- `Loan` — payment linked to a `loans` row via `linked_loan_id`; confidence locked to Fixed in UI
- `Debt` — payment linked to a credit `accounts` row via `linked_account_id`; confidence locked to Fixed in UI
- Legacy `bill_type` (`required`/`optional`) still exists in DB but is no longer used by Bills.jsx

### Overview Loans Card
- Loads from `GET /api/loans` (manually-tracked amortization data, NOT SimpleFin loan accounts)
- SimpleFin loan accounts (ids 5, 12) appear in the Liabilities breakdown but not in this card
- Add/Edit modal fields: Name, Loan Type, Original Balance, Current Balance, Interest Rate %, Monthly Payment, Start Date, Total Payments (term), Payments Made

### Overview TMRS Card
- Title: "TEXAS MUNICIPAL RETIREMENT SYSTEM"
- Subtitle: "Updated manually from your TMRS statement"
- 4 fields: Contribution Balance, Est. Monthly Benefit, Monthly Contribution (note: "Used in budget calculations"), Years of Service
- Positioned below the Loans card (bottom of Overview page)
- Renders only when `GET /api/tmrs` returns non-null (always renders — API always returns a dict even if empty)

---

## Session History

| Session | Date | Focus | Status |
|---------|------|-------|--------|
| Session 1 | ~2026-06-05 | Bills system overhaul | DB migration ✓, bill CRUD routes ✓ (backfilled payment_type), Bills.jsx rewrite ✗ |
| Session 2 | ~2026-06-05 | Overview tab: Loans + TMRS | TMRS backend routes ✓, Overview UI ✗ |
| Session 3 | ~2026-06-06 | Debt tab: set-bill wiring | All complete ✓ |
| Session 4 | ~2026-06-06 | Dashboard cleanup | Dashboard.jsx 3-card rewrite ✓, HEARTH-CONTEXT.md created ✓ |
| Session 5 | 2026-06-14 | Finish Bills + Overview Loans/TMRS | All 5 sections complete ✓ |

### Session 5 Changes (2026-06-14)
1. **Backend** — `POST /api/bills` and `PUT /api/bills/{id}` updated to accept/persist `payment_type`, `from_debt_budget`, `linked_loan_id`, `linked_account_id`, `notes`
2. **Bills.jsx** — Full rewrite: flat ledger from `GET /api/bills`, TypeBadge (Recurring/Loan/Debt), ConfBadge (Fixed/Variable), Add/Edit modal, inline delete confirm
3. **Overview.jsx — Loans card** — New card after Debt Payoff Timeline: `GET /api/loans`, full CRUD with `LoanModal` (9 fields), table columns Name|Balance|Rate|Payment|Payoff
4. **Overview.jsx — TMRS card** — Updated title/subtitle, added "Used in budget calculations" note, moved to bottom (after Loans card)
5. **Deploy path corrected** — nginx serves from `/var/www/hearth/` not `/var/www/finance/`; all previous sessions had been deploying to the wrong directory

---

## Constraints & Gotchas

- **`bcrypt` pinned to `4.0.1`** — do NOT touch `requirements.txt`
- **Deploy target is `/var/www/hearth/`** — `/var/www/finance/` exists but nginx does NOT serve it
- **Node via nvm** — always `source ~/.nvm/nvm.sh` before any `npm` command
- **Auth required on all API routes** — curl tests fail with 401; use direct SQLite queries to verify DB state
- **`sudo` is interactive** — deploy steps must be given to user to run; cannot run non-interactively
- **DB migrations are idempotent** — `ALTER TABLE … ADD COLUMN` in `try/except OperationalError`; safe to re-run
- **`LineItems.jsx`** — old Bills UI preserved as a file but not imported/routed; ignore it
