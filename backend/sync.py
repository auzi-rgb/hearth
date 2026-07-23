import sqlite3
import os
import re
import json
from datetime import datetime, date, timedelta
import httpx

GATEWAY_URL = "https://10.0.0.24/gateway/api"

# Bank-specific phrases that mark a transaction as an internal transfer (excluded
# from spending). Overridable via the transfer_detection_phrases setting so a new
# bank doesn't require a code change.
DEFAULT_TRANSFER_PHRASES = "usaa funds transfer, funds transfer db, funds transfer cr, interest charged, cash advance interest, fid bkg svc"

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

    _phrases_raw = get_setting(conn, "transfer_detection_phrases") or DEFAULT_TRANSFER_PHRASES
    transfer_phrases = [p.strip().lower() for p in _phrases_raw.split(",") if p.strip()]

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
                    any(p in desc_lower for p in transfer_phrases)
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

# Household members are configurable in Settings (settings key: household_members,
# a JSON list). These defaults exist only so a database from before the setting
# existed keeps behaving exactly as it did when the values were hardcoded — they
# are seeded into settings on startup and edited there, never here.
DEFAULT_HOUSEHOLD = [
    {
        "key": "austin", "label": "Austin",
        "payroll_keywords": ["city of georgeto", "city of georgetown", "georgetown payroll"],
        "amount_min": 1800, "amount_max": None,
        "default_frequency": "biweekly",
    },
    {
        "key": "anushka", "label": "Anushka",
        "payroll_keywords": ["staffmark", "staf mark", "staffmark invest"],
        "amount_min": 1300, "amount_max": 1650,
        "default_frequency": "weekly",
    },
]

def get_household(conn) -> list:
    raw = get_setting(conn, "household_members")
    if raw:
        try:
            members = json.loads(raw)
            if isinstance(members, list) and members:
                return members
        except (ValueError, TypeError):
            pass
    return DEFAULT_HOUSEHOLD

_GENERIC_PAYROLL_KEYWORDS = ["payroll", "direct dep", "ach deposit", "salary", "wages", "paycheck"]
_SKIP_KEYWORDS = ["interest", "principal", "transfer", "zelle", "venmo", "refund"]

def _detect_paychecks(conn):
    """Scan checking transactions for likely paycheck deposits and log them."""
    today = date.today()
    since = (today - timedelta(days=60)).isoformat()

    # Deposits below this are never considered paychecks (settings-tunable —
    # matters for side gigs or partial deposits).
    min_amount = float(get_setting(conn, "paycheck_min_amount", "500") or 500)

    members = get_household(conn)
    member_keywords = [k for m in members for k in (m.get("payroll_keywords") or [])]
    # Fallback for deposits with no payroll keyword: only trust the configured
    # payday day-of-week (±1 day for holiday shifts), not a hardcoded Thu/Fri.
    # This is what keeps a random large deposit from becoming a phantom paycheck.
    payday_dows = set()
    for m in members:
        dow = int(get_setting(conn, f"payday_dow_{m['key']}", "3"))
        payday_dows.update({(dow - 1) % 7, dow, (dow + 1) % 7})

    accounts = conn.execute(
        "SELECT id FROM accounts WHERE type='checking' AND is_active=1"
    ).fetchall()
    for a in accounts:
        txns = conn.execute(
            """SELECT * FROM transactions WHERE account_id=? AND amount > ?
               AND transaction_date >= ? ORDER BY transaction_date""",
            (a["id"], min_amount, since)
        ).fetchall()
        for txn in txns:
            desc_lower = (txn["description"] or "").lower()

            if any(k in desc_lower for k in _SKIP_KEYWORDS):
                continue

            is_paycheck = any(
                k in desc_lower for k in _GENERIC_PAYROLL_KEYWORDS + member_keywords
            )
            if not is_paycheck:
                txn_date = date.fromisoformat(txn["transaction_date"])
                if txn_date.weekday() in payday_dows:
                    is_paycheck = True

            if not is_paycheck:
                continue

            exists = conn.execute(
                "SELECT id FROM paychecks WHERE actual_date=? AND actual_amount=?",
                (txn["transaction_date"], txn["amount"])
            ).fetchone()
            if exists:
                continue

            person = _identify_paycheck_person(conn, desc_lower, float(txn["amount"]), members)
            conn.execute(
                """INSERT INTO paychecks (person, actual_amount, actual_date, notes)
                   VALUES (?,?,?,?)""",
                (person, txn["amount"], txn["transaction_date"], "auto-detected")
            )
    conn.commit()

