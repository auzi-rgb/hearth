import { useState, useRef, useEffect } from 'react'
import Portal from './Portal'

// Every page is wrapped in .page-enter, whose animation leaves a `transform`
// on the ancestor even after it finishes — same reason Portal.jsx exists.
// A `position: fixed` panel positioned via the trigger's own bounding rect
// (through a Portal, so it isn't a descendant of that transformed ancestor)
// sidesteps it, same pattern Spending.jsx's popoverStyle already uses.
function panelStyle(anchor, minWidth) {
  const w = Math.max(minWidth, 160)
  const base = {
    position: 'fixed', zIndex: 1200, minWidth: w, maxWidth: Math.min(360, window.innerWidth - 24),
    background: 'var(--bg-modal)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    boxShadow: '0 8px 40px rgba(0,0,0,0.18)', overflowY: 'auto', padding: 4,
  }
  if (!anchor) return base
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8))
  const top = anchor.bottom + 4
  return { ...base, top, left, maxHeight: Math.min(320, window.innerHeight - top - 16) }
}

// options is a flat array of { value, label, disabled? } OR a mix that also
// includes { group: 'Label', options: [...] } for optgroup-style sections
// (used by the linked-account picker in Bills.jsx). flatten() gives the
// display code one flat list to search for the currently selected item,
// regardless of whether it came from a group or not.
function flatten(options) {
  const out = []
  for (const o of options) {
    if (o.group) out.push(...o.options)
    else out.push(o)
  }
  return out
}

function DropdownItem({ opt, active, onPick }) {
  const [hover, setHover] = useState(false)
  return (
    <div role="option" aria-selected={active} aria-disabled={opt.disabled || undefined}
      onClick={() => !opt.disabled && onPick(opt.value)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        padding: '8px 10px', borderRadius: 6, fontSize: 14,
        cursor: opt.disabled ? 'default' : 'pointer',
        color: opt.disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
        background: (active || hover) && !opt.disabled ? 'var(--bg-subtle)' : 'transparent',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
      {opt.label}
    </div>
  )
}

// Custom-styled stand-in for <select className="apple-select">. Exists because
// Chrome on Windows won't reliably dark-theme a native <select> popup no
// matter what CSS is applied — color-scheme is declared correctly (confirmed:
// the exact same page renders the popup correctly dark in Firefox) and Chrome
// still shows it light. A fully custom popup sidesteps native widget
// rendering entirely, so every browser shows the same thing.
//
// API mirrors a native select as closely as reasonable: value + onChange(value)
// (onChange receives the raw new value, not an event — every call site was
// touched to switch to options={[...]} anyway, so there's no native-compat
// upside to faking an event object) and an options array of
// { value, label, disabled? } items, optionally grouped via { group, options }.
export default function Dropdown({ value, onChange, options, placeholder, disabled, style, className, ...rest }) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const triggerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const flat = flatten(options)
  const current = flat.find(o => String(o.value) === String(value))

  function toggle(e) {
    e.stopPropagation()
    if (disabled) return
    if (!open) setAnchor(triggerRef.current.getBoundingClientRect())
    setOpen(o => !o)
  }
  function pick(v) {
    setOpen(false)
    onChange(v)
  }

  return (
    <>
      <button type="button" ref={triggerRef} onClick={toggle} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open}
        className={className || 'apple-select'}
        {...rest}
        style={{
          textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', font: 'inherit', ...style,
        }}>
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: current ? 'inherit' : 'var(--text-tertiary)',
        }}>
          {current ? current.label : (placeholder || '')}
        </span>
      </button>
      {open && (
        <Portal>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1199 }} onClick={() => setOpen(false)} />
          <div role="listbox" style={panelStyle(anchor, triggerRef.current?.offsetWidth || 200)}>
            {options.map((o, i) => o.group ? (
              <div key={`g${i}`}>
                <div style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: 'var(--text-tertiary)', padding: '8px 10px 4px',
                }}>
                  {o.group}
                </div>
                {o.options.map(opt => (
                  <DropdownItem key={opt.value} opt={opt} active={String(opt.value) === String(value)} onPick={pick} />
                ))}
              </div>
            ) : (
              <DropdownItem key={o.value} opt={o} active={String(o.value) === String(value)} onPick={pick} />
            ))}
          </div>
        </Portal>
      )}
    </>
  )
}
