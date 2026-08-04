import { useState } from 'react'
import { LOOKS } from '../data.js'
import { LookCard, LookModal } from '../components/LookCard.jsx'
import { useStore } from '../store.jsx'

export default function Saved({ go }) {
  const { savedLooks, outfits, removeOutfit, setToast } = useStore()
  const [open, setOpen] = useState(null)
  const looks = LOOKS.filter(l => savedLooks.includes(l.id))

  return (
    <div className="page">
      <div className="section-head">
        <h2>Saved Looks</h2>
        <span className="sub">{looks.length} saved</span>
      </div>

      {looks.length === 0 ? (
        <div className="empty">
          <div className="big">🤍</div>
          <h3>No saved looks yet</h3>
          <p>Tap the heart on any look in Discover to keep it here.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => go('discover')}>
            Browse looks
          </button>
        </div>
      ) : (
        <div className="look-grid">
          {looks.map(l => (
            <LookCard key={l.id} look={l} onOpen={setOpen} />
          ))}
        </div>
      )}

      <div className="section-head">
        <h2>My Outfits</h2>
        <span className="sub">{outfits.length} created</span>
      </div>

      {outfits.length === 0 ? (
        <div className="empty">
          <div className="big">🎨</div>
          <h3>No outfits yet</h3>
          <p>Mix and match pieces in the Builder, then save your favorites.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => go('builder')}>
            Open the builder
          </button>
        </div>
      ) : (
        <div className="outfit-list">
          {outfits.map(o => (
            <div className="outfit-card" key={o.id}>
              <div className="emojis">
                {o.pieces.map((p, i) => (
                  <span key={i} title={p.name}>{p.emoji}</span>
                ))}
              </div>
              <div className="info">
                <div className="name">{o.name}</div>
                <div className="meta">
                  {o.vibe ? `${o.vibe} · ` : ''}{o.score}% style match · {o.pieces.map(p => p.name).join(', ')}
                </div>
              </div>
              <button
                className="btn btn-soft"
                onClick={() => {
                  removeOutfit(o.id)
                  setToast('Outfit deleted')
                }}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}

      <LookModal look={open} onClose={() => setOpen(null)} />
    </div>
  )
}
