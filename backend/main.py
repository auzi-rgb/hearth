from fastapi import FastAPI, HTTPException, UploadFile, File, Request, Depends, APIRouter
from fastapi.responses import JSONResponse, StreamingResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import sqlite3
import os
import csv
import io
import math
import statistics
import json
import re
import calendar as cal_mod
from collections import defaultdict
import secrets
import logging
import httpx
from datetime import datetime, date, timedelta
from contextlib import asynccontextmanager
from sync import auto_category, get_household, DEFAULT_HOUSEHOLD

DB_PATH = os.path.join(os.path.dirname(__file__), "finance.db")
logger = logging.getLogger("hearth")

# ── Auth helpers ──────────────────────────────────────────────────────────────

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
_bearer = HTTPBearer(auto_error=False)

TOKEN_EXPIRE_HOURS = 8

def _get_jwt_secret() -> str:
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key='jwt_secret'").fetchone()
    conn.close()
    return row["value"] if row else ""

def _make_token(username: str) -> str:
    exp = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": username, "exp": exp}, _get_jwt_secret(), algorithm="HS256")

def get_current_user(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, _get_jwt_secret(), algorithms=["HS256"])
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

# ── DB ────────────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            institution TEXT,
            simplefin_id TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            description TEXT,
            category TEXT,
            transaction_date TEXT NOT NULL,
            posted_date TEXT,
            is_pending INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (account_id) REFERENCES accounts(id)
        );
        CREATE TABLE IF NOT EXISTS bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            expected_amount REAL NOT NULL,
            confidence TEXT NOT NULL DEFAULT 'fixed',
            day_of_month INTEGER,
            account_id INTEGER,
            is_active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS loans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            original_balance REAL,
            current_balance REAL,
            interest_rate REAL,
            monthly_payment REAL,
            payments_made INTEGER DEFAULT 0,
            total_payments INTEGER,
            start_date TEXT
        );
        CREATE TABLE IF NOT EXISTS paychecks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person TEXT NOT NULL,
            expected_amount REAL,
            actual_amount REAL,
            expected_date TEXT,
            actual_date TEXT,
            is_third_friday_period INTEGER DEFAULT 0,
            notes TEXT
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            synced_at TEXT NOT NULL,
            accounts_updated INTEGER DEFAULT 0,
            transactions_added INTEGER DEFAULT 0,
            status TEXT NOT NULL,
            error_message TEXT
        );
        CREATE TABLE IF NOT EXISTS net_worth_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recorded_at TEXT NOT NULL,
            assets REAL NOT NULL,
            liabilities REAL NOT NULL,
            net_worth REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            hashed_password TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS merchant_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern TEXT NOT NULL UNIQUE,
            category TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS budgets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL UNIQUE,
            monthly_limit REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ignored_bill_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS categories (
            name TEXT PRIMARY KEY,
            parent TEXT,
            is_base INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (parent) REFERENCES categories(name)
        );
    """)
    conn.commit()

    # Migrations — idempotent column additions
    for col, typedef in [("current_balance", "REAL"), ("balance_date", "TEXT"), ("interest_rate", "REAL"), ("minimum_payment", "REAL")]:
        try:
            conn.execute(f"ALTER TABLE accounts ADD COLUMN {col} {typedef}")
            conn.commit()
        except Exception:
            pass
    try:
        conn.execute("ALTER TABLE bills ADD COLUMN bill_type TEXT")
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE bills ADD COLUMN payment_type TEXT")
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE bills ADD COLUMN from_debt_budget INTEGER DEFAULT 0")
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE bills ADD COLUMN linked_loan_id INTEGER")
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE bills ADD COLUMN notes TEXT")
        conn.commit()
    except Exception:
        pass
    conn.execute("UPDATE bills SET payment_type = 'Recurring' WHERE payment_type IS NULL")
    conn.commit()
    try:
        conn.execute("ALTER TABLE bills ADD COLUMN linked_account_id INTEGER")
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE bills ADD COLUMN frequency TEXT")
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE bills ADD COLUMN day_of_week INTEGER")
        conn.commit()
    except Exception:
        pass
    # These two columns were originally added by hand directly on the production
    # database and never made it into code — a fresh database crashed on any
    # endpoint that read them. Now migrated like every other column.
    try:
        conn.execute("ALTER TABLE accounts ADD COLUMN nickname TEXT")
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE bills ADD COLUMN display_name TEXT")
        conn.commit()
    except Exception:
        pass
    try:
        # Explicit merchant text linking a bill to its bank transactions — set by
        # the Spending page's "add as bill" flow. When present, it replaces the
        # fragile name[:8] LIKE matching for history/creep/rolling stats.
        conn.execute("ALTER TABLE bills ADD COLUMN merchant_pattern TEXT")
        conn.commit()
    except Exception:
        pass
    try:
        # Autopay: 1 = paid automatically from the Bills account, needs no human
        # action (no paid-checkbox, no "looks paid" nag, muted in the calendar).
        # Defaults to 1 because the household runs bills on autopay — the few
        # manual ones get un-flagged. Only manual bills surface as action items.
        conn.execute("ALTER TABLE bills ADD COLUMN autopay INTEGER NOT NULL DEFAULT 1")
        conn.commit()
    except Exception:
        pass
    conn.execute("UPDATE bills SET frequency = 'monthly' WHERE frequency IS NULL")
    conn.commit()
    # One-time reclassification: savings/investment transfers that were entered
    # as Recurring bills become Contributions — chosen allocations, not hardline
    # obligations. New ones get the type picked in the bill modal; this only
    # catches the ones created before the type existed. Idempotent.
    conn.execute("""
        UPDATE bills SET payment_type='Contribution'
        WHERE payment_type='Recurring' AND (
            LOWER(name) LIKE '%roth%' OR LOWER(name) LIKE '%hysa%'
            OR LOWER(name) LIKE '%529%' OR LOWER(name) LIKE '%high-yield%'
            OR LOWER(name) LIKE '%high yield%'
        )
    """)
    conn.commit()
    try:
        conn.execute("ALTER TABLE transactions ADD COLUMN is_transfer INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    except Exception:
        pass
    try:
        # 1 = category came from an explicit merchant rule or a manual edit (confirmed).
        # 0 = category is the raw keyword-guess fallback, never reviewed by a human.
        # Existing history backfills to confirmed — this is a forward-looking flag, not
        # a retroactive audit of years of transactions the household already trusts.
        conn.execute("ALTER TABLE transactions ADD COLUMN category_confirmed INTEGER NOT NULL DEFAULT 1")
        conn.commit()
    except Exception:
        pass
    # Mark all existing internal transfer transactions so they are excluded from spending
    conn.execute("""
        UPDATE transactions SET is_transfer=1
        WHERE is_transfer=0
          AND (
            LOWER(description) LIKE '%usaa funds transfer%'
            OR LOWER(description) LIKE '%funds transfer db%'
            OR LOWER(description) LIKE '%funds transfer cr%'
          )
    """)
    conn.commit()

    # Per-month paid tracking for bill calendar toggles
    conn.execute("""CREATE TABLE IF NOT EXISTS bill_paid_months (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_id  INTEGER NOT NULL,
        month    TEXT    NOT NULL,
        paid_date TEXT,
        UNIQUE(bill_id, month)
    )""")
    conn.commit()

    # Bills → Food transfers: the app suggests an amount; recording what was
    # actually moved is what turns the suggestion into a trackable habit.
    conn.execute("""CREATE TABLE IF NOT EXISTS transfers (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        transfer_date    TEXT NOT NULL,
        amount           REAL NOT NULL,
        suggested_amount REAL,
        notes            TEXT,
        created_at       TEXT NOT NULL
    )""")
    # Month in Review report cards — data is the computed JSON snapshot
    conn.execute("""CREATE TABLE IF NOT EXISTS monthly_reports (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        month      TEXT NOT NULL UNIQUE,
        data       TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""")
    # Nightly AI coach briefings — generated overnight, read instantly by the UI
    conn.execute("""CREATE TABLE IF NOT EXISTS ai_briefings (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        briefing_date TEXT NOT NULL UNIQUE,
        content       TEXT NOT NULL,
        model         TEXT,
        created_at    TEXT NOT NULL
    )""")
    conn.commit()

    # AI long-term memory tables
    conn.execute("""CREATE TABLE IF NOT EXISTS ai_facts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        fact             TEXT NOT NULL,
        category         TEXT NOT NULL DEFAULT 'general',
        created_at       TEXT NOT NULL,
        last_confirmed_at TEXT NOT NULL,
        source_session_id INTEGER
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS ai_sessions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at   TEXT NOT NULL,
        ended_at     TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        summary      TEXT,
        transcript   TEXT
    )""")
    conn.commit()

    conn.close()

def _bootstrap_auth():
    """Ensure JWT secret and default admin user exist. Logs temp password once."""
    conn = get_db()
    # JWT secret — generate once, survive restarts
    if not conn.execute("SELECT value FROM settings WHERE key='jwt_secret'").fetchone():
        secret = secrets.token_hex(32)
        conn.execute("INSERT INTO settings (key, value) VALUES ('jwt_secret', ?)", (secret,))
        conn.commit()

    # Default admin user
    if not conn.execute("SELECT id FROM users LIMIT 1").fetchone():
        temp_pw = secrets.token_urlsafe(12)
        hashed = pwd_context.hash(temp_pw)
        now = datetime.now().isoformat()
        conn.execute(
            "INSERT INTO users (username, hashed_password, created_at) VALUES (?, ?, ?)",
            ("admin", hashed, now)
        )
        conn.commit()
        # Print once to systemd journal
        print(f"[home-finance] TEMPORARY ADMIN PASSWORD: {temp_pw}", flush=True)
        logger.warning("Default admin user created — temporary password printed above. Change it after first login.")

    # Seed household config so it's editable in Settings from day one. The defaults
    # reproduce the behavior from when these values were hardcoded in sync.py.
    if not conn.execute("SELECT value FROM settings WHERE key='household_members'").fetchone():
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('household_members', ?)",
            (json.dumps(DEFAULT_HOUSEHOLD),)
        )
        conn.commit()

    conn.close()

# Primary categories (parent=None) and their secondaries. Base primaries
# (food/gas/household/other) can't be deleted; everything else can.
CATEGORY_TAXONOMY = {
    "food":           {"is_base": True,  "secondaries": ["heb", "fast_food", "coffee", "restaurants", "uber"]},
    "gas":            {"is_base": True,  "secondaries": []},
    "household":      {"is_base": True,  "secondaries": ["home_improvement", "health_personal_care", "office_subscriptions", "pets"]},
    "other":          {"is_base": True,  "secondaries": []},
    "bill":           {"is_base": False, "secondaries": []},
    "debt_payment":   {"is_base": False, "secondaries": []},
    "shopping":       {"is_base": False, "secondaries": ["clothing", "sporting_goods", "gifts"]},
    "family_purchase": {"is_base": False, "secondaries": []},
    "entertainment":  {"is_base": False, "secondaries": ["movies", "books_magazines", "bars"]},
    "transportation": {"is_base": False, "secondaries": ["auto_repairs"]},
}

# One-time remap of raw/legacy category strings (mostly inherited from an old
# CSV import that used the bank's own category labels instead of running
# through the app's categorizer) onto the real taxonomy above. Runs exactly
# once, guarded by the categories table being empty.
_ORPHAN_CATEGORY_REMAP = {
    "groceries":              "heb",
    "fast food":              "fast_food",
    "coffee shops":           "coffee",
    "food & dining":          "restaurants",
    "sporting goods":         "sporting_goods",
    "gifts & donations":      "gifts",
    "movies & dvds":          "movies",
    "books":                  "books_magazines",
    "newspapers & magazines": "books_magazines",
    "alcohol & bars":         "bars",
    "home improvement":       "home_improvement",
    "health & fitness":       "health_personal_care",
    "personal care":          "health_personal_care",
    "pharmacy":               "health_personal_care",
    "office supplies":        "office_subscriptions",
    "printing":                "office_subscriptions",
    "shipping":                "office_subscriptions",
    "domain names":            "office_subscriptions",
    "hosting":                  "office_subscriptions",
    "auto & transport":        "auto_repairs",
    "service & parts":         "auto_repairs",
    "credit card payment":     "debt_payment",
    "fees & charges":          "other",
}

def _rename_budget_category(conn, old, new):
    old_row = conn.execute("SELECT 1 FROM budgets WHERE category=?", (old,)).fetchone()
    if not old_row:
        return
    if conn.execute("SELECT 1 FROM budgets WHERE category=?", (new,)).fetchone():
        # Target already has its own limit set — keep that one, drop the legacy row.
        conn.execute("DELETE FROM budgets WHERE category=?", (old,))
    else:
        conn.execute("UPDATE budgets SET category=? WHERE category=?", (new, old))

def _seed_categories_and_migrate():
    """Runs exactly once — guarded by the categories table being empty. Seeds the
    primary/secondary taxonomy and remaps historical orphan category strings onto it."""
    conn = get_db()
    if conn.execute("SELECT 1 FROM categories LIMIT 1").fetchone():
        conn.close()
        return

    for primary, info in CATEGORY_TAXONOMY.items():
        conn.execute(
            "INSERT OR IGNORE INTO categories (name, parent, is_base) VALUES (?, NULL, ?)",
            (primary, 1 if info["is_base"] else 0)
        )
        for secondary in info["secondaries"]:
            conn.execute(
                "INSERT OR IGNORE INTO categories (name, parent, is_base) VALUES (?, ?, 0)",
                (secondary, primary)
            )

    for old_cat, new_cat in _ORPHAN_CATEGORY_REMAP.items():
        conn.execute("UPDATE transactions SET category=? WHERE category=?", (new_cat, old_cat))

    # Apple and Turbotenant landed in the bank's raw "electronics & software"
    # label — Apple is a small recurring subscription and Turbotenant is rent,
    # neither is shopping. Both become bill, matching how other recurring
    # services (Netflix, Hulu, Audible) are already tracked.
    conn.execute("UPDATE transactions SET category='bill' WHERE category='electronics & software' AND LOWER(description) LIKE '%apple%'")
    conn.execute("UPDATE transactions SET category='bill' WHERE category='electronics & software' AND LOWER(description) LIKE '%turbotenant%'")
    # The one transaction the bank left as "category pending" was Chuy's, a restaurant.
    conn.execute("UPDATE transactions SET category='restaurants' WHERE category='category pending' AND LOWER(description) LIKE '%chuy%'")
    # Variable-amount Apple.com/Bill charges (App Store purchases, not the fixed
    # recurring subscription) — these never carried an orphan category, they were
    # already in "other" via the normal keyword fallback.
    conn.execute("UPDATE transactions SET category='shopping' WHERE category='other' AND LOWER(description) LIKE '%apple%'")

    # Future Turbotenant charges won't all happen to say "RENT" in the description
    # the way this one did — add an explicit rule so they're never raw-category again.
    conn.execute(
        "INSERT OR IGNORE INTO merchant_rules (pattern, category, created_at) VALUES ('turbotenant', 'bill', ?)",
        (datetime.now().isoformat(),)
    )

    # Legacy budgets table rows from before custom categories existed.
    _rename_budget_category(conn, "fuel", "gas")
    _rename_budget_category(conn, "misc", "other")
    _rename_budget_category(conn, "groceries", "food")
    conn.execute("DELETE FROM budgets WHERE category='dining'")

    conn.commit()
    conn.close()

# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _bootstrap_auth()
    _seed_categories_and_migrate()
    from sync import start_scheduler
    start_scheduler()
    yield

# ── App + rate limiter ────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Home Finance API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Protected router — every route on it requires a valid JWT
router = APIRouter(dependencies=[Depends(get_current_user)])

# ── Helpers ───────────────────────────────────────────────────────────────────

def fmt_money(v):
    return round(float(v), 2) if v is not None else 0.0

def _normalize_merchant(description: str) -> str:
    if not description:
        return ""
    d = description.lower()
    d = re.sub(r'^(pos |ach |debit |checkcard |purchase |pymt |payment )', '', d)
    d = re.sub(r'[^\w\s-]', ' ', d)
    d = re.sub(r'\b\d{4,}\b', '', d)
    words = [w for w in d.split() if len(w) >= 3 and not w.isdigit()]
    return words[0][:20] if words else ""

def _bill_match_term(bill) -> str:
    """The LIKE term connecting a bill to its transactions: the explicit
    merchant_pattern when the household linked one, else the legacy name prefix."""
    return bill["merchant_pattern"] or bill["name"][:8]

def _bill_pattern_from_desc(description: str) -> str:
    """Pick the most distinctive merchant token from a bank description —
    'RO HEALTH GETROMAN.COM NY' → 'getroman', not the generic 'health'.
    Longest word wins because bank noise words (POS, ACH, city names) are short."""
    d = re.sub(r'[^\w\s]', ' ', (description or "").lower())
    d = re.sub(r'\b\d{3,}\b', '', d)
    words = [w for w in d.split() if len(w) >= 4 and not w.isdigit()]
    if words:
        return max(words, key=len)[:24]
    fallback = _normalize_merchant(description)
    return fallback or (description or "").strip().lower()[:20]

def _clean_bill_name(description: str) -> str:
    d = description.strip()
    d = re.sub(r'^(ach\s+|pos\s+|checkcard\s+|debit\s+)', '', d, flags=re.IGNORECASE)
    d = re.sub(r'\s+\d{4,}.*$', '', d)
    return d.title()[:40]


def auto_category_with_rules(conn, description: str) -> tuple:
    """Returns (category, confirmed). confirmed=True only when an explicit merchant
    rule matched. Otherwise category is the raw keyword guess, or None if nothing
    matched at all — None is never coerced into a guess."""
    cat = auto_category(description)
    if description:
        d = description.lower()
        rules = conn.execute("SELECT pattern, category FROM merchant_rules ORDER BY length(pattern) DESC").fetchall()
        for rule in rules:
            if rule["pattern"] and rule["pattern"] in d:
                return rule["category"], True
    return cat, False

def _simulate_payoff_strategy(debts_input: list, extra_monthly: float, strategy: str, cards_first: bool = True) -> dict:
    debts = [
        {"name": d["name"], "balance": float(d["balance"]), "rate": float(d.get("rate_annual") or 0),
         "min_payment": float(d.get("min_payment") or 0), "source": d.get("source", "")}
        for d in debts_input if float(d.get("balance") or 0) > 0
    ]
    if not debts:
        return {"months": 0, "total_interest": 0, "payoff_order": [], "debt_free_date": None,
                "recommended_payments": [], "fully_paid_off": True, "timeline": []}
    is_card = lambda i: debts[i]["source"] == "credit_card"
    card_bucket = (lambda i: 0 if is_card(i) else 1) if cards_first else (lambda i: 0)
    if strategy == "snowball":
        priority = sorted(range(len(debts)), key=lambda i: (card_bucket(i), debts[i]["balance"]))
    else:
        priority = sorted(range(len(debts)), key=lambda i: (card_bucket(i), -debts[i]["rate"]))
    # List every debt in priority order up front — don't rely on the simulation to
    # finish a debt before it appears. A debt whose minimum payment doesn't cover its
    # own interest will never finish within the simulation window and would otherwise
    # silently vanish from the list instead of showing as stuck.
    payoff_order = [debts[i]["name"] for i in priority]

    # Fixed total monthly debt budget — every dollar a paid-off debt used to take stays
    # in the budget and rolls onto the next priority debt instead of just disappearing.
    # This is the actual "snowball" effect: your total payment never shrinks, it just
    # gets redirected, so later debts get paid down faster than a naive simulation shows.
    total_budget = sum(d["min_payment"] for d in debts) + extra_monthly

    month = 0
    total_interest = 0.0
    paid_off = set()
    MAX = 600
    timeline = []
    card_indices = {i for i in range(len(debts)) if is_card(i)}
    while len(paid_off) < len(debts) and month < MAX:
        month += 1
        paid_off_before = set(paid_off)
        for i, d in enumerate(debts):
            if i in paid_off:
                continue
            interest = d["balance"] * (d["rate"] / 100 / 12)
            total_interest += interest
            d["balance"] += interest
        minimums_paid_active = 0.0
        for i, d in enumerate(debts):
            if i in paid_off:
                continue
            payment = min(d["min_payment"], d["balance"])
            minimums_paid_active += payment
            d["balance"] -= payment
            if d["balance"] <= 0.01:
                d["balance"] = 0
                paid_off.add(i)
        available = max(0.0, total_budget - minimums_paid_active)
        for i in priority:
            if i in paid_off or available <= 0:
                continue
            payment = min(available, debts[i]["balance"])
            debts[i]["balance"] -= payment
            available -= payment
            if debts[i]["balance"] <= 0.01:
                debts[i]["balance"] = 0
                paid_off.add(i)
        newly_paid_off = paid_off - paid_off_before
        # Clean, smoothed "cash freed up" — computed from who's actually finished as of
        # the END of this month, not who's left mid-payment. This makes the chart step
        # cleanly to the full freed amount the moment a debt clears, instead of showing
        # a smaller partial-month value first. It only ever goes up.
        extra_pool = round(total_budget - sum(d["min_payment"] for i, d in enumerate(debts) if i not in paid_off), 2)
        cards_just_cleared = bool(card_indices) and card_indices.issubset(paid_off) and not card_indices.issubset(paid_off_before)
        if month <= 120:
            timeline.append({
                "month": month,
                "balances": {debts[i]["name"]: round(debts[i]["balance"], 2) for i in range(len(debts))},
                "extra_pool": extra_pool,
                "newly_paid_off": [debts[i]["name"] for i in newly_paid_off],
                "cards_just_cleared": cards_just_cleared,
            })
    # Recommended monthly payments: focus debt (top of priority) gets min + extra; others get min
    focus_idx = priority[0] if priority else None
    recommended = []
    for i, d in enumerate(debts):
        extra = extra_monthly if i == focus_idx and d["min_payment"] > 0 else 0
        recommended.append({
            "name": d["name"],
            "recommended_payment": round(d["min_payment"] + extra, 2),
            "is_focus": i == focus_idx,
        })
    fully_paid_off = len(paid_off) == len(debts)
    return {
        "months": month,
        "total_interest": round(total_interest, 2),
        "payoff_order": payoff_order,
        "debt_free_date": (date.today() + timedelta(days=30 * month)).isoformat() if fully_paid_off else None,
        "recommended_payments": recommended,
        "fully_paid_off": fully_paid_off,
        "timeline": timeline,
    }

def derive_bill_day(conn, *, loan_id=None, account_id=None, merchant_pattern=None):
    """Work out which day of the month a bill falls on, from data the app already
    holds, instead of storing NULL and silently dropping the bill from the cash-flow
    projection. In order: the linked loan's start_date (a loan recurs on the day it
    started), then the most common day among matching transactions. Returns None only
    when there is genuinely nothing to go on — and callers surface that rather than
    swallowing it."""
    if loan_id:
        row = conn.execute("SELECT start_date FROM loans WHERE id=?", (loan_id,)).fetchone()
        if row and row["start_date"]:
            try:
                return min(28, date.fromisoformat(row["start_date"]).day)
            except (ValueError, TypeError):
                pass
    if merchant_pattern or account_id:
        if merchant_pattern:
            rows = conn.execute(
                """SELECT transaction_date FROM transactions
                   WHERE amount < 0 AND LOWER(description) LIKE ?
                   ORDER BY transaction_date DESC LIMIT 12""",
                (f"%{str(merchant_pattern).lower()}%",)
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT transaction_date FROM transactions
                   WHERE amount < 0 AND account_id=?
                   ORDER BY transaction_date DESC LIMIT 12""",
                (account_id,)
            ).fetchall()
        days = []
        for r in rows:
            try:
                days.append(min(28, date.fromisoformat(r["transaction_date"]).day))
            except (ValueError, TypeError):
                pass
        if days:
            # mode, not mean: ACH drifts off a weekend by a day or two, and the
            # most-repeated day is the real schedule while an average is a date
            # the bill never actually falls on.
            return max(set(days), key=days.count)
    return None

