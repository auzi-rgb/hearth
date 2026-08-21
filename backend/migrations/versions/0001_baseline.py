"""baseline: schema as built by init_db() up to 2026-08-20

Captured verbatim from the production database rather than retyped, so a database
created by `alembic upgrade head` is identical to the one years of idempotent
`ALTER TABLE ... ADD COLUMN` calls produced. That equivalence is the whole point:
it is what lets the app be rebuilt from an empty file and a fresh sync.

Existing databases are `alembic stamp`ed at this revision instead of running it —
they already have these tables. Every statement is still IF NOT EXISTS so a
partially-built database cannot wedge the first upgrade.

Revision ID: 0001_baseline
Create Date: 2026-08-20
"""
from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # table: accounts
    op.execute("""CREATE TABLE IF NOT EXISTS accounts ( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, institution TEXT, simplefin_id TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL , current_balance REAL, balance_date TEXT, interest_rate REAL, minimum_payment REAL, nickname TEXT)""")
    # table: ai_briefings
    op.execute("""CREATE TABLE IF NOT EXISTS ai_briefings ( id INTEGER PRIMARY KEY AUTOINCREMENT, briefing_date TEXT NOT NULL UNIQUE, content TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL )""")
    # table: ai_facts
    op.execute("""CREATE TABLE IF NOT EXISTS ai_facts ( id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general', created_at TEXT NOT NULL, last_confirmed_at TEXT NOT NULL, source_session_id INTEGER )""")
    # table: ai_sessions
    op.execute("""CREATE TABLE IF NOT EXISTS ai_sessions ( id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, message_count INTEGER NOT NULL DEFAULT 0, summary TEXT, transcript TEXT )""")
    # table: bill_paid_months
    op.execute("""CREATE TABLE IF NOT EXISTS bill_paid_months ( id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id INTEGER NOT NULL, month TEXT NOT NULL, paid_date TEXT, UNIQUE(bill_id, month) )""")
    # table: bills
    op.execute("""CREATE TABLE IF NOT EXISTS bills ( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, expected_amount REAL NOT NULL, confidence TEXT NOT NULL DEFAULT 'fixed', day_of_month INTEGER, account_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1 , bill_type TEXT, payment_type TEXT, from_debt_budget INTEGER DEFAULT 0, linked_loan_id INTEGER, notes TEXT, linked_account_id INTEGER, frequency TEXT, day_of_week INTEGER, display_name TEXT, merchant_pattern TEXT, autopay INTEGER NOT NULL DEFAULT 1)""")
    # table: budgets
    op.execute("""CREATE TABLE IF NOT EXISTS budgets ( id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL UNIQUE, monthly_limit REAL NOT NULL )""")
    # table: categories
    op.execute("""CREATE TABLE IF NOT EXISTS categories ( name TEXT PRIMARY KEY, parent TEXT, is_base INTEGER NOT NULL DEFAULT 0, FOREIGN KEY (parent) REFERENCES categories(name) )""")
    # table: ignored_bill_patterns
    op.execute("""CREATE TABLE IF NOT EXISTS ignored_bill_patterns ( id INTEGER PRIMARY KEY AUTOINCREMENT, pattern TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL )""")
    # table: loans
    op.execute("""CREATE TABLE IF NOT EXISTS loans ( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, original_balance REAL, current_balance REAL, interest_rate REAL, monthly_payment REAL, payments_made INTEGER DEFAULT 0, total_payments INTEGER, start_date TEXT )""")
    # table: merchant_rules
    op.execute("""CREATE TABLE IF NOT EXISTS merchant_rules ( id INTEGER PRIMARY KEY AUTOINCREMENT, pattern TEXT NOT NULL UNIQUE, category TEXT NOT NULL, created_at TEXT NOT NULL )""")
    # table: monthly_reports
    op.execute("""CREATE TABLE IF NOT EXISTS monthly_reports ( id INTEGER PRIMARY KEY AUTOINCREMENT, month TEXT NOT NULL UNIQUE, data TEXT NOT NULL, created_at TEXT NOT NULL )""")
    # table: net_worth_history
    op.execute("""CREATE TABLE IF NOT EXISTS net_worth_history ( id INTEGER PRIMARY KEY AUTOINCREMENT, recorded_at TEXT NOT NULL, assets REAL NOT NULL, liabilities REAL NOT NULL, net_worth REAL NOT NULL )""")
    # table: paychecks
    op.execute("""CREATE TABLE IF NOT EXISTS paychecks ( id INTEGER PRIMARY KEY AUTOINCREMENT, person TEXT NOT NULL, expected_amount REAL, actual_amount REAL, expected_date TEXT, actual_date TEXT, is_third_friday_period INTEGER DEFAULT 0, notes TEXT )""")
    # table: settings
    op.execute("""CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT )""")
    # table: sync_log
    op.execute("""CREATE TABLE IF NOT EXISTS sync_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, synced_at TEXT NOT NULL, accounts_updated INTEGER DEFAULT 0, transactions_added INTEGER DEFAULT 0, status TEXT NOT NULL, error_message TEXT )""")
    # table: transactions
    op.execute("""CREATE TABLE IF NOT EXISTS transactions ( id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, amount REAL NOT NULL, description TEXT, category TEXT, transaction_date TEXT NOT NULL, posted_date TEXT, is_pending INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, is_transfer INTEGER NOT NULL DEFAULT 0, category_confirmed INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (account_id) REFERENCES accounts(id) )""")
    # table: transfers
    op.execute("""CREATE TABLE IF NOT EXISTS transfers ( id INTEGER PRIMARY KEY AUTOINCREMENT, transfer_date TEXT NOT NULL, amount REAL NOT NULL, suggested_amount REAL, notes TEXT, created_at TEXT NOT NULL )""")
    # table: users
    op.execute("""CREATE TABLE IF NOT EXISTS users ( id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, hashed_password TEXT NOT NULL, created_at TEXT NOT NULL )""")
    # index: idx_txn_unique
    op.execute("""CREATE UNIQUE INDEX idx_txn_unique ON transactions(account_id, transaction_date, amount, description)""")


def downgrade() -> None:
    # Dropping every table would destroy the household's entire financial history.
    # There is nothing below a baseline to step back to, so this refuses rather
    # than pretending to be reversible.
    raise NotImplementedError(
        "The baseline migration is not reversible — downgrading would drop every "
        "table. Restore from backend/backups/ instead."
    )
