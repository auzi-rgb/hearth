# Hearth — Session log, 2026-08-20

## Why

The dashboard showed ~$1,745 safe-to-move on Aug 19 and $0 plus a future overdraft
warning on Aug 20, while the Bills balance only moved $410. Reproduced by replaying
`/api/dashboard` against the live DB for each morning of that week.

## Root causes

1. **Same-day event ordering.** `cash_flow_projection` sorted on date alone. Python's
   stable sort preserved loop insertion order — every bill, then every paycheck — so any
   day where both land showed a phantom intra-day dip. On 2026-09-03 rent drove the
   running balance to −191.14 before that morning's paycheck applied, though the day
   ends at +1,385.67. Everything downstream reads the *minimum* of that running balance,
   so one phantom dip zeroed safe-to-transfer and fired a false overdraft warning.
   15 such collision days fall in the next 180, understating the low point by
   $1,576–$4,092 each.

2. **Payday blind spot.** Paychecks dated today were never projected, on the premise that
   SimpleFin's balance runs *ahead* of its transaction feed. It runs up to a day *behind*,
   so on payday the deposit was in neither the balance nor the forecast.

## Changes

- `cash_flow_projection` sorts income before bills within a date, making each day's low
  equal its end-of-day balance — the only figure knowable a month out.
- New `get_available_balance` (posted + pending, ignoring pendings >14 days old); the
  projection, the Dashboard and the Calendar all start from it. New
  `_deposit_already_landed` projects today's paycheck only when no matching deposit is on
  the books, closing both halves of the double-count.
- `sync` now clears the pending flag when the settled version of a transaction arrives.
  Without this, a stale pending marker would make the available balance double-count.
- Dashboard ships `bills_needed`, `bills_shortfall`, `bills_low_point`, `bills_low_date`,
  `bills_balance_posted`, `bills_pending`. The Bills card shows the `X = Y + Z` split and
  its breakdown now reads the reserve from the simulation's low point rather than "bills
  due before next paycheck" — those coincide only when the low point falls just before
  payday, so the old arithmetic didn't reconcile to the answer beneath it.
- `import_csv` dedup is now count-aware on (date, amount) instead of exact-description.

## Data corrections

- **Netflix is two subscriptions, not a duplicate** (house + sister). Both records were
  configured $20.34 on day 13; actual charges are $21.64 on the 6th and the 17th. Bills 15
  and 91 corrected, `merchant_pattern='netflix'` set on both.
- **298 duplicate transactions removed.** Three CSV imports (Jun 6, Jul 2, Aug 20) each
  re-inserted rows SimpleFin had already delivered, because dedup matched on exact
  description and the bank's CSV text never equals SimpleFin's. Reported spending was
  inflated 36% in May, 10% in June, 34% in August. Deleted rows archived to
  `backend/backups/deleted-duplicates-20260820.csv`; every SimpleFin original kept.
  DB backed up first to `backend/backups/finance-pre-fix-20260820-200418.db`.

## Result (2026-08-20)

| | before | after |
|---|---|---|
| Safe to move | $0.00 | $1,936.93 |
| Overdraft warnings | 1 (phantom) | 0 |
| Bills available | $3,203.26 posted | $4,680.07 (+$1,476.81 pending) |
| Needed for bills | not shown | $2,743.14 through Aug 26 |

## Not fixed — see KNOWN-ISSUES.md

Bill 116 has no due day (invisible to the projection, counted in the totals); two different
"next paycheck" dates on one screen; `bills_before_next_pay` ignores paid status; the
projection doesn't reserve Food transfers; dead payload fields; Chase Freedom stopped
syncing on Jun 16.

## Follow-up, same day — available balance correction

The first pass defined `get_available_balance` as posted **plus all pendings**, which showed
$4,680.07 against a real balance of $3,103.26 and read as a double-counted paycheck. Wrong
premise: banks hold an incoming deposit until it posts, so a pending *credit* is not
spendable, while a pending *debit* has already reduced what you can spend.