def next_bill_date(day_of_month: int, from_date: date = None) -> date:
    if from_date is None:
        from_date = date.today()
    try:
        candidate = from_date.replace(day=day_of_month)
    except ValueError:
        last_day = cal_mod.monthrange(from_date.year, from_date.month)[1]
        candidate = from_date.replace(day=min(day_of_month, last_day))
    if candidate < from_date:
        m = from_date.month + 1
        y = from_date.year
        if m > 12:
            m = 1
            y += 1
        last_day = cal_mod.monthrange(y, m)[1]
        candidate = date(y, m, min(day_of_month, last_day))
    return candidate

def next_weekly_date(day_of_week: int, from_date: date = None) -> date:
    if from_date is None:
        from_date = date.today()
    days_ahead = (day_of_week - from_date.weekday()) % 7
    return from_date + timedelta(days=days_ahead)

def weekly_occurrences(day_of_week: int, start: date, end: date) -> list:
    d = next_weekly_date(day_of_week, start)
    out = []
    while d <= end:
        out.append(d)
        d += timedelta(days=7)
    return out

def detect_next_payday(conn, person: str) -> dict:
    # Payday is anchored to a configured day-of-week + frequency (settings:
    # payday_dow_{person} 0=Mon..6=Sun, payday_frequency_{person} weekly/biweekly),
    # not just "last actual date + fixed interval." That naive approach permanently
    # drifts off-schedule the moment a single paycheck lands a day early/late for a
    # bank holiday — every future projection inherits the shift forever. Anchoring to
    # day-of-week and treating an off-day actual as "this cycle, just shifted" (rather
    # than as the new schedule) keeps projections on the real recurring pattern.
    today = date.today()
    dow = int(get_setting(conn, f"payday_dow_{person}", "3"))  # default Thursday
    member = next((m for m in get_household(conn) if m["key"] == person), None)
    default_freq = (member or {}).get("default_frequency") or "biweekly"
    frequency = get_setting(conn, f"payday_frequency_{person}", default_freq)
    interval_weeks = 2 if frequency == "biweekly" else 1
    interval = timedelta(weeks=interval_weeks)

    recent_rows = conn.execute(
        "SELECT actual_date FROM paychecks WHERE person=? AND actual_date IS NOT NULL ORDER BY actual_date DESC LIMIT 12",
        (person,)
    ).fetchall()
    recent_dates = [date.fromisoformat(r["actual_date"]) for r in recent_rows]

    anchor_str = get_setting(conn, f"payday_anchor_{person}", None)
    if anchor_str:
        cycle = date.fromisoformat(anchor_str)
    else:
        # Most recent historical paycheck that actually landed on the configured
        # day-of-week — used as the on-cycle reference point so a one-off holiday
        # shift can't desync which week is "on-cycle."
        on_dow = next((d for d in recent_dates if d.weekday() == dow), None)
        cycle = on_dow if on_dow else today
    cycle += timedelta(days=(dow - cycle.weekday()) % 7)  # snap exactly onto dow

    # Advance one cycle at a time. A cycle counts as "already paid" if any actual
    # payment landed within 3 days of it (covers a holiday-shifted actual a day or
    # two early/late) — move on to the next cycle instead of reprojecting this one.
    while cycle < today or any(abs((cycle - d).days) <= 3 for d in recent_dates):
        cycle += interval
    next_d = cycle

    # Use actual_amount as fallback since auto-detected paychecks never have expected_amount set
    amt_rows = conn.execute(
        "SELECT COALESCE(expected_amount, actual_amount) as amt FROM paychecks WHERE person=? AND (expected_amount IS NOT NULL OR actual_amount IS NOT NULL) ORDER BY actual_date DESC LIMIT 5",
        (person,)
    ).fetchall()
    amounts = [float(r["amt"]) for r in amt_rows if r["amt"]]
    # Average the last few to smooth anomalies (e.g. loan payment false-positives)
    if len(amounts) > 1:
        median_amt = sorted(amounts)[len(amounts) // 2]
        amounts = [a for a in amounts if abs(a - median_amt) / median_amt < 0.4]
    amount = round(sum(amounts) / len(amounts), 2) if amounts else None
    return {
        "person": person,
        "next_date": next_d.isoformat(),
        "expected_amount": amount,
        "frequency": frequency,
        "interval_weeks": interval_weeks,
        "day_of_week": dow,
    }

def compute_month_income(conn) -> dict:
    """The current month's income, per member: paychecks already received plus
    projected remaining paydays. Single source of truth for the dashboard's
    monthly_income AND the Accounts income card — if they ever disagree, one of
    them stopped calling this."""
    today = date.today()
    month_start = today.replace(day=1)
    month_end = date(today.year, today.month, cal_mod.monthrange(today.year, today.month)[1])
    out_members = []
    received_total = 0.0
    projected_total = 0.0
    for m in get_household(conn):
        rows = conn.execute(
            "SELECT actual_date, actual_amount FROM paychecks WHERE person=? AND actual_amount IS NOT NULL AND actual_date >= ? AND actual_date <= ? ORDER BY actual_date",
            (m["key"], month_start.isoformat(), month_end.isoformat())
        ).fetchall()
        received = [{"date": r["actual_date"], "amount": fmt_money(r["actual_amount"])} for r in rows]
        r_total = sum(p["amount"] for p in received)
        info = detect_next_payday(conn, m["key"])
        projected = []
        if info.get("next_date") and info.get("expected_amount"):
            d = date.fromisoformat(info["next_date"])
            amt = float(info["expected_amount"])
            while d <= month_end:
                if d >= today:
                    projected.append({"date": d.isoformat(), "amount": fmt_money(amt)})
                d += timedelta(weeks=info.get("interval_weeks", 2))
        p_total = sum(p["amount"] for p in projected)
        out_members.append({
            "key": m["key"],
            "label": m.get("label") or m["key"].capitalize(),
            "frequency": info.get("frequency"),
            "received": received,
            "projected": projected,
            "expected_count": len(received) + len(projected),
            # A weekly earner usually sees 4 checks a month, biweekly 2 — more
            # than that is an "extra paycheck month" worth calling out in the UI.
            "usual_count": 4 if info.get("frequency") == "weekly" else 2,
            "total": fmt_money(r_total + p_total),
        })
        received_total += r_total
        projected_total += p_total
    return {
        "month": today.strftime("%Y-%m"),
        "members": out_members,
        "received_total": fmt_money(received_total),
        "projected_total": fmt_money(projected_total),
        "monthly_income": fmt_money(received_total + projected_total),
    }

def compute_baseline_income(conn) -> dict:
    """A NORMAL month's income — the planning number the budget is built on.
    usual paycheck count × median of recent actual checks, per member: stable
    across extra-paycheck months, self-updating after raises, and robust to
    outlier deposits (a median ignores a stray misattributed $800). The
    budget_baseline_income setting overrides the computation when set > 0.
    Calendar-month actual income (compute_month_income) is deliberately NOT
    used for budgeting — a paycheck landing near month-end mostly funds the
    next month's first bills, so the calendar total overstates what a month
    really has to work with."""
    override = get_setting(conn, "budget_baseline_income")
    try:
        if override and float(override) > 0:
            return {"baseline_income": fmt_money(float(override)), "baseline_source": "manual", "baseline_members": []}
    except (ValueError, TypeError):
        pass
    total = 0.0
    members_out = []
    for m in get_household(conn):
        freq = get_setting(conn, f"payday_frequency_{m['key']}", m.get("default_frequency") or "biweekly")
        usual = 4 if freq == "weekly" else 2
        # 4-check window: recent enough that a raise becomes the new baseline
        # within a couple of cycles (an 8-check window kept old pay rates in
        # the median for months), still wide enough that one odd check can't
        # move the median.
        amts = [
            float(r["actual_amount"]) for r in conn.execute(
                "SELECT actual_amount FROM paychecks WHERE person=? AND actual_amount IS NOT NULL ORDER BY actual_date DESC LIMIT 4",
                (m["key"],)
            ).fetchall()
        ]
        med = statistics.median(amts) if amts else 0.0
        members_out.append({
            "key": m["key"],
            "label": m.get("label") or m["key"].capitalize(),
            "usual_count": usual,
            "median_check": fmt_money(med),
            "baseline": fmt_money(med * usual),
        })
        total += med * usual
    return {"baseline_income": fmt_money(total), "baseline_source": "computed", "baseline_members": members_out}

def get_account_balance(conn, account_id: int) -> float:
    # Prefer the balance reported directly by SimpleFin — transaction sum is unreliable
    # because SimpleFin only returns a rolling window of transactions, not full history.
    acct = conn.execute(
        "SELECT current_balance FROM accounts WHERE id=?", (account_id,)
    ).fetchone()
    if acct and acct["current_balance"] is not None:
        return fmt_money(acct["current_balance"])
    # Fallback: sum transactions (works for CSV-imported accounts with full history)
    row = conn.execute(
        "SELECT SUM(amount) as bal FROM transactions WHERE account_id=? AND is_pending=0",
        (account_id,)
    ).fetchone()
    return fmt_money(row["bal"])

def _setting_float(conn, key: str, default: float) -> float:
    """A numeric tuning value read from `settings`, never baked into the code.
    Build rule 1: anything that changes behaviour has to be reachable and visible,
    not a literal buried mid-function."""
    try:
        v = get_setting(conn, key)
        return float(v) if v is not None and str(v).strip() != "" else float(default)
    except (ValueError, TypeError):
        return float(default)

def get_available_balance(conn, account_id: int) -> float:
    """The bank's AVAILABLE balance: posted, minus pending debits — never plus
    pending credits. Banks hold an incoming deposit until it posts, so a pending
    paycheck is not yet spendable, while a pending charge has already reduced what
    you can spend. Counting pending credits here showed more money than the account
    held and read as a double-counted paycheck. Money that is merely *incoming*
    belongs in the forward projection instead (cash_flow_projection adds pending
    credits as future events), not in today's balance.

    Only pendings inside `pending_window_days` count. sync clears the flag when the
    settled version arrives, but an orphaned pending row (the bank drops it, a
    description drifts past recognition) would otherwise skew this indefinitely."""
    bal = get_account_balance(conn, account_id)
    window = _setting_float(conn, "pending_window_days", 14)
    cutoff = (date.today() - timedelta(days=window)).isoformat()
    row = conn.execute(
        """SELECT COALESCE(SUM(amount), 0) AS s FROM transactions
           WHERE account_id=? AND is_pending=1 AND amount < 0 AND transaction_date >= ?""",
        (account_id, cutoff)
    ).fetchone()
    return fmt_money(bal + float(row["s"] or 0))

def _deposit_already_landed(conn, account_id: int, on_date, amount: float) -> bool:
    """Is a deposit of roughly `amount` already on the books for `on_date`?
    Posted or pending both count. A pending flag does not mean the balance lacks
    the money — payroll posts overnight, so the reported balance picks it up while
    the bank's feed still calls the transaction pending for another day. Once a
    deposit appears at all, treat it as accounted for and do not project it again."""
    if not account_id:
        return False
    ratio = _setting_float(conn, "paycheck_match_ratio", 0.5)
    return conn.execute(
        """SELECT 1 FROM transactions WHERE account_id=? AND transaction_date=?
           AND amount > 0 AND amount >= ? LIMIT 1""",
        (account_id, on_date.isoformat(), amount * ratio)
    ).fetchone() is not None

def get_setting(conn, key: str, default=None):
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default

def cash_flow_projection(conn, end_date, start_balance=None) -> list:
    """THE day-by-day projection of the Bills account, from today through
    end_date: every unpaid bill occurrence (all monthly occurrences in the
    window, not just the next one; weekly bills every week) and every projected
    paycheck, in date order with a running balance. Single source for the
    Dashboard's safe-to-transfer AND the Calendar's balance overlay — one
    simulation, so months carry forward instead of each view restarting from
    today's balance and disagreeing about the future."""
    today = date.today()
    bills_acct = find_role_account(conn, "bills", "bills")
    bills_acct_id = bills_acct["id"] if bills_acct else None
    if start_balance is None:
        start_balance = get_available_balance(conn, bills_acct_id) if bills_acct_id else 0.0
    paid_lookup = {
        (r["bill_id"], r["month"])
        for r in conn.execute("SELECT bill_id, month FROM bill_paid_months").fetchall()
    }
    events = []
    for b in conn.execute("SELECT * FROM bills WHERE is_active=1").fetchall():
        amt = float(b["expected_amount"])
        if b["frequency"] == "weekly" and b["day_of_week"] is not None:
            for occ in weekly_occurrences(b["day_of_week"], today, end_date):
                events.append((occ, -amt, b["name"], "bill"))
        elif b["day_of_month"]:
            y, m = today.year, today.month
            while date(y, m, 1) <= end_date:
                last_day = cal_mod.monthrange(y, m)[1]
                occ = date(y, m, min(b["day_of_month"], last_day))
                if today <= occ <= end_date and (b["id"], occ.strftime("%Y-%m")) not in paid_lookup:
                    events.append((occ, -amt, b["name"], "bill"))
                m += 1
                if m > 12:
                    m = 1
                    y += 1
    # A paycheck dated TODAY is projected only if it has not actually shown up
    # yet. The old rule ("never project today's paycheck") assumed SimpleFin's
    # balance runs AHEAD of the transaction feed; in practice it runs up to a day
    # BEHIND, so on payday the deposit sat in neither the balance nor the forecast
    # and a whole paycheck silently vanished — which on 2026-08-20 dropped
    # safe-to-move from $1,745 to $0 and raised a false overdraft warning.
    # start_balance is now get_available_balance() (posted + pending), so anything
    # that has landed — posted or still pending — is already counted; we ask the
    # transactions table directly whether that is so, rather than inferring it
    # from the date. Not yet arrived: project it. Already arrived: skip it. Both
    # halves of the double-count are closed.
    for member in get_household(conn):
        info = detect_next_payday(conn, member["key"])
        if info.get("next_date") and info.get("expected_amount"):
            d = date.fromisoformat(info["next_date"])
            amt = float(info["expected_amount"])
            label = member.get("label") or member["key"].capitalize()
            while d <= end_date:
                if d > today or not _deposit_already_landed(conn, bills_acct_id, d, amt):
                    events.append((d, amt, f"{label} paycheck", "income"))
                d += timedelta(weeks=info.get("interval_weeks", 2))
    # Within a single date, apply income BEFORE bills. Sorting on the date alone
    # left the loop insertion order intact (every bill, then every paycheck), so
    # any day where a paycheck and bills coincide showed a phantom intra-day dip:
    # on 2026-09-03 rent drove the running balance to -191.14 before that same
    # morning's paycheck was applied, though the day actually ends at +1,385.67.
    # Everything downstream reads the MINIMUM of this running balance, so one
    # phantom dip zeroed safe-to-transfer and fired a false overdraft warning.
    # Income-first also makes each day's low equal its end-of-day balance — the
    # only figure genuinely knowable a month out, since banks do not publish
    # intra-day posting order.
    # Pending CREDITS are deliberately NOT added here. A deposit's pending flag says
    # nothing about whether the balance already contains it: payroll posts overnight,
    # so SimpleFin's morning snapshot picks it up while the bank's own feed still
    # reports Status=pending for another day. Forecasting such a deposit on top of a
    # balance that already holds it counts the paycheck twice — $3,103.26 of real
    # money displayed as $4,680.07. The reported balance is the authority on what is
    # in the account; a flag on one imported row is not.
    events.sort(key=lambda x: (x[0], 0 if x[3] == "income" else 1))
    running = start_balance
    timeline = []
    for evt_date, delta, label, kind in events:
        running += delta
        timeline.append({
            "date": evt_date.isoformat(),
            "label": label,
            "amount": round(delta, 2),
            "balance": round(running, 2),
            "kind": kind,
        })
    return timeline

def get_committed_budget(conn) -> float:
    """y — the household's committed monthly living budget. The number the rest
    of the app plans against (transfers, surplus). Set by 'Commit Budget' on the
    Budget page; edits to category limits are a draft until committed, so you can
    play with the numbers without moving the app's math. Falls back to the live
    sum of category limits until the first commit."""
    val = get_setting(conn, "committed_budget")
    if val is not None:
        try:
            return round(float(val), 2)
        except (ValueError, TypeError):
            pass
    row = conn.execute("SELECT COALESCE(SUM(monthly_limit),0) FROM budgets WHERE category!='savings'").fetchone()
    return round(float(row[0] or 0), 2)

def _min_balance_from(timeline, start_balance, from_iso) -> float:
    """Lowest projected Bills balance on or after from_iso (no transfer applied).
    Balance is flat between events, so the min is the balance entering that day
    plus every event balance from that day forward — which already reflects any
    paychecks that land within the window."""
    entering = start_balance
    for e in timeline:
        if e["date"] < from_iso:
            entering = e["balance"]
    m = entering
    for e in timeline:
        if e["date"] >= from_iso:
            m = min(m, e["balance"])
    return m

def compute_planned_transfers(conn, timeline, buffer, current_balance) -> dict:
    """The two planned Bills→Food transfers: fund Food with the committed budget
    (y) split 50/50 across the scheduled transfer days. Each transfer may SHIFT
    within a window (default 3 days, transfer_window_days) to the earliest day it
    can be fully funded without dropping the projected Bills balance below the
    buffer — so a transfer scheduled the day before payday waits for the paycheck
    instead of being needlessly capped. Only if no day in the window can fund it
    is the amount capped. Earlier transfers reduce headroom for later ones."""
    y = get_committed_budget(conn)
    try:
        sched = json.loads(get_setting(conn, "transfer_schedule") or "{}")
    except (ValueError, TypeError):
        sched = {}
    if sched.get("mode") == "payday":
        pay_dates = sorted({e["date"] for e in timeline if e["kind"] == "income"})
        dates = [date.fromisoformat(d) for d in pay_dates[:2]]
    else:
        try:
            days = sorted({int(x) for x in sched.get("days", [1, 15]) if 1 <= int(x) <= 28}) or [1, 15]
        except (ValueError, TypeError):
            days = [1, 15]
        dates = sorted({next_bill_date(dd) for dd in days})[:2]
    try:
        win = max(0, int(get_setting(conn, "transfer_window_days", "3") or 3))
    except (ValueError, TypeError):
        win = 3
    today = date.today()
    n = len(dates) or 1
    portion = round(y / n, 2)
    out = []
    removed = 0.0
    for i, d in enumerate(dates):
        end_c = d + timedelta(days=win)
        if i + 1 < len(dates):
            end_c = min(end_c, dates[i + 1] - timedelta(days=1))  # don't overlap the next transfer
        funded_day = None
        best_c, best_safe = d, 0.0
        c = d
        while c <= end_c:
            if c >= today:
                safe = round(_min_balance_from(timeline, current_balance, c.isoformat()) - removed - buffer, 2)
                if safe > best_safe:
                    best_c, best_safe = c, safe
                if safe >= portion:
                    funded_day = c
                    break
            c += timedelta(days=1)
        if funded_day is not None:
            chosen, amt = funded_day, portion
        else:
            chosen, amt = best_c, round(max(0.0, best_safe), 2)
        removed += amt
        out.append({
            "date": chosen.isoformat(),
            "scheduled_date": d.isoformat(),
            "shifted": chosen != d,
            "planned": portion,
            "amount": amt,
            "capped": amt < portion - 0.01,
        })
    return {"committed_budget": y, "portion": portion, "window_days": win,
            "transfers": out, "total_planned": round(sum(t["amount"] for t in out), 2)}

def find_role_account(conn, role: str, name_hint: str):
    """Resolve which account plays a special role (bills, food). An explicit
    setting ({role}_account_id, set on the Settings page) always wins; the legacy
    name-substring match is only a fallback so existing installs keep working
    until the role is picked explicitly. Renaming an account can silently break
    the fallback — that's exactly why the setting exists."""
    val = get_setting(conn, f"{role}_account_id")
    if val:
        try:
            row = conn.execute(
                "SELECT * FROM accounts WHERE id=? AND is_active=1", (int(val),)
            ).fetchone()
            if row:
                return row
        except (ValueError, TypeError):
            pass
    return conn.execute(
        "SELECT * FROM accounts WHERE is_active=1 AND LOWER(name) LIKE ? LIMIT 1",
        (f"%{name_hint}%",)
    ).fetchone()

def set_setting(conn, key: str, value: str):
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
    conn.commit()

# ── Public endpoints (no auth) ────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.now().isoformat()}

@app.post("/api/auth/login")
async def login(request: Request):
    body = await request.json()
    username = body.get("username", "").strip()
    password = body.get("password", "")
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    if not user or not pwd_context.verify(password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _make_token(username)
    return {"access_token": token, "token_type": "bearer"}

@app.post("/api/auth/change-password")
async def change_password(request: Request):
    body = await request.json()
    username = body.get("username", "").strip()
    current_pw = body.get("current_password", "")
    new_pw = body.get("new_password", "")
    if not all([username, current_pw, new_pw]):
        raise HTTPException(status_code=400, detail="All fields required")
    if len(new_pw) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if not user or not pwd_context.verify(current_pw, user["hashed_password"]):
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid credentials")
    hashed = pwd_context.hash(new_pw)
    conn.execute("UPDATE users SET hashed_password=? WHERE username=?", (hashed, username))
    conn.commit()
    conn.close()
    return {"status": "ok"}

# ── iCal feed — token auth (calendar apps can't send JWT headers) ────────────

@app.get("/api/calendar.ics")
async def calendar_ics(token: str = ""):
    """Subscribe-able calendar of the next 90 days: bill due dates, paydays,
    and transfer days. Secured by a long random token in the URL instead of
    JWT, because Apple/Google Calendar subscriptions can only do plain GETs."""
    conn = get_db()
    real = get_setting(conn, "ical_token")
    if not real or token != real:
        conn.close()
        raise HTTPException(status_code=403, detail="Invalid calendar token")

    today = date.today()
    horizon = today + timedelta(days=90)
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0",
        "PRODID:-//Hearth//Home Finance//EN",
        "X-WR-CALNAME:Hearth", "X-WR-CALDESC:Bills, paydays, and transfer days",
    ]

    def add_event(uid, d, summary):
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid}@hearth.local",
            f"DTSTAMP:{today.strftime('%Y%m%dT000000Z')}",
            f"DTSTART;VALUE=DATE:{d.strftime('%Y%m%d')}",
            f"SUMMARY:{summary}",
            "END:VEVENT",
        ])

    for b in conn.execute("SELECT * FROM bills WHERE is_active=1").fetchall():
        nm = (b["display_name"] or b["name"])[:40].replace(",", " ").replace(";", " ")
        amt = f"${float(b['expected_amount']):.2f}"
        prefix = "Contribution" if b["payment_type"] == "Contribution" else "Bill"
        if b["frequency"] == "weekly" and b["day_of_week"] is not None:
            for occ in weekly_occurrences(b["day_of_week"], today, horizon):
                add_event(f"bill{b['id']}-{occ}", occ, f"{prefix}: {nm} {amt}")
        elif b["day_of_month"]:
            for k in range(4):
                y = today.year + (today.month - 1 + k) // 12
                mth = (today.month - 1 + k) % 12 + 1
                last = cal_mod.monthrange(y, mth)[1]
                occ = date(y, mth, min(b["day_of_month"], last))
                if today <= occ <= horizon:
                    add_event(f"bill{b['id']}-{occ}", occ, f"{prefix}: {nm} {amt}")

    for m in get_household(conn):
        info = detect_next_payday(conn, m["key"])
        if info.get("next_date"):
            dd = date.fromisoformat(info["next_date"])
            label = (m.get("label") or m["key"].capitalize())
            while dd <= horizon:
                add_event(f"pay-{m['key']}-{dd}", dd, f"Payday: {label}")
                dd += timedelta(weeks=info.get("interval_weeks", 2))

    try:
        _sched = json.loads(get_setting(conn, "transfer_schedule") or "{}")
    except (ValueError, TypeError):
        _sched = {}
    if _sched.get("mode") != "payday":
        try:
            _days = sorted({int(x) for x in _sched.get("days", [1, 15]) if 1 <= int(x) <= 28}) or [1, 15]
        except (ValueError, TypeError):
            _days = [1, 15]
        for k in range(4):
            y = today.year + (today.month - 1 + k) // 12
            mth = (today.month - 1 + k) % 12 + 1
            for dd_num in _days:
                try:
                    occ = date(y, mth, dd_num)
                except ValueError:
                    continue
                if today <= occ <= horizon:
                    add_event(f"xfer-{occ}", occ, "Transfer day: Bills → Food")
    conn.close()

    lines.append("END:VCALENDAR")
    return PlainTextResponse("\r\n".join(lines), media_type="text/calendar")