def _identify_paycheck_person(conn, desc_lower: str, amount: float, members: list) -> str:
    for m in members:
        if any(k in desc_lower for k in (m.get("payroll_keywords") or [])):
            return m["key"]
    # Learned amounts: compare against each member's recent actual paychecks in
    # the DB. Pay changes rarely (annual COLA), so recent history is the best
    # amount signal and tracks raises automatically — unlike the static ranges
    # below, which go stale and exist only as a cold-start hint for a member
    # with no paycheck history yet.
    best_key, best_diff = None, None
    for m in members:
        rows = conn.execute(
            "SELECT actual_amount FROM paychecks WHERE person=? AND actual_amount IS NOT NULL "
            "ORDER BY actual_date DESC LIMIT 6",
            (m["key"],)
        ).fetchall()
        for r in rows:
            prev = float(r["actual_amount"] or 0)
            if prev <= 0:
                continue
            diff = abs(amount - prev) / prev
            if best_diff is None or diff < best_diff:
                best_key, best_diff = m["key"], diff
    if best_key is not None and best_diff <= 0.15:
        return best_key
    # Cold-start fallback: static typical ranges from household settings
    for m in members:
        lo, hi = m.get("amount_min"), m.get("amount_max")
        if lo is None and hi is None:
            continue
        if (lo is None or amount >= lo) and (hi is None or amount <= hi):
            return m["key"]
    return members[0]["key"]

# ── Nightly AI coach briefing ─────────────────────────────────────────────────
# The model never computes anything: Python assembles every number, the model
# only turns them into a short coaching paragraph. Runs overnight (3:45am, after
# sync + snapshot) on the household's best model, since latency doesn't matter
# when nobody is waiting.

def _coach_context(conn) -> dict:
    today = date.today()

    def role_account(role, hint):
        val = get_setting(conn, f"{role}_account_id")
        row = None
        if val:
            try:
                row = conn.execute("SELECT * FROM accounts WHERE id=? AND is_active=1", (int(val),)).fetchone()
            except (ValueError, TypeError):
                row = None
        if not row:
            row = conn.execute(
                "SELECT * FROM accounts WHERE is_active=1 AND LOWER(name) LIKE ? LIMIT 1", (f"%{hint}%",)
            ).fetchone()
        return {"name": row["nickname"] or row["name"], "balance": round(float(row["current_balance"] or 0), 2)} if row else None

    # Paid status comes from the same bill_paid_months table the Calendar and
    # Bills checkmarks write to — a bill the household already marked paid must
    # never be coached about as if it were still due.
    paid_lookup = {
        (r["bill_id"], r["month"])
        for r in conn.execute("SELECT bill_id, month FROM bill_paid_months").fetchall()
    }
    bills_next_7 = []
    next_unpaid = None
    for b in conn.execute(
        "SELECT id, name, expected_amount, day_of_month, frequency, day_of_week FROM bills WHERE is_active=1"
    ).fetchall():
        if b["frequency"] == "weekly" and b["day_of_week"] is not None:
            due = today + timedelta(days=(b["day_of_week"] - today.weekday()) % 7)
        elif b["day_of_month"]:
            try:
                due = today.replace(day=b["day_of_month"])
            except ValueError:
                continue
            if due < today:
                nm = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
                try:
                    due = nm.replace(day=b["day_of_month"])
                except ValueError:
                    continue
        else:
            continue
        # Weekly bills recur several times a month under one paid mark, so only
        # monthly bills are filtered by paid status (same rule as the dashboard).
        if b["frequency"] != "weekly" and (b["id"], due.strftime("%Y-%m")) in paid_lookup:
            continue
        entry = {"name": b["name"], "amount": round(float(b["expected_amount"]), 2), "due": due.isoformat()}
        if (due - today).days <= 7:
            bills_next_7.append(entry)
        if next_unpaid is None or due.isoformat() < next_unpaid["due"]:
            next_unpaid = entry

    debt_total = sum(
        abs(float(a["current_balance"] or 0))
        for a in conn.execute(
            "SELECT current_balance FROM accounts WHERE type IN ('credit','loan','personal_loan') AND is_active=1"
        ).fetchall()
    ) + sum(float(l["current_balance"] or 0) for l in conn.execute("SELECT current_balance FROM loans").fetchall())

    spend_q = """SELECT COALESCE(ABS(SUM(amount)), 0) FROM transactions
                 WHERE amount < 0 AND is_transfer=0 AND is_pending=0
                   AND (category IS NULL OR category NOT IN ('bill','debt_payment'))
                   AND transaction_date >= ? AND transaction_date <= ?"""
    mtd = float(conn.execute(spend_q, (today.replace(day=1).isoformat(), today.isoformat())).fetchone()[0])
    last_month_start = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    try:
        last_same_day = last_month_start.replace(day=today.day)
    except ValueError:
        last_same_day = today.replace(day=1) - timedelta(days=1)
    last_mtd = float(conn.execute(spend_q, (last_month_start.isoformat(), last_same_day.isoformat())).fetchone()[0])

    last_xfer = conn.execute(
        "SELECT transfer_date, amount FROM transfers ORDER BY transfer_date DESC, id DESC LIMIT 1"
    ).fetchone()

    return {
        "date": today.isoformat(),
        "bills_account": role_account("bills", "bills"),
        "food_account": role_account("food", "food"),
        "unpaid_bills_due_next_7_days": sorted(bills_next_7, key=lambda x: x["due"]),
        "next_unpaid_bill": next_unpaid,
        "total_debt": round(debt_total, 2),
        "discretionary_spent_month_to_date": round(mtd, 2),
        "discretionary_same_period_last_month": round(last_mtd, 2),
        "last_recorded_transfer": dict(last_xfer) if last_xfer else None,
    }

