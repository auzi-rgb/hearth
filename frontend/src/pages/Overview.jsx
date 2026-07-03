import { useState, useEffect } from 'react'
import Portal from '../components/Portal'

function useIsWide(breakpoint = 1100) {
  const [wide, setWide] = useState(() => window.innerWidth >= breakpoint)
  useEffect(() => {
    const fn = () => setWide(window.innerWidth >= breakpoint)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [breakpoint])
  return wide
}

const API = '/hearth/api'

function money(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `-$${s}` : `$${s}`
}
function moneyColor(v) {
  return v >= 0 ? 'var(--accent-text)' : 'var(--red)'
}
function months(n) {
  if (!n) return '—'
  const y = Math.floor(n / 12)
  const m = n % 12
  if (y === 0) return `${m}mo`
  return m === 0 ? `${y}yr` : `${y}yr ${m}mo`
}

function LoanModal({ loan, onClose, onSaved }) {
  const isEdit = !!loan
  const EMPTY = { name: '', type: 'auto', original_balance: '', current_balance: '',
    interest_rate: '', monthly_payment: '', start_date: '', total_payments: '', payments_made: '' }
  const [form, setForm] = useState(loan ? {
    name:             loan.name             ?? '',
    type:             loan.type             ?? 'auto',
    original_balance: String(loan.original_balance ?? ''),
    current_balance:  String(loan.current_balance  ?? ''),
    interest_rate:    String(loan.interest_rate    ?? ''),
    monthly_payment:  String(loan.monthly_payment  ?? ''),
    start_date:       loan.start_date        ?? '',
    total_payments:   String(loan.total_payments   ?? ''),
    payments_made:    String(loan.payments_made    ?? ''),
  } : EMPTY)
  const [saving, setSaving] = useState(false)
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function submit() {
    setSaving(true)
    const body = {
      name: form.name, type: form.type,
      original_balance: parseFloat(form.original_balance) || 0,
      current_balance:  parseFloat(form.current_balance)  || 0,
      interest_rate:    parseFloat(form.interest_rate)    || 0,
      monthly_payment:  parseFloat(form.monthly_payment)  || 0,
      start_date:       form.start_date || null,
      total_payments:   parseInt(form.total_payments)     || 0,
      payments_made:    parseInt(form.payments_made)      || 0,
    }
    const url    = isEdit ? `${API}/loans/${loan.id}` : `${API}/loans`
    const method = isEdit ? 'PUT' : 'POST'
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    onSaved()
    onClose()
  }

  const ROW = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }

  return (
    <Portal>
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      background: 'rgba(0,0,0,0.08)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="apple-card" style={{ maxWidth: 480, width: '100%', padding: '28px 28px 24px',
        maxHeight: '90vh', overflowY: 'auto', position: 'relative', background: 'var(--bg-modal)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{isEdit ? 'Edit Loan' : 'Add Loan'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 20, color: 'var(--text-tertiary)', padding: 4, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={ROW}>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="apple-label" style={{ marginBottom: 5 }}>Name</div>
              <input className="apple-input" value={form.name} onChange={e => f('name', e.target.value)}
                placeholder="e.g. Honda CR-V" style={{ width: '100%' }} />
            </div>
          </div>
          <div style={ROW}>
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Loan Type</div>
              <select className="apple-select" value={form.type} onChange={e => f('type', e.target.value)} style={{ width: '100%' }}>
                <option value="auto">Auto</option>
                <option value="personal_loan">Personal</option>
                <option value="mortgage">Mortgage</option>
                <option value="student">Student</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Start Date</div>
              <input className="apple-input" type="date" value={form.start_date}
                onChange={e => f('start_date', e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>
          <div style={ROW}>
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Original Balance ($)</div>
              <input className="apple-input" type="number" step="0.01" value={form.original_balance}
                onChange={e => f('original_balance', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Current Balance ($)</div>
              <input className="apple-input" type="number" step="0.01" value={form.current_balance}
                onChange={e => f('current_balance', e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>
          <div style={ROW}>
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Interest Rate %</div>
              <input className="apple-input" type="number" step="0.01" value={form.interest_rate}
                onChange={e => f('interest_rate', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Monthly Payment ($)</div>
              <input className="apple-input" type="number" step="0.01" value={form.monthly_payment}
                onChange={e => f('monthly_payment', e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>
          <div style={ROW}>
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Total Payments (term)</div>
              <input className="apple-input" type="number" step="1" placeholder="e.g. 60"
                value={form.total_payments} onChange={e => f('total_payments', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Payments Made</div>
              <input className="apple-input" type="number" step="1" value={form.payments_made}
                onChange={e => f('payments_made', e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="apple-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="apple-btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Loan'}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  )
}

function TmrsCard({ data, onSave }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    account_balance:          String(data?.account_balance          ?? ''),
    your_contributions:       String(data?.your_contributions       ?? ''),
    interest:                 String(data?.interest                 ?? ''),
    city_contributions:       String(data?.city_contributions       ?? ''),
    retirement_eligible_date: data?.retirement_eligible_date        ?? '',
    monthly_deposit:          String(data?.monthly_deposit          ?? ''),
  })
  const [saving, setSaving] = useState(false)
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function save() {
    setSaving(true)
    const body = {}
    const numericKeys = ['account_balance', 'your_contributions', 'interest', 'city_contributions', 'monthly_deposit']
    for (const k of numericKeys) {
      const n = parseFloat(form[k])
      if (!isNaN(n)) body[k] = n
    }
    if (form.retirement_eligible_date) body.retirement_eligible_date = form.retirement_eligible_date
    try {
      await fetch(`${API}/tmrs`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      onSave()
    } catch {}
    setSaving(false)
    setEditing(false)
  }

  const hasData = data && Object.values(data).some(v => v !== null)

  const Stat = ({ label, children }) => (
    <div>
      <div className="apple-label" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{children}</div>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="apple-label" style={{ marginBottom: 4 }}>TEXAS MUNICIPAL RETIREMENT SYSTEM</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Updated manually from your TMRS statement</div>
        </div>
        {!editing ? (
          <button onClick={() => setEditing(true)}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              cursor: 'pointer', fontSize: 11, padding: '3px 8px', fontFamily: 'inherit',
              color: 'var(--text-secondary)' }}>
            Edit
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="apple-btn-secondary" onClick={() => setEditing(false)} style={{ fontSize: 12 }}>Cancel</button>
            <button className="apple-btn-primary" onClick={save} disabled={saving} style={{ fontSize: 12 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14,
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <div className="apple-label" style={{ marginBottom: 4 }}>Account Balance ($)</div>
            <input className="apple-input" type="number" step="0.01" value={form.account_balance}
              onChange={e => f('account_balance', e.target.value)} placeholder="0" style={{ width: '100%', fontSize: 13 }} />
          </div>
          <div>
            <div className="apple-label" style={{ marginBottom: 4 }}>Your Contributions ($)</div>
            <input className="apple-input" type="number" step="0.01" value={form.your_contributions}
              onChange={e => f('your_contributions', e.target.value)} placeholder="0" style={{ width: '100%', fontSize: 13 }} />
          </div>
          <div>
            <div className="apple-label" style={{ marginBottom: 4 }}>Interest ($)</div>
            <input className="apple-input" type="number" step="0.01" value={form.interest}
              onChange={e => f('interest', e.target.value)} placeholder="0" style={{ width: '100%', fontSize: 13 }} />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <div className="apple-label" style={{ marginBottom: 4 }}>City Contributions ($)</div>
            <input className="apple-input" type="number" step="0.01" value={form.city_contributions}
              onChange={e => f('city_contributions', e.target.value)} placeholder="0" style={{ width: '100%', fontSize: 13 }} />
          </div>
          <div>
            <div className="apple-label" style={{ marginBottom: 4 }}>Retirement Eligible Date</div>
            <input className="apple-input" type="date" value={form.retirement_eligible_date}
              onChange={e => f('retirement_eligible_date', e.target.value)} style={{ width: '100%', fontSize: 13 }} />
          </div>
          <div>
            <div className="apple-label" style={{ marginBottom: 4 }}>Monthly Deposit ($)</div>
            <input className="apple-input" type="number" step="0.01" value={form.monthly_deposit}
              onChange={e => f('monthly_deposit', e.target.value)} placeholder="0" style={{ width: '100%', fontSize: 13 }} />
          </div>
        </div>
      ) : hasData ? (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 12 }}>
          {[
            ['Account Balance', money(data.account_balance), 'var(--accent-text)', true],
            ['Your Contributions', money(data.your_contributions), null, false],
            ['Interest', money(data.interest), null, false],
            ['City Contributions', money(data.city_contributions), null, false],
            ['Retirement Eligible', data.retirement_eligible_date
              ? new Date(data.retirement_eligible_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
              : '—', null, false],
            ['Monthly Deposit', money(data.monthly_deposit) + '/mo', null, false],
          ].map(([label, value, color, bold]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
              <span style={{ fontWeight: bold ? 700 : 600, color: color || 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 14,
          fontSize: 13, color: 'var(--text-tertiary)' }}>
          No TMRS data yet — click Edit to add your pension information
        </div>
      )}
    </div>
  )
}

export default function Overview({ active, debtExtra }) {
  const isWide = useIsWide()
  const [dash, setDash] = useState(null)
  const [debt, setDebt] = useState(null)
  const [strategies, setStrategies] = useState(null)
  const [tmrs, setTmrs] = useState(null)
  const [loans, setLoans] = useState([])
  const [loanModal, setLoanModal] = useState(undefined) // undefined=closed, null=new, obj=edit
  const [deleteLoanId, setDeleteLoanId] = useState(null)
  const [deletingLoan, setDeletingLoan] = useState(false)

  function loadTmrs() {
    fetch(`${API}/tmrs`).then(r => r.json()).then(setTmrs).catch(() => {})
  }

  function loadLoans() {
    fetch(`${API}/loans`).then(r => r.json()).then(setLoans).catch(() => {})
  }

  useEffect(() => {
    if (!active) return
    Promise.all([
      fetch(`${API}/dashboard`).then(r => r.json()),
      fetch(`${API}/debt/summary`).then(r => r.json()),
    ]).then(([d, dbt]) => {
      setDash(d)
      setDebt(dbt)
    }).catch(() => {})
    loadTmrs()
    loadLoans()
  }, [active])

  useEffect(() => {
    if (!active) return
    fetch(`${API}/debt/strategies?extra_monthly=${debtExtra || 0}`)
      .then(r => r.json()).then(setStrategies).catch(() => {})
  }, [active, debtExtra])

  if (!dash || !debt) return (
    <div style={{ padding: '48px 36px' }}>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>Loading…</div>
    </div>
  )

  const nwChangeSign = (dash.net_worth_change ?? 0) >= 0 ? '+' : ''
  const checkingAccounts = dash.accounts.filter(a => a.type === 'checking' || a.type === 'savings' || a.type === 'investment')
  const debtAccounts = dash.accounts.filter(a => a.type === 'credit' || a.type === 'loan' || a.type === 'personal_loan')
  const cardDebt       = debt.credit_cards || []
  const loanAccounts   = dash.accounts.filter(a => a.type === 'loan' || a.type === 'personal_loan')
  // SimpleFin-synced loan accounts — live balance but no amortization detail
  const syncedLoans    = dash.accounts.filter(a => a.type === 'loan' || a.type === 'personal_loan')

  // Build payoff timeline from strategies
  const bestStrategy = strategies?.avalanche || strategies?.snowball
  const timeline = (() => {
    if (!bestStrategy?.payoff_order?.length || !strategies?.debts) return []
    const allDebts = strategies.debts
    const order = bestStrategy.payoff_order
    let cumulativeMonths = 0
    const items = []
    for (const name of order) {
      const debt = allDebts.find(d => d.name === name)
      if (!debt) continue
      // Rough estimate: months until this debt is paid (proportional)
      const rec = bestStrategy.recommended_payments?.find(r => r.name === name)
      const pmt = rec?.recommended_payment || debt.min_payment || 1
      const rate = debt.rate_annual / 100 / 12
      let m = 0
      let bal = debt.balance
      while (bal > 0.01 && m < 600) {
        bal += bal * rate
        bal -= pmt
        m++
      }
      cumulativeMonths = Math.max(cumulativeMonths, m)
      const date = new Date()
      date.setMonth(date.getMonth() + cumulativeMonths)
      items.push({ name, months: m, date: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), balance: debt.balance })
    }
    return items.sort((a, b) => a.months - b.months)
  })()

  // Asset/liability bar proportions
  const total = (dash.assets || 0) + Math.abs(dash.liabilities || 0)
  const assetPct = total > 0 ? (dash.assets / total) * 100 : 0

  // White surface, no shadow — creates contrast against the grey page bg cleanly
  const S = {
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius)',
    padding: '24px 28px',
    marginBottom: 16,
  }

  const SectionLabel = ({ children, sub }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>{children}</span>
      {sub && <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 400 }}>{sub}</span>}
    </div>
  )

  const Row = ({ label, sub, value, valueColor, bold }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <span style={{ fontSize: 14, fontWeight: bold ? 700 : 500, color: 'var(--text-primary)' }}>{label}</span>
        {sub && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 7 }}>{sub}</span>}
      </div>
      <span style={{ fontSize: bold ? 15 : 14, fontWeight: bold ? 700 : 600,
        color: valueColor || 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  )

  const COL_LOANS = '1fr 100px 64px 100px 96px 44px'

  // Unified loan rows: hand-tracked + synced in one table
  const allLoanRows = [
    ...loans.map(l => ({ ...l, _kind: 'tracked' })),
    ...syncedLoans.map(a => ({ ...a, _kind: 'synced', current_balance: Math.abs(a.balance || 0) })),
  ]

  return (
    <div className="page-enter" style={{ padding: '32px 36px 80px' }}>

      {/* ── Hero: Net Worth ───────────────────────────────────────────────────── */}
      <div style={S}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: 'var(--text-tertiary)', marginBottom: 10 }}>Net Worth</div>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em',
              color: moneyColor(dash.net_worth), lineHeight: 1, marginBottom: 6 }}>
              {money(dash.net_worth)}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              <span style={{ color: (dash.net_worth_change ?? 0) >= 0 ? 'var(--accent-text)' : 'var(--red)', fontWeight: 600 }}>
                {nwChangeSign}{money(Math.abs(dash.net_worth_change ?? 0))}
              </span>
              {' '}vs last month
            </div>
          </div>

          {bestStrategy?.debt_free_date && (
            <div style={{ textAlign: 'right', paddingTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--text-tertiary)', marginBottom: 6 }}>Debt Free</div>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--accent-text)', lineHeight: 1 }}>
                {new Date(bestStrategy.debt_free_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{months(bestStrategy.months)} from now</div>
            </div>
          )}
        </div>

        {/* Assets / liabilities bar */}
        <div style={{ height: 8, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,59,48,0.15)', marginBottom: 8 }}>
          <div style={{ height: '100%', width: `${assetPct}%`, background: 'var(--accent)', borderRadius: 4,
            transition: 'width 0.6s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: 'var(--accent-text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {money(dash.assets)} <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>assets</span>
          </span>
          <span style={{ fontSize: 13, color: 'var(--red)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {money(dash.liabilities)} <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>liabilities</span>
          </span>
        </div>
      </div>

      {/* ── Balance sheet + Forward look ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isWide ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 16, alignItems: 'start' }}>

        {/* Balance sheet */}
        <div style={S}>
          <SectionLabel>Assets</SectionLabel>
          {checkingAccounts.map(a => (
            <Row key={a.id} label={a.name} sub={a.type} value={money(a.balance)} valueColor="var(--accent-text)" />
          ))}
          {(dash.tmrs_balance ?? 0) > 0 && (
            <Row label="TMRS" sub="Pension" value={money(dash.tmrs_balance)} valueColor="var(--accent-text)" />
          )}
          <Row label="Total Assets" value={money(dash.assets)} valueColor="var(--accent-text)" bold />

          <div style={{ height: 1, background: 'var(--border)', margin: '20px 0' }} />

          <SectionLabel>Liabilities</SectionLabel>
          {cardDebt.map(c => (
            <Row key={c.id} label={c.name} sub="Credit card" value={money(c.balance)} valueColor="var(--red)" />
          ))}
          {loanAccounts.map(a => (
            <Row key={a.id} label={a.name} sub={a.type} value={money(Math.abs(a.balance || 0))} valueColor="var(--red)" />
          ))}
          <Row label="Total Liabilities" value={money(dash.liabilities)} valueColor="var(--red)" bold />
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {strategies && (
            <div style={S}>
              <SectionLabel sub={`avalanche${strategies.extra_monthly > 0 ? ` · $${strategies.extra_monthly}/mo extra` : ''}`}>
                Payoff Order
              </SectionLabel>
              {timeline.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Enter APR and minimum payments in the Debt tab to see projections</div>
              ) : timeline.map((item, i) => (
                <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--accent-dim)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: 'var(--accent-text)', flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{item.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.date}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>{money(item.balance)}</span>
                </div>
              ))}
            </div>
          )}

          {tmrs !== null && (
            <div style={S}>
              <TmrsCard data={tmrs} onSave={loadTmrs} />
            </div>
          )}
        </div>
      </div>

      {/* ── Loans ────────────────────────────────────────────────────────────── */}
      <div style={S}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <SectionLabel sub="amortization &amp; balances">Loans</SectionLabel>
          <button className="apple-btn-secondary" style={{ fontSize: 12, marginTop: -14 }} onClick={() => setLoanModal(null)}>+ Add Loan</button>
        </div>

        {allLoanRows.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>No loans yet — click <strong>+ Add Loan</strong> to start tracking.</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: COL_LOANS, gap: 8, padding: '6px 0 10px', borderBottom: '2px solid var(--border)' }}>
              {['Name', 'Balance', 'Rate', 'Payment', 'Payoff', ''].map((h, i) => (
                <div key={i} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: 'var(--text-tertiary)', textAlign: i >= 1 && i <= 4 ? 'right' : 'left' }}>{h}</div>
              ))}
            </div>

            {allLoanRows.map(loan => {
              if (loan._kind === 'synced') {
                return (
                  <div key={`synced-${loan.id}`} style={{ display: 'grid', gridTemplateColumns: COL_LOANS,
                    gap: 8, padding: '10px 0', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 7 }}>
                        {loan.name}
                        <span style={{ fontSize: 10, background: 'rgba(59,130,246,0.12)', color: '#3b82f6',
                          borderRadius: 20, padding: '1px 7px', fontWeight: 700 }}>SimpleFin</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1, textTransform: 'capitalize' }}>{loan.type || 'loan'}</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>{money(loan.current_balance)}</div>
                    <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-tertiary)' }}>{loan.interest_rate ? `${loan.interest_rate}%` : '—'}</div>
                    <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-tertiary)' }}>—</div>
                    <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-tertiary)' }}>—</div>
                    <div />
                  </div>
                )
              }

              if (deleteLoanId === loan.id) return (
                <div key={loan.id} style={{ display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 0', borderBottom: '1px solid var(--border)', background: 'rgba(255,59,48,0.04)' }}>
                  <span style={{ fontSize: 13, color: 'var(--red)', flex: 1 }}>Delete <strong>{loan.name}</strong>?</span>
                  <button disabled={deletingLoan}
                    onClick={async () => { setDeletingLoan(true); await fetch(`${API}/loans/${loan.id}`, { method: 'DELETE' }); setDeletingLoan(false); setDeleteLoanId(null); loadLoans() }}
                    style={{ background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 6,
                      padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {deletingLoan ? '…' : 'Yes, delete'}
                  </button>
                  <button className="apple-btn-secondary" style={{ fontSize: 12 }} onClick={() => setDeleteLoanId(null)}>Cancel</button>
                </div>
              )

              const payoffStr = loan.payoff_date
                ? new Date(loan.payoff_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                : '—'
              return (
                <div key={loan.id} style={{ display: 'grid', gridTemplateColumns: COL_LOANS,
                  gap: 8, padding: '10px 0', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{loan.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize', marginTop: 1 }}>{loan.type}</div>
                    {loan.linked_bill_id
                      ? <div style={{ fontSize: 11, color: '#8B5CF6', marginTop: 2 }}>↳ {money(loan.linked_bill_amount)}/mo via Bills</div>
                      : <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: 2 }}>no payment linked</div>
                    }
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>{money(loan.current_balance)}</div>
                  <div style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{loan.interest_rate != null ? `${loan.interest_rate}%` : '—'}</div>
                  <div style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{loan.monthly_payment ? money(loan.monthly_payment) : '—'}</div>
                  <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)' }}>{payoffStr}</div>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button onClick={() => setLoanModal(loan)} title="Edit"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                        color: 'var(--text-tertiary)', fontSize: 15, lineHeight: 1, borderRadius: 4 }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}>✎</button>
                    <button onClick={() => setDeleteLoanId(loan.id)} title="Delete"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                        color: 'var(--text-tertiary)', fontSize: 15, lineHeight: 1, borderRadius: 4 }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}>✕</button>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {loanModal !== undefined && (
        <LoanModal loan={loanModal} onClose={() => setLoanModal(undefined)} onSaved={loadLoans} />
      )}
    </div>
  )
}