@router.get("/api/calendar/ical-url")
async def calendar_ical_url():
    """Returns the tokened subscribe path, minting the token on first use."""
    conn = get_db()
    token = get_setting(conn, "ical_token")
    if not token:
        token = secrets.token_urlsafe(24)
        set_setting(conn, "ical_token", token)
    conn.close()
    return {"path": f"/hearth/api/calendar.ics?token={token}"}

# ── AI chat — rate-limited, auth via router dep ───────────────────────────────

GATEWAY_URL = "https://10.0.0.24/gateway/api"

@router.post("/api/ai/chat")
@limiter.limit("20/minute")
async def ai_chat(request: Request):
    body = await request.json()
    body.setdefault("stream", True)
    # Ensure enough context window for our financial payload
    body.setdefault("options", {})
    # Feature 5 — the wider financial context (up to 150 txns) needs more room than
    # the old 8192. 16384 comfortably fits the payload on the 8B–14B local models
    # (q8_0 KV cache keeps the VRAM cost modest). Callers can still override.
    body["options"].setdefault("num_ctx", 16384)
    _timeout = httpx.Timeout(connect=30, read=600, write=30, pool=30)
    if body.get("stream"):
        async def streamer():
            async with httpx.AsyncClient(verify=False, timeout=_timeout) as client:
                async with client.stream(
                    "POST", f"{GATEWAY_URL}/chat",
                    json=body,
                    headers={"X-App-Name": "home-finance"},
                ) as r:
                    async for chunk in r.aiter_bytes():
                        yield chunk
        return StreamingResponse(streamer(), media_type="application/x-ndjson")
    async with httpx.AsyncClient(verify=False, timeout=_timeout) as client:
        r = await client.post(
            f"{GATEWAY_URL}/chat", json=body,
            headers={"X-App-Name": "home-finance"},
        )
        return JSONResponse(content=r.json())

@router.get("/api/ai/health")
async def ai_gateway_health():
    try:
        async with httpx.AsyncClient(verify=False, timeout=5.0) as client:
            r = await client.get(f"{GATEWAY_URL}/health")
            return {"ok": True, "detail": r.json().get("status", "ok")}
    except Exception as e:
        return {"ok": False, "detail": str(e)}

@router.get("/api/ai/models")
async def ai_gateway_models():
    try:
        async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
            r = await client.get(f"{GATEWAY_URL}/models")
            return r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gateway unreachable: {e}")

@router.post("/api/ai/test")
async def ai_gateway_test():
    conn = get_db()
    model = get_setting(conn, "ai_default_model", "mistral-nemo:latest") or "mistral-nemo:latest"
    conn.close()
    try:
        # 30s was too tight: a cold model load (esp. slower/vision models like
        # qwen3-vl) can take 20–30s just to warm up, tripping the timeout and
        # surfacing as a misleading "502 Gateway unreachable". Give it room, and
        # cap num_predict so a verbose model can't ramble past the deadline.
        async with httpx.AsyncClient(verify=False, timeout=120.0) as client:
            r = await client.post(
                f"{GATEWAY_URL}/chat",
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "Reply with one short sentence confirming you are working."}],
                    "stream": False,
                    "options": {"num_predict": 80, "temperature": 0},
                },
                headers={"X-App-Name": "home-finance"},
            )
            d = r.json()
            msg = d.get("message", {}) if isinstance(d, dict) else {}
            resp = d.get("response") if isinstance(d, dict) else ""
            # Some models (qwen3-vl, deepseek-r1) emit reasoning in a `thinking`
            # field and leave `content` empty — surface that as text instead of
            # dumping the raw response dict.
            content = (msg.get("content") or "").strip() or resp or ""
            if not content:
                thinking = (msg.get("thinking") or "").strip()
                content = thinking or "Model responded but returned no text — it may be a vision/reasoning model that isn't ideal for chat."
            return {"response": content, "model": model}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gateway unreachable: {e}")

@router.post("/api/ai/suggest-categories")
async def ai_suggest_categories(days: int = 90, account_id: int = None, scope: str = "other"):
    conn = get_db()

    q = """SELECT t.id, t.description, t.category
           FROM transactions t
           WHERE t.transaction_date >= date('now', ?)
             AND t.amount < 0
             AND (t.is_pending IS NULL OR t.is_pending = 0)"""
    params = [f'-{days} days']
    if scope == "other":
        q += " AND t.category = 'other'"
    if account_id:
        q += " AND t.account_id = ?"
        params.append(account_id)
    q += " ORDER BY t.transaction_date DESC LIMIT 300"

    rows = conn.execute(q, params).fetchall()
    # AI suggestions stay at the primary level — same scope as before, just
    # sourced from the categories table instead of the retired custom_categories setting.
    all_cats = [r["name"] for r in conn.execute("SELECT name FROM categories WHERE parent IS NULL").fetchall()]
    model = get_setting(conn, "ai_default_model", "mistral-nemo:latest") or "mistral-nemo:latest"
    conn.close()

    if not rows:
        return {"suggestions": [], "new_categories": [], "total_transactions": 0}

    # Group by merchant key so we send one description per merchant to the AI
    groups = {}
    for r in rows:
        key = _normalize_merchant(r["description"] or "") or (r["description"] or "unknown")[:15]
        if key not in groups:
            groups[key] = {"id": r["id"], "description": r["description"] or "", "current_category": r["category"] or "uncategorized", "count": 0}
        groups[key]["count"] += 1

    group_list = list(groups.values())[:60]
    total = len(rows)

    cats_str = ", ".join(c for c in all_cats if c != "other")
    txn_lines = "\n".join(f"{i}|{g['description']}" for i, g in enumerate(group_list))

    prompt = f"""Categorize these personal finance transactions. Use only these categories: {cats_str}
Never use "other" — pick the closest match.

Hints:
- food: restaurants, fast food, groceries, food delivery, coffee shops, convenience stores
- gas: gas stations, fuel, auto service
- household: rent, utilities, subscriptions, streaming, insurance, pharmacy, home improvement

Transactions (index|description):
{txn_lines}

Also suggest new category names if transactions clearly don't fit existing ones (e.g. medical, entertainment).

Return ONLY valid JSON, no other text:
{{
  "suggestions": [{{"idx": 0, "category": "food"}}, {{"idx": 1, "category": "gas"}}],
  "new_categories": [{{"name": "medical", "reason": "pharmacy and clinic transactions detected"}}]
}}"""

    try:
        async with httpx.AsyncClient(verify=False, timeout=120.0) as client:
            r = await client.post(
                f"{GATEWAY_URL}/chat",
                json={"model": model, "messages": [{"role": "user", "content": prompt}], "stream": False},
                headers={"X-App-Name": "home-finance"},
            )
            d = r.json()
            content = d.get("message", {}).get("content", "") or d.get("response", "") or ""

        m = re.search(r'\{[\s\S]*\}', content)
        if not m:
            raise ValueError(f"No JSON in AI response: {content[:300]}")
        result = json.loads(m.group())

        valid_cats = set(all_cats) - {"other"}
        suggestions = []
        for s in result.get("suggestions", []):
            idx = s.get("idx")
            cat = (s.get("category") or "").lower().strip()
            if isinstance(idx, int) and 0 <= idx < len(group_list) and cat in valid_cats:
                g = group_list[idx]
                if cat == g["current_category"]:
                    continue  # skip no-op suggestions
                suggestions.append({
                    "id": g["id"],
                    "description": g["description"],
                    "count": g["count"],
                    "current_category": g["current_category"],
                    "suggested_category": cat,
                })

        seen = set(all_cats)
        new_cats = []
        for nc in result.get("new_categories", []):
            name = re.sub(r'[^a-z0-9]', '_', (nc.get("name") or "").lower().strip())
            reason = nc.get("reason", "")
            if name and len(name) >= 3 and name not in seen:
                new_cats.append({"name": name, "reason": reason})
                seen.add(name)

        return {"suggestions": suggestions, "new_categories": new_cats, "total_transactions": total}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI suggestion failed: {str(e)}")

# ── Protected routes ──────────────────────────────────────────────────────────

@router.get("/api/accounts")
async def list_accounts(include_inactive: bool = False):
    conn = get_db()
    q = "SELECT * FROM accounts" if include_inactive else "SELECT * FROM accounts WHERE is_active=1"
    rows = conn.execute(q + " ORDER BY name").fetchall()
    result = []
    for r in rows:
        bal = get_account_balance(conn, r["id"])
        result.append({**dict(r), "balance": bal, "display_name": r["nickname"] or r["name"]})
    conn.close()
    return result

