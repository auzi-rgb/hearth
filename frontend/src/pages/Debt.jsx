import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
  PieChart, Pie, Cell,
} from 'recharts'
import Portal from '../components/Portal'

const API = '/hearth/api'

const CHART_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#14b8a6', '#a855f7', '#f97316', '#6366f1']

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
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `-$${s}` : `$${s}`
}

function months(n) {
  if (!n) return '—'
  const y = Math.floor(n / 12)
  const m = n % 12
  if (y === 0) return `${m}mo`
  return m === 0 ? `${y}yr` : `${y}yr ${m}mo`
}

function ProgressBar({ value, max, color = 'var(--accent)' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ height: 6, background: 'var(--bg-subtle)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
    </div>
  )
}

function LoanCard({ loan, extra, onExtraChange, onSave, strategies, view }) {
  const payoffInfo = loan.payoff_date
    ? new Date(loan.payoff_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—'
  const paidPct = loan.total_payments > 0 ? ((loan.payments_made / loan.total_payments) * 100).toFixed(0) : 0
  const debtInfo = strategies?.debts?.find(d => d.name === loan.name)
  const [pmtAmount, setPmtAmount] = useState(String(loan.linked_bill_amount || debtInfo?.min_payment || loan.monthly_payment || ''))
  const [settingBill, setSettingBill] = useState(false)
  const [isBilled, setIsBilled] = useState(!!loan.linked_bill_id)
  const [showMath, setShowMath] = useState(false)
  const recommended = strategies?.[view]?.recommended_payments?.find(r => r.name === loan.name)

  async function setBill() {
    if (!pmtAmount) return
    setSettingBill(true)
    try {
      await fetch(`${API}/loans/${loan.id}/set-bill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(pmtAmount), name: loan.name }),
      })
      setIsBilled(true)
      if (onSave) onSave()
    } catch {}
    setSettingBill(false)
  }

  return (
    <div className="apple-card" style={{ padding: '20px 22px 44px', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
            {loan.name}
            {debtInfo && <MathButton onClick={() => setShowMath(true)} />}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{loan.type}</div>
          {recommended?.is_focus && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-text)',
              background: 'rgba(52,199,89,0.1)', padding: '2px 7px', borderRadius: 20, marginTop: 4, display: 'inline-block' }}>
              🎯 Focus
            </span>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--red)' }}>{money(loan.current_balance)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>of {money(loan.original_balance)}</div>
        </div>
      </div>
      {showMath && (
        <DebtMathModal name={loan.name} kind="loan" debtInfo={debtInfo} recommended={recommended} view={view} onClose={() => setShowMath(false)} />
      )}
      <ProgressBar value={loan.payments_made} max={loan.total_payments} color="var(--accent)" />
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, marginBottom: 14 }}>
        {loan.payments_made} of {loan.total_payments} payments ({paidPct}%)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16, fontSize: 12 }}>
        <div><div className="apple-label">Monthly</div><div style={{ fontWeight: 600 }}>{money(loan.monthly_payment)}</div></div>
        <div><div className="apple-label">Rate</div><div style={{ fontWeight: 600 }}>{loan.interest_rate ? `${loan.interest_rate}%` : '—'}</div></div>
        <div><div className="apple-label">Payoff</div><div style={{ fontWeight: 600 }}>{payoffInfo}</div></div>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="apple-label">Extra / month: ${extra}</span>
          {extra > 0 && loan.payoff_projection && (
            <span style={{ fontSize: 11, color: 'var(--accent-text)' }}>
              Save {money(loan.payoff_projection.interest_saved)} · {loan.payoff_projection.months_saved} mo sooner
            </span>
          )}
        </div>
        <input type="range" min={0} max={500} step={25} value={extra} onChange={e => onExtraChange(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-tertiary)' }}><span>$0</span><span>$500</span></div>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 10 }}>
        <div className="apple-label" style={{ marginBottom: 6 }}>Monthly Payment</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="apple-input" type="number" step="1" placeholder="0.00" value={pmtAmount}
            onChange={e => setPmtAmount(e.target.value)}
            style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-text)', width: 110, flex: 'none' }} />
          {isBilled ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-text)',
              background: 'rgba(52,199,89,0.1)', padding: '4px 10px', borderRadius: 20 }}>
              ✓ In Bills
            </span>
          ) : (
            <button className="apple-btn-secondary" onClick={setBill}
              disabled={settingBill || !pmtAmount} style={{ fontSize: 12 }}>
              {settingBill ? 'Setting…' : 'Set as Bill'}
            </button>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 5 }}>
          Day of month can be set in the Bills tab
        </div>
      </div>
    </div>
  )
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function CreditCardDebtEditor({ card, onSave, strategies, view }) {
  const debtInfo = strategies?.debts?.find(d => d.name === card.name)
  const recommended = strategies?.[view]?.recommended_payments?.find(r => r.name === card.name)
  const [editing, setEditing] = useState(false)
  const [apr, setApr] = useState(String(card.interest_rate || ''))
  const [minPmt, setMinPmt] = useState(String(card.minimum_payment || ''))
  const [nickname, setNickname] = useState(card.nickname || '')
  const [saving, setSaving] = useState(false)
  const [pmtAmount, setPmtAmount] = useState(String(card.linked_bill_amount || debtInfo?.min_payment || card.minimum_payment || ''))
  const [frequency, setFrequency] = useState(card.linked_bill_frequency || 'monthly')
  const [dayOfMonth, setDayOfMonth] = useState(String(card.linked_bill_day_of_month || 1))
  const [dayOfWeek, setDayOfWeek] = useState(card.linked_bill_day_of_week ?? 4)
  const [settingBill, setSettingBill] = useState(false)
  const [isBilled, setIsBilled] = useState(!!card.linked_bill_id)
  const [showMath, setShowMath] = useState(false)

  async function setBill() {
    if (!pmtAmount) return
    setSettingBill(true)
    try {
      await fetch(`${API}/debt/set-bill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: card.id, amount: parseFloat(pmtAmount), name: card.name,
          frequency,
          day_of_month: frequency === 'monthly' ? parseInt(dayOfMonth) || 1 : null,
          day_of_week: frequency === 'weekly' ? dayOfWeek : null,
        }),
      })
      setIsBilled(true)
      onSave()
    } catch {}
    setSettingBill(false)
  }

  function openEdit() {
    // Re-seed every field from the current card on each open — otherwise a stale
    // value typed in a previous edit session lingers in state and silently overwrites
    // whatever the card actually has now (this is what was clobbering nicknames).
    setApr(String(card.interest_rate || ''))
    setMinPmt(String(card.minimum_payment || ''))
    setNickname(card.nickname || '')
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    await Promise.all([
      fetch(`${API}/accounts/${card.id}/debt-details`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interest_rate: parseFloat(apr) || 0, minimum_payment: parseFloat(minPmt) || 0 }),
      }),
      fetch(`${API}/accounts/${card.id}/nickname`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname.trim() }),
      }),
    ])
    setSaving(false)
    setEditing(false)
    onSave()
  }

  return (
    <div className="apple-card" style={{ padding: '20px 22px 44px', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
            {card.name}
            {debtInfo && <MathButton onClick={() => setShowMath(true)} />}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{card.institution}</div>
          {recommended?.is_focus && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-text)',
              background: 'rgba(52,199,89,0.1)', padding: '2px 7px', borderRadius: 20, marginTop: 4, display: 'inline-block' }}>
              🎯 Focus
            </span>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--red)' }}>{money(card.balance)}</div>
          {card.mom_change !== 0 && (
            <Tooltip text={card.mom_change < 0 ? "Balance decreased this month — you paid off more than you spent. Keep it up!" : "Balance grew this month — spending exceeded payments. Carrying a balance accrues interest daily."}>
              <div style={{ fontSize: 12, color: card.mom_change < 0 ? 'var(--accent-text)' : 'var(--red)', display: 'inline-block' }}>
                {card.mom_change < 0 ? '↓' : '↑'} {money(Math.abs(card.mom_change))} vs last month
              </div>
            </Tooltip>
          )}
        </div>
      </div>
      {showMath && (
        <DebtMathModal name={card.name} kind="credit_card" debtInfo={debtInfo} recommended={recommended} view={view} onClose={() => setShowMath(false)} />
      )}
      {editing ? (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div className="apple-label" style={{ marginBottom: 5 }}>Display Name</div>
            <input className="apple-input" value={nickname} onChange={e => setNickname(e.target.value)}
              placeholder={card.raw_name} style={{ width: '100%' }} />
          </div>
          <div>
            <div className="apple-label" style={{ marginBottom: 5 }}>Bank Description <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(real line item from your bank — check this against your statement)</span></div>
            <div className="apple-input" style={{ width: '100%', color: 'var(--text-tertiary)', cursor: 'not-allowed' }}>
              {card.raw_name}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <Tooltip text="Annual Percentage Rate — the yearly interest charged on your balance. At 24% APR, a $9,000 balance costs ~$180/month in interest alone if you only pay the minimum.">
                <span className="apple-label">APR %</span>
              </Tooltip>
              <input className="apple-input" type="number" step="0.1" value={apr} onChange={e => setApr(e.target.value)} placeholder="e.g. 24.99" style={{ fontSize: 13, marginTop: 4, width: '100%' }} />
            </div>
            <div>
              <Tooltip text="The smallest amount the card requires each month. Paying only the minimum can take decades to pay off — even small extra payments make a big difference.">
                <span className="apple-label">Min Payment $</span>
              </Tooltip>
              <input className="apple-input" type="number" step="5" value={minPmt} onChange={e => setMinPmt(e.target.value)} placeholder="e.g. 25" style={{ fontSize: 13, width: '100%' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="apple-btn-secondary" onClick={() => setEditing(false)} style={{ flex: 1, fontSize: 12 }}>Cancel</button>
            <button className="apple-btn-primary" onClick={save} disabled={saving} style={{ flex: 1, fontSize: 12 }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <Tooltip text="Annual interest rate. Enter this to enable the payoff strategy comparison above.">
              <span style={{ color: 'var(--text-secondary)' }}>APR: <strong>{card.interest_rate ? `${card.interest_rate}%` : '—'}</strong></span>
            </Tooltip>
            <Tooltip text="The card's required minimum monthly payment. Enter this to enable snowball/avalanche calculations.">
              <span style={{ color: 'var(--text-secondary)' }}>Min: <strong>{card.minimum_payment ? money(card.minimum_payment) : '—'}</strong></span>
            </Tooltip>
          </div>
          <button onClick={openEdit} title="Edit name, APR, and minimum payment"
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '3px 8px', fontFamily: 'inherit', color: 'var(--text-secondary)' }}>
            Edit details
          </button>
        </div>
      )}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="apple-label" style={{ marginBottom: 0 }}>Payment</div>
          {isBilled && (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-text)',
              background: 'rgba(52,199,89,0.1)', padding: '3px 9px', borderRadius: 20 }}>
              ✓ In Bills
            </span>
          )}
        </div>
        <div style={{ display: 'flex', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-pill)', padding: 3, marginBottom: 8, width: 'fit-content' }}>
          {['monthly', 'weekly'].map(f => (
            <button key={f} onClick={() => setFrequency(f)} style={{
              background: frequency === f ? 'var(--bg-card)' : 'transparent', border: 'none', cursor: 'pointer',
              padding: '4px 12px', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: frequency === f ? 600 : 400,
              color: frequency === f ? 'var(--text-primary)' : 'var(--text-secondary)', fontFamily: 'inherit',
              boxShadow: frequency === f ? 'var(--shadow-card)' : 'none', textTransform: 'capitalize',
            }}>{f}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <input className="apple-input" type="number" step="1" placeholder="0.00" value={pmtAmount}
            onChange={e => setPmtAmount(e.target.value)}
            style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-text)', width: 90, flex: 'none' }} />
          {frequency === 'monthly' ? (
            <input className="apple-input" type="number" min="1" max="31" value={dayOfMonth}
              onChange={e => setDayOfMonth(e.target.value)}
              title="Day of month" style={{ fontSize: 13, width: 60, flex: 'none' }} />
          ) : (
            <select className="apple-select" value={dayOfWeek} onChange={e => setDayOfWeek(parseInt(e.target.value))}
              style={{ fontSize: 13, flex: 'none' }}>
              {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
            </select>
          )}
          <button className="apple-btn-secondary" onClick={setBill}
            disabled={settingBill || !pmtAmount} style={{ fontSize: 12 }}>
            {settingBill ? 'Saving…' : isBilled ? 'Update' : 'Set as Bill'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {frequency === 'monthly'
            ? `Charged on the ${dayOfMonth} of each month`
            : `Every ${WEEKDAYS[dayOfWeek]} — use while actively paying this card off`}
        </div>
      </div>
    </div>
  )
}

function SyncedLoanCard({ loan, onSave, strategies, view }) {
  const debtInfo = strategies?.debts?.find(d => d.name === loan.name)
  const recommended = strategies?.[view]?.recommended_payments?.find(r => r.name === loan.name)
  const [editing, setEditing] = useState(false)
  const [apr, setApr] = useState(String(loan.interest_rate || ''))
  const [nickname, setNickname] = useState(loan.nickname || '')
  const [saving, setSaving] = useState(false)
  const [showMath, setShowMath] = useState(false)

  function openEdit() {
    setApr(String(loan.interest_rate || ''))
    setNickname(loan.nickname || '')
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    await Promise.all([
      fetch(`${API}/accounts/${loan.id}/debt-details`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interest_rate: parseFloat(apr) || 0, minimum_payment: loan.minimum_payment }),
      }),
      fetch(`${API}/accounts/${loan.id}/nickname`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname.trim() }),
      }),
    ])
    setSaving(false)
    setEditing(false)
    onSave()
  }

  return (
    <div className="apple-card" style={{ padding: '20px 22px', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
            {loan.name}
            {debtInfo && <MathButton onClick={() => setShowMath(true)} />}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{loan.institution}</div>
          {recommended?.is_focus && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-text)',
              background: 'rgba(52,199,89,0.1)', padding: '2px 7px', borderRadius: 20, marginTop: 4, display: 'inline-block' }}>
              🎯 Focus
            </span>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--red)' }}>{money(loan.balance)}</div>
          {loan.mom_change !== 0 && (
            <Tooltip text={loan.mom_change < 0 ? "Balance decreased this month — paid down more than it accrued. Keep it up!" : "Balance grew this month."}>
              <div style={{ fontSize: 12, color: loan.mom_change < 0 ? 'var(--accent-text)' : 'var(--red)', display: 'inline-block' }}>
                {loan.mom_change < 0 ? '↓' : '↑'} {money(Math.abs(loan.mom_change))} vs last month
              </div>
            </Tooltip>
          )}
        </div>
      </div>
      {showMath && (
        <DebtMathModal name={loan.name} kind="loan" debtInfo={debtInfo} recommended={recommended} view={view} onClose={() => setShowMath(false)} />
      )}
      {editing ? (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div className="apple-label" style={{ marginBottom: 5 }}>Display Name</div>
            <input className="apple-input" value={nickname} onChange={e => setNickname(e.target.value)}
              placeholder={loan.raw_name} style={{ width: '100%' }} />
          </div>
          <div>
            <div className="apple-label" style={{ marginBottom: 5 }}>Bank Description <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(real line item from your bank — check this against your statement)</span></div>
            <div className="apple-input" style={{ width: '100%', color: 'var(--text-tertiary)', cursor: 'not-allowed' }}>
              {loan.raw_name}
            </div>
          </div>
          <div>
            <Tooltip text="Annual Percentage Rate on this loan. Enter this to enable accurate payoff strategy math.">
              <span className="apple-label">APR %</span>
            </Tooltip>
            <input className="apple-input" type="number" step="0.1" value={apr} onChange={e => setApr(e.target.value)}
              placeholder="e.g. 7.49" style={{ fontSize: 13, marginTop: 4, width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="apple-btn-secondary" onClick={() => setEditing(false)} style={{ flex: 1, fontSize: 12 }}>Cancel</button>
            <button className="apple-btn-primary" onClick={save} disabled={saving} style={{ flex: 1, fontSize: 12 }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 12 }}>
          <Tooltip text="Annual interest rate. Enter this to enable the payoff strategy comparison above.">
            <span style={{ color: 'var(--text-secondary)' }}>APR: <strong>{loan.interest_rate ? `${loan.interest_rate}%` : '—'}</strong></span>
          </Tooltip>
          <button onClick={openEdit} title="Edit name and APR"
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '3px 8px', fontFamily: 'inherit', color: 'var(--text-secondary)' }}>
            Edit details
          </button>
        </div>
      )}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 10 }}>
        <div className="apple-label" style={{ marginBottom: 8 }}>Monthly Payment</div>
        {loan.linked_bill_amount ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-text)' }}>{money(loan.linked_bill_amount)}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-text)',
                background: 'rgba(52,199,89,0.1)', padding: '3px 9px', borderRadius: 20 }}>
                ✓ Already budgeted in Bills
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              Loans have a fixed payment — change the amount in the Bills tab, not here.
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--orange)', lineHeight: 1.5 }}>
            ⚠ No bill linked yet — link this loan's real payment in the Bills tab so payoff math uses the actual amount instead of an estimate.
          </div>
        )}
      </div>
    </div>
  )
}

