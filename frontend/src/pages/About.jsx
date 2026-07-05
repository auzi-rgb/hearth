/**
 * About.jsx — "How Hearth Works"
 *
 * A teaching page, not a report. It explains the same money flow every other
 * page already shows (paycheck -> bills/debt -> budget -> spending), viewable
 * three ways (toggle, remembered per browser):
 *   - System:    the household's actual two-account topology (paychecks ->
 *                Bills account -> obligations off the top -> transfer -> Food)
 *   - Flow:      Monarch-style Sankey — proportional ribbons from one paycheck
 *   - Waterfall: income stepping down through bills/debt/savings to "to live on"
 *
 * ARCHITECTURAL PRINCIPLE: every number here is read from the same endpoints
 * and getters the rest of the app already uses — no hardcoded amounts, no
 * parallel calculation. If this page and another page ever disagree, that's
 * a bug in this file, not a reason to add a new backend route.
 *   - Income:        getMonthlyIncome() from lib/dashboardFields (same as Budget/Dashboard)
 *   - Bills/Debt:     GET /api/bills, split by payment_type, summed via monthly_equivalent
 *   - Budget:         GET /api/budgets (same data Budget.jsx's cards use)
 *   - Spending detail: GET /api/spending/transactions (same endpoint Spending.jsx uses)
 *   - Accuracy strip: GET /api/bills/creep (drift) + GET /api/sync/log (freshness)
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { getMonthlyIncome, getBaselineIncome } from '../lib/dashboardFields'

const API = '/hearth/api'

function money(v) {
  if (v == null || isNaN(v)) return '—'
  const abs = Math.abs(v)
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return v < 0 ? `-$${s}` : `$${s}`
}

// d3-sankey-style horizontal link ribbon: a filled band whose top and bottom
// edges are each a cubic bezier with the control x at the horizontal midpoint —
// this is what makes real Sankey diagrams (Monarch, etc.) look like flowing
// water instead of a thick stroked line with rounded caps.
function ribbonPath(x1, y0a, y1a, x2, y0b, y1b) {
  const xm = (x1 + x2) / 2
  return `M${x1},${y0a} C${xm},${y0a} ${xm},${y0b} ${x2},${y0b} L${x2},${y1b} C${xm},${y1b} ${xm},${y1a} ${x1},${y1a} Z`
}

const COLORS = { bills: 'var(--red)', debt: 'var(--orange)', savings: 'var(--accent)', budget: 'var(--blue)', spending: 'var(--purple)' }

function StatCard({ label, value, color }) {
  return (
    <div style={{ flex: '1 1 140px', minWidth: 130 }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: color || 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  )
}

// ── View 1: Flow (Sankey) ─────────────────────────────────────────────────────
function FlowView({ n, dim, setHovered, setZoomed }) {
  const total = Math.max(n.income, 1)
  const PLOT_H = 280
  const scale = PLOT_H / total
  const nodeW = 10
  const gap = 14

  const billsH = n.fixedBills * scale
  const debtH = n.debtBills * scale
  const savingsH = Math.max(n.savings * scale, 2)
  const budgetH = n.available * scale

  const yTop = 30
  const billsY0 = yTop, billsY1 = billsY0 + billsH
  const debtY0 = billsY1 + gap, debtY1 = debtY0 + debtH
  const savingsY0 = debtY1 + gap, savingsY1 = savingsY0 + savingsH
  const budgetY0 = savingsY1 + gap, budgetY1 = budgetY0 + budgetH

  const paycheckX = 140
  const destX = 480
  const spendX = 760

  const band = (key, d) => (
    <path d={d} fill={`url(#grad-${key})`} stroke={COLORS[key]} strokeWidth="0.5"
      opacity={dim(key) ? 0.25 : 1} style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
      onMouseEnter={() => setHovered(key)} onMouseLeave={() => setHovered(null)} onClick={() => setZoomed(key)} />
  )

  return (
    <svg viewBox="0 0 900 340" width="100%" style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        {Object.entries(COLORS).map(([k, c]) => (
          <linearGradient id={`grad-${k}`} key={k} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={c} stopOpacity="0.55" />
            <stop offset="100%" stopColor={c} stopOpacity="0.32" />
          </linearGradient>
        ))}
      </defs>

      {band('bills', ribbonPath(paycheckX + nodeW, billsY0, billsY1, destX, billsY0, billsY1))}
      {band('debt', ribbonPath(paycheckX + nodeW, debtY0, debtY1, destX, debtY0, debtY1))}
      {band('savings', ribbonPath(paycheckX + nodeW, savingsY0, savingsY1, destX, savingsY0, savingsY1))}
      {band('budget', ribbonPath(paycheckX + nodeW, budgetY0, budgetY1, destX, budgetY0, budgetY1))}
      {band('spending', ribbonPath(destX + nodeW, budgetY0, budgetY1, spendX, budgetY0, budgetY1))}

      <rect x={paycheckX} y={yTop} width={nodeW} height={budgetY1 - yTop} rx="3" fill="var(--accent)" />
      <rect x={destX} y={billsY0} width={nodeW} height={billsH} rx="3" fill={COLORS.bills} />
      <rect x={destX} y={debtY0} width={nodeW} height={debtH} rx="3" fill={COLORS.debt} />
      <rect x={destX} y={savingsY0} width={nodeW} height={savingsH} rx="3" fill={COLORS.savings} />
      <rect x={destX} y={budgetY0} width={nodeW} height={budgetH} rx="3" fill={COLORS.budget} />
      <rect x={spendX} y={budgetY0} width={nodeW} height={budgetH} rx="3" fill={COLORS.spending} />

      <g fontSize="12.5" fontWeight="600" fill="var(--text-primary)">
        <text x={paycheckX - 14} y={(yTop + budgetY1) / 2 - 6} textAnchor="end">Paycheck</text>
        <text x={paycheckX - 14} y={(yTop + budgetY1) / 2 + 11} textAnchor="end" fontWeight="700" fontSize="13" fill="var(--accent-text)">{money(n.income)}/mo</text>

        <text x={destX + nodeW + 12} y={(billsY0 + billsY1) / 2 - 6} textAnchor="start">Bills</text>
        <text x={destX + nodeW + 12} y={(billsY0 + billsY1) / 2 + 11} textAnchor="start" fontWeight="700" fontSize="13" fill={COLORS.bills}>{money(n.fixedBills)}/mo</text>

        <text x={destX + nodeW + 12} y={(debtY0 + debtY1) / 2 - 6} textAnchor="start">Debt</text>
        <text x={destX + nodeW + 12} y={(debtY0 + debtY1) / 2 + 11} textAnchor="start" fontWeight="700" fontSize="13" fill={COLORS.debt}>{money(n.debtBills)}/mo</text>

        <text x={destX + nodeW + 12} y={(savingsY0 + savingsY1) / 2 - 6} textAnchor="start">Savings</text>
        <text x={destX + nodeW + 12} y={(savingsY0 + savingsY1) / 2 + 11} textAnchor="start" fontWeight="700" fontSize="13" fill={COLORS.savings}>{money(n.savings)}/mo</text>

        <text x={destX - 12} y={(budgetY0 + budgetY1) / 2 - 6} textAnchor="end">Budget</text>
        <text x={destX - 12} y={(budgetY0 + budgetY1) / 2 + 11} textAnchor="end" fontWeight="700" fontSize="13" fill={COLORS.budget}>{money(n.available)}/mo</text>

        <text x={spendX + nodeW + 12} y={(budgetY0 + budgetY1) / 2 - 6} textAnchor="start">Spending</text>
        <text x={spendX + nodeW + 12} y={(budgetY0 + budgetY1) / 2 + 11} textAnchor="start" fontWeight="700" fontSize="13" fill={COLORS.spending}>{money(n.spentSoFar)} so far</text>
      </g>
    </svg>
  )
}

// ── View 2: Waterfall — income stepping down through the off-the-top items ──
function WaterfallView({ n, dim, setHovered, setZoomed }) {
  const total = Math.max(n.income, 1)
  const PLOT_H = 240
  const scale = PLOT_H / total
  const base = 300
  const top = base - PLOT_H
  const barW = 120
  const xs = { income: 40, bills: 212, debt: 384, savings: 556, budget: 728 }

  const billsH = n.fixedBills * scale
  const debtH = n.debtBills * scale
  const savingsH = Math.max(n.savings * scale, 3)
  const budgetH = Math.max(n.available * scale, 3)

  const billsTop = top
  const debtTop = top + billsH
  const savingsTop = debtTop + debtH
  const budgetTop = base - budgetH

  const bar = (key, x, y, h, fill) => (
    <rect x={x} y={y} width={barW} height={Math.max(h, 3)} rx="6" fill={fill}
      opacity={dim(key) ? 0.25 : 0.85} style={{ cursor: key === 'income' ? 'default' : 'pointer', transition: 'opacity 0.2s' }}
      onMouseEnter={() => key !== 'income' && setHovered(key)} onMouseLeave={() => setHovered(null)}
      onClick={() => key !== 'income' && setZoomed(key)} />
  )

  const conn = (x1, x2, y) => (
    <line x1={x1} y1={y} x2={x2} y2={y} stroke="var(--border)" strokeDasharray="3 3" />
  )

  return (
    <svg viewBox="0 0 900 340" width="100%" style={{ overflow: 'visible', display: 'block' }}>
      {conn(xs.income + barW, xs.bills + barW, top)}
      {conn(xs.bills + barW, xs.debt + barW, debtTop)}
      {conn(xs.debt + barW, xs.savings + barW, savingsTop)}
      {conn(xs.savings + barW, xs.budget + barW, budgetTop)}

      {bar('income', xs.income, top, PLOT_H, 'var(--accent)')}
      {bar('bills', xs.bills, billsTop, billsH, COLORS.bills)}
      {bar('debt', xs.debt, debtTop, debtH, COLORS.debt)}
      {bar('savings', xs.savings, savingsTop, savingsH, COLORS.savings)}
      {bar('budget', xs.budget, budgetTop, budgetH, COLORS.budget)}

      <g fontSize="13" fontWeight="700" textAnchor="middle" fontVariantNumeric="tabular-nums">
        <text x={xs.income + barW / 2} y={top - 10} fill="var(--accent-text)">{money(n.income)}</text>
        <text x={xs.bills + barW / 2} y={billsTop - 10} fill={COLORS.bills}>−{money(n.fixedBills)}</text>
        <text x={xs.debt + barW / 2} y={debtTop - 10} fill={COLORS.debt}>−{money(n.debtBills)}</text>
        <text x={xs.savings + barW / 2} y={savingsTop - 10} fill="var(--accent-text)">−{money(n.savings)}</text>
        <text x={xs.budget + barW / 2} y={budgetTop - 10} fill={COLORS.budget}>{money(n.available)}</text>
      </g>
      <g fontSize="12.5" fontWeight="600" textAnchor="middle" fill="var(--text-secondary)">
        <text x={xs.income + barW / 2} y={base + 22}>Income</text>
        <text x={xs.bills + barW / 2} y={base + 22}>Bills</text>
        <text x={xs.debt + barW / 2} y={base + 22}>Debt</text>
        <text x={xs.savings + barW / 2} y={base + 22}>Savings</text>
        <text x={xs.budget + barW / 2} y={base + 22}>To live on</text>
      </g>
    </svg>
  )
}

// ── View 3: System — the household's actual two-account money topology ──────
function SystemView({ n, dash, dim, setHovered, setZoomed }) {
  const total = Math.max(n.income, 1)
  // Pipe widths proportional to dollars, clamped so nothing vanishes or bloats
  const pw = v => Math.max(5, Math.min(34, (v / total) * 64))

  const nextXferLabel = dash?.next_transfer_date
    ? new Date(dash.next_transfer_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  const box = (key, x, y, w, h, color, title, line2, line3) => (
    <g opacity={key && dim(key) ? 0.3 : 1} style={{ cursor: key ? 'pointer' : 'default', transition: 'opacity 0.2s' }}
      onMouseEnter={() => key && setHovered(key)} onMouseLeave={() => setHovered(null)}
      onClick={() => key && setZoomed(key)}>
      <rect x={x} y={y} width={w} height={h} rx="12" fill={color} opacity="0.1" />
      <rect x={x} y={y} width={w} height={h} rx="12" fill="none" stroke={color} strokeWidth="1.5" />
      <text x={x + w / 2} y={y + (line3 ? 24 : line2 ? 27 : h / 2 + 5)} textAnchor="middle" fontSize="13.5" fontWeight="600" fill="var(--text-primary)">{title}</text>
      {line2 && <text x={x + w / 2} y={y + (line3 ? 42 : 46)} textAnchor="middle" fontSize="12.5" fontWeight="700" fill={color} fontVariantNumeric="tabular-nums">{line2}</text>}
      {line3 && <text x={x + w / 2} y={y + 60} textAnchor="middle" fontSize="11.5" fill="var(--text-secondary)" fontVariantNumeric="tabular-nums">{line3}</text>}
    </g>
  )

  const pipe = (key, d, color, width) => (
    <path d={d} stroke={color} strokeWidth={width} fill="none" opacity={key && dim(key) ? 0.15 : 0.45}
      strokeLinecap="round" style={{ cursor: key ? 'pointer' : 'default', transition: 'opacity 0.2s' }}
      onMouseEnter={() => key && setHovered(key)} onMouseLeave={() => setHovered(null)}
      onClick={() => key && setZoomed(key)} />
  )

  return (
    <svg viewBox="0 0 900 430" width="100%" style={{ overflow: 'visible', display: 'block' }}>
      {pipe(null, 'M195,204 C 255,204 265,204 325,204', 'var(--accent)', pw(n.income))}
      {pipe('bills', 'M520,180 C 615,180 615,72 700,72', COLORS.bills, pw(n.fixedBills))}
      {pipe('debt', 'M520,222 C 615,222 615,162 700,162', COLORS.debt, pw(n.debtBills))}
      {pipe('budget', 'M422,252 C 422,290 422,290 422,318', COLORS.spending, pw(n.available))}
      {pipe('spending', 'M520,356 C 615,356 615,360 700,360', COLORS.budget, pw(Math.min(n.spentSoFar, n.available) || 1))}

      {box(null, 35, 172, 160, 64, 'var(--accent)', 'Paychecks', `${money(n.income)}/mo`)}
      {box(null, 325, 152, 195, 100, 'var(--blue)', 'Bills Account', dash?.bills_balance != null ? `${money(dash.bills_balance)} today` : '', 'every dollar lands here')}
      {box('bills', 700, 42, 170, 60, COLORS.bills, 'Bills', `${money(n.fixedBills)}/mo`)}
      {box('debt', 700, 132, 170, 60, COLORS.debt, 'Debt payoff', `${money(n.debtBills)}/mo`)}
      {box('budget', 325, 318, 195, 76, 'var(--purple)', 'Food Account', dash?.food_balance != null ? `${money(dash.food_balance)} today` : '', 'everyday living')}
      {box('spending', 700, 330, 170, 60, COLORS.budget, 'Spending', `${money(n.spentSoFar)} so far`)}

      <g fontSize="11.5" fill="var(--text-secondary)">
        <text x="448" y="278">transfer the surplus</text>
        <text x="448" y="294" fill="var(--text-tertiary)">
          {money(n.available)}/mo{nextXferLabel ? ` · next ${nextXferLabel}` : ''}
        </text>
      </g>
      {dash?.food_daily_allowance != null && (
        <text x="785" y="410" fontSize="11.5" textAnchor="middle" fill="var(--text-tertiary)">
          runway {money(dash.food_daily_allowance)}/day until transfer
        </text>
      )}
    </svg>
  )
}

const VIEWS = [
  { id: 'system', label: 'Your System' },
  { id: 'flow', label: 'Flow' },
  { id: 'waterfall', label: 'Waterfall' },
]
const VIEW_SUBTITLES = {
  system: 'How money actually moves through your two accounts. Click any box to see what’s in it.',
  flow: 'One paycheck, proportional destinations. Click any band to see what’s actually in it.',
  waterfall: 'Bills and debt come off the top — what’s left is what you live on. Click any bar.',
}

export default function About({ active, navigate }) {
  const [dash, setDash] = useState(null)
  const [bills, setBills] = useState([])
  const [budgets, setBudgets] = useState([])
  const [txns, setTxns] = useState([])
  const [creep, setCreep] = useState(null)
  const [lastSync, setLastSync] = useState(null)
  const [loading, setLoading] = useState(true)
  const [zoomed, setZoomed] = useState(null) // 'bills' | 'debt' | 'savings' | 'budget' | 'spending' | null
  const [hovered, setHovered] = useState(null)
  const [view, setView] = useState(() => localStorage.getItem('hearth_about_view') || 'system')

  function pickView(v) { setView(v); localStorage.setItem('hearth_about_view', v) }

  const load = useCallback(async () => {
    try {
      const [d, b, bg, t, c, sl] = await Promise.all([
        fetch(`${API}/dashboard`).then(r => r.json()),
        fetch(`${API}/bills`).then(r => r.json()),
        fetch(`${API}/budgets`).then(r => r.json()),
        fetch(`${API}/spending/transactions?days=30`).then(r => r.json()),
        fetch(`${API}/bills/creep`).then(r => r.json()).catch(() => null),
        fetch(`${API}/sync/log`).then(r => r.json()).catch(() => []),
      ])
      setDash(d)
      setBills(Array.isArray(b) ? b : [])
      setBudgets(Array.isArray(bg) ? bg : [])
      setTxns(Array.isArray(t) ? t : [])
      setCreep(c)
      setLastSync(Array.isArray(sl) && sl[0]?.synced_at ? sl[0].synced_at : null)
    } catch { /* page still renders with zeros */ }
    setLoading(false)
  }, [])

  useEffect(() => { if (active) load() }, [active, load])

  // Bands are drawn from BASELINE income — the planning picture. An
  // extra-paycheck month would otherwise stretch the paycheck bar and make
  // "available" look double its real self; the actual figure shows as a stat.
  const income = getBaselineIncome(dash)
  const actualIncome = getMonthlyIncome(dash)
  const extraThisMonth = actualIncome > income + 50 ? actualIncome - income : null
  const fixedBills = useMemo(
    () => bills.filter(b => b.payment_type === 'Recurring').reduce((s, b) => s + (b.monthly_equivalent ?? b.expected_amount ?? 0), 0),
    [bills]
  )
  const debtBills = useMemo(
    () => bills.filter(b => b.payment_type === 'Debt' || b.payment_type === 'Loan').reduce((s, b) => s + (b.monthly_equivalent ?? b.expected_amount ?? 0), 0),
    [bills]
  )
  const budgeted = useMemo(() => budgets.reduce((s, b) => s + (parseFloat(b.monthly_limit) || 0), 0), [budgets])
  const spentSoFar = useMemo(() => budgets.reduce((s, b) => s + (parseFloat(b.spent) || 0), 0), [budgets])
  // Savings band = Contribution bills (real scheduled transfers to HYSA/Roth/529)
  // plus any budget savings goal. Contributions are the chosen, adjustable tier.
  const contribBills = useMemo(
    () => bills.filter(b => b.payment_type === 'Contribution').reduce((s, b) => s + (b.monthly_equivalent ?? b.expected_amount ?? 0), 0),
    [bills]
  )
  const savingsGoal = useMemo(() => parseFloat(budgets.find(b => b.category === 'savings')?.monthly_limit) || 0, [budgets])
  const savings = contribBills + savingsGoal
  const available = Math.max(0, income - fixedBills - debtBills - savings)

  const billRows = useMemo(() => bills.filter(b => b.payment_type === 'Recurring')
    .sort((a, b) => (b.monthly_equivalent ?? b.expected_amount ?? 0) - (a.monthly_equivalent ?? a.expected_amount ?? 0)), [bills])
  const debtRows = useMemo(() => bills.filter(b => b.payment_type === 'Debt' || b.payment_type === 'Loan')
    .sort((a, b) => (b.monthly_equivalent ?? b.expected_amount ?? 0) - (a.monthly_equivalent ?? a.expected_amount ?? 0)), [bills])
  const budgetRows = useMemo(() => [...budgets].sort((a, b) => (b.spent || 0) - (a.spent || 0)), [budgets])
  const topTxns = useMemo(() => [...txns].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 8), [txns])

  const dim = (key) => (hovered && hovered !== key) || (zoomed && zoomed !== key)

  if (!active) return null

  const n = { income, fixedBills, debtBills, savings, available, spentSoFar }
  const drifting = creep?.drifting?.length || 0
  const lastSyncLabel = lastSync
    ? new Date(lastSync).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div style={{ padding: 28, maxWidth: 1020, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>How Hearth works</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {VIEW_SUBTITLES[view]}
          </div>
        </div>
        {/* View switcher */}
        <div style={{ display: 'flex', background: 'var(--bg-subtle)', borderRadius: 9, padding: 3, gap: 2 }}>
          {VIEWS.map(v => (
            <button key={v.id} onClick={() => pickView(v.id)}
              style={{
                fontSize: 12, fontWeight: view === v.id ? 600 : 400, fontFamily: 'inherit',
                padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: view === v.id ? 'var(--bg-card)' : 'transparent',
                color: view === v.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                boxShadow: view === v.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s',
              }}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Top stat strip */}
      <div className="apple-card" style={{ padding: '18px 24px', display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatCard label="Baseline income" value={money(income)} />
        {extraThisMonth && <StatCard label="This month actual" value={money(actualIncome)} color="var(--accent-text)" />}
        <StatCard label="Bills" value={`-${money(fixedBills)}`} color="var(--red)" />
        <StatCard label="Debt" value={`-${money(debtBills)}`} color="var(--orange)" />
        <StatCard label="Savings" value={`-${money(savings)}`} color="var(--accent-text)" />
        <StatCard label="Available to budget" value={money(available)} color="var(--blue)" />
        <StatCard label="Spent so far" value={money(spentSoFar)} color="var(--purple)" />
      </div>

      <div style={{ position: 'relative', minHeight: 420 }}>
        <div style={{
          opacity: zoomed ? 0 : 1, filter: zoomed ? 'blur(6px)' : 'none', pointerEvents: zoomed ? 'none' : 'auto',
          transition: 'opacity 0.3s ease, filter 0.3s ease',
        }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading your numbers…</div>
          ) : (
            <div className="apple-card" style={{ padding: '32px 36px 24px' }}>
              {view === 'flow' && <FlowView n={n} dim={dim} setHovered={setHovered} setZoomed={setZoomed} />}
              {view === 'waterfall' && <WaterfallView n={n} dim={dim} setHovered={setHovered} setZoomed={setZoomed} />}
              {view === 'system' && <SystemView n={n} dash={dash} dim={dim} setHovered={setHovered} setZoomed={setZoomed} />}
            </div>
          )}

          {/* Plain-language summary sentence */}
          {!loading && (
            <div style={{ marginTop: 18, fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6 }}>
              Out of a normal month's <strong style={{ color: 'var(--text-primary)' }}>{money(income)}</strong>,{' '}
              <strong style={{ color: 'var(--red)' }}>{money(fixedBills)}</strong> is already claimed by bills and{' '}
              <strong style={{ color: 'var(--orange)' }}>{money(debtBills)}</strong> by debt before you ever see it —
              another <strong style={{ color: 'var(--accent-text)' }}>{money(savings)}</strong> goes to savings —
              leaving <strong style={{ color: 'var(--blue)' }}>{money(available)}</strong> to actually budget and spend.
            </div>
          )}

          {/* Accuracy strip — this picture is only as honest as the Bills list */}
          {!loading && (
            <div style={{
              marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexWrap: 'wrap', gap: 6, fontSize: 12, color: 'var(--text-tertiary)',
            }}>
              <span>Built live from <strong style={{ color: 'var(--text-secondary)' }}>{bills.length} tracked bills</strong></span>
              {drifting > 0 && (
                <>
                  <span>·</span>
                  <span style={{ color: 'var(--orange, #FF9500)', fontWeight: 600 }}>
                    {drifting} costing more than expected
                  </span>
                </>
              )}
              {lastSyncLabel && <><span>·</span><span>last sync {lastSyncLabel}</span></>}
              <span>·</span>
              <button onClick={() => navigate?.('bills')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  fontSize: 12, color: 'var(--blue)', fontFamily: 'inherit' }}>
                review bills →
              </button>
            </div>
          )}
        </div>

        {/* ── Zoomed detail panels ───────────────────────────────────────── */}
        {zoomed && (
          <div style={{ position: 'absolute', inset: 0, top: 0 }}>
            <button onClick={() => setZoomed(null)} className="apple-btn-secondary" style={{ fontSize: 12, padding: '6px 14px', marginBottom: 16 }}>
              ← back to overview
            </button>

            {zoomed === 'bills' && (
              <DetailList
                title={`Bills — ${money(fixedBills)}/mo`}
                sub={`${billRows.length} fixed bill${billRows.length === 1 ? '' : 's'}, read live from your Bills tab`}
                rows={billRows.map(b => [b.linked_name || b.display_name || b.name, money(b.monthly_equivalent ?? b.expected_amount), b.next_due ? `due ${b.next_due}` : ''])}
                emptyText="No recurring bills set up yet."
                onJump={() => navigate?.('bills')}
                jumpLabel="Go to Bills →"
              />
            )}
            {zoomed === 'debt' && (
              <DetailList
                title={`Debt — ${money(debtBills)}/mo minimums`}
                sub={`${debtRows.length} debt/loan payment${debtRows.length === 1 ? '' : 's'}, read live from your Bills & Debt tabs`}
                rows={debtRows.map(b => [b.linked_name || b.display_name || b.name, money(b.monthly_equivalent ?? b.expected_amount), b.next_due ? `due ${b.next_due}` : ''])}
                emptyText="No debt or loan payments scheduled."
                onJump={() => navigate?.('debt')}
                jumpLabel="Go to Debt →"
              />
            )}
            {zoomed === 'savings' && (
              <DetailList
                title={`Savings — ${money(savings)}/mo`}
                sub="Contribution bills (scheduled transfers to savings/investment accounts) plus any budget savings goal. The chosen tier — adjust here before living money gets squeezed."
                rows={[
                  ...bills.filter(b => b.payment_type === 'Contribution')
                    .sort((a, b) => (b.monthly_equivalent ?? b.expected_amount ?? 0) - (a.monthly_equivalent ?? a.expected_amount ?? 0))
                    .map(b => [b.display_name || b.name, money(b.monthly_equivalent ?? b.expected_amount), b.next_due ? `next ${b.next_due}` : '']),
                  ...(savingsGoal > 0 ? [["Budget savings goal", money(savingsGoal), "monthly target"]] : []),
                ]}
                emptyText="No contributions yet — this band grows the day the debt band hits zero."
                onJump={() => navigate?.('bills')}
                jumpLabel="Go to Bills →"
              />
            )}
            {zoomed === 'budget' && (
              <DetailList
                title={`Budget — ${money(available)}/mo available`}
                sub={`${budgetRows.length} categor${budgetRows.length === 1 ? 'y' : 'ies'} budgeted, ${money(budgeted)} allocated so far`}
                rows={budgetRows.map(b => [b.category, `${money(b.spent)} / ${b.monthly_limit > 0 ? money(b.monthly_limit) : 'no limit set'}`, b.pct > 0 ? `${b.pct}%` : ''])}
                emptyText="No budget categories with spending yet."
                onJump={() => navigate?.('budget')}
                jumpLabel="Go to Budget →"
              />
            )}
            {zoomed === 'spending' && (
              <DetailList
                title={`Spending — ${money(spentSoFar)} so far this month`}
                sub={topTxns.length ? `Largest transaction in the last 30 days: ${topTxns[0].description}, ${money(Math.abs(topTxns[0].amount))}` : 'No transactions in the last 30 days'}
                rows={topTxns.map(t => [t.description, money(Math.abs(t.amount)), t.transaction_date])}
                emptyText="No transactions in the last 30 days."
                onJump={() => navigate?.('spending')}
                jumpLabel="Go to Spending →"
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DetailList({ title, sub, rows, emptyText, onJump, jumpLabel }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>{sub}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
        {rows.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '12px 0' }}>{emptyText}</div>
        )}
        {rows.map((r, i) => (
          <div key={i} className="apple-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px' }}>
            <span style={{ fontWeight: 500, fontSize: 13 }}>{r[0]}</span>
            <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{r[2]}</span>
            <span style={{ fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{r[1]}</span>
          </div>
        ))}
      </div>
      {onJump && (
        <button onClick={onJump} className="apple-btn-secondary" style={{ fontSize: 12, padding: '6px 14px', marginTop: 16 }}>
          {jumpLabel}
        </button>
      )}
    </div>
  )
}