@router.post("/api/accounts")
async def create_account(request: Request):
    body = await request.json()
    now = datetime.now().isoformat()
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO accounts
           (name, type, institution, simplefin_id, current_balance, interest_rate, minimum_payment, is_active, created_at)
           VALUES (?,?,?,?,?,?,?,1,?)""",
        (body["name"], body["type"], body.get("institution"), body.get("simplefin_id"),
         body.get("current_balance"), body.get("interest_rate"), body.get("minimum_payment"), now)
    )
    conn.commit()
    aid = cur.lastrowid
    conn.close()
    return {"id": aid, "name": body["name"], "type": body["type"]}

@router.put("/api/accounts/{acct_id}")
async def update_account(acct_id: int, request: Request):
    body = await request.json()
    fields = []
    params = []
    if "name" in body:
        fields.append("name=?"); params.append(body["name"])
    if "institution" in body:
        fields.append("institution=?"); params.append(body["institution"])
    if "type" in body:
        if body["type"] not in ("checking", "savings", "credit", "loan", "personal_loan", "investment"):
            raise HTTPException(status_code=400, detail="Invalid account type")
        fields.append("type=?"); params.append(body["type"])
    if not fields:
        return {"updated": 0}
    params.append(acct_id)
    conn = get_db()
    conn.execute(f"UPDATE accounts SET {', '.join(fields)} WHERE id=?", params)
    conn.commit()
    conn.close()
    return {"updated": acct_id}

@router.delete("/api/accounts/{account_id}")
async def delete_account(account_id: int):
    conn = get_db()
    conn.execute("UPDATE accounts SET is_active=0 WHERE id=?", (account_id,))
    # Exclude all historical transactions so they stop inflating spending/budget totals
    conn.execute("UPDATE transactions SET is_transfer=1 WHERE account_id=? AND is_transfer=0", (account_id,))
    conn.commit()
    conn.close()
    return {"deleted": account_id}

@router.post("/api/accounts/{account_id}/reactivate")
async def reactivate_account(account_id: int):
    conn = get_db()
    conn.execute("UPDATE accounts SET is_active=1 WHERE id=?", (account_id,))
    # Restore transactions that were excluded solely because the account was deactivated.
    # Only undo the ones with no other reason to be a transfer (loan/savings/investment accounts
    # are always excluded regardless of active state — don't restore those).
    acct = conn.execute("SELECT type FROM accounts WHERE id=?", (account_id,)).fetchone()
    if acct and acct["type"] not in ("loan", "savings", "investment"):
        conn.execute("UPDATE transactions SET is_transfer=0 WHERE account_id=? AND is_transfer=1", (account_id,))
    conn.commit()
    conn.close()
    return {"reactivated": account_id}

@router.get("/api/dashboard")
async def dashboard():
    conn = get_db()
    today = date.today()
    has_simplefin = bool(get_setting(conn, "simplefin_access_url"))
    accounts = conn.execute("SELECT * FROM accounts WHERE is_active=1").fetchall()
    account_balances = {}
    for a in accounts:
        # Cash accounts report the bank's AVAILABLE balance so this strip can never
        # disagree with the Bills card below it — two different Bills numbers on one
        # screen reads as a double-count. Credit/loan/investment balances have no
        # meaningful "available" and stay as reported.
        bal = (get_available_balance(conn, a["id"])
               if a["type"] in ("checking", "savings")
               else get_account_balance(conn, a["id"]))
        account_balances[a["id"]] = {
            "id": a["id"],
            "name": a["name"],
            "type": a["type"],
            "institution": a["institution"],
            "balance": bal,
        }
    assets = sum(
        v["balance"] for v in account_balances.values()
        if v["type"] in ("checking", "savings", "investment") and v["balance"] > 0
    )
    tmrs_row = conn.execute("SELECT value FROM settings WHERE key='tmrs_account_balance'").fetchone()
    tmrs_balance = float(tmrs_row["value"]) if tmrs_row else 0.0
    assets += tmrs_balance
    liabilities = sum(
        abs(v["balance"]) for v in account_balances.values()
        if v["type"] in ("credit", "loan", "personal_loan")
    )
    loans = conn.execute("SELECT current_balance FROM loans").fetchall()
    liabilities += sum(l["current_balance"] or 0 for l in loans)
    net_worth = assets - liabilities
    last_month = conn.execute(
        "SELECT net_worth FROM net_worth_history ORDER BY recorded_at DESC LIMIT 1"
    ).fetchone()
    nw_prev = last_month["net_worth"] if last_month else net_worth
    nw_change = net_worth - nw_prev
    nw_history = conn.execute(
        "SELECT recorded_at, net_worth FROM net_worth_history ORDER BY recorded_at DESC LIMIT 12"
    ).fetchall()
    bills = conn.execute("SELECT * FROM bills WHERE is_active=1").fetchall()
    upcoming_bills = []
    weekly_lookahead_end = today + timedelta(days=60)
    for b in bills:
        if b["frequency"] == "weekly" and b["day_of_week"] is not None:
            for occ_date in weekly_occurrences(b["day_of_week"], today, weekly_lookahead_end):
                upcoming_bills.append({
                    "id": b["id"],
                    "name": b["name"],
                    "amount": fmt_money(b["expected_amount"]),
                    "confidence": b["confidence"],
                    "due_date": occ_date.isoformat(),
                    "days_until": (occ_date - today).days,
                    "account_id": b["account_id"],
                    "is_weekly": True,
                })
            continue
        if not b["day_of_month"]:
            continue
        next_d = next_bill_date(b["day_of_month"])
        days_until = (next_d - today).days
        if days_until < 0:
            continue
        upcoming_bills.append({
            "id": b["id"],
            "name": b["name"],
            "amount": fmt_money(b["expected_amount"]),
            "confidence": b["confidence"],
            "due_date": next_d.isoformat(),
            "days_until": days_until,
            "account_id": b["account_id"],
            "is_weekly": False,
        })
    upcoming_bills.sort(key=lambda x: x["days_until"])
    members = get_household(conn)
    pay_by_member = {m["key"]: detect_next_payday(conn, m["key"]) for m in members}
    next_pay = min(pay_by_member.values(), key=lambda p: p["next_date"])
    next_pay_date = date.fromisoformat(next_pay["next_date"])
    bills_account = find_role_account(conn, "bills", "bills")
    if bills_account:
        # Available, not posted: SimpleFin's balance snapshot lags the transaction
        # feed by up to a day, so pending items (today's paycheck included) are
        # real money the posted figure hasn't caught up with yet. Both halves are
        # reported so the UI can explain any gap against the bank's website.
        bills_balance_posted = get_account_balance(conn, bills_account["id"])
        bills_balance = get_available_balance(conn, bills_account["id"])
    else:
        bills_balance_posted = sum(v["balance"] for v in account_balances.values() if v["type"] == "checking")
        bills_balance = bills_balance_posted
    bills_pending = round(bills_balance - bills_balance_posted, 2)
    bills_before_pay = sum(
        b["amount"] for b in upcoming_bills if date.fromisoformat(b["due_date"]) <= next_pay_date
    )
    # One buffer, one warning source: the day-by-day simulation below finds real
    # future shortfalls (overdraft_warnings). The old static low_balance_threshold
    # banner was retired — it compared a different number than it displayed and
    # told you nothing actionable.
    safe_buffer = float(get_setting(conn, "safe_spend_buffer", "200"))
    # "Paid" status always comes from the same explicit bill_paid_months table the
    # Bills tab checkbox and Calendar toggle write to — never a separate guess based
    # on fuzzy-matching transaction descriptions, which could silently disagree with
    # what you already told the app on those other tabs.
    paid_months_lookup = {
        (r["bill_id"], r["month"]) for r in conn.execute("SELECT bill_id, month FROM bill_paid_months").fetchall()
    }
    for b in upcoming_bills:
        # Weekly bills (e.g. an accelerated card payoff) can recur several times a month
        # under one bill id — a single "paid" mark for the month shouldn't suppress every
        # future occurrence, so always treat them as outstanding until their date passes.
        if b.get("is_weekly"):
            b["paid"] = False
        else:
            b["paid"] = (b["id"], b["due_date"][:7]) in paid_months_lookup
    # Bills left this month (unpaid, due in current calendar month)
    month_end = date(today.year, today.month, cal_mod.monthrange(today.year, today.month)[1])
    bills_left_month = sum(
        b["amount"] for b in upcoming_bills
        if date.fromisoformat(b["due_date"]) <= month_end and not b["paid"]
    )
    # Income this month — received + projected, from the shared helper
    _month_income = compute_month_income(conn)
    projected_income_month = _month_income["projected_total"]
    monthly_income = _month_income["monthly_income"]
    # Cash available in Bills for the rest of the month = current balance + remaining paychecks.
    # NOT income — this is a cash-position snapshot, used only to project the month-end balance.
    available_cash_this_month = bills_balance + projected_income_month
    # Month-end projection: everything in minus everything out
    projected_month_end = available_cash_this_month - bills_left_month

    # Safe to spend TODAY: simulate cash flow day-by-day (bills out, paychecks in,
    # in actual date order) and find the LOWEST point the Bills balance reaches over
    # the lookahead window. Comparing totals (income vs bills for the rest of the
    # month) isn't enough — a bill can come due before the paycheck meant to cover
    # it arrives, dipping the balance below the buffer even when the totals net out
    # fine. This is the same simulation used for overdraft_warnings below, so the
    # suggested transfer can never recommend moving out money that simulation
    # itself flags as needed to avoid an overdraft.
    cash_flow_timeline = cash_flow_projection(conn, today + timedelta(days=60), start_balance=bills_balance)
    min_balance = bills_balance
    min_balance_date = today.isoformat()
    overdraft_warnings = []
    for _e in cash_flow_timeline:
        if _e["balance"] < min_balance:
            min_balance, min_balance_date = _e["balance"], _e["date"]
        if _e["kind"] == "bill" and _e["balance"] < safe_buffer:
            overdraft_warnings.append({
                "bill_name": _e["label"],
                "due_date": _e["date"],
                "amount": abs(_e["amount"]),
                "projected_balance": _e["balance"],
                "shortfall": round(safe_buffer - _e["balance"], 2),
            })
    # Reserve = however much of today's balance is needed to survive the lowest
    # future point without dropping below the buffer. Safe-to-transfer is whatever
    # current balance exceeds that reserve plus the buffer itself.
    reserve_needed = max(0.0, bills_balance - min_balance)
    safe_today = min_balance - safe_buffer
    # The three numbers the Bills card shows, as one identity you can check by eye:
    #     X (what's in Bills)  =  Y (free to move)  +  Z (must stay for bills)
    # Z is a property of the SCHEDULE, not of the balance — it's the deepest
    # cumulative dip between now and the low point, plus the buffer — so it holds
    # steady while X and Y move together. When X falls below what the bills need,
    # Y pins at 0 and bills_shortfall says how far short you are.
    bills_needed = round(bills_balance - max(0.0, safe_today), 2)
    bills_shortfall = round(max(0.0, safe_buffer - min_balance), 2)

    # "Amount needed to cover bills until next paycheck": sum bills due STRICTLY
    # BEFORE the next paycheck lands. Bills due ON payday are covered by that day's
    # deposit, so they're not "needed" from the current balance — counting them
    # would overstate this and disagree with the Calendar. (Safe-to-move stays
    # deliberately more conservative about same-day timing — that's a floor, this
    # is an estimate of what you must carry to payday.)
    next_paycheck_date = None
    next_paycheck_amount = None
    for _e in cash_flow_timeline:
        if _e["kind"] == "income":
            next_paycheck_date = _e["date"]
            break
    if next_paycheck_date:
        bills_until_next_paycheck = round(sum(
            abs(_e["amount"]) for _e in cash_flow_timeline
            if _e["kind"] == "bill" and _e["date"] < next_paycheck_date), 2)
        # Sum ALL paychecks landing that day (both earners can be paid the same
        # date), so the "incoming" figure reflects the full deposit.
        next_paycheck_amount = round(sum(
            _e["amount"] for _e in cash_flow_timeline
            if _e["kind"] == "income" and _e["date"] == next_paycheck_date), 2)
    else:
        # No paycheck projected in the window — you must carry EVERY upcoming bill
        # with no income arriving, so this is the sum of them all, not $0 (which
        # would be the most reassuring value for the worst case). The frontend
        # shows "No paycheck in the projection window" alongside it.
        bills_until_next_paycheck = round(sum(
            abs(_e["amount"]) for _e in cash_flow_timeline if _e["kind"] == "bill"), 2)

    variances = conn.execute("SELECT * FROM paychecks ORDER BY actual_date DESC LIMIT 5").fetchall()
    # Monthly income vs expenses — last 4 months from Bills account
    monthly_history = []
    if bills_account:
        mh_rows = conn.execute("""
            SELECT
                strftime('%Y-%m', transaction_date) as month,
                SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income,
                SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expenses
            FROM transactions
            WHERE account_id = ?
            GROUP BY month
            ORDER BY month DESC
            LIMIT 4
        """, (bills_account["id"],)).fetchall()
        monthly_history = list(reversed([dict(r) for r in mh_rows]))

    days_until_paycheck = (next_pay_date - today).days
    food_account = find_role_account(conn, "food", "food")
    food_balance = get_account_balance(conn, food_account["id"]) if food_account else 0.0

    # Monthly obligations split by commitment tier. Weekly bills are converted
    # to a monthly equivalent. Hardline (must-pay bills + debt payments) is a
    # different kind of number than Contributions (chosen savings/investment
    # transfers) — only the sum leaves the account the same way.
    # A bill with no schedule is counted in the totals below but cannot be placed on
    # the timeline, so the forecast and the hardline silently disagree. Rather than
    # let that pass unseen (it hid a $291.37/mo loan payment for months), report it.
    unscheduled_bills = [
        {"id": b["id"], "name": b["display_name"] or b["name"],
         "amount": fmt_money(b["expected_amount"]), "payment_type": b["payment_type"]}
        for b in conn.execute(
            """SELECT id, name, display_name, expected_amount, payment_type FROM bills
               WHERE is_active=1 AND day_of_month IS NULL
                 AND NOT (frequency='weekly' AND day_of_week IS NOT NULL)"""
        ).fetchall()
    ]
    all_active_bills = conn.execute("SELECT expected_amount, frequency, payment_type FROM bills WHERE is_active=1").fetchall()
    def _meq(b):
        return float(b["expected_amount"]) * (52 / 12) if b["frequency"] == "weekly" else float(b["expected_amount"])
    bills_recurring_total = sum(_meq(b) for b in all_active_bills if (b["payment_type"] or "Recurring") == "Recurring")
    debt_payments_total = sum(_meq(b) for b in all_active_bills if b["payment_type"] in ("Loan", "Debt"))
    contributions_total = sum(_meq(b) for b in all_active_bills if b["payment_type"] == "Contribution")
    hardline_total = bills_recurring_total + debt_payments_total
    monthly_bills_total = hardline_total + contributions_total

    # monthly_surplus ("Cash beyond bills") is computed further down from BASELINE
    # income, not this calendar month's actual — see the note there.

    # Safe to transfer NOW: safe_today already accounts for the lowest point the
    # Bills balance will hit over the simulation window, so this can't recommend
    # moving out money the overdraft simulation above says you'll need.
    suggested_transfer = max(0.0, safe_today)

    # Next transfer date comes from the household's configured schedule
    # (settings: transfer_schedule) — either fixed days of the month or
    # aligned to paydays. Default preserves the original 1st/15th behavior.
    try:
        _sched = json.loads(get_setting(conn, "transfer_schedule") or "{}")
    except (ValueError, TypeError):
        _sched = {}
    if _sched.get("mode") == "payday":
        next_transfer = next_pay_date
    else:
        try:
            _days = sorted({int(d) for d in _sched.get("days", [1, 15]) if 1 <= int(d) <= 28}) or [1, 15]
        except (ValueError, TypeError):
            _days = [1, 15]
        _nm_first = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
        _t_dates = [today.replace(day=dd) for dd in _days] + [_nm_first.replace(day=dd) for dd in _days]
        next_transfer = min(d for d in _t_dates if d >= today)
    days_until_next_transfer = (next_transfer - today).days

    _last_xfer = conn.execute(
        "SELECT transfer_date, amount, suggested_amount FROM transfers ORDER BY transfer_date DESC, id DESC LIMIT 1"
    ).fetchone()

    # Food runway: what the Food balance allows per day until the next transfer,
    # vs the actual daily pace over the last 14 days. The mid-cycle early warning
    # that makes "month to month" visible before transfer day.
    food_daily_allowance = None
    food_daily_pace = None
    if food_account:
        food_daily_allowance = round(food_balance / max(1, days_until_next_transfer), 2)
        _pace_row = conn.execute(
            """SELECT ABS(SUM(amount)) as t FROM transactions
               WHERE account_id=? AND amount < 0 AND is_transfer=0 AND is_pending=0
                 AND transaction_date >= ?""",
            (food_account["id"], (today - timedelta(days=14)).isoformat())
        ).fetchone()
        food_daily_pace = round((_pace_row["t"] or 0) / 14, 2)

    # Debt countdown: same debt set and avalanche simulation as /api/debt/strategies,
    # surfaced on the dashboard so the payoff goal is visible every day.
    _debts = _collect_debts(conn)
    debt_total = round(sum(d["balance"] for d in _debts), 2)
    debt_free_date = None
    debt_free_months = None
    debt_focus = None
    if _debts:
        _plan = _simulate_payoff_strategy([dict(d) for d in _debts], 0, "avalanche", True)
        if _plan["fully_paid_off"]:
            debt_free_date = _plan["debt_free_date"]
            debt_free_months = _plan["months"]
        debt_focus = _plan["payoff_order"][0] if _plan["payoff_order"] else None
    _prev_liab = conn.execute(
        "SELECT liabilities FROM net_worth_history WHERE recorded_at < ? ORDER BY recorded_at DESC LIMIT 1",
        (today.replace(day=1).isoformat(),)
    ).fetchone()
    debt_change_month = round(debt_total - float(_prev_liab["liabilities"]), 2) if _prev_liab else None

    # Baseline income — the planning number budgets are built on
    _baseline = compute_baseline_income(conn)
    income_vs_baseline = round(monthly_income - _baseline["baseline_income"], 2)

    # "Cash beyond bills" uses BASELINE income, not this calendar month's actual.
    # When a paycheck lands early (income_vs_baseline > 0) it belongs to next
    # month's first bills — the cash-flow simulation already reserves it — so
    # counting it as this-month surplus would double-spend it, the exact
    # month-to-month error the app is built to avoid. Report the sustainable
    # normal-month figure instead; "Safe to move now" covers what's movable today.
    monthly_surplus = round(_baseline["baseline_income"] - monthly_bills_total, 2)

    # The squeeze guard: baseline − hardline − contributions = what the plan
    # leaves to live on. Compare against what the household ACTUALLY lives on
    # (median of recent complete months' discretionary spending). A negative
    # squeeze means contributions are over-committed and the gap lands on
    # credit cards — whose interest rate beats any savings yield, so the app
    # must surface this before the household feels it.
    left_to_live = round(_baseline["baseline_income"] - hardline_total - contributions_total, 2)
    _living_rows = conn.execute(
        """SELECT strftime('%Y-%m', transaction_date) as m, ABS(SUM(amount)) as t
           FROM transactions WHERE amount < 0 AND is_transfer=0 AND is_pending=0
             AND (category IS NULL OR category NOT IN ('bill', 'debt_payment'))
             AND strftime('%Y-%m', transaction_date) < ?
           GROUP BY m ORDER BY m DESC LIMIT 3""",
        (today.strftime("%Y-%m"),)
    ).fetchall()
    actual_living_median = round(statistics.median([float(r["t"]) for r in _living_rows]), 2) if _living_rows else None
    living_squeeze = round(left_to_live - actual_living_median, 2) if actual_living_median is not None else None

    # Committed-budget model: y funds Food via planned transfers; surplus-to-debt
    # is what's left after everything, and grows as bills shrink or y drops.
    planned = compute_planned_transfers(conn, cash_flow_timeline, safe_buffer, bills_balance)
    committed_budget = planned["committed_budget"]
    savings_goal = float(conn.execute("SELECT COALESCE(SUM(monthly_limit),0) FROM budgets WHERE category='savings'").fetchone()[0])
    budget_surplus = round(_baseline["baseline_income"] - hardline_total - contributions_total - savings_goal - committed_budget, 2)

    # Data freshness — safe-to-transfer is only actionable if balances are fresh
    _sync_row = conn.execute(
        "SELECT synced_at FROM sync_log WHERE status='ok' ORDER BY synced_at DESC LIMIT 1"
    ).fetchone()
    last_sync_at = _sync_row["synced_at"] if _sync_row else None
    sync_stale = True
    if last_sync_at:
        try:
            sync_stale = (datetime.now() - datetime.fromisoformat(last_sync_at)) > timedelta(hours=26)
        except ValueError:
            pass

    # Surplus sweep: when today's simulated safe-to-transfer runs meaningfully
    # above the household's typical recorded transfer, the excess is TRUE
    # surplus — the simulation already reserved every upcoming bill (including
    # next month's first week) before saying so. Requires transfer history, so
    # the detection gets smarter the more transfers are recorded.
    sweep_suggestion = None
    _xfer_amounts = [
        float(r["amount"]) for r in conn.execute(
            "SELECT amount FROM transfers ORDER BY transfer_date DESC, id DESC LIMIT 6"
        ).fetchall()
    ]
    if len(_xfer_amounts) >= 2:
        _typical = statistics.median(_xfer_amounts)
        _excess = round(suggested_transfer - _typical, 2)
        if _excess >= 100:
            sweep_suggestion = {"amount": _excess, "typical_transfer": fmt_money(_typical)}

    conn.close()
    return {
        "has_simplefin": has_simplefin,
        "accounts": list(account_balances.values()),
        "net_worth": fmt_money(net_worth),
        "net_worth_change": fmt_money(nw_change),
        "net_worth_history": [dict(r) for r in nw_history],
        "assets": fmt_money(assets),
        "liabilities": fmt_money(liabilities),
        "tmrs_balance": fmt_money(tmrs_balance),
        "safe_spend_buffer": fmt_money(safe_buffer),
        "bills_balance": fmt_money(bills_balance),
        "bills_balance_posted": fmt_money(bills_balance_posted),
        "bills_pending": bills_pending,
        "bills_needed": bills_needed,
        "bills_shortfall": bills_shortfall,
        "bills_low_point": fmt_money(min_balance),
        "bills_low_date": min_balance_date,
        "bills_before_next_pay": fmt_money(bills_before_pay),
        "bills_left_month": fmt_money(bills_left_month),
        "projected_income_month": fmt_money(projected_income_month),
        "available_cash_this_month": fmt_money(available_cash_this_month),
        "projected_month_end": fmt_money(projected_month_end),
        "safe_today": fmt_money(safe_today),
        "reserve_needed": fmt_money(reserve_needed),
        "upcoming_bills": upcoming_bills[:10],
        "next_income": {**pay_by_member, "soonest": next_pay},
        "paycheck_variances": [dict(r) for r in variances],
        "monthly_history": monthly_history,
        "encumbered_30d": 0,
        "recommended_transfer": 0,
        "spendable_in_food": 0,
        "food_balance": fmt_money(food_balance),
        "next_paycheck_date": next_pay["next_date"],
        "days_until_paycheck": days_until_paycheck,
        "monthly_income": fmt_money(monthly_income),
        "monthly_bills_total": fmt_money(monthly_bills_total),
        "bills_hardline_total": fmt_money(hardline_total),
        "bills_recurring_total": fmt_money(bills_recurring_total),
        "debt_payments_total": fmt_money(debt_payments_total),
        "contributions_total": fmt_money(contributions_total),
        "left_to_live": fmt_money(left_to_live),
        "actual_living_median": actual_living_median,
        "living_squeeze": living_squeeze,
        "committed_budget": committed_budget,
        "savings_goal": round(savings_goal, 2),
        "budget_surplus": budget_surplus,
        "planned_transfers": planned,
        "monthly_surplus": fmt_money(monthly_surplus),
        "suggested_transfer": fmt_money(suggested_transfer),
        "bills_until_next_paycheck": fmt_money(bills_until_next_paycheck),
        "bills_until_next_paycheck_date": next_paycheck_date,
        "incoming_next_paycheck": fmt_money(next_paycheck_amount) if next_paycheck_amount is not None else None,
        "baseline_income": _baseline["baseline_income"],
        "baseline_source": _baseline["baseline_source"],
        "income_vs_baseline": income_vs_baseline,
        "last_sync_at": last_sync_at,
        "sync_stale": sync_stale,
        "sweep_suggestion": sweep_suggestion,
        "next_transfer_date": next_transfer.isoformat(),
        "days_until_next_transfer": days_until_next_transfer,
        "last_transfer": dict(_last_xfer) if _last_xfer else None,
        "food_daily_allowance": food_daily_allowance,
        "food_daily_pace": food_daily_pace,
        "debt_total": debt_total,
        "debt_free_date": debt_free_date,
        "debt_free_months": debt_free_months,
        "debt_focus": debt_focus,
        "debt_change_month": debt_change_month,
        "unscheduled_bills": unscheduled_bills,
        "overdraft_warnings": overdraft_warnings,
        "cash_flow_timeline": cash_flow_timeline,
    }

@router.get("/api/calendar")
async def calendar_data(month: str = None):
    if not month:
        month = date.today().strftime("%Y-%m")
    year, mon = map(int, month.split("-"))
    start = date(year, mon, 1)
    last_day = cal_mod.monthrange(year, mon)[1]
    end = date(year, mon, last_day)
    conn = get_db()
    txns = conn.execute(
        """SELECT t.*, a.name as account_name FROM transactions t
           JOIN accounts a ON t.account_id = a.id
           WHERE t.transaction_date >= ? AND t.transaction_date <= ?
           ORDER BY t.transaction_date""",
        (start.isoformat(), end.isoformat())
    ).fetchall()
    paid_set = {r["bill_id"] for r in conn.execute(
        "SELECT bill_id FROM bill_paid_months WHERE month=?", (month,)
    ).fetchall()}
    bills = conn.execute("SELECT * FROM bills WHERE is_active=1").fetchall()
    bill_events = []
    for b in bills:
        # Weekly bills (e.g. an accelerated card payment) occur several times a
        # month — draw every occurrence, or the bill is invisible on the one
        # page where people look for "what's due when."
        if b["frequency"] == "weekly" and b["day_of_week"] is not None:
            for occ in weekly_occurrences(b["day_of_week"], start, end):
                bill_events.append({
                    "id":         b["id"],
                    "date":       occ.isoformat(),
                    "type":       "bill",
                    "name":       b["name"],
                    "amount":     fmt_money(b["expected_amount"]),
                    "confidence": b["confidence"],
                    "bill_type":  b["bill_type"],
                    "payment_type": b["payment_type"] or "Recurring",
                    "autopay":    bool(b["autopay"]),
                    "weekly":     True,
                    # One paid-mark can't represent several occurrences, so
                    # weekly bills never show as paid (same rule as dashboard)
                    "paid":       False,
                })
            continue
        if b["day_of_month"]:
            try:
                d = date(year, mon, b["day_of_month"])
            except ValueError:
                last = cal_mod.monthrange(year, mon)[1]
                d = date(year, mon, last)
            bill_events.append({
                "id":         b["id"],
                "date":       d.isoformat(),
                "type":       "bill",
                "name":       b["name"],
                "amount":     fmt_money(b["expected_amount"]),
                "confidence": b["confidence"],
                "bill_type":  b["bill_type"],
                "payment_type": b["payment_type"] or "Recurring",
                "autopay":    bool(b["autopay"]),
                "paid":       b["id"] in paid_set,
            })
    pay_rows = conn.execute(
        "SELECT * FROM paychecks WHERE (expected_date >= ? AND expected_date <= ?) OR (actual_date >= ? AND actual_date <= ?)",
        (start.isoformat(), end.isoformat(), start.isoformat(), end.isoformat())
    ).fetchall()
    pay_events = []
    seen_pay_dates = set()
    today_cal = date.today()
    for p in pay_rows:
        d = p["actual_date"] or p["expected_date"]
        if d:
            exp_amt = fmt_money(p["expected_amount"]) if p["expected_amount"] is not None else None
            act_amt = fmt_money(p["actual_amount"])   if p["actual_amount"]   is not None else None
            pay_date = date.fromisoformat(d)
            if p["actual_date"] and act_amt is not None and exp_amt and exp_amt > 0:
                variance_status = "ok" if abs(act_amt - exp_amt) / exp_amt <= 0.05 else "variance"
            elif p["actual_date"]:
                variance_status = "ok"
            elif pay_date < today_cal:
                variance_status = "missing"
            else:
                variance_status = None
            pay_events.append({
                "date":            d,
                "type":            "income",
                "person":          p["person"],
                "amount":          fmt_money(p["actual_amount"] or p["expected_amount"]),
                "expected_amount": exp_amt,
                "actual_amount":   act_amt,
                "variance_status": variance_status,
            })
            seen_pay_dates.add(d)
    today_cal = date.today()
    if date(year, mon, 1) >= today_cal.replace(day=1):
        for m in get_household(conn):
            person = m["key"]
            info = detect_next_payday(conn, person)
            if not info.get("next_date"):
                continue
            next_d = date.fromisoformat(info["next_date"])
            amount = float(info.get("expected_amount") or 0)
            freq = info.get("interval_weeks", 2) * 7
            d = next_d
            while d <= end:
                if d >= start and d.isoformat() not in seen_pay_dates:
                    pay_events.append({"date": d.isoformat(), "type": "income", "person": person, "amount": fmt_money(amount), "projected": True})
                d += timedelta(days=freq)
    by_date = {}
    for t in txns:
        d = t["transaction_date"]
        by_date.setdefault(d, []).append({
            "id": t["id"], "amount": fmt_money(t["amount"]),
            "description": t["description"], "category": t["category"],
            "account": t["account_name"], "is_pending": bool(t["is_pending"]),
        })
    bills_acct = find_role_account(conn, "bills", "bills")
    # Available, not posted — must match the basis the shared cash-flow projection
    # starts from, or the Calendar's headline balance and its own balance overlay
    # would disagree by the pending amount.
    bills_bal     = get_available_balance(conn, bills_acct["id"]) if bills_acct else 0.0
    safe_buffer = float(get_setting(conn, "safe_spend_buffer", "200"))

    _today = date.today()
    cur_month = _today.strftime("%Y-%m")

    # Expected income for the month — honest full-month figure, not just what's
    # landed so far (the old summary bar compared received-so-far income against
    # full-month bills and produced a meaningless negative net).
    if month == cur_month:
        expected_income = compute_month_income(conn)["monthly_income"]
    elif month < cur_month:
        expected_income = round(sum((p["amount"] or 0) for p in pay_events if not p.get("projected")), 2)
    else:
        expected_income = compute_baseline_income(conn)["baseline_income"]

    # Transfer days: recorded transfers + upcoming scheduled days this month
    transfer_events = [
        {"date": r["transfer_date"], "amount": fmt_money(r["amount"]), "recorded": True}
        for r in conn.execute(
            "SELECT transfer_date, amount FROM transfers WHERE transfer_date >= ? AND transfer_date <= ? ORDER BY transfer_date",
            (start.isoformat(), end.isoformat())
        ).fetchall()
    ]
    try:
        _sched = json.loads(get_setting(conn, "transfer_schedule") or "{}")
    except (ValueError, TypeError):
        _sched = {}
    if _sched.get("mode") == "payday":
        sched_dates = sorted({p["date"] for p in pay_events if p.get("projected")})
    else:
        try:
            _days = sorted({int(x) for x in _sched.get("days", [1, 15]) if 1 <= int(x) <= 28}) or [1, 15]
        except (ValueError, TypeError):
            _days = [1, 15]
        sched_dates = []
        for dd in _days:
            try:
                sched_dates.append(date(year, mon, dd).isoformat())
            except ValueError:
                pass
    _recorded_dates = {e["date"] for e in transfer_events}
    for sd in sched_dates:
        if sd >= _today.isoformat() and sd not in _recorded_dates:
            transfer_events.append({"date": sd, "amount": None, "recorded": False})
    transfer_events.sort(key=lambda e: e["date"])

    # "Looks paid" suggestions: unpaid monthly bills with a matching transaction
    # near the due date. Suggestion only — paid status stays a human decision.
    paid_suggestions = []
    for b in bills:
        if b["frequency"] == "weekly" or not b["day_of_month"] or b["id"] in paid_set:
            continue
        try:
            due = date(year, mon, b["day_of_month"])
        except ValueError:
            due = date(year, mon, cal_mod.monthrange(year, mon)[1])
        term = _bill_match_term(b).lower()
        # Amount must be in the right ballpark too — a $2.41 fee at the same
        # merchant is not the $25 bill payment.
        _tol = max(5.0, float(b["expected_amount"]) * 0.2)
        m_txn = conn.execute(
            """SELECT transaction_date, amount FROM transactions
               WHERE amount < 0 AND LOWER(description) LIKE ?
                 AND ABS(ABS(amount) - ?) <= ?
                 AND ABS(julianday(transaction_date) - julianday(?)) <= 5
               ORDER BY ABS(julianday(transaction_date) - julianday(?)) LIMIT 1""",
            (f"%{term}%", float(b["expected_amount"]), _tol, due.isoformat(), due.isoformat())
        ).fetchone()
        if m_txn:
            paid_suggestions.append({
                "bill_id": b["id"],
                "due_date": due.isoformat(),
                "txn_date": m_txn["transaction_date"],
                "amount": fmt_money(abs(m_txn["amount"])),
            })
    conn.close()

    # Simulation overlay — one continuous projection from today through the
    # END of the requested month, so balances carry forward across month
    # boundaries instead of each month restarting from today's live balance.
    # Same function the Dashboard's safe-to-transfer uses; they cannot disagree.
    sim_timeline = []
    low_point = None
    suggested_transfer = None
    if month >= cur_month:
        _conn2 = get_db()
        # Always project at least 45 days out so the sidebar "Upcoming" agenda
        # has a full horizon even when the viewed month has only a few days left.
        sim_timeline = cash_flow_projection(_conn2, max(end, _today + timedelta(days=45)))
        _conn2.close()
        _in_month = [e for e in sim_timeline if start.isoformat() <= e["date"] <= end.isoformat()]
        if _in_month:
            _low = min(_in_month, key=lambda e: e["balance"])
            low_point = {"date": _low["date"], "balance": _low["balance"], "label": _low["label"]}
    # Health block — the two questions the household actually monitors:
    # (1) will the Bills account stay funded for autopay, and (2) are they
    # overspending their living (Food) money. Bill-by-bill detail is noise
    # when bills autopay; these two answers are the point.
    health = None
    if month == cur_month:
        _dash = await dashboard()
        suggested_transfer = _dash.get("suggested_transfer")
        _lp = _dash.get("safe_today")  # lowest projected balance minus buffer
        _low_bal = low_point["balance"] if low_point else _dash.get("bills_balance")
        if _dash.get("overdraft_warnings"):
            bills_status = "danger"
        elif _low_bal is not None and _low_bal < safe_buffer:
            bills_status = "tight"
        else:
            bills_status = "ok"
        allowance = _dash.get("food_daily_allowance")
        pace = _dash.get("food_daily_pace")
        food_bal = _dash.get("food_balance")
        runway_days = None
        if food_bal is not None and pace and pace > 0:
            runway_days = int(food_bal / pace)
        if allowance is not None and pace is not None and pace > allowance * 1.1:
            living_status = "over"
        else:
            living_status = "ok"
        health = {
            "bills_status": bills_status,
            "bills_balance": _dash.get("bills_balance"),
            "low_point": low_point,
            "safe_buffer": safe_buffer,
            "overdraft_warnings": _dash.get("overdraft_warnings") or [],
            "suggested_transfer": suggested_transfer,
            "days_until_transfer": _dash.get("days_until_next_transfer"),
            "living_status": living_status,
            "food_balance": food_bal,
            "food_daily_allowance": allowance,
            "food_daily_pace": pace,
            "runway_days": runway_days,
            "committed_budget": _dash.get("committed_budget"),
            "budget_surplus": _dash.get("budget_surplus"),
            "planned_transfers": _dash.get("planned_transfers"),
        }

    return {
        "month":                  month,
        "transactions_by_date":   by_date,
        "bill_events":            bill_events,
        "pay_events":             pay_events,
        "bills_account_balance":  bills_bal,
        "safe_spend_buffer":      safe_buffer,
        "expected_income":        expected_income,
        "transfer_events":        transfer_events,
        "paid_suggestions":       paid_suggestions,
        "cash_flow_timeline":     sim_timeline,
        "low_point":              low_point,
        "suggested_transfer":     suggested_transfer,
        "health":                 health,
    }

@router.get("/api/transactions")
async def list_transactions(account_id: int = None, start: str = None, end: str = None, limit: int = 100, category: str = None):
    conn = get_db()
    q = "SELECT t.*, a.name as account_name FROM transactions t JOIN accounts a ON t.account_id = a.id WHERE 1=1"
    params = []
    if account_id:
        q += " AND t.account_id=?"; params.append(account_id)
    if start:
        q += " AND t.transaction_date >= ?"; params.append(start)
    if end:
        q += " AND t.transaction_date <= ?"; params.append(end)
    if category:
        q += " AND t.category=?"; params.append(category)
    q += " ORDER BY t.transaction_date DESC LIMIT ?"; params.append(limit)
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.post("/api/transactions")
async def add_transaction(request: Request):
    body = await request.json()
    now = datetime.now().isoformat()
    cat = body.get("category") or auto_category(body.get("description", ""))
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO transactions (account_id, amount, description, category,
           transaction_date, posted_date, is_pending, created_at) VALUES (?,?,?,?,?,?,?,?)""",
        (body["account_id"], body["amount"], body.get("description"), cat,
         body["transaction_date"], body.get("posted_date"), body.get("is_pending", 0), now)
    )
    conn.commit()
    tid = cur.lastrowid
    conn.close()
    return {"id": tid}

