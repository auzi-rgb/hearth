"""let a paid-mark record "not paid" as well as "paid"

Paid status is about to stop being purely manual: a bill whose payment is visible on
the statement will be marked paid automatically. That only works if the household can
still overrule it, in both directions — the old table could express "I say this is
paid" (a row exists) but had no way to say "I say this is NOT paid, whatever you
think you found", because absence of a row is also what auto-detection fills in.

`state` makes the disagreement expressible. Existing rows are all deliberate ticks,
so they become 'paid'.

Revision ID: 0004_bill_paid_state
Revises: 0003_account_balance_history
Create Date: 2026-08-22
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_bill_paid_state"
down_revision = "0003_account_balance_history"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("bill_paid_months") as b:
        b.add_column(sa.Column("state", sa.String, nullable=False, server_default="paid"))


def downgrade():
    with op.batch_alter_table("bill_paid_months") as b:
        b.drop_column("state")
