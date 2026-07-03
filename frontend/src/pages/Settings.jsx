import { useState, useEffect } from 'react'

const API = '/hearth/api'

// Settings is a hub of sub-pages. Only app *setup* lives here — anything used
// while operating the app lives on the page that uses it (account roles + CSV
// import → Accounts, category rules → Spending, AI memory → Assistant,
// safe-spend buffer → Dashboard).
const SETTINGS_PAGES = [
  { id: 'connections', icon: '⇄', title: 'Connections', desc: 'SimpleFin bank sync — connect, disconnect, re-link' },
  { id: 'ai',          icon: '✦', title: 'AI Assistant', desc: 'Model, personality, temperature, auto-run, context data' },
  { id: 'household',   icon: '◉', title: 'Household', desc: 'Members, payroll detection, and pay schedules' },
  { id: 'security',    icon: '⚿', title: 'Security', desc: 'Change the admin password' },
]

function Section({ title, children }) {
  return (
    <div className="apple-card" style={{ padding: '24px 28px', marginBottom: 20 }}>
      {title && <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, letterSpacing: '-0.02em' }}>{title}</div>}
      {children}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="apple-label" style={{ marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>{hint}</div>}
    </div>
  )
}

function StatusMsg({ msg }) {
  if (!msg) return null
  const isError = msg.startsWith('!')
  return (
    <div style={{
      marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13,
      background: isError ? 'rgba(255,59,48,0.08)' : 'rgba(52,199,89,0.1)',
      border: `1px solid ${isError ? 'rgba(255,59,48,0.2)' : 'rgba(52,199,89,0.25)'}`,
      color: isError ? 'var(--red)' : 'var(--accent-text)',
    }}>
      {isError ? msg.slice(1) : msg}
    </div>
  )
}