Available is now posted plus pending **debits** only — $3,203.26 − $100.00 = $3,103.26,
user-verified. Pending credits move into `cash_flow_projection` as future events, so the
payday blind spot stays closed without overstating today's cash. `_deposit_already_landed`
now requires a POSTED deposit. The dashboard's Accounts strip was also still reporting the
raw posted balance while the Bills card reported available — one screen, two Bills numbers.
Cash accounts now use one basis everywhere.

## Follow-up — the two KNOWN-ISSUES items

**Bill 116 "Citi Bank Personal Loan" now has a due day.** Payment history shows
"PIL CITIBANK CITIXFR" at $291.37, 14 payments from 2025-06 to 2026-07, always the 27th
except when it fell on a weekend or holiday (28th/29th — ACH drift, not a schedule change).
Set to day 27, $291.37 (was $291.00), `merchant_pattern='pil citibank'`. No active bill is
invisible to the projection any more.

**Chase wasn't a dead connection — it was reconnected under a new SimpleFin id.** On
2026-06-16 a second account row appeared (`ACT-30422cb2…`); sync's name-clash guard inserted
it INACTIVE so it couldn't double-count, and the warning was never acted on. So the account
everything reads (11) froze at 2026-06-16 while the one actually receiving data (13) was
excluded from every view.

Acct 13 was a strict superset of 11 — all 85 of its transactions plus 21 newer. Merged the
21 onto acct 11 with `is_transfer` recomputed by sync's own rule, dropped 13's duplicate
copies, repointed 11 at the live SimpleFin id and balance (−7,547.47 @ 2026-08-20), deleted
13. Archived to `backend/backups/chase-acct13-archive-20260820.csv`.

Deliberately did **not** use the reactivate endpoint: it blanket-clears `is_transfer` on
every transaction of the account (see KNOWN-ISSUES), which would have corrupted flags.
Moving rows onto the already-active 11 left its 85 good rows untouched.

Still stale: Personal Loan (8337) (Happen Bank / LendingClub), balance_date 2026-06-21.

## Follow-up — pending credits removed from the forecast too

The available-balance correction was still half wrong. Excluding pending credits from the
*balance* was right; adding them to the *forecast* as future events was not. Austin caught
it from the Calendar timeline: starting balance $3,103.26, then a `STAFFMARK INVEST
(pending)` row for +$1,576.81 building to $4,680.07 — the same paycheck counted twice.

**Why:** payroll posts overnight, so SimpleFin's 05:29 balance snapshot already contained
the deposit while USAA's CSV still carried `Status=pending`. The code trusted that stale
flag over the reported balance. A deposit's pending flag says nothing about whether the
balance holds it.

Pending credits are now excluded from both the balance and the timeline, and
`_deposit_already_landed` counts a deposit on the books — posted or pending — as arrived.
The reported balance is the authority; a flag on one imported row is not.

Result: X $3,103.26, Z $2,743.14, **Y $360.12** (was showing $1,936.93 off the doubled
paycheck). Low point $410.12 on Aug 26, the day before payday.

**Build rule 1 applied:** the two thresholds this logic depends on were literals buried
mid-function (a 14-day pending window, a 0.5 paycheck-match ratio). Both are now settings
read via `_setting_float` with documented defaults, and both are editable in
Settings → Connections → "Balance & Paycheck Matching". Blank or invalid falls back to the
default.

## Alembic adopted — the schema becomes reproducible

Austin's reframing of the GitHub-ready rule: *"I should be able to delete all my accounts
and then resync that data fresh and get the same results I see now."* A schema that only
exists as the residue of past edits cannot give you that, so Alembic went in first (build
rule 9) before any further structural work.

- `alembic==1.19.1` + `SQLAlchemy==2.0.52` installed to user site, matching how the
  existing deps live in `~/.local` (Ubuntu 24.04 marks system python PEP-668 managed).
  SQLAlchemy is a transitive dependency only — the app still uses stdlib `sqlite3`, and
  with no ORM models every migration is hand-written. bcrypt 3.2.2 pin untouched.
- `0001_baseline` captures the schema **verbatim from the production database** rather
  than retyped, so `alembic upgrade head` on an empty file reproduces it exactly.
  Verified: 20 objects, zero DDL differences, column lists match on accounts/bills/
  transactions. Production was `stamp`ed at it rather than running it.
