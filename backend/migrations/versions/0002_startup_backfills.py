"""move init_db()'s one-time data backfills into a migration that runs once

These three UPDATEs lived at the top of `init_db()` and therefore re-ran on every
single restart. Two of them are historical corrections that were finished years ago;
one was papering over an insert that forgot a column. Leaving them in startup had a
real cost:

* The transfer backfill re-flagged `is_transfer=1` on anything matching the USAA
  wording — every boot. `PUT /api/transactions/{id}/transfer` lets the household
  say "this one is NOT a transfer", and the next restart silently overruled them.
  A user decision must outlive a service restart.
* The Contribution reclassification re-typed any bill whose name mentions roth /
  hysa / 529, every boot. Setting such a bill back to Recurring on the Bills tab
  would not survive either.
* `frequency = 'monthly' WHERE frequency IS NULL` was hiding that three of the four
  `INSERT INTO bills` paths never set the column. That is fixed at the inserts now;
  this backfill only has to close out rows created before that fix.

Running them once here, as history, is the honest place for them. Startup goes back
to doing nothing but bringing the schema to head.

Revision ID: 0002_startup_backfills
Revises: 0001_baseline
Create Date: 2026-08-20
"""
from alembic import op

revision = "0002_startup_backfills"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Bills created before `frequency` existed, or through an insert that omitted
    # it. Monthly is the only sensible reading: weekly bills are the ones that
    # carry an explicit frequency plus a day_of_week.
    op.execute("UPDATE bills SET frequency = 'monthly' WHERE frequency IS NULL")

    # Savings/investment transfers entered as Recurring bills before the
    # Contribution type existed. Chosen allocations, not hardline obligations.
    op.execute("""
        UPDATE bills SET payment_type = 'Contribution'
         WHERE payment_type = 'Recurring'
           AND (LOWER(name) LIKE '%roth%' OR LOWER(name) LIKE '%hysa%'
                OR LOWER(name) LIKE '%529%' OR LOWER(name) LIKE '%high-yield%'
                OR LOWER(name) LIKE '%high yield%')
    """)

    # Internal transfers imported before sync learned to flag them at insert time.
    # sync now applies `transfer_detection_phrases` as rows arrive, so this is
    # purely historical cleanup — and unlike the startup version it will never
    # again overrule a manual un-flag.
    op.execute("""
        UPDATE transactions SET is_transfer = 1
         WHERE is_transfer = 0
           AND (LOWER(description) LIKE '%usaa funds transfer%'
                OR LOWER(description) LIKE '%funds transfer db%'
                OR LOWER(description) LIKE '%funds transfer cr%')
    """)


def downgrade() -> None:
    # These reclassify data using rules that cannot distinguish what they changed
    # from what already looked that way, so there is no honest inverse. Restore
    # from backend/backups/ if one of them turns out to be wrong.
    raise NotImplementedError(
        "Data backfills are not reversible — restore from backend/backups/ instead."
    )