function Tooltip({ text, children }) {
  const [show, setShow] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-tertiary)', cursor: 'help', border: '1px solid var(--border)', borderRadius: '50%', width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle' }}>?</span>
      {show && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 200, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', width: 240, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, boxShadow: '0 4px 20px rgba(0,0,0,0.25)', marginBottom: 6 }}>
          {text}
        </div>
      )}
    </span>
  )
}

function TrashButton({ onClick, title }) {
  const [hover, setHover] = useState(false)
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute', bottom: 10, right: 10, zIndex: 2,
        background: hover ? 'rgba(255,59,48,0.1)' : 'none', border: 'none', borderRadius: 8,
        cursor: 'pointer', fontSize: 15, padding: '5px 7px', lineHeight: 1,
        color: hover ? 'var(--red)' : 'var(--text-tertiary)', transition: 'all 0.15s', fontFamily: 'inherit',
      }}>
      🗑
    </button>
  )
}

function MathButton({ onClick }) {
  const [show, setShow] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: 6 }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <button onClick={onClick} title="Show the math" style={{
        background: 'none', border: '1px solid var(--border)', borderRadius: '50%',
        width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', fontSize: 11, color: 'var(--text-tertiary)', padding: 0, fontFamily: 'inherit',
        verticalAlign: 'middle',
      }}>∑</button>
      {show && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 200, background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 11,
          color: 'var(--text-secondary)', whiteSpace: 'nowrap', boxShadow: '0 4px 20px rgba(0,0,0,0.25)', marginBottom: 6 }}>
          Show the math
        </div>
      )}
    </span>
  )
}

