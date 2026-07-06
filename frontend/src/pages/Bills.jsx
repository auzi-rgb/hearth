import { useState, useEffect, useCallback } from 'react'
import Portal from '../components/Portal'

const API = '/hearth/api'

function money(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `-$${s}` : `$${s}`
}

const TYPE_BADGE = {
  Recurring:    { label: 'Recurring',    bg: '#3B82F6' },
  Loan:         { label: 'Loan',         bg: '#8B5CF6' },
  Debt:         { label: 'Debt',         bg: '#F59E0B' },
  Contribution: { label: 'Contribution', bg: '#10B981' },
}

// Commitment tiers. Monthly Bills + Debt Payoff = the hardline (must be paid).
// Contributions are chosen transfers — the adjustable tier, and the first
// place to cut when the plan squeezes living money onto credit cards.
const BILL_GROUPS = [
  { title: 'Monthly Bills', types: ['Recurring'], color: '#3B82F6',
    desc: 'Obligations — these must be paid.' },
  { title: 'Debt Payoff', types: ['Loan', 'Debt'], color: '#F59E0B',
    desc: 'Minimums plus chosen extra. Monthly Bills + Debt Payoff = your hardline.' },
  { title: 'Contributions', types: ['Contribution'], color: '#10B981',
    desc: 'Chosen transfers to savings and investments — adjust these first if living money gets tight.' },
]

function TypeBadge({ type }) {
  const cfg = TYPE_BADGE[type] || TYPE_BADGE.Recurring
  return (
    <span style={{ background: cfg.bg, color: '#fff', borderRadius: 20,
      padding: '3px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
      display: 'inline-block' }}>
      {cfg.label}
    </span>
  )
}

function ConfBadge({ confidence }) {
  const fixed = confidence === 'fixed'
  return (
    <span style={{
      background: fixed ? 'rgba(52,199,89,0.15)' : 'rgba(245,158,11,0.15)',
      color: fixed ? 'var(--accent-text)' : '#b45309',
      borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 600,
      whiteSpace: 'nowrap', display: 'inline-block',
    }}>
      {fixed ? 'Fixed' : 'Variable'}
    </span>
  )
}

