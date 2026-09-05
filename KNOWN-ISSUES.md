# Hearth — Known Issues & Backlog

Open bugs and planned fixes. Kept out of `README.md` (which describes current state only).
When one is fixed, remove it here and note it in that session's `HEARTH-CHANGES-*.md`.

## The big one
- **The balance and the transaction feed describe different moments, every single day.**
  Measured 2026-08-22 over 9 days of balance history on the Bills account: on no day did
  the feed's transactions account for the balance movement. Gaps ran from $216 to $3,970,
  cumulative |unreported| $10,990 over 9 days. SimpleFin updates the *balance* as soon as
  the bank posts; the *transactions* trail it by 24-48h. Every calculation that starts
  from `get_available_balance` and then decides "what has already happened?" from the
  transactions table is comparing two different days, and the difference lands directly
  in safe-to-move:
    - **Payday**: deposit is in the balance, absent from the feed → projected again →
      overstates. Reproduced at $2,640 on 2026-08-13. **Fixed** by `0003_account_balance_history`
      (see below), which detects the deposit from the balance jump instead.
    - **Bill payments**: money has left the balance, absent from the feed → bill still
      projected as due → understates. On 2026-08-22 this hid $1,052.62 and read as "in
      the hole". **Fixed** by `unreported_debits()`, which settles a bill due today
      against the measured residual, capped by it.
  Both halves are now closed. What remains is bill-list accuracy (below), which is what
  determines whether the projection is asking the right questions in the first place.

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

## Bill-list accuracy — RESOLVED 2026-08-22 (see HEARTH-CHANGES). Remaining:
- **Four bills still have no merchant_pattern and cannot be auto-settled**: the three
  credit-card bills (Citi, Platinum Visa, Chase Freedom) all pay as `Credit Card Payment`
  / `USAA CREDIT CARD PAYMENT` and cannot be told apart, and `Apple Bill` is charged to
  the Citi card (account 10), not the Bills account — it is modelled in the wrong place.
- **A $50/month Fidelity contribution is not modelled as a bill at all** (visible as
  `FID BKG SVC LLC MONEYLINE` on ~the 18th, every month since March).
- **The USAA loan has no July payment** under either the old `ICPAYMENT` descriptor or
  the new `USAA UNSECURED FIXED RATE LOAN PAYMENT`. Worth checking with USAA.
- **A bill's history still follows only one descriptor.** Now that patterns are set this
  bites on rebrands: Happen Bank sees 2 of 18 payments, the USAA loan 1 of 13. An alias
  list per bill would fix it.

## Superseded survey (2026-08-22, applied)
- **7 bills have a due day that disagrees with their own payment history** — Best Egg
  25→24, Honda 16→15, Pedernales 22→21, Optimum 14→12, Atmos 21→22, Rent 3→1, TLE 16→17.
  Each double-counts for exactly the days it is wrong by.
- **Two groups of 4 duplicate bills** — "Capital One HYSA" and "Roth IRA", both modelled
  as four monthly bills on days 1/7/14/21 at $25. Each is really one weekly contribution;
  as monthly rows they understate the true monthly cost ($100 vs $108.33) and one payment
  would mark all four paid under any auto-detection.
- **Some bills cannot be told apart by description at all.** The two TLE Lake Georgetown
  bills share `Tle at Lake Geor Payment`; the four Roth IRA bills and the 529 all share
  `Fidelity Brokerage Services`; "Capital One" for the HYSA transfer also matches
  `CAPITAL ONE AUTO DIRECTPAY` (the Hyundai loan). These need amount-based
  disambiguation or must be accepted as un-matchable.
- **`_bill_pattern_from_desc` generates unsafe patterns.** Asked for the 27 bills with no
  pattern it proposed `'payment'` (matches 70 transactions), `'brokerage'`, `'energy'`,
  `'mountain'`, and for Audible a one-off order id `'v13ev7b53'` (matches 1). It should
  prefer the merchant token, and reject candidates that match implausibly many or few.

## Missing management
- **No paycheck DELETE endpoint/UI** — a phantom auto-detected paycheck currently requires a
  SQL delete to remove.
- **A bill's history only follows one merchant descriptor.** Each bill matches transactions
  through a single `merchant_pattern` LIKE, so when an institution rebrands (LendingClub →
  HappenBank) the payments before the change stop appearing in that bill's history, creep
  and rolling stats. Bill 121 sees 2 of 18 payments. Would need a list of patterns per bill,
  or an alias table.

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
  balance hasn't moved in two months. Feeds net worth and the payoff plan. **Investigated
  2026-08-22: this is NOT the Chase reconnected-under-a-new-id case** — there is no inactive
  duplicate row, and every other account refreshed 2026-08-21/22. `sync` writes
  `institution`, `name`, `current_balance` and `balance_date` in a single statement, and the
  stored institution already reads "Happen Bank (FMA: LendingClub)", so SimpleFin last
  returned this account on 2026-06-21 and has not returned it since. **Needs re-authorizing
  on the SimpleFin bridge** — there is no code or data fix from this side.
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