function DebtMathModal({ name, kind, debtInfo, recommended, view, onClose }) {
  if (!debtInfo) return null
  const { balance, rate_annual, min_payment, raw_min_payment, monthly_interest, min_payment_source, negative_amortization } = debtInfo
  const isFocus = !!recommended?.is_focus
  const extraAmt = isFocus ? round2(recommended.recommended_payment - min_payment) : 0
  const wasFloored = round2(min_payment) > round2(raw_min_payment)
  const balanceBuffer = round2(min_payment - monthly_interest)
  const rowStyle = { fontSize: 13, background: 'var(--bg-subtle)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, lineHeight: 1.6 }

  return (
    <Portal>
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      background: 'rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}>
      <div className="apple-card" style={{ maxWidth: 420, width: '90%', padding: '24px 26px', background: 'var(--bg-modal)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{name}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 18, color: 'var(--text-tertiary)', padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        <div className="apple-label" style={{ marginBottom: 5 }}>Monthly Interest</div>
        <div style={rowStyle}>
          {money(balance)} × {rate_annual}% ÷ 12 = <strong>{money(monthly_interest)}/mo</strong>
        </div>

        <div className="apple-label" style={{ marginBottom: 5 }}>{kind === 'loan' ? 'Monthly Payment' : 'Minimum Payment'}</div>
        <div style={rowStyle}>
          {min_payment_source === 'billed' ? (
            <>Real payment, from your Bills tab: <strong>{money(raw_min_payment)}/mo</strong></>
          ) : min_payment_source === 'estimated' ? (
            <>No minimum entered — estimated at 2% of balance:<br />{money(balance)} × 2% = <strong>{money(raw_min_payment)}/mo</strong></>
          ) : (
            <>You entered: <strong>{money(raw_min_payment)}/mo</strong></>
          )}
        </div>

        {negative_amortization && (
          <div style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.25)', borderRadius: 8,
            padding: '10px 12px', marginBottom: 14, fontSize: 12, color: 'var(--red)', lineHeight: 1.6 }}>
            ⚠ That doesn't cover interest<br />
            {money(raw_min_payment)} − {money(monthly_interest)} = {money(raw_min_payment - monthly_interest)}/mo — balance grows even paying on time
          </div>
        )}

        {wasFloored && (
          <>
            <div className="apple-label" style={{ marginBottom: 5 }}>Planning Minimum (adjusted)</div>
            <div style={rowStyle}>
              {money(monthly_interest)} interest + {money(balanceBuffer)} (1% of balance) = <strong>{money(min_payment)}/mo</strong>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                Raised above the {min_payment_source === 'estimated' ? 'estimated' : min_payment_source === 'billed' ? 'billed' : 'stated'} payment so this debt always makes progress, even while extra payments focus elsewhere.
              </div>
            </div>
          </>
        )}

        <div className="apple-label" style={{ marginBottom: 5 }}>Recommended Payment ({view})</div>
        <div style={{ ...rowStyle, marginBottom: 0 }}>
          {isFocus ? (
            <>{money(min_payment)} + {money(extraAmt)} extra = <strong>{money(recommended.recommended_payment)}/mo</strong>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>This is your #1 priority right now</div>
            </>
          ) : (
            <><strong>{money(recommended?.recommended_payment ?? min_payment)}/mo</strong>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>Extra is focused on a higher-priority debt</div>
            </>
          )}
        </div>
      </div>
    </div>
    </Portal>
  )
}

