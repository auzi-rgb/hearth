/**
 * Budget.jsx — Hearth Budget Tab
 *
 * ARCHITECTURAL PRINCIPLE:
 * Fixed expenses are ALWAYS read from the bills DB via GET /api/bills.
 * This component NEVER hardcodes or duplicates bill amounts.
 * Any bill change in the Bills tab is automatically reflected here.
 * // Source of truth: bills DB
 *
 * Category list is ALWAYS read from GET /api/categories. Categories are now
 * two-level: a primary (food, shopping, bill, ...) that gets its own budget
 * card, and secondaries underneath it (food has heb, fast_food, coffee, ...)
 * that roll up into the primary's total — "one budget for food, no matter
 * where it was spent." This component only ever renders primaries as cards;
 * secondaries show up in the click-to-expand breakdown on each card.
 *
 * Flexible category budgets use localStorage as primary storage so cards
 * always render immediately, even when /api/budgets returns empty.
 * The DB is kept in sync as a secondary store.
 *
 * Income is ALWAYS read via getBaselineIncome() from lib/dashboardFields — the
 * NORMAL-month figure, so budget math is identical every month. Extra-paycheck
 * months inflate the calendar total; that extra is handled by the Dashboard's
 * cash-flow simulation, never by the budget. Never read a dashboard field by
 * name directly — that's exactly how this page and the Dashboard ended up
 * disagreeing about "Monthly Income" for a while.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { getMonthlyIncome, getBaselineIncome } from '../lib/dashboardFields'
import Portal from '../components/Portal'

const API = '/hearth/api'

// ── Constants ─────────────────────────────────────────────────────────────────

// "savings" isn't a transaction category — transfers to savings are excluded
// from spending by design — so it's kept as a standing goal/target card rather
// than a real category. It always shows $0 spent, which is correct for a goal.
const GOAL_CATEGORIES = [{ name: 'savings', emoji: '💰' }]

// Emoji lookup for primaries, secondaries, and the goal category above
const CAT_EMOJI = {
  food: '🛒', fast_food: '🍔', coffee: '☕', restaurants: '🍽️', heb: '🛒', uber: '🚗',
  entertainment: '🎬', movies: '🎬', books_magazines: '📚', bars: '🍺',
  gas: '⛽',
  transportation: '🚙', auto_repairs: '🔧',
  shopping: '🛍️', clothing: '👕', sporting_goods: '⚽', gifts: '🎁',
  savings: '💰',
  household: '🏠', home_improvement: '🛠️', health_personal_care: '💊', office_subscriptions: '🖨️', pets: '🐾',
  other: '📦',
  bill: '📄', family_purchase: '👨‍👩‍👧', debt_payment: '💳',
}
export function catEmoji(name) {
  return CAT_EMOJI[(name || '').toLowerCase()] || '📦'
}

// localStorage helpers
const LS_PREFIX = 'hearth_budget_limit_'
function getLSLimit(cat) {
  const v = localStorage.getItem(LS_PREFIX + cat)
  return v !== null ? parseFloat(v) : 0
}
function setLSLimit(cat, v) {
  localStorage.setItem(LS_PREFIX + cat, String(v))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function money(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `-$${s}` : `$${s}`
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth <= 768)
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth <= 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return mobile
}

function ordinal(n) {
  if (!n) return '—'
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children, style }) {
  return <div className="apple-label" style={{ marginBottom: 10, ...style }}>{children}</div>
}

// Animated pill progress bar
function ProgressBar({ pct, style }) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setWidth(Math.min(100, pct)), 80)
    return () => clearTimeout(t)
  }, [pct])
  const color = pct >= 90 ? 'var(--red)' : pct >= 75 ? 'var(--orange)' : 'var(--accent)'
  return (
    <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--bg-subtle)', overflow: 'hidden', ...style }}>
      <div style={{
        height: '100%', borderRadius: 'var(--radius-pill)',
        background: color, width: `${width}%`,
        transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
      }} />
    </div>
  )
}

// Auto-dismiss toast
function Toast({ message, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4500)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <Portal>
    <div style={{
      position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '14px 20px',
      boxShadow: 'var(--shadow-card-hover)',
      fontSize: 13, color: 'var(--text-primary)',
      zIndex: 500, maxWidth: 380, textAlign: 'center',
      animation: 'page-in 0.2s ease forwards', whiteSpace: 'pre-line',
    }}>
      {message}
      <button onClick={onDismiss} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--text-tertiary)', marginLeft: 12, fontSize: 16,
      }}>✕</button>
    </div>
    </Portal>
  )
}

// ── Income summary (inline, no card) ─────────────────────────────────────────

const Sep = () => (
  <div style={{ width: 1, height: 28, background: 'var(--border)', margin: '0 16px', flexShrink: 0 }} />
)

function IncomeSummary({ income, actualIncome, fixedTotal, contribTotal, savingsTotal, allocatedTotal, onSuggest }) {
  const availableToBudget = income - fixedTotal - contribTotal - savingsTotal
  const surplus = availableToBudget - allocatedTotal
  const over = surplus < 0
  // Meaningful gap between this month's actual paychecks and the baseline —
  // shown as a note, never mixed into the budget math.
  const extraThisMonth = actualIncome > income + 50 ? actualIncome - income : null

  const Chip = ({ label, value, color }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color: color || 'var(--text-primary)', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)',
      padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
      <Chip label="Baseline Income" value={money(income)} />
      {extraThisMonth && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginLeft: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>this month actual</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-text)', whiteSpace: 'nowrap' }}
            title="Extra-paycheck month — the extra is handled by the Dashboard's safe-to-transfer cash flow, not the budget">
            {money(actualIncome)} (+{money(extraThisMonth)} → cash flow)
          </span>
        </div>
      )}
      <Sep />
      <Chip label="Bills + Debt" value={`− ${money(fixedTotal)}`} color="var(--text-secondary)" />
      <Sep />
      {contribTotal > 0 && (
        <>
          <Chip label="Contributions" value={`− ${money(contribTotal)}`} color="#10B981" />
          <Sep />
        </>
      )}
      {savingsTotal > 0 && (
        <>
          <Chip label="Savings Goal" value={`− ${money(savingsTotal)}`} color="var(--text-secondary)" />
          <Sep />
        </>
      )}
      <Chip label="Available" value={money(Math.max(0, availableToBudget))}
        color={availableToBudget < 0 ? 'var(--red)' : 'var(--text-primary)'} />
      <Sep />
      <Chip label="Budgeted" value={`− ${money(allocatedTotal)}`} color="var(--text-secondary)" />
      <Sep />
      <Chip label={over ? 'Over Budget' : 'Surplus to Debt'}
        value={over ? `− ${money(Math.abs(surplus))}` : money(surplus)}
        color={over ? 'var(--red)' : 'var(--accent-text)'} />
      <div style={{ marginLeft: 'auto', paddingLeft: 16 }}>
        <button onClick={onSuggest} className="apple-btn-secondary"
          style={{ fontSize: 11, padding: '4px 12px', minHeight: 28 }}>
          Suggest 50/30/20
        </button>
      </div>
    </div>
  )
}


// ── Category Card ─────────────────────────────────────────────────────────────

function CategoryCard({ name, emoji, limit, spent, lastMonthSpent, hasSecondaries, expandedState, onToggleExpand, onLimitChange, onRemove, allCategories, onTxnRecategorized }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [recatTxnId, setRecatTxnId] = useState(null)
  const inputRef = useRef(null)

  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0
  const remaining = limit - spent
  const textColor = pct >= 90 ? 'var(--red)' : pct >= 75 ? 'var(--orange)' : 'var(--accent-text)'

  function startEdit() {
    setDraft(limit > 0 ? limit.toFixed(0) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 30)
  }
  function commitEdit() {
    const v = parseFloat(draft)
    onLimitChange(name, isNaN(v) || v < 0 ? 0 : v)
    setEditing(false)
  }

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '16px 18px' }}>
      {/* Title row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}
          onClick={() => onToggleExpand(name)}
        >
          <span style={{ fontSize: 24, lineHeight: 1 }}>{emoji}</span>
          <div style={{ fontSize: 15, fontWeight: 600, textTransform: 'capitalize' }}>
            {name.replace(/_/g, ' ')}
          </div>
          <span style={{
            fontSize: 11, color: 'var(--text-tertiary)',
            transform: expandedState ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s',
          }}>▼</span>
        </div>
        {onRemove && (
          <button onClick={() => onRemove(name)} title="Remove"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 18, padding: 4, minWidth: 36, minHeight: 36, lineHeight: 1 }}>
            ×
          </button>
        )}
      </div>

      {/* Budget amount row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Budget</span>
        {editing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>$</span>
            <input
              ref={inputRef}
              type="number"
              step="1"
              min="0"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
              className="apple-input"
              style={{ fontSize: 16, fontWeight: 700, padding: '4px 8px', width: 90, textAlign: 'right' }}
            />
          </div>
        ) : (
          <button onClick={startEdit} title="Tap to set budget" style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px',
            fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em',
            color: limit > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums', fontFamily: 'inherit',
            borderRadius: 8, minHeight: 36,
            textDecoration: limit === 0 ? 'underline dotted' : 'none',
          }}>
            {limit > 0 ? money(limit) : 'Tap to set'}
          </button>
        )}
      </div>

      {/* Progress bar */}
      <ProgressBar pct={pct} style={{ marginBottom: 10 }} />

      {/* Spent / remaining row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {money(spent)} spent
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: limit > 0 ? textColor : 'var(--text-tertiary)' }}>
          {limit > 0
            ? (remaining >= 0 ? `${money(remaining)} left` : `${money(Math.abs(remaining))} over`)
            : '—'}
        </span>
      </div>

      {/* Last month — same size/color as "spent", just for context when setting a budget */}
      <div style={{ marginTop: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {money(lastMonthSpent)} spent last month
        </span>
      </div>

      {/* Expanded: subcategory breakdown + transactions */}
      {expandedState && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {expandedState.loading ? (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Loading…</div>
          ) : (<>
            {/* Transaction list */}
            {expandedState.txns.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No transactions this month</div>
            ) : (
              <div>
                {expandedState.txns.map(t => (
                  <div key={t.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                      borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => setRecatTxnId(recatTxnId === t.id ? null : t.id)}
                    >
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', minWidth: 44 }}>
                        {t.transaction_date?.slice(5)}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.description}
                        </div>
                        {t.category !== name && (
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'capitalize', marginTop: 1 }}>
                            {t.category?.replace(/_/g, ' ')}
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {money(Math.abs(t.amount))}
                      </span>
                    </div>
                    {recatTxnId === t.id && (
                      <div style={{ padding: '8px 0 4px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', width: '100%', marginBottom: 2 }}>Move to:</div>
                        {(allCategories || []).filter(c => c !== name).map(c => (
                          <button key={c} onClick={async () => {
                            await fetch(`${API}/transactions/${t.id}/category`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ category: c, apply_to_merchant: false }),
                            })
                            setRecatTxnId(null)
                            onTxnRecategorized?.()
                          }}
                          style={{
                            fontSize: 11, padding: '3px 10px', borderRadius: 20,
                            border: '1px solid var(--border)', background: 'var(--bg-subtle)',
                            cursor: 'pointer', textTransform: 'capitalize', color: 'var(--text-primary)',
                          }}>
                            {catEmoji(c)} {c.replace(/_/g, ' ')}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>)}
        </div>
      )}
    </div>
  )
}

// ── History Card ──────────────────────────────────────────────────────────────

function MonthHistory({ monthData }) {
  const { month, categories, budgetTotal, spentTotal } = monthData
  const diff = budgetTotal - spentTotal
  const under = diff >= 0
  const maxVal = Math.max(...categories.map(c => Math.max(c.budget, c.spent)), 1)

  return (
    <div className="apple-card" style={{ padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{month}</div>
        <span className={`apple-pill ${under ? 'apple-pill-green' : 'apple-pill-orange'}`} style={{ fontSize: 11 }}>
          {under ? `Under ${money(diff)} ✅` : `Over ${money(Math.abs(diff))} ⚠️`}
        </span>
      </div>
      {categories.map(c => (
        <div key={c.category} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
              {catEmoji(c.category)} {c.category.replace(/_/g, ' ')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
              {money(c.spent)} / {money(c.budget)}
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--bg-subtle)', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 'var(--radius-pill)', background: 'rgba(52,199,89,0.3)', width: `${Math.min(100, (c.budget / maxVal) * 100)}%` }} />
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 'var(--radius-pill)', background: c.spent > c.budget ? 'var(--red)' : 'var(--accent)', opacity: 0.8, width: `${Math.min(100, (c.spent / maxVal) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Add Category Modal ────────────────────────────────────────────────────────

function AddCategoryModal({ existing, onAdd, onClose }) {
  const [name, setName] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const PRESETS = ['clothing', 'medical', 'subscriptions', 'gifts', 'travel', 'pets']
    .filter(p => !existing.includes(p))

  function submit(n) {
    const clean = (n || name).trim().toLowerCase().replace(/\s+/g, '_')
    if (!clean) return
    onAdd(clean)
    onClose()
  }

  return (
    <Portal>
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.08)',
      zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="apple-card" style={{ width: 320, padding: '24px 22px', animation: 'page-in 0.18s ease' }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Add Category</div>
        {PRESETS.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {PRESETS.map(p => (
              <button key={p} onClick={() => submit(p)}
                className="apple-pill apple-pill-neutral"
                style={{ cursor: 'pointer', border: 'none', minHeight: 36 }}>
                {catEmoji(p)} {p}
              </button>
            ))}
          </div>
        )}
        <div style={{ borderTop: PRESETS.length > 0 ? '1px solid var(--border)' : 'none', paddingTop: PRESETS.length > 0 ? 14 : 0, marginBottom: 14 }}>
          <div className="apple-label" style={{ marginBottom: 6 }}>Custom name</div>
          <input
            ref={inputRef}
            className="apple-input"
            placeholder="e.g. medical, travel…"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="apple-btn-secondary" onClick={onClose} style={{ minHeight: 44 }}>Cancel</button>
          <button className="apple-btn-primary" onClick={() => submit()} disabled={!name.trim()} style={{ minHeight: 44 }}>Add</button>
        </div>
      </div>
    </div>
    </Portal>
  )
}

// ── Main Budget Component ─────────────────────────────────────────────────────

export default function Budget({ active, onAlert, navigateTo }) {
  const isMobile = useIsMobile()

  // ── State ────────────────────────────────────────────────────────────────────

  // Bills — source of truth: bills DB
  const [bills, setBills] = useState([])
  const [billsLoading, setBillsLoading] = useState(true)

  // Income — the BASELINE (normal-month) figure from /api/dashboard, so budget
  // math stays identical every month. actualIncome is kept only for the
  // annotation showing this month's difference. No manual state override here:
  // a stale override silently masking the real figure is exactly the kind of
  // "two sources of truth" bug this page already burned us on once.
  const [income, setIncome] = useState(0)
  const [actualIncome, setActualIncome] = useState(0)
  const [squeezeInfo, setSqueezeInfo] = useState(null)

  // Real categories — source of truth: GET /api/categories. primaries carries
  // each primary's secondaries (for the click-to-expand breakdown); base/custom
  // stay as flat primary-name lists for everything that just needs names.
  const [categories, setCategories] = useState({ base: [], custom: [], primaries: [] })

  // Which primary cards are expanded, and their fetched secondary breakdown.
  // Shape: { [primaryName]: { loading, breakdown: [{category, total}] } }
  const [expanded, setExpanded] = useState({})

  // Category limits — localStorage-first, populated once real categories load.
  // Shape: { [name]: number }
  const [limits, setLimits] = useState({})

  // Spent amounts from /api/budgets — keyed by category name
  const [spentMap, setSpentMap] = useState({})
  const [lastMonthSpentMap, setLastMonthSpentMap] = useState({})

  // History
  const [history, setHistory] = useState([])
  const [historyOpen, setHistoryOpen] = useState(false)

  // UI
  const [showAddModal, setShowAddModal] = useState(false)
  const [toast, setToast] = useState(null)
  const [alertBanner, setAlertBanner] = useState(null)
  const [alertDismissed, setAlertDismissed] = useState(false)

  const prevBillsTotalRef = useRef(null)
  const pollRef = useRef(null)

  // ── All category names in display order — real categories, then the savings goal ──
  const allCategoryNames = [
    ...categories.base,
    ...categories.custom,
    ...GOAL_CATEGORIES.map(c => c.name).filter(n => !categories.custom.includes(n) && !categories.base.includes(n)),
  ]

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const loadCategories = useCallback(async () => {
    try {
      const data = await fetch(`${API}/categories`).then(r => r.json())
      const base = data.base || []
      const custom = data.custom || []
      const primaries = data.primaries || []
      setCategories({ base, custom, primaries })
      setLimits(prev => {
        const next = { ...prev }
        ;[...base, ...custom, ...GOAL_CATEGORIES.map(c => c.name)].forEach(n => {
          if (!(n in next)) next[n] = getLSLimit(n)
        })
        return next
      })
    } catch {}
  }, [])

  const loadBills = useCallback(async () => {
    // Source of truth: bills DB
    try {
      const data = await fetch(`${API}/bills`).then(r => r.json())
      const active = Array.isArray(data) ? data : []
      setBills(active)
      setBillsLoading(false)

      // Alert: check if new bill total pushes past income
      const total = active.reduce((s, b) => s + (b.monthly_equivalent ?? b.expected_amount ?? 0), 0)
      if (prevBillsTotalRef.current !== null && total !== prevBillsTotalRef.current) {
        if (total > income) {
          const over = total - income
          setAlertBanner(`⚠️ Your bills were updated. You are now ${money(over)} over budget — review your allocations.`)
          onAlert?.(true)
        }
      }
      prevBillsTotalRef.current = total
    } catch { setBillsLoading(false) }
  }, [income, onAlert])

  const loadSpent = useCallback(async () => {
    // Fetch actual spent amounts from /api/budgets — enhances cards with real data
    // Cards render immediately from localStorage; this adds the spent overlay
    try {
      const data = await fetch(`${API}/budgets`).then(r => r.json())
      if (Array.isArray(data)) {
        const map = {}, lastMonthMap = {}
        data.forEach(b => {
          map[b.category] = parseFloat(b.spent) || 0
          lastMonthMap[b.category] = parseFloat(b.spent_last_month) || 0
        })
        setSpentMap(map)
        setLastMonthSpentMap(lastMonthMap)
      }
    } catch { /* spent stays $0 — cards still render */ }
  }, [])

  const toggleExpand = useCallback(async (name) => {
    setExpanded(prev => {
      if (prev[name]) {
        const next = { ...prev }
        delete next[name]
        return next
      }
      return { ...prev, [name]: { loading: true, breakdown: [], txns: [] } }
    })
    if (expanded[name]) return
    try {
      const today = new Date()
      const daysIntoMonth = today.getDate()
      const [breakdownData, txnData] = await Promise.all([
        fetch(`${API}/budgets/${encodeURIComponent(name)}/breakdown`).then(r => r.json()),
        fetch(`${API}/spending/transactions?category=${encodeURIComponent(name)}&days=${daysIntoMonth + 1}&limit=100`).then(r => r.json()),
      ])
      setExpanded(prev => prev[name] ? {
        ...prev,
        [name]: { loading: false, breakdown: breakdownData.breakdown || [], txns: txnData || [] }
      } : prev)
    } catch {
      setExpanded(prev => prev[name] ? { ...prev, [name]: { loading: false, breakdown: [], txns: [] } } : prev)
    }
  }, [expanded])

  const loadIncome = useCallback(async () => {
    try {
      const dash = await fetch(`${API}/dashboard`).then(r => r.json())
      setIncome(getBaselineIncome(dash))
      setActualIncome(getMonthlyIncome(dash))
      setSqueezeInfo({ left: dash.left_to_live, living: dash.actual_living_median, gap: dash.living_squeeze })
    } catch {}
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetch(`${API}/spending/summary?days=90`).then(r => r.json())
      const monthly = data.monthly || []
      const today = new Date()
      const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

      // Roll secondaries up into their primary — budgets only exist at the primary
      // level ("one budget for food, no matter where it was spent"), so history
      // needs the same rollup /api/budgets already does, or every secondary would
      // show against a $0 budget it never actually has.
      const secondaryToPrimary = {}
      categories.primaries.forEach(p => {
        (p.secondaries || []).forEach(s => { secondaryToPrimary[s] = p.name })
      })

      const byMonth = {}
      monthly.forEach(row => {
        if (row.month === currentMonth) return
        const cat = secondaryToPrimary[row.category] || row.category || 'other'
        if (!byMonth[row.month]) byMonth[row.month] = {}
        byMonth[row.month][cat] = (byMonth[row.month][cat] || 0) + (parseFloat(row.total) || 0)
      })
      const months = Object.keys(byMonth).sort().reverse().slice(0, 2)
      const hist = months.map(m => {
        const [y, mo] = m.split('-')
        const label = new Date(parseInt(y), parseInt(mo) - 1, 1)
          .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        const cats = Object.entries(byMonth[m]).map(([cat, spent]) => ({
          category: cat,
          spent: parseFloat(spent) || 0,
          budget: getLSLimit(cat),
        }))
        const spentTotal = cats.reduce((s, c) => s + c.spent, 0)
        const budgetTotal = cats.reduce((s, c) => s + c.budget, 0)
        return { month: label, categories: cats, spentTotal, budgetTotal }
      })
      setHistory(hist)
    } catch {}
  }, [categories.primaries])

  useEffect(() => {
    if (active) {
      loadCategories()
      loadBills()
      loadSpent()
      loadIncome()
      loadHistory()
      // Also sync DB limits into localStorage for categories already in DB
      fetch(`${API}/budgets`).then(r => r.json()).then(data => {
        if (Array.isArray(data)) {
          data.forEach(b => {
            if (b.monthly_limit > 0) {
              // Only overwrite if localStorage has no value yet for this category
              const existing = localStorage.getItem(LS_PREFIX + b.category)
              if (existing === null) setLSLimit(b.category, b.monthly_limit)
            }
          })
        }
      }).catch(() => {})
      pollRef.current = setInterval(loadBills, 60000)
    } else {
      clearInterval(pollRef.current)
    }
    return () => clearInterval(pollRef.current)
  }, [active, loadCategories, loadBills, loadSpent, loadIncome, loadHistory])

  // ── Actions ──────────────────────────────────────────────────────────────────

  function handleLimitChange(name, value) {
    // 1. Update localStorage immediately — cards re-render instantly
    setLSLimit(name, value)
    setLimits(prev => ({ ...prev, [name]: value }))
    // 2. Sync to DB in background
    fetch(`${API}/budgets/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthly_limit: value }),
    }).catch(() => {})
  }

  async function handleAddCategory(name) {
    if (allCategoryNames.includes(name)) return
    setLimits(prev => ({ ...prev, [name]: getLSLimit(name) }))
    // Sync to DB, then refresh the real category list
    await fetch(`${API}/categories`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => {})
    fetch(`${API}/budgets/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthly_limit: 0 }),
    }).catch(() => {})
    loadCategories()
  }

  function handleRemoveCategory(name) {
    // Only allow removing real custom categories — not base categories or the savings goal
    if (categories.base.includes(name) || GOAL_CATEGORIES.find(g => g.name === name)) return
    setLimits(prev => { const n = { ...prev }; delete n[name]; return n })
    fetch(`${API}/categories/${encodeURIComponent(name)}`, { method: 'DELETE' })
      .then(loadCategories).catch(() => {})
    fetch(`${API}/budgets/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  }

  // ── 50/30/20 Suggest Allocation ───────────────────────────────────────────

  function suggestAllocation() {
    const eff = income
    // Source of truth: bills DB
    const fixedTotal = bills.reduce((s, b) => s + (b.monthly_equivalent ?? b.expected_amount ?? 0), 0)
    const remaining = eff - fixedTotal
    if (remaining <= 0) {
      setToast('⚠️ No remaining budget after fixed bills to allocate.')
      return
    }
    const needs = remaining * 0.50
    const wants = remaining * 0.30
    const savings = remaining * 0.20

    const needNames = allCategoryNames.filter(n => ['food','gas','household','bill','debt_payment'].includes(n))
    const wantNames = allCategoryNames.filter(n => ['entertainment','shopping','transportation','family_purchase','other'].includes(n))
    const saveNames = allCategoryNames.filter(n => ['savings'].includes(n))

    if (needNames.length) needNames.forEach(n => handleLimitChange(n, Math.round(needs / needNames.length)))
    if (wantNames.length) wantNames.forEach(n => handleLimitChange(n, Math.round(wants / wantNames.length)))
    if (saveNames.length) saveNames.forEach(n => handleLimitChange(n, Math.round(savings / saveNames.length)))

    setToast(
      `✅ 50/30/20 applied to ${money(remaining)} after fixed bills\n` +
      `Needs 50%: ${money(needs)}  ·  Wants 30%: ${money(wants)}  ·  Savings 20%: ${money(savings)}`
    )
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  // Source of truth: bills DB. Sum monthly_equivalent, not expected_amount — same
  // convention as the weekly-bill conversion 30 lines up, so this total agrees with
  // every other page that totals bills instead of silently under/over-counting weeklies.
  // Hardline (bills + debt payments) and Contributions are separate lines —
  // contributions are the adjustable tier, never mixed into "fixed."
  const fixedTotal = bills.filter(b => b.payment_type !== 'Contribution').reduce((s, b) => s + (b.monthly_equivalent ?? b.expected_amount ?? 0), 0)
  const contribTotal = bills.filter(b => b.payment_type === 'Contribution').reduce((s, b) => s + (b.monthly_equivalent ?? b.expected_amount ?? 0), 0)
  const savingsTotal = limits['savings'] || 0
  const allocatedTotal = allCategoryNames.filter(n => n !== 'savings').reduce((s, n) => s + (limits[n] || 0), 0)
  const remainingAfterAll = income - fixedTotal - contribTotal - savingsTotal - allocatedTotal

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="page-enter" style={{ padding: isMobile ? '20px 16px 80px' : '32px 36px 80px' }}>

      {/* Alert banner */}
      {alertBanner && !alertDismissed && (
        <div style={{
          background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.3)',
          borderRadius: 12, padding: '12px 16px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
        }}>
          <span style={{ flex: 1, color: 'var(--orange)', fontWeight: 500 }}>{alertBanner}</span>
          <button onClick={() => { setAlertDismissed(true); onAlert?.(false) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 18, minWidth: 44, minHeight: 44 }}>
            ×
          </button>
        </div>
      )}

      {/* Zero-based budget summary */}
      <div style={{ marginBottom: 20 }}>
        <IncomeSummary
          income={income}
          actualIncome={actualIncome}
          fixedTotal={fixedTotal}
          contribTotal={contribTotal}
          savingsTotal={savingsTotal}
          allocatedTotal={allocatedTotal}
          onSuggest={suggestAllocation}
        />
        {squeezeInfo?.gap != null && squeezeInfo.gap < 0 && (
          <div style={{
            background: 'rgba(255,59,48,0.07)', border: '1px solid rgba(255,59,48,0.3)',
            borderRadius: 12, padding: '12px 16px', marginTop: 10, fontSize: 13, lineHeight: 1.55,
          }}>
            <span style={{ fontWeight: 600, color: 'var(--red)' }}>
              ⚠ Over-committed by {money(Math.abs(squeezeInfo.gap))}/mo.
            </span>{' '}
            <span style={{ color: 'var(--text-secondary)' }}>
              After bills, debt, and contributions, the plan leaves {money(squeezeInfo.left)} to live on — but you
              actually live on ~{money(squeezeInfo.living)}. The gap goes onto credit cards at interest. Reduce
              Contributions (Bills page) before cutting anything you eat.
            </span>
          </div>
        )}
      </div>

      {/* 3. My Budget Categories */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div className="apple-label">My Budget Categories</div>
          <button
            className="apple-btn-secondary"
            onClick={() => setShowAddModal(true)}
            style={{ fontSize: 12, padding: '6px 14px', minHeight: 36 }}
          >
            + Add
          </button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
          gap: isMobile ? 12 : 16,
          marginBottom: 16,
        }}>
          {allCategoryNames.map(name => {
            const isRemovable = !categories.base.includes(name) && !GOAL_CATEGORIES.find(g => g.name === name)
            const primaryInfo = categories.primaries.find(p => p.name === name)
            const hasSecondaries = (primaryInfo?.secondaries?.length || 0) > 0
            return (
              <CategoryCard
                key={name}
                name={name}
                emoji={catEmoji(name)}
                limit={limits[name] || 0}
                spent={spentMap[name] || 0}
                lastMonthSpent={lastMonthSpentMap[name] || 0}
                hasSecondaries={hasSecondaries}
                expandedState={expanded[name]}
                onToggleExpand={toggleExpand}
                onLimitChange={handleLimitChange}
                onRemove={isRemovable ? handleRemoveCategory : null}
                allCategories={allCategoryNames}
                onTxnRecategorized={() => {
                  loadSpent()
                  const openNames = Object.keys(expanded)
                  setExpanded({})
                  openNames.forEach(n => toggleExpand(n))
                }}
              />
            )
          })}
        </div>

      </div>

      {/* 5. Previous months — collapsible */}
      {history.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setHistoryOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 0', fontFamily: 'inherit', minHeight: 44,
            }}
          >
            <div className="apple-label" style={{ marginBottom: 0 }}>Previous Months</div>
            <span style={{
              color: 'var(--text-tertiary)', fontSize: 12,
              transform: historyOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s', display: 'inline-block',
            }}>▼</span>
          </button>
          {historyOpen && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
              gap: isMobile ? 12 : 16,
              marginTop: 8,
              animation: 'page-in 0.2s ease',
            }}>
              {history.map((m, i) => <MonthHistory key={i} monthData={m} />)}
            </div>
          )}
        </div>
      )}

      {/* Add category modal */}
      {showAddModal && (
        <AddCategoryModal
          existing={categories.all || []}
          onAdd={handleAddCategory}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