@router.get("/api/bills")
async def list_bills():
    conn = get_db()
    rows = conn.execute("SELECT * FROM bills WHERE is_active=1 ORDER BY day_of_month IS NULL, day_of_month").fetchall()
    today = date.today()
    current_month = today.strftime("%Y-%m")
    paid_ids = {r["bill_id"] for r in conn.execute(
        "SELECT bill_id FROM bill_paid_months WHERE month=?", (current_month,)
    ).fetchall()}
    result = []
    for b in rows:
        if b["frequency"] == "weekly" and b["day_of_week"] is not None:
            next_d = next_weekly_date(b["day_of_week"])
        else:
            next_d = next_bill_date(b["day_of_month"]) if b["day_of_month"] else None
        days = (next_d - today).days if next_d else None
        rolling_min = rolling_max = None
        if b["confidence"] == "estimated" and b["account_id"]:
            three_months_ago = (today - timedelta(days=90)).isoformat()
            txns = conn.execute(
                "SELECT amount FROM transactions WHERE account_id=? AND transaction_date >= ? AND LOWER(description) LIKE ? ORDER BY transaction_date DESC LIMIT 3",
                (b["account_id"], three_months_ago, f"%{_bill_match_term(b).lower()}%")
            ).fetchall()
            amounts = [abs(t["amount"]) for t in txns]
            if amounts:
                rolling_min = min(amounts)
                rolling_max = max(amounts)
        # The true monthly cost of this bill — weekly bills (e.g. an accelerated card
        # payoff) cost far more per month than their per-occurrence amount suggests.
        # Every page that totals "monthly bills" should sum this field, not
        # expected_amount directly, so the conversion only lives in one place.
        monthly_equivalent = round(b["expected_amount"] * (52 / 12), 2) if b["frequency"] == "weekly" else b["expected_amount"]
        # A bill linked to a synced account/loan is the same real-world debt payment
        # shown on the Debt tab — its name must come from there (the single editable
        # source for that entity) rather than from a second, independently-edited
        # display_name that can drift out of sync with what the Debt tab shows.
        linked_name = None
        if b["linked_account_id"]:
            acct = conn.execute("SELECT name, nickname FROM accounts WHERE id=?", (b["linked_account_id"],)).fetchone()
            if acct:
                linked_name = acct["nickname"] or acct["name"]
        elif b["linked_loan_id"]:
            loan = conn.execute("SELECT name FROM loans WHERE id=?", (b["linked_loan_id"],)).fetchone()
            if loan:
                linked_name = loan["name"]
        result.append({**dict(b), "next_due": next_d.isoformat() if next_d else None, "days_until": days, "rolling_min": rolling_min, "rolling_max": rolling_max, "paid_this_month": b["id"] in paid_ids, "monthly_equivalent": monthly_equivalent, "linked_name": linked_name})
    conn.close()
    return result

@router.post("/api/bills")
async def create_bill(request: Request):
    body = await request.json()
    conn = get_db()
    # Same rule as loan_set_bill: never store a monthly bill with no due day. A
    # caller that omits it gets one derived from the loan/account/merchant history
    # rather than a NULL that the projection would quietly skip.
    _day = body.get("day_of_month") or derive_bill_day(
        conn, loan_id=body.get("linked_loan_id"), account_id=body.get("linked_account_id"),
        merchant_pattern=body.get("merchant_pattern") or body.get("name"))
    cur = conn.execute(
        "INSERT INTO bills (name, display_name, expected_amount, confidence, day_of_month, account_id, bill_type, payment_type, from_debt_budget, linked_loan_id, linked_account_id, notes, autopay, is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
        (body["name"], body.get("display_name") or None, body["expected_amount"], body.get("confidence", "fixed"), _day, body.get("account_id"), body.get("bill_type"), body.get("payment_type", "Recurring"), int(body.get("from_debt_budget") or 0), body.get("linked_loan_id"), body.get("linked_account_id"), body.get("notes"), int(body.get("autopay", 1)))
    )
    conn.commit()
    bid = cur.lastrowid
    conn.close()
    return {"id": bid}

@router.put("/api/bills/{bill_id}")
async def update_bill(bill_id: int, request: Request):
    body = await request.json()
    conn = get_db()
    conn.execute(
        "UPDATE bills SET name=?, display_name=?, expected_amount=?, confidence=?, day_of_month=?, account_id=?, bill_type=?, payment_type=?, from_debt_budget=?, linked_loan_id=?, linked_account_id=?, notes=?, autopay=? WHERE id=?",
        (body["name"], body.get("display_name") or None, body["expected_amount"], body.get("confidence", "fixed"), body.get("day_of_month"), body.get("account_id"), body.get("bill_type"), body.get("payment_type", "Recurring"), int(body.get("from_debt_budget") or 0), body.get("linked_loan_id"), body.get("linked_account_id"), body.get("notes"), int(body.get("autopay", 1)), bill_id)
    )
    conn.commit()
    conn.close()
    return {"updated": bill_id}

@router.patch("/api/bills/{bill_id}/type")
async def set_bill_type(bill_id: int, request: Request):
    body = await request.json()
    bill_type = body.get("bill_type")  # "required" | "optional" | None
    conn = get_db()
    conn.execute("UPDATE bills SET bill_type=? WHERE id=?", (bill_type, bill_id))
    conn.commit()
    conn.close()
    return {"updated": bill_id, "bill_type": bill_type}

@router.put("/api/bills/{bill_id}/paid")
async def set_bill_paid(bill_id: int, request: Request):
    body = await request.json()
    paid      = body.get("paid", True)
    month     = body.get("month")       # "YYYY-MM"
    paid_date = body.get("paid_date")
    conn = get_db()
    if paid:
        conn.execute(
            "INSERT OR REPLACE INTO bill_paid_months (bill_id, month, paid_date) VALUES (?,?,?)",
            (bill_id, month, paid_date),
        )
    else:
        conn.execute(
            "DELETE FROM bill_paid_months WHERE bill_id=? AND month=?",
            (bill_id, month),
        )
    conn.commit()
    conn.close()
    return {"bill_id": bill_id, "month": month, "paid": paid}

@router.delete("/api/bills/{bill_id}")
async def delete_bill(bill_id: int):
    conn = get_db()
    conn.execute("UPDATE bills SET is_active=0 WHERE id=?", (bill_id,))
    conn.commit()
    conn.close()
    return {"deleted": bill_id}

@router.put("/api/transactions/{txn_id}/category")
async def update_transaction_category(txn_id: int, request: Request):
    body = await request.json()
    category = body.get("category", "other")
    apply_to_merchant = body.get("apply_to_merchant", False)
    conn = get_db()
    txn = conn.execute("SELECT description FROM transactions WHERE id=?", (txn_id,)).fetchone()
    if not txn:
        conn.close()
        raise HTTPException(status_code=404, detail="Transaction not found")
    # A human explicitly set this category — whether by hand or by approving an AI
    # suggestion in the UI — so it's confirmed, not a guess, from this point on.
    conn.execute("UPDATE transactions SET category=?, category_confirmed=1 WHERE id=?", (category, txn_id))
    updated = 1
    if apply_to_merchant and txn["description"]:
        pattern = _normalize_merchant(txn["description"])
        if pattern:
            conn.execute(
                "INSERT OR REPLACE INTO merchant_rules (pattern, category, created_at) VALUES (?,?,?)",
                (pattern, category, datetime.now().isoformat())
            )
            cur = conn.execute(
                "UPDATE transactions SET category=?, category_confirmed=1 WHERE LOWER(description) LIKE ?",
                (category, f"%{pattern}%")
            )
            updated = cur.rowcount
    conn.commit()
    conn.close()
    return {"updated": updated, "category": category}

