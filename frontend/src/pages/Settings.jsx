import { useState, useEffect } from 'react'

const API = '/hearth/api'

function Section({ title, children }) {
  return (
    <div className="apple-card" style={{ padding: '24px 28px', marginBottom: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, letterSpacing: '-0.02em' }}>{title}</div>
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

export default function Settings({ active }) {
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState(null)
  const [pwSaving, setPwSaving] = useState(false)

  const [threshold, setThreshold] = useState('')
  const [threshMsg, setThreshMsg] = useState(null)
  const [threshSaving, setThreshSaving] = useState(false)

  const [payday, setPayday] = useState({})
  const [paydayMsg, setPaydayMsg] = useState({})
  const [paydaySaving, setPaydaySaving] = useState({})

  // Household members drive paycheck detection and attribution. Kept in settings
  // (household_members) so names/employers/pay ranges are data, not code.
  const [household, setHousehold] = useState([])
  const [householdMsg, setHouseholdMsg] = useState(null)
  const [householdSaving, setHouseholdSaving] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')

  const [roles, setRoles] = useState({ bills: '', food: '' })
  const [rolesMsg, setRolesMsg] = useState(null)
  const [rolesSaving, setRolesSaving] = useState(false)

  const [safeBuffer, setSafeBuffer] = useState('')
  const [bufferMsg, setBufferMsg] = useState(null)
  const [bufferSaving, setBufferSaving] = useState(false)

const [simplefinToken, setSimplefinToken] = useState('')
  const [simplefinMsg, setSimplefinMsg] = useState(null)
  const [simplefinSaving, setSimplefinSaving] = useState(false)
  const [hasSimplefin, setHasSimplefin] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const [merchantRules, setMerchantRules] = useState([])

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

  const [memoryFacts, setMemoryFacts] = useState([])
  const [memorySessions, setMemorySessions] = useState([])
  const [memoryTotal, setMemoryTotal] = useState(0)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [editingFact, setEditingFact] = useState(null)
  const [expandedSession, setExpandedSession] = useState(null)
  const [sessionTranscript, setSessionTranscript] = useState(null)
  const [clearConfirm, setClearConfirm] = useState(null)

  const [csvAccounts, setCsvAccounts] = useState([])
  const [csvAccountId, setCsvAccountId] = useState('')
  const [csvFile, setCsvFile] = useState(null)
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvResult, setCsvResult] = useState(null)
  const [csvError, setCsvError] = useState(null)

  useEffect(() => {
    if (!active) return
    fetch(`${API}/settings`)
      .then(r => r.json())
      .then(d => {
        if (d.low_balance_threshold) setThreshold(d.low_balance_threshold)
        if (d.safe_spend_buffer) setSafeBuffer(d.safe_spend_buffer)
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
        setRoles({ bills: d.bills_account_id || '', food: d.food_account_id || '' })
        if (d.ai_default_model) setAiModel(d.ai_default_model)
        if (d.ai_system_prompt) setAiSystemPrompt(d.ai_system_prompt)
        if (d.ai_temperature) setAiTemperature(parseFloat(d.ai_temperature))
        if (d.ai_autorun) setAiAutoRun(d.ai_autorun === 'true')
        if (d.ai_autorun_prompt) setAiAutoRunPrompt(d.ai_autorun_prompt)
        setHasSimplefin(d.has_simplefin === 'True' || d.has_simplefin === true)
      }).catch(() => {})
    loadMemory()
    fetch(`${API}/merchant-rules`).then(r => r.json()).then(setMerchantRules).catch(() => {})
    fetch(`${API}/ai/health`)
      .then(r => r.json())
      .then(d => setAiStatus(d.ok ? 'ok' : 'error'))
      .catch(() => setAiStatus('error'))
    fetch(`${API}/ai/models`)
      .then(r => r.json())
      .then(d => setAiModels(d.models || []))
      .catch(() => {})
    fetch(`${API}/accounts`)
      .then(r => r.json())
      .then(setCsvAccounts)
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

  async function saveThreshold(e) {
    e.preventDefault()
    const val = parseFloat(threshold)
    if (isNaN(val) || val < 0) { setThreshMsg('!Enter a valid amount'); return }
    setThreshSaving(true)
    try {
      await fetch(`${API}/settings/low_balance_threshold`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: val }) })
      setThreshMsg('Saved')
    } catch (e) { setThreshMsg('!' + e.message) }
    finally { setThreshSaving(false) }
  }

  async function saveBuffer(e) {
    e.preventDefault()
    const val = parseFloat(safeBuffer)
    if (isNaN(val) || val < 0) { setBufferMsg('!Enter a valid amount'); return }
    setBufferSaving(true)
    try {
      await fetch(`${API}/settings/safe_spend_buffer`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: val }) })
      setBufferMsg('Saved')
    } catch (e) { setBufferMsg('!' + e.message) }
    finally { setBufferSaving(false) }
  }

  async function savePayday(person) {
    setPaydaySaving(p => ({ ...p, [person]: true }))
    setPaydayMsg(p => ({ ...p, [person]: null }))
    try {
      const { dow, frequency } = payday[person]
      await fetch(`${API}/settings/payday_dow_${person}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: dow }) })
      await fetch(`${API}/settings/payday_frequency_${person}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: frequency }) })
      setPaydayMsg(p => ({ ...p, [person]: 'Saved' }))
    } catch (e) { setPaydayMsg(p => ({ ...p, [person]: '!' + e.message })) }
    finally { setPaydaySaving(p => ({ ...p, [person]: false })) }
  }

  async function saveHousehold() {
    setHouseholdSaving(true); setHouseholdMsg(null)
    try {
      const cleaned = household.map(m => {
        const { _kwText, ...rest } = m
        return {
          ...rest,
          label: (m.label || '').trim(),
          payroll_keywords: (_kwText ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
          amount_min: m.amount_min === '' || m.amount_min == null ? null : parseFloat(m.amount_min),
          amount_max: m.amount_max === '' || m.amount_max == null ? null : parseFloat(m.amount_max),
        }
      })
      if (cleaned.length === 0) throw new Error('At least one household member is required')
      if (cleaned.some(m => !m.label)) throw new Error('Every member needs a name')
      const r = await fetch(`${API}/settings/household_members`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(cleaned) }),
      })
      if (!r.ok) throw new Error('Save failed')
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

  async function saveRoles() {
    setRolesSaving(true); setRolesMsg(null)
    try {
      await Promise.all([
        fetch(`${API}/settings/bills_account_id`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: roles.bills }) }),
        fetch(`${API}/settings/food_account_id`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: roles.food }) }),
      ])
      setRolesMsg('Saved')
    } catch (e) { setRolesMsg('!' + e.message) }
    finally { setRolesSaving(false) }
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

  async function deleteRule(id) {
    try {
      await fetch(`${API}/merchant-rules/${id}`, { method: 'DELETE' })
      setMerchantRules(r => r.filter(x => x.id !== id))
    } catch {}
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

  async function loadMemory() {
    setMemoryLoading(true)
    try {
      const [memR, sessR] = await Promise.all([
        fetch(`${API}/ai/memory`).then(r => r.json()),
        fetch(`${API}/ai/memory/sessions?limit=20`).then(r => r.json()),
      ])
      setMemoryFacts(memR.facts || [])
      setMemorySessions(sessR.sessions || [])
      setMemoryTotal(sessR.total || 0)
    } catch {}
    finally { setMemoryLoading(false) }
  }

  async function deleteFact(id) {
    await fetch(`${API}/ai/memory/facts/${id}`, { method: 'DELETE' })
    setMemoryFacts(prev => prev.filter(f => f.id !== id))
  }

  async function saveEditedFact(id, fact, category) {
    await fetch(`${API}/ai/memory/facts/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fact, category }),
    })
    setMemoryFacts(prev => prev.map(f => f.id === id ? { ...f, fact, category } : f))
    setEditingFact(null)
  }

  async function clearMemory(type) {
    if (type === 'facts') await fetch(`${API}/ai/memory/facts`, { method: 'DELETE' })
    if (type === 'sessions') await fetch(`${API}/ai/memory/sessions`, { method: 'DELETE' })
    if (type === 'all') {
      await Promise.all([
        fetch(`${API}/ai/memory/facts`, { method: 'DELETE' }),
        fetch(`${API}/ai/memory/sessions`, { method: 'DELETE' }),
      ])
    }
    setClearConfirm(null)
    loadMemory()
  }

  async function loadTranscript(id) {
    if (expandedSession === id) { setExpandedSession(null); setSessionTranscript(null); return }
    setExpandedSession(id)
    try {
      const d = await fetch(`${API}/ai/memory/sessions/${id}/transcript`).then(r => r.json())
      setSessionTranscript(d.transcript || [])
    } catch { setSessionTranscript([]) }
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

  async function importCsv() {
    if (!csvAccountId || !csvFile) return
    setCsvImporting(true); setCsvResult(null); setCsvError(null)
    const form = new FormData()
    form.append('file', csvFile)
    try {
      const r = await fetch(`${API}/import/csv?account_id=${csvAccountId}`, { method: 'POST', body: form })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Import failed')
      setCsvResult(d)
    } catch (e) { setCsvError(e.message) }
    finally { setCsvImporting(false) }
  }

  const money = v => v == null ? '—' : `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div className="page-enter" style={{ padding: '32px 36px 80px' }}>
      <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.05em', marginBottom: 32 }}>Settings</h1>

      {/* SimpleFin */}
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
        {simplefinMsg && hasSimplefin && <StatusMsg msg={simplefinMsg} />}
      </Section>

      {/* AI Assistant */}
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
        <Field label="Default Model" hint="Used by the Assistant tab and AI bill detection.">
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

      {/* AI Memory */}
      <Section title="AI Memory">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {memoryFacts.length} fact{memoryFacts.length !== 1 ? 's' : ''} · {memoryTotal} session{memoryTotal !== 1 ? 's' : ''} stored
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="apple-btn-secondary" onClick={loadMemory} disabled={memoryLoading} style={{ fontSize: 12 }}>
              {memoryLoading ? 'Loading…' : 'Refresh'}
            </button>
            <button className="apple-btn-secondary" onClick={() => setClearConfirm('all')} style={{ fontSize: 12, color: 'var(--red)' }}>
              Clear All
            </button>
          </div>
        </div>

        {clearConfirm && (
          <div style={{ padding: '12px 16px', background: 'rgba(255,59,48,0.06)', border: '1px solid rgba(255,59,48,0.2)', borderRadius: 10, marginBottom: 16 }}>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              {clearConfirm === 'all' ? 'Delete all facts and conversation history?' : clearConfirm === 'facts' ? 'Delete all stored facts?' : 'Delete all conversation history?'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="apple-btn-danger" onClick={() => clearMemory(clearConfirm)} style={{ fontSize: 12 }}>Yes, delete</button>
              <button className="apple-btn-secondary" onClick={() => setClearConfirm(null)} style={{ fontSize: 12 }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Household Profile / Facts */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Household Profile</div>
            <button className="apple-btn-secondary" onClick={() => setClearConfirm('facts')} style={{ fontSize: 11, color: 'var(--red)' }}>Clear Facts</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Facts the AI has learned from your conversations. These are injected into every session.
          </div>
          {memoryFacts.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              No facts yet — they build up as you chat with the Assistant.
            </div>
          )}
          {memoryFacts.map(f => (
            <div key={f.id}>
              {editingFact?.id === f.id ? (
                <div style={{ padding: '8px 0' }}>
                  <input className="apple-input" value={editingFact.fact} onChange={e => setEditingFact(p => ({ ...p, fact: e.target.value }))} style={{ marginBottom: 6 }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select className="apple-select" value={editingFact.category} onChange={e => setEditingFact(p => ({ ...p, category: e.target.value }))} style={{ fontSize: 12 }}>
                      {['general','goal','preference','person','account'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button className="apple-btn-primary" onClick={() => saveEditedFact(f.id, editingFact.fact, editingFact.category)} style={{ fontSize: 12 }}>Save</button>
                    <button className="apple-btn-secondary" onClick={() => setEditingFact(null)} style={{ fontSize: 12 }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{f.fact}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}>{f.category}</span>
                  </div>
                  <button onClick={() => setEditingFact({ id: f.id, fact: f.fact, category: f.category })} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '2px 8px', color: 'var(--text-secondary)', fontFamily: 'inherit' }}>Edit</button>
                  <button onClick={() => deleteFact(f.id)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '2px 8px', color: 'var(--red)', fontFamily: 'inherit' }}>✕</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Session history */}
        <div style={{ paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Conversation History</div>
            <button className="apple-btn-secondary" onClick={() => setClearConfirm('sessions')} style={{ fontSize: 11, color: 'var(--red)' }}>Clear History</button>
          </div>
          {memorySessions.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              No sessions yet — conversations are saved when you clear the chat.
            </div>
          )}
          {memorySessions.map(s => (
            <div key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', cursor: 'pointer' }}
                onClick={() => loadTranscript(s.id)}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 3 }}>
                    {s.ended_at?.slice(0, 16).replace('T', ' ')} · {s.message_count} messages
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {s.summary || <span style={{ fontStyle: 'italic', color: 'var(--text-tertiary)' }}>No summary</span>}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }}>
                  {expandedSession === s.id ? '▲' : '▼'}
                </span>
              </div>
              {expandedSession === s.id && sessionTranscript && (
                <div style={{ padding: '0 0 12px 0' }}>
                  {sessionTranscript.map((m, i) => (
                    <div key={i} style={{ marginBottom: 8, padding: '8px 12px', background: m.role === 'user' ? 'rgba(var(--accent-rgb,0,122,255),0.08)' : 'var(--bg-subtle)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 3, textTransform: 'uppercase', fontWeight: 600 }}>{m.role}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {memoryTotal > 20 && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 10 }}>
              Showing 20 of {memoryTotal} sessions
            </div>
          )}
        </div>
      </Section>

      {/* Dashboard settings */}
      <Section title="Dashboard">
        <form onSubmit={saveThreshold}>
          <Field label="Low Balance Warning" hint="A warning banner appears when projected spendable drops below this amount.">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: 14, pointerEvents: 'none' }}>$</span>
                <input className="apple-input" type="number" min="0" step="50" value={threshold} onChange={e => setThreshold(e.target.value)} style={{ paddingLeft: 24 }} />
              </div>
              <button className="apple-btn-primary" type="submit" disabled={threshSaving} style={{ flexShrink: 0 }}>{threshSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </Field>
          <StatusMsg msg={threshMsg} />
        </form>
        <form onSubmit={saveBuffer} style={{ marginTop: 16 }}>
          <Field label="Safe to Spend Buffer" hint="Amount kept in reserve when calculating your safe-to-spend number.">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: 14, pointerEvents: 'none' }}>$</span>
                <input className="apple-input" type="number" min="0" step="50" value={safeBuffer} onChange={e => setSafeBuffer(e.target.value)} style={{ paddingLeft: 24 }} />
              </div>
              <button className="apple-btn-primary" type="submit" disabled={bufferSaving} style={{ flexShrink: 0 }}>{bufferSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </Field>
          <StatusMsg msg={bufferMsg} />
        </form>
      </Section>

      {/* Household members — drives paycheck detection and attribution */}
      <Section title="Household">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Who earns income in this household. The sync uses the payroll keywords (matched against bank
          transaction descriptions) and the typical pay range to figure out whose paycheck a deposit is.
        </div>
        {household.map((m, i) => (
          <div key={m.key} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < household.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
              <Field label="Name" hint={null}>
                <input className="apple-input" value={m.label || ''} onChange={e => updateMember(m.key, { label: e.target.value })} style={{ width: 140 }} />
              </Field>
              <Field label="Typical Pay Min" hint={null}>
                <input className="apple-input" type="number" min="0" step="50" placeholder="—"
                  value={m.amount_min ?? ''} onChange={e => updateMember(m.key, { amount_min: e.target.value })} style={{ width: 120 }} />
              </Field>
              <Field label="Typical Pay Max" hint={null}>
                <input className="apple-input" type="number" min="0" step="50" placeholder="—"
                  value={m.amount_max ?? ''} onChange={e => updateMember(m.key, { amount_max: e.target.value })} style={{ width: 120 }} />
              </Field>
              {household.length > 1 && (
                <button className="apple-btn-secondary" onClick={() => removeMember(m.key)}
                  style={{ fontSize: 12, color: 'var(--red)', flexShrink: 0 }}>
                  Remove
                </button>
              )}
            </div>
            <Field label="Payroll Keywords" hint="Comma-separated text found in this person's paycheck deposits (e.g. employer name as it appears in the bank description).">
              <input className="apple-input" value={m._kwText ?? ''} onChange={e => updateMember(m.key, { _kwText: e.target.value })} />
            </Field>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 4, marginBottom: 12 }}>
          <input className="apple-input" placeholder="Add member by name…" value={newMemberName}
            onChange={e => setNewMemberName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addMember() }} style={{ width: 220 }} />
          <button className="apple-btn-secondary" onClick={addMember} disabled={!newMemberName.trim()} style={{ flexShrink: 0 }}>
            Add Member
          </button>
        </div>
        <button className="apple-btn-primary" onClick={saveHousehold} disabled={householdSaving}>
          {householdSaving ? 'Saving…' : 'Save Household'}
        </button>
        <StatusMsg msg={householdMsg} />
      </Section>

      {/* Account roles — which account is the Bills / Food account */}
      <Section title="Account Roles">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          The Dashboard treats one account as the Bills account (where bills get paid from) and one as the
          Food account (day-to-day spending). Pick them explicitly here — "Auto" falls back to matching
          "bills" or "food" in the account name, which breaks silently if an account is renamed.
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Bills Account" hint={null}>
            <select className="apple-select" value={roles.bills} onChange={e => setRoles(r => ({ ...r, bills: e.target.value }))}>
              <option value="">Auto (match by name)</option>
              {csvAccounts.map(a => <option key={a.id} value={a.id}>{a.display_name || a.name}</option>)}
            </select>
          </Field>
          <Field label="Food Account" hint={null}>
            <select className="apple-select" value={roles.food} onChange={e => setRoles(r => ({ ...r, food: e.target.value }))}>
              <option value="">Auto (match by name)</option>
              {csvAccounts.map(a => <option key={a.id} value={a.id}>{a.display_name || a.name}</option>)}
            </select>
          </Field>
          <button className="apple-btn-primary" onClick={saveRoles} disabled={rolesSaving} style={{ flexShrink: 0 }}>
            {rolesSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <StatusMsg msg={rolesMsg} />
      </Section>

      <Section title="Paycheck Schedule">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          When each paycheck is expected — used to project upcoming income and check it lands in time to cover bills.
          A paycheck landing a day early or late (e.g. for a bank holiday) doesn't shift this schedule; it's just treated as that cycle's payment.
        </div>
        {household.map((m, i) => {
          const person = m.key
          const pd = payday[person] || { dow: '3', frequency: m.default_frequency || 'biweekly' }
          const isLast = i === household.length - 1
          return (
            <div key={person} style={{ marginBottom: isLast ? 0 : 20, paddingBottom: isLast ? 0 : 20, borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{m.label || person}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <Field label="Day of Week" hint={null}>
                  <select className="apple-select" value={pd.dow}
                    onChange={e => setPayday(p => ({ ...p, [person]: { ...pd, dow: e.target.value } }))}>
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
                    onChange={e => setPayday(p => ({ ...p, [person]: { ...pd, frequency: e.target.value } }))}>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 weeks</option>
                  </select>
                </Field>
                <button className="apple-btn-primary" onClick={() => savePayday(person)} disabled={paydaySaving[person]} style={{ flexShrink: 0 }}>
                  {paydaySaving[person] ? 'Saving…' : 'Save'}
                </button>
              </div>
              <StatusMsg msg={paydayMsg[person]} />
            </div>
          )
        })}
      </Section>

      {/* CSV Import */}
      <Section title="CSV Import">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Import historical transactions from a USAA or Chase CSV export. Duplicates are automatically skipped.
        </div>

        <Field label="Account">
          <select className="apple-select" value={csvAccountId}
            onChange={e => { setCsvAccountId(e.target.value); setCsvResult(null); setCsvError(null) }}
            style={{ width: '100%' }}>
            <option value="">— select account —</option>
            {csvAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>

        <Field label="CSV File" hint="USAA: Date, Description, Original Description, Category, Amount, Balance · Chase: Transaction Date, Post Date, Description, Category, Type, Amount, Memo">
          <input type="file" accept=".csv"
            onChange={e => { setCsvFile(e.target.files[0] || null); setCsvResult(null); setCsvError(null) }}
            style={{ fontSize: 13, color: 'var(--text-primary)', padding: '6px 0' }} />
        </Field>

        {csvError && (
          <div style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)',
            borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--red)', marginBottom: 16 }}>
            {csvError}
          </div>
        )}
        {csvResult && (
          <div style={{ background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.25)',
            borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--accent-text)', marginBottom: 16 }}>
            {csvResult.imported} transaction{csvResult.imported !== 1 ? 's' : ''} imported
            {', '}{csvResult.skipped} duplicate{csvResult.skipped !== 1 ? 's' : ''} skipped
            {csvResult.format && (
              <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>
                ({csvResult.format.toUpperCase()} format)
              </span>
            )}
            {csvResult.errors?.length > 0 && (
              <div style={{ marginTop: 8, color: 'var(--red)', fontSize: 12 }}>
                {csvResult.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            {csvResult.debug_skipped?.length > 0 && (
              <div style={{ marginTop: 8, color: 'var(--text-tertiary)', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                First skipped rows:{'\n'}{csvResult.debug_skipped.join('\n')}
              </div>
            )}
          </div>
        )}

        <button className="apple-btn-primary" onClick={importCsv}
          disabled={csvImporting || !csvAccountId || !csvFile} style={{ fontSize: 13 }}>
          {csvImporting ? 'Importing…' : 'Import CSV'}
        </button>
      </Section>

      {/* Merchant rules */}
      {merchantRules.length > 0 && (
        <Section title="Auto-Category Rules">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
            These rules are applied when new transactions are synced. Delete a rule to stop auto-categorizing that merchant.
          </div>
          {merchantRules.map(rule => (
            <div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{rule.pattern}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 10 }}>→ {rule.category}</span>
              </div>
              <button onClick={() => deleteRule(rule.id)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '2px 8px', color: 'var(--red)', fontFamily: 'inherit' }}>
                Remove
              </button>
            </div>
          ))}
        </Section>
      )}

      {/* Password */}
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
    </div>
  )
}
