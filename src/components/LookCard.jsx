import { useStore } from '../store.jsx'

export function LookCard({ look, onOpen }) {
  const { savedLooks, toggleSavedLook, setToast } = useStore()
  const saved = savedLooks.includes(look.id)

  const onHeart = e => {
    e.stopPropagation()
    toggleSavedLook(look.id)
    setToast(saved ? 'Removed from saved' : '❤️ Saved to your looks')
  }

  return (
    <article className="look-card" onClick={() => onOpen(look)}>
      <div
        className="look-visual"
        style={{ background: `linear-gradient(135deg, ${look.gradient[0]}, ${look.gradient[1]})` }}
      >
        {look.items.slice(0, 4).map((it, i) => (
          <span key={i}>{it.emoji}</span>
        ))}
        <button
          className={`heart ${saved ? 'on' : ''}`}
          onClick={onHeart}
          aria-label={saved ? 'Unsave look' : 'Save look'}
        >
          {saved ? '❤️' : '🤍'}
        </button>
      </div>
      <div className="look-body">
        <h3>{look.name}</h3>
        <div className="look-tags">
          <span className="tag accent">{look.vibe}</span>
          <span className="tag">{look.occasion}</span>
        </div>
      </div>
    </article>
  )
}

export function LookModal({ look, onClose }) {
  const { savedLooks, toggleSavedLook, setToast } = useStore()
  if (!look) return null
  const saved = savedLooks.includes(look.id)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div
          className="modal-visual"
          style={{ background: `linear-gradient(135deg, ${look.gradient[0]}, ${look.gradient[1]})` }}
        >
          {look.items.slice(0, 4).map((it, i) => (
            <span key={i}>{it.emoji}</span>
          ))}
        </div>
        <div className="modal-body">
          <h3>{look.name}</h3>
          <div className="look-tags" style={{ marginTop: 8 }}>
            <span className="tag accent">{look.vibe}</span>
            <span className="tag">{look.occasion}</span>
          </div>
          <p className="modal-note">“{look.note}”</p>
          <div className="modal-items">
            {look.items.map((it, i) => (
              <div className="modal-item" key={i}>
                <span className="emoji">{it.emoji}</span> {it.label}
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button
              className={saved ? 'btn btn-soft' : 'btn btn-accent'}
              onClick={() => {
                toggleSavedLook(look.id)
                setToast(saved ? 'Removed from saved' : '❤️ Saved to your looks')
              }}
            >
              {saved ? '💔 Unsave' : '❤️ Save this look'}
            </button>
            <button className="btn btn-soft" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}