- `init_db()` went from ~283 lines of `CREATE TABLE IF NOT EXISTS` + fifteen
  `ALTER TABLE ... ADD COLUMN` in bare `try/except` to a single `alembic upgrade head`
  that refuses to start the app if the schema is not at head (rule 8, fail fast).
- **A real bug fell out of this.** `init_db()` carried three data backfills that re-ran on
  every restart. One re-applied `is_transfer=1` to anything matching the USAA transfer
  wording — so `PUT /api/transactions/{id}/transfer` let the household mark something as
  NOT a transfer, and the next service restart silently put it back. Same for the
  roth/hysa/529 → Contribution reclassification. Both are now `0002_startup_backfills`,
  running once. A user's decision has to outlive a restart.
- The third backfill (`frequency='monthly' WHERE frequency IS NULL`) was papering over
  three of the four `INSERT INTO bills` paths never setting the column. Fixed at the
  inserts; the migration only closes out pre-existing rows.
- `docs/migrations.md` documents the workflow, including `HEARTH_DB_PATH` for rehearsing a
  migration against a copy, why autogenerate produces empty migrations here, and why
  `render_as_batch` is required on SQLite.

**Verified end to end:** a database created from nothing but `alembic upgrade head` is
schema-identical to production, and the app boots and serves `/api/dashboard` against it.
Production integrity check ok, 3,077 transactions intact, revision `0002_startup_backfills`.

---

# Hearth — Session log, 2026-08-22

## Why

LendingClub renamed itself Happen Bank. Renaming the bill in place looked impossible —
the Bills edit modal renders Display Name as a disabled field for any bill linked to a
debt account, with the note "rename it from the Debt tab" and no link to it — so the bill
was deleted and recreated instead. Reviewing that swap turned up a bug underneath it.

## Root causes

1. **`PUT /api/bills/{id}` blanked three columns on every edit.** The statement wrote
   `account_id`, `bill_type` and `from_debt_budget` straight from the request body, and
   the Bills modal sends none of them — nothing in the UI sets them through this endpoint
   at all. Any ordinary edit (a rename, a due-day change) silently cleared all three.
   Blast radius beyond the new bill: 14 bills carry a `bill_type` of required/optional set
   through the separate PATCH, and bill 116 is the only one with `from_debt_budget=1`.
   This is what left the new Happen Bank bill with `account_id` NULL, which drops a bill
   from `/api/bills/history` and from drift detection entirely.

2. **A linked bill cannot be renamed where it is displayed.** `linked_name` (the debt
   account's nickname, else the loan's name) outranks `display_name` on the Bills,
   Spending and About pages, so editing `display_name` on a linked bill appears to do
   nothing. The modal disabled the field rather than writing through — correct about the
   single source of truth, but it made delete-and-recreate the obvious move, which
   strands the bill's id, its transaction history and its paid months.

3. **Linking a merchant always wrote the `bill` category**, hardcoded, even for a loan
   payment. 18 months of LendingClub history is `debt_payment`, so one obligation split
   across two categories on the Budget and Spending pages.

4. **The `<select>` popup was white-on-white in dark mode.** Nothing in `index.css` ever
   declared `color-scheme`, so the browser painted native widgets light while the options
   inherited the near-white `--text-primary` from `.apple-select`.

## Changes

- `update_bill` uses `COALESCE(?, column)` for `account_id`, `bill_type` and
  `from_debt_budget`: absent means leave it alone, an explicitly sent value still
  overwrites. New `_opt_int` keeps "absent" distinguishable from a real `0`.
- Display Name is now editable for linked bills and renames through to the linked debt
  account's nickname (`PUT /api/accounts/{id}/nickname`) or the loan's name (new
  `PUT /api/loans/{id}/name`). The single-source-of-truth invariant is unchanged — the
  write just happens from where you are standing, so renaming never costs the bill's
  identity. Helper text says so explicitly.
- `link_transaction_to_bill` derives the category from the bill's `payment_type`:
  `debt_payment` for Debt/Loan, `bill` otherwise. Both are excluded from discretionary
  spend everywhere, so no total moves — only the category breakdown corrects.