function BillModal({ bill, loans, debtAccounts, allBills, onClose, onSaved }) {
  const isEdit = !!bill
  const [form, setForm] = useState({
    name:            bill?.name                      ?? '',
    display_name:    bill?.display_name              ?? '',
    payment_type:    bill?.payment_type              ?? 'Recurring',
    expected_amount: bill?.expected_amount != null   ? String(bill.expected_amount) : '',
    day_of_month:    bill?.day_of_month    != null   ? String(bill.day_of_month)    : '',
    confidence:      bill?.confidence                ?? 'fixed',
    notes:           bill?.notes                     ?? '',
    autopay:         bill?.autopay != null ? !!bill.autopay : true,
    linked_loan_id:    bill?.linked_loan_id    ?? null,
    linked_account_id: bill?.linked_account_id ?? null,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  // Warn (don't block) if the selected loan/account already has a different active
  // bill linked to it — two bills both claiming the same debt double-counts it in
  // every payoff calculation, and is exactly the kind of silent drift to catch here.
  const conflictingBill = (allBills || []).find(b =>
    b.id !== bill?.id && b.is_active !== false && (
      (form.linked_account_id && b.linked_account_id === form.linked_account_id) ||
      (form.linked_loan_id && b.linked_loan_id === form.linked_loan_id)
    )
  )

  function setField(k, v) {
    setForm(prev => {
      const next = { ...prev, [k]: v }
      if (k === 'payment_type' && (v === 'Loan' || v === 'Debt')) next.confidence = 'fixed'
      // Only clear an existing link when the bill stops being any kind of debt payment.
      // Loan <-> Debt is just a label change at that point — a credit card edited here
      // still carries its link from the Debt tab's "Set as Bill" flow, and switching
      // the dropdown between Loan/Debt views of the same link must not erase it.
      if (k === 'payment_type' && (v === 'Recurring' || v === 'Contribution')) { next.linked_loan_id = null; next.linked_account_id = null }
      return next
    })
  }

  // One dropdown covers both hand-tracked loans (loans table) and synced loan
  // accounts (Best Egg, a Capital One auto loan, etc.) — value is prefixed so we
  // know which table the id refers to.
  const linkValue = form.linked_account_id ? `account:${form.linked_account_id}`
    : form.linked_loan_id ? `loan:${form.linked_loan_id}` : ''
  function setLink(v) {
    if (!v) { setForm(p => ({ ...p, linked_loan_id: null, linked_account_id: null })); return }
    const [kind, idStr] = v.split(':')
    const id = parseInt(idStr)
    setForm(p => ({
      ...p,
      linked_loan_id: kind === 'loan' ? id : null,
      linked_account_id: kind === 'account' ? id : null,
    }))
  }

  async function submit() {
    if (!form.name.trim())       { setError('Name is required.');     return }
    if (!form.expected_amount)   { setError('Amount is required.');   return }
    if (!form.day_of_month && bill?.frequency !== 'weekly') { setError('Due day is required.'); return }
    setSaving(true); setError(null)
    try {
      // Picking a synced account while Type=Loan auto-promotes storage to Debt (same
      // mechanism credit cards use) — otherwise keep whatever Type is already set.
      const finalPaymentType = (form.payment_type === 'Loan' && form.linked_account_id) ? 'Debt' : form.payment_type
      // Links are only ever cleared by explicitly setting Type to Recurring (see
      // setField above) — never inferred here from payment_type, so an existing
      // credit-card or loan link survives editing any other field on the bill.
      const body = {
        name:            form.name.trim(),
        display_name:    form.display_name.trim() || null,
        payment_type:    finalPaymentType,
        expected_amount: parseFloat(form.expected_amount),
        day_of_month:    parseInt(form.day_of_month),
        confidence:      form.confidence,
        notes:           form.notes.trim() || null,
        autopay:         form.autopay ? 1 : 0,
        linked_loan_id:    (finalPaymentType === 'Loan' || finalPaymentType === 'Debt') ? (form.linked_loan_id || null) : null,
        linked_account_id: (finalPaymentType === 'Loan' || finalPaymentType === 'Debt') ? (form.linked_account_id || null) : null,
      }
      const url    = isEdit ? `${API}/bills/${bill.id}` : `${API}/bills`
      const method = isEdit ? 'PUT' : 'POST'
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error('Save failed')
      onSaved()
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const forceFixed = form.payment_type === 'Loan' || form.payment_type === 'Debt'

  return (
    <Portal>
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      background: 'rgba(0,0,0,0.08)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="apple-card" style={{ maxWidth: 440, width: '100%', padding: '28px 28px 24px',
        maxHeight: '90vh', overflowY: 'auto', position: 'relative', background: 'var(--bg-modal)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{isEdit ? 'Edit Bill' : 'Add Bill'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 20, color: 'var(--text-tertiary)', padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        {error && (
          <div style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)',
            borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--red)', marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="apple-label" style={{ marginBottom: 5 }}>Display Name</div>
            {bill?.linked_name ? (
              <>
                <div className="apple-input" style={{ width: '100%', color: 'var(--text-tertiary)', cursor: 'not-allowed' }}>
                  {bill.linked_name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  This bill is linked to a debt account — rename it from the Debt tab and it'll update here too.
                </div>
              </>
            ) : (
              <input className="apple-input" value={form.display_name}
                onChange={e => setField('display_name', e.target.value)}
                placeholder="e.g. Netflix, Best Egg Loan" style={{ width: '100%' }} />
            )}
          </div>
          <div>
            <div className="apple-label" style={{ marginBottom: 5 }}>Bank Description <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(used for auto-matching)</span></div>
            <input className="apple-input" value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder="e.g. NETFLIX.COM NETFLIX.COM CA" style={{ width: '100%' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Type</div>
              <select className="apple-select" value={form.payment_type}
                onChange={e => setField('payment_type', e.target.value)} style={{ width: '100%' }}>
                <option value="Recurring">Recurring</option>
                <option value="Loan">Loan</option>
                <option value="Debt">Debt</option>
                <option value="Contribution">Contribution</option>
              </select>
            </div>
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Amount ($)</div>
              <input className="apple-input" type="number" step="0.01" placeholder="0.00"
                value={form.expected_amount} onChange={e => setField('expected_amount', e.target.value)}
                style={{ width: '100%' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Day of Month</div>
              {bill?.frequency === 'weekly' ? (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', paddingTop: 8 }}>
                  Weekly — cycle managed in Debt tab
                </div>
              ) : (
                <input className="apple-input" type="number" min="1" max="31" placeholder="1–31"
                  value={form.day_of_month} onChange={e => setField('day_of_month', e.target.value)}
                  style={{ width: '100%' }} />
              )}
            </div>
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Confidence</div>
              <select className="apple-select" value={form.confidence}
                onChange={e => setField('confidence', e.target.value)}
                disabled={forceFixed}
                style={{ width: '100%', opacity: forceFixed ? 0.45 : 1, cursor: forceFixed ? 'not-allowed' : 'pointer' }}>
                <option value="fixed">Fixed</option>
                <option value="estimated">Variable</option>
              </select>
            </div>
          </div>

          {(form.payment_type === 'Loan' || form.payment_type === 'Debt') && (
            <div>
              <div className="apple-label" style={{ marginBottom: 5 }}>Linked Account</div>
              <select className="apple-select"
                value={linkValue}
                onChange={e => setLink(e.target.value)}
                style={{ width: '100%' }}>
                <option value="">— not linked —</option>
                {debtAccounts?.filter(a => a.type === 'credit').length > 0 && (
                  <optgroup label="Credit cards">
                    {debtAccounts.filter(a => a.type === 'credit').map(a => (
                      <option key={`account:${a.id}`} value={`account:${a.id}`}>{a.display_name || a.name}</option>
                    ))}
                  </optgroup>
                )}
                {debtAccounts?.filter(a => a.type !== 'credit').length > 0 && (
                  <optgroup label="Synced loan accounts">
                    {debtAccounts.filter(a => a.type !== 'credit').map(a => (
                      <option key={`account:${a.id}`} value={`account:${a.id}`}>{a.display_name || a.name}</option>
                    ))}
                  </optgroup>
                )}
                {loans?.length > 0 && (
                  <optgroup label="Hand-tracked loans">
                    {loans.map(l => (
                      <option key={`loan:${l.id}`} value={`loan:${l.id}`}>{l.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                Links this payment to the credit card or loan it's actually paying off — either synced via SimpleFin or hand-entered in the Debt tab
              </div>
              {conflictingBill && (
                <div style={{ fontSize: 11, color: 'var(--orange)', marginTop: 6, lineHeight: 1.5 }}>
                  ⚠ "{conflictingBill.name}" is already linked to this same loan — that debt would get double-counted in payoff math. Unlink one of them.
                </div>
              )}
            </div>
          )}

          <div>
            <div className="apple-label" style={{ marginBottom: 5 }}>
              Notes <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(optional)</span>
            </div>
            <input className="apple-input" value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              placeholder="Any notes…" style={{ width: '100%' }} />
          </div>

          <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 4 }}>
            <input type="checkbox" checked={form.autopay}
              onChange={e => setField('autopay', e.target.checked)}
              style={{ accentColor: 'var(--accent)', cursor: 'pointer', width: 16, height: 16 }} />
            <span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>Autopay</span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                Paid automatically — Hearth won't ask you to confirm it and mutes it on the Calendar
              </span>
            </span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="apple-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="apple-btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Bill'}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  )
}

const COL = '20px 44px 1fr 94px 100px 82px minmax(0,140px) 28px 28px'

function TableHeader() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COL, gap: 8,
      padding: '8px 4px', borderBottom: '1px solid var(--border)' }}>
      {['', 'Day', 'Name', 'Type', 'Amount', 'Confidence', 'Notes', '', ''].map((h, i) => (
        <div key={i} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: 0.6, color: 'var(--text-tertiary)',
          textAlign: i === 1 || i === 4 ? 'right' : 'left' }}>
          {h}
        </div>
      ))}
    </div>
  )
}

export default function Bills({ active }) {
  const [bills, setBills]     = useState(null)
  const [loans, setLoans]     = useState([])
  const [debtAccounts, setDebtAccounts] = useState([])
  const [deleteId, setDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [editBill, setEditBill] = useState(undefined) // undefined=closed, null=new, obj=edit
  const [creep, setCreep] = useState(null)
  const [showAnnual, setShowAnnual] = useState(false)
  const [squeeze, setSqueeze] = useState(null)

  const load = useCallback(() => {
    fetch(`${API}/bills`).then(r => r.json()).then(setBills).catch(() => {})
    fetch(`${API}/bills/creep`).then(r => r.json()).then(setCreep).catch(() => {})
    fetch(`${API}/dashboard`).then(r => r.json())
      .then(d => setSqueeze({ left: d.left_to_live, living: d.actual_living_median, gap: d.living_squeeze }))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (active) {
      load()
      fetch(`${API}/loans`).then(r => r.json()).then(setLoans).catch(() => {})
      // Every debt-bearing account (credit cards + synced loans) — this is what a
      // Loan or Debt bill can link to, alongside hand-tracked loans above. Showing
      // credit cards here too means a card's link can be checked or fixed from the
      // Bills tab, not just the Debt tab's "Set as Bill" flow.
      fetch(`${API}/accounts`).then(r => r.json())
        .then(accts => setDebtAccounts(accts.filter(a => a.type === 'loan' || a.type === 'personal_loan' || a.type === 'credit')))
        .catch(() => {})
    }
  }, [active, load])

  async function confirmDelete(id) {
    setDeleting(true)
    await fetch(`${API}/bills/${id}`, { method: 'DELETE' })
    setDeleting(false)
    setDeleteId(null)
    load()
  }

  if (!bills) return (
    <div style={{ padding: '48px 24px', color: 'var(--text-tertiary)', fontSize: 14 }}>Loading…</div>
  )

  const sorted = [...bills].sort((a, b) => (a.day_of_month ?? 32) - (b.day_of_month ?? 32))
  const total  = bills.reduce((sum, b) => sum + (b.monthly_equivalent ?? b.expected_amount ?? 0), 0)

  const byType = bills.reduce((acc, b) => {
    const t = b.payment_type || 'Recurring'
    acc[t] = (acc[t] || 0) + (b.monthly_equivalent ?? b.expected_amount ?? 0)
    return acc
  }, {})

  return (
    <div className="page-enter" style={{ padding: '32px 36px 80px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.05em', marginBottom: 4 }}>Bills</h1>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            All recurring obligations — sorted by due date
          </div>
        </div>
        <button className="apple-btn-primary" onClick={() => setEditBill(null)} style={{ marginTop: 4 }}>
          + Add Bill
        </button>
      </div>

      {/* Total card */}
      <div className="apple-card" style={{ padding: '18px 24px', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="apple-label" style={{ marginBottom: 4 }}>Total Bills</div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.04em',
            fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', lineHeight: 1 }}>
            {money(total)}
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 4 }}>
              / mo
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-primary)', marginBottom: 2 }}>Hardline</div>
            <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
              {money((byType.Recurring || 0) + (byType.Loan || 0) + (byType.Debt || 0))}
            </div>
          </div>
          {[
            { key: 'Recurring', color: '#3B82F6' },
            { key: 'Loan',      color: '#8B5CF6' },
            { key: 'Debt',      color: '#F59E0B' },
            { key: 'Contribution', color: '#10B981' },
          ].filter(({ key }) => byType[key] > 0).map(({ key, color }) => (
            <div key={key}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color, marginBottom: 2 }}>{key}</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                {money(byType[key])}
              </div>
            </div>
          ))}
          <div>
            <div className="apple-label" style={{ marginBottom: 2 }}>Count</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {bills.length}
            </div>
          </div>
          {creep?.annual_total > 0 && (
            <div style={{ cursor: 'pointer' }} onClick={() => setShowAnnual(s => !s)} title="Click for the per-bill annual breakdown">
              <div className="apple-label" style={{ marginBottom: 2 }}>Per Year {showAnnual ? '▴' : '▾'}</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                {money(creep.annual_total)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Squeeze guard — contributions eating the money you actually live on */}
      {squeeze?.gap != null && squeeze.gap < 0 && (
        <div style={{
          background: 'rgba(255,59,48,0.07)', border: '1px solid rgba(255,59,48,0.3)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>
            ⚠ The plan leaves {money(squeeze.left)}/mo to live on — you actually live on ~{money(squeeze.living)}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            That {money(Math.abs(squeeze.gap))} gap ends up on credit cards, where interest costs more than any
            savings account earns. Trim the Contributions section below before touching food or essentials.
          </div>
        </div>
      )}

      {/* Bill creep — recent payments drifting above the expected amount */}
      {creep?.drifting?.length > 0 && (
        <div style={{
          background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.3)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--orange, #FF9500)', marginBottom: 8 }}>
            ⚠ {creep.drifting.length} bill{creep.drifting.length !== 1 ? 's' : ''} costing more than expected
          </div>
          {creep.drifting.map(d => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              fontSize: 13, padding: '4px 0', gap: 10 }}>
              <span style={{ fontWeight: 500 }}>{d.name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>
                expected {money(d.expected)} · latest <span style={{ color: 'var(--orange, #FF9500)', fontWeight: 600 }}>{money(d.latest)}</span> (+{money(d.delta)})
              </span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
            Either the bill went up (update its expected amount so projections stay honest) or it's worth a call to lower it.
          </div>
        </div>
      )}

      {/* Annual cost ranking — the expense-reduction hit list */}
      {showAnnual && creep?.annual?.length > 0 && (
        <div className="apple-card" style={{ padding: '18px 24px', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>What each bill costs per year</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Sorted biggest first. Small monthly amounts look harmless — the yearly number is what to negotiate or cancel against.
          </div>
          {creep.annual.map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13, gap: 10 }}>
              <span style={{ fontWeight: 500 }}>{a.name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ color: 'var(--text-tertiary)', marginRight: 10 }}>{money(a.monthly)}/mo</span>
                <span style={{ fontWeight: 700 }}>{money(a.annual)}/yr</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Table — horizontal scroll on narrow screens so the 9 fixed columns
          (incl. Edit/Delete on the right) are never clipped off-screen on mobile */}
      <div className="apple-card" style={{ padding: '8px 16px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {bills.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
            No bills yet — click <strong>+ Add Bill</strong> to get started.
          </div>
        ) : (
          <div style={{ minWidth: 620 }}>
            {BILL_GROUPS.map(group => {
            const rows = sorted.filter(b => group.types.includes(b.payment_type || 'Recurring'))
            if (rows.length === 0) return null
            const subtotal = rows.reduce((s, b) => s + (b.monthly_equivalent ?? b.expected_amount ?? 0), 0)
            return (
              <div key={group.title} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 4px 2px' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: group.color }}>
                    {group.title}
                    <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>{rows.length}</span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(subtotal)}/mo</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '0 4px 6px' }}>{group.desc}</div>
                <TableHeader />
                {rows.map(bill => {
              if (deleteId === bill.id) {
                return (
                  <div key={bill.id} style={{ display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 4px', borderBottom: '1px solid var(--border)',
                    background: 'rgba(255,59,48,0.05)', gridColumn: '1 / -1' }}>
                    <span style={{ fontSize: 13, color: 'var(--red)', flex: 1 }}>
                      Delete <strong>{bill.name}</strong>?
                    </span>
                    <button onClick={() => confirmDelete(bill.id)} disabled={deleting}
                      style={{ background: 'var(--red)', color: '#fff', border: 'none',
                        borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'inherit' }}>
                      {deleting ? '…' : 'Yes, delete'}
                    </button>
                    <button onClick={() => setDeleteId(null)} className="apple-btn-secondary"
                      style={{ fontSize: 12 }}>
                      Cancel
                    </button>
                  </div>
                )
              }

              const noteText = bill.notes
                ? (bill.notes.length > 30 ? bill.notes.slice(0, 30) + '…' : bill.notes)
                : ''

              return (
                <div key={bill.id} style={{ display: 'grid', gridTemplateColumns: COL, gap: 8,
                  padding: '11px 4px', alignItems: 'center', borderBottom: '1px solid var(--border)',
                  opacity: bill.paid_this_month ? 0.55 : 1 }}>

                  {/* Paid indicator */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {bill.paid_this_month && (
                      <span style={{ fontSize: 13, color: 'var(--accent-text)', fontWeight: 700 }}>✓</span>
                    )}
                  </div>

                  {/* Day */}
                  <div style={{ textAlign: 'right', fontSize: bill.frequency === 'weekly' ? 12 : 20, fontWeight: 600,
                    color: 'var(--text-tertiary)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {bill.frequency === 'weekly'
                      ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][bill.day_of_week] ?? '—'
                      : bill.day_of_month ?? '—'}
                  </div>

                  {/* Name */}
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }} title={bill.name}>
                      {(bill.payment_type === 'Loan' || bill.payment_type === 'Debt') && !bill.linked_loan_id && !bill.linked_account_id && (
                        <span title="This is marked as a loan/debt payment but isn't linked to anything — it's excluded from payoff math. Click Edit to link it." style={{ cursor: 'help', flexShrink: 0 }}>⚠️</span>
                      )}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bill.linked_name || bill.display_name || bill.name}</span>
                      {bill.frequency === 'weekly' && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--orange)',
                          background: 'rgba(255,149,0,0.12)', borderRadius: 4, padding: '1px 5px',
                          flexShrink: 0, letterSpacing: '0.02em' }} title="Charged every week, not once a month">
                          WEEKLY
                        </span>
                      )}
                      {bill.autopay === 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed',
                          background: 'rgba(124,58,237,0.12)', borderRadius: 4, padding: '1px 5px',
                          flexShrink: 0, letterSpacing: '0.02em' }} title="Paid manually — Hearth surfaces it as an action item">
                          MANUAL
                        </span>
                      )}
                    </div>
                    {(bill.linked_loan_id || bill.linked_account_id) && (
                      <div style={{ fontSize: 11, color: '#8B5CF6', marginTop: 1 }}>↳ linked to {bill.linked_account_id ? 'debt account' : 'loan'}</div>
                    )}
                  </div>

                  {/* Type badge */}
                  <TypeBadge type={bill.payment_type || 'Recurring'} />

                  {/* Amount */}
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {money(bill.expected_amount)}{bill.frequency === 'weekly' && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400 }}>/wk</span>}
                    </div>
                    {bill.frequency === 'weekly' && (
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                        {money(bill.monthly_equivalent)}/mo
                      </div>
                    )}
                  </div>

                  {/* Confidence badge */}
                  <ConfBadge confidence={bill.confidence} />

                  {/* Notes */}
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={bill.notes || ''}>
                    {noteText}
                  </div>

                  {/* Edit */}
                  <button onClick={() => setEditBill(bill)} title="Edit bill"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3,
                      color: 'var(--text-tertiary)', fontSize: 14, lineHeight: 1, borderRadius: 4 }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}>
                    ✎
                  </button>

                  {/* Delete */}
                  <button onClick={() => setDeleteId(bill.id)} title="Delete bill"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3,
                      color: 'var(--text-tertiary)', fontSize: 14, lineHeight: 1, borderRadius: 4 }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}>
                    ✕
                  </button>
                </div>
              )
                })}
              </div>
            )
            })}
          </div>
        )}
      </div>

      {editBill !== undefined && (
        <BillModal
          bill={editBill}
          loans={loans}
          debtAccounts={debtAccounts}
          allBills={bills}
          onClose={() => setEditBill(undefined)}
          onSaved={load}
        />
      )}
    </div>
  )
}
