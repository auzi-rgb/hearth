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