export default function Settings({ active, onCrumb }) {
  const [view, setView] = useState(null) // null = hub

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState(null)
  const [pwSaving, setPwSaving] = useState(false)

  const [payday, setPayday] = useState({})

  const [household, setHousehold] = useState([])
  const [householdMsg, setHouseholdMsg] = useState(null)
  const [householdSaving, setHouseholdSaving] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [paycheckMin, setPaycheckMin] = useState('500')

  const [xferPhrases, setXferPhrases] = useState('')
  const [xferPhrasesMsg, setXferPhrasesMsg] = useState(null)
  const [xferPhrasesSaving, setXferPhrasesSaving] = useState(false)

  const [simplefinToken, setSimplefinToken] = useState('')
  const [simplefinMsg, setSimplefinMsg] = useState(null)
  const [simplefinSaving, setSimplefinSaving] = useState(false)
  const [hasSimplefin, setHasSimplefin] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const [aiStatus, setAiStatus] = useState(null)
  const [aiModels, setAiModels] = useState([])
  const [aiModel, setAiModel] = useState('')
  const [aiModelMsg, setAiModelMsg] = useState(null)
  const [aiModelSaving, setAiModelSaving] = useState(false)
  const [aiTesting, setAiTesting] = useState(false)
  const [aiTestResponse, setAiTestResponse] = useState(null)

  const DEFAULT_SYSTEM_PROMPT = 'You are a helpful home finance assistant. You have access to the household financial data provided. Answer questions accurately and helpfully. Be concise. Format money as dollar amounts.'
  const [aiSystemPrompt, setAiSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [aiPromptMsg, setAiPromptMsg] = useState(null)
  const [aiPromptSaving, setAiPromptSaving] = useState(false)

  const [aiTemperature, setAiTemperature] = useState(0.7)
  const [aiParamsMsg, setAiParamsMsg] = useState(null)
  const [aiParamsSaving, setAiParamsSaving] = useState(false)

  const PERSONA_PRESETS = {
    strict: 'You are a strict home finance assistant. Be direct and blunt. Immediately flag any overspending, wasteful patterns, or budget violations. Do not soften bad news. Format money as dollar amounts.',
    coach: 'You are an encouraging home finance coach. Frame everything in terms of progress and wins. Acknowledge challenges warmly but keep the tone positive and motivating. Format money as dollar amounts.',
    analyst: 'You are a data-driven financial analyst. Be precise with numbers. Avoid conversational filler — just facts, figures, and clear analysis. Format money as dollar amounts.',
  }

  const [aiAutoRun, setAiAutoRun] = useState(false)
  const [aiAutoRunPrompt, setAiAutoRunPrompt] = useState('Give me a quick briefing on my finances today.')
  const [aiAutoRunMsg, setAiAutoRunMsg] = useState(null)
  const [aiAutoRunSaving, setAiAutoRunSaving] = useState(false)

  const CONTEXT_SECTIONS = [
    { key: 'balances',     label: 'Account Balances',    desc: 'Current balance for each linked account' },
    { key: 'transactions', label: 'Recent Transactions', desc: 'Last 100 transactions (90 days)' },
    { key: 'bills',        label: 'Bill Schedule',       desc: 'All active bills with amounts and due dates' },
    { key: 'debt',         label: 'Debt Summary',        desc: 'Loans and interest rates' },
    { key: 'budget',       label: 'Budget Status',       desc: 'Current month limits, spending, and remaining per category' },
    { key: 'paychecks',    label: 'Upcoming Paychecks',  desc: 'Projected next two pay dates and estimated amounts' },
  ]
  const LS_CTX_KEY = 'hearth_ai_context_sections'
  const [ctxSections, setCtxSections] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_CTX_KEY)) || { balances: true, transactions: true, bills: true, debt: true, budget: true, paychecks: true } }
    catch { return { balances: true, transactions: true, bills: true, debt: true, budget: true, paychecks: true } }
  })
  const [showContext, setShowContext] = useState(false)
  const [contextData, setContextData] = useState(null)
  const [contextLoading, setContextLoading] = useState(false)

  const LS_SAVED_PROMPTS = 'hearth_ai_saved_prompts'
  const [savedPrompts, setSavedPrompts] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_SAVED_PROMPTS)) || [] } catch { return [] }
  })

  // Report the breadcrumb to the app shell whenever the sub-page changes
  useEffect(() => {
    if (!onCrumb) return
    if (!active || view === null) { onCrumb(null); return }
    const page = SETTINGS_PAGES.find(p => p.id === view)
    onCrumb({ label: page?.title || view, onBack: () => setView(null) })
  }, [view, active])

  useEffect(() => {
    if (!active) return
    fetch(`${API}/settings`)
      .then(r => r.json())
      .then(d => {
        let members = []
        try { members = JSON.parse(d.household_members) || [] } catch { members = [] }
        if (!Array.isArray(members)) members = []
        // _kwText holds the raw comma-separated keyword text while editing;
        // it's stripped back to a clean array on save.
        setHousehold(members.map(m => ({ ...m, _kwText: (m.payroll_keywords || []).join(', ') })))
        setPayday(() => {
          const p = {}
          members.forEach(m => {
            p[m.key] = {
              dow: d[`payday_dow_${m.key}`] ?? '3',
              frequency: d[`payday_frequency_${m.key}`] ?? (m.default_frequency || 'biweekly'),
            }
          })
          return p
        })
        if (d.ai_default_model) setAiModel(d.ai_default_model)
        if (d.ai_system_prompt) setAiSystemPrompt(d.ai_system_prompt)
        if (d.ai_temperature) setAiTemperature(parseFloat(d.ai_temperature))
        if (d.ai_autorun) setAiAutoRun(d.ai_autorun === 'true')
        if (d.ai_autorun_prompt) setAiAutoRunPrompt(d.ai_autorun_prompt)
        setHasSimplefin(d.has_simplefin === 'True' || d.has_simplefin === true)
        if (d.paycheck_min_amount) setPaycheckMin(d.paycheck_min_amount)
        if (d.transfer_detection_phrases) setXferPhrases(d.transfer_detection_phrases)
      }).catch(() => {})
    fetch(`${API}/ai/health`)
      .then(r => r.json())
      .then(d => setAiStatus(d.ok ? 'ok' : 'error'))
      .catch(() => setAiStatus('error'))
    fetch(`${API}/ai/models`)
      .then(r => r.json())
      .then(d => setAiModels(d.models || []))
      .catch(() => {})
  }, [active])

  async function changePassword(e) {
    e.preventDefault()
    setPwMsg(null)
    if (!pw.current || !pw.next || !pw.confirm) { setPwMsg('!All fields required'); return }
    if (pw.next !== pw.confirm) { setPwMsg('!New passwords do not match'); return }
    if (pw.next.length < 8) { setPwMsg('!Must be at least 8 characters'); return }
    setPwSaving(true)
    try {
      const r = await fetch(`${API}/auth/change-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', current_password: pw.current, new_password: pw.next }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Failed')
      setPwMsg('Password changed')
      setPw({ current: '', next: '', confirm: '' })
    } catch (e) { setPwMsg('!' + e.message) }
    finally { setPwSaving(false) }
  }

  async function saveHousehold() {
    setHouseholdSaving(true); setHouseholdMsg(null)
    try {
      const cleaned = household.map(m => {
        const { _kwText, ...rest } = m
        return {
          ...rest,
          label: (m.label || '').trim(),
          default_frequency: (payday[m.key] || {}).frequency || m.default_frequency || 'biweekly',
          payroll_keywords: (_kwText ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
          amount_min: m.amount_min === '' || m.amount_min == null ? null : parseFloat(m.amount_min),
          amount_max: m.amount_max === '' || m.amount_max == null ? null : parseFloat(m.amount_max),
        }
      })
      if (cleaned.length === 0) throw new Error('At least one household member is required')
      if (cleaned.some(m => !m.label)) throw new Error('Every member needs a name')
      const puts = [
        fetch(`${API}/settings/household_members`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: JSON.stringify(cleaned) }),
        }),
      ]
      // Pay schedule saves with the member it belongs to — one Save button
      for (const m of cleaned) {
        const pd = payday[m.key]
        if (!pd) continue
        puts.push(fetch(`${API}/settings/payday_dow_${m.key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: pd.dow }) }))
        puts.push(fetch(`${API}/settings/payday_frequency_${m.key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: pd.frequency }) }))
      }
      const minVal = parseFloat(paycheckMin)
      if (!isNaN(minVal) && minVal >= 0) {
        puts.push(fetch(`${API}/settings/paycheck_min_amount`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: minVal }) }))
      }
      const results = await Promise.all(puts)
      if (results.some(r => !r.ok)) throw new Error('Save failed')
      setHouseholdMsg('Saved — applies to the next sync')
    } catch (e) { setHouseholdMsg('!' + e.message) }
    finally { setHouseholdSaving(false) }
  }

  function addMember() {
    const label = newMemberName.trim()
    if (!label) return
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    if (!key) { setHouseholdMsg('!Name must contain letters or numbers'); return }
    if (household.some(m => m.key === key)) { setHouseholdMsg('!That name is already in use'); return }
    setHousehold(h => [...h, {
      key, label, payroll_keywords: [], amount_min: null, amount_max: null,
      default_frequency: 'biweekly', _kwText: '',
    }])
    setPayday(p => ({ ...p, [key]: { dow: '3', frequency: 'biweekly' } }))
    setNewMemberName('')
    setHouseholdMsg(null)
  }

  function updateMember(key, patch) {
    setHousehold(h => h.map(m => m.key === key ? { ...m, ...patch } : m))
  }

  function removeMember(key) {
    setHousehold(h => h.filter(m => m.key !== key))
  }

  async function connectSimplefin(e) {
    e.preventDefault()
    if (!simplefinToken.trim()) return
    setSimplefinSaving(true); setSimplefinMsg(null)
    try {
      const r = await fetch(`${API}/simplefin/setup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: simplefinToken.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Setup failed')
      setSimplefinMsg('Connected — trigger a sync from the Dashboard')
      setHasSimplefin(true)
      setSimplefinToken('')
    } catch (e) { setSimplefinMsg('!' + e.message) }
    finally { setSimplefinSaving(false) }
  }

  async function saveXferPhrases() {
    setXferPhrasesSaving(true); setXferPhrasesMsg(null)
    try {
      const cleaned = xferPhrases.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).join(', ')
      const r = await fetch(`${API}/settings/transfer_detection_phrases`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: cleaned }),
      })
      if (!r.ok) throw new Error('Save failed')
      setXferPhrases(cleaned)
      setXferPhrasesMsg('Saved — applies to newly synced transactions')
    } catch (e) { setXferPhrasesMsg('!' + e.message) }
    finally { setXferPhrasesSaving(false) }
  }

  async function resetSimplefin() {
    setSimplefinSaving(true)
    try {
      await fetch(`${API}/simplefin/reset`, { method: 'POST' })
      setHasSimplefin(false)
      setShowResetConfirm(false)
      setSimplefinMsg('SimpleFin disconnected — paste a new setup token to reconnect')
    } catch (e) { setSimplefinMsg('!' + e.message) }
    finally { setSimplefinSaving(false) }
  }

  async function saveAiModel() {
    setAiModelSaving(true); setAiModelMsg(null)
    try {
      await fetch(`${API}/settings/ai_default_model`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: aiModel }),
      })
      setAiModelMsg('Saved')
    } catch (e) { setAiModelMsg('!' + e.message) }
    finally { setAiModelSaving(false) }
  }

  async function testAiConnection() {
    setAiTesting(true); setAiTestResponse(null)
    try {
      const r = await fetch(`${API}/ai/test`, { method: 'POST' })
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Test failed') }
      const d = await r.json()
      setAiTestResponse(d.response || '(empty response)')
    } catch (e) { setAiTestResponse(`Error: ${e.message}`) }
    finally { setAiTesting(false) }
  }

  async function saveAiAutoRun() {
    setAiAutoRunSaving(true); setAiAutoRunMsg(null)
    try {
      await Promise.all([
        fetch(`${API}/settings/ai_autorun`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: String(aiAutoRun) }) }),
        fetch(`${API}/settings/ai_autorun_prompt`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: aiAutoRunPrompt }) }),
      ])
      setAiAutoRunMsg('Saved')
    } catch (e) { setAiAutoRunMsg('!' + e.message) }
    finally { setAiAutoRunSaving(false) }
  }

  async function saveAiSystemPrompt() {
    setAiPromptSaving(true); setAiPromptMsg(null)
    try {
      await fetch(`${API}/settings/ai_system_prompt`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: aiSystemPrompt }),
      })
      setAiPromptMsg('Saved')
    } catch (e) { setAiPromptMsg('!' + e.message) }
    finally { setAiPromptSaving(false) }
  }

  async function saveAiParams() {
    setAiParamsSaving(true); setAiParamsMsg(null)
    try {
      await fetch(`${API}/settings/ai_temperature`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: aiTemperature }) })
      setAiParamsMsg('Saved')
    } catch (e) { setAiParamsMsg('!' + e.message) }
    finally { setAiParamsSaving(false) }
  }

  function toggleCtxSection(key) {
    setCtxSections(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(LS_CTX_KEY, JSON.stringify(next))
      return next
    })
  }

  async function loadContextPreview() {
    setContextLoading(true)
    try {
      const r = await fetch(`${API}/ai/context`)
      setContextData(await r.json())
    } catch {}
    finally { setContextLoading(false) }
  }

  // ── Hub view ────────────────────────────────────────────────────────────
  if (view === null) {
    return (
      <div className="page-enter" style={{ padding: '32px 36px 80px' }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.05em', marginBottom: 8 }}>Settings</h1>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 28 }}>
          App setup lives here. Day-to-day controls are on the pages that use them — account roles and
          CSV import on Accounts, category rules on Spending, AI memory on the Assistant tab, the
          safe-spend buffer on the Dashboard.
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 14,
        }}>
          {SETTINGS_PAGES.map(p => (
            <div key={p.id} className="apple-card" onClick={() => setView(p.id)}
              style={{ padding: '22px 24px', cursor: 'pointer', transition: 'transform 0.12s ease' }}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'none'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{
                  fontSize: 17, width: 34, height: 34, borderRadius: 9,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-subtle)', color: 'var(--accent-text)', flexShrink: 0,
                }}>{p.icon}</span>
                <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em' }}>{p.title}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', fontSize: 14 }}>›</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{p.desc}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Sub-pages ───────────────────────────────────────────────────────────
  return (
    <div className="page-enter" style={{ padding: '32px 36px 80px' }}>
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => setView(null)} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          fontSize: 13, color: 'var(--blue)', fontFamily: 'inherit',
        }}>
          ‹ Settings
        </button>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.05em', marginTop: 6 }}>
          {SETTINGS_PAGES.find(p => p.id === view)?.title}
        </h1>
      </div>

      {view === 'connections' && (
        <>
        <Section title="SimpleFin Connection">
          {hasSimplefin ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 13, color: 'var(--accent-text)', fontWeight: 500 }}>✓ Connected</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Bank accounts syncing via SimpleFin</span>
                <a href="https://beta-bridge.simplefin.org/auth/login" target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none', marginLeft: 4 }}
                  onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                  onMouseLeave={e => e.target.style.textDecoration = 'none'}
                >Open SimpleFin ↗</a>
              </div>
              {!showResetConfirm ? (
                <button className="apple-btn-secondary" onClick={() => setShowResetConfirm(true)} style={{ fontSize: 13 }}>
                  Disconnect & reconnect with new token
                </button>
              ) : (
                <div style={{ padding: '14px 16px', background: 'rgba(255,59,48,0.06)', borderRadius: 10, border: '1px solid rgba(255,59,48,0.15)' }}>
                  <div style={{ fontSize: 13, marginBottom: 12 }}>This will disconnect your bank accounts. You'll need a new SimpleFin setup token to reconnect.</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="apple-btn-danger" onClick={resetSimplefin} disabled={simplefinSaving} style={{ fontSize: 13 }}>{simplefinSaving ? 'Disconnecting…' : 'Yes, disconnect'}</button>
                    <button className="apple-btn-secondary" onClick={() => setShowResetConfirm(false)} style={{ fontSize: 13 }}>Cancel</button>
                  </div>
                </div>
              )}
              {simplefinMsg && <StatusMsg msg={simplefinMsg} />}
            </div>
          ) : (
            <form onSubmit={connectSimplefin}>
              <Field label="Setup Token" hint={<>Get a new token at{' '}<a href="https://beta-bridge.simplefin.org/auth/login" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', textDecoration: 'none' }} onMouseEnter={e => e.target.style.textDecoration='underline'} onMouseLeave={e => e.target.style.textDecoration='none'}>beta-bridge.simplefin.org ↗</a>{' '}→ Setup Token</>}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input className="apple-input" placeholder="Paste SimpleFin setup token" value={simplefinToken}
                    onChange={e => setSimplefinToken(e.target.value)} style={{ flex: 1 }} />
                  <button className="apple-btn-primary" type="submit" disabled={simplefinSaving || !simplefinToken.trim()} style={{ flexShrink: 0 }}>
                    {simplefinSaving ? 'Connecting…' : 'Connect'}
                  </button>
                </div>
              </Field>
              <StatusMsg msg={simplefinMsg} />
            </form>
          )}
        </Section>
        <Section title="Internal Transfer Detection">
          <Field label="Transfer Phrases" hint="Comma-separated text that marks a synced transaction as an internal transfer (excluded from spending reports). Bank-specific — if you switch banks, add that bank's transfer wording here. Leave blank to use the built-in USAA defaults.">
            <textarea className="apple-input" rows={2} value={xferPhrases}
              onChange={e => setXferPhrases(e.target.value)}
              placeholder="usaa funds transfer, funds transfer db, funds transfer cr, interest charged, cash advance interest, fid bkg svc"
              style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} />
          </Field>
          <button className="apple-btn-primary" onClick={saveXferPhrases} disabled={xferPhrasesSaving} style={{ fontSize: 13 }}>
            {xferPhrasesSaving ? 'Saving…' : 'Save'}
          </button>
          <StatusMsg msg={xferPhrasesMsg} />
        </Section>
        </>
      )}

      {view === 'ai' && (
        <Section title="AI Assistant">
          {/* Connection status row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            {aiStatus === null && <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Checking connection…</span>}
            {aiStatus === 'ok' && <span style={{ fontSize: 13, color: 'var(--accent-text)', fontWeight: 500 }}>✓ Connected</span>}
            {aiStatus === 'error' && <span style={{ fontSize: 13, color: 'var(--red)', fontWeight: 500 }}>✕ Unreachable</span>}
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>10.0.0.24 gateway</span>
            <button className="apple-btn-secondary" onClick={testAiConnection} disabled={aiTesting}
              style={{ fontSize: 12, marginLeft: 'auto' }}>
              {aiTesting ? 'Testing…' : 'Test Connection'}
            </button>
          </div>
          {aiTestResponse && (
            <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, fontSize: 13,
              background: 'var(--bg-subtle)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {aiTestResponse}
            </div>
          )}

          {/* Model */}
          <Field label="Default Model" hint="Used by the Assistant tab and AI category suggestions.">
            <div style={{ display: 'flex', gap: 10 }}>
              <select className="apple-select" value={aiModel} onChange={e => setAiModel(e.target.value)} style={{ flex: 1 }}>
                {aiModels.length === 0 && <option value={aiModel}>{aiModel || 'Loading models…'}</option>}
                {aiModels.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
              <button className="apple-btn-primary" onClick={saveAiModel} disabled={aiModelSaving || !aiModel} style={{ flexShrink: 0 }}>
                {aiModelSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </Field>
          <StatusMsg msg={aiModelMsg} />

          {/* Inference parameters */}
          <div style={{ marginTop: 16 }}>
            <div className="apple-label" style={{ marginBottom: 6 }}>Temperature: {aiTemperature}</div>
            <input type="range" min={0} max={1} step={0.05} value={aiTemperature}
              onChange={e => setAiTemperature(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }} />
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
              Lower = more focused · Higher = more creative
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="apple-btn-primary" onClick={saveAiParams} disabled={aiParamsSaving} style={{ fontSize: 13 }}>
              {aiParamsSaving ? 'Saving…' : 'Save Parameters'}
            </button>
            <StatusMsg msg={aiParamsMsg} />
          </div>

          {/* Persona presets + System prompt */}
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Personality</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {Object.entries(PERSONA_PRESETS).map(([key, val]) => (
                <button key={key} className="apple-btn-secondary"
                  onClick={() => setAiSystemPrompt(val)}
                  style={{ fontSize: 12, textTransform: 'capitalize', background: aiSystemPrompt === val ? 'var(--accent)' : undefined, color: aiSystemPrompt === val ? '#fff' : undefined }}>
                  {key}
                </button>
              ))}
            </div>
            <Field label="System Prompt" hint="Instructions sent to the AI before every conversation. Persona buttons above overwrite this.">
              <textarea className="apple-input" value={aiSystemPrompt} onChange={e => setAiSystemPrompt(e.target.value)}
                rows={4} style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} />
            </Field>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="apple-btn-primary" onClick={saveAiSystemPrompt} disabled={aiPromptSaving} style={{ fontSize: 13 }}>
                {aiPromptSaving ? 'Saving…' : 'Save Prompt'}
              </button>
              <button className="apple-btn-secondary" onClick={() => setAiSystemPrompt(DEFAULT_SYSTEM_PROMPT)} style={{ fontSize: 13 }}>
                Reset to Default
              </button>
            </div>
            <StatusMsg msg={aiPromptMsg} />
          </div>

          {/* Auto-run */}
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <input type="checkbox" checked={aiAutoRun} onChange={e => setAiAutoRun(e.target.checked)}
                style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} id="autorun-toggle" />
              <label htmlFor="autorun-toggle" style={{ fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Auto-run on open
              </label>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
              Fires this prompt automatically when you open the Assistant tab with an empty conversation.
            </div>
            <Field label="Auto-run Prompt">
              <input className="apple-input" value={aiAutoRunPrompt} onChange={e => setAiAutoRunPrompt(e.target.value)}
                placeholder="Give me a quick briefing on my finances today." />
            </Field>
            <button className="apple-btn-primary" onClick={saveAiAutoRun} disabled={aiAutoRunSaving} style={{ fontSize: 13 }}>
              {aiAutoRunSaving ? 'Saving…' : 'Save'}
            </button>
            <StatusMsg msg={aiAutoRunMsg} />
          </div>

          {/* Saved prompts */}
          {savedPrompts.length > 0 && (
            <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Saved Prompts</div>
              {savedPrompts.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{p}</span>
                  <button onClick={() => {
                    const next = savedPrompts.filter((_, j) => j !== i)
                    localStorage.setItem(LS_SAVED_PROMPTS, JSON.stringify(next))
                    setSavedPrompts(next)
                  }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '2px 8px', color: 'var(--red)', fontFamily: 'inherit' }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Context sections */}
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Context Data</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Choose which data sections are included in every AI conversation
                </div>
              </div>
              <button className="apple-btn-secondary"
                onClick={() => { setShowContext(s => !s); if (!contextData) loadContextPreview() }}
                style={{ fontSize: 12 }}>
                {showContext ? 'Hide Preview' : 'Preview Data'}
              </button>
            </div>

            {CONTEXT_SECTIONS.map(s => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <input type="checkbox" checked={!!ctxSections[s.key]} onChange={() => toggleCtxSection(s.key)}
                  style={{ marginTop: 2, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.desc}</div>
                </div>
              </div>
            ))}

            {showContext && (
              <div style={{ marginTop: 16 }}>
                {contextLoading && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading context…</div>}
                {contextData && (
                  <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--bg-subtle)',
                    border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: 320, overflowY: 'auto',
                    color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {(() => {
                      const filtered = {}
                      if (ctxSections.balances) filtered.balances = contextData.balances
                      if (ctxSections.transactions) filtered.transactions = contextData.transactions
                      if (ctxSections.bills) filtered.bills = contextData.bills
                      if (ctxSections.debt) filtered.debt = contextData.debt
                      filtered.generated_at = contextData.generated_at
                      return JSON.stringify(filtered, null, 2)
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        </Section>
      )}

      {view === 'household' && (
        <Section title="Household Members">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            Who earns income in this household, and when. The sync attributes a deposit by payroll
            keywords first, then by comparing it to that person's recent actual paychecks already in
            the database. The typical pay range is only a fallback for a new member with no paycheck
            history yet. Pay schedules project upcoming income on the Dashboard and Calendar — a
            paycheck landing a day early or late for a bank holiday doesn't shift the schedule.
          </div>
          {household.map((m, i) => {
            const pd = payday[m.key] || { dow: '3', frequency: m.default_frequency || 'biweekly' }
            return (
              <div key={m.key} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < household.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
                  <Field label="Name" hint={null}>
                    <input className="apple-input" value={m.label || ''} onChange={e => updateMember(m.key, { label: e.target.value })} style={{ width: 140 }} />
                  </Field>
                  <Field label="Payday" hint={null}>
                    <select className="apple-select" value={pd.dow}
                      onChange={e => setPayday(p => ({ ...p, [m.key]: { ...pd, dow: e.target.value } }))}>
                      <option value="0">Monday</option>
                      <option value="1">Tuesday</option>
                      <option value="2">Wednesday</option>
                      <option value="3">Thursday</option>
                      <option value="4">Friday</option>
                      <option value="5">Saturday</option>
                      <option value="6">Sunday</option>
                    </select>
                  </Field>
                  <Field label="Frequency" hint={null}>
                    <select className="apple-select" value={pd.frequency}
                      onChange={e => setPayday(p => ({ ...p, [m.key]: { ...pd, frequency: e.target.value } }))}>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Every 2 weeks</option>
                    </select>
                  </Field>
                  {household.length > 1 && (
                    <button className="apple-btn-secondary" onClick={() => removeMember(m.key)}
                      style={{ fontSize: 12, color: 'var(--red)', flexShrink: 0 }}>
                      Remove
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
                  <Field label="Typical Pay Min" hint={null}>
                    <input className="apple-input" type="number" min="0" step="50" placeholder="—"
                      value={m.amount_min ?? ''} onChange={e => updateMember(m.key, { amount_min: e.target.value })} style={{ width: 120 }} />
                  </Field>
                  <Field label="Typical Pay Max" hint={null}>
                    <input className="apple-input" type="number" min="0" step="50" placeholder="—"
                      value={m.amount_max ?? ''} onChange={e => updateMember(m.key, { amount_max: e.target.value })} style={{ width: 120 }} />
                  </Field>
                </div>
                <Field label="Payroll Keywords" hint="Comma-separated text found in this person's paycheck deposits (e.g. employer name as it appears in the bank description).">
                  <input className="apple-input" value={m._kwText ?? ''} onChange={e => updateMember(m.key, { _kwText: e.target.value })} />
                </Field>
              </div>
            )
          })}
          <div style={{ display: 'flex', gap: 10, marginTop: 4, marginBottom: 12 }}>
            <input className="apple-input" placeholder="Add member by name…" value={newMemberName}
              onChange={e => setNewMemberName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addMember() }} style={{ width: 220 }} />
            <button className="apple-btn-secondary" onClick={addMember} disabled={!newMemberName.trim()} style={{ flexShrink: 0 }}>
              Add Member
            </button>
          </div>
          <div style={{ paddingTop: 14, marginBottom: 14, borderTop: '1px solid var(--border)' }}>
            <Field label="Paycheck Detection Minimum" hint="Deposits below this amount are never treated as paychecks. Lower it if someone has a small side income the app should count.">
              <div style={{ position: 'relative', width: 140 }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: 14, pointerEvents: 'none' }}>$</span>
                <input className="apple-input" type="number" min="0" step="50" value={paycheckMin}
                  onChange={e => setPaycheckMin(e.target.value)} style={{ paddingLeft: 24, width: '100%' }} />
              </div>
            </Field>
          </div>
          <button className="apple-btn-primary" onClick={saveHousehold} disabled={householdSaving}>
            {householdSaving ? 'Saving…' : 'Save Household'}
          </button>
          <StatusMsg msg={householdMsg} />
        </Section>
      )}

      {view === 'security' && (
        <Section title="Change Password">
          <form onSubmit={changePassword}>
            <Field label="Current Password">
              <input className="apple-input" type="password" autoComplete="current-password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} />
            </Field>
            <Field label="New Password">
              <input className="apple-input" type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} />
            </Field>
            <Field label="Confirm New Password">
              <input className="apple-input" type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
            </Field>
            <button className="apple-btn-primary" type="submit" disabled={pwSaving}>{pwSaving ? 'Saving…' : 'Change Password'}</button>
            <StatusMsg msg={pwMsg} />
          </form>
        </Section>
      )}
    </div>
  )
}
