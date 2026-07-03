import { useState, useEffect, useCallback } from 'react'
import Portal from '../components/Portal'

const API = '/hearth/api'

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth <= 768)
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth <= 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return mobile
}

function money(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `-$${s}` : `$${s}`
}

const TYPES = ['checking', 'savings', 'investment', 'credit', 'loan', 'personal_loan']

// Higher-level grouping for organizing the page — separate from the granular `type`
// field, which still drives net-worth math and stays editable per account.
const CATEGORIES = [
  { label: 'Cash',         types: ['checking', 'savings'] },
  { label: 'Credit Cards', types: ['credit'] },
  { label: 'Loans',        types: ['loan', 'personal_loan'] },
  { label: 'Investments',  types: ['investment'] },
]

function popoverStyle(anchor, width) {
  const w = Math.min(width, window.innerWidth - 40)
  const base = { position: 'fixed', zIndex: 400, width: w, background: 'var(--bg-card, #fff)', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', overflowY: 'auto' }
  if (!anchor) return { ...base, top: 80, right: 20 }
  const right = Math.max(16, window.innerWidth - anchor.right)
  const top = anchor.bottom + 8
  return { ...base, top, right, maxHeight: window.innerHeight - top - 20 }
}

function EditableText({ value, onSave, placeholder }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')

  function commit() {
    setEditing(false)
    if (draft !== (value || '')) onSave(draft)
  }

  if (editing) {
    return (
      <input
        className="apple-input"
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value || ''); setEditing(false) } }}
        style={{ fontSize: 13, width: '100%' }}
      />
    )
  }
  return (
    <button
      onClick={() => { setDraft(value || ''); setEditing(true) }}
      title="Click to edit"
      style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', textAlign: 'left',
        fontSize: 13, fontWeight: 500, color: value ? 'var(--text-primary)' : 'var(--text-tertiary)',
        fontFamily: 'inherit', width: '100%', fontStyle: value ? 'normal' : 'italic',
      }}
    >
      {value || placeholder || '—'}
    </button>
  )
}

