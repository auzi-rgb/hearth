import { useState, useEffect, useCallback, useMemo } from 'react'
import { PieChart, Pie, Cell } from 'recharts'
import Portal from '../components/Portal'

const API = '/hearth/api'

function popoverStyle(anchor, width) {
  const w = Math.min(width, window.innerWidth - 40)
  const base = { position: 'fixed', zIndex: 400, width: w, background: 'var(--bg-card, #fff)', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', overflowY: 'auto' }
  if (!anchor) return { ...base, top: 80, right: 20 }
  const right = Math.max(16, window.innerWidth - anchor.right)
  const top   = anchor.bottom + 8
  return { ...base, top, right, maxHeight: window.innerHeight - top - 20 }
}

function money(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  return `$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function moneyK(v) {
  if (v == null) return '—'
  if (Math.abs(v) >= 1000) return `$${(Math.abs(v)/1000).toFixed(1)}k`
  return `$${Math.abs(v).toFixed(0)}`
}

const UNCATEGORIZED_COLOR = '#ff9500'

function catColorHex(cat, customCats) {
  if (!cat) return UNCATEGORIZED_COLOR
  const colorMap = { food: '#34c759', gas: '#ff9500', household: '#007aff', other: '#8e8e93' }
  if (colorMap[cat]) return colorMap[cat]
  const idx = (customCats || []).indexOf(cat)
  const hexColors = ['#a855f7','#ec4899','#f59e0b','#14b8a6','#6366f1','#ef4444']
  return hexColors[idx % hexColors.length] || '#8e8e93'
}

function catLabel(cat) {
  return cat ? cat.replace(/_/g, ' ') : 'Uncategorized'
}


const RANGE_OPTIONS = [
  { label: '30d', days: 30,  title: 'Last 30 days' },
  { label: '60d', days: 60,  title: 'Last 60 days' },
  { label: '90d', days: 90,  title: 'Last 90 days' },
  { label: '6mo', days: 180, title: 'Last 6 months' },
  { label: '1yr', days: 365, title: 'Last year' },
]

const SEARCH_RANGE_OPTIONS = [
  { label: '1 month',  days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
  { label: '1 year',   days: 365 },
]

const MERCHANT_PALETTE = ['#60a5fa','#34d399','#fbbf24','#f87171','#a78bfa','#fb923c','#38bdf8','#4ade80','#e879f9','#94a3b8']

// ── Inline category picker — renders in-place below the transaction row ───
// Two steps: pick a primary, then (if it has any) pick or create a secondary
// within it. A primary with no secondaries (Gas, Bill, Debt Payment, ...)
// applies immediately, same as before.
function InlineCatPicker({ txn, primaries, customCats, onApply, onClose, onCategoryCreated }) {
  const [step, setStep] = useState('primary') // 'primary' | 'secondary'
  const [pendingPrimary, setPendingPrimary] = useState(null)
  const [pendingCat, setPendingCat] = useState(null)
  const [newSecondary, setNewSecondary] = useState('')
  const [creating, setCreating] = useState(false)

  async function createSecondary() {
    const clean = newSecondary.trim().toLowerCase().replace(/\s+/g, '_')
    if (!clean) return
    setCreating(true)
    await fetch(`${API}/categories`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: clean, parent: pendingPrimary.name }),
    })
    setCreating(false); setNewSecondary('')
    onCategoryCreated?.()
    setPendingCat(clean)
  }

  function selectPrimary(p) {
    if ((p.secondaries || []).length > 0) {
      setPendingPrimary(p); setStep('secondary')
    } else {
      setPendingCat(p.name)
    }
  }

  if (pendingCat) {
    const snippet = txn.description?.split(' ').slice(0, 3).join(' ')
    return (
      <div onClick={e => e.stopPropagation()} style={{
        padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 8, margin: '0 0 8px',
      }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, lineHeight: 1.4 }}>
          Apply <strong style={{ color: catColorHex(pendingCat, customCats), textTransform: 'capitalize' }}>{pendingCat.replace(/_/g, ' ')}</strong> to all "{snippet}" transactions?
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="apple-btn-primary" onClick={() => { onApply(txn, pendingCat, true); onClose() }} style={{ flex: 1, fontSize: 12 }}>Yes, apply rule</button>
          <button className="apple-btn-secondary" onClick={() => { onApply(txn, pendingCat, false); onClose() }} style={{ flex: 1, fontSize: 12 }}>Just this one</button>
          <button onClick={() => setPendingCat(null)} style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontFamily: 'inherit', padding: '6px 8px' }}>‹ Back</button>
        </div>
      </div>
    )
  }

  if (step === 'secondary' && pendingPrimary) {
    return (
      <div onClick={e => e.stopPropagation()} style={{ padding: '6px 0 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <button onClick={() => { setStep('primary'); setPendingPrimary(null) }}
            style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontFamily: 'inherit', padding: 0 }}>
            ‹ Back
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{pendingPrimary.name.replace(/_/g, ' ')}:</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setPendingCat(pendingPrimary.name)} title="No specific sub-category"
            style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              background: pendingPrimary.name === txn.category ? catColorHex(pendingPrimary.name, customCats) : 'var(--bg-subtle)',
              color: pendingPrimary.name === txn.category ? '#fff' : 'var(--text-secondary)',
              border: '1px dashed ' + (pendingPrimary.name === txn.category ? catColorHex(pendingPrimary.name, customCats) : 'var(--border)'),
            }}>
            General
          </button>
          {pendingPrimary.secondaries.map(s => (
            <button key={s} onClick={() => setPendingCat(s)}
              style={{
                padding: '4px 14px', borderRadius: 20, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', textTransform: 'capitalize',
                background: s === txn.category ? catColorHex(s, customCats) : 'var(--bg-subtle)',
                color: s === txn.category ? '#fff' : 'var(--text-primary)',
                border: '1px solid ' + (s === txn.category ? catColorHex(s, customCats) : 'var(--border)'),
                fontWeight: s === txn.category ? 600 : 400,
              }}>
              {s.replace(/_/g, ' ')}
            </button>
          ))}
          <input
            value={newSecondary} onChange={e => setNewSecondary(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createSecondary() }}
            disabled={creating}
            placeholder="+ new…"
            style={{ width: 80, fontSize: 12, padding: '4px 8px', borderRadius: 20, border: '1px dashed var(--border)', background: 'none', fontFamily: 'inherit', color: 'var(--text-primary)' }}
          />
        </div>
      </div>
    )
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{ padding: '6px 0 10px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {primaries.map(p => {
        const isCurrent = p.name === txn.category || (p.secondaries || []).includes(txn.category)
        return (
          <button key={p.name} onClick={() => selectPrimary(p)}
            style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              textTransform: 'capitalize',
              background: isCurrent ? catColorHex(p.name, customCats) : 'var(--bg-subtle)',
              color: isCurrent ? '#fff' : 'var(--text-primary)',
              border: '1px solid ' + (isCurrent ? catColorHex(p.name, customCats) : 'var(--border)'),
              fontWeight: isCurrent ? 600 : 400,
            }}>
            {p.name.replace(/_/g, ' ')}{(p.secondaries || []).length > 0 ? ' ›' : ''}
          </button>
        )
      })}
      <button onClick={onClose} style={{ marginLeft: 'auto', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontFamily: 'inherit' }}>✕</button>
    </div>
  )
}

// ── Edit Categories panel — manages the primary/secondary tree ────────────
function EditCategoriesPanel({ anchor, primaries, onClose, onRefresh }) {
  const [newName, setNewName] = useState('')
  const [newParent, setNewParent] = useState('') // '' = new primary card
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)

  async function addCat() {
    const n = newName.trim().toLowerCase().replace(/\s+/g, '_')
    if (!n) return
    setSaving(true)
    await fetch(`${API}/categories`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newParent ? { name: n, parent: newParent } : { name: n }),
    })
    setNewName(''); setSaving(false); onRefresh()
  }
  async function delCat(name) {
    await fetch(`${API}/categories/${name}`, { method: 'DELETE' })
    setConfirmDel(null); onRefresh()
  }

  function DeleteControl({ name }) {
    return confirmDel === name ? (
      <>
        <button onClick={() => delCat(name)} style={{ fontSize: 11, color: 'var(--red)', border: '1px solid var(--red)', borderRadius: 6, background: 'none', cursor: 'pointer', padding: '2px 8px', fontFamily: 'inherit' }}>Confirm</button>
        <button onClick={() => setConfirmDel(null)} style={{ fontSize: 11, color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer', padding: '2px 8px', fontFamily: 'inherit' }}>Cancel</button>
      </>
    ) : (
      <button onClick={() => setConfirmDel(name)} style={{ fontSize: 11, color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer', padding: '2px 8px', fontFamily: 'inherit' }}>Delete</button>
    )
  }

  return (
    <Portal>
      <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onClick={onClose} />
      <div className="apple-card" style={{ ...popoverStyle(anchor, 420), padding: '24px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Edit Categories</div>
          <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-tertiary)' }}>✕</button>
        </div>

        {primaries.map(p => (
          <div key={p.name} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: (p.secondaries || []).length === 0 ? '1px solid var(--border)' : 'none', fontSize: 13 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: catColorHex(p.name, []), display: 'inline-block', flexShrink: 0 }} />
              <span style={{ textTransform: 'capitalize', fontWeight: 600, flex: 1 }}>{p.name.replace(/_/g, ' ')}</span>
              {p.is_base ? (
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>built-in</span>
              ) : <DeleteControl name={p.name} />}
            </div>
            {(p.secondaries || []).map((s, i) => (
              <div key={s} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0 5px 22px', fontSize: 12,
                borderBottom: i === p.secondaries.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text-tertiary)', display: 'inline-block', flexShrink: 0 }} />
                <span style={{ textTransform: 'capitalize', flex: 1, color: 'var(--text-secondary)' }}>{s.replace(/_/g, ' ')}</span>
                <DeleteControl name={s} />
              </div>
            ))}
          </div>
        ))}

        <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div className="apple-label" style={{ marginBottom: 8 }}>Add new category</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="apple-select" value={newParent} onChange={e => setNewParent(e.target.value)} style={{ fontSize: 13, width: 150, flexShrink: 0 }}>
              <option value="">New primary card</option>
              {primaries.map(p => <option key={p.name} value={p.name}>Under {p.name.replace(/_/g, ' ')}</option>)}
            </select>
            <input className="apple-input" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCat()} placeholder="e.g. medical" style={{ flex: 1, fontSize: 13 }} />
            <button className="apple-btn-primary" onClick={addCat} disabled={saving || !newName.trim()} style={{ fontSize: 13, padding: '6px 14px' }}>{saving ? '…' : 'Add'}</button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

// ── Budget Modal ──────────────────────────────────────────────────────────
function BudgetModal({ anchor, categories, budgets, onClose, onSaved }) {
  const [limits, setLimits] = useState(() => {
    const m = {}
    budgets.forEach(b => { m[b.category] = String(b.monthly_limit) })
    return m
  })
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    for (const [cat, val] of Object.entries(limits)) {
      const num = parseFloat(val)
      if (!isNaN(num) && num > 0) await fetch(`${API}/budgets/${cat}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monthly_limit: num }) })
      else if (num === 0 || val === '') await fetch(`${API}/budgets/${cat}`, { method: 'DELETE' })
    }
    setSaving(false); onSaved(); onClose()
  }
  return (
    <Portal>
      <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onClick={onClose} />
      <div className="apple-card" style={{ ...popoverStyle(anchor, 340), padding: '24px 28px' }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Monthly Budgets</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>Leave blank to remove a budget.</div>
        {categories.map(cat => (
          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ flex: 1, fontSize: 13, textTransform: 'capitalize' }}>{cat}</span>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: 13 }}>$</span>
              <input className="apple-input" type="number" min="0" step="50" value={limits[cat] || ''} onChange={e => setLimits(p => ({ ...p, [cat]: e.target.value }))} placeholder="no limit" style={{ width: 110, paddingLeft: 22, fontSize: 13 }} />
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="apple-btn-secondary" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="apple-btn-primary" onClick={save} disabled={saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Portal>
  )
}

