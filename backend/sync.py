import sqlite3
import os
from datetime import datetime, date, timedelta
import httpx

DB_PATH = os.path.join(os.path.dirname(__file__), "finance.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def get_setting(conn, key, default=None):
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default

CATEGORY_KEYWORDS = {
    "food":      ["grocery","kroger","walmart","target","whole foods","trader joe","publix","aldi","costco","sams club","food","restaurant","pizza","mcdonald","burger","taco","chipotle","subway","starbucks","dunkin","coffee","cafe","diner","eat","grill","kitchen","bakery","sushi","thai","chinese","mexican","italian","domino","kfc","wendy","chick"],
    "gas":       ["shell","bp","exxon","chevron","mobil","sunoco","marathon","gas","fuel","speedway","circle k","wawa","love's","pilot","casey"],
    "household": ["home depot","lowe","ace hardware","bed bath","ikea","amazon","wayfair","cleaning","hardware","plumbing","paint","electric","supply","dollar general","dollar tree","family dollar"],
}

def auto_category(description: str) -> str | None:
    # No match means None, not "other" — "other" is a real category someone
    # deliberately picks, not a silent dumping ground for "couldn't guess."
    # A transaction that lands here shows up as needing manual review instead
    # of quietly disappearing into a catch-all bucket that's never looked at again.
    if not description:
        return None
    d = description.lower()
    for cat, kws in CATEGORY_KEYWORDS.items():
        if any(k in d for k in kws):
            return cat
    return None

async def run_sync():
    conn = get_db()
    access_url = get_setting(conn, "simplefin_access_url")
    if not access_url:
        conn.close()
        return {"status": "skipped", "message": "SimpleFin not configured"}

    now = datetime.now().isoformat()
    accounts_updated = 0
    transactions_added = 0
    error_message = None
    warnings = []

    try:
        # Fetch from SimpleFin — last 90 days
        start_date = int((datetime.now() - timedelta(days=90)).timestamp())
        url = f"{access_url}/accounts?start-date={start_date}"

        async with httpx.AsyncClient(verify=False, timeout=30.0) as client:
            r = await client.get(url)
            r.raise_for_status()
            data = r.json()

        accounts = data.get("accounts", [])

        for sf_acct in accounts:
            sf_id = sf_acct.get("id", "")
            name = sf_acct.get("name") or sf_acct.get("org", {}).get("name", "Unknown")
            acct_type = _map_account_type(sf_acct)
            institution = sf_acct.get("org", {}).get("name", "")

            # Balance from SimpleFin — this is the authoritative current balance
            sf_balance = sf_acct.get("balance")
            sf_balance_ts = sf_acct.get("balance-date")
            balance_date = (
                datetime.fromtimestamp(sf_balance_ts).isoformat()
                if sf_balance_ts else now
            )
            current_balance = float(sf_balance) if sf_balance is not None else None

            # Upsert account — always refresh balance, type, and institution
            existing = conn.execute(
                "SELECT id FROM accounts WHERE simplefin_id=?", (sf_id,)
            ).fetchone()
            if existing:
                acct_id = existing["id"]
                conn.execute(
                    """UPDATE accounts
                       SET name=?, institution=?, current_balance=?, balance_date=?
                       WHERE id=?""",
                    (name, institution, current_balance, balance_date, acct_id)
                )
            else:
                # Before inserting, check if an active account with the same name already
                # exists under a different SimpleFin ID — that's a cross-connection duplicate.
                # Insert it inactive so it doesn't silently double-count balances/spending.
                name_clash = conn.execute(
                    "SELECT id FROM accounts WHERE name=? AND is_active=1 AND (simplefin_id IS NULL OR simplefin_id!=?)",
                    (name, sf_id)
                ).fetchone()
                insert_active = 0 if name_clash else 1
                cur = conn.execute(
                    """INSERT INTO accounts
                       (name, type, institution, simplefin_id, is_active, current_balance, balance_date, created_at)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    (name, acct_type, institution, sf_id, insert_active, current_balance, balance_date, now)
                )
                acct_id = cur.lastrowid
                accounts_updated += 1
                if not insert_active:
                    warnings.append(f"Account '{name}' imported inactive — a same-named active account already exists. Review in Accounts page.")

            # Process transactions
            for txn in sf_acct.get("transactions", []):
                txn_date = date.fromtimestamp(txn.get("transacted_at") or txn.get("posted", 0)).isoformat()
                posted_date = date.fromtimestamp(txn.get("posted", 0)).isoformat() if txn.get("posted") else None
                amount = float(txn.get("amount", 0))
                desc = txn.get("description") or txn.get("memo") or ""
                pending = txn.get("pending", False)

                # Dedup — exact match first, then fuzzy match for same amount ±1 day
                # (SimpleFin sometimes delivers the same transaction with two different
                # description formats: raw bank text and a cleaned merchant name)
                exists = conn.execute(
                    """SELECT id FROM transactions WHERE account_id=? AND transaction_date=?
                       AND amount=? AND description=?""",
                    (acct_id, txn_date, amount, desc)
                ).fetchone()
                if exists:
                    continue
                fuzzy = conn.execute(
                    """SELECT id FROM transactions
                       WHERE account_id=? AND amount=?
                         AND ABS(julianday(transaction_date) - julianday(?)) <= 1
                         AND description != ?""",
                    (acct_id, amount, txn_date, desc)
                ).fetchone()
                if fuzzy:
                    continue

                desc_upper = desc.upper()
                if "PENDING" not in desc_upper:
                    # Clean settled description — delete any "PENDING"-description dupes
                    # for the same account + amount within ±5 days
                    conn.execute(
                        """DELETE FROM transactions
                           WHERE account_id=? AND amount=? AND UPPER(description) LIKE '%PENDING%'
                             AND ABS(julianday(transaction_date) - julianday(?)) <= 5""",
                        (acct_id, amount, txn_date)
                    )
                else:
                    # This description contains "PENDING" — skip if a clean settled version
                    # already exists for the same account + amount within ±5 days
                    settled = conn.execute(
                        """SELECT id FROM transactions
                           WHERE account_id=? AND amount=? AND UPPER(description) NOT LIKE '%PENDING%'
                             AND ABS(julianday(transaction_date) - julianday(?)) <= 5""",
                        (acct_id, amount, txn_date)
                    ).fetchone()
                    if settled:
                        continue

                cat = auto_category(desc)
                # A category from an explicit merchant rule is confirmed (the household
                # set that rule deliberately). Anything that falls through to the raw
                # keyword guess is unconfirmed until a human looks at it.
                cat_confirmed = 0
                rules = conn.execute("SELECT pattern, category FROM merchant_rules ORDER BY length(pattern) DESC").fetchall()
                for rule in rules:
                    if rule["pattern"] and rule["pattern"] in desc.lower():
                        cat = rule["category"]
                        cat_confirmed = 1
                        break

                # Flag internal transfers so they are excluded from spending reports.
                # Loan-account transactions are always the servicer recording your payment —
                # not discretionary spending — so exclude them regardless of description.
                desc_lower = desc.lower()
                is_transfer = 1 if (
                    acct_type in ('loan', 'savings', 'investment') or
                    'usaa funds transfer' in desc_lower or
                    'funds transfer db' in desc_lower or
                    'funds transfer cr' in desc_lower or
                    'interest charged' in desc_lower or
                    'cash advance interest' in desc_lower or
                    'fid bkg svc' in desc_lower
                ) else 0

                conn.execute(
                    """INSERT INTO transactions (account_id, amount, description, category,
                       transaction_date, posted_date, is_pending, is_transfer, category_confirmed, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (acct_id, amount, desc, cat, txn_date, posted_date, 1 if pending else 0, is_transfer, cat_confirmed, now)
                )
                transactions_added += 1

        conn.commit()

        # Detect new paychecks from transaction history
        _detect_paychecks(conn)

        conn.execute(
            """INSERT INTO sync_log (synced_at, accounts_updated, transactions_added, status)
               VALUES (?,?,?,?)""",
            (now, accounts_updated, transactions_added, "ok")
        )
        conn.commit()

    except Exception as e:
        error_message = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
        conn.execute(
            "INSERT INTO sync_log (synced_at, status, error_message) VALUES (?,?,?)",
            (now, "error", error_message)
        )
        conn.commit()

    conn.close()
    return {
        "status": "ok" if not error_message else "error",
        "accounts_updated": accounts_updated,
        "transactions_added": transactions_added,
        "error": error_message,
        "warnings": warnings,
        "synced_at": now,
    }

def _map_account_type(sf_acct: dict) -> str:
    combined = (
        (sf_acct.get("type") or "") + " " + (sf_acct.get("name") or "")
    ).lower()
    if any(k in combined for k in [
        "visa", "mastercard", "amex", "discover", "credit card", "credit",
        "freedom", "sapphire", "quicksilver", "venture", "slate", "ink business",
    ]):
        return "credit"
    if any(k in combined for k in ["loan", "mortgage", "heloc"]):
        return "loan"
    if any(k in combined for k in ["saving", "money market"]):
        return "savings"
    if any(k in combined for k in [
        "529", "roth ira", "ira", "401k", "401(k)", "brokerage",
        "wealth building", "investment", "retirement",
    ]):
        return "investment"
    return "checking"

_AUSTIN_KEYWORDS = ["city of georgeto", "city of georgetown", "georgetown payroll"]
_ANUSHKA_KEYWORDS = ["staffmark", "staf mark", "staffmark invest"]
_SKIP_KEYWORDS = ["interest", "principal", "transfer", "zelle", "venmo", "refund"]

def _detect_paychecks(conn):
    """Scan checking transactions for likely paycheck deposits and log them."""
    today = date.today()
    since = (today - timedelta(days=60)).isoformat()

    accounts = conn.execute(
        "SELECT id FROM accounts WHERE type='checking' AND is_active=1"
    ).fetchall()
    for a in accounts:
        txns = conn.execute(
            """SELECT * FROM transactions WHERE account_id=? AND amount > 500
               AND transaction_date >= ? ORDER BY transaction_date""",
            (a["id"], since)
        ).fetchall()
        for txn in txns:
            desc_lower = (txn["description"] or "").lower()

            if any(k in desc_lower for k in _SKIP_KEYWORDS):
                continue

            is_paycheck = any(k in desc_lower for k in [
                "payroll", "direct dep", "ach deposit", "salary", "wages", "paycheck",
            ] + _AUSTIN_KEYWORDS + _ANUSHKA_KEYWORDS)
            if not is_paycheck and txn["amount"] > 500:
                txn_date = date.fromisoformat(txn["transaction_date"])
                if txn_date.weekday() in (3, 4):
                    is_paycheck = True

            if not is_paycheck:
                continue

            exists = conn.execute(
                "SELECT id FROM paychecks WHERE actual_date=? AND actual_amount=?",
                (txn["transaction_date"], txn["amount"])
            ).fetchone()
            if exists:
                continue

            person = _identify_paycheck_person(desc_lower, float(txn["amount"]))
            conn.execute(
                """INSERT INTO paychecks (person, actual_amount, actual_date, notes)
                   VALUES (?,?,?,?)""",
                (person, txn["amount"], txn["transaction_date"], "auto-detected")
            )
    conn.commit()

def _identify_paycheck_person(desc_lower: str, amount: float) -> str:
    if any(k in desc_lower for k in _AUSTIN_KEYWORDS):
        return "austin"
    if any(k in desc_lower for k in _ANUSHKA_KEYWORDS):
        return "anushka"
    # Amount heuristic based on observed pay ranges
    if 1300 <= amount <= 1650:
        return "anushka"
    if amount >= 1800:
        return "austin"
    return "austin"

def _guess_paycheck_person(conn, txn_date: date, amount: float) -> str:
    recent = conn.execute(
        "SELECT person, actual_amount FROM paychecks ORDER BY actual_date DESC LIMIT 4"
    ).fetchall()
    for r in recent:
        if abs(float(r["actual_amount"] or 0) - amount) < 100:
            return r["person"]
    return "austin"

def start_scheduler():
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        import asyncio

        scheduler = AsyncIOScheduler()

        async def sync_job():
            await run_sync()

        scheduler.add_job(
            sync_job,
            "cron",
            hour=2,
            minute=0,
            id="daily_sync",
            replace_existing=True,
        )

        async def net_worth_snapshot_job():
            conn = get_db()
            accounts = conn.execute("SELECT * FROM accounts WHERE is_active=1").fetchall()
            assets = liabilities = 0.0
            for a in accounts:
                bal = float(a["current_balance"] or 0)
                if a["type"] in ("checking", "savings", "investment") and bal > 0:
                    assets += bal
                elif a["type"] in ("credit", "loan", "personal_loan"):
                    liabilities += abs(bal)
            loans = conn.execute("SELECT current_balance FROM loans").fetchall()
            liabilities += sum(float(l["current_balance"] or 0) for l in loans)
            tmrs_row = conn.execute("SELECT value FROM settings WHERE key='tmrs_account_balance'").fetchone()
            assets += float(tmrs_row["value"]) if tmrs_row else 0.0
            nw = assets - liabilities
            now = datetime.now().isoformat()
            conn.execute(
                "INSERT INTO net_worth_history (recorded_at, assets, liabilities, net_worth) VALUES (?,?,?,?)",
                (now, assets, liabilities, nw)
            )
            conn.commit()
            conn.close()

        scheduler.add_job(
            net_worth_snapshot_job,
            "cron",
            hour=3,
            minute=0,
            id="daily_net_worth",
            replace_existing=True,
        )
        scheduler.start()
    except Exception as e:
        print(f"Scheduler start failed: {e}")