- `:root` declares `color-scheme: light`, the dark media block `color-scheme: dark`.
  Fixes every native select popup app-wide, and their scrollbars with them.

## Data repairs

Backup: `backups/finance-pre-happenbank-20260822-094303.db`.

- Bill 121 `account_id` → 4, restoring history and drift detection.
- Account 12 nickname → `Happen Bank` (this, not `display_name`, is what actually renders).
  `display_name` also corrected from `Happen Bank (Lending CLub)`.
- The two `bill_paid_months` rows (2026-07, 2026-08) repointed from the deleted bill 3 to
  bill 121, so the surviving bill owns its own timeline. August had been showing unpaid
  despite the 2026-08-21 payment.
- `merchant_rules` `happenbank` → `debt_payment`, and the 2 transactions under it
  recategorised to match the 18 months before the rename.

**Verified end to end** against a copy: renaming through the modal preserves the bill's id,
`account_id`, both paid months and its history rows, while the name the UI reads changes.
Explicitly sent values still overwrite. The loan path was exercised separately via bill 116.

## Still open

- **Personal Loan (8337) is still stale** (`balance_date` 2026-06-21). KNOWN-ISSUES asked
  whether this was the same reconnected-under-a-new-id case as Chase. **It is not** — there
  is no inactive duplicate row; every other account refreshed 2026-08-21/22 and this one
  alone did not. `sync` writes `institution`, `name`, `current_balance` and `balance_date`
  in one statement, and the stored institution already reads "Happen Bank (FMA:
  LendingClub)", so SimpleFin last returned this account on 2026-06-21 and has not
  returned it since. That is a re-authorisation on the SimpleFin bridge, not a code or
  data fix. The balance predates two $910.09 payments and feeds net worth and the payoff
  plan.
- Bill history for this bill only reaches back to 2026-07. The merchant pattern
  `happenbank` cannot match the `LendingClub` descriptor on the 16 payments before the
  rename — a single `LIKE` per bill can only follow one descriptor across a rebrand.


---

# Hearth — Session log, 2026-08-22 (afternoon): why safe-to-move swings

## Why

Reported symptom: ~$1,500 safe-to-move at the start of the week, "in the hole" midweek,
$736 by Saturday. Replayed `/api/dashboard` against each daily backup with the clock
frozen to that morning, so every figure below is what the app actually showed.

| date | | bills bal | safe to move |
|---|---|---|---|
| 08-13 Thu | | 686.41 | 636.41 |
| 08-14 Fri | payday+1 | 4,314.90 | 1,624.02 |
| 08-17 Mon | | 3,703.71 | 2,223.40 |
| 08-19 Wed | | 2,158.09 | 991.76 |
| 08-21 Fri | | 3,103.26 | 760.12 |
| 08-22 Sat | 03:30 | 1,914.29 | **-316.47** |
| 08-22 Sat | now | 1,914.29 | **736.15** |

## Root cause — one cause, two symptoms

The balance and the transaction feed are never describing the same moment. Over the 9
days of balance history now on record, the feed's transactions failed to explain the
balance movement **every single day** — residuals from $216 to $3,970, cumulative
$10,990. SimpleFin moves the balance when the bank posts; transactions arrive 24-48h later.

`get_available_balance` (authoritative, current) is the projection's starting point, and
everything that decides "has this already happened?" reads the transactions table (1-2
days stale). So money in flight is counted twice, in whichever direction it is moving:

1. **Payday** — the deposit is inside the balance but absent from the feed, so
   `_deposit_already_landed` returns False and the paycheck is projected on top of a
   balance that already holds it. Reproduced from one database with the clock moved a
   single day: safe-to-move $4,264.90 (Aug 13 afternoon) vs $1,624.02 (Aug 14 morning).
   $2,640 of phantom money. This had been "fixed" twice in opposite directions, because
   both readings are true at different hours — and neither could work while the app had
   no memory of yesterday's balance.

2. **Bill payments** — same mechanism, reversed. At 03:30 on 08-22 the balance had
   already lost the $910.09 loan payment and the $221.87 electric bill; neither
   transaction had arrived (they landed in the 09:18 sync). Both bills were still
   projected as due, so $1,052.62 was subtracted twice. That is the entire distance
   from "-316.47, in the hole" to "736.15" — the household's actual position never moved.