const PIE_COLORS = ['#e24b4a', '#ef9f27', '#378add', '#8b5cf6', '#10b981', '#f97316', '#ec4899', '#14b8a6']

function DebtPieChart({ slices, selectedId, onSelect }) {
  const total = slices.reduce((s, d) => s + d.value, 0)
  const selected = slices.find(d => d.id === selectedId)

  const data = slices.map((d, i) => ({
    ...d,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }))

  function handleClick(entry) {
    if (entry?.id) onSelect(entry.id, entry.type)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px', gap: 14 }}>
      <div style={{ position: 'relative', width: 160, height: 160 }}>
        <PieChart width={160} height={160}>
          <Pie
            data={data}
            dataKey="value"
            cx={76}
            cy={76}
            innerRadius={52}
            outerRadius={74}
            paddingAngle={2}
            onClick={(_, __, e) => { e.stopPropagation(); handleClick(_.payload) }}
            style={{ cursor: 'pointer' }}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell
                key={d.id}
                fill={d.id === selectedId ? d.color : d.color + '33'}
                stroke={d.id === selectedId ? d.color : 'transparent'}
                strokeWidth={d.id === selectedId ? 2 : 0}
              />
            ))}
          </Pie>
        </PieChart>
        {/* Center label */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          textAlign: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--text-tertiary)', marginBottom: 2 }}>
            {selected ? selected.name.split(' ')[0] : 'total'}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>
            {money(selected ? selected.value : total)}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ width: '100%' }}>
        {data.map(d => (
          <div key={d.id} onClick={() => onSelect(d.id, d.type)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0',
              cursor: 'pointer', opacity: d.id === selectedId ? 1 : 0.35,
              transition: 'opacity 0.15s' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1, minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
              {total > 0 ? `${Math.round((d.value / total) * 100)}%` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DebtListItem({ name, balance, apr, active, isFocus, onClick }) {
  const dot = isFocus ? 'var(--accent)' : (apr && apr > 20) ? 'var(--red)' : 'var(--orange)'
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
      cursor: 'pointer', borderBottom: '1px solid var(--border)',
      background: active ? 'var(--bg-card)' : 'transparent',
      borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
    }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 500, flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: 'var(--text-primary)' }}>{name}</span>
      <span style={{ fontSize: 12, color: 'var(--red)', fontVariantNumeric: 'tabular-nums',
        flexShrink: 0 }}>{money(Math.abs(balance))}</span>
    </div>
  )
}

function ListSectionHead({ label, onAdd, addLabel }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 14px 4px' }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.07em', color: 'var(--text-tertiary)' }}>{label}</span>
      {onAdd && (
        <button onClick={onAdd} style={{ background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 11, color: 'var(--accent-text)', fontWeight: 600, padding: '2px 0',
          fontFamily: 'inherit' }}>{addLabel || '+ Add'}</button>
      )}
    </div>
  )
}

