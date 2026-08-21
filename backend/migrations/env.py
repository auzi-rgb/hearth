"""Alembic environment for Hearth.

Hearth talks to SQLite through the stdlib `sqlite3` module and has no ORM models,
so there is no metadata to autogenerate against — `target_metadata` stays None and
every migration is written by hand. Alembic is here for what rule 9 actually asks
for: ordered, versioned, reviewable schema changes with a recorded position, instead
of idempotent `ALTER TABLE` calls buried in `try/except` at startup.

The database location is derived the same way `main.py` derives it (a `finance.db`
sitting next to the backend package), so migrations and the app can never disagree
about which file they are operating on. `sqlalchemy.url` in alembic.ini is left
empty on purpose — a hardcoded path there would be a second source of truth.
"""
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Env override exists so a migration can be rehearsed against a scratch copy before
# it is run against the real database — see `docs/migrations.md`.
DB_PATH = os.environ.get("HEARTH_DB_PATH") or os.path.join(BACKEND_DIR, "finance.db")
DB_URL = f"sqlite:///{DB_PATH}"

target_metadata = None


def _configure(**kwargs):
    context.configure(
        target_metadata=target_metadata,
        # SQLite cannot ALTER most things in place; batch mode rebuilds the table
        # via copy-and-rename. Without it, any future column drop or type change
        # fails outright on this database.
        render_as_batch=True,
        compare_type=True,
        **kwargs,
    )


def run_migrations_offline() -> None:
    _configure(url=DB_URL, literal_binds=True,
               dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(DB_URL, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        _configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