## Changes

- **`0003_account_balance_history`** — one row per account per sync, recording the
  reported balance. This is the memory the app was missing. Backfilled 150 observations
  from the 10 daily backups so it works immediately rather than after two days.
- `sync` writes an observation on every run.
- `_deposit_already_landed` gains a second signal: the balance jump since the last
  reading on an earlier day. Used only to say "already landed", never "hasn't", so it can
  only remove a double-count, never invent one. Verified across three scenarios — deposit
  landed mid-day (no longer double-counted), no prior-day row (falls back to the day's
  first reading), and money genuinely not yet arrived (still projected, so the 2026-08-20
  payday-blind-spot fix is preserved).
- Dashboard ships `bills_low_label` — the single event that sets the 60-day minimum, and
  therefore the whole number. The Bills card now reads "↳ set by Google Fi".
- Dashboard ships `bills_reserved_but_paid[]` — bills the statement already shows paid
  that the forecast is still holding money for, with an amber callout naming each one and
  what ticking it off would return.

## Deliberately not done

- **The debit half of the double-count is still open.** The fix needs the same
  balance-derived evidence, but attributing a balance drop to a *particular* bill is
  harder than spotting a paycheck. The tractable version is aggregate: the residual
  between the balance move and the feed total is money that has already left, and the
  reserve should be reduced by it. Now measurable from `account_balance_history`.
- **Auto-marking bills paid.** `/api/bills/reconcile` already proves paid status from
  transactions and is simply never written back to `bill_paid_months`. Wiring it is
  small; the bill list cannot support it yet. Validated against the 22 bills ticked by
  hand: agreement only 17-25 of 35, and the failures are structural — 27 of 35 bills have
  no `merchant_pattern` and fall back to the first 8 characters of the raw bank
  description (Hulu's term is `'Hulu    '`, padding included, matching 3 transactions
  instead of 13); "Capital One HYSA" and "Roth IRA" each exist 4x for days 1/7/14/21, so
  one $25 payment would tick four bills; and no global amount tolerance works when a
  normal electric bill lands at $221.87 against $142.53 expected. Wiring it on today
  would mark bills paid that are not, pushing safe-to-move *up* — the direction that
  overdraws the account.


## Follow-up, same day: the debit half closed

`unreported_debits()` measures the blind spot directly — what the balance actually did
since the last recorded reading, minus what the feed can account for. The debit side of
that residual is money that has demonstrably left the account without being itemised.

A bill due TODAY is the only occurrence the projection still exposes (past dates are
already excluded), and it is settled against that residual, capped by it, and only for
autopay bills. The projection can therefore never assume less outflow than the account
can prove it has already spent.

Two bugs surfaced while building it, both found by replaying 2026-08-22:
- The feed window has to start at the baseline READING, not at midnight today, or
  yesterday's activity looks unexplained.
- The feed sum must be bounded at today. USAA reports scheduled payments as future-dated
  rows (two dated 2026-08-28), and that money has not moved — counting it made the feed
  appear to explain $1,092.68 of a drop it had nothing to do with.

**Result, replaying 2026-08-22 03:30:** safe-to-move reads **736.15** instead of
**-316.47** — the same figure the app only reached nine hours later, and the same figure
it shows now. Across the week, 08-15 corrects 1,362.69 → 1,661.69 and 08-18 corrects
1,630.12 → 1,944.10; the rest are unchanged, because the rest were real balance moves.

Both settlements are shown on the Bills card rather than applied silently — it is an
inference, and it should be checkable.

### Known trade-off
Settlement attributes unexplained debits to bills due that day. In this household the
Bills account is dedicated (discretionary lives in Food), so unexplained debits there are
overwhelmingly bill payments — but a large unreported transfer to Food on a bill's due
date could settle a bill that has not actually been paid. The exposure is bounded by the
residual, lasts at most a day (the transaction arrives and the occurrence passes), and is
visible on the card.


## Follow-up: bill-list cleanup and automatic paid detection

Backups: `finance-pre-cleanup-*.db`, `finance-pre-0004-*.db`.