function AddAccountModal({ anchor, onClose, onSave }) {
  const [form, setForm] = useState({ name: '', institution: '', type: 'checking', current_balance: '' })
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function save() {
    if (!form.name.trim()) return
    const isDebt = form.type === 'credit' || form.type === 'loan' || form.type === 'personal_loan'
    const bal = form.current_balance ? parseFloat(form.current_balance) : 0
    const body = {
      name: form.name.trim(),
      type: form.type,
      institution: form.institution || null,
      current_balance: isDebt ? -Math.abs(bal) : bal,
    }
    await fetch(`${API}/accounts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    onSave(); onClose()
  }

  return (
    <Portal>
      <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onClick={onClose} />
      <div className="apple-card" style={{ ...popoverStyle(anchor, 420), padding: '28px 32px' }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 20 }}>Add Account</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <div className="apple-label" style={{ marginBottom: 4 }}>Account Name</div>
            <input className="apple-input" value={form.name} onChange={e => f('name', e.target.value)} placeholder="e.g. Emergency Fund" style={{ width: '100%' }} />
          </div>
          <div>
            <div className="apple-label" style={{ marginBottom: 4 }}>Institution</div>
            <input className="apple-input" value={form.institution} onChange={e => f('institution', e.target.value)} placeholder="e.g. USAA" />
          </div>
          <div>
            <div className="apple-label" style={{ marginBottom: 4 }}>Type</div>
            <select className="apple-select" value={form.type} onChange={e => f('type', e.target.value)} style={{ width: '100%' }}>
              {TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <div className="apple-label" style={{ marginBottom: 4 }}>Current Balance</div>
            <input className="apple-input" type="number" step="1" value={form.current_balance} onChange={e => f('current_balance', e.target.value)} placeholder="0.00" />
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

const COL = '1fr 140px 130px 120px 90px 90px 90px'

function AccountCard({ a, isDupe, updateField, deactivate, reactivate }) {
  return (
    <div className="apple-card" style={{
      padding: '14px 16px', marginBottom: 10,
      opacity: a.is_active ? 1 : 0.5,
      background: isDupe ? 'rgba(255,149,0,0.05)' : undefined,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isDupe && <span title="Shares a name with another active account">⚠️</span>}
            <EditableText value={a.name} onSave={v => updateField(a.id, 'name', v)} />
          </div>
          <div style={{ fontSize: 12, marginTop: 2 }}>
            <EditableText value={a.institution} onSave={v => updateField(a.id, 'institution', v)} placeholder="add institution" />
          </div>
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: a.balance < 0 ? 'var(--red)' : 'var(--accent-text)', flexShrink: 0, textAlign: 'right' }}>
          {money(a.balance)}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <select className="apple-select" value={a.type} onChange={e => updateField(a.id, 'type', e.target.value)} style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
          {TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
          {a.simplefin_id ? 'SimpleFin' : 'Manual'}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: a.is_active ? 'var(--accent-text)' : 'var(--text-tertiary)' }}>
          {a.is_active ? 'Active' : 'Inactive'}
        </span>
        {a.is_active ? (
          <button className="apple-btn-danger" onClick={() => deactivate(a.id)} style={{ fontSize: 11, padding: '4px 10px' }}>Deactivate</button>
        ) : (
          <button className="apple-btn-secondary" onClick={() => reactivate(a.id)} style={{ fontSize: 11, padding: '4px 10px' }}>Reactivate</button>
        )}
      </div>
    </div>
  )
}

function ManualLoanRow({ loan, isMobile }) {
  if (isMobile) {
    return (
      <div className="apple-card" style={{ padding: '14px 16px', marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{loan.name}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--red)' }}>{money(-Math.abs(loan.current_balance || 0))}</div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Manual Loan — manage in Debt tab</span>
      </div>
    )
  }
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COL, gap: 10, padding: '9px 4px', alignItems: 'center',
      borderBottom: '1px solid var(--border)', minWidth: 760,
    }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{loan.name}</div>
      <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>—</span>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>loan</span>
      <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--red)' }}>
        {money(-Math.abs(loan.current_balance || 0))}
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Manual</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)' }}>—</span>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Debt tab</span>
    </div>
  )
}

function AccountSection({ label, accounts, duplicateIds, updateField, deactivate, reactivate, isMobile, manualLoans = [] }) {
  if (accounts.length === 0 && manualLoans.length === 0) return null
  const total = accounts.filter(a => a.is_active).reduce((s, a) => s + (a.balance || 0), 0)
    - manualLoans.reduce((s, l) => s + Math.abs(l.current_balance || 0), 0)

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: total < 0 ? 'var(--red)' : 'var(--accent-text)' }}>
          {money(total)}
        </span>
      </div>

      {isMobile ? (
        <>
          {accounts.map(a => (
            <AccountCard key={a.id} a={a} isDupe={duplicateIds.has(a.id)} updateField={updateField} deactivate={deactivate} reactivate={reactivate} />
          ))}
          {manualLoans.map(l => <ManualLoanRow key={`loan-${l.id}`} loan={l} isMobile />)}
        </>
      ) : (
        <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '0 20px', overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: COL, gap: 10, padding: '9px 4px', borderBottom: '2px solid var(--border)', minWidth: 760 }}>
            {['Name', 'Institution', 'Type', 'Balance', 'Source', 'Status', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{h}</div>
            ))}
          </div>
          {accounts.map(a => {
            const isDupe = duplicateIds.has(a.id)
            return (
              <div key={a.id} style={{
                display: 'grid', gridTemplateColumns: COL, gap: 10, padding: '9px 4px', alignItems: 'center',
                borderBottom: '1px solid var(--border)', minWidth: 760,
                opacity: a.is_active ? 1 : 0.5,
                background: isDupe ? 'rgba(255,149,0,0.05)' : 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {isDupe && <span title="Shares a name with another active account">⚠️</span>}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <EditableText value={a.name} onSave={v => updateField(a.id, 'name', v)} />
                  </div>
                </div>
                <EditableText value={a.institution} onSave={v => updateField(a.id, 'institution', v)} placeholder="add institution" />
                <select className="apple-select" value={a.type} onChange={e => updateField(a.id, 'type', e.target.value)} style={{ fontSize: 12 }}>
                  {TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </select>
                <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: a.balance < 0 ? 'var(--red)' : 'var(--accent-text)' }}>
                  {money(a.balance)}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {a.simplefin_id ? 'SimpleFin' : 'Manual'}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: a.is_active ? 'var(--accent-text)' : 'var(--text-tertiary)' }}>
                  {a.is_active ? 'Active' : 'Inactive'}
                </span>
                <div>
                  {a.is_active ? (
                    <button className="apple-btn-danger" onClick={() => deactivate(a.id)} style={{ fontSize: 11, padding: '3px 9px' }}>Deactivate</button>
                  ) : (
                    <button className="apple-btn-secondary" onClick={() => reactivate(a.id)} style={{ fontSize: 11, padding: '3px 9px' }}>Reactivate</button>
                  )}
                </div>
              </div>
            )
          })}
          {manualLoans.map(l => <ManualLoanRow key={`loan-${l.id}`} loan={l} />)}
        </div>
      )}
    </div>
  )
}

export default function Accounts({ active }) {
  const [accounts, setAccounts] = useState(null)
  const [manualLoans, setManualLoans] = useState([])
  const [showInactive, setShowInactive] = useState(false)
  const [addAnchor, setAddAnchor] = useState(null)
  const isMobile = useIsMobile()

  const load = useCallback(async () => {
    try {
      const [data, loans] = await Promise.all([
        fetch(`${API}/accounts?include_inactive=true`).then(r => r.json()),
        fetch(`${API}/loans`).then(r => r.json()),
      ])
      setAccounts(Array.isArray(data) ? data : [])
      setManualLoans(Array.isArray(loans) ? loans : [])
    } catch {}
  }, [])

  useEffect(() => { if (active) load() }, [active, load])

  async function updateField(id, field, value) {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a))
    await fetch(`${API}/accounts/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    }).catch(() => {})
  }

  async function deactivate(id) {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, is_active: 0 } : a))
    await fetch(`${API}/accounts/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  async function reactivate(id) {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, is_active: 1 } : a))
    await fetch(`${API}/accounts/${id}/reactivate`, { method: 'POST' }).catch(() => {})
  }

  if (!accounts) return (
    <div style={{ padding: '48px 36px' }}>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>Loading…</div>
    </div>
  )

  // Duplicate detection — group by normalized name, flag groups with more than
  // one currently-active account sharing that name.
  const nameKey = n => (n || '').trim().toLowerCase()
  const groups = {}
  accounts.forEach(a => {
    const k = nameKey(a.name)
    if (!groups[k]) groups[k] = []
    groups[k].push(a)
  })
  const duplicateIds = new Set()
  Object.values(groups).forEach(group => {
    const activeInGroup = group.filter(a => a.is_active)
    if (activeInGroup.length > 1) activeInGroup.forEach(a => duplicateIds.add(a.id))
  })

  const visible = accounts.filter(a => showInactive || a.is_active)
  const sorted = [...visible].sort((a, b) => {
    if (a.is_active !== b.is_active) return b.is_active - a.is_active
    return (a.name || '').localeCompare(b.name || '')
  })

  return (
    <div className="page-enter" style={{ padding: isMobile ? '20px 16px 80px' : '32px 36px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {accounts.filter(a => a.is_active).length} active · {accounts.filter(a => !a.is_active).length} inactive
        </span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
            Show inactive
          </label>
          <button className="apple-btn-primary" onClick={e => setAddAnchor(e.currentTarget.getBoundingClientRect())} style={{ fontSize: isMobile ? 13 : 14 }}>+ Add Account</button>
        </div>
      </div>

      {duplicateIds.size > 0 && (
        <div style={{
          background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.3)',
          borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: 'var(--orange)',
        }}>
          ⚠️ {duplicateIds.size} account{duplicateIds.size !== 1 ? 's' : ''} share a name with another active account — check the rows marked below before trusting net worth totals. If one is stale, deactivate it.
        </div>
      )}

      {CATEGORIES.map(cat => (
        <AccountSection
          key={cat.label}
          label={cat.label}
          accounts={sorted.filter(a => cat.types.includes(a.type))}
          duplicateIds={duplicateIds}
          updateField={updateField}
          deactivate={deactivate}
          reactivate={reactivate}
          isMobile={isMobile}
          manualLoans={cat.label === 'Loans' ? manualLoans : []}
        />
      ))}
      <AccountSection
        label="Other"
        accounts={sorted.filter(a => !TYPES.includes(a.type))}
        duplicateIds={duplicateIds}
        updateField={updateField}
        deactivate={deactivate}
        reactivate={reactivate}
        isMobile={isMobile}
      />

      {addAnchor && <AddAccountModal anchor={addAnchor} onClose={() => setAddAnchor(null)} onSave={load} />}
    </div>
  )
}