@router.get("/api/merchant-rules")
async def list_merchant_rules():
    conn = get_db()
    rows = conn.execute("SELECT * FROM merchant_rules ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.delete("/api/merchant-rules/{rule_id}")
async def delete_merchant_rule(rule_id: int):
    conn = get_db()
    conn.execute("DELETE FROM merchant_rules WHERE id=?", (rule_id,))
    conn.commit()
    conn.close()
    return {"deleted": rule_id}

@router.get("/api/categories")
async def list_categories():
    conn = get_db()
    rows = conn.execute("SELECT name, parent, is_base FROM categories ORDER BY name").fetchall()
    conn.close()
    primaries = {}
    for r in rows:
        if r["parent"] is None:
            primaries.setdefault(r["name"], {"name": r["name"], "is_base": bool(r["is_base"]), "secondaries": []})
    for r in rows:
        if r["parent"] is not None and r["parent"] in primaries:
            primaries[r["parent"]]["secondaries"].append(r["name"])
    base = [p["name"] for p in primaries.values() if p["is_base"]]
    custom = [p["name"] for p in primaries.values() if not p["is_base"]]
    return {
        "primaries": list(primaries.values()),
        "all": [r["name"] for r in rows],
        # Kept for any caller still expecting the old flat shape (primaries only).
        "base": base,
        "custom": custom,
    }

@router.post("/api/categories")
async def add_category(request: Request):
    body = await request.json()
    name = (body.get("name") or "").strip().lower().replace(" ", "_")
    parent = (body.get("parent") or "").strip().lower().replace(" ", "_") or None
    if not name or len(name) > 30:
        raise HTTPException(status_code=400, detail="Invalid category name")
    conn = get_db()
    if parent:
        parent_row = conn.execute("SELECT 1 FROM categories WHERE name=? AND parent IS NULL", (parent,)).fetchone()
        if not parent_row:
            conn.close()
            raise HTTPException(status_code=400, detail=f"'{parent}' is not a primary category")
    conn.execute("INSERT OR IGNORE INTO categories (name, parent, is_base) VALUES (?, ?, 0)", (name, parent))
    conn.commit()
    conn.close()
    return {"name": name, "parent": parent}

@router.delete("/api/categories/{name}")
async def delete_category(name: str):
    conn = get_db()
    row = conn.execute("SELECT parent, is_base FROM categories WHERE name=?", (name,)).fetchone()
    if not row:
        conn.close()
        return {"deleted": name}
    if row["is_base"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Built-in categories can't be deleted")
    if row["parent"] is None:
        # Deleting a primary takes its secondaries with it — a secondary can't be
        # left pointing at a parent that no longer exists.
        conn.execute("DELETE FROM categories WHERE parent=?", (name,))
    conn.execute("DELETE FROM categories WHERE name=?", (name,))
    conn.commit()
    conn.close()
    return {"deleted": name}

@router.get("/api/budgets")
async def get_budgets():
    conn = get_db()
    today = date.today()
    month_start = today.replace(day=1).isoformat()
    last_month_end = today.replace(day=1) - timedelta(days=1)
    last_month_start = last_month_end.replace(day=1).isoformat()
    last_month_end_iso = last_month_end.isoformat()

    # Spent is computed for every real primary category, not just ones with a saved
    # limit — a category with no limit set still has real spending that shouldn't
    # silently show as $0. A primary's spent total includes its secondaries (e.g.
    # Food includes Groceries/Fast Food/Coffee/Restaurants/Uber Eats) since budgets
    # are tracked one level up — "one budget for food, no matter where it was spent."
    primaries = {r["name"] for r in conn.execute("SELECT name FROM categories WHERE parent IS NULL").fetchall()}
    limits = {r["category"]: float(r["monthly_limit"]) for r in conn.execute("SELECT category, monthly_limit FROM budgets").fetchall()}
    # Anything with a saved limit but no entry in categories (e.g. the "savings"
    # goal card, which is never a real transaction category) still needs a row
    # here so its limit doesn't silently vanish — it'll just always compute $0 spent.
    all_primaries = list(primaries) + [c for c in limits if c not in primaries]

    result = []
    for primary in all_primaries:
        spent_row = conn.execute(
            """SELECT ABS(SUM(amount)) as total FROM transactions
               WHERE (category=? OR category IN (SELECT name FROM categories WHERE parent=?))
                 AND transaction_date >= ? AND amount < 0 AND is_transfer=0 AND is_pending=0""",
            (primary, primary, month_start)
        ).fetchone()
        spent = fmt_money(spent_row["total"] or 0)

        last_month_row = conn.execute(
            """SELECT ABS(SUM(amount)) as total FROM transactions
               WHERE (category=? OR category IN (SELECT name FROM categories WHERE parent=?))
                 AND transaction_date >= ? AND transaction_date <= ? AND amount < 0 AND is_transfer=0 AND is_pending=0""",
            (primary, primary, last_month_start, last_month_end_iso)
        ).fetchone()
        spent_last_month = fmt_money(last_month_row["total"] or 0)

        limit = limits.get(primary, 0.0)
        result.append({
            "category": primary,
            "monthly_limit": limit,
            "spent": spent,
            "spent_last_month": spent_last_month,
            "remaining": fmt_money(limit - spent),
            "pct": round(min(100, (spent / limit * 100)) if limit > 0 else 0, 1),
        })
    conn.close()
    return result

@router.post("/api/budget/commit")
async def commit_budget(request: Request):
    """Snapshot the current total category budget as y — the committed number the
    rest of the app plans against. Body may pass an explicit `value`; otherwise
    the live sum of category limits (excluding the savings goal) is committed."""
    body = await request.json()
    conn = get_db()
    if body.get("value") is not None:
        y = round(float(body["value"]), 2)
    else:
        row = conn.execute("SELECT COALESCE(SUM(monthly_limit),0) FROM budgets WHERE category!='savings'").fetchone()
        y = round(float(row[0] or 0), 2)
    set_setting(conn, "committed_budget", str(y))
    set_setting(conn, "committed_budget_at", datetime.now().isoformat())
    conn.close()
    return {"committed_budget": y}

@router.get("/api/budget/committed")
async def get_committed():
    conn = get_db()
    y = get_committed_budget(conn)
    at = get_setting(conn, "committed_budget_at")
    live = float(conn.execute("SELECT COALESCE(SUM(monthly_limit),0) FROM budgets WHERE category!='savings'").fetchone()[0])
    conn.close()
    return {"committed_budget": y, "committed_at": at, "live_total": round(live, 2)}

@router.get("/api/budgets/{primary}/breakdown")
async def budget_breakdown(primary: str, month: str = None):
    conn = get_db()
    if not month:
        month = date.today().strftime("%Y-%m")
    month_start = f"{month}-01"
    month_start_date = date.fromisoformat(month_start)
    next_month = (month_start_date.replace(day=28) + timedelta(days=4)).replace(day=1)

    if not conn.execute("SELECT 1 FROM categories WHERE name=? AND parent IS NULL", (primary,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Not a primary category")

    secondaries = [r["name"] for r in conn.execute("SELECT name FROM categories WHERE parent=?", (primary,)).fetchall()]
    rows = []
    for cat in secondaries + [primary]:
        total_row = conn.execute(
            """SELECT ABS(SUM(amount)) as total FROM transactions
               WHERE category=? AND transaction_date >= ? AND transaction_date < ?
                 AND amount < 0 AND is_transfer=0 AND is_pending=0""",
            (cat, month_start, next_month.isoformat())
        ).fetchone()
        total = fmt_money(total_row["total"] or 0)
        if total > 0:
            rows.append({"category": cat, "total": total})
    rows.sort(key=lambda r: r["total"], reverse=True)
    conn.close()
    return {"primary": primary, "month": month, "total": round(sum(r["total"] for r in rows), 2), "breakdown": rows}

@router.put("/api/budgets/{category}")
async def set_budget(category: str, request: Request):
    body = await request.json()
    limit = float(body.get("monthly_limit") or 0)
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO budgets (category, monthly_limit) VALUES (?,?)",
        (category, limit)
    )
    conn.commit()
    conn.close()
    return {"category": category, "monthly_limit": limit}

@router.delete("/api/budgets/{category}")
async def delete_budget(category: str):
    conn = get_db()
    conn.execute("DELETE FROM budgets WHERE category=?", (category,))
    conn.commit()
    conn.close()
    return {"deleted": category}

@router.get("/api/loans")
async def list_loans():
    conn = get_db()
    rows = conn.execute("SELECT * FROM loans ORDER BY name").fetchall()
    result = []
    for loan in rows:
        r = dict(loan)
        bal = float(r["current_balance"] or 0)
        rate = float(r["interest_rate"] or 0) / 100 / 12
        pmt = float(r["monthly_payment"] or 0)
        remaining = (r["total_payments"] or 0) - (r["payments_made"] or 0)
        if pmt > 0 and rate > 0 and bal > 0:
            months_left = math.ceil(-math.log(1 - rate * bal / pmt) / math.log(1 + rate)) if rate * bal < pmt else remaining
            total_interest = pmt * months_left - bal
        elif pmt > 0 and bal > 0:
            months_left = math.ceil(bal / pmt)
            total_interest = 0.0
        else:
            months_left = remaining
            total_interest = 0.0
        payoff_date = (date.today() + timedelta(days=30 * max(0, months_left))).isoformat() if months_left else None
        r["months_remaining"] = max(0, months_left) if months_left else 0
        r["total_interest_remaining"] = fmt_money(max(0, total_interest))
        r["payoff_date"] = payoff_date
        linked = conn.execute(
            "SELECT id, name, expected_amount FROM bills WHERE payment_type='Loan' AND linked_loan_id=? AND is_active=1 LIMIT 1",
            (r["id"],)
        ).fetchone()
        r["linked_bill_id"]     = linked["id"]                        if linked else None
        r["linked_bill_name"]   = linked["name"]                      if linked else None
        r["linked_bill_amount"] = fmt_money(linked["expected_amount"]) if linked else None
        result.append(r)
    conn.close()
    return result

@router.post("/api/loans")
async def create_loan(request: Request):
    body = await request.json()
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO loans (name, type, original_balance, current_balance, interest_rate, monthly_payment, payments_made, total_payments, start_date) VALUES (?,?,?,?,?,?,?,?,?)",
        (body["name"], body["type"], body.get("original_balance"), body.get("current_balance"),
         body.get("interest_rate"), body.get("monthly_payment"), body.get("payments_made", 0),
         body.get("total_payments"), body.get("start_date"))
    )
    conn.commit()
    lid = cur.lastrowid
    conn.close()
    return {"id": lid}

@router.put("/api/loans/{loan_id}")
async def update_loan(loan_id: int, request: Request):
    body = await request.json()
    conn = get_db()
    conn.execute(
        "UPDATE loans SET name=?, type=?, original_balance=?, current_balance=?, interest_rate=?, monthly_payment=?, payments_made=?, total_payments=?, start_date=? WHERE id=?",
        (body["name"], body["type"], body.get("original_balance"), body.get("current_balance"),
         body.get("interest_rate"), body.get("monthly_payment"), body.get("payments_made", 0),
         body.get("total_payments"), body.get("start_date"), loan_id)
    )
    conn.commit()
    conn.close()
    return {"updated": loan_id}

@router.delete("/api/loans/{loan_id}")
async def delete_loan(loan_id: int):
    conn = get_db()
    conn.execute("DELETE FROM loans WHERE id=?", (loan_id,))
    conn.commit()
    conn.close()
    return {"deleted": loan_id}

@router.post("/api/loans/{loan_id}/set-bill")
async def loan_set_bill(loan_id: int, request: Request):
    body = await request.json()
    amount = body.get("amount")
    name = body.get("name", "Loan Payment")
    if amount is None:
        raise HTTPException(status_code=400, detail="amount required")
    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM bills WHERE payment_type='Loan' AND linked_loan_id=? AND is_active=1 LIMIT 1",
        (loan_id,)
    ).fetchone()
    if existing:
        conn.execute("UPDATE bills SET expected_amount=? WHERE id=?", (float(amount), existing["id"]))
        conn.commit()
        conn.close()
        return {"bill_id": existing["id"], "created": False, "amount": float(amount)}
    # day_of_month was hard-coded None here, so EVERY bill created from a loan was
    # invisible to cash_flow_projection and upcoming_bills while still counting in
    # hardline_total — totals and forecast disagreed and nothing said so. Derive it
    # instead (a loan recurs on the day it started; failing that, from payment
    # history), and allow it to be passed explicitly.
    day_of_month = body.get("day_of_month") or derive_bill_day(
        conn, loan_id=loan_id, merchant_pattern=body.get("merchant_pattern") or name
    )
    cur = conn.execute(
        "INSERT INTO bills (name, expected_amount, confidence, day_of_month, account_id, payment_type, from_debt_budget, linked_loan_id, is_active) VALUES (?,?,?,?,?,?,?,?,1)",
        (name, float(amount), "fixed", day_of_month, None, "Loan", 1, loan_id)
    )
    conn.commit()
    bill_id = cur.lastrowid
    conn.close()
    return {"bill_id": bill_id, "created": True, "amount": float(amount)}

def _build_debt_account_cards(conn, types: tuple) -> list:
    accounts = conn.execute(
        f"SELECT * FROM accounts WHERE type IN ({','.join('?' * len(types))}) AND is_active=1", types
    ).fetchall()
    today = date.today()
    first_this = today.replace(day=1)
    first_last = (first_this - timedelta(days=1)).replace(day=1)
    cards = []
    for a in accounts:
        bal = get_account_balance(conn, a["id"])
        prev = conn.execute(
            "SELECT SUM(amount) as s FROM transactions WHERE account_id=? AND transaction_date >= ? AND transaction_date < ?",
            (a["id"], first_last.isoformat(), first_this.isoformat())
        ).fetchone()
        linked = conn.execute(
            "SELECT id, expected_amount, frequency, day_of_month, day_of_week FROM bills WHERE payment_type='Debt' AND linked_account_id=? AND is_active=1 LIMIT 1",
            (a["id"],)
        ).fetchone()
        cards.append({
            "id":                a["id"],
            "name":              a["nickname"] or a["name"],
            "raw_name":          a["name"],
            "nickname":          a["nickname"],
            "institution":       a["institution"],
            "balance":           abs(bal),
            "simplefin_id":      a["simplefin_id"],
            "interest_rate":     a["interest_rate"],
            "minimum_payment":   a["minimum_payment"],
            "mom_change":        fmt_money(prev["s"] or 0),
            "linked_bill_id":    linked["id"]              if linked else None,
            "linked_bill_amount": fmt_money(linked["expected_amount"]) if linked else None,
            "linked_bill_frequency":  linked["frequency"]    if linked else None,
            "linked_bill_day_of_month": linked["day_of_month"] if linked else None,
            "linked_bill_day_of_week": linked["day_of_week"]   if linked else None,
        })
    return cards

@router.get("/api/debt/summary")
async def debt_summary():
    conn = get_db()
    cards = _build_debt_account_cards(conn, ("credit",))
    synced_loans = _build_debt_account_cards(conn, ("loan", "personal_loan"))
    loans = await list_loans()
    # The reverse problem: a bill that says it's a loan/debt payment but points at
    # nothing — e.g. a real transaction-detected car payment for an account that
    # never synced via SimpleFin. Easy to miss since it just looks like a normal
    # bill; surfaced here so it doesn't silently sit outside payoff math forever.
    unlinked_debt_bills = [
        dict(b) for b in conn.execute(
            "SELECT id, name, expected_amount, day_of_month, payment_type FROM bills "
            "WHERE is_active=1 AND payment_type IN ('Loan','Debt') AND linked_loan_id IS NULL AND linked_account_id IS NULL"
        ).fetchall()
    ]
    conn.close()
    return {"credit_cards": cards, "synced_loans": synced_loans, "loans": loans, "unlinked_debt_bills": unlinked_debt_bills}

@router.post("/api/debt/set-bill")
async def debt_set_bill(request: Request):
    body = await request.json()
    account_id = body.get("account_id")
    amount = body.get("amount")
    name = body.get("name", "Debt Payment")
    frequency = body.get("frequency", "monthly")
    day_of_month = body.get("day_of_month") if frequency == "monthly" else None
    day_of_week = body.get("day_of_week") if frequency == "weekly" else None
    if not account_id or amount is None:
        raise HTTPException(status_code=400, detail="account_id and amount required")
    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM bills WHERE payment_type='Debt' AND linked_account_id=? AND is_active=1 LIMIT 1",
        (account_id,)
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE bills SET expected_amount=?, frequency=?, day_of_month=?, day_of_week=? WHERE id=?",
            (float(amount), frequency, day_of_month, day_of_week, existing["id"])
        )
        conn.commit()
        conn.close()
        return {"bill_id": existing["id"], "created": False, "amount": float(amount)}
    cur = conn.execute(
        "INSERT INTO bills (name, expected_amount, confidence, day_of_month, day_of_week, frequency, account_id, payment_type, from_debt_budget, linked_account_id, is_active) VALUES (?,?,?,?,?,?,?,?,?,?,1)",
        (name, float(amount), "fixed", day_of_month, day_of_week, frequency, None, "Debt", 1, account_id)
    )
    conn.commit()
    bill_id = cur.lastrowid
    conn.close()
    return {"bill_id": bill_id, "created": True, "amount": float(amount)}

@router.get("/api/debt/payoff-projection")
async def payoff_projection(loan_id: int = None, extra_monthly: float = 0):
    conn = get_db()
    q = "SELECT * FROM loans"
    params = []
    if loan_id:
        q += " WHERE id=?"; params.append(loan_id)
    loans_raw = conn.execute(q, params).fetchall()
    conn.close()
    results = []
    for loan in loans_raw:
        bal = float(loan["current_balance"] or 0)
        rate = float(loan["interest_rate"] or 0) / 100 / 12
        base_pmt = float(loan["monthly_payment"] or 0)
        pmt = base_pmt + extra_monthly
        if pmt <= 0 or bal <= 0:
            continue
        if rate > 0 and pmt > rate * bal:
            months = math.ceil(-math.log(1 - rate * bal / pmt) / math.log(1 + rate))
        elif rate == 0 and pmt > 0:
            months = math.ceil(bal / pmt)
        else:
            months = 999
        total_paid = pmt * months
        interest = max(0, total_paid - bal)
        payoff = (date.today() + timedelta(days=30 * months)).isoformat()
        if rate > 0 and base_pmt > rate * bal:
            base_months = math.ceil(-math.log(1 - rate * bal / base_pmt) / math.log(1 + rate))
        elif rate == 0 and base_pmt > 0:
            base_months = math.ceil(bal / base_pmt)
        else:
            base_months = 999
        base_interest = max(0, base_pmt * base_months - bal)
        results.append({
            "loan_id": loan["id"], "loan_name": loan["name"],
            "months_to_payoff": months, "payoff_date": payoff,
            "total_interest": fmt_money(interest),
            "interest_saved": fmt_money(max(0, base_interest - interest)),
            "months_saved": max(0, base_months - months),
        })
    return results

@router.put("/api/accounts/{acct_id}/debt-details")
async def update_account_debt_details(acct_id: int, request: Request):
    body = await request.json()
    conn = get_db()
    conn.execute(
        "UPDATE accounts SET interest_rate=?, minimum_payment=? WHERE id=?",
        (body.get("interest_rate"), body.get("minimum_payment"), acct_id)
    )
    conn.commit()
    conn.close()
    return {"updated": acct_id}

@router.put("/api/accounts/{acct_id}/nickname")
async def update_account_nickname(acct_id: int, request: Request):
    body = await request.json()
    nickname = (body.get("nickname") or "").strip() or None
    conn = get_db()
    conn.execute("UPDATE accounts SET nickname=? WHERE id=?", (nickname, acct_id))
    conn.commit()
    conn.close()
    return {"updated": acct_id, "nickname": nickname}

@router.put("/api/accounts/{acct_id}/type")
async def update_account_type(acct_id: int, request: Request):
    body = await request.json()
    new_type = body.get("type")
    if new_type not in ("checking", "savings", "credit", "loan", "personal_loan", "investment"):
        raise HTTPException(status_code=400, detail="Invalid account type")
    conn = get_db()
    conn.execute("UPDATE accounts SET type=? WHERE id=?", (new_type, acct_id))
    conn.commit()
    conn.close()
    return {"updated": acct_id, "type": new_type}

def _collect_debts(conn) -> list:
    """Every active debt (synced credit/loan accounts + manual loans) with the
    minimum-payment logic shared by the strategies endpoint and the dashboard
    countdown — one debt list, one set of rules."""
    # SimpleFin-synced debt accounts — credit cards and loans use identical interest/
    # balance math, so they're built the same way here regardless of which type they are.
    synced_accounts = conn.execute(
        "SELECT id, COALESCE(nickname, name) as name, type, interest_rate, minimum_payment FROM accounts WHERE type IN ('credit','loan','personal_loan') AND is_active=1"
    ).fetchall()
    debts = []
    for a in synced_accounts:
        bal = abs(get_account_balance(conn, a["id"]))
        if bal <= 0:
            continue
        rate = float(a["interest_rate"] or 0)
        is_loan = a["type"] in ("loan", "personal_loan")
        raw_min_payment = None
        min_payment_source = None
        if is_loan:
            # Loans have a fixed contractual payment. If it's already scheduled as a
            # bill, that IS the real payment being made — not an estimate, and not
            # something to re-derive from a generic percent-of-balance guess.
            linked_bill = conn.execute(
                "SELECT expected_amount FROM bills WHERE payment_type='Debt' AND linked_account_id=? AND is_active=1 LIMIT 1",
                (a["id"],)
            ).fetchone()
            if linked_bill:
                raw_min_payment = float(linked_bill["expected_amount"])
                min_payment_source = "billed"
        if raw_min_payment is None:
            entered = a["minimum_payment"] is not None and a["minimum_payment"] > 0
            raw_min_payment = float(a["minimum_payment"]) if entered else max(25, bal * 0.02)
            min_payment_source = "entered" if entered else "estimated"
        monthly_interest = round(bal * rate / 100 / 12, 2)
        # A minimum payment that doesn't even cover interest guarantees the balance grows.
        # Floor it at interest + 1% of balance so every debt makes real progress, scaled to its size,
        # even while extra payments are focused elsewhere.
        floor = round(monthly_interest + bal * 0.01, 2)
        min_payment = max(raw_min_payment, floor) if monthly_interest > 0 else raw_min_payment
        debts.append({
            "name": a["name"],
            "balance": bal,
            "rate_annual": rate,
            "min_payment": min_payment,
            "raw_min_payment": raw_min_payment,
            "monthly_interest": monthly_interest,
            "min_payment_source": min_payment_source,
            "negative_amortization": raw_min_payment <= monthly_interest and monthly_interest > 0,
            "source": "credit_card" if a["type"] == "credit" else "synced_loan",
            "account_id": a["id"],
        })
    loans = conn.execute("SELECT name, current_balance, interest_rate, monthly_payment FROM loans").fetchall()
    for l in loans:
        bal = float(l["current_balance"] or 0)
        if bal <= 0:
            continue
        rate = float(l["interest_rate"] or 0)
        raw_min_payment = float(l["monthly_payment"] or 0)
        monthly_interest = round(bal * rate / 100 / 12, 2)
        floor = round(monthly_interest + bal * 0.01, 2)
        min_payment = max(raw_min_payment, floor) if monthly_interest > 0 else raw_min_payment
        debts.append({
            "name": l["name"],
            "balance": bal,
            "rate_annual": rate,
            "min_payment": min_payment,
            "raw_min_payment": raw_min_payment,
            "monthly_interest": monthly_interest,
            "min_payment_source": "entered",
            "negative_amortization": raw_min_payment <= monthly_interest and monthly_interest > 0,
            "source": "loan",
        })
    return debts

