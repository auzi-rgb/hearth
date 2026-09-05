"""record each account's reported balance over time

The Bills projection needs to answer one question on payday: has the paycheck
actually landed? Until now the only available signal was the transactions table
(`_deposit_already_landed`), and that is the one source guaranteed to say "no" at
the moment it matters — SimpleFin's balance moves as soon as the bank posts the
deposit, while the transaction feed trails it by up to two days.

Reproduced against the 2026-08-14 backup: same database, same $4,314.90 balance,
clock set to Aug 13 vs Aug 14, safe-to-move reads $4,264.90 vs $1,624.02. The
$4,113.13 of paychecks is counted twice — once inside the reported balance, once
again as a future event — because no transaction existed yet to prove otherwise.

This has been "fixed" twice in opposite directions (never project today's paycheck
/ always project it unless a transaction proves it landed) because both readings
are true at different hours of the same day. Neither can work while the app has no
memory of what the balance was yesterday. This table gives it that memory: the
deposit is then visible as a jump in the balance itself, which is available
immediately rather than two days late.

One row per account per observation. Sync writes one on every run.

Revision ID: 0003_account_balance_history
Revises: 0002_startup_backfills
Create Date: 2026-08-22
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_account_balance_history"
down_revision = "0002_startup_backfills"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "account_balance_history",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("account_id", sa.Integer, nullable=False),
        sa.Column("balance", sa.Float, nullable=False),
        # The bank's own timestamp for the balance, not our clock — two syncs can
        # report the same balance-date, and only one of them is new information.
        sa.Column("balance_date", sa.String, nullable=True),
        sa.Column("observed_at", sa.String, nullable=False),
        sa.Column("observed_date", sa.String, nullable=False),
    )
    # The lookup is always "this account, on/before this date, most recent first".
    op.create_index(
        "ix_abh_account_date",
        "account_balance_history",
        ["account_id", "observed_date"],
    )


def downgrade():
    op.drop_index("ix_abh_account_date", table_name="account_balance_history")
    op.drop_table("account_balance_history")
