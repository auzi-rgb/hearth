import { useState, useEffect, useRef, useCallback } from 'react'
import Portal from '../components/Portal'

const API = '/hearth/api'
const GATEWAY = 'https://10.0.0.24/gateway/api'

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful home finance assistant. You have access to the household financial data provided. Answer questions accurately and helpfully. Be concise. Format money as dollar amounts.'

const PERSONA_PRESETS = {
  strict: 'You are a strict home finance assistant. Be direct and blunt. Immediately flag any overspending, wasteful patterns, or budget violations. Do not soften bad news. Format money as dollar amounts.',
  coach: 'You are an encouraging home finance coach. Frame everything in terms of progress and wins. Acknowledge challenges warmly but keep the tone positive and motivating. Format money as dollar amounts.',
  analyst: 'You are a data-driven financial analyst. Be precise with numbers. Avoid conversational filler — just facts, figures, and clear analysis. Format money as dollar amounts.',
}

const LS_CTX_KEY = 'hearth_ai_context_sections'
const LS_SAVED_PROMPTS = 'hearth_ai_saved_prompts'

const DEFAULT_PROMPTS = [
  'How much have I spent on food this month compared to last month?',
  'Which bills are coming up before my next paycheck?',
  'Am I on track with my debt payoff goals?',
  "What's my spendable balance after upcoming bills?",
  'Give me a summary of my financial situation this month.',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseActionBlock(text) {
  const match = text.match(/```action\s*([\s\S]*?)```/)
  if (!match) return null
  try { return JSON.parse(match[1].trim()) } catch { return null }
}

function stripActionBlock(text) {
  return text.replace(/```action[\s\S]*?```/g, '').trim()
}

// ── Sub-components ────────────────────────────────────────────────────────────

function useElapsed(running) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!running) { setSecs(0); return }
    setSecs(0)
    const t = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [running])
  return secs
}

function ThinkingBubble({ hasContent, onStop }) {
  const secs = useElapsed(!hasContent)
  const mins = Math.floor(secs / 60)
  const ss = String(secs % 60).padStart(2, '0')
  const elapsed = mins > 0 ? `${mins}:${ss}` : `${secs}s`
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 14, alignItems: 'center', gap: 10 }}>
      <div style={{
        padding: '12px 16px', borderRadius: '18px 18px 18px 6px',
        background: 'var(--bg-card)', boxShadow: 'var(--shadow-card)',
        fontSize: 14, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ letterSpacing: 2 }}>●●●</span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{elapsed}</span>
      </div>
      <button onClick={onStop} style={{
        background: 'none', border: '1px solid var(--border)', borderRadius: 20,
        padding: '4px 12px', fontSize: 12, color: 'var(--text-secondary)',
        cursor: 'pointer', fontFamily: 'inherit',
      }}>Stop</button>
    </div>
  )
}

function Bubble({ role, content, streaming }) {
  const isUser = role === 'user'
  const display = content ? stripActionBlock(content) : ''
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
      <div style={{
        maxWidth: '78%', padding: '12px 16px',
        borderRadius: isUser ? '18px 18px 6px 18px' : '18px 18px 18px 6px',
        background: isUser ? 'var(--accent)' : 'var(--bg-card)',
        color: isUser ? '#fff' : 'var(--text-primary)',
        fontSize: 14, lineHeight: 1.6,
        boxShadow: isUser ? 'none' : 'var(--shadow-card)',
        whiteSpace: 'pre-wrap',
      }}>
        {display || (streaming ? <span style={{ opacity: 0.5 }}>●●●</span> : '')}
      </div>
    </div>
  )
}

