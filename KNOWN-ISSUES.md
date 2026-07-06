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

## Measurement tension (not a bug, but a decision to make)
- **`L` (actual living spend) is measured on a different basis than `U` (budget).** The
  squeeze guard counts all discretionary across all accounts (~$5.4k); the food-runway uses
  Food-account outflow only (~$3.5k); `U` budgets just 4 primary categories (~$1.45k). They
  answer different questions but should be reconciled (or the budget expanded to cover all
  living categories) so the equation's "spend under U" story is apples-to-apples.
