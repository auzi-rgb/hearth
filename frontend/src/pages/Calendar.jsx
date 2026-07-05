import { useState, useEffect, useCallback } from 'react'

const API = '/hearth/api'

// ── Accent colors — used on left borders and amounts only ─────────────────────
const A = {
  income:   '#16a34a',
  incFaded: '#86efac',
  billUp:   '#7c3aed',
  billPaid: '#9ca3af',
  billPast: '#dc2626',
  billFade: '#c4b5fd',
  txn:      '#3b82f6',
  transfer: '#14b8a6',
}

// Commitment-tier colors for upcoming bill chips — the calendar shows WHAT
// KIND of obligation each day carries, matching the Bills page groups.
const TIER = {
  Recurring:    '#3B82F6',
  Loan:         '#8B5CF6',
  Debt:         '#F59E0B',
  Contribution: '#10B981',
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function money(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  return (v < 0 ? '-$' : '$') + abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// Fluid scale — only for the top-bar chrome; chips and sidebar use fixed px
const t = {
  header:  'clamp(18px, 1.5vw, 26px)',
  nav:     'clamp(13px, 1.1vw, 17px)',
  banner:  'clamp(11px, 0.85vw, 13px)',
  dayHead: 'clamp(9px, 0.7vw, 12px)',
  dayNum:  'clamp(11px, 0.95vw, 15px)',
}

// ── Event chip (Google/Apple Calendar style) ──────────────────────────────────
// White / very-light bg, near-black label, accent only on the left border.
function Chip({ accent, bg, label, onClick, strikethrough, dashed, faded }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: bg || 'var(--bg-card)',
        borderLeft: `3px ${dashed ? 'dashed' : 'solid'} ${accent}`,
        borderRadius: 4,
        padding: '2px 6px',
        marginBottom: 4,
        overflow: 'hidden',
        flexShrink: 0,
        cursor: onClick ? 'pointer' : 'default',
        opacity: faded ? 0.6 : 1,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span style={{
        display: 'block',
        fontSize: 12, fontWeight: 500, lineHeight: 1.4,
        color: strikethrough ? 'var(--text-tertiary)' : 'var(--text-primary)',
        textDecoration: strikethrough ? 'line-through' : 'none',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
    </div>
  )
}

// ── Sidebar section header ────────────────────────────────────────────────────
function SectionHead({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.05em',
      color: 'var(--text-tertiary)',
      paddingBottom: 8, marginBottom: 2,
      borderBottom: '1px solid var(--border)',
    }}>
      {children}
    </div>
  )
}

// ── Calendar ──────────────────────────────────────────────────────────────────
export default function Calendar({ active }) {
  const now = new Date()

  const [year,        setYear]        = useState(now.getFullYear())
  const [month,       setMonth]       = useState(now.getMonth() + 1)
  const [data,        setData]        = useState(null)
  const [selected,    setSelected]    = useState(null)
  const [showBalance, setShowBalance] = useState(false)
  const [showPeriods, setShowPeriods] = useState(true)
  const [billsPaid,   setBillsPaid]   = useState({})
  const [recordingXfer, setRecordingXfer] = useState(false)

  const monthStr       = `${year}-${String(month).padStart(2, '0')}`
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
  const isFutureMonth  = new Date(year, month - 1, 1) > new Date(now.getFullYear(), now.getMonth(), 1)

  const load = useCallback(() => {
    if (!active) return
    // Source of truth: bills DB — /api/calendar reads bill_events from bills table
    fetch(`${API}/calendar?month=${monthStr}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
  }, [active, monthStr])

  useEffect(() => { load() }, [load])

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  // ── Grid ──
  const firstDay    = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const numRows     = Math.ceil((firstDay + daysInMonth) / 7)
  const cells       = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length < numRows * 7) cells.push(null)

  const monthName = new Date(year, month - 1, 1)
    .toLocaleString('en-US', { month: 'long', year: 'numeric' })

  function dateKey(d) {
    return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  function getDayData(d) {
    if (!data || !d) return { txns: [], bills: [], pays: [], xfers: [] }
    const k = dateKey(d)
    return {
      txns:  data.transactions_by_date?.[k] || [],
      bills: (data.bill_events    || []).filter(e => e.date === k),
      pays:  (data.pay_events     || []).filter(e => e.date === k),
      xfers: (data.transfer_events || []).filter(e => e.date === k),
    }
  }

  // "Looks paid" suggestions keyed by bill id (suggestion only — confirming is a click)
  const suggestionByBill = {}
  for (const s of (data?.paid_suggestions || [])) suggestionByBill[s.bill_id] = s

  // Pay periods: payday-to-payday bands. A day's period = how many paydays
  // have happened on or before it; alternating bands make the "money I'm
  // living on right now" window visible.
  const payDates = [...new Set((data?.pay_events || []).map(p => p.date))].sort()
  function periodIndex(d) {
    const k = dateKey(d)
    let idx = 0
    for (const pd of payDates) { if (pd <= k) idx++ }
    return idx
  }
  // Bills + contributions due within each period, keyed by the payday that opens it
  const periodOut = {}
  if (payDates.length) {
    for (let i = 0; i < payDates.length; i++) {
      const from = payDates[i]
      const to = payDates[i + 1] || '9999-12-31'
      periodOut[from] = (data?.bill_events || [])
        .filter(e => e.date >= from && e.date < to && !e.paid)
        .reduce((s, e) => s + (e.amount || 0), 0)
    }
  }

  // ── Bill paid helpers ──
  function isPaid(bill) {
    const key = `${bill.id}_${monthStr}`
    if (key in billsPaid) return billsPaid[key]
    return bill.paid || false
  }

  async function togglePaid(bill, e) {
    e.stopPropagation()
    const key    = `${bill.id}_${monthStr}`
    const newVal = !isPaid(bill)
    setBillsPaid(prev => ({ ...prev, [key]: newVal }))
    try {
      await fetch(`${API}/bills/${bill.id}/paid`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paid: newVal, month: monthStr,
          paid_date: new Date().toISOString().split('T')[0],
        }),
      })
    } catch {}
  }

  // ── Bill status helpers ──
  function billStatus(bill, d) {
    if (isPaid(bill)) return 'paid'
    if (isFutureMonth) return 'future'
    const billDate  = new Date(year, month - 1, d)
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return billDate < todayDate ? 'pastdue' : 'upcoming'
  }

  function billAccent(status, bill) {
    if (status === 'paid')    return A.billPaid
    if (status === 'pastdue') return A.billPast
    if (status === 'future')  return A.billFade
    return TIER[bill?.payment_type] || A.billUp
  }

  async function confirmPaid(bill, sug) {
    const key = `${bill.id}_${monthStr}`
    setBillsPaid(prev => ({ ...prev, [key]: true }))
    try {
      await fetch(`${API}/bills/${bill.id}/paid`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid: true, month: monthStr, paid_date: sug.txn_date }),
      })
      load()
    } catch {}
  }

  async function recordTransfer(amount, dateStr) {
    setRecordingXfer(true)
    try {
      await fetch(`${API}/transfers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, transfer_date: dateStr, suggested_amount: data?.suggested_transfer ?? null }),
      })
      load()
    } catch {}
    setRecordingXfer(false)
  }

  function billChipBg(status) {
    if (status === 'paid')    return 'var(--bg-subtle)'
    if (status === 'pastdue') return 'rgba(220,38,38,0.05)'
    return 'var(--bg-card)'
  }

  // ── Paycheck variance ──
  function varianceInfo(pay) {
    if (!pay.variance_status) return null
    if (pay.variance_status === 'ok')       return { icon: '✓', color: A.income,  label: 'Arrived as expected' }
    if (pay.variance_status === 'variance') return { icon: '⚠', color: '#d97706', label: 'Amount different from expected' }
    if (pay.variance_status === 'missing')  return { icon: '✕', color: A.billPast, label: 'Expected but not received' }
    return null
  }

  // ── Running balance ── (red when a projected day dips below the safe-spend buffer)
  // Current month: driven by the SAME day-by-day simulation the Dashboard's
  // safe-to-transfer uses, so the two can never disagree. Other months fall
  // back to the simple client-side walk.
  const threshold    = data?.safe_spend_buffer ?? 200
  const dailyBalance = {}
  if (showBalance && data) {
    if (isCurrentMonth && data.cash_flow_timeline?.length) {
      const byDate = {}
      for (const e of data.cash_flow_timeline) byDate[e.date] = e.balance
      let last = data.bills_account_balance || 0
      for (let d = now.getDate(); d <= daysInMonth; d++) {
        const k = dateKey(d)
        if (byDate[k] != null) last = byDate[k]
        dailyBalance[d] = last
      }
    } else {
      let bal = data.bills_account_balance || 0
      for (let d = 1; d <= daysInMonth; d++) {
        const { bills, pays } = getDayData(d)
        for (const p of pays) bal += (p.amount || 0)
        for (const b of bills) { if (!isPaid(b)) bal -= (b.amount || 0) }
        dailyBalance[d] = bal
      }
    }
  }

  // The single most important date of the month: the simulation's projected
  // low point — the day that constrains what's safe to transfer.
  const lowPointKey = data?.low_point?.date || null

  // ── Month summary — honest math: full expected income for the month, not
  // just what has landed so far (that comparison produced meaningless nets) ──
  const monthSummary = data ? (() => {
    const income = data.expected_income ?? (data.pay_events || [])
      .filter(p => !p.projected)
      .reduce((s, p) => s + (p.amount || 0), 0)
    const received = (data.pay_events || [])
      .filter(p => !p.projected)
      .reduce((s, p) => s + (p.amount || 0), 0)
    const bills  = (data.bill_events || [])
      .reduce((s, b) => s + (b.amount || 0), 0)
    const spent  = Object.values(data.transactions_by_date || {})
      .flat()
      .reduce((s, txn) => txn.amount < 0 ? s + Math.abs(txn.amount) : s, 0)
    return { income, received, bills, spent, afterBills: income - bills }
  })() : null

  const todayNum = now.getDate()
  const selKey   = selected ? dateKey(selected) : null
  const selData  = selected ? getDayData(selected) : null

  // Sidebar cash flow
  const selFlow = selData ? (() => {
    const income   = selData.pays.reduce((s, p) => s + (p.amount || 0), 0)
    const billsOut = selData.bills.filter(b => !isPaid(b)).reduce((s, b) => s + (b.amount || 0), 0)
    const txnOut   = selData.txns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
    const txnIn    = selData.txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
    const totalIn  = income + txnIn
    const totalOut = billsOut + txnOut
    return { in: totalIn, out: totalOut, net: totalIn - totalOut }
  })() : null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      padding: '12px 16px', boxSizing: 'border-box', gap: 8,
    }}>

      {/* ── Top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: t.header, fontWeight: 700, letterSpacing: '-0.05em', margin: 0, flexShrink: 0 }}>
          Calendar
        </h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button className="apple-btn-secondary" onClick={prevMonth}
            style={{ padding: '4px 12px', fontSize: 16, lineHeight: 1 }}>‹</button>
          <span style={{ fontSize: t.nav, fontWeight: 600, minWidth: 'clamp(140px, 12vw, 200px)', textAlign: 'center' }}>
            {monthName}
          </span>
          <button className="apple-btn-secondary" onClick={nextMonth}
            style={{ padding: '4px 12px', fontSize: 16, lineHeight: 1 }}>›</button>
        </div>

        {/* Show Balance toggle */}
        <button
          onClick={() => setShowBalance(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: t.banner, fontWeight: 500,
            background: showBalance ? 'rgba(22,163,74,0.1)' : 'var(--bg-subtle)',
            color: showBalance ? A.income : 'var(--text-secondary)',
            border: showBalance ? `1px solid rgba(22,163,74,0.3)` : '1px solid transparent',
            borderRadius: 20, padding: '4px 12px', cursor: 'pointer',
            flexShrink: 0, transition: 'all 0.15s ease',
          }}
        >
          💰 {showBalance ? 'Balance On' : 'Show Balance'}
        </button>

        {/* Pay-period bands toggle */}
        <button
          onClick={() => setShowPeriods(v => !v)}
          title="Shade the calendar payday-to-payday — each band is one paycheck's window"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: t.banner, fontWeight: 500,
            background: showPeriods ? 'rgba(22,163,74,0.1)' : 'var(--bg-subtle)',
            color: showPeriods ? A.income : 'var(--text-secondary)',
            border: showPeriods ? '1px solid rgba(22,163,74,0.3)' : '1px solid transparent',
            borderRadius: 20, padding: '4px 12px', cursor: 'pointer',
            flexShrink: 0, transition: 'all 0.15s ease',
          }}
        >
          ⬒ Periods
        </button>

        <div style={{ flex: 1 }} />

        {/* Legend */}
        <div style={{
          display: 'flex', gap: 'clamp(8px, 1vw, 14px)',
          fontSize: t.banner, color: 'var(--text-secondary)',
          flexShrink: 0, flexWrap: 'wrap', alignItems: 'center',
        }}>
          {[
            { color: A.income,          label: 'Paycheck'     },
            { color: TIER.Recurring,    label: 'Bill'          },
            { color: TIER.Debt,         label: 'Debt'          },
            { color: TIER.Contribution, label: 'Contribution'  },
            { color: A.transfer,        label: 'Transfer'      },
            { color: A.billPast,        label: 'Past due'      },
            { color: A.billPaid,        label: 'Paid'          },
          ].map(({ color, label }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                display: 'inline-block', width: 10, flexShrink: 0,
                height: 10, borderRadius: 2, background: color,
              }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Future-month banner ── */}
      {isFutureMonth && (
        <div style={{
          flexShrink: 0, fontSize: t.banner, fontWeight: 500, color: '#7c3aed',
          padding: '7px 14px',
          background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.18)',
          borderRadius: 8,
        }}>
          📅 Showing projected data — no transactions yet
        </div>
      )}

      {/* ── Month summary bar ── */}
      {monthSummary && (
        <div style={{
          flexShrink: 0, display: 'flex', gap: 'clamp(10px, 1.2vw, 20px)',
          flexWrap: 'wrap', alignItems: 'center',
          padding: '7px 14px',
          background: 'var(--bg-subtle)', borderRadius: 8, fontSize: t.banner,
        }}>
          <span style={{ color: A.income, fontWeight: 600 }}
            title={`Full month expected — ${money(monthSummary.received)} received so far`}>
            💰 Income {money(monthSummary.income)}
            {monthSummary.received < monthSummary.income && (
              <span style={{ fontWeight: 400, opacity: 0.75 }}> ({money(monthSummary.received)} in)</span>
            )}
          </span>
          <span style={{ color: 'var(--text-tertiary)' }}>·</span>
          <span style={{ color: A.billUp,   fontWeight: 600 }}>📋 Bills {money(monthSummary.bills)}</span>
          <span style={{ color: 'var(--text-tertiary)' }}>·</span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>🛒 Spent {money(monthSummary.spent)}</span>
          <span style={{ color: 'var(--text-tertiary)' }}>·</span>
          <span style={{ fontWeight: 700, color: monthSummary.afterBills >= 0 ? A.income : A.billPast }}
            title="Expected income minus every obligation due this month">
            Left after bills {money(monthSummary.afterBills)}
          </span>
          {data?.low_point && (
            <>
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              <span style={{ fontWeight: 600, color: data.low_point.balance < threshold ? A.billPast : 'var(--text-secondary)' }}
                title={`The simulation's tightest day — right after ${data.low_point.label}. This is what limits safe-to-transfer.`}>
                ▼ Low {money(data.low_point.balance)} on {new Date(data.low_point.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </>
          )}
        </div>
      )}

      {/* ── Main area ── */}
      <div className="calendar-main-area" style={{ flex: 1, display: 'flex', gap: 12, overflow: 'hidden', minHeight: 0 }}>

        {/* ── Calendar grid card ── */}
        <div className="apple-card" style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          padding: 'clamp(8px, 0.8vw, 12px)', overflow: 'hidden', minWidth: 0,
        }}>

          {/* Day-of-week headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 2, marginBottom: 6, flexShrink: 0,
          }}>
            {DAYS.map(d => (
              <div key={d} style={{
                textAlign: 'center', fontSize: t.dayHead, fontWeight: 600,
                color: 'var(--text-tertiary)', padding: '2px 0',
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div style={{
            flex: 1, display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gridTemplateRows: `repeat(${numRows}, 1fr)`,
            gap: 3, minHeight: 0,
          }}>
            {cells.map((d, i) => {
              // Empty (padding) cell
              if (!d) return (
                <div key={`e-${i}`} style={{
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-subtle)',
                  opacity: 0.35,
                }} />
              )

              const { txns, bills, pays, xfers } = getDayData(d)
              const isToday = isCurrentMonth && d === todayNum
              const isSel   = d === selected
              const isLowPoint = lowPointKey === dateKey(d)
              const isPayday = payDates.includes(dateKey(d))

              // Show up to 2 chips (pays, then transfers, then bills), then "+N more"
              const pVis = Math.min(pays.length, 2)
              const tVis = Math.min(xfers.length, Math.max(0, 2 - pVis))
              const bVis = Math.min(bills.length, Math.max(0, 2 - pVis - tVis))
              const hiddenCount = (pays.length - pVis) + (xfers.length - tVis) + (bills.length - bVis)

              // Alternate pay-period bands — which paycheck window this day lives in
              const periodBg = showPeriods && payDates.length
                ? (periodIndex(d) % 2 === 1 ? 'rgba(22,163,74,0.045)' : 'transparent')
                : 'transparent'

              return (
                <div
                  key={d}
                  onClick={() => setSelected(isSel ? null : d)}
                  style={{
                    padding: 'clamp(4px, 0.5vw, 8px)',
                    borderRadius: 6,
                    border: isSel      ? '2px solid #3b82f6'
                          : isToday    ? '2px solid #16a34a'
                          : isLowPoint ? '2px solid rgba(220,38,38,0.55)'
                          : '1px solid var(--border)',
                    background: isSel   ? 'rgba(59,130,246,0.06)'
                              : isToday ? 'rgba(22,163,74,0.05)'
                              : periodBg,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    display: 'flex', flexDirection: 'column', minHeight: 0,
                    transition: 'border-color 0.12s, background 0.12s',
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Date number */}
                  <div style={{
                    fontSize: t.dayNum, lineHeight: 1,
                    fontWeight: isToday ? 700 : 400,
                    color: isToday ? '#16a34a' : 'var(--text-primary)',
                    marginBottom: 5, flexShrink: 0,
                  }}>{d}</div>

                  {/* Tight-day marker — the simulation's projected low point */}
                  {isLowPoint && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: A.billPast, marginBottom: 3, flexShrink: 0 }}
                      title={`Lowest projected Bills balance this month — right after ${data.low_point.label}. This day limits safe-to-transfer.`}>
                      ▼ low {money(data.low_point.balance)}
                    </div>
                  )}

                  {/* Payday period micro-summary */}
                  {showPeriods && isPayday && periodOut[dateKey(d)] > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 3, flexShrink: 0 }}
                      title="Unpaid obligations due between this paycheck and the next">
                      {money(periodOut[dateKey(d)])} due this period
                    </div>
                  )}

                  {/* Paycheck chips */}
                  {pays.slice(0, pVis).map((p, j) => {
                    const vi = varianceInfo(p)
                    const name = p.person.charAt(0).toUpperCase() + p.person.slice(1)
                    const suffix = vi ? ` ${vi.icon}` : ''
                    return (
                      <Chip
                        key={`p-${j}`}
                        accent={p.projected ? A.incFaded : A.income}
                        label={name + suffix}
                        dashed={!!p.projected}
                        faded={!!p.projected}
                      />
                    )
                  })}

                  {/* Transfer chips */}
                  {xfers.slice(0, tVis).map((x, j) => (
                    <Chip
                      key={`x-${j}`}
                      accent={A.transfer}
                      label={x.recorded ? `Transfer ✓ ${money(x.amount)}` : 'Transfer day'}
                      dashed={!x.recorded}
                      faded={!x.recorded}
                    />
                  ))}

                  {/* Bill chips */}
                  {bills.slice(0, bVis).map((b, j) => {
                    const status = billStatus(b, d)
                    const sug = status !== 'paid' ? suggestionByBill[b.id] : null
                    return (
                      <Chip
                        key={`b-${j}`}
                        accent={billAccent(status, b)}
                        bg={billChipBg(status)}
                        label={b.name + (sug ? ' ✓?' : '')}
                        strikethrough={status === 'paid'}
                        dashed={status === 'future'}
                        faded={status === 'future'}
                        onClick={e => togglePaid(b, e)}
                      />
                    )
                  })}

                  {/* +N more */}
                  {hiddenCount > 0 && (
                    <div style={{
                      fontSize: 11, color: 'var(--text-tertiary)',
                      fontWeight: 400, marginBottom: 2, flexShrink: 0,
                    }}>
                      +{hiddenCount} more
                    </div>
                  )}

                  {/* Transaction count dot */}
                  {txns.length > 0 && (
                    <div style={{
                      marginTop: 'auto', flexShrink: 0,
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: A.txn, flexShrink: 0,
                      }} />
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400 }}>
                        {txns.length}
                      </span>
                    </div>
                  )}

                  {/* Running balance */}
                  {showBalance && dailyBalance[d] !== undefined && (
                    <div style={{
                      fontSize: 11, fontWeight: 600, flexShrink: 0, marginTop: 2,
                      color: dailyBalance[d] < threshold ? A.billPast : 'var(--text-tertiary)',
                    }}>
                      {money(dailyBalance[d])}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Detail sidebar ── */}
        <div className="apple-card calendar-sidebar" style={{
          width: 'clamp(210px, 21vw, 300px)', flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          padding: 16, overflow: 'hidden',
        }}>

          {!selected ? (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 10, color: 'var(--text-tertiary)', textAlign: 'center',
            }}>
              <div style={{ fontSize: 32 }}>📅</div>
              <div style={{ fontSize: 13 }}>Click any day to see its details</div>
            </div>
          ) : (
            <>
              {/* Date heading */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, color: 'var(--text-primary)' }}>
                  {new Date(selKey + 'T12:00:00').toLocaleDateString('en-US', {
                    weekday: 'long', month: 'long', day: 'numeric',
                  })}
                </div>
                <button onClick={() => setSelected(null)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 16, color: 'var(--text-tertiary)', padding: '0 0 0 8px',
                  lineHeight: 1, flexShrink: 0,
                }}>✕</button>
              </div>

              {/* Scrollable content */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Income */}
                {selData.pays.length > 0 && (
                  <div>
                    <SectionHead>Income</SectionHead>
                    {selData.pays.map((p, i) => {
                      const vi = varianceInfo(p)
                      return (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center',
                          minHeight: 40, gap: 10,
                          borderBottom: '1px solid var(--border)',
                        }}>
                          <span style={{ fontSize: 15, flexShrink: 0 }}>💵</span>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, overflow: 'hidden' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{p.person}</span>
                            {p.projected && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>(est.)</span>}
                            {vi && <span title={vi.label} style={{ color: vi.color, fontWeight: 700, flexShrink: 0 }}>{vi.icon}</span>}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: A.income, flexShrink: 0 }}>
                            {money(p.amount)}
                          </span>
                        </div>
                      )
                    })}
                    {/* Variance detail rows */}
                    {selData.pays.map((p, i) => {
                      const vi = varianceInfo(p)
                      if (!vi || vi.icon === '✓') return null
                      return (
                        <div key={`v-${i}`} style={{ fontSize: 11, color: vi.color, paddingBottom: 6, display: 'flex', gap: 10 }}>
                          {vi.icon === '⚠' && p.expected_amount != null ? (
                            <>
                              <span>Expected: {money(p.expected_amount)}</span>
                              <span>Actual: {money(p.actual_amount)}</span>
                            </>
                          ) : vi.icon === '✕' ? (
                            <span>Expected but not yet received</span>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Transfers */}
                {selData.xfers.length > 0 && (
                  <div>
                    <SectionHead>Transfer</SectionHead>
                    {selData.xfers.map((x, i) => (
                      <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                        {x.recorded ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>Recorded ✓</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: A.transfer }}>{money(x.amount)}</span>
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Scheduled transfer day</div>
                            {data?.suggested_transfer != null && (
                              <button
                                onClick={() => recordTransfer(data.suggested_transfer, selKey)}
                                disabled={recordingXfer || data.suggested_transfer <= 0}
                                className="apple-btn-primary"
                                style={{ fontSize: 12, width: '100%' }}
                                title="Records the current safe-to-transfer amount as moved on this day"
                              >
                                {recordingXfer ? '…' : `Record transfer of ${money(data.suggested_transfer)}`}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Bills */}
                {selData.bills.length > 0 && (
                  <div>
                    <SectionHead>Bills Due</SectionHead>
                    {selData.bills.map((b, i) => {
                      const status = billStatus(b, selected)
                      const accent = billAccent(status, b)
                      const paid   = isPaid(b)
                      const sug    = !paid ? suggestionByBill[b.id] : null
                      return (
                        <div key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <div style={{
                            display: 'flex', alignItems: 'center',
                            minHeight: 40, gap: 10,
                          }}>
                            {/* Paid checkbox */}
                            <button
                              onClick={e => togglePaid(b, e)}
                              title={paid ? 'Mark unpaid' : 'Mark paid'}
                              style={{
                                width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                                border: `1.5px solid ${accent}`,
                                background: paid ? accent : 'transparent',
                                cursor: 'pointer', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', fontSize: 10, color: '#fff',
                                transition: 'all 0.15s',
                              }}
                            >{paid ? '✓' : ''}</button>
                            <span style={{
                              flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              color: paid ? 'var(--text-tertiary)' : 'var(--text-primary)',
                              textDecoration: paid ? 'line-through' : 'none',
                            }}>{b.name}</span>
                            <span style={{
                              fontSize: 13, fontWeight: 700, flexShrink: 0,
                              color: paid ? A.billPaid : accent,
                            }}>{money(b.amount)}</span>
                          </div>
                          {sug && (
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '0 0 8px 28px', fontSize: 11, color: 'var(--text-secondary)',
                            }}>
                              <span>Looks paid — {money(sug.amount)} on {new Date(sug.txn_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              <button
                                onClick={() => confirmPaid(b, sug)}
                                style={{
                                  fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                                  background: 'rgba(22,163,74,0.1)', color: A.income,
                                  border: '1px solid rgba(22,163,74,0.3)', borderRadius: 5, padding: '2px 8px',
                                }}>
                                Confirm
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Transactions */}
                {selData.txns.length > 0 && (
                  <div>
                    <SectionHead>Transactions ({selData.txns.length})</SectionHead>
                    {selData.txns.slice(0, 20).map((txn, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center',
                        minHeight: 40, gap: 10,
                        borderBottom: '1px solid var(--border)',
                      }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: A.txn, flexShrink: 0,
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {txn.description || '—'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{txn.account}</div>
                        </div>
                        <span style={{
                          fontSize: 13, fontWeight: 600, flexShrink: 0,
                          color: txn.amount >= 0 ? A.income : A.billPast,
                        }}>
                          {money(txn.amount)}
                        </span>
                      </div>
                    ))}
                    {selData.txns.length > 20 && (
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>
                        +{selData.txns.length - 20} more
                      </div>
                    )}
                  </div>
                )}

                {/* Empty state */}
                {selData.pays.length === 0 && selData.bills.length === 0 && selData.txns.length === 0 && selData.xfers.length === 0 && (
                  <div style={{
                    flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: 8, color: 'var(--text-tertiary)', textAlign: 'center', padding: '24px 0',
                  }}>
                    <div style={{ fontSize: 28 }}>📅</div>
                    <div style={{ fontSize: 13 }}>Nothing scheduled</div>
                  </div>
                )}
              </div>

              {/* Net for the day — elevated card */}
              {selFlow && (selFlow.in > 0 || selFlow.out > 0) && (
                <div style={{
                  marginTop: 14, flexShrink: 0,
                  padding: '12px 14px',
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    color: 'var(--text-tertiary)', marginBottom: 6,
                  }}>
                    Net for the day
                  </div>
                  <div style={{
                    fontSize: 20, fontWeight: 700,
                    color: selFlow.net >= 0 ? A.income : A.billPast,
                  }}>
                    {selFlow.net >= 0 ? '+' : ''}{money(selFlow.net)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 5, display: 'flex', gap: 14 }}>
                    <span>↑ {money(selFlow.in)}</span>
                    <span>↓ {money(selFlow.out)}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
