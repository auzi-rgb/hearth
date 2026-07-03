import { useState, useEffect, useCallback, useRef } from 'react'
import { getMonthlyIncome } from '../lib/dashboardFields'

const API = '/hearth/api'

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

function useIsWide() {
  const [wide, setWide] = useState(() => window.innerWidth >= 900)
  useEffect(() => {
    const fn = () => setWide(window.innerWidth >= 900)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return wide
}

function CashFlowTimeline({ timeline, billsBal, safeBuffer, isMobile }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="apple-card" style={{ padding: '24px', marginBottom: 14 }}>
      <div onClick={() => setOpen(o => !o)} style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: 0.8, color: 'var(--text-tertiary)', marginBottom: 4 }}>
            Cash Flow Timeline
          </div>
          {!open && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Day-by-day projected balance for the next 60 days
            </div>
          )}
        </div>
        <span style={{
          fontSize: 12, color: 'var(--text-tertiary)', transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s', flexShrink: 0, marginLeft: 12,
        }}>▼</span>
      </div>

      {open && (
        <div style={{ marginTop: 16, maxHeight: 420, overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: isMobile ? '60px 1fr 80px' : '70px 1fr 90px 100px',
            gap: 8, padding: '10px 4px', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid var(--border)',
          }}>
            <span>Date</span>
            <span>Event</span>
            <span style={{ textAlign: 'right' }}>Amount</span>
            {!isMobile && <span style={{ textAlign: 'right' }}>Balance</span>}
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: isMobile ? '60px 1fr 80px' : '70px 1fr 90px 100px',
            gap: 8, padding: '8px 4px', fontSize: 13, borderBottom: '1px solid var(--border)',
            color: 'var(--text-tertiary)',
          }}>
            <span>Today</span>
            <span>Starting balance</span>
            <span></span>
            {!isMobile && <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(billsBal)}</span>}
          </div>

          {timeline.map((e, i) => {
            const d = new Date(e.date + 'T12:00:00')
            const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            const isLow = e.balance < safeBuffer
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: isMobile ? '60px 1fr 80px' : '70px 1fr 90px 100px',
                gap: 8, padding: '8px 4px', fontSize: 13,
                borderBottom: i === timeline.length - 1 ? 'none' : '1px solid var(--border)',
                background: isLow ? 'rgba(255,59,48,0.06)' : 'transparent',
              }}>
                <span style={{ color: 'var(--text-tertiary)' }}>{dateStr}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</span>
                <span style={{
                  textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500,
                  color: e.kind === 'income' ? 'var(--accent-text)' : 'var(--text-secondary)',
                }}>
                  {e.kind === 'income' ? '+' : ''}{money(e.amount)}
                </span>
                {!isMobile && (
                  <span style={{
                    textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                    color: isLow ? 'var(--red)' : 'var(--text-primary)',
                  }}>
                    {money(e.balance)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SetupBanner({ onSetup }) {
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    if (!token.trim()) return
    setSaving(true); setError(null)
    try {
      const r = await fetch(`${API}/simplefin/setup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Setup failed')
      onSetup()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="apple-card" style={{ padding: '24px 28px', marginBottom: 20, borderLeft: '3px solid var(--blue)' }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Connect SimpleFin</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
        Paste your SimpleFin setup token to sync bank accounts and transactions automatically.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <input className="apple-input" placeholder="SimpleFin setup token" value={token}
          onChange={e => setToken(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
          style={{ flex: 1 }} />
        <button className="apple-btn-primary" onClick={submit} disabled={saving}>
          {saving ? 'Connecting…' : 'Connect'}
        </button>
      </div>
      {error && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--red)' }}>{error}</div>}
    </div>
  )
}

export default function Dashboard({ active, navigateTo }) {
  const [data, setData] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncWarnings, setSyncWarnings] = useState([])
  const [copied, setCopied] = useState(false)
  const [editingBuffer, setEditingBuffer] = useState(false)
  const [bufferInput, setBufferInput] = useState('')
  const [savingBuffer, setSavingBuffer] = useState(false)
  const timerRef = useRef(null)
  const isMobile = useIsMobile()
  const isWide   = useIsWide()

  const load = useCallback(async () => {
    try {
      const dash = await fetch(`${API}/dashboard`).then(r => r.json())
      setData(dash)
    } catch {}
  }, [])

  useEffect(() => {
    if (active) {
      load()
      timerRef.current = setInterval(load, 60000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [active, load])

  async function triggerSync() {
    setSyncing(true)
    setSyncWarnings([])
    try {
      const res = await fetch(`${API}/sync`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (json.warnings?.length) setSyncWarnings(json.warnings)
      await load()
    } catch {}
    setSyncing(false)
  }

  function copyTransfer() {
    const amt = (data?.suggested_transfer ?? 0)
    navigator.clipboard.writeText(Number(amt).toFixed(2)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  async function saveBuffer() {
    const val = parseFloat(bufferInput)
    if (isNaN(val) || val < 0) return
    setSavingBuffer(true)
    try {
      await fetch(`${API}/settings/safe_spend_buffer`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: val }),
      })
      setEditingBuffer(false)
      await load()
    } catch {}
    setSavingBuffer(false)
  }

  const px = isMobile ? '16px' : '36px'

  if (!data) {
    return (
      <div style={{ padding: `48px ${px}` }}>
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>Loading…</div>
      </div>
    )
  }

  const billsBal        = data.bills_balance           ?? 0
  const foodBal         = data.food_balance             ?? 0
  const monthlyIncome   = getMonthlyIncome(data)
  const monthlyBills    = data.monthly_bills_total      ?? 0
  const monthlySurplus  = data.monthly_surplus          ?? 0
  const suggestedXfer   = data.suggested_transfer       ?? 0
  const xferDate        = data.suggested_transfer_date  ?? '—'
  const daysToXfer      = data.days_until_next_transfer ?? 0
  const safeBuffer      = data.safe_spend_buffer        ?? 200

  let paycheckLabel = null
  if (data.next_paycheck_date) {
    const d = new Date(data.next_paycheck_date + 'T12:00:00')
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' })
    const dateStr  = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const days = data.days_until_paycheck
    const daysStr = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${days} days`
    paycheckLabel = `${dayName} ${dateStr}  (${daysStr})`
  }

  const numSz = isMobile ? 38 : 44

  return (
    <div className="page-enter" style={{ padding: `${isMobile ? '20px' : '32px'} ${px} 80px` }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        <button className="apple-btn-secondary" onClick={triggerSync} disabled={syncing}
          title="Pull latest transactions from SimpleFin" style={{ fontSize: 13 }}>
          {syncing ? 'Syncing…' : '↻ Sync'}
        </button>
      </div>

      {!data.has_simplefin && <SetupBanner onSetup={load} />}

      {/* Duplicate account warnings from sync */}
      {syncWarnings.length > 0 && (
        <div style={{
          background: 'rgba(255,59,48,0.06)', border: '1px solid rgba(255,59,48,0.25)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)' }}>
              ⚠ Duplicate accounts detected during sync
            </span>
          </div>
          {syncWarnings.map((w, i) => (
            <div key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{w}</div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
            These accounts were imported as inactive. Review them in the Accounts page and deactivate any duplicates.
          </div>
        </div>
      )}

      {/* Overdraft warnings */}
      {data.overdraft_warnings?.length > 0 && (
        <div style={{
          background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.3)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--orange, #FF9500)' }}>
              Overdraft Warning — Bills may not cover upcoming payments
            </span>
          </div>
          {data.overdraft_warnings.map((w, i) => {
            const d = new Date(w.due_date + 'T12:00:00')
            const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            return (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                fontSize: 13, padding: '4px 0',
                borderTop: i === 0 ? 'none' : '1px solid rgba(255,149,0,0.15)',
              }}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {w.bill_name}
                  <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> · {dateStr}</span>
                </span>
                <span style={{ color: 'var(--orange, #FF9500)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {money(w.amount)} — short by {money(w.shortfall)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Low balance warning */}
      {data.low_balance_warning && (
        <div style={{
          background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.25)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span style={{ fontSize: 14, color: 'var(--red)', fontWeight: 500 }}>
            Low balance — Bills account {money(billsBal)} is below the {money(data.low_balance_threshold)} threshold
          </span>
        </div>
      )}

      {/* ── Cards 1 + 2: side-by-side on tablet/desktop ────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isWide ? '1fr 1fr' : '1fr',
        gap: 14,
        marginBottom: 14,
        alignItems: 'start',
      }}>

      {/* ── Card 1: Money Flow ──────────────────────────────────────────────── */}
      <div className="apple-card" style={{ padding: '24px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: 0.8, color: 'var(--text-tertiary)', marginBottom: 6 }}>
          Bills Account
        </div>
        <div style={{ fontSize: numSz, fontWeight: 700, letterSpacing: '-0.05em',
          color: 'var(--text-primary)', lineHeight: 1, marginBottom: 22 }}>
          {money(billsBal)}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0',
          borderTop: '1px solid var(--border)', fontSize: 14 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Monthly income</span>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(monthlyIncome)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0',
          borderTop: '1px solid var(--border)', fontSize: 14 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Monthly bills</span>
          <span style={{ fontWeight: 600, color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>−{money(monthlyBills)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0',
          borderTop: '1px solid var(--border)', borderBottom: '2px solid var(--border)', fontSize: 14,
          marginBottom: 14 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Left after bills</span>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums',
            color: monthlySurplus >= 0 ? 'var(--accent-text)' : 'var(--red)' }}>
            {money(monthlySurplus)}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          paddingBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)' }}>
            Suggested transfer to Food
          </span>
          <span style={{ fontSize: isMobile ? 30 : 34, fontWeight: 700, letterSpacing: '-0.04em',
            color: 'var(--accent-text)', fontVariantNumeric: 'tabular-nums' }}>
            {money(suggestedXfer)}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10, textAlign: 'right' }}>
          Next transfer: {xferDate}{daysToXfer === 0 ? ' (today)' : daysToXfer === 1 ? ' (tomorrow)' : ` (${daysToXfer} days)`}
        </div>

        {/* Safety buffer row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 10px', background: 'var(--bg-subtle)', borderRadius: 8, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Bills buffer</div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', opacity: 0.7 }}>held in Bills for extra CC payment</div>
          </div>
          {editingBuffer ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>$</span>
              <input
                type="number" min="0" step="50"
                value={bufferInput}
                onChange={e => setBufferInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveBuffer(); if (e.key === 'Escape') setEditingBuffer(false) }}
                autoFocus
                style={{ width: 70, fontSize: 12, padding: '2px 6px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'var(--bg-modal)',
                  color: 'var(--text-primary)', fontFamily: 'inherit' }}
              />
              <button onClick={saveBuffer} disabled={savingBuffer}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: 'none',
                  background: 'var(--blue)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                {savingBuffer ? '…' : 'Save'}
              </button>
              <button onClick={() => setEditingBuffer(false)}
                style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit' }}>
                ✕
              </button>
            </div>
          ) : (
            <button onClick={() => { setBufferInput(String(safeBuffer)); setEditingBuffer(true) }}
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
                background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 5 }}>
              {money(safeBuffer)} <span style={{ fontSize: 10, opacity: 0.6 }}>✎</span>
            </button>
          )}
        </div>

        <button onClick={copyTransfer} style={{
          width: '100%', padding: '12px 0',
          background: copied ? 'rgba(52,199,89,0.12)' : 'var(--bg-subtle)',
          border: `1px solid ${copied ? 'rgba(52,199,89,0.3)' : 'var(--border)'}`,
          borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
          color: copied ? 'var(--accent-text)' : 'var(--text-primary)',
          transition: 'all 0.2s', fontFamily: 'inherit',
        }}>
          {copied ? '✓ Copied' : `Copy ${money(suggestedXfer)}`}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 6 }}>
          Transfer to Food account (5784)
        </div>
      </div>

      {/* ── Card 2: Spending Power ──────────────────────────────────────────── */}
      <div className="apple-card" style={{ padding: '24px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: 0.8, color: 'var(--text-tertiary)', marginBottom: 6 }}>
          Available to Spend
        </div>
        <div style={{ fontSize: numSz, fontWeight: 700, letterSpacing: '-0.05em',
          color: 'var(--accent-text)', lineHeight: 1, marginBottom: 22 }}>
          {money(foodBal)}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0',
          borderTop: '1px solid var(--border)', fontSize: 14 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Food account</span>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(foodBal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0',
          borderTop: '1px solid var(--border)', fontSize: 14 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Next transfer in</span>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {daysToXfer === 0 ? 'today' : daysToXfer === 1 ? 'tomorrow' : `${daysToXfer} days`}
          </span>
        </div>
        {paycheckLabel && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            padding: '10px 0', borderTop: '1px solid var(--border)', fontSize: 14, gap: 12 }}>
            <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>Next paycheck</span>
            <span style={{ fontWeight: 500, color: 'var(--text-primary)', textAlign: 'right' }}>
              {paycheckLabel}
            </span>
          </div>
        )}
      </div>

      </div>{/* end cards grid */}

      <CashFlowTimeline timeline={data.cash_flow_timeline ?? []} billsBal={billsBal} safeBuffer={safeBuffer} isMobile={isMobile} />

    </div>
  )
}