### Matching was broken by whitespace
Bank descriptions are fixed-width fields padded with spaces, and the padding is not
stable — the same merchant arrives as `CAPITAL ONE      TRANSFER` and
`ACH - CAPITAL ONE     TRANSFER`. Worse, a bill whose name is a padded description
carries the padding into its match term: Hulu's was `'Hulu    '`, matching 3 of its 13
payments. `norm_desc()` (registered on every connection) collapses whitespace on both
sides of the comparison, and every matching query now uses it.

### Two more silent descriptor changes, the same failure as LendingClub
- **Fidelity → `FID BKG SVC LLC MONEYLINE` on 2026-03-18.** Five contribution bills
  matched nothing for six months. The money never stopped leaving: $25 weekly (Roth),
  $100 monthly (529), and a **$50 monthly payment that is not modelled as a bill at all**.
- **USAA loan → `USAA UNSECURED FIXED RATE LOAN PAYMENT`.** `ICPAYMENT` runs to
  2026-06-29 and stops; there is **no July payment under either descriptor**.

### Data changes applied (29)
- **8 due days** corrected against each bill's own history: Best Egg 25→24, Honda 16→15,
  Pedernales 22→21, Optimum 14→12, Atmos 21→22, Rent 3→1, TLE 16→17 and 3→2.
- **TLE mid-month amount 526.25 → 635.00.** Austin confirms it is one monthly obligation
  paid in two halves; both halves have been $635.00 all year, so this understated the
  real cost by $108.75/month.
- **Two duplicate groups collapsed.** Capital One HYSA and Roth IRA were each four
  monthly $25 bills on days 1/7/14/21. Both are weekly — Capital One transfers land
  every Tuesday, Fidelity every Friday, gaps of exactly 7 days with no exceptions. Now
  one weekly bill each; the other six are retired. Active bills: 35 → 29.
- **16 merchant patterns set, hand-picked.** `_bill_pattern_from_desc` was not used: it
  proposed `'payment'` (70 matches), `'brokerage'`, `'energy'`, and for Audible a one-off
  order id matching 1. It also had `'services'` on Moxie, which matched 16 Fidelity
  transactions — a live false-positive generator, now `'moxie'`.

### Automatic paid detection
`auto_paid_lookup()` settles a bill when the statement shows the payment. `paid_lookup()`
is now the single answer to "is this paid" for the Dashboard, Calendar, Bills tab,
monthly report and AI briefing — previously five separate reads of the same table.

Safeguards, because a false positive frees money that is still owed:
- only bills with an explicit `merchant_pattern`; the `name[:8]` fallback matches by accident
- **only transactions dated on or before today** — USAA publishes scheduled payments as
  future-dated rows, and the first run settled the USAA loan against a 2026-08-28 payment
  that has not happened
- one transaction settles one bill, assigned nearest-first by due day then amount. This
  is what lets the two TLE payments and the two Netflix subscriptions resolve correctly
  rather than each claiming the other's transaction
- amount within 3x, which separates a $25 Roth contribution from a $100 529 one without
  rejecting an electric bill that doubled
- weekly bills are never auto-settled (one mark cannot represent several occurrences)

`0004_bill_paid_state` adds `state` so a manual mark can say "not paid" as well as
"paid" — unticking now records disagreement instead of deleting a row that auto-detection
would immediately refill. Verified: auto-detected → untick → stays unpaid → re-tick → paid.

**Result: 14 of 29 bills marked paid this month without anyone ticking them.**

### This surfaced a real problem
Safe-to-move now reads **-281.48**, not +736.15 — and it is right. Rent's due day was
3, so it landed on payday and was covered by that morning's deposit. Its actual history
is `[31, 2, 1, 1]`: it is paid on the **1st**. Corrected, rent lands two days before
Anushka's 2026-09-03 paycheck:

    09-01  Rent (Madison)      -2452.00   685.34
    09-01  Citi Mastercard      -200.00   485.34
    09-02  Frontpoint            -56.82   403.52
    09-02  TLE Lake Georgetown  -635.00  -231.48   <<<
    09-03  Anushka paycheck    +1576.81  1345.33

A genuine two-day shortfall of $281.48, previously hidden by a wrong due date.
