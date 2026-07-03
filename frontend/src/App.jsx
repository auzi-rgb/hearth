import { useState, useEffect } from 'react'
import { isTokenValid, clearToken } from './api.js'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Calendar from './pages/Calendar'
import Debt from './pages/Debt'
import Spending from './pages/Spending'
import AI from './pages/AI'
import Settings from './pages/Settings'
import Overview from './pages/Overview'
import Bills from './pages/Bills'
import Budget from './pages/Budget'
import Accounts from './pages/Accounts'
import About from './pages/About'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '⊞' },
  { id: 'overview',  label: 'Overview',  icon: '◎' },
  { id: 'accounts',  label: 'Accounts',  icon: '▤' },
  { id: 'calendar',  label: 'Calendar',  icon: '▦' },
  { id: 'spending',  label: 'Spending',  icon: '↕' },
  { id: 'budget',    label: 'Budget',    icon: '◷' },
  { id: 'bills',     label: 'Bills',     icon: '✓' },
  { id: 'debt',      label: 'Debt',      icon: '⊖' },
  { id: 'about',     label: 'About',     icon: '?' },
]

const BOTTOM_TABS = [
  { id: 'ai',       label: 'Assistant', icon: '✦' },
  { id: 'settings', label: 'Settings',  icon: '⚙' },
]

