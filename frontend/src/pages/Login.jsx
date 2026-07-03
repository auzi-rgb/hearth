import { useState, useEffect, useRef } from 'react'

function FinanceBg() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    let W = window.innerWidth
    let H = window.innerHeight
    let raf

    canvas.width = W
    canvas.height = H

    const resize = () => {
      W = window.innerWidth
      H = window.innerHeight
      canvas.width = W
      canvas.height = H
    }
    window.addEventListener('resize', resize)

    // ── Chart lines ──────────────────────────────────────────────
    const NUM_CHARTS = 5
    const charts = Array.from({ length: NUM_CHARTS }, (_, i) => {
      const pts = 60
      const baseY = H * (0.15 + i * 0.17)
      const points = Array.from({ length: pts }, (_, j) => ({
        x: (W / (pts - 1)) * j,
        y: baseY + (Math.random() - 0.5) * H * 0.06,
      }))
      return { points, baseY, phase: Math.random() * Math.PI * 2, speed: 0.0003 + Math.random() * 0.0002 }
    })

    // ── Candlesticks ─────────────────────────────────────────────
    const CANDLE_COLS = 18
    const candleW = W / CANDLE_COLS
    const candleBaseY = H * 0.78
    const candles = Array.from({ length: CANDLE_COLS }, (_, i) => {
      const h = 20 + Math.random() * 70
      const isUp = Math.random() > 0.45
      return {
        x: candleW * i + candleW * 0.5,
        bodyH: h,
        wickTop: h + Math.random() * 18,
        wickBot: Math.random() * 12,
        isUp,
        opacity: 0.04 + Math.random() * 0.06,
        phase: Math.random() * Math.PI * 2,
        speed: 0.0004 + Math.random() * 0.0003,
      }
    })

    // ── Floating particles ($ and numbers) ───────────────────────
    const SYMBOLS = ['$', '$', '$', '%', '↑', '↗', '0.4%', '1.2%', '$']
    const particles = Array.from({ length: 28 }, () => ({
      x: Math.random() * W,
      y: H + Math.random() * H,
      symbol: SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
      speed: 0.18 + Math.random() * 0.28,
      opacity: 0.03 + Math.random() * 0.07,
      size: 10 + Math.random() * 14,
      drift: (Math.random() - 0.5) * 0.3,
    }))

    let t = 0

    function draw() {
      ctx.clearRect(0, 0, W, H)

      // Background gradient
      const grad = ctx.createLinearGradient(0, 0, W * 0.6, H)
      grad.addColorStop(0, '#0a0e1a')
      grad.addColorStop(0.5, '#0d1117')
      grad.addColorStop(1, '#080c14')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)

      // Subtle radial glow behind card area
      const glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.4)
      glow.addColorStop(0, 'rgba(22,163,74,0.04)')
      glow.addColorStop(1, 'rgba(22,163,74,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)

      // ── Draw animated line charts ──
      charts.forEach(chart => {
        const wave = Math.sin(t * chart.speed * 1000 + chart.phase) * H * 0.015
        ctx.beginPath()
        chart.points.forEach((p, i) => {
          const y = p.y + wave + Math.sin(t * chart.speed * 800 + i * 0.4) * 6
          i === 0 ? ctx.moveTo(p.x, y) : ctx.lineTo(p.x, y)
        })
        ctx.strokeStyle = 'rgba(22,163,74,0.12)'
        ctx.lineWidth = 1
        ctx.stroke()

        // Fill under curve
        ctx.lineTo(W, H)
        ctx.lineTo(0, H)
        ctx.closePath()
        ctx.fillStyle = 'rgba(22,163,74,0.015)'
        ctx.fill()
      })

      // ── Draw candlesticks ──
      candles.forEach(c => {
        const pulse = 0.7 + 0.3 * Math.sin(t * c.speed * 1000 + c.phase)
        const op = c.opacity * pulse
        const color = c.isUp ? `rgba(22,163,74,${op})` : `rgba(239,68,68,${op})`
        const top = candleBaseY - c.bodyH

        // Wick
        ctx.beginPath()
        ctx.moveTo(c.x, top - c.wickTop)
        ctx.lineTo(c.x, candleBaseY + c.wickBot)
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.stroke()

        // Body
        ctx.fillStyle = color
        ctx.fillRect(c.x - candleW * 0.18, top, candleW * 0.36, c.bodyH)
      })

      // ── Draw horizontal grid lines ──
      for (let i = 1; i < 6; i++) {
        const y = (H / 6) * i
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.strokeStyle = 'rgba(255,255,255,0.025)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 12])
        ctx.stroke()
        ctx.setLineDash([])
      }

      // ── Draw floating particles ──
      ctx.textBaseline = 'middle'
      particles.forEach(p => {
        p.y -= p.speed
        p.x += p.drift
        if (p.y < -40) {
          p.y = H + 20
          p.x = Math.random() * W
        }
        ctx.globalAlpha = p.opacity
        ctx.fillStyle = '#16a34a'
        ctx.font = `${p.size}px -apple-system, sans-serif`
        ctx.fillText(p.symbol, p.x, p.y)
      })
      ctx.globalAlpha = 1

      t += 1 / 60
      raf = requestAnimationFrame(draw)
    }

    draw()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', inset: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 0,
      }}
    />
  )
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!password) return
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/hearth/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Login failed')
      localStorage.setItem('finance_token', d.access_token)
      onLogin()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0e1a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative',
    }}>
      <FinanceBg />
      <div className="apple-card" style={{ width: 360, padding: '40px 36px', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.04em', marginBottom: 4 }}>
            <span style={{ color: 'var(--accent)' }}>⌂</span> Hearth
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Sign in to your household dashboard</div>
        </div>

        <form onSubmit={submit}>
          <div style={{ marginBottom: 14 }}>
            <div className="apple-label" style={{ marginBottom: 6 }}>Username</div>
            <input
              className="apple-input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading}
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <div className="apple-label" style={{ marginBottom: 6 }}>Password</div>
            <input
              className="apple-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              disabled={loading}
              autoFocus
            />
          </div>

          {error && (
            <div style={{
              background: 'rgba(255, 59, 48, 0.08)', border: '1px solid rgba(255, 59, 48, 0.2)',
              borderRadius: 10, padding: '10px 14px', marginBottom: 16,
              fontSize: 13, color: 'var(--red)',
            }}>
              {error}
            </div>
          )}

          <button
            className="apple-btn-primary"
            type="submit"
            disabled={loading || !password}
            style={{ width: '100%', padding: '12px' }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

      </div>
    </div>
  )
}
