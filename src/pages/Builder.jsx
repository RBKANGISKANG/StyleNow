import { useMemo, useState } from 'react'
import { CATALOG, SLOT_LABELS, SLOT_ORDER } from '../data.js'
import { useStore } from '../store.jsx'

function scoreOutfit(picks) {
  // Count vibe overlap across the real pieces (skip "none" placeholders).
  const pieces = SLOT_ORDER.map(s => CATALOG[s][picks[s]]).filter(p => !p.id.endsWith('-0'))
  const counts = {}
  pieces.forEach(p => p.vibes.forEach(v => { counts[v] = (counts[v] || 0) + 1 }))
  const best = Math.max(0, ...Object.values(counts))
  const bestVibe = Object.keys(counts).find(v => counts[v] === best) || null
  const score = pieces.length ? Math.round((best / pieces.length) * 100) : 0
  return { score, bestVibe }
}

function verdict(score) {
  if (score >= 90) return 'Locked in. This is a signature look. 🔥'
  if (score >= 70) return 'Strong match — these pieces speak the same language.'
  if (score >= 50) return 'Interesting mix. Bold, but it can work.'
  return 'A daring clash — swap one piece to pull it together.'
}

export default function Builder() {
  const { saveOutfit, setToast } = useStore()
  const [picks, setPicks] = useState({ layer: 1, top: 0, bottom: 0, shoes: 0, accessory: 1 })
  const [name, setName] = useState('')
  const [swapKey, setSwapKey] = useState(0)

  const cycle = (slot, dir) => {
    setPicks(p => ({ ...p, [slot]: (p[slot] + dir + CATALOG[slot].length) % CATALOG[slot].length }))
    setSwapKey(k => k + 1)
  }

  const shuffle = () => {
    setPicks(p => {
      const next = {}
      for (const slot of SLOT_ORDER) {
        let idx = Math.floor(Math.random() * CATALOG[slot].length)
        if (CATALOG[slot].length > 1 && idx === p[slot]) idx = (idx + 1) % CATALOG[slot].length
        next[slot] = idx
      }
      return next
    })
    setSwapKey(k => k + 1)
  }

  const { score, bestVibe } = useMemo(() => scoreOutfit(picks), [picks])

  const onSave = () => {
    const pieces = SLOT_ORDER.map(s => CATALOG[s][picks[s]]).filter(p => !p.id.endsWith('-0'))
    saveOutfit({
      name: name.trim() || `My ${bestVibe || 'Custom'} Fit`,
      pieces: pieces.map(p => ({ emoji: p.emoji, name: p.name })),
      score,
      vibe: bestVibe,
    })
    setName('')
    setToast('✨ Outfit saved!')
  }

  return (
    <div className="page">
      <div className="section-head">
        <h2>Outfit Builder</h2>
        <span className="sub">Tap the arrows to mix &amp; match</span>
      </div>

      <div className="builder-layout">
        <div className="slot-list">
          {SLOT_ORDER.map(slot => {
            const item = CATALOG[slot][picks[slot]]
            return (
              <div className="slot" key={slot}>
                <div className="slot-label">{SLOT_LABELS[slot]}</div>
                <div className="slot-emoji slot-swap" key={`${slot}-${swapKey}`}>{item.emoji}</div>
                <div className="slot-info slot-swap" key={`i-${slot}-${swapKey}`}>
                  <div className="name">{item.name}</div>
                  <div className="meta">{item.color} · {item.vibes.slice(0, 3).join(' / ')}</div>
                </div>
                <div className="slot-arrows">
                  <button className="arrow-btn" onClick={() => cycle(slot, -1)} aria-label={`Previous ${slot}`}>←</button>
                  <button className="arrow-btn" onClick={() => cycle(slot, 1)} aria-label={`Next ${slot}`}>→</button>
                </div>
              </div>
            )
          })}
        </div>

        <aside className="builder-panel">
          <div className="fit-preview slot-swap" key={`fit-${swapKey}`}>
            {SLOT_ORDER.map(s => {
              const it = CATALOG[s][picks[s]]
              return it.id.endsWith('-0') ? null : <span key={s}>{it.emoji}</span>
            })}
          </div>

          <div>
            <div className="score-row">
              <span className="score-label">Style match</span>
              <span className="score-value">{score}%</span>
            </div>
            <div className="score-bar" style={{ marginTop: 8 }}>
              <div className="score-fill" style={{ width: `${score}%` }} />
            </div>
            <p className="score-verdict" style={{ marginTop: 10 }}>
              {bestVibe && <strong>{bestVibe} energy. </strong>}
              {verdict(score)}
            </p>
          </div>

          <button className="btn btn-soft" onClick={shuffle} style={{ justifyContent: 'center' }}>
            🎲 Surprise me
          </button>

          <input
            className="name-input"
            placeholder="Name this outfit (optional)"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={40}
          />
          <button className="btn btn-accent" onClick={onSave} style={{ justifyContent: 'center' }}>
            💾 Save outfit
          </button>
        </aside>
      </div>
    </div>
  )
}
