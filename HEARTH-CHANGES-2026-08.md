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