@router.get("/api/debt/strategies")
async def debt_strategies(extra_monthly: float = 0, cards_first: bool = True):
    conn = get_db()
    debts = _collect_debts(conn)
    conn.close()
    if not debts:
        return {"debts": [], "snowball": None, "avalanche": None}
    snowball = _simulate_payoff_strategy(debts, extra_monthly, "snowball", cards_first)
    avalanche = _simulate_payoff_strategy(debts, extra_monthly, "avalanche", cards_first)
    return {
        "debts": debts,
        "snowball": snowball,
        "avalanche": avalanche,
        "interest_saved": round(snowball["total_interest"] - avalanche["total_interest"], 2),
        "months_saved": snowball["months"] - avalanche["months"],
        "extra_monthly": extra_monthly,
        "cards_first": cards_first,
    }

# ── Income review ─────────────────────────────────────────────────────────────

@router.get("/api/income/summary")
async def income_summary(months: int = 6):
    """Current month's paycheck breakdown (shared math with the dashboard) plus
    recent complete-month totals and their average — so an extra-paycheck month
    reads as 'expected: 8 checks this month' instead of looking like a bug."""
    conn = get_db()
    current = compute_month_income(conn)
    hist_rows = conn.execute(
        """SELECT strftime('%Y-%m', actual_date) as month, SUM(actual_amount) as total, COUNT(*) as checks
           FROM paychecks WHERE actual_amount IS NOT NULL AND strftime('%Y-%m', actual_date) < ?
           GROUP BY month ORDER BY month DESC LIMIT ?""",
        (current["month"], months)
    ).fetchall()
    history = [
        {"month": r["month"], "total": fmt_money(r["total"]), "checks": r["checks"]}
        for r in hist_rows
    ]
    totals = [h["total"] for h in history]
    baseline = compute_baseline_income(conn)
    conn.close()
    return {
        **current,
        **baseline,
        "history": list(reversed(history)),
        "average_monthly_income": fmt_money(sum(totals) / len(totals)) if totals else None,
        "months_in_average": len(totals),
    }

# ── Link a spending transaction to a bill ─────────────────────────────────────

@router.post("/api/bills/link-transaction")
async def link_transaction_to_bill(request: Request):
    """Connect a bank transaction to a bill — either an existing one (bill_id)
    or a new bill created from the transaction. Does three things at once:
    sets the bill's merchant_pattern (so history/creep/rolling stats match),
    adds a merchant rule mapping the pattern to the 'bill' category (so future
    syncs never count it as living spend), and recategorizes every existing
    matching transaction the same way."""
    body = await request.json()
    txn_id = body.get("transaction_id")
    if not txn_id:
        raise HTTPException(status_code=400, detail="transaction_id required")
    conn = get_db()
    txn = conn.execute("SELECT * FROM transactions WHERE id=?", (txn_id,)).fetchone()
    if not txn:
        conn.close()
        raise HTTPException(status_code=404, detail="Transaction not found")

    pattern = (body.get("pattern") or "").strip().lower() or _bill_pattern_from_desc(txn["description"] or "")
    if not pattern:
        conn.close()
        raise HTTPException(status_code=400, detail="Could not derive a merchant pattern from this transaction")

    created = False
    bill_id = body.get("bill_id")
    if bill_id:
        bill = conn.execute("SELECT id FROM bills WHERE id=?", (bill_id,)).fetchone()
        if not bill:
            conn.close()
            raise HTTPException(status_code=404, detail="Bill not found")
    else:
        txn_day = None
        try:
            txn_day = min(28, date.fromisoformat(txn["transaction_date"]).day)
        except (ValueError, TypeError):
            pass
        cur = conn.execute(
            "INSERT INTO bills (name, expected_amount, confidence, day_of_month, account_id, payment_type, from_debt_budget, is_active) VALUES (?,?,?,?,?,?,0,1)",
            (
                body.get("name") or _clean_bill_name(txn["description"] or "New Bill"),
                abs(float(txn["amount"])),
                body.get("confidence", "fixed"),
                body.get("day_of_month") or txn_day,
                txn["account_id"],
                body.get("payment_type", "Recurring"),
            )
        )
        bill_id = cur.lastrowid
        created = True

    conn.execute(
        "UPDATE bills SET merchant_pattern=?, account_id=COALESCE(account_id, ?) WHERE id=?",
        (pattern, txn["account_id"], bill_id)
    )
    conn.execute(
        "INSERT OR REPLACE INTO merchant_rules (pattern, category, created_at) VALUES (?, 'bill', ?)",
        (pattern, datetime.now().isoformat())
    )
    recat = conn.execute(
        "UPDATE transactions SET category='bill', category_confirmed=1 WHERE LOWER(description) LIKE ?",
        (f"%{pattern}%",)
    )
    conn.commit()
    recategorized = recat.rowcount
    conn.close()
    return {"bill_id": bill_id, "created": created, "pattern": pattern, "recategorized": recategorized}

# ── Transfers (Bills → Food) ──────────────────────────────────────────────────

@router.get("/api/transfers")
async def list_transfers(limit: int = 24):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM transfers ORDER BY transfer_date DESC, id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.post("/api/transfers")
async def record_transfer(request: Request):
    body = await request.json()
    amount = body.get("amount")
    if amount is None:
        raise HTTPException(status_code=400, detail="amount required")
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO transfers (transfer_date, amount, suggested_amount, notes, created_at) VALUES (?,?,?,?,?)",
        (
            body.get("transfer_date") or date.today().isoformat(),
            float(amount),
            body.get("suggested_amount"),
            body.get("notes"),
            datetime.now().isoformat(),
        )
    )
    conn.commit()
    tid = cur.lastrowid
    conn.close()
    return {"id": tid}

@router.delete("/api/transfers/{transfer_id}")
async def delete_transfer(transfer_id: int):
    conn = get_db()
    conn.execute("DELETE FROM transfers WHERE id=?", (transfer_id,))
    conn.commit()
    conn.close()
    return {"deleted": transfer_id}

# ── Bill creep ────────────────────────────────────────────────────────────────

@router.get("/api/bills/creep")
async def bill_creep():
    """Two views for expense reduction: bills whose recent actual payments drifted
    above the expected amount, and every bill ranked by true annual cost."""
    conn = get_db()
    bills = conn.execute("SELECT * FROM bills WHERE is_active=1").fetchall()
    since = (date.today() - timedelta(days=120)).isoformat()
    annual = []
    drifting = []
    for b in bills:
        monthly_eq = round(float(b["expected_amount"]) * (52 / 12), 2) if b["frequency"] == "weekly" else float(b["expected_amount"])
        annual.append({
            "id": b["id"],
            "name": b["display_name"] or b["name"],
            "monthly": fmt_money(monthly_eq),
            "annual": fmt_money(monthly_eq * 12),
            "payment_type": b["payment_type"],
        })
        # Drift detection only works for bills matched to an account by name prefix
        # (same matching the history endpoint uses), and only monthly ones.
        if not b["account_id"] or b["frequency"] == "weekly" or float(b["expected_amount"]) <= 0:
            continue
        txns = conn.execute(
            "SELECT amount, transaction_date FROM transactions WHERE account_id=? AND transaction_date >= ? AND amount < 0 AND LOWER(description) LIKE ? ORDER BY transaction_date DESC LIMIT 3",
            (b["account_id"], since, f"%{_bill_match_term(b).lower()}%")
        ).fetchall()
        if not txns:
            continue
        latest = abs(float(txns[0]["amount"]))
        expected = float(b["expected_amount"])
        if latest > expected * 1.05:
            drifting.append({
                "id": b["id"],
                "name": b["display_name"] or b["name"],
                "expected": fmt_money(expected),
                "latest": fmt_money(latest),
                "delta": fmt_money(latest - expected),
                "latest_date": txns[0]["transaction_date"],
            })
    conn.close()
    annual.sort(key=lambda x: -x["annual"])
    drifting.sort(key=lambda x: -x["delta"])
    return {"annual": annual, "annual_total": round(sum(a["annual"] for a in annual), 2), "drifting": drifting}

@router.get("/api/bills/reconcile")
async def bills_reconcile(month: str = None):
    """Two-way reconciliation for the Bills account:
    - `bills`: each active bill's paid status this month, proven by a matching
      transaction (with the ACTUAL amount + drift vs the forecast), not a guess.
    - `untied`: Bills-account payments this month tied to NO bill (the flip side —
      nothing should float; these are unset-up bills or mis-named matches).
    Transfers and pending rows are excluded. Matching uses the same term as the
    rest of the app (merchant_pattern, else name prefix)."""
    conn = get_db()
    month = month or date.today().strftime("%Y-%m")
    bills_acct = find_role_account(conn, "bills", "bills")
    if not bills_acct:
        conn.close()
        return {"month": month, "bills": [], "untied": [], "tied_count": 0, "untied_count": 0}
    active = conn.execute("SELECT * FROM bills WHERE is_active=1").fetchall()
    outs = conn.execute(
        """SELECT id, transaction_date, amount, description FROM transactions
           WHERE account_id=? AND amount < 0 AND strftime('%Y-%m', transaction_date)=?
             AND (is_transfer IS NULL OR is_transfer=0) AND (is_pending IS NULL OR is_pending=0)
           ORDER BY transaction_date""",
        (bills_acct["id"], month)
    ).fetchall()

    def matches(b, desc):
        term = _bill_match_term(b).lower().strip()
        return len(term) >= 3 and term in desc

    bills_out = []
    tied_txn_ids = set()
    for b in active:
        ms = [tx for tx in outs if matches(b, (tx["description"] or "").lower())]
        expected = float(b["expected_amount"] or 0)
        if ms:
            tied_txn_ids.update(tx["id"] for tx in ms)
            latest = ms[-1]  # rows are date-ordered ascending
            actual = abs(float(latest["amount"]))
            bills_out.append({
                "id": b["id"], "name": b["display_name"] or b["name"],
                "expected": fmt_money(expected), "paid": True, "actual": fmt_money(actual),
                "paid_date": latest["transaction_date"], "txn_id": latest["id"],
                "count": len(ms),
                "drift": fmt_money(actual - expected) if abs(actual - expected) >= 0.01 else None,
            })
        else:
            bills_out.append({
                "id": b["id"], "name": b["display_name"] or b["name"],
                "expected": fmt_money(expected), "paid": False, "actual": None,
                "paid_date": None, "txn_id": None, "count": 0, "drift": None,
            })
    untied = [
        {"id": tx["id"], "date": tx["transaction_date"],
         "amount": fmt_money(abs(float(tx["amount"]))), "description": tx["description"]}
        for tx in outs if tx["id"] not in tied_txn_ids
    ]
    conn.close()
    bills_out.sort(key=lambda x: (x["paid"], -x["expected"]))  # unpaid first, then by size
    return {"month": month, "bills": bills_out, "untied": untied,
            "tied_count": len(tied_txn_ids), "untied_count": len(untied)}