export default function App() {
  const [authed, setAuthed] = useState(() => isTokenValid())
  const [page, setPage] = useState('dashboard')
  const [debtExtra, setDebtExtra] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [budgetAlert, setBudgetAlert] = useState(false)
  // Breadcrumb for pages with internal sub-navigation (currently Settings).
  // {label, onBack} — rendered in the top title strip; clicking the parent
  // crumb calls onBack to return to that page's hub view.
  const [crumb, setCrumb] = useState(null)

  useEffect(() => {
    function onUnauthorized() { setAuthed(false) }
    window.addEventListener('finance:unauthorized', onUnauthorized)
    return () => window.removeEventListener('finance:unauthorized', onUnauthorized)
  }, [])

  function logout() { clearToken(); setAuthed(false) }
  function navigate(id) { setPage(id); setDrawerOpen(false); setCrumb(null) }

  if (!authed) return <Login onLogin={() => setAuthed(true)} />

  const activeTab = [...TABS, ...BOTTOM_TABS].find(t => t.id === page)

  // Desktop sidebar nav item
  const navItem = (t) => {
    const isActive = page === t.id
    const hasBadge = t.id === 'budget' && budgetAlert && !isActive
    return (
      <button
        key={t.id}
        onClick={() => setPage(t.id)}
        title={t.label}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', padding: '9px 14px', marginBottom: 2,
          borderRadius: 'var(--radius-sm)', border: 'none',
          boxShadow: isActive ? 'inset 3px 0 0 0 var(--accent)' : 'none',
          background: isActive ? 'var(--bg-subtle)' : 'transparent',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          cursor: 'pointer', fontSize: 13,
          fontWeight: isActive ? 500 : 400,
          fontFamily: 'inherit', letterSpacing: '-0.01em',
          transition: 'all 0.15s ease', textAlign: 'left', whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-subtle)' }}
        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ fontSize: 13, width: 18, textAlign: 'center', flexShrink: 0, opacity: isActive ? 1 : 0.65, position: 'relative' }}>
          {t.icon}
          {hasBadge && (
            <span style={{
              position: 'absolute', top: -3, right: -3,
              width: 7, height: 7, borderRadius: '50%',
              background: 'var(--red)', border: '1.5px solid var(--bg-nav)',
            }} />
          )}
        </span>
        {t.label}
        {hasBadge && (
          <span style={{
            marginLeft: 'auto', width: 7, height: 7, borderRadius: '50%',
            background: 'var(--red)', flexShrink: 0,
          }} />
        )}
      </button>
    )
  }

  // Mobile drawer nav item
  const drawerNavItem = (t) => {
    const isActive = page === t.id
    const hasBadge = t.id === 'budget' && budgetAlert && !isActive
    return (
      <button
        key={t.id}
        onClick={() => navigate(t.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          width: '100%', padding: '13px 20px', margin: 0,
          border: 'none',
          borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
          background: isActive ? 'var(--bg-subtle)' : 'transparent',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          cursor: 'pointer', fontSize: 15,
          fontWeight: isActive ? 600 : 400,
          fontFamily: 'inherit', letterSpacing: '-0.01em',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0, opacity: isActive ? 1 : 0.7 }}>
          {t.icon}
        </span>
        {t.label}
        {hasBadge && (
          <span style={{
            marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%',
            background: 'var(--red)', flexShrink: 0,
          }} />
        )}
      </button>
    )
  }

  const pane = (id, child) => (
    <div key={id} style={{
      display: page === id ? 'flex' : 'none',
      flexDirection: 'column',
      height: '100%',
      overflowY: 'auto',
    }}>
      {child}
    </div>
  )

  return (
    <div className="app-shell" style={{ height: '100vh', display: 'flex', flexDirection: 'row', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* ── Left sidebar ───────────────────────────────────────── */}
      <aside className="desktop-sidebar" style={{
        width: 200, flexShrink: 0,
        height: '100vh',
        background: 'var(--bg-nav)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        overflowY: 'auto', overflowX: 'hidden',
      }}>

        {/* Logo */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.04em' }}>
            <span style={{ color: 'var(--accent)' }}>⌂</span>{' '}Hearth
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>Home Finance</div>
        </div>

        {/* Main nav */}
        <nav style={{ flex: 1, padding: '10px 8px 8px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-tertiary)', padding: '2px 14px 8px', textTransform: 'uppercase' }}>
            Finance
          </div>
          {TABS.map(navItem)}
        </nav>

        {/* Tools nav */}
        <div style={{ padding: '8px 8px 0', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-tertiary)', padding: '8px 14px 6px', textTransform: 'uppercase' }}>
            Tools
          </div>
          {BOTTOM_TABS.map(navItem)}
        </div>

        {/* Sign out */}
        <div style={{ padding: '4px 8px 20px', flexShrink: 0 }}>
          <button
            onClick={logout}
            title="Sign out of Hearth"
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: '9px 14px',
              borderRadius: 'var(--radius-sm)', border: 'none',
              background: 'transparent', color: 'var(--text-tertiary)',
              cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
              transition: 'all 0.15s ease', textAlign: 'left',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'rgba(255,59,48,0.06)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ fontSize: 13, width: 18, textAlign: 'center' }}>⇥</span>
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Content area ───────────────────────────────────────── */}
      <div className="content-shell" style={{ flex: 1, height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Page title strip */}
        <div className="top-title-strip" style={{
          flexShrink: 0, height: 46,
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center',
          padding: '0 28px',
          background: 'var(--bg-nav)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          gap: 10,
        }}>
          {/* Hamburger — hidden on desktop via CSS */}
          <button
            className="mobile-hamburger"
            onClick={() => setDrawerOpen(o => !o)}
            title="Menu"
            aria-label="Open navigation menu"
          >
            ☰
          </button>
          {page === 'settings' && crumb ? (
            <span style={{ fontSize: 13, letterSpacing: '-0.02em' }}>
              <span
                onClick={() => crumb.onBack?.()}
                style={{ color: 'var(--blue)', cursor: 'pointer', fontWeight: 500 }}
              >
                Settings
              </span>
              <span style={{ color: 'var(--text-tertiary)', margin: '0 6px' }}>/</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{crumb.label}</span>
            </span>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {activeTab?.label}
            </span>
          )}
          {page === 'budget' && (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 400 }}>
              {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
          )}
          {page === 'dashboard' && (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 400 }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
          )}

        </div>

        {/* Panes */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {pane('dashboard', <Dashboard active={page === 'dashboard'} navigateTo={navigate} />)}
          {pane('overview',  <Overview  active={page === 'overview'}  debtExtra={debtExtra} />)}
          {pane('accounts',  <Accounts  active={page === 'accounts'} />)}
          {pane('calendar',  <Calendar  active={page === 'calendar'}  />)}
          {pane('debt',      <Debt      active={page === 'debt'}      onExtraChange={setDebtExtra} />)}
          {pane('spending',  <Spending  active={page === 'spending'}  />)}
          {pane('budget',    <Budget    active={page === 'budget'}    onAlert={setBudgetAlert} navigate={navigate} />)}
          {pane('bills',     <Bills     active={page === 'bills'}     />)}
          {pane('about',     <About     active={page === 'about'}     navigate={navigate} />)}
          {pane('ai',        <AI        active={page === 'ai'}        />)}
          {pane('settings',  <Settings  active={page === 'settings'}  onCrumb={setCrumb} />)}
        </div>
      </div>

      {/* ── Drawer overlay (mobile only) ───────────────────────── */}
      <div
        className="drawer-overlay"
        onClick={() => setDrawerOpen(false)}
        style={{
          opacity: drawerOpen ? 1 : 0,
          pointerEvents: drawerOpen ? 'auto' : 'none',
        }}
      />

      {/* ── Mobile slide drawer ─────────────────────────────────── */}
      <nav
        className="mobile-drawer"
        style={{ transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)' }}
      >
        {/* Logo */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.04em' }}>
            <span style={{ color: 'var(--accent)' }}>⌂</span>{' '}Hearth
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>Home Finance</div>
        </div>

        {/* Main nav */}
        <div style={{ flex: 1, padding: '8px 0' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-tertiary)', padding: '8px 20px 4px', textTransform: 'uppercase' }}>
            Finance
          </div>
          {TABS.map(drawerNavItem)}
        </div>

        {/* Tools nav */}
        <div style={{ borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-tertiary)', padding: '12px 20px 4px', textTransform: 'uppercase' }}>
            Tools
          </div>
          {BOTTOM_TABS.map(drawerNavItem)}
        </div>

        {/* Sign out */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '4px 0', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', flexShrink: 0 }}>
          <button
            onClick={() => { logout(); setDrawerOpen(false) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              width: '100%', padding: '13px 20px',
              border: 'none', borderLeft: '3px solid transparent',
              background: 'transparent', color: 'var(--text-tertiary)',
              cursor: 'pointer', fontSize: 15, fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>⇥</span>
            Sign out
          </button>
        </div>
      </nav>
    </div>
  )
}
