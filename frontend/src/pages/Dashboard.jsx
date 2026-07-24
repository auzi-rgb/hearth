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
  const [briefing, setBriefing] = useState(null)
  const [briefingOpen, setBriefingOpen] = useState(true)
  const [recordingXfer, setRecordingXfer] = useState(false)
  const [xferAmount, setXferAmount] = useState('')
  const [savingXfer, setSavingXfer] = useState(false)
  const [editingSched, setEditingSched] = useState(false)
  const [schedMode, setSchedMode] = useState('days')
  const [schedDays, setSchedDays] = useState('1, 15')
  const [savingSched, setSavingSched] = useState(false)
  const timerRef = useRef(null)
  const isMobile = useIsMobile()
  const isWide   = useIsWide()

  const load = useCallback(async () => {
    try {
      const dash = await fetch(`${API}/dashboard`).then(r => r.json())
      setData(dash)
    } catch {}
    try {
      const b = await fetch(`${API}/ai/briefing`).then(r => r.json())
      setBriefing(b?.content ? b : null)
    } catch {}
    try {
      const s = await fetch(`${API}/settings`).then(r => r.json())
      const sched = JSON.parse(s.transfer_schedule || '{}')
      if (sched.mode === 'payday') setSchedMode('payday')
      else if (Array.isArray(sched.days)) { setSchedMode('days'); setSchedDays(sched.days.join(', ')) }
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

  async function recordTransfer() {
    const val = parseFloat(xferAmount)
    if (isNaN(val) || val <= 0) return
    setSavingXfer(true)
    try {
      await fetch(`${API}/transfers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: val, suggested_amount: data?.suggested_transfer ?? null }),
      })
      setRecordingXfer(false)
      await load()
    } catch {}
    setSavingXfer(false)
  }

  async function saveSchedule() {
    setSavingSched(true)
    try {
      const sched = schedMode === 'payday'
        ? { mode: 'payday' }
        : { mode: 'days', days: schedDays.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n >= 1 && n <= 28) }
      await fetch(`${API}/settings/transfer_schedule`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(sched) }),
      })
      setEditingSched(false)
      await load()
    } catch {}
    setSavingSched(false)
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
  const xferDate        = data.next_transfer_date
    ? new Date(data.next_transfer_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—'
  const daysToXfer      = data.days_until_next_transfer ?? 0
  const lastXfer        = data.last_transfer
  const allowance       = data.food_daily_allowance
  const pace            = data.food_daily_pace
  const overPace        = allowance != null && pace != null && pace > allowance
  const safeBuffer      = data.safe_spend_buffer        ?? 200
  const needForBills    = data.bills_until_next_paycheck ?? 0
  const needByDate      = data.bills_until_next_paycheck_date
    ? new Date(data.bills_until_next_paycheck_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null
  const incomingPay     = data.incoming_next_paycheck
  const billsCovered    = billsBal >= needForBills

  // Next paycheck = the next one still COMING (from the cash-flow projection),
  // not today's already-deposited one. Using the projection's next-paycheck date
  // keeps this label consistent with the "Needed for bills until next paycheck"
  // card instead of showing "today" for a paycheck that already landed.
  let paycheckLabel = null
  if (data.bills_until_next_paycheck_date) {
    // Anchor both dates at local midnight so the day-count is exact — parsing d at
    // noon while t is midnight added a half day and made Math.round overcount by 1
    // (tomorrow showed as "2 days"). The T00:00:00 keeps it local (a bare date
    // string would parse as UTC and could slip a day in a negative offset).
    const d = new Date(data.bills_until_next_paycheck_date + 'T00:00:00')
    const t = new Date(); t.setHours(0, 0, 0, 0)
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' })
    const dateStr  = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const days = Math.round((d - t) / 86400000)
    const daysStr = days <= 0 ? 'soon' : days === 1 ? 'tomorrow' : `${days} days`
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

      {/* ── Coach briefing (generated overnight by the AI, numbers precomputed) ── */}
      {briefing && (
        <div className="apple-card" style={{ padding: '18px 22px', marginBottom: 16, borderLeft: '3px solid var(--accent)' }}>
          <div onClick={() => setBriefingOpen(o => !o)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-tertiary)' }}>
              Morning Briefing
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>
                {briefing.briefing_date}
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', transform: briefingOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
          </div>
          {briefingOpen && (
            <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.65, marginTop: 10 }}>
              {briefing.content}
            </div>
          )}
        </div>
      )}

      {/* ── Debt countdown ─────────────────────────────────────────────────── */}
      {(data.debt_total ?? 0) > 0 && (
        <div className="apple-card" onClick={() => navigateTo?.('debt')}
          style={{ padding: '16px 22px', marginBottom: 16, cursor: 'pointer',
            display: 'flex', flexWrap: 'wrap', gap: isMobile ? 12 : 26, alignItems: 'baseline' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-tertiary)' }}>Debt-free</div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em' }}>
              {data.debt_free_date
                ? new Date(data.debt_free_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                : '—'}
              {data.debt_free_months != null && (
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                  {data.debt_free_months} mo
                </span>
              )}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-tertiary)' }}>Remaining</div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{money(data.debt_total)}</div>
          </div>
          {data.debt_change_month != null && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-tertiary)' }}>This month</div>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
                color: data.debt_change_month <= 0 ? 'var(--accent-text)' : 'var(--red)' }}>
                {data.debt_change_month <= 0 ? '↓' : '↑'}{money(Math.abs(data.debt_change_month))}
              </div>
            </div>
          )}
          {data.debt_focus && (
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-tertiary)' }}>Focus next</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{data.debt_focus}</div>
            </div>
          )}
        </div>
      )}

      {/* ── True surplus: simulation says there's more than the usual transfer ── */}
      {data.sweep_suggestion && (
        <div className="apple-card" style={{ padding: '16px 22px', marginBottom: 16, borderLeft: '3px solid var(--accent)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            True surplus available: <span style={{ color: 'var(--accent-text)', fontVariantNumeric: 'tabular-nums' }}>{money(data.sweep_suggestion.amount)}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Today's safe-to-transfer runs {money(data.sweep_suggestion.amount)} above your typical transfer
            of {money(data.sweep_suggestion.typical_transfer)}. The simulation reserved every upcoming bill —
            including next month's first week — before saying this, so it's genuinely free.
          </div>
        </div>
      )}

      {/* ── The plan: committed budget → planned transfers → surplus to debt ── */}
      {data.planned_transfers?.transfers?.length > 0 && (
        <div className="apple-card" style={{ padding: '16px 22px', marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 14 : 26, alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-tertiary)' }}>Budget / mo</div>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{money(data.committed_budget)}</div>
            </div>
            {data.planned_transfers.transfers.map((tr, i) => (
              <div key={i}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-tertiary)' }}>
                  Transfer {new Date(tr.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {tr.shifted && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }} title={`Moved from ${tr.scheduled_date} to land after payday`}> ✦</span>}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', color: 'var(--blue)' }}>
                  {money(tr.amount)}{tr.capped && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--orange, #FF9500)' }}> capped</span>}
                </div>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-tertiary)' }}>Surplus to debt</div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
                color: (data.budget_surplus ?? 0) >= 0 ? 'var(--accent-text)' : 'var(--red)' }}>
                {money(data.budget_surplus)}/mo
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.5 }}>
            Fund Food with your budget across two transfers; the surplus is what's left for debt.
            {data.planned_transfers.transfers.some(tr => tr.shifted && !tr.capped) && ' A ✦ transfer moved a day or two to land after payday.'}
            {data.planned_transfers.transfers.some(tr => tr.capped) && ' A transfer is still capped — Bills would dip below your buffer even after shifting; move the rest once more income lands.'}
            {' '}Adjust and Commit on the Budget tab.
          </div>
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
          <span style={{ color: 'var(--text-secondary)' }} title="A normal month's income (baseline) minus monthly bills — the sustainable surplus. This month's actual income is higher because a paycheck arrived early, and that extra is reserved for next month's first bills, so it isn't counted here. For what's actually movable today, use 'Safe to move now'.">
            Typical cash beyond bills <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>(normal month)</span>
          </span>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums',
            color: monthlySurplus >= 0 ? 'var(--accent-text)' : 'var(--red)' }}>
            {money(monthlySurplus)}
          </span>
        </div>

        {/* The math behind "Safe to move now", shown explicitly:
            what's in Bills − bills due before the next paycheck − buffer.
            All three come from the same day-by-day simulation. */}
        <div style={{ padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6,
            color: 'var(--text-tertiary)', marginBottom: 8 }}>
            How much is safe to move
          </div>
          {[
            { label: "What's in Bills now", val: money(billsBal) },
            { label: `− Bills due before next paycheck${needByDate ? ` (${needByDate})` : ''}`,
              val: '−' + money(needForBills), red: !billsCovered },
            { label: '− Safety buffer', val: '−' + money(safeBuffer) },
          ].map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0',
              color: r.red ? 'var(--red)' : 'var(--text-secondary)' }}>
              <span title={r.red ? 'These bills exceed your current balance — a paycheck must land first' : undefined}>{r.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.val}</span>
            </div>
          ))}
          {needByDate && incomingPay != null && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
              {money(incomingPay)} in pay lands {needByDate}, refilling Bills for the weeks after.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          paddingBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)' }}
            title="The most you could safely move to Food today without risking autopay — a ceiling, not the plan. Your planned budget transfers are in the Plan strip above and on the Calendar.">
            Safe to move now
          </span>
          <span style={{ fontSize: isMobile ? 30 : 34, fontWeight: 700, letterSpacing: '-0.04em',
            color: 'var(--accent-text)', fontVariantNumeric: 'tabular-nums' }}>
            {money(suggestedXfer)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Next transfer: {xferDate}{daysToXfer === 0 ? ' (today)' : daysToXfer === 1 ? ' (tomorrow)' : ` (${daysToXfer} days)`}
          </span>
          <button onClick={() => setEditingSched(s => !s)} title="Edit transfer schedule"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-tertiary)', padding: 0, fontFamily: 'inherit' }}>
            ✎
          </button>
        </div>
        {editingSched && (
          <div style={{ padding: '10px 12px', background: 'var(--bg-subtle)', borderRadius: 8, marginBottom: 12,
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="apple-select" value={schedMode} onChange={e => setSchedMode(e.target.value)} style={{ fontSize: 12 }}>
              <option value="days">Days of month</option>
              <option value="payday">On paydays</option>
            </select>
            {schedMode === 'days' && (
              <input className="apple-input" value={schedDays} onChange={e => setSchedDays(e.target.value)}
                placeholder="1, 15" style={{ width: 90, fontSize: 12, padding: '4px 8px' }} />
            )}
            <button onClick={saveSchedule} disabled={savingSched}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none',
                background: 'var(--blue)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
              {savingSched ? '…' : 'Save'}
            </button>
            <button onClick={() => setEditingSched(false)}
              style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit' }}>
              ✕
            </button>
          </div>
        )}

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

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={copyTransfer} style={{
            flex: 1, padding: '12px 0',
            background: copied ? 'rgba(52,199,89,0.12)' : 'var(--bg-subtle)',
            border: `1px solid ${copied ? 'rgba(52,199,89,0.3)' : 'var(--border)'}`,
            borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            color: copied ? 'var(--accent-text)' : 'var(--text-primary)',
            transition: 'all 0.2s', fontFamily: 'inherit',
          }}>
            {copied ? '✓ Copied' : `Copy ${money(suggestedXfer)}`}
          </button>
          <button onClick={() => { setXferAmount(String(Number(suggestedXfer).toFixed(2))); setRecordingXfer(r => !r) }} style={{
            flex: 1, padding: '12px 0',
            background: 'var(--bg-subtle)', border: '1px solid var(--border)',
            borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            color: 'var(--text-primary)', fontFamily: 'inherit',
          }}>
            Record transfer
          </button>
        </div>
        {recordingXfer && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10,
            padding: '10px 12px', background: 'var(--bg-subtle)', borderRadius: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', flexShrink: 0 }}>I moved $</span>
            <input type="number" min="0" step="0.01" value={xferAmount} autoFocus
              onChange={e => setXferAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') recordTransfer(); if (e.key === 'Escape') setRecordingXfer(false) }}
              style={{ flex: 1, minWidth: 70, fontSize: 13, padding: '4px 8px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--bg-modal)',
                color: 'var(--text-primary)', fontFamily: 'inherit' }} />
            <button onClick={recordTransfer} disabled={savingXfer}
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: 'none',
                background: 'var(--blue)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
              {savingXfer ? '…' : 'Save'}
            </button>
            <button onClick={() => setRecordingXfer(false)}
              style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit' }}>
              ✕
            </button>
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 6 }}>
          {lastXfer
            ? `Last recorded: ${money(lastXfer.amount)} on ${new Date(lastXfer.transfer_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : 'Transfer to the Food account, then record it to track your real spending rate'}
        </div>
        {/* A number you act on is only as good as its inputs — confess freshness */}
        <div style={{ fontSize: 11, textAlign: 'center', marginTop: 4,
          color: data.sync_stale ? 'var(--red)' : 'var(--text-tertiary)' }}>
          {data.sync_stale
            ? `⚠ Balances are stale${data.last_sync_at ? ` — last sync ${new Date(data.last_sync_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}. Sync before trusting this number.`
            : data.last_sync_at
              ? `Based on balances synced ${new Date(data.last_sync_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
              : null}
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
        {allowance != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0',
            borderTop: '1px solid var(--border)', fontSize: 14 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Runway until then</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(allowance)}/day</span>
          </div>
        )}
        {pace != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0',
            borderTop: '1px solid var(--border)', fontSize: 14 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Actual pace (14 days)</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              color: overPace ? 'var(--red)' : 'var(--accent-text)' }}>
              {money(pace)}/day {overPace ? '· over' : '· on track'}
            </span>
          </div>
        )}
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
