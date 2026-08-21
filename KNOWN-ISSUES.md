# Hearth — Known Issues & Backlog

Open bugs and planned fixes. Kept out of `README.md` (which describes current state only).
When one is fixed, remove it here and note it in that session's `HEARTH-CHANGES-*.md`.

## Data integrity
- **Sync fuzzy dedup can drop real transactions** (`sync.py`) — a new transaction with the
  same account + amount within 1 day of an existing one (different description) is treated
  as a duplicate. Two distinct same-priced purchases on the same day → the second is never
  imported. Highest-priority: it's silent data loss.
- **Account deactivate→reactivate corrupts `is_transfer`** — reactivating clears the flag on
  ALL the account's transactions, including genuine internal transfers.
- **Startup no longer re-runs data backfills** (fixed 2026-08-20) — three UPDATEs at the
  top of `init_db()` re-ran on every boot; one re-flagged `is_transfer` on transactions the
  household had manually un-flagged, silently overruling them. Moved to migration
  `0002_startup_backfills`, which runs once. If you find another "one-time" fix living in
  startup, it belongs in a revision.
- **DB connections leak on error** — endpoints open a connection without try/finally, so a
  mid-request exception leaves it unclosed. Harmless single-user, but sloppy.

## Missing management
- **No paycheck DELETE endpoint/UI** — a phantom auto-detected paycheck currently requires a
  SQL delete to remove.

## Security (low urgency — LAN-only deployment)
- **No rate limit on `/api/auth/login`** (slowapi is only on `/api/ai/chat`).
- **`verify=False` on SimpleFin HTTPS calls** — TLS verification is disabled for real banking
  traffic; only the internal AI gateway (self-signed) actually needs it.
- **CORS `allow_origins=["*"]`**.
- **No input validation** — endpoints parse raw JSON without Pydantic models; a missing field
  yields a 500 instead of a clean 400.

## Dashboard logic (found 2026-08-20, not yet fixed)
- **An unscheduled bill is still silently skipped.** Bill 116 was fixed (day 27, $291.37),
  but the underlying hole remains: a `monthly` bill with `day_of_month` NULL is dropped by
  `cash_flow_projection` and `upcoming_bills` while `hardline_total` and
  `monthly_bills_total` still count it. Nothing warns. Make it loud in both places.
- **Two different "next paycheck" dates on one screen.** `days_until_paycheck` comes from
  `detect_next_payday` (can be today), `bills_until_next_paycheck_date` from the projection
  (always future). They disagreed by a week on 2026-08-20.
- **`bills_before_next_pay` ignores paid status.** Computed before the `paid` flags are set,
  so it counts already-paid bills, while `bills_left_month` right below it does not.
- **The projection never reserves the Food transfers.** ~$1,450/mo leaves Bills as transfers
  but isn't in the timeline, so the projected balance climbs indefinitely. `sweep_suggestion`
  claims it "reserved every upcoming bill" — true, but it didn't reserve food.
- **Dead payload fields.** `/api/dashboard` returns 69 fields; `encumbered_30d`,
  `recommended_transfer` and `spendable_in_food` are hardcoded `0`, and those plus
  `reserve_needed`, `available_cash_this_month`, `projected_month_end` and
  `bills_before_next_pay` have zero frontend references. `monthly_surplus` and
  `left_to_live` are the same formula under two names.
- **`sweep_suggestion` can never fire.** It needs ≥2 rows in `transfers`, which is empty —
  the household's real Bills→Food transfers are ad hoc bank transfers, never recorded there.

## Data freshness
- **Personal Loan (8337) (Happen Bank / LendingClub) is stale.** `balance_date` 2026-06-21;
  the $910.09 bill is still being paid from Bills each month, so the loan is live but its
  balance hasn't moved in two months. Feeds net worth and the payoff plan. Check whether the
  SimpleFin connection needs re-authorizing — and whether it is the same
  reconnected-under-a-new-id case Chase turned out to be.
- **A reconnected account goes inactive and nothing chases the warning.** When an
  institution is reconnected, SimpleFin issues a new account id; sync's name-clash guard
  inserts it INACTIVE (correctly, to avoid double-counting) and returns a warning that is
  only shown on the next dashboard load. Chase sat frozen for two months this way. The
  warning should persist until acted on, with a one-click "this replaces that account" merge.

## Measurement tension (not a bug, but a decision to make)
- **`L` (actual living spend) is measured on a different basis than `U` (budget).** The
  squeeze guard counts all discretionary across all accounts (~$5.4k); the food-runway uses
  Food-account outflow only (~$3.5k); `U` budgets just 4 primary categories (~$1.45k). They
  answer different questions but should be reconciled (or the budget expanded to cover all
  living categories) so the equation's "spend under U" story is apples-to-apples.