function round2(n) { return Math.round(n * 100) / 100 }

function moneyK(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (abs >= 1000) return `$${(v / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`
  return `$${Math.round(v)}`
}

const chartTooltipStyle = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 12, padding: '8px 12px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
}

// Stacked balance chart — one band per debt, ordered by payoff priority. As each
// debt clears, its band disappears and the whole stack visibly drops faster, since
// fewer/larger remaining bands absorb a growing payment (the actual snowball effect).
function BalanceWaterfallChart({ timeline, payoffOrder }) {
  if (!timeline || timeline.length === 0) return null
  const data = timeline.map(t => ({ month: t.month, ...t.balances }))
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tickFormatter={m => `${m}mo`} fontSize={11} stroke="var(--text-tertiary)" tickLine={false} />
          <YAxis tickFormatter={moneyK} fontSize={11} stroke="var(--text-tertiary)" width={48} tickLine={false} axisLine={false} />
          <ChartTooltip
            formatter={(v, name) => [money(v), name]}
            labelFormatter={m => `Month ${m}`}
            contentStyle={chartTooltipStyle}
          />
          {payoffOrder.map((name, i) => (
            <Area key={name} type="monotone" dataKey={name} stackId="1"
              stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={CHART_COLORS[i % CHART_COLORS.length]}
              fillOpacity={0.75} strokeWidth={1} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// Step chart — how much is going to the current "focus" debt each month. Flat,
// then steps up the moment a debt clears and its minimum rolls onto the next one.
// Clean, monotonic staircase — extra cash available for debt payoff, on top of every
// minimum. Steps up exactly when a debt clears, never down. A dot marks each payoff
// event; a dashed line marks the moment the last credit card clears and extra starts
// targeting loans instead.
function CashFreedChart({ timeline }) {
  if (!timeline || timeline.length === 0) return null
  const data = timeline.map(t => ({ month: t.month, pool: t.extra_pool, events: t.newly_paid_off }))
  const events = timeline.filter(t => t.newly_paid_off.length > 0)
  const cardsClearedMonth = timeline.find(t => t.cards_just_cleared)?.month

  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tickFormatter={m => `${m}mo`} fontSize={11} stroke="var(--text-tertiary)" tickLine={false} />
          <YAxis tickFormatter={moneyK} fontSize={11} stroke="var(--text-tertiary)" width={48} tickLine={false} axisLine={false} />
          <ChartTooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const point = payload[0].payload
              return (
                <div style={chartTooltipStyle}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Month {label}</div>
                  <div>{money(point.pool)}/mo extra available</div>
                  {point.events?.length > 0 && (
                    <div style={{ marginTop: 4, color: 'var(--accent-text)', fontWeight: 600 }}>
                      ✓ {point.events.join(', ')} paid off
                    </div>
                  )}
                </div>
              )
            }}
          />
          {cardsClearedMonth && (
            <ReferenceLine x={cardsClearedMonth} stroke="var(--orange)" strokeDasharray="4 4"
              label={{ value: 'Cards done → loans next', position: 'insideTopLeft', fill: 'var(--orange)', fontSize: 10 }} />
          )}
          <Line type="stepAfter" dataKey="pool" stroke="var(--accent)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          {events.map(e => (
            <ReferenceDot key={e.month} x={e.month} y={e.extra_pool} r={4}
              fill="var(--accent)" stroke="var(--bg-card)" strokeWidth={2} isFront />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function StrategyPanel({ strategies, extra, onExtraChange, view, onViewChange, cardsFirst, onCardsFirstChange }) {
  if (!strategies || !strategies.snowball) return null
  const { snowball, avalanche, interest_saved, months_saved } = strategies
  const current = view === 'snowball' ? snowball : avalanche

  return (
    <div className="apple-card" style={{ padding: '22px 24px', marginBottom: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Payoff Strategy</div>
          {interest_saved > 0 && (
            <div style={{ fontSize: 12, color: 'var(--accent-text)' }}>
              Avalanche saves {money(interest_saved)} in interest ({months_saved > 0 ? `${months_saved} months sooner` : 'same timeline'})
            </div>
          )}
        </div>
        <div style={{ display: 'flex', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-pill)', padding: 3 }}>
          {[
            { id: 'snowball',  label: 'Snowball',  tip: 'Pay smallest balance first — quick psychological wins' },
            { id: 'avalanche', label: 'Avalanche', tip: 'Pay highest APR first — minimizes total interest paid' },
          ].map(s => (
            <button key={s.id} title={s.tip} onClick={() => onViewChange(s.id)} style={{
              background: view === s.id ? 'var(--bg-card)' : 'transparent', border: 'none', cursor: 'pointer',
              padding: '5px 14px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: view === s.id ? 600 : 400,
              color: view === s.id ? 'var(--text-primary)' : 'var(--text-secondary)', fontFamily: 'inherit',
              boxShadow: view === s.id ? 'var(--shadow-card)' : 'none', transition: 'all 0.15s', textTransform: 'capitalize',
            }}>{s.label}</button>
          ))}
        </div>
      </div>

      <label title="Always finish every credit card before any extra payment goes to a loan, regardless of balance or rate ordering"
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', width: 'fit-content' }}>
        <input type="checkbox" checked={cardsFirst} onChange={e => onCardsFirstChange(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
        Pay off all credit cards before loans
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 160px), 1fr))', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'Debt Free', value: current.debt_free_date ? new Date(current.debt_free_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—' },
          { label: 'Time to Payoff', value: months(current.months) },
          { label: 'Total Interest', value: money(current.total_interest), color: 'var(--red)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="apple-card" style={{ padding: '14px 16px', background: 'var(--bg-subtle)' }}>
            <div className="apple-label" style={{ marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', color: color || 'var(--text-primary)' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Payoff order + recommended payment amounts (item 9) */}
      {current.payoff_order?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="apple-label" style={{ marginBottom: 8 }}>Payoff Order &amp; Recommended Payments</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {current.payoff_order.map((name, i) => {
              const rec = current.recommended_payments?.find(r => r.name === name)
              const info = strategies.debts?.find(d => d.name === name)
              return (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 600, width: 20, flexShrink: 0 }}>{i+1}.</span>
                  <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{name}</span>
                  {info?.negative_amortization && (
                    <span style={{ fontSize: 13, cursor: 'help' }}
                      title="This debt's payment doesn't cover its own interest — the balance will grow until extra payments are applied to it.">
                      ⚠️
                    </span>
                  )}
                  {rec && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-text)' }}>{money(rec.recommended_payment)}<span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 3 }}>/mo</span></span>}
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
            {view === 'snowball' ? 'Smallest balance first — quick psychological wins' : 'Highest APR first — minimizes total interest paid'}
          </div>
        </div>
      )}

      {/* Balance waterfall — how fast each debt shrinks, and the whole stack speeding up */}
      {current.timeline?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="apple-label" style={{ marginBottom: 8 }}>Balance Over Time</div>
          <BalanceWaterfallChart timeline={current.timeline} payoffOrder={current.payoff_order} />
        </div>
      )}

      {/* Cash freed chart — the actual snowball: a clean staircase, never down */}
      {current.timeline?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <Tooltip text="Extra cash available for debt payoff each month, on top of every required minimum. It only ever goes up — each step is a debt being fully paid off, freeing its minimum to roll onto the next one.">
            <div className="apple-label" style={{ marginBottom: 8, display: 'inline-block' }}>Cash Freed for Extra Debt Payments</div>
          </Tooltip>
          <CashFreedChart timeline={current.timeline} />
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <Tooltip text="This is extra money added on top of minimum payments each month. It goes entirely toward the focus debt, dramatically cutting payoff time and interest.">
            <span className="apple-label">Extra monthly payment: ${extra}</span>
          </Tooltip>
          {interest_saved > 0 && <span style={{ fontSize: 11, color: 'var(--accent-text)' }}>Avalanche saves {money(interest_saved)} vs Snowball</span>}
        </div>
        <input type="range" min={0} max={1000} step={25} value={extra} onChange={e => onExtraChange(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-tertiary)' }}><span>$0</span><span>$1,000</span></div>
        {current.recommended_payments?.find(r => r.is_focus) && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
            Extra goes to <strong>{current.recommended_payments.find(r => r.is_focus).name}</strong> below (marked 🎯 Focus) — once it's paid off, this amount plus its minimum rolls to the next priority debt.
          </div>
        )}
      </div>
    </div>
  )
}

function AddLoanModal({ anchor, onClose, onSave }) {
  const [form, setForm] = useState({ name: '', type: 'auto', original_balance: '', current_balance: '', interest_rate: '', monthly_payment: '', payments_made: '', total_payments: '', start_date: '' })

  async function save() {
    const body = { ...form, original_balance: parseFloat(form.original_balance) || 0, current_balance: parseFloat(form.current_balance) || 0, interest_rate: parseFloat(form.interest_rate) || 0, monthly_payment: parseFloat(form.monthly_payment) || 0, payments_made: parseInt(form.payments_made) || 0, total_payments: parseInt(form.total_payments) || 0 }
    await fetch(`${API}/loans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    onSave(); onClose()
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  return (
    <Portal>
      <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onClick={onClose} />
      <div className="apple-card" style={{ ...popoverStyle(anchor, 480), padding: '28px 32px' }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 20 }}>Add Loan</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[['name','Name','text'],['type','Type','select:auto,personal_loan,mortgage'],['current_balance','Current Balance','number'],['original_balance','Original Balance','number'],['interest_rate','Interest Rate %','number'],['monthly_payment','Monthly Payment','number'],['payments_made','Payments Made','number'],['total_payments','Total Payments','number'],['start_date','Start Date','date']].map(([k, label, type]) => (
            <div key={k} style={{ gridColumn: k === 'name' ? 'span 2' : undefined }}>
              <div className="apple-label" style={{ marginBottom: 4 }}>{label}</div>
              {type.startsWith('select:') ? (
                <select className="apple-select" value={form[k]} onChange={e => f(k, e.target.value)} style={{ width: '100%' }}>
                  {type.slice(7).split(',').map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input className="apple-input" type={type} value={form[k]} onChange={e => f(k, e.target.value)} />
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="apple-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="apple-btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </Portal>
  )
}

function AddCreditCardModal({ anchor, onClose, onSave }) {
  const [form, setForm] = useState({ name: '', institution: '', current_balance: '', interest_rate: '', minimum_payment: '' })
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function save() {
    if (!form.name) return
    const body = {
      name: form.name, type: 'credit', institution: form.institution || null,
      current_balance: form.current_balance ? -Math.abs(parseFloat(form.current_balance)) : 0,
      interest_rate: parseFloat(form.interest_rate) || 0,
      minimum_payment: parseFloat(form.minimum_payment) || 0,
    }
    await fetch(`${API}/accounts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    onSave(); onClose()
  }

  return (
    <Portal>
      <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onClick={onClose} />
      <div className="apple-card" style={{ ...popoverStyle(anchor, 420), padding: '28px 32px' }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 20 }}>Add Credit Card</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <div className="apple-label" style={{ marginBottom: 4 }}>Card Name</div>
            <input className="apple-input" value={form.name} onChange={e => f('name', e.target.value)} placeholder="e.g. Discover It" style={{ width: '100%' }} />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <div className="apple-label" style={{ marginBottom: 4 }}>Institution</div>
            <input className="apple-input" value={form.institution} onChange={e => f('institution', e.target.value)} placeholder="e.g. Discover" style={{ width: '100%' }} />
          </div>
          <div>
            <div className="apple-label" style={{ marginBottom: 4 }}>Current Balance</div>
            <input className="apple-input" type="number" step="1" value={form.current_balance} onChange={e => f('current_balance', e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <div className="apple-label" style={{ marginBottom: 4 }}>Interest Rate %</div>
            <input className="apple-input" type="number" step="0.1" value={form.interest_rate} onChange={e => f('interest_rate', e.target.value)} placeholder="e.g. 24.99" />
          </div>
          <div>
            <div className="apple-label" style={{ marginBottom: 4 }}>Min Payment $</div>
            <input className="apple-input" type="number" step="5" value={form.minimum_payment} onChange={e => f('minimum_payment', e.target.value)} placeholder="e.g. 35" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="apple-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="apple-btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </Portal>
  )
}

export default function Debt({ active, onExtraChange }) {
  const [data, setData] = useState(null)
  const [strategies, setStrategies] = useState(null)
  const [extras, setExtras] = useState({})
  const [projections, setProjections] = useState({})
  const [stratExtra, setStratExtra] = useState(0)
  const [strategyView, setStrategyView] = useState('snowball')
  const [cardsFirst, setCardsFirst] = useState(true)
  const [addLoanAnchor, setAddLoanAnchor] = useState(null)
  const [addCardAnchor, setAddCardAnchor] = useState(null)
  const [selected, setSelected] = useState(null) // { type: 'card'|'synced_loan'|'loan', id }

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([
        fetch(`${API}/debt/summary`).then(r => r.json()),
        fetch(`${API}/debt/strategies?extra_monthly=${stratExtra}&cards_first=${cardsFirst}`).then(r => r.json()),
      ])
      setData(d)
      setStrategies(s)
    } catch {}
  }, [stratExtra, cardsFirst])

  useEffect(() => { if (active) load() }, [active, load])
  useEffect(() => {
    if (!active) return
    fetch(`${API}/debt/strategies?extra_monthly=${stratExtra}&cards_first=${cardsFirst}`).then(r => r.json()).then(setStrategies).catch(() => {})
    if (onExtraChange) onExtraChange(stratExtra)
  }, [stratExtra, cardsFirst, active, onExtraChange])

  async function fetchProjection(loanId, extra) {
    if (!extra) { setProjections(p => ({ ...p, [loanId]: null })); return }
    try {
      const r = await fetch(`${API}/debt/payoff-projection?loan_id=${loanId}&extra_monthly=${extra}`)
      const d = await r.json()
      if (d.length > 0) setProjections(p => ({ ...p, [loanId]: d[0] }))
    } catch {}
  }

  async function handleExtraChange(loanId, val) {
    setExtras(e => ({ ...e, [loanId]: val }))
    await fetchProjection(loanId, val)
  }

  async function deleteLoan(id) {
    try {
      await fetch(`${API}/loans/${id}`, { method: 'DELETE' })
      load()
    } catch {}
  }

  async function deleteCard(id) {
    try {
      await fetch(`${API}/accounts/${id}`, { method: 'DELETE' })
      load()
    } catch {}
  }

  // Auto-select first debt when data loads
  useEffect(() => {
    if (!data || selected) return
    const card = data.credit_cards?.[0]
    if (card) { setSelected({ type: 'card', id: card.id }); return }
    const sl = data.synced_loans?.[0]
    if (sl) { setSelected({ type: 'synced_loan', id: sl.id }); return }
    const loan = data.loans?.[0]
    if (loan) setSelected({ type: 'loan', id: loan.id })
  }, [data])

  if (!data) return (
    <div style={{ padding: '48px 36px' }}>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>Loading…</div>
    </div>
  )

  const totalDebt = Math.abs(data.credit_cards?.reduce((s, c) => s + (c.balance || 0), 0) || 0)
    + Math.abs(data.synced_loans?.reduce((s, l) => s + (l.balance || 0), 0) || 0)
    + (data.loans?.reduce((s, l) => s + (l.current_balance || 0), 0) || 0)

  const focusName = strategies?.avalanche?.recommended_payments?.find(r => r.is_focus)?.name
    || strategies?.snowball?.recommended_payments?.find(r => r.is_focus)?.name

  const sortedCards = [...(data.credit_cards || [])].sort((a, b) => Math.abs(a.balance || 0) - Math.abs(b.balance || 0))
  const sortedSyncedLoans = [...(data.synced_loans || [])].sort((a, b) => Math.abs(a.balance || 0) - Math.abs(b.balance || 0))
  const sortedLoans = [...(data.loans || [])].sort((a, b) => (a.current_balance || 0) - (b.current_balance || 0))

  // Build pie slices from all debts
  const pieSlices = [
    ...sortedCards.map(c => ({ id: c.id, type: 'card', name: c.name, value: Math.abs(c.balance || 0) })),
    ...sortedSyncedLoans.map(l => ({ id: l.id, type: 'synced_loan', name: l.name, value: Math.abs(l.balance || 0) })),
    ...sortedLoans.map(l => ({ id: l.id, type: 'loan', name: l.name, value: l.current_balance || 0 })),
  ].filter(d => d.value > 0)

  function handlePieSelect(id, type) {
    setSelected({ type, id })
  }

  function renderDetail() {
    if (!selected) return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%',
        color: 'var(--text-tertiary)', fontSize: 14 }}>Select a debt to view details</div>
    )
    if (selected.type === 'card') {
      const card = data.credit_cards?.find(c => c.id === selected.id)
      if (!card) return null
      return (
        <div style={{ position: 'relative' }}>
          <CreditCardDebtEditor key={card.id} card={card} onSave={load} strategies={strategies} view={strategyView} />
          <TrashButton title="Remove this card from debt tracking" onClick={() => { deleteCard(card.id); setSelected(null) }} />
        </div>
      )
    }
    if (selected.type === 'synced_loan') {
      const loan = data.synced_loans?.find(l => l.id === selected.id)
      if (!loan) return null
      return (
        <div style={{ position: 'relative' }}>
          <SyncedLoanCard key={loan.id} loan={loan} onSave={load} strategies={strategies} view={strategyView} />
          <TrashButton title="Remove this account from debt tracking" onClick={() => { deleteCard(loan.id); setSelected(null) }} />
        </div>
      )
    }
    if (selected.type === 'loan') {
      const loan = data.loans?.find(l => l.id === selected.id)
      if (!loan) return null
      return (
        <div style={{ position: 'relative' }}>
          <LoanCard key={loan.id} loan={{ ...loan, payoff_projection: projections[loan.id] }} extra={extras[loan.id] || 0}
            onExtraChange={v => handleExtraChange(loan.id, v)} onSave={load} strategies={strategies} view={strategyView} />
          <TrashButton title="Remove this loan from debt tracking" onClick={() => { deleteLoan(loan.id); setSelected(null) }} />
        </div>
      )
    }
  }

  return (
    <div className="page-enter" style={{ padding: '32px 36px 80px' }}>

      {/* Unlinked bills warning */}
      {data.unlinked_debt_bills?.length > 0 && (
        <div style={{
          background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.3)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 24, fontSize: 13,
        }}>
          <div style={{ fontWeight: 600, color: 'var(--orange)', marginBottom: 6 }}>
            ⚠️ {data.unlinked_debt_bills.length} bill{data.unlinked_debt_bills.length !== 1 ? 's' : ''} look{data.unlinked_debt_bills.length === 1 ? 's' : ''} like a loan payment but {data.unlinked_debt_bills.length === 1 ? "isn't" : "aren't"} tracked here
          </div>
          {data.unlinked_debt_bills.map(b => (
            <div key={b.id} style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{b.name}</strong> — {money(b.expected_amount)}/mo
            </div>
          ))}
          <div style={{ color: 'var(--text-tertiary)', marginTop: 6, fontSize: 12 }}>
            Not included in debt totals or payoff math. Add as a loan below, then link the bill from the Bills tab.
          </div>
        </div>
      )}

      {/* Master / Detail */}
      <div style={{ display: 'flex', background: 'var(--bg-card)', borderRadius: 'var(--radius)',
        overflow: 'hidden', marginBottom: 24, minHeight: 520 }}>

        {/* Left: list */}
        <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', background: 'var(--bg-subtle)' }}>

          {/* Total header */}
          <div style={{ padding: '16px 16px 14px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Total Debt</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--red)',
              fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' }}>{money(totalDebt)}</div>
          </div>

          {/* Scrollable list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ListSectionHead label="Credit Cards"
              onAdd={e => setAddCardAnchor(e.currentTarget.closest('[data-add-anchor]')?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect())}
              addLabel="+ Add" />
            {data.credit_cards?.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '6px 14px 10px', fontStyle: 'italic' }}>None yet</div>
            )}
            {sortedCards.map(card => (
              <DebtListItem key={card.id} name={card.name}
                balance={card.balance} apr={card.interest_rate}
                active={selected?.type === 'card' && selected?.id === card.id}
                isFocus={focusName === card.name}
                onClick={() => setSelected({ type: 'card', id: card.id })} />
            ))}

            {sortedSyncedLoans.length > 0 && (
              <>
                <ListSectionHead label="Synced Loans" />
                {sortedSyncedLoans.map(loan => (
                  <DebtListItem key={loan.id} name={loan.name}
                    balance={loan.balance} apr={loan.interest_rate}
                    active={selected?.type === 'synced_loan' && selected?.id === loan.id}
                    isFocus={focusName === loan.name}
                    onClick={() => setSelected({ type: 'synced_loan', id: loan.id })} />
                ))}
              </>
            )}

            <ListSectionHead label="Loans"
              onAdd={e => setAddLoanAnchor(e.currentTarget.getBoundingClientRect())}
              addLabel="+ Add" />
            {data.loans?.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '6px 14px 10px', fontStyle: 'italic' }}>None yet</div>
            )}
            {sortedLoans.map(loan => (
              <DebtListItem key={loan.id} name={loan.name}
                balance={loan.current_balance} apr={loan.interest_rate}
                active={selected?.type === 'loan' && selected?.id === loan.id}
                isFocus={focusName === loan.name}
                onClick={() => setSelected({ type: 'loan', id: loan.id })} />
            ))}
          </div>
        </div>

        {/* Center: detail */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', borderRight: '1px solid var(--border)' }}>
          {renderDetail()}
        </div>

        {/* Right: pie chart */}
        <div style={{ width: 220, flexShrink: 0, overflowY: 'auto', background: 'var(--bg-subtle)' }}>
          <DebtPieChart
            slices={pieSlices}
            selectedId={selected?.id}
            onSelect={handlePieSelect}
          />
        </div>
      </div>

      {/* Strategy panel — full width below */}
      <StrategyPanel strategies={strategies} extra={stratExtra} onExtraChange={setStratExtra}
        view={strategyView} onViewChange={setStrategyView} cardsFirst={cardsFirst} onCardsFirstChange={setCardsFirst} />

      {addLoanAnchor && <AddLoanModal anchor={addLoanAnchor} onClose={() => setAddLoanAnchor(null)} onSave={load} />}
      {addCardAnchor && <AddCreditCardModal anchor={addCardAnchor} onClose={() => setAddCardAnchor(null)} onSave={load} />}
    </div>
  )
}