async def generate_coach_briefing() -> dict:
    conn = get_db()
    enabled = (get_setting(conn, "ai_coach_enabled", "true") or "true").lower() != "false"
    model = get_setting(conn, "ai_coach_model", "qwen2.5:14b") or "qwen2.5:14b"
    if not enabled:
        conn.close()
        return {"status": "disabled"}
    ctx = _coach_context(conn)
    conn.close()
    # Pull the dashboard's day-by-day simulation results (lazy import — main
    # imports sync at startup, so importing main here at job time is safe).
    # These are the month-boundary-aware numbers: the simulation walks dates,
    # not calendar months, so a paycheck landing two days before the 1st is
    # automatically reserved for the next month's first bills.
    try:
        from main import dashboard
        d = await dashboard()
        ctx["safe_to_transfer_today"] = d.get("suggested_transfer")
        ctx["projected_low_point_minus_buffer"] = d.get("safe_today")
        ctx["overdraft_warnings_count"] = len(d.get("overdraft_warnings") or [])
        ctx["next_transfer_date"] = d.get("next_transfer_date")
        ctx["baseline_monthly_income"] = d.get("baseline_income")
        ctx["this_month_income_vs_baseline"] = d.get("income_vs_baseline")
        ctx["true_surplus_above_typical_transfer"] = (d.get("sweep_suggestion") or {}).get("amount")
        ctx["plan_leaves_to_live_on"] = d.get("left_to_live")
        ctx["actual_monthly_living_cost"] = d.get("actual_living_median")
        ctx["living_squeeze"] = d.get("living_squeeze")
        # The fixed outflows that make up plan_leaves_to_live_on — so the coach
        # can diagnose what actually drives a squeeze instead of assuming it's
        # contributions (which are often trivially small next to the gap).
        ctx["monthly_debt_payments"] = d.get("debt_payments_total")
        ctx["monthly_bills_recurring"] = d.get("bills_recurring_total")
        ctx["monthly_contributions"] = d.get("contributions_total")
    except Exception:
        pass

    prompt = f"""You are the household's finance coach. Below are today's precomputed numbers from their finance app. All math is already done — never recalculate, estimate, or invent any number; only use figures exactly as given.

Their system: all income lands in the Bills account, bills and debt payments come off the top, and the surplus is transferred to the Food account for day-to-day living. Their goal: spend less than they earn, pay off debt, then build savings.

Write a short morning briefing — 4 to 6 sentences of plain language, no headers, no bullet points:
- Lead with the single most useful thing to know today.
- Mention upcoming bills only if they are notable.
- Compare month-to-date spending against the same period last month.
- End with one concrete, encouraging next action.

Field meanings (be precise about these):
- unpaid_bills_due_next_7_days: bills due over the COMING WEEK that are NOT yet paid. Bills already paid are excluded — never mention them as due. If this list is empty, say so: it means nothing needs paying this week.
- next_unpaid_bill: the next bill that still needs to be paid, however far out. Use it to say when the next obligation actually arrives.
- discretionary_spent_month_to_date: spent so far THIS month.
- discretionary_same_period_last_month: spent over the SAME NUMBER OF DAYS at the start of LAST MONTH (a month-over-month comparison — never say "last year").
- safe_to_transfer_today: from a day-by-day simulation that already reserves money for every upcoming bill in the next 60 days, INCLUDING bills early next month. When advising what is free to move, spend, or send at debt, use THIS number and only this number. Never reason from "income minus bills for the month" — a paycheck landing near month-end usually funds the next month's first bills, and calling it extra money is a mistake this household has explicitly asked you not to make.
- baseline_monthly_income: what a NORMAL month brings in — the number their budget is built on. this_month_income_vs_baseline above zero means an extra-paycheck month; that extra is handled by the cash-flow simulation, not the budget, so do not suggest changing budget categories because of it.
- true_surplus_above_typical_transfer: if present, this is genuinely free money — the simulation reserved everything first. This is the ONLY number you may ever call surplus.
- living_squeeze: plan_leaves_to_live_on minus actual_monthly_living_cost. NEGATIVE means fixed obligations leave less room than the household typically spends on living, so the gap risks landing on credit cards. Do NOT reflexively blame savings/investment contributions. First DIAGNOSE the driver from the three components — monthly_debt_payments, monthly_bills_recurring, monthly_contributions: whichever is largest relative to baseline_monthly_income is what's actually squeezing the budget. Only suggest trimming contributions if monthly_contributions is large enough to meaningfully close the gap; when it is small next to the squeeze, say so plainly and point at the real driver (usually debt payments and recurring bills against income) instead. Also weigh whether the squeeze is even current: actual_monthly_living_cost is a 3-month median that a few one-off large purchases can inflate, so if discretionary_spent_month_to_date is pacing well below it, frame the squeeze as a trend to watch rather than an emergency. Never suggest cutting food or essentials to protect a contribution.
- monthly_debt_payments / monthly_bills_recurring / monthly_contributions: the fixed monthly outflows subtracted from baseline_monthly_income to get plan_leaves_to_live_on. Use them to name what is actually driving a living_squeeze.

Today's numbers:
{json.dumps(ctx, indent=1)}"""

    _timeout = httpx.Timeout(connect=30, read=900, write=30, pool=30)
    async with httpx.AsyncClient(verify=False, timeout=_timeout) as client:
        r = await client.post(
            f"{GATEWAY_URL}/chat",
            json={"model": model, "messages": [{"role": "user", "content": prompt}],
                  "stream": False, "options": {"temperature": 0.4, "num_ctx": 4096}},
            headers={"X-App-Name": "home-finance"},
        )
        d = r.json()
        content = (d.get("message") or {}).get("content", "") or d.get("response", "")
    # Reasoning models (deepseek-r1) wrap their thinking in <think> tags — strip it
    content = re.sub(r'<think>[\s\S]*?</think>', '', content).strip()
    if not content:
        return {"status": "empty"}
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO ai_briefings (briefing_date, content, model, created_at) VALUES (?,?,?,?)",
        (date.today().isoformat(), content, model, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "content": content, "model": model}

