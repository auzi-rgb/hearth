# Database migrations

Alembic owns Hearth's schema. `init_db()` no longer creates or alters anything — it
runs `alembic upgrade head` and refuses to start the app if that fails.

## Why

The schema used to be built by `CREATE TABLE IF NOT EXISTS` plus fifteen
`ALTER TABLE ... ADD COLUMN` calls in bare `try/except`, re-executed on every boot.
It worked, but the schema was whatever sequence of edits had accumulated: no record
of order, no way to review a change before it ran, and no way to build the database
from scratch and know you had the same thing.

That last point is the one that matters. **You should be able to delete the database,
resync from SimpleFin, and land on the same app.** A schema that only exists as the
residue of past edits can't give you that.

## Layout

```
backend/alembic.ini                    # script_location + empty sqlalchemy.url
backend/migrations/env.py              # derives the DB path the way main.py does
backend/migrations/versions/           # one file per revision
```

Hearth uses the stdlib `sqlite3` module and has no ORM models, so there is nothing
for Alembic to autogenerate against. **Every migration is written by hand** with
`op.execute()`. `target_metadata` is `None` on purpose — `alembic revision
--autogenerate` will produce an empty migration, which is expected, not a bug.

`sqlalchemy.url` in `alembic.ini` is deliberately blank. `env.py` computes the path
(`finance.db` beside the backend package), so there is exactly one source of truth
about which file is being modified.

## Adding a migration

```bash
cd ~/home-finance/backend
python3 -m alembic revision -m "short description"
```

Then edit the generated file in `migrations/versions/`. Keep `down_revision` pointing
at the previous head.

**Rehearse against a copy before touching real data:**

```bash
cp finance.db /tmp/rehearse.db
HEARTH_DB_PATH=/tmp/rehearse.db python3 -m alembic upgrade head
```

`HEARTH_DB_PATH` exists for exactly this. Once it looks right, restarting the service
applies it — `init_db()` runs `upgrade head` at startup.

## Useful commands

```bash
python3 -m alembic current          # what revision is this database on
python3 -m alembic history          # all revisions
python3 -m alembic upgrade head     # apply everything outstanding
python3 -m alembic stamp <rev>      # mark as at <rev> WITHOUT running it
```

`stamp` is how the existing production database adopted the baseline: it already had
those tables, so running `0001_baseline` would have been wrong. Reach for `stamp`
only when the database provably already matches the revision.

## Rules

- **Never hand-run DDL against `finance.db`.** Add a revision. This is build rule 9.
- **SQLite can't alter most things in place.** `render_as_batch=True` is set, so use
  `op.batch_alter_table()` for column drops or type changes — it rebuilds the table
  via copy-and-rename. A plain `op.alter_column()` will fail.
- **Back up first.** `backend/backups/` holds nightly copies; take an extra one
  before a migration that rewrites data.
- **Data backfills are migrations too.** They belong in a revision that runs once —
  not at startup. Three of them used to run on every boot, and one silently
  re-flagged transactions the household had manually un-flagged. A user's decision
  must outlive a restart.
- **Downgrades that would destroy financial history raise instead of pretending.**
  Restore from `backend/backups/`.

## Revisions

| Revision | What |
|---|---|
| `0001_baseline` | Schema as `init_db()` built it up to 2026-08-20, captured verbatim from the production database so a fresh `upgrade head` is byte-identical. |
| `0002_startup_backfills` | The three data backfills that used to re-run on every boot, moved here to run once. |