// ── AI Category Suggestion Panel ──────────────────────────────────────────
function AiSuggestPanel({ data, acceptedIds, onToggle, onToggleAll, onApply, onAddCategory, onDismiss, applying }) {
  const { suggestions, new_categories, total_transactions } = data
  const acceptedCount = acceptedIds.size

  return (
    <div style={{ background: 'var(--bg-subtle)', borderRadius: 10, padding: '16px 18px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600 }}>AI Category Suggestions</span>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>
            {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''} · {total_transactions} {data.scope === 'other' ? 'uncategorized' : 'total'} transactions reviewed
          </span>
        </div>
        <button onClick={onDismiss} title="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 16, lineHeight: 1, padding: 0 }}>✕</button>
      </div>

      {suggestions.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', paddingBottom: 4 }}>No suggestions — all transactions are already well-categorized.</div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <button onClick={onToggleAll} style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-text)', fontFamily: 'inherit', padding: 0 }}>
              {acceptedCount === suggestions.length ? 'Deselect all' : 'Select all'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{acceptedCount} of {suggestions.length} selected</span>
          </div>

          <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 14, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            {suggestions.map((s, i) => {
              const checked = acceptedIds.has(s.id)
              return (
                <div key={s.id} onClick={() => onToggle(s.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                    borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none',
                    cursor: 'pointer',
                    background: checked ? 'var(--accent-dim)' : 'transparent',
                    transition: 'background 0.1s',
                  }}>
                  <input type="checkbox" readOnly checked={checked} onClick={e => e.stopPropagation()}
                    onChange={() => onToggle(s.id)}
                    style={{ flexShrink: 0, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.description}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                    {s.count} txn{s.count !== 1 ? 's' : ''}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize', flexShrink: 0 }}>
                    {s.current_category}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>→</span>
                  <span style={{
                    fontSize: 12, fontWeight: 600, textTransform: 'capitalize', flexShrink: 0,
                    color: catColorHex(s.suggested_category, []),
                    minWidth: 64, textAlign: 'right',
                  }}>{s.suggested_category}</span>
                </div>
              )
            })}
          </div>
        </>
      )}

      {new_categories.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em', marginBottom: 8 }}>NEW CATEGORY SUGGESTIONS</div>
          {new_categories.map(nc => (
            <div key={nc.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, textTransform: 'capitalize', minWidth: 90 }}>{nc.name.replace(/_/g, ' ')}</span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flex: 1 }}>{nc.reason}</span>
              <button onClick={() => onAddCategory(nc.name)} className="apple-btn-secondary" style={{ fontSize: 11, padding: '3px 10px', flexShrink: 0 }}>Add</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="apple-btn-primary" onClick={onApply}
          disabled={applying || acceptedCount === 0}
          style={{ fontSize: 13 }}>
          {applying ? 'Applying…' : `Apply ${acceptedCount} change${acceptedCount !== 1 ? 's' : ''}`}
        </button>
        <button className="apple-btn-secondary" onClick={onDismiss} style={{ fontSize: 13 }}>Dismiss</button>
      </div>
    </div>
  )
}

export default function Spending({ active }) {
  const [days, setDays] = useState(30)
  const [summary, setSummary] = useState(null)
  const [txns, setTxns] = useState([])
  const [accounts, setAccounts] = useState([])
  const [allCats, setAllCats] = useState(['food','gas','household','other'])
  const [customCats, setCustomCats] = useState([])
  // Structured primary -> secondaries tree, for the two-step category picker
  // and anything (like budget limits) that's only ever set at the primary level.
  const [primaries, setPrimaries] = useState([])
  const [budgets, setBudgets] = useState([])
  const [topMerchants, setTopMerchants] = useState([])
  const [showMoreMerchants, setShowMoreMerchants] = useState(false)
  const [accountId, setAccountId] = useState('')

  // Search state — independent of the page-level date range above. Empty search
  // leaves the transaction list governed by the page filters exactly as before;
  // typing a query switches it to searchRange and supersedes any drill-down.
  const [searchText, setSearchText] = useState('')
  const [searchRange, setSearchRange] = useState(30)

  // Drill-down state
  const [drill, setDrill] = useState(null)       // {cat, catColor, catTotal, merchants}
  const [monthFilter, setMonthFilter] = useState(null)        // 'YYYY-MM' | null
  const [selectedMerchant, setSelectedMerchant] = useState(null) // {key, display} | null
  const [loadingDrill, setLoadingDrill] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState(null)

  // Reviewing uncategorized transactions — a deliberate mode, not a drill-down,
  // since each one needs individual attention rather than aggregate breakdown.
  const [viewingUncategorized, setViewingUncategorized] = useState(false)

  const [dropdown, setDropdown] = useState(null)
  const [budgetAnchor, setBudgetAnchor] = useState(null)
  const [editCatsAnchor, setEditCatsAnchor] = useState(null)
  const [aiSuggest, setAiSuggest] = useState(null)
  const [loadingAi, setLoadingAi] = useState(false)
  const [acceptedIds, setAcceptedIds] = useState(new Set())
  const [applyingAi, setApplyingAi] = useState(false)

  const loadSummaryData = useCallback(async () => {
    if (!active) return
    const qs = `days=${days}${accountId ? `&account_id=${accountId}` : ''}`
    const [s, b, cats, merch] = await Promise.all([
      fetch(`${API}/spending/summary?${qs}`).then(r => r.json()).catch(() => null),
      fetch(`${API}/budgets`).then(r => r.json()).catch(() => []),
      fetch(`${API}/categories`).then(r => r.json()).catch(() => ({ all: [], custom: [] })),
      fetch(`${API}/spending/top-merchants?${qs}&limit=15`).then(r => r.json()).catch(() => []),
    ])
    setSummary(s); setBudgets(b)
    setAllCats(cats.all || ['food','gas','household','other'])
    setCustomCats(cats.custom || [])
    setPrimaries(cats.primaries || [])
    setTopMerchants(merch)
  }, [active, days, accountId])

  const isSearching = searchText.trim().length > 0

  const loadTxns = useCallback(async () => {
    if (!active) return
    const params = new URLSearchParams({
      days: String(isSearching ? searchRange : days),
      limit: isSearching ? '500' : '200',
    })
    if (accountId) params.set('account_id', accountId)
    if (viewingUncategorized) {
      params.set('uncategorized', 'true')
    } else if (isSearching) {
      params.set('search', searchText.trim())
    } else {
      if (drill?.cat) params.set('category', drill.cat)
      if (selectedMerchant?.key) params.set('merchant_key', selectedMerchant.key)
    }
    const t = await fetch(`${API}/spending/transactions?${params}`).then(r => r.json()).catch(() => [])
    setTxns(t)
  }, [active, days, accountId, drill?.cat, selectedMerchant?.key, isSearching, searchRange, searchText, viewingUncategorized])

  useEffect(() => {
    if (!active) return
    fetch(`${API}/accounts`).then(r => r.json()).then(a => {
      setAccounts(a)
      const food = a.find(x => x.name.toLowerCase().includes('food'))
      if (food && !accountId) setAccountId(String(food.id))
    }).catch(() => {})
  }, [active])

  // Reset drill when date range or account changes
  useEffect(() => {
    setDrill(null); setMonthFilter(null); setSelectedMerchant(null); setViewingUncategorized(false)
  }, [days, accountId])

  useEffect(() => { loadSummaryData() }, [loadSummaryData])
  useEffect(() => { loadTxns() }, [loadTxns])

  const budgetMap = Object.fromEntries(budgets.map(b => [b.category, b.monthly_limit]))

  // Donut items: drill mode → merchant palette; month selected → filtered by_category; else → all by_category
  const donutItems = useMemo(() => {
    if (drill) {
      return (drill.merchants || []).map((m, i) => ({
        name: m.display,
        rawCategory: m.key,
        value: m.total,
        color: MERCHANT_PALETTE[i % MERCHANT_PALETTE.length],
        key: m.key,
        count: m.count,
      }))
    }
    if (monthFilter) {
      return (summary?.monthly || [])
        .filter(r => r.month === monthFilter)
        .map(r => ({
          name: catLabel(r.category),
          rawCategory: r.category,
          value: r.total,
          color: catColorHex(r.category, customCats),
        }))
    }
    return (summary?.by_category || []).map(c => ({
      name: catLabel(c.category),
      rawCategory: c.category,
      value: c.total,
      color: catColorHex(c.category, customCats),
    }))
  }, [drill, monthFilter, summary, customCats])

  const donutTotal = donutItems.reduce((s, i) => s + i.value, 0)

  async function handleCategoryClick(item) {
    if (drill) {
      // In merchant mode: select/deselect merchant to filter transactions
      setSelectedMerchant(prev => prev?.key === item.key ? null : { key: item.key, display: item.name })
      return
    }
    if (item.rawCategory == null) {
      // Uncategorized slice — each one needs individual review, not an aggregate
      // merchant breakdown, so jump straight to the filtered transaction list.
      setViewingUncategorized(true)
      setDrill(null); setSelectedMerchant(null); setMonthFilter(null)
      return
    }
    setLoadingDrill(true)
    const qs = `category=${encodeURIComponent(item.rawCategory)}&days=${days}${accountId ? `&account_id=${accountId}` : ''}`
    const merchants = await fetch(`${API}/spending/merchants-by-category?${qs}`)
      .then(r => r.json()).catch(() => [])
    const catTotal = (summary?.by_category || []).find(c => c.category === item.rawCategory)?.total || 0
    setDrill({ cat: item.rawCategory, catColor: catColorHex(item.rawCategory, customCats), catTotal, merchants })
    setSelectedMerchant(null)
    setLoadingDrill(false)
  }

  function handleBackToCategories() {
    setDrill(null)
    setSelectedMerchant(null)
  }

  function handleMonthClick(month) {
    setMonthFilter(prev => prev === month ? null : month)
  }

  function openDropdown(e, txn) {
    e.stopPropagation()
    setDropdown(prev => prev?.txn?.id === txn.id ? null : { txn })
  }

  async function applyCategory(txn, newCat, applyToMerchant) {
    await fetch(`${API}/transactions/${txn.id}/category`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: newCat, apply_to_merchant: applyToMerchant }),
    })
    loadSummaryData()
    loadTxns()
  }

  async function fetchAiSuggestions(scope = 'other') {
    setLoadingAi(scope)
    const params = new URLSearchParams({ days: String(days), scope })
    if (accountId) params.set('account_id', accountId)
    try {
      const resp = await fetch(`${API}/ai/suggest-categories?${params}`, { method: 'POST' })
      if (!resp.ok) throw new Error(`${resp.status}`)
      const data = await resp.json()
      setAiSuggest({ ...data, scope })
      setAcceptedIds(new Set((data.suggestions || []).map(s => s.id)))
    } catch (e) {
      // AI suggest failed silently — user sees no panel appear
    }
    setLoadingAi(false)
  }

  async function applyAiSuggestions() {
    if (!aiSuggest) return
    setApplyingAi(true)
    const toApply = aiSuggest.suggestions.filter(s => acceptedIds.has(s.id))
    await Promise.all(toApply.map(s =>
      fetch(`${API}/transactions/${s.id}/category`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: s.suggested_category, apply_to_merchant: true }),
      })
    ))
    setAiSuggest(null)
    setAcceptedIds(new Set())
    setApplyingAi(false)
    loadSummaryData()
    loadTxns()
  }

  async function addAiCategory(name) {
    await fetch(`${API}/categories`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    loadSummaryData()
    // Remove from new_categories list
    setAiSuggest(prev => prev ? { ...prev, new_categories: prev.new_categories.filter(c => c.name !== name) } : prev)
  }

  function toggleAiId(id) {
    setAcceptedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllAi() {
    if (!aiSuggest) return
    setAcceptedIds(prev =>
      prev.size === aiSuggest.suggestions.length
        ? new Set()
        : new Set(aiSuggest.suggestions.map(s => s.id))
    )
  }

  // Monthly stacked bar data
  const monthlyMap = {}
  if (summary?.monthly) {
    for (const row of summary.monthly) {
      if (!monthlyMap[row.month]) monthlyMap[row.month] = { month: row.month }
      monthlyMap[row.month][row.category] = row.total
    }
  }
  const monthlyData = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month))

  return (
    <div className="page-enter" style={{ padding: '32px 36px 80px' }}
      onClick={() => setDropdown(null)}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 32 }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.05em' }}>Spending</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="apple-btn-secondary" title="Create or delete spending categories" onClick={e => setEditCatsAnchor(e.currentTarget.getBoundingClientRect())} style={{ fontSize: 13 }}>Edit Categories</button>
          <button className="apple-btn-secondary" title="Set monthly budget targets per category" onClick={e => setBudgetAnchor(e.currentTarget.getBoundingClientRect())} style={{ fontSize: 13 }}>Budgets</button>
          <select className="apple-select" value={accountId} onChange={e => setAccountId(e.target.value)} style={{ width: 150 }}>
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 3, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-pill)', padding: 3 }}>
            {RANGE_OPTIONS.map(o => (
              <button key={o.days} title={o.title} onClick={() => setDays(o.days)} style={{
                background: days === o.days ? 'var(--bg-card)' : 'transparent', border: 'none', cursor: 'pointer',
                padding: '5px 10px', borderRadius: 'var(--radius-pill)', fontSize: 12,
                fontWeight: days === o.days ? 600 : 400, color: days === o.days ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontFamily: 'inherit', boxShadow: days === o.days ? 'var(--shadow-card)' : 'none', transition: 'all 0.15s',
              }}>{o.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Uncategorized warning */}
      {summary?.uncategorized_count > 0 && (
        <div style={{
          background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.3)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span style={{ flex: 1, fontSize: 14, color: 'var(--orange, #FF9500)', fontWeight: 500 }}>
            {summary.uncategorized_count} transaction{summary.uncategorized_count !== 1 ? 's' : ''} need{summary.uncategorized_count === 1 ? 's' : ''} a category — {money(summary.uncategorized_total)} unreviewed
          </span>
          <button
            onClick={() => { setViewingUncategorized(true); setDrill(null); setSelectedMerchant(null); setMonthFilter(null); setSearchText(''); setAccountId('') }}
            className="apple-btn-secondary" style={{ fontSize: 12 }}
          >
            Review
          </button>
        </div>
      )}

      {/* Sections 1+2: side-by-side row */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 20, alignItems: 'stretch', flexWrap: 'wrap' }}>

      {/* Section 1: Spending by Category — Donut + 2-col Legend */}
      <div className="apple-card" style={{ padding: '22px 24px', flex: 1, minWidth: 'min(100%, 300px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="apple-label" style={{ marginBottom: 0 }}>Spending by Category</div>
          {drill ? (
            <>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>›</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: drill.catColor, textTransform: 'capitalize' }}>{drill.cat}</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>{money(drill.catTotal)}</span>
              <button onClick={handleBackToCategories} style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--accent-text)', fontFamily: 'inherit', padding: 0 }}>
                ‹ All Categories
              </button>
            </>
          ) : monthFilter ? (
            <>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>·</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {new Date(monthFilter + '-02').toLocaleString('en-US', { month: 'long', year: 'numeric' })}
              </span>
              <button onClick={() => setMonthFilter(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'inherit', padding: '0 2px' }} title="Clear month filter">✕</button>
            </>
          ) : null}
        </div>

        <div className="donut-legend-row" style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          {/* Fixed-size donut */}
          <div className="donut-chart-wrap" style={{ flexShrink: 0 }}>
            {loadingDrill ? (
              <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading…</div>
            ) : (
              <PieChart width={220} height={220}>
                <Pie
                  data={donutItems.length ? donutItems : [{ name: 'empty', value: 1, color: 'var(--bg-subtle)' }]}
                  cx={110} cy={110}
                  innerRadius={68} outerRadius={98}
                  paddingAngle={donutItems.length ? 2 : 0}
                  dataKey="value"
                  isAnimationActive={false}
                  onClick={entry => donutItems.length && handleCategoryClick(entry)}
                  onMouseEnter={(_, idx) => donutItems.length && setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  {(donutItems.length ? donutItems : [{ name: 'empty', color: 'var(--bg-subtle)' }]).map((item, idx) => (
                    <Cell key={item.name + idx} fill={item.color} stroke="none"
                      opacity={!donutItems.length ? 1 : hoveredIdx === null || hoveredIdx === idx ? 1 : 0.4}
                      style={{ cursor: donutItems.length ? 'pointer' : 'default', outline: 'none' }} />
                  ))}
                </Pie>
                <text x={110} y={104} textAnchor="middle" dominantBaseline="middle"
                  fill="var(--text-primary)" fontSize={18} fontWeight={700}>{moneyK(donutTotal)}</text>
                <text x={110} y={122} textAnchor="middle" dominantBaseline="middle"
                  fill="var(--text-tertiary)" fontSize={11}>
                  {drill ? drill.cat : monthFilter ? 'this month' : 'spent'}
                </text>
              </PieChart>
            )}
          </div>

          {/* legend — single column list that never clips amounts */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, alignContent: 'start', paddingTop: 4 }}>
            {donutItems.map((item, idx) => {
              const budget = !drill ? budgetMap[item.rawCategory] : 0
              const over = budget > 0 && item.value > budget
              const pct = donutTotal > 0 ? Math.round((item.value / donutTotal) * 100) : 0
              const isSelected = drill ? selectedMerchant?.key === item.key : false
              return (
                <div key={item.name + idx}
                  onClick={() => handleCategoryClick(item)}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px',
                    borderRadius: 6, cursor: 'pointer',
                    background: isSelected ? 'var(--accent-dim)' : hoveredIdx === idx ? 'var(--bg-subtle)' : 'transparent',
                    opacity: hoveredIdx !== null && hoveredIdx !== idx ? 0.55 : 1,
                    transition: 'all 0.1s',
                  }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, textTransform: 'capitalize', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                  {over && <span style={{ fontSize: 10, color: 'var(--red)', fontWeight: 700, flexShrink: 0 }}>over</span>}
                  <span style={{ fontSize: 13, fontWeight: 600, color: over ? 'var(--red)' : 'inherit', flexShrink: 0 }}>{money(item.value)}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', width: 28, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
                </div>
              )
            })}
            {donutItems.length === 0 && !loadingDrill && (
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 8px', gridColumn: '1/-1' }}>No spending data</div>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Monthly breakdown table */}
      <div className="apple-card" style={{ padding: '22px 24px', flex: 1, minWidth: 'min(100%, 280px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <div className="apple-label" style={{ marginBottom: 0 }}>Monthly by Category</div>
          {monthFilter && (
            <>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>·</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {new Date(monthFilter + '-02').toLocaleString('en-US', { month: 'long', year: 'numeric' })} selected
              </span>
              <button onClick={() => setMonthFilter(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'inherit', padding: 0 }}>✕</button>
            </>
          )}
        </div>
        {monthlyData.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Not enough data yet</div>
        ) : (() => {
          const months = monthlyData.map(r => r.month)
          const shownMonths = months.slice(-6) // show at most last 6 months
          // per-category row max for bar scaling
          const catRowMax = cat => Math.max(...shownMonths.map(m => {
            const row = monthlyData.find(r => r.month === m)
            return row?.[cat] || 0
          }), 1)
          return (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '0 8px 10px 0', fontWeight: 600, fontSize: 11, color: 'var(--text-tertiary)', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>CATEGORY</th>
                    {shownMonths.map(m => (
                      <th key={m} onClick={() => handleMonthClick(m)}
                        style={{
                          textAlign: 'right', padding: '0 8px 10px', fontWeight: monthFilter === m ? 700 : 500,
                          fontSize: 11, color: monthFilter === m ? 'var(--text-primary)' : 'var(--text-tertiary)',
                          letterSpacing: '0.04em', cursor: 'pointer', whiteSpace: 'nowrap',
                          background: monthFilter === m ? 'var(--accent-dim)' : 'transparent',
                          borderRadius: 4,
                        }}>
                        {new Date(m + '-02').toLocaleString('en-US', { month: 'short', year: '2-digit' }).toUpperCase()}
                      </th>
                    ))}
                    {shownMonths.length >= 2 && (
                      <th style={{ textAlign: 'right', padding: '0 0 10px 8px', fontWeight: 500, fontSize: 11, color: 'var(--text-tertiary)', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>TREND</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...allCats, null].map(cat => {
                    const vals = shownMonths.map(m => {
                      const row = monthlyData.find(r => r.month === m)
                      return row?.[cat] || 0
                    })
                    if (vals.every(v => v === 0)) return null
                    const rowMax = catRowMax(cat)
                    const last = vals[vals.length - 1]
                    const prev = vals[vals.length - 2]
                    const pct = prev > 0 ? Math.round(((last - prev) / prev) * 100) : null
                    const color = catColorHex(cat, customCats)
                    return (
                      <tr key={cat || 'uncategorized'} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 8px 8px 0', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                            <span style={{ textTransform: cat ? 'capitalize' : 'none', fontWeight: 500 }}>{catLabel(cat)}</span>
                          </div>
                        </td>
                        {vals.map((v, i) => (
                          <td key={i} style={{ padding: '8px', textAlign: 'right', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                              <span style={{ fontWeight: 600, color: v === 0 ? 'var(--text-tertiary)' : 'inherit' }}>
                                {v === 0 ? '—' : money(v)}
                              </span>
                              {v > 0 && (
                                <div style={{ width: 60, height: 4, background: 'var(--bg-subtle)', borderRadius: 2 }}>
                                  <div style={{ height: '100%', width: `${(v / rowMax) * 100}%`, background: color, borderRadius: 2, transition: 'width 0.4s' }} />
                                </div>
                              )}
                            </div>
                          </td>
                        ))}
                        {shownMonths.length >= 2 && (
                          <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {pct !== null && last > 0 && prev > 0 ? (
                              <span style={{ fontSize: 12, fontWeight: 600, color: pct > 10 ? 'var(--red)' : pct < -10 ? '#34c759' : 'var(--text-secondary)' }}>
                                {pct > 0 ? '↑' : '↓'} {Math.abs(pct)}%
                              </span>
                            ) : <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                  {/* Totals row */}
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td style={{ padding: '8px 8px 0 0', fontWeight: 700, fontSize: 12, color: 'var(--text-secondary)' }}>TOTAL</td>
                    {shownMonths.map(m => {
                      const row = monthlyData.find(r => r.month === m)
                      const total = [...allCats, null].reduce((s, c) => s + (row?.[c] || 0), 0)
                      return (
                        <td key={m} style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>{money(total)}</td>
                      )
                    })}
                    {shownMonths.length >= 2 && <td />}
                  </tr>
                </tbody>
              </table>
            </div>
          )
        })()}
      </div>

      </div>{/* end side-by-side row */}

      {/* Section 3: Top Merchants */}
      <div className="apple-card" style={{ padding: '22px 24px', marginBottom: 20 }}>
        <div className="apple-label" style={{ marginBottom: 14 }}>Top Merchants</div>
        {topMerchants.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No data</div>
        ) : topMerchants.slice(0, showMoreMerchants ? 15 : 6).map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', width: 16, textAlign: 'right', flexShrink: 0 }}>{i+1}</span>
              <div style={{ width: 3, height: 14, borderRadius: 2, background: MERCHANT_PALETTE[i % MERCHANT_PALETTE.length], flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>{m.display}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{m.count} txns</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{money(m.total)}</span>
            </div>
          </div>
        ))}
        {topMerchants.length > 6 && (
          <button onClick={() => setShowMoreMerchants(s => !s)} style={{ marginTop: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--accent-text)', fontFamily: 'inherit' }}>
            {showMoreMerchants ? 'Show less' : `Show ${topMerchants.length - 6} more`}
          </button>
        )}
      </div>

      {/* Search */}
      <div className="apple-card" style={{ padding: '14px 18px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="apple-input"
          placeholder="Search transactions…"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <div style={{ display: 'flex', gap: 3, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-pill)', padding: 3, opacity: isSearching ? 1 : 0.5 }}>
          {SEARCH_RANGE_OPTIONS.map(o => (
            <button key={o.days} disabled={!isSearching} onClick={() => setSearchRange(o.days)} style={{
              background: searchRange === o.days ? 'var(--bg-card)' : 'transparent', border: 'none',
              cursor: isSearching ? 'pointer' : 'default',
              padding: '5px 10px', borderRadius: 'var(--radius-pill)', fontSize: 12,
              fontWeight: searchRange === o.days ? 600 : 400, color: searchRange === o.days ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontFamily: 'inherit', boxShadow: searchRange === o.days ? 'var(--shadow-card)' : 'none', transition: 'all 0.15s',
            }}>{o.label}</button>
          ))}
        </div>
      </div>

      {/* Section 4: Transactions */}
      <div className="apple-card" style={{ padding: '22px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: aiSuggest ? 12 : 16 }}>
          <div className="apple-label" style={{ marginBottom: 0 }}>
            Transactions
            {viewingUncategorized ? (
              <span style={{ fontWeight: 600, marginLeft: 6, color: UNCATEGORIZED_COLOR }}>
                · Uncategorized
                <button onClick={() => setViewingUncategorized(false)} style={{
                  marginLeft: 6, fontSize: 11, fontWeight: 400, background: 'none', border: 'none',
                  cursor: 'pointer', color: 'var(--text-tertiary)', fontFamily: 'inherit',
                }}>✕ clear</button>
              </span>
            ) : isSearching ? (
              <span style={{ fontWeight: 400, marginLeft: 6, color: 'var(--text-secondary)' }}>
                · "{searchText.trim()}"
              </span>
            ) : drill && (
              <span style={{ fontWeight: 400, marginLeft: 6, textTransform: 'capitalize', color: 'var(--text-secondary)' }}>
                · {selectedMerchant ? selectedMerchant.display : drill.cat}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{txns.length} shown · click category badge to change</div>
            {!aiSuggest && (
              <div style={{ display: 'flex', gap: 4 }}>
                {[{scope: 'other', label: 'Review Other', tip: 'AI suggests categories for uncategorized transactions'},
                  {scope: 'all',   label: 'Review All',   tip: 'AI reviews all transactions and suggests better categories'}
                ].map(o => (
                  <button key={o.scope} onClick={() => fetchAiSuggestions(o.scope)}
                    disabled={!!loadingAi} title={o.tip}
                    style={{
                      fontSize: 12, fontFamily: 'inherit', cursor: loadingAi ? 'default' : 'pointer',
                      background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                      borderRadius: 6, padding: '4px 10px', color: 'var(--accent-text)',
                      fontWeight: 500, opacity: loadingAi === o.scope ? 0.6 : 1,
                    }}>
                    {loadingAi === o.scope ? '…' : '✦'} {loadingAi === o.scope ? 'Analyzing…' : o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {aiSuggest && (
          <AiSuggestPanel
            data={aiSuggest}
            acceptedIds={acceptedIds}
            onToggle={toggleAiId}
            onToggleAll={toggleAllAi}
            onApply={applyAiSuggestions}
            onAddCategory={addAiCategory}
            onDismiss={() => { setAiSuggest(null); setAcceptedIds(new Set()) }}
            applying={applyingAi}
          />
        )}
        {txns.length === 0 && !aiSuggest && <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No transactions</div>}
        {txns.map(t => {
          const isOpen = dropdown?.txn?.id === t.id
          return (
            <div key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="txn-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{t.description || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {t.transaction_date} · {t.account_name}
                    <button
                      onClick={e => openDropdown(e, t)}
                      title={t.category ? undefined : 'No category could be guessed — click to set one'}
                      style={{
                        padding: '1px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                        background: isOpen ? catColorHex(t.category, customCats) : t.category ? 'var(--bg-subtle)' : 'rgba(255,149,0,0.1)',
                        border: (t.category ? '1px solid ' : '1px dashed ') + (isOpen || !t.category ? catColorHex(t.category, customCats) : 'var(--border)'),
                        cursor: 'pointer', fontFamily: 'inherit', textTransform: t.category ? 'capitalize' : 'none',
                        color: isOpen ? '#fff' : catColorHex(t.category, customCats),
                        transition: 'all 0.15s',
                      }}>{catLabel(t.category)}</button>
                    {!t.category_confirmed && t.category && (
                      <span title="Auto-guessed category — never confirmed by you or a merchant rule. Click the category to set it for real."
                        style={{
                          fontSize: 9, fontWeight: 700, color: 'var(--orange)', cursor: 'help',
                          border: '1px solid rgba(255,149,0,0.4)', borderRadius: '50%',
                          width: 13, height: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}>?</span>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)', marginLeft: 12 }}>
                  {money(Math.abs(t.amount))}
                </div>
              </div>
              {isOpen && (
                <InlineCatPicker
                  txn={t} primaries={primaries} customCats={customCats}
                  onApply={applyCategory} onClose={() => setDropdown(null)}
                  onCategoryCreated={loadSummaryData}
                />
              )}
            </div>
          )
        })}
      </div>

      {budgetAnchor && <BudgetModal anchor={budgetAnchor} categories={primaries.map(p => p.name)} budgets={budgets} onClose={() => setBudgetAnchor(null)} onSaved={loadSummaryData} />}
      {editCatsAnchor && <EditCategoriesPanel anchor={editCatsAnchor} primaries={primaries} onClose={() => setEditCatsAnchor(null)} onRefresh={loadSummaryData} />}
    </div>
  )
}
