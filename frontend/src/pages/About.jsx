/**
 * About.jsx — "How Hearth Works"
 *
 * A teaching page, not a report. It explains the same money flow every other
 * page already shows (paycheck -> bills/debt -> budget -> spending) as one
 * picture, using exactly the data those pages already read live.
 *
 * ARCHITECTURAL PRINCIPLE: every number here is read from the same endpoints
 * and getters the rest of the app already uses — no hardcoded amounts, no
 * parallel calculation. If this page and another page ever disagree, that's
 * a bug in this file, not a reason to add a new backend route.
 *   - Income:        getMonthlyIncome() from lib/dashboardFields (same as Budget/Dashboard)
 *   - Bills/Debt:     GET /api/bills, split by payment_type, summed via monthly_equivalent
 *                      (same field Budget.jsx sums for its "Fixed Bills" total)
 *   - Budget:         GET /api/budgets (same data Budget.jsx's cards use)
 *   - Spending detail: GET /api/spending/transactions (same endpoint Spending.jsx uses)
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { getMonthlyIncome } from '../lib/dashboardFields'

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

export default function About({ active, navigate }) {
  const [dash, setDash] = useState(null)
  const [bills, setBills] = useState([])
  const [budgets, setBudgets] = useState([])
  const [txns, setTxns] = useState([])
  const [loading, setLoading] = useState(true)
  const [zoomed, setZoomed] = useState(null) // 'bills' | 'debt' | 'budget' | 'spending' | null
  const [hovered, setHovered] = useState(null)

  const load = useCallback(async () => {
    try {
      const [d, b, bg, t] = await Promise.all([
        fetch(`${API}/dashboard`).then(r => r.json()),
        fetch(`${API}/bills`).then(r => r.json()),
        fetch(`${API}/budgets`).then(r => r.json()),
        fetch(`${API}/spending/transactions?days=30`).then(r => r.json()),
      ])
      setDash(d)
      setBills(Array.isArray(b) ? b : [])
      setBudgets(Array.isArray(bg) ? bg : [])
      setTxns(Array.isArray(t) ? t : [])
    } catch { /* page still renders with zeros */ }
    setLoading(false)
  }, [])

  useEffect(() => { if (active) load() }, [active, load])

  const income = getMonthlyIncome(dash)
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
  // Savings goal — same field Budget.jsx's IncomeSummary deducts before "Available".
  const savings = useMemo(() => parseFloat(budgets.find(b => b.category === 'savings')?.monthly_limit) || 0, [budgets])
  const available = Math.max(0, income - fixedBills - debtBills - savings)

  const billRows = useMemo(() => bills.filter(b => b.payment_type === 'Recurring')
    .sort((a, b) => (b.monthly_equivalent ?? b.expected_amount ?? 0) - (a.monthly_equivalent ?? a.expected_amount ?? 0)), [bills])
  const debtRows = useMemo(() => bills.filter(b => b.payment_type === 'Debt' || b.payment_type === 'Loan')
    .sort((a, b) => (b.monthly_equivalent ?? b.expected_amount ?? 0) - (a.monthly_equivalent ?? a.expected_amount ?? 0)), [bills])
  const budgetRows = useMemo(() => [...budgets].sort((a, b) => (b.spent || 0) - (a.spent || 0)), [budgets])
  const topTxns = useMemo(() => [...txns].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 8), [txns])

  // ── Sankey geometry ──────────────────────────────────────────────────────
  // Vertical scale: total income maps to a fixed pixel height. Three segments
  // stack on the paycheck bar in the same order they branch out to the right.
  const total = Math.max(income, 1)
  const PLOT_H = 280
  const scale = PLOT_H / total
  const nodeW = 10
  const gap = 14 // visual breathing room between stacked segments on the source bar

  const billsH = fixedBills * scale
  const debtH = debtBills * scale
  const savingsH = savings * scale
  const budgetH = available * scale

  const yTop = 30
  const billsY0 = yTop, billsY1 = billsY0 + billsH
  const debtY0 = billsY1 + gap, debtY1 = debtY0 + debtH
  const savingsY0 = debtY1 + gap, savingsY1 = savingsY0 + savingsH
  const budgetY0 = savingsY1 + gap, budgetY1 = budgetY0 + budgetH

  const paycheckX = 140
  const destX = 480
  const spendX = 760

  const colors = { bills: 'var(--red)', debt: 'var(--orange)', savings: 'var(--accent)', budget: 'var(--blue)', spending: 'var(--purple)' }
  const dim = (key) => (hovered && hovered !== key) || (zoomed && zoomed !== key)

  if (!active) return null

  return (
    <div style={{ padding: 28, maxWidth: 1020, margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>How Hearth works</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          One paycheck, three destinations. Click any band to see what's actually in it.
        </div>
      </div>

      {/* Top stat strip */}
      <div className="apple-card" style={{ padding: '18px 24px', display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatCard label="Monthly income" value={money(income)} />
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
              <svg viewBox="0 0 900 340" width="100%" style={{ overflow: 'visible', display: 'block' }}>
                <defs>
                  {Object.entries(colors).map(([k, c]) => (
                    <linearGradient id={`grad-${k}`} key={k} x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0%" stopColor={c} stopOpacity="0.55" />
                      <stop offset="100%" stopColor={c} stopOpacity="0.32" />
                    </linearGradient>
                  ))}
                </defs>

                {/* ── Ribbons (drawn first, under the node bars) ── */}
                <path d={ribbonPath(paycheckX + nodeW, billsY0, billsY1, destX, billsY0, billsY1)}
                  fill="url(#grad-bills)" stroke={colors.bills} strokeWidth="0.5"
                  opacity={dim('bills') ? 0.25 : 1} style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                  onMouseEnter={() => setHovered('bills')} onMouseLeave={() => setHovered(null)} onClick={() => setZoomed('bills')} />
                <path d={ribbonPath(paycheckX + nodeW, debtY0, debtY1, destX, debtY0, debtY1)}
                  fill="url(#grad-debt)" stroke={colors.debt} strokeWidth="0.5"
                  opacity={dim('debt') ? 0.25 : 1} style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                  onMouseEnter={() => setHovered('debt')} onMouseLeave={() => setHovered(null)} onClick={() => setZoomed('debt')} />
                <path d={ribbonPath(paycheckX + nodeW, savingsY0, savingsY1, destX, savingsY0, savingsY1)}
                  fill="url(#grad-savings)" stroke={colors.savings} strokeWidth="0.5"
                  opacity={dim('savings') ? 0.25 : 1} style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                  onMouseEnter={() => setHovered('savings')} onMouseLeave={() => setHovered(null)} onClick={() => setZoomed('savings')} />
                <path d={ribbonPath(paycheckX + nodeW, budgetY0, budgetY1, destX, budgetY0, budgetY1)}
                  fill="url(#grad-budget)" stroke={colors.budget} strokeWidth="0.5"
                  opacity={dim('budget') ? 0.25 : 1} style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                  onMouseEnter={() => setHovered('budget')} onMouseLeave={() => setHovered(null)} onClick={() => setZoomed('budget')} />
                <path d={ribbonPath(destX + nodeW, budgetY0, budgetY1, spendX, budgetY0, budgetY1)}
                  fill="url(#grad-spending)" stroke={colors.spending} strokeWidth="0.5"
                  opacity={dim('spending') ? 0.25 : 1} style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                  onMouseEnter={() => setHovered('spending')} onMouseLeave={() => setHovered(null)} onClick={() => setZoomed('spending')} />

                {/* ── Node bars ── */}
                <rect x={paycheckX} y={yTop} width={nodeW} height={budgetY1 - yTop} rx="3" fill="var(--accent)" />
                <rect x={destX} y={billsY0} width={nodeW} height={billsH} rx="3" fill={colors.bills} />
                <rect x={destX} y={debtY0} width={nodeW} height={debtH} rx="3" fill={colors.debt} />
                <rect x={destX} y={savingsY0} width={nodeW} height={savingsH} rx="3" fill={colors.savings} />
                <rect x={destX} y={budgetY0} width={nodeW} height={budgetH} rx="3" fill={colors.budget} />
                <rect x={spendX} y={budgetY0} width={nodeW} height={budgetH} rx="3" fill={colors.spending} />

                {/* ── Labels ── */}
                <g fontSize="12.5" fontWeight="600" fill="var(--text-primary)">
                  <text x={paycheckX - 14} y={(yTop + budgetY1) / 2 - 6} textAnchor="end">Paycheck</text>
                  <text x={paycheckX - 14} y={(yTop + budgetY1) / 2 + 11} textAnchor="end" fontWeight="700" fontSize="13" fill="var(--accent-text)">{money(income)}/mo</text>

                  <text x={destX + nodeW + 12} y={(billsY0 + billsY1) / 2 - 6} textAnchor="start">Bills</text>
                  <text x={destX + nodeW + 12} y={(billsY0 + billsY1) / 2 + 11} textAnchor="start" fontWeight="700" fontSize="13" fill={colors.bills}>{money(fixedBills)}/mo</text>

                  <text x={destX + nodeW + 12} y={(debtY0 + debtY1) / 2 - 6} textAnchor="start">Debt</text>
                  <text x={destX + nodeW + 12} y={(debtY0 + debtY1) / 2 + 11} textAnchor="start" fontWeight="700" fontSize="13" fill={colors.debt}>{money(debtBills)}/mo</text>

                  <text x={destX + nodeW + 12} y={(savingsY0 + savingsY1) / 2 - 6} textAnchor="start">Savings</text>
                  <text x={destX + nodeW + 12} y={(savingsY0 + savingsY1) / 2 + 11} textAnchor="start" fontWeight="700" fontSize="13" fill={colors.savings}>{money(savings)}/mo</text>

                  <text x={destX - 12} y={(budgetY0 + budgetY1) / 2 - 6} textAnchor="end">Budget</text>
                  <text x={destX - 12} y={(budgetY0 + budgetY1) / 2 + 11} textAnchor="end" fontWeight="700" fontSize="13" fill={colors.budget}>{money(available)}/mo</text>

                  <text x={spendX + nodeW + 12} y={(budgetY0 + budgetY1) / 2 - 6} textAnchor="start">Spending</text>
                  <text x={spendX + nodeW + 12} y={(budgetY0 + budgetY1) / 2 + 11} textAnchor="start" fontWeight="700" fontSize="13" fill={colors.spending}>{money(spentSoFar)} so far</text>
                </g>
              </svg>
            </div>
          )}

          {/* Plain-language summary sentence */}
          {!loading && (
            <div style={{ marginTop: 18, fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6 }}>
              Out of every <strong style={{ color: 'var(--text-primary)' }}>{money(income)}</strong> paycheck,{' '}
              <strong style={{ color: 'var(--red)' }}>{money(fixedBills)}</strong> is already claimed by bills and{' '}
              <strong style={{ color: 'var(--orange)' }}>{money(debtBills)}</strong> by debt before you ever see it —
              another <strong style={{ color: 'var(--accent-text)' }}>{money(savings)}</strong> goes to savings —
              leaving <strong style={{ color: 'var(--blue)' }}>{money(available)}</strong> to actually budget and spend.
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
                title={`Savings — ${money(savings)}/mo goal`}
                sub="Your savings target, set on the Budget tab — not a transaction category, so it never shows real spending."
                rows={savings > 0 ? [["Savings goal", money(savings), "monthly target"]] : []}
                emptyText="No savings goal set yet."
                onJump={() => navigate?.('budget')}
                jumpLabel="Go to Budget →"
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