@router.put("/api/transactions/{txn_id}/transfer")
async def set_transaction_transfer(txn_id: int, request: Request):
    """Flag/unflag a transaction as an internal transfer, so it drops out of
    spending and out of the reconciliation's untied list."""
    body = await request.json()
    is_transfer = 1 if body.get("is_transfer", True) else 0
    conn = get_db()
    row = conn.execute("SELECT id FROM transactions WHERE id=?", (txn_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Transaction not found")
    conn.execute("UPDATE transactions SET is_transfer=? WHERE id=?", (is_transfer, txn_id))
    conn.commit()
    conn.close()
    return {"id": txn_id, "is_transfer": is_transfer}

# ── Month in Review ───────────────────────────────────────────────────────────

def compute_month_review(conn, month: str) -> dict:
    """All Python, no AI: the month's report card. income − obligations −
    discretionary = surplus; debt and net-worth change from snapshots."""
    month_start = f"{month}-01"
    next_month = (date.fromisoformat(month_start).replace(day=28) + timedelta(days=4)).replace(day=1).isoformat()

    income = float(conn.execute(
        "SELECT COALESCE(SUM(actual_amount), 0) FROM paychecks WHERE actual_date >= ? AND actual_date < ?",
        (month_start, next_month)
    ).fetchone()[0])

    obligations_row = conn.execute(
        """SELECT COALESCE(SUM(b.expected_amount), 0) as total, COUNT(*) as cnt
           FROM bill_paid_months pm JOIN bills b ON b.id = pm.bill_id
           WHERE pm.month = ?""", (month,)
    ).fetchone()
    obligations = float(obligations_row["total"])
    bills_paid_count = obligations_row["cnt"]
    bills_unpaid_count = conn.execute(
        "SELECT COUNT(*) FROM bills WHERE is_active=1 AND frequency='monthly' AND id NOT IN (SELECT bill_id FROM bill_paid_months WHERE month=?)",
        (month,)
    ).fetchone()[0]

    discretionary = float(conn.execute(
        """SELECT COALESCE(ABS(SUM(amount)), 0) FROM transactions
           WHERE amount < 0 AND is_transfer=0 AND is_pending=0
             AND (category IS NULL OR category NOT IN ('bill', 'debt_payment'))
             AND transaction_date >= ? AND transaction_date < ?""",
        (month_start, next_month)
    ).fetchone()[0])

    top_cats = [
        {"category": r["category"] or "uncategorized", "total": fmt_money(abs(r["t"]))}
        for r in conn.execute(
            """SELECT category, SUM(amount) as t FROM transactions
               WHERE amount < 0 AND is_transfer=0 AND is_pending=0
                 AND (category IS NULL OR category NOT IN ('bill', 'debt_payment'))
                 AND transaction_date >= ? AND transaction_date < ?
               GROUP BY category ORDER BY t LIMIT 5""",
            (month_start, next_month)
        ).fetchall()
    ]

    transfers_total = float(conn.execute(
        "SELECT COALESCE(SUM(amount), 0) FROM transfers WHERE transfer_date >= ? AND transfer_date < ?",
        (month_start, next_month)
    ).fetchone()[0])

    nw_first = conn.execute(
        "SELECT * FROM net_worth_history WHERE recorded_at < ? ORDER BY recorded_at DESC LIMIT 1",
        (month_start,)
    ).fetchone()
    nw_last = conn.execute(
        "SELECT * FROM net_worth_history WHERE recorded_at < ? ORDER BY recorded_at DESC LIMIT 1",
        (next_month,)
    ).fetchone()
    debt_change = net_worth_change = None
    if nw_first and nw_last and nw_first["id"] != nw_last["id"]:
        debt_change = fmt_money(float(nw_last["liabilities"]) - float(nw_first["liabilities"]))
        net_worth_change = fmt_money(float(nw_last["net_worth"]) - float(nw_first["net_worth"]))

    baseline = compute_baseline_income(conn)["baseline_income"]
    return {
        "month": month,
        "income": fmt_money(income),
        "baseline_income": baseline,
        "income_vs_baseline": fmt_money(income - baseline),
        "obligations": fmt_money(obligations),
        "bills_paid_count": bills_paid_count,
        "bills_unpaid_count": bills_unpaid_count,
        "discretionary": fmt_money(discretionary),
        "surplus": fmt_money(income - obligations - discretionary),
        "transfers_total": fmt_money(transfers_total),
        "top_categories": top_cats,
        "debt_change": debt_change,
        "net_worth_change": net_worth_change,
    }

@router.get("/api/reports")
async def list_reports(limit: int = 12):
    conn = get_db()
    rows = conn.execute(
        "SELECT month, data, created_at FROM monthly_reports ORDER BY month DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [{"month": r["month"], "created_at": r["created_at"], **json.loads(r["data"])} for r in rows]

@router.post("/api/reports/generate")
async def generate_report(request: Request):
    body = await request.json()
    month = body.get("month")
    if not month:
        # Default: the month that just ended
        first_this = date.today().replace(day=1)
        month = (first_this - timedelta(days=1)).strftime("%Y-%m")
    conn = get_db()
    data = compute_month_review(conn, month)
    conn.execute(
        "INSERT OR REPLACE INTO monthly_reports (month, data, created_at) VALUES (?,?,?)",
        (month, json.dumps(data), datetime.now().isoformat())
    )
    conn.commit()
    conn.close()
    return data

@router.get("/api/spending/summary")
async def spending_summary(days: int = 30, account_id: int = None):
    conn = get_db()
    since = (date.today() - timedelta(days=days)).isoformat()
    q = "SELECT category, SUM(amount) as total, COUNT(*) as count FROM transactions WHERE transaction_date >= ? AND amount < 0 AND is_pending=0 AND is_transfer=0"
    params = [since]
    if account_id:
        q += " AND account_id=?"; params.append(account_id)
    q += " GROUP BY category ORDER BY total"
    rows = conn.execute(q, params).fetchall()
    monthly_params = [since]
    monthly_q = "SELECT strftime('%Y-%m', transaction_date) as month, category, SUM(amount) as total FROM transactions WHERE transaction_date >= ? AND amount < 0 AND is_pending=0 AND is_transfer=0"
    if account_id:
        monthly_q += " AND account_id=?"; monthly_params.append(account_id)
    monthly_q += " GROUP BY month, category ORDER BY month"
    monthly = conn.execute(monthly_q, monthly_params).fetchall()
    inc_params = [since]
    inc_q = "SELECT strftime('%Y-%m', transaction_date) as month, SUM(amount) as total FROM transactions WHERE transaction_date >= ? AND amount > 0 AND is_pending=0"
    if account_id:
        inc_q += " AND account_id=?"; inc_params.append(account_id)
    inc_q += " GROUP BY month ORDER BY month"
    income_monthly = conn.execute(inc_q, inc_params).fetchall()

    # Uncategorized count/total — deliberately unscoped by days/account_id. This
    # powers the "needs review" banner, which should never let something slip by
    # unnoticed just because it's outside whatever date range happens to be selected.
    uncat_row = conn.execute(
        "SELECT COUNT(*) as c, ABS(SUM(amount)) as t FROM transactions WHERE category IS NULL AND amount < 0 AND is_transfer=0 AND is_pending=0"
    ).fetchone()
    conn.close()
    return {
        "by_category": [{"category": r["category"], "total": abs(fmt_money(r["total"])), "count": r["count"]} for r in rows],
        "monthly": [{"month": r["month"], "category": r["category"], "total": abs(fmt_money(r["total"]))} for r in monthly],
        "income_by_month": [{"month": r["month"], "total": fmt_money(r["total"])} for r in income_monthly],
        "days": days,
        "uncategorized_count": uncat_row["c"] or 0,
        "uncategorized_total": fmt_money(uncat_row["t"] or 0),
    }

@router.get("/api/spending/transactions")
async def spending_transactions(days: int = 30, account_id: int = None, limit: int = 200, category: str = None, merchant_key: str = None, search: str = None, uncategorized: bool = False):
    conn = get_db()
    q = "SELECT t.*, a.name as account_name FROM transactions t JOIN accounts a ON t.account_id=a.id WHERE t.amount < 0 AND t.is_pending=0 AND t.is_transfer=0"
    params = []
    if uncategorized:
        # Review-everything mode: ignore the date window entirely, same reasoning
        # as the banner count — nothing uncategorized should hide behind a date filter.
        q += " AND t.category IS NULL"
    else:
        since = (date.today() - timedelta(days=days)).isoformat()
        q += " AND t.transaction_date >= ?"; params.append(since)
        if category:
            q += " AND (t.category=? OR t.category IN (SELECT name FROM categories WHERE parent=?))"; params.extend([category, category])
    if account_id:
        q += " AND t.account_id=?"; params.append(account_id)
    if merchant_key:
        q += " AND LOWER(t.description) LIKE ?"; params.append(f"%{merchant_key.lower()}%")
    if search:
        q += " AND LOWER(t.description) LIKE ?"; params.append(f"%{search.lower()}%")
    q += " ORDER BY t.transaction_date DESC LIMIT ?"; params.append(limit if not uncategorized else max(limit, 500))
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.post("/api/transactions/dedup-pending")
async def dedup_pending_transactions():
    """Delete 'PENDING'-description transactions that have a matching settled transaction
    (same account_id, same amount) within a 5-day window.
    Handles banks (like USAA via SimpleFin) that return both the pending authorization
    and the final settled charge as is_pending=0, with 'PENDING' only in the description."""
    conn = get_db()
    # Find txns with PENDING in description where a cleaner settled txn exists
    dupes = conn.execute("""
        SELECT p.id, p.description, p.transaction_date, p.amount
        FROM transactions p
        WHERE UPPER(p.description) LIKE '%PENDING%'
          AND EXISTS (
            SELECT 1 FROM transactions s
            WHERE s.account_id = p.account_id
              AND s.amount = p.amount
              AND UPPER(s.description) NOT LIKE '%PENDING%'
              AND ABS(julianday(s.transaction_date) - julianday(p.transaction_date)) <= 5
          )
    """).fetchall()
    ids = [r["id"] for r in dupes]
    if ids:
        conn.execute(f"DELETE FROM transactions WHERE id IN ({','.join('?'*len(ids))})", ids)
        conn.commit()
    conn.close()
    return {"deleted": len(ids)}

@router.get("/api/bills/history")
async def bill_history():
    conn = get_db()
    bills = conn.execute("SELECT * FROM bills WHERE is_active=1").fetchall()
    since = (date.today() - timedelta(days=180)).isoformat()
    result = []
    for b in bills:
        if not b["account_id"]:
            continue
        txns = conn.execute(
            "SELECT * FROM transactions WHERE account_id=? AND transaction_date >= ? AND LOWER(description) LIKE ? ORDER BY transaction_date DESC LIMIT 6",
            (b["account_id"], since, f"%{_bill_match_term(b).lower()}%")
        ).fetchall()
        result.append({"bill": dict(b), "history": [{"date": t["transaction_date"], "amount": abs(fmt_money(t["amount"]))} for t in txns]})
    conn.close()
    return result

@router.get("/api/paychecks/upcoming")
async def upcoming_paychecks():
    conn = get_db()
    result = []
    for m in get_household(conn):
        person = m["key"]
        info = detect_next_payday(conn, person)
        next_d = date.fromisoformat(info["next_date"])
        interval = timedelta(weeks=info.get("interval_weeks", 2))
        result.append({"person": person, "expected_date": next_d.isoformat(), "estimated_amount": info["expected_amount"]})
        result.append({"person": person, "expected_date": (next_d + interval).isoformat(), "estimated_amount": info["expected_amount"]})
    conn.close()
    return {"upcoming": result}

@router.get("/api/paychecks")
async def list_paychecks():
    conn = get_db()
    rows = conn.execute("SELECT * FROM paychecks ORDER BY actual_date DESC LIMIT 50").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.post("/api/paychecks")
async def log_paycheck(request: Request):
    body = await request.json()
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO paychecks (person, expected_amount, actual_amount, expected_date, actual_date, is_third_friday_period, notes) VALUES (?,?,?,?,?,?,?)",
        (body["person"], body.get("expected_amount"), body.get("actual_amount"),
         body.get("expected_date"), body.get("actual_date"),
         body.get("is_third_friday_period", 0), body.get("notes"))
    )
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return {"id": pid}

@router.put("/api/paychecks/{paycheck_id}")
async def update_paycheck(paycheck_id: int, request: Request):
    body = await request.json()
    conn = get_db()
    fields = []
    params = []
    if "person" in body:
        fields.append("person=?"); params.append(body["person"])
    if "expected_amount" in body:
        fields.append("expected_amount=?"); params.append(body["expected_amount"])
    if "actual_amount" in body:
        fields.append("actual_amount=?"); params.append(body["actual_amount"])
    if "notes" in body:
        fields.append("notes=?"); params.append(body["notes"])
    if not fields:
        conn.close()
        return {"updated": 0}
    params.append(paycheck_id)
    conn.execute(f"UPDATE paychecks SET {', '.join(fields)} WHERE id=?", params)
    conn.commit()
    conn.close()
    return {"updated": paycheck_id}

@router.get("/api/settings")
async def get_settings():
    conn = get_db()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    d = {r["key"]: r["value"] for r in rows}
    d.pop("simplefin_access_url", None)
    d.pop("jwt_secret", None)
    d["has_simplefin"] = str(bool(next((r for r in rows if r["key"] == "simplefin_access_url"), None)))
    return d

@router.put("/api/settings/{key}")
async def update_setting(key: str, request: Request):
    if key in ("jwt_secret", "simplefin_access_url"):
        raise HTTPException(status_code=403, detail="Cannot update this key via settings endpoint")
    body = await request.json()
    conn = get_db()
    set_setting(conn, key, str(body.get("value", "")))
    conn.close()
    return {"updated": key}

@router.get("/api/tmrs")
async def get_tmrs():
    conn = get_db()
    numeric_fields = {
        "account_balance":    "tmrs_account_balance",
        "your_contributions": "tmrs_your_contributions",
        "interest":           "tmrs_interest",
        "city_contributions": "tmrs_city_contributions",
        "monthly_deposit":    "tmrs_monthly_deposit",
    }
    string_fields = {
        "retirement_eligible_date": "tmrs_retirement_eligible_date",
    }
    result = {}
    for field, key in numeric_fields.items():
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        result[field] = float(row["value"]) if row else None
    for field, key in string_fields.items():
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        result[field] = row["value"] if row else None
    conn.close()
    return result

@router.put("/api/tmrs")
async def update_tmrs(request: Request):
    body = await request.json()
    all_fields = {
        "account_balance":          "tmrs_account_balance",
        "your_contributions":       "tmrs_your_contributions",
        "interest":                 "tmrs_interest",
        "city_contributions":       "tmrs_city_contributions",
        "monthly_deposit":          "tmrs_monthly_deposit",
        "retirement_eligible_date": "tmrs_retirement_eligible_date",
    }
    conn = get_db()
    updated = []
    for field, key in all_fields.items():
        if field in body and body[field] is not None:
            set_setting(conn, key, str(body[field]))
            updated.append(field)
    conn.close()
    return {"updated": updated}

@router.post("/api/simplefin/setup")
async def simplefin_setup(request: Request):
    body = await request.json()
    token = body.get("token", "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token required")
    import base64
    try:
        setup_url = base64.b64decode(token).decode("utf-8")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid token format")
    try:
        async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
            r = await client.post(setup_url)
            r.raise_for_status()
            access_url = r.text.strip()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SimpleFin claim failed: {e}")
    conn = get_db()
    set_setting(conn, "simplefin_access_url", access_url)
    conn.close()
    return {"status": "ok", "message": "SimpleFin connected successfully"}

@router.get("/api/spending/top-merchants")
async def top_merchants(days: int = 30, account_id: int = None, limit: int = 15):
    conn = get_db()
    since = (date.today() - timedelta(days=days)).isoformat()
    q = "SELECT description, SUM(amount) as total, COUNT(*) as cnt FROM transactions WHERE transaction_date >= ? AND amount < 0 AND is_pending=0 AND is_transfer=0"
    params = [since]
    if account_id:
        q += " AND account_id=?"; params.append(account_id)
    q += " GROUP BY description ORDER BY total LIMIT 200"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    # Normalize + group merchant names
    from collections import defaultdict
    grouped = defaultdict(lambda: {"total": 0, "count": 0})
    for r in rows:
        key = _normalize_merchant(r["description"] or "")[:20]
        if not key:
            key = "other"
        display = _clean_bill_name(r["description"] or "Unknown")[:30]
        grouped[key]["total"] += abs(float(r["total"]))
        grouped[key]["count"] += r["cnt"]
        grouped[key].setdefault("display", display)
    result = sorted(grouped.values(), key=lambda x: -x["total"])[:limit]
    for m in result:
        m["total"] = fmt_money(m["total"])
    return result

@router.get("/api/spending/merchants-by-category")
async def merchants_by_category(category: str, days: int = 30, account_id: int = None):
    conn = get_db()
    since = (date.today() - timedelta(days=days)).isoformat()
    q = "SELECT description, SUM(amount) as total, COUNT(*) as cnt FROM transactions WHERE transaction_date >= ? AND amount < 0 AND is_pending=0 AND is_transfer=0 AND category=?"
    params = [since, category]
    if account_id:
        q += " AND account_id=?"; params.append(account_id)
    q += " GROUP BY description ORDER BY total LIMIT 100"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    from collections import defaultdict
    grouped = defaultdict(lambda: {"total": 0, "count": 0})
    for r in rows:
        key = _normalize_merchant(r["description"] or "")[:20]
        if not key:
            key = "other"
        display = _clean_bill_name(r["description"] or "Unknown")[:30]
        grouped[key]["total"] += abs(float(r["total"]))
        grouped[key]["count"] += r["cnt"]
        grouped[key].setdefault("display", display)
        grouped[key]["key"] = key
    result = sorted(grouped.values(), key=lambda x: -x["total"])[:8]
    for m in result:
        m["total"] = fmt_money(m["total"])
    return result

@router.post("/api/simplefin/reset")
async def simplefin_reset():
    conn = get_db()
    conn.execute("DELETE FROM settings WHERE key='simplefin_access_url'")
    conn.commit()
    conn.close()
    return {"status": "ok", "message": "SimpleFin disconnected — paste a new setup token to reconnect"}
@router.post("/api/sync")
async def manual_sync():
    from sync import run_sync
    try:
        result = await run_sync()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/sync/log")
async def sync_log():
    conn = get_db()
    rows = conn.execute("SELECT * FROM sync_log ORDER BY synced_at DESC LIMIT 20").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.post("/api/import/csv")
async def import_csv(account_id: int, file: UploadFile = File(...)):
    conn = get_db()
    acct = conn.execute("SELECT id FROM accounts WHERE id=?", (account_id,)).fetchone()
    if not acct:
        conn.close()
        raise HTTPException(status_code=404, detail="Account not found")

    content = await file.read()
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    headers = [h.strip() for h in (reader.fieldnames or [])]
    header_set = {h.lower() for h in headers}

    if "original description" in header_set and "date" in header_set:
        fmt = "usaa"
    elif "transaction date" in header_set and "post date" in header_set:
        fmt = "chase"
    else:
        conn.close()
        raise HTTPException(status_code=400, detail=(
            f"Unrecognized CSV format. Found headers: {headers}. "
            f"Expected USAA (Date, Description, Original Description, Category, Amount, Balance) "
            f"or Chase (Transaction Date, Post Date, Description, Category, Type, Amount, Memo). "
            f"Check that the file is a raw export from one of those banks."
        ))

    imported = skipped = 0
    errors = []
    debug_skipped = []
    now = datetime.now().isoformat()
    # Count-aware dedup. Matching on the exact description alone let every row
    # SimpleFin had already delivered come back in as a duplicate, because the
    # bank's CSV text never equals SimpleFin's ("Tle at Lake Geor Payment" vs
    # "TLE at Lake Geor PAYMENT ***1303") — one import added 35 phantom rows to
    # the Bills account. Matching on amount+date alone would go too far the other
    # way and silently drop a second, genuine same-priced purchase on the same day.
    # So: count how many rows the DB ALREADY holds for each (date, amount), and
    # treat only that many CSV rows as already-present. The (N+1)th is real and
    # gets inserted. Exact date on purpose — every duplicate observed shared its
    # date, and widening to ±1 day would start eating real repeat purchases.
    existing_counts = {}
    matched_counts = {}

    for row in reader:
        try:
            if fmt == "usaa":
                raw_date = row.get("Date", "").strip()
                desc = (row.get("Description") or row.get("Original Description") or "").strip()
                amount_str = row.get("Amount", "0").strip()
                is_pending = 1 if row.get("Status", "").strip().lower() == "pending" else 0
            else:
                raw_date = row.get("Transaction Date", "").strip()
                desc = row.get("Description", "").strip()
                amount_str = row.get("Amount", "0").strip()
                is_pending = 0

            if not raw_date or not desc:
                continue

            txn_date = None
            for date_fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
                try:
                    txn_date = datetime.strptime(raw_date, date_fmt).date().isoformat()
                    break
                except ValueError:
                    continue
            if not txn_date:
                continue

            amount = float(amount_str.replace(",", "").replace("$", ""))

            key = (txn_date, amount)
            if key not in existing_counts:
                existing_counts[key] = conn.execute(
                    "SELECT COUNT(*) FROM transactions WHERE account_id=? AND transaction_date=? AND amount=?",
                    (account_id, txn_date, amount)
                ).fetchone()[0]
            already = matched_counts.get(key, 0)
            if already < existing_counts[key]:
                matched_counts[key] = already + 1
                skipped += 1
                if len(debug_skipped) < 20:
                    debug_skipped.append(
                        f"ALREADY_HAVE {already + 1}/{existing_counts[key]} | {txn_date} | {amount} | desc={repr(desc[:60])}"
                    )
                continue

            # Always use keyword-based categorizer — USAA category names don't match internal categories
            cat, cat_confirmed = auto_category_with_rules(conn, desc)

            conn.execute(
                "INSERT INTO transactions (account_id, amount, description, category, transaction_date, is_pending, category_confirmed, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (account_id, amount, desc, cat, txn_date, is_pending, cat_confirmed, now)
            )
            imported += 1
        except Exception as e:
            skipped += 1
            errors.append(f"row {imported+skipped}: {type(e).__name__}: {e}")
            continue

    conn.commit()
    conn.close()
    return {"imported": imported, "skipped": skipped, "format": fmt, "errors": errors[:10], "debug_skipped": debug_skipped}

@router.post("/api/net-worth/snapshot")
async def record_net_worth():
    conn = get_db()
    accounts = conn.execute("SELECT * FROM accounts WHERE is_active=1").fetchall()
    assets = liabilities = 0.0
    for a in accounts:
        bal = get_account_balance(conn, a["id"])
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
    return {"net_worth": fmt_money(nw), "assets": fmt_money(assets), "liabilities": fmt_money(liabilities)}

@router.get("/api/ai/briefing")
async def get_ai_briefing():
    conn = get_db()
    row = conn.execute("SELECT * FROM ai_briefings ORDER BY briefing_date DESC LIMIT 1").fetchone()
    conn.close()
    return dict(row) if row else {}

@router.post("/api/ai/briefing/generate")
async def trigger_ai_briefing():
    from sync import generate_coach_briefing
    try:
        return await generate_coach_briefing()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Briefing failed: {e}")

@router.get("/api/ai/context")
async def ai_context(days: int = 90, txn_limit: int = 150):
    # Feature 5 — wider context: default to 90 days / 150 transactions (was a hard
    # 30) so the assistant can reason over month-over-month trends instead of a
    # thin recent slice. Clamped so a bad query can't blow the model's context.
    days = max(1, min(days, 365))
    txn_limit = max(1, min(txn_limit, 500))
    conn = get_db()
    today = date.today()
    since = (today - timedelta(days=days)).isoformat()
    accounts = conn.execute("SELECT * FROM accounts WHERE is_active=1").fetchall()
    balances = {a["name"]: get_account_balance(conn, a["id"]) for a in accounts}
    txns = conn.execute(
        """SELECT transaction_date, amount, description, category
           FROM transactions WHERE transaction_date >= ? AND is_transfer=0
           ORDER BY transaction_date DESC LIMIT ?""",
        (since, txn_limit)
    ).fetchall()
    bills = conn.execute(
        "SELECT name, expected_amount, day_of_month, bill_type FROM bills WHERE is_active=1"
    ).fetchall()
    loans = conn.execute("SELECT name, current_balance, interest_rate FROM loans").fetchall()

    # Pre-calculate spendable balance so the AI doesn't have to derive it from raw numbers
    checking_balance = sum(
        get_account_balance(conn, a["id"]) for a in accounts
        if a["type"] in ("checking", "savings")
    )
    # Soonest payday across the whole household, not any one hardcoded member
    _pays = [detect_next_payday(conn, m["key"]) for m in get_household(conn)]
    next_pay = min(_pays, key=lambda p: p["next_date"]) if _pays else {"next_date": None}
    next_pay_date = date.fromisoformat(next_pay["next_date"]) if next_pay["next_date"] else None
    bills_before_pay = sum(
        float(b["expected_amount"]) for b in bills
        if b["day_of_month"] and next_pay_date and
        next_bill_date(b["day_of_month"]) <= next_pay_date
    )
    safe_buffer = float(get_setting(conn, "safe_spend_buffer", "200") or 200)
    safe_to_spend = round(checking_balance - bills_before_pay - safe_buffer, 2)

    conn.close()
    return {
        "balances": balances,
        "safe_to_spend": safe_to_spend,
        "safe_to_spend_note": f"checking/savings total ${checking_balance:.2f} minus ${bills_before_pay:.2f} in bills due before next paycheck minus ${safe_buffer:.2f} buffer",
        "transactions": [dict(t) for t in txns],
        "bills": [dict(b) for b in bills],
        "debt": [dict(l) for l in loans],
        "generated_at": today.isoformat(),
    }

# ── AI Memory endpoints ───────────────────────────────────────────────────────

@router.get("/api/ai/memory")
async def get_ai_memory():
    conn = get_db()
    facts = conn.execute(
        "SELECT * FROM ai_facts ORDER BY last_confirmed_at DESC"
    ).fetchall()
    sessions = conn.execute(
        "SELECT id, started_at, ended_at, message_count, summary FROM ai_sessions ORDER BY ended_at DESC LIMIT 3"
    ).fetchall()
    conn.close()
    return {
        "facts": [dict(f) for f in facts],
        "recent_sessions": [dict(s) for s in sessions],
    }

@router.post("/api/ai/memory/session")
async def save_ai_session(request: Request):
    body = await request.json()
    now = datetime.now().isoformat()
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO ai_sessions (started_at, ended_at, message_count, summary, transcript) VALUES (?,?,?,?,?)",
        (
            body.get("started_at", now),
            body.get("ended_at", now),
            body.get("message_count", 0),
            body.get("summary", ""),
            json.dumps(body.get("transcript", [])),
        )
    )
    session_id = cur.lastrowid

    for fact_obj in body.get("facts", []):
        fact_text = fact_obj.get("fact", "").strip()
        category = fact_obj.get("category", "general")
        if not fact_text:
            continue
        existing = conn.execute(
            "SELECT id FROM ai_facts WHERE fact=?", (fact_text,)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE ai_facts SET last_confirmed_at=?, source_session_id=? WHERE id=?",
                (now, session_id, existing["id"])
            )
        else:
            conn.execute(
                "INSERT INTO ai_facts (fact, category, created_at, last_confirmed_at, source_session_id) VALUES (?,?,?,?,?)",
                (fact_text, category, now, now, session_id)
            )

    conn.commit()
    conn.close()
    return {"session_id": session_id}

@router.get("/api/ai/memory/sessions")
async def list_ai_sessions(limit: int = 20, offset: int = 0):
    conn = get_db()
    rows = conn.execute(
        "SELECT id, started_at, ended_at, message_count, summary FROM ai_sessions ORDER BY ended_at DESC LIMIT ? OFFSET ?",
        (limit, offset)
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) as c FROM ai_sessions").fetchone()["c"]
    conn.close()
    return {"sessions": [dict(r) for r in rows], "total": total}

@router.get("/api/ai/memory/sessions/{session_id}/transcript")
async def get_session_transcript(session_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM ai_sessions WHERE id=?", (session_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    return {**dict(row), "transcript": json.loads(row["transcript"] or "[]")}

@router.put("/api/ai/memory/facts/{fact_id}")
async def update_ai_fact(fact_id: int, request: Request):
    body = await request.json()
    conn = get_db()
    now = datetime.now().isoformat()
    conn.execute(
        "UPDATE ai_facts SET fact=?, category=?, last_confirmed_at=? WHERE id=?",
        (body["fact"], body.get("category", "general"), now, fact_id)
    )
    conn.commit()
    conn.close()
    return {"updated": fact_id}

@router.delete("/api/ai/memory/facts/{fact_id}")
async def delete_ai_fact(fact_id: int):
    conn = get_db()
    conn.execute("DELETE FROM ai_facts WHERE id=?", (fact_id,))
    conn.commit()
    conn.close()
    return {"deleted": fact_id}

@router.delete("/api/ai/memory/facts")
async def clear_all_facts():
    conn = get_db()
    conn.execute("DELETE FROM ai_facts")
    conn.commit()
    conn.close()
    return {"cleared": True}

@router.delete("/api/ai/memory/sessions")
async def clear_all_sessions():
    conn = get_db()
    conn.execute("DELETE FROM ai_sessions")
    conn.commit()
    conn.close()
    return {"cleared": True}

# ── Mount protected router ────────────────────────────────────────────────────

app.include_router(router)
