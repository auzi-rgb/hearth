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