function ActionCard({ action, onConfirm, onDismiss }) {
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)

  if (done) return null

  async function confirm() {
    setConfirming(true)
    await onConfirm(action)
    setDone(true)
  }

  const label = action.action === 'create_bill'
    ? `Add bill: ${action.name} · $${action.amount}/mo · due the ${action.due_day}${['th','st','nd','rd'][Math.min(action.due_day % 10, 3) * (action.due_day < 4 || action.due_day > 20 ? 1 : 0)] || 'th'}`
    : JSON.stringify(action)

  return (
    <div style={{
      margin: '0 0 14px 0', padding: '12px 16px',
      background: 'rgba(52,199,89,0.06)', border: '1px solid rgba(52,199,89,0.25)',
      borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span style={{ fontSize: 18 }}>✦</span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
      <button className="apple-btn-primary" onClick={confirm} disabled={confirming} style={{ fontSize: 12 }}>
        {confirming ? 'Adding…' : 'Confirm'}
      </button>
      <button className="apple-btn-secondary" onClick={() => { setDone(true); onDismiss() }} style={{ fontSize: 12 }}>
        Dismiss
      </button>
    </div>
  )
}

function SummaryCard({ summary, onDismiss }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(summary.prose + '\n\n' + (summary.bullets || []).map(b => '• ' + b).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div style={{ marginBottom: 16, padding: '16px 20px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Month Summary</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="apple-btn-secondary" onClick={copy} style={{ fontSize: 11 }}>{copied ? 'Copied!' : 'Copy'}</button>
          <button className="apple-btn-secondary" onClick={onDismiss} style={{ fontSize: 11 }}>✕</button>
        </div>
      </div>
      {summary.prose && <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)', margin: '0 0 10px 0' }}>{summary.prose}</p>}
      {summary.bullets && summary.bullets.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {summary.bullets.map((b, i) => (
            <li key={i} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', marginBottom: 2 }}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ScanCard({ issues, onDismiss }) {
  if (!issues || issues.length === 0) return (
    <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(52,199,89,0.06)', border: '1px solid rgba(52,199,89,0.25)', borderRadius: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--accent-text)' }}>✓ No issues found — your transactions look clean.</span>
        <button className="apple-btn-secondary" onClick={onDismiss} style={{ fontSize: 11 }}>✕</button>
      </div>
    </div>
  )
  return (
    <div style={{ marginBottom: 16, padding: '16px 20px', background: 'var(--bg-card)', border: '1px solid rgba(255,159,10,0.3)', borderRadius: 14, boxShadow: 'var(--shadow-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>⚠ {issues.length} issue{issues.length !== 1 ? 's' : ''} found</span>
        <button className="apple-btn-secondary" onClick={onDismiss} style={{ fontSize: 11 }}>✕</button>
      </div>
      {issues.map((issue, i) => (
        <div key={i} style={{ padding: '8px 0', borderBottom: i < issues.length - 1 ? '1px solid var(--border)' : 'none' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>{issue.description}</div>
          {issue.transactions && issue.transactions.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{issue.transactions.join(' · ')}</div>
          )}
        </div>
      ))}
    </div>
  )
}

function BudgetSuggestModal({ suggestions, onApply, onClose }) {
  const [selected, setSelected] = useState(() => Object.fromEntries(Object.keys(suggestions).map(k => [k, true])))
  const LS_PREFIX = 'hearth_budget_limit_'

  function toggle(k) { setSelected(p => ({ ...p, [k]: !p[k] })) }

  function apply() {
    Object.entries(selected).forEach(([cat, checked]) => {
      if (checked && suggestions[cat] != null) {
        localStorage.setItem(LS_PREFIX + cat, String(suggestions[cat]))
      }
    })
    onApply()
  }

  return (
    <Portal>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.08)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="apple-card" style={{ padding: '24px 28px', width: 420, maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Budget Suggestions</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Based on your last 3 months. Select which to apply.
        </div>
        {Object.entries(suggestions).map(([cat, amt]) => (
          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <input type="checkbox" checked={!!selected[cat]} onChange={() => toggle(cat)} style={{ accentColor: 'var(--accent)' }} />
            <span style={{ flex: 1, fontSize: 13, textTransform: 'capitalize' }}>{cat}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>${amt}/mo</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="apple-btn-primary" onClick={apply} style={{ flex: 1 }}>Apply Selected</button>
          <button className="apple-btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
    </Portal>
  )
}

// Memory lives here — on the page where conversations happen — not in Settings.
// Facts are injected into every session; sessions are saved when you clear a chat.
function MemoryPanel() {
  const [facts, setFacts] = useState([])
  const [sessions, setSessions] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [editingFact, setEditingFact] = useState(null)
  const [expandedSession, setExpandedSession] = useState(null)
  const [transcript, setTranscript] = useState(null)
  const [clearConfirm, setClearConfirm] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const [memR, sessR] = await Promise.all([
        fetch(`${API}/ai/memory`).then(r => r.json()),
        fetch(`${API}/ai/memory/sessions?limit=20`).then(r => r.json()),
      ])
      setFacts(memR.facts || [])
      setSessions(sessR.sessions || [])
      setTotal(sessR.total || 0)
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function deleteFact(id) {
    await fetch(`${API}/ai/memory/facts/${id}`, { method: 'DELETE' })
    setFacts(prev => prev.filter(f => f.id !== id))
  }

  async function saveEditedFact(id, fact, category) {
    await fetch(`${API}/ai/memory/facts/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fact, category }),
    })
    setFacts(prev => prev.map(f => f.id === id ? { ...f, fact, category } : f))
    setEditingFact(null)
  }

  async function clearMemory(type) {
    if (type === 'facts' || type === 'all') await fetch(`${API}/ai/memory/facts`, { method: 'DELETE' })
    if (type === 'sessions' || type === 'all') await fetch(`${API}/ai/memory/sessions`, { method: 'DELETE' })
    setClearConfirm(null)
    load()
  }

  async function loadTranscript(id) {
    if (expandedSession === id) { setExpandedSession(null); setTranscript(null); return }
    setExpandedSession(id)
    try {
      const d = await fetch(`${API}/ai/memory/sessions/${id}/transcript`).then(r => r.json())
      setTranscript(d.transcript || [])
    } catch { setTranscript([]) }
  }

  return (
    <div className="apple-card" style={{ padding: '16px 20px', marginBottom: 12, flexShrink: 0, maxHeight: 380, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {facts.length} fact{facts.length !== 1 ? 's' : ''} · {total} session{total !== 1 ? 's' : ''} stored
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="apple-btn-secondary" onClick={load} disabled={loading} style={{ fontSize: 12 }}>
            {loading ? 'Loading…' : 'Refresh'}
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

      {/* Facts */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Facts the assistant remembers</div>
          {facts.length > 0 && (
            <button className="apple-btn-secondary" onClick={() => setClearConfirm('facts')} style={{ fontSize: 11, color: 'var(--red)' }}>Clear Facts</button>
          )}
        </div>
        {facts.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
            No facts yet — they build up as you chat.
          </div>
        )}
        {facts.map(f => (
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
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
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
      <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Past conversations</div>
          {sessions.length > 0 && (
            <button className="apple-btn-secondary" onClick={() => setClearConfirm('sessions')} style={{ fontSize: 11, color: 'var(--red)' }}>Clear History</button>
          )}
        </div>
        {sessions.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
            No sessions yet — conversations are saved when you clear the chat.
          </div>
        )}
        {sessions.map(s => (
          <div key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', cursor: 'pointer' }}
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
            {expandedSession === s.id && transcript && (
              <div style={{ padding: '0 0 12px 0' }}>
                {transcript.map((m, i) => (
                  <div key={i} style={{ marginBottom: 8, padding: '8px 12px', background: m.role === 'user' ? 'rgba(var(--accent-rgb,0,122,255),0.08)' : 'var(--bg-subtle)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 3, textTransform: 'uppercase', fontWeight: 600 }}>{m.role}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {total > 20 && (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
            Showing 20 of {total} sessions
          </div>
        )}
      </div>
    </div>
  )
}

function SavePromptModal({ onSave, onClose }) {
  const [text, setText] = useState('')
  function save() {
    if (!text.trim()) return
    const existing = (() => { try { return JSON.parse(localStorage.getItem(LS_SAVED_PROMPTS)) || [] } catch { return [] } })()
    if (existing.length < 10) {
      localStorage.setItem(LS_SAVED_PROMPTS, JSON.stringify([...existing, text.trim()]))
    }
    onSave()
  }
  return (
    <Portal>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.08)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="apple-card" style={{ padding: '24px 28px', width: 380, maxWidth: '92vw' }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Save Prompt</div>
        <textarea className="apple-input" rows={3} value={text} onChange={e => setText(e.target.value)}
          placeholder="Enter a prompt to save…" style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', marginBottom: 14 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="apple-btn-primary" onClick={save} disabled={!text.trim()} style={{ flex: 1 }}>Save</button>
          <button className="apple-btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
    </Portal>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AI({ active }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [models, setModels] = useState([])
  const [model, setModel] = useState('mistral-nemo:latest')
  const [temperature, setTemperature] = useState(0.7)
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [showSettings, setShowSettings] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [sessionStartedAt] = useState(new Date().toISOString())
  const [pendingAction, setPendingAction] = useState(null)
  const [summaryCard, setSummaryCard] = useState(null)
  const [scanCard, setScanCard] = useState(null) // null=hidden, []/'loaded'=show
  const [budgetSuggestions, setBudgetSuggestions] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [savedPrompts, setSavedPrompts] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_SAVED_PROMPTS)) || [] } catch { return [] }
  })
  const [showSavePrompt, setShowSavePrompt] = useState(false)
  const [autoRunDone, setAutoRunDone] = useState(false)
  const [autoRunPrompt, setAutoRunPrompt] = useState('')
  const [autoRunEnabled, setAutoRunEnabled] = useState(false)
  const bottomRef = useRef(null)
  const abortRef = useRef(null)
  const sendingRef = useRef(false)

  // ── On activate: load settings + maybe auto-run ───────────────────────────
  useEffect(() => {
    if (!active) return
    fetch(`${GATEWAY}/models`).then(r => r.json()).then(d => {
      const list = d.models || []
      setModels(list)
      const nemo = list.find(m => m.name.includes('mistral-nemo') || m.name.includes('mistral'))
      if (nemo) setModel(nemo.name)
    }).catch(() => {})

    fetch(`${API}/settings`).then(r => r.json()).then(d => {
      if (d.ai_system_prompt) setSystemPrompt(d.ai_system_prompt)
      if (d.ai_temperature) setTemperature(parseFloat(d.ai_temperature))
      if (d.ai_default_model) setModel(d.ai_default_model)
      const enabled = d.ai_autorun === 'true'
      const prompt = d.ai_autorun_prompt || ''
      setAutoRunEnabled(enabled)
      setAutoRunPrompt(prompt)
      if (enabled && prompt && !autoRunDone) {
        setTimeout(() => { setAutoRunDone(true); sendMsg(prompt) }, 400)
      }
    }).catch(() => {})
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  // ── Save session on clear / unmount ──────────────────────────────────────
  const saveSession = useCallback(async (msgs) => {
    if (msgs.length < 2) return
    const conversationText = msgs.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
    const summaryPrompt = `Summarize this financial conversation in 2-3 sentences. Then list up to 8 discrete facts worth remembering long-term (goals, preferences, income details, recurring patterns). Return JSON only:
{"summary": "...", "facts": [{"fact": "...", "category": "goal|preference|person|account|general"}]}

Conversation:
${conversationText}`

    try {
      const r = await fetch(`${API}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: summaryPrompt }],
          stream: false,
          options: { temperature: 0.3 },
        }),
      })
      const d = await r.json()
      const raw = d.message?.content || d.response || ''
      let parsed = { summary: '', facts: [] }
      try {
        const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        parsed = JSON.parse(clean)
      } catch {}

      await fetch(`${API}/ai/memory/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          started_at: sessionStartedAt,
          ended_at: new Date().toISOString(),
          message_count: msgs.length,
          summary: parsed.summary || '',
          facts: parsed.facts || [],
          transcript: msgs,
        }),
      })
    } catch {}
  }, [model, sessionStartedAt])

  // ── Build full context for a message send ────────────────────────────────
  async function buildContext() {
    let sections = { balances: true, transactions: true, bills: true, debt: true, budget: true, paychecks: true }
    try { sections = { ...sections, ...JSON.parse(localStorage.getItem(LS_CTX_KEY)) } } catch {}

    const context = {}
    try {
      const full = await fetch(`${API}/ai/context`).then(r => r.json())
      if (sections.balances) context.balances = full.balances
      if (sections.transactions) {
        // Send compact transaction list — date, amount, description, category only
        context.recent_transactions = (full.transactions || []).map(t => ({
          date: t.transaction_date, amt: t.amount, desc: t.description, cat: t.category
        }))
      }
      if (sections.bills) context.bills = full.bills
      if (sections.debt) context.debt = full.debt
      context.as_of = full.generated_at
    } catch {}

    if (sections.budget) {
      try {
        const budgets = await fetch(`${API}/budgets`).then(r => r.json())
        const LS_PREFIX = 'hearth_budget_limit_'
        context.budget = budgets.map(b => {
          const limit = parseFloat(localStorage.getItem(LS_PREFIX + b.category)) || b.monthly_limit || null
          return { cat: b.category, limit, spent: b.spent, remaining: limit != null ? +(limit - b.spent).toFixed(2) : null }
        })
      } catch {}
    }

    if (sections.paychecks) {
      try {
        const { upcoming } = await fetch(`${API}/paychecks/upcoming`).then(r => r.json())
        context.upcoming_paychecks = upcoming
      } catch {}
    }

    return context
  }

  // ── Build system prompt with memory injection ────────────────────────────
  async function buildSystemPrompt() {
    let memory = { facts: [], recent_sessions: [] }
    try { memory = await fetch(`${API}/ai/memory`).then(r => r.json()) } catch {}

    let sys = systemPrompt

    if (memory.facts.length > 0) {
      const factLines = memory.facts.map(f => `- ${f.fact}`).join('\n')
      sys += `\n\n<household_profile>\n${factLines}\n</household_profile>`
    }

    if (memory.recent_sessions.length > 0) {
      const sessionLines = memory.recent_sessions
        .map(s => `[${s.ended_at?.slice(0, 10)}] ${s.summary}`)
        .join('\n')
      sys += `\n\n<recent_conversations>\n${sessionLines}\n</recent_conversations>`
    }

    return sys
  }

  // ── Core send ────────────────────────────────────────────────────────────
  async function sendMsg(text) {
    const msg = (text || input).trim()
    if (!msg || sendingRef.current) return
    sendingRef.current = true
    setInput('')
    setSending(true)
    setStreamingText('')

    const [context, sysBase] = await Promise.all([buildContext(), buildSystemPrompt()])
    const contextBlock = JSON.stringify(context, null, 2)
    const sysContent = `${sysBase}\n\n<financial_context>\n${contextBlock}\n</financial_context>\n\nWhen you want to create a bill based on the conversation, emit a fenced block:\n\`\`\`action\n{"action":"create_bill","name":"...","amount":0,"due_day":1,"category":"..."}\n\`\`\``

    const userMsg = { role: 'user', content: msg }
    const currentMessages = [...messages, userMsg]
    setMessages(currentMessages)

    const apiMessages = [
      { role: 'system', content: sysContent },
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: msg },
    ]

    abortRef.current = new AbortController()
    let full = ''

    try {
      const r = await fetch(`${API}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: apiMessages, stream: true, options: { temperature } }),
        signal: abortRef.current.signal,
      })

      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value).split('\n')) {
          if (!line.trim()) continue
          try { full += JSON.parse(line).message?.content || '' } catch {}
          setStreamingText(full)
        }
      }

      const action = parseActionBlock(full)
      if (action) setPendingAction(action)

      const assistantMsg = { role: 'assistant', content: full }
      setMessages(prev => [...prev, assistantMsg])
    } catch (e) {
      if (e.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }])
      }
    } finally {
      setStreamingText('')
      setSending(false)
      sendingRef.current = false
    }
  }

  function clear() {
    if (abortRef.current) abortRef.current.abort()
    if (messages.length >= 2) saveSession(messages)
    setMessages([])
    setStreamingText('')
    setSending(false)
    sendingRef.current = false
    setPendingAction(null)
    setSummaryCard(null)
    setScanCard(null)
  }

  // ── Confirm create-bill action ────────────────────────────────────────────
  async function confirmAction(action) {
    if (action.action !== 'create_bill') return
    await fetch(`${API}/bills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: action.name,
        expected_amount: action.amount,
        day_of_month: action.due_day,
        category: action.category || 'other',
        confidence: 'fixed',
        is_active: 1,
      }),
    })
    setPendingAction(null)
  }

  // ── Month-end summary ─────────────────────────────────────────────────────
  async function runMonthlySummary() {
    setSummarizing(true)
    setSummaryCard(null)
    const context = await buildContext()
    const prompt = `Generate a month-end financial summary. Return JSON only:
{"prose": "2-3 sentence overview", "bullets": ["bullet1", "bullet2", ...up to 5 bullets covering: income received, total spent, budget performance, biggest surprise, one recommendation"]}

Context: ${JSON.stringify(context, null, 2)}`
    try {
      const r = await fetch(`${API}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false, options: { temperature: 0.4 } }),
      })
      const d = await r.json()
      const raw = (d.message?.content || d.response || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      try { setSummaryCard(JSON.parse(raw)) } catch { setSummaryCard({ prose: raw, bullets: [] }) }
    } catch (e) { setSummaryCard({ prose: `Error: ${e.message}`, bullets: [] }) }
    finally { setSummarizing(false) }
  }

  // ── Scan for issues ───────────────────────────────────────────────────────
  async function runScan() {
    setScanning(true)
    setScanCard(null)
    const context = await buildContext()
    const prompt = `Scan these transactions for issues: duplicate charges within 7 days for the same merchant, subscriptions that changed price, unusually large charges for a given merchant. Return JSON only:
{"issues": [{"type": "duplicate|price_change|large_charge", "description": "...", "transactions": ["desc $amt date", ...]}]}
If no issues found, return {"issues": []}.

Transactions: ${JSON.stringify(context.recent_transactions || [], null, 2)}`
    try {
      const r = await fetch(`${API}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false, options: { temperature: 0.2 } }),
      })
      const d = await r.json()
      const raw = (d.message?.content || d.response || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      try { setScanCard(JSON.parse(raw).issues || []) } catch { setScanCard([]) }
    } catch { setScanCard([]) }
    finally { setScanning(false) }
  }

  // ── Budget suggestions ────────────────────────────────────────────────────
  async function runBudgetSuggest() {
    setSuggesting(true)
    const context = await buildContext()
    const prompt = `Based on the last 3 months of transactions, suggest reasonable monthly budget limits for each spending category. Be realistic — suggest limits slightly above the average actual spending. Return JSON only:
{"suggestions": {"groceries": 400, "dining": 200, ...}}
Only include categories present in the transaction data. Use lowercase category names.

Transactions: ${JSON.stringify(context.recent_transactions || [], null, 2)}`
    try {
      const r = await fetch(`${API}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false, options: { temperature: 0.3 } }),
      })
      const d = await r.json()
      const raw = (d.message?.content || d.response || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      try { setBudgetSuggestions(JSON.parse(raw).suggestions || {}) } catch {}
    } catch {}
    finally { setSuggesting(false) }
  }

  const allPrompts = [...DEFAULT_PROMPTS, ...savedPrompts]

  return (
    <div className="page-enter" style={{ padding: '32px 36px 0', display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.05em' }}>Assistant</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="apple-btn-secondary" onClick={runScan} disabled={scanning} style={{ fontSize: 12 }}>
            {scanning ? '⏳ Scanning…' : '🔍 Scan for Issues'}
          </button>
          <button className="apple-btn-secondary" onClick={runMonthlySummary} disabled={summarizing} style={{ fontSize: 12 }}>
            {summarizing ? '⏳ Summarizing…' : '📋 Month Summary'}
          </button>
          <button className="apple-btn-secondary" onClick={runBudgetSuggest} disabled={suggesting} style={{ fontSize: 12 }}>
            {suggesting ? '⏳ Analyzing…' : '💡 Suggest Budgets'}
          </button>
          <button className="apple-btn-secondary" onClick={() => setShowMemory(s => !s)} style={{ fontSize: 12 }}>
            ◐ Memory
          </button>
          <button className="apple-btn-secondary" onClick={() => setShowSettings(s => !s)} style={{ fontSize: 12 }}>
            ⚙ Settings
          </button>
          {(messages.length > 0 || sending) && (
            <button className="apple-btn-secondary" onClick={clear} style={{ fontSize: 12 }}>
              {sending ? '✕ Cancel' : 'Clear'}
            </button>
          )}
        </div>
      </div>

      {/* Inline memory panel */}
      {showMemory && <MemoryPanel />}

      {/* Inline settings panel */}
      {showSettings && (
        <div className="apple-card" style={{ padding: '16px 20px', marginBottom: 12, flexShrink: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <div className="apple-label" style={{ marginBottom: 6 }}>Model</div>
              <select className="apple-select" value={model} onChange={e => setModel(e.target.value)} style={{ width: '100%' }}>
                {models.length === 0 && <option value={model}>{model}</option>}
                {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <div className="apple-label" style={{ marginBottom: 6 }}>Temperature: {temperature}</div>
              <input type="range" min={0} max={1} step={0.05} value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)', marginTop: 8 }} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="apple-label" style={{ marginBottom: 6 }}>Persona</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(PERSONA_PRESETS).map(([key, val]) => (
                  <button key={key} className="apple-btn-secondary"
                    onClick={() => setSystemPrompt(val)}
                    style={{ fontSize: 12, textTransform: 'capitalize', background: systemPrompt === val ? 'var(--accent)' : undefined, color: systemPrompt === val ? '#fff' : undefined }}>
                    {key}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="apple-label" style={{ marginBottom: 6 }}>System prompt</div>
              <textarea className="apple-input" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
                rows={3} style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} />
            </div>
          </div>
        </div>
      )}

      {/* Scan / Summary / Budget cards */}
      <div style={{ flexShrink: 0 }}>
        {scanCard !== null && <ScanCard issues={scanCard} onDismiss={() => setScanCard(null)} />}
        {summaryCard && <SummaryCard summary={summaryCard} onDismiss={() => setSummaryCard(null)} />}
        {budgetSuggestions && (
          <BudgetSuggestModal
            suggestions={budgetSuggestions}
            onApply={() => setBudgetSuggestions(null)}
            onClose={() => setBudgetSuggestions(null)}
          />
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16, padding: '4px 0' }}>
        {messages.length === 0 && !sending && (
          <div style={{ padding: '24px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14, textAlign: 'center' }}>
              Ask about your finances
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {allPrompts.map((p, i) => (
                <button key={i} onClick={() => sendMsg(p)} disabled={sending} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-pill)', padding: '8px 16px', fontSize: 13,
                  color: 'var(--text-secondary)', cursor: sending ? 'default' : 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s ease', maxWidth: 320, textAlign: 'center',
                  opacity: sending ? 0.4 : 1,
                }}
                  onMouseEnter={e => { if (!sending) { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--accent)' } }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
                  {p}
                </button>
              ))}
              <button onClick={() => setShowSavePrompt(true)} style={{
                background: 'transparent', border: '1px dashed var(--border)',
                borderRadius: 'var(--radius-pill)', padding: '8px 16px', fontSize: 13,
                color: 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit',
              }}>+ Save prompt</button>
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i}>
            <Bubble role={m.role} content={m.content} />
            {m.role === 'assistant' && pendingAction && i === messages.length - 1 && (
              <ActionCard action={pendingAction} onConfirm={confirmAction} onDismiss={() => setPendingAction(null)} />
            )}
          </div>
        ))}
        {sending && streamingText && <Bubble role="assistant" content={streamingText} streaming />}
        {sending && !streamingText && <ThinkingBubble hasContent={false} onStop={() => { abortRef.current?.abort(); setSending(false); sendingRef.current = false; setStreamingText('') }} />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 10, flexShrink: 0, paddingBottom: 16 }}>
        <input className="apple-input" placeholder="Ask about your finances…"
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMsg()}
          disabled={sending} style={{ flex: 1 }} />
        <button className="apple-btn-primary" onClick={() => sendMsg()} disabled={sending || !input.trim()}>
          {sending ? '…' : 'Send'}
        </button>
      </div>

      {showSavePrompt && (
        <SavePromptModal
          onSave={() => {
            setShowSavePrompt(false)
            setSavedPrompts(() => { try { return JSON.parse(localStorage.getItem(LS_SAVED_PROMPTS)) || [] } catch { return [] } })
          }}
          onClose={() => setShowSavePrompt(false)}
        />
      )}
    </div>
  )
}