BACKUP_DIR = os.path.join(os.path.dirname(__file__), "backups")
BACKUP_KEEP = 14

def backup_database():
    """Nightly snapshot of finance.db using sqlite's online backup API (safe while
    the app is running, unlike copying the file, which can catch a half-written
    WAL state). Keeps the newest BACKUP_KEEP files and deletes the rest."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest_path = os.path.join(BACKUP_DIR, f"finance-{stamp}.db")
    src = sqlite3.connect(DB_PATH)
    dest = sqlite3.connect(dest_path)
    try:
        src.backup(dest)
    finally:
        dest.close()
        src.close()
    backups = sorted(
        f for f in os.listdir(BACKUP_DIR)
        if f.startswith("finance-") and f.endswith(".db")
    )
    for old in backups[:-BACKUP_KEEP]:
        os.remove(os.path.join(BACKUP_DIR, old))
    return dest_path

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

        async def backup_job():
            try:
                backup_database()
            except Exception as e:
                print(f"Database backup failed: {e}", flush=True)

        scheduler.add_job(
            backup_job,
            "cron",
            hour=3,
            minute=30,
            id="daily_db_backup",
            replace_existing=True,
        )

        async def coach_job():
            try:
                await generate_coach_briefing()
            except Exception as e:
                print(f"Coach briefing failed: {e}", flush=True)

        scheduler.add_job(
            coach_job,
            "cron",
            hour=3,
            minute=45,
            id="daily_coach_briefing",
            replace_existing=True,
        )

        async def monthly_report_job():
            try:
                # Lazy import: main imports sync at startup, so importing main here
                # at job time (long after startup) is safe and avoids the circular import.
                from main import compute_month_review
                conn = get_db()
                month = (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
                data = compute_month_review(conn, month)
                conn.execute(
                    "INSERT OR REPLACE INTO monthly_reports (month, data, created_at) VALUES (?,?,?)",
                    (month, json.dumps(data), datetime.now().isoformat())
                )
                conn.commit()
                conn.close()
            except Exception as e:
                print(f"Monthly report failed: {e}", flush=True)

        scheduler.add_job(
            monthly_report_job,
            "cron",
            day=1,
            hour=4,
            minute=0,
            id="monthly_report",
            replace_existing=True,
        )
        scheduler.start()
    except Exception as e:
        print(f"Scheduler start failed: {e}")
