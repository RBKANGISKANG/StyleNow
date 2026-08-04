import { useMemo, useState } from 'react'
import { LOOKS, VIBES, OCCASIONS, PERSONAS } from '../data.js'
import { LookCard, LookModal } from '../components/LookCard.jsx'
import { useStore } from '../store.jsx'

export default function Discover({ go }) {
  const { persona, savedLooks, wardrobe, outfits } = useStore()
  const [vibe, setVibe] = useState('All')
  const [occasion, setOccasion] = useState('All')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(null)

  const looks = useMemo(() => {
    return LOOKS.filter(l => {
      if (vibe !== 'All' && l.vibe !== vibe) return false
      if (occasion !== 'All' && l.occasion !== occasion) return false
      if (query) {
        const q = query.toLowerCase()
        const hay = `${l.name} ${l.vibe} ${l.occasion} ${l.items.map(i => i.label).join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [vibe, occasion, query])

  const forYou = persona ? LOOKS.filter(l => l.vibe === persona) : []

  return (
    <div className="page">
      <section className="hero">
        <h1>
          Dress like the day is <em>yours</em>.
        </h1>
        <p>
          Curated looks, a wardrobe that remembers, and an outfit builder that plays matchmaker.
          Your style, right now.
        </p>
        <div className="hero-cta">
          <button className="btn btn-hero" onClick={() => go('builder')}>✨ Build an outfit</button>
          <button className="btn btn-ghost-light" onClick={() => go('quiz')}>
            {persona ? `${PERSONAS[persona].emoji} ${PERSONAS[persona].title}` : '🔮 Find your style persona'}
          </button>
        </div>
      </section>

      <div className="stats">
        <div className="stat" onClick={() => go('saved')}>
          <div className="num">{savedLooks.length}</div>
          <div className="lbl">Saved looks</div>
        </div>
        <div className="stat" onClick={() => go('wardrobe')}>
          <div className="num">{wardrobe.length}</div>
          <div className="lbl">Wardrobe pieces</div>
        </div>
        <div className="stat" onClick={() => go('saved')}>
          <div className="num">{outfits.length}</div>
          <div className="lbl">Outfits created</div>
        </div>
      </div>

      {forYou.length > 0 && (
        <>
          <div className="section-head">
            <h2>Picked for you</h2>
            <span className="sub">Based on your {PERSONAS[persona].title} persona</span>
          </div>
          <div className="look-grid">
            {forYou.map(l => (
              <LookCard key={l.id} look={l} onOpen={setOpen} />
            ))}
          </div>
        </>
      )}

      <div className="section-head">
        <h2>Discover looks</h2>
        <span className="sub">{looks.length} of {LOOKS.length} looks</span>
      </div>

      <input
        className="search"
        placeholder="🔍  Search looks, pieces, vibes…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />

      <div className="chips">
        {['All', ...VIBES].map(v => (
          <button key={v} className={`chip ${vibe === v ? 'active' : ''}`} onClick={() => setVibe(v)}>
            {v}
          </button>
        ))}
      </div>
      <div className="chips">
        {['All', ...OCCASIONS].map(o => (
          <button key={o} className={`chip ${occasion === o ? 'active' : ''}`} onClick={() => setOccasion(o)}>
            {o}
          </button>
        ))}
      </div>

      {looks.length === 0 ? (
        <div className="empty">
          <div className="big">🪞</div>
          <h3>No looks match</h3>
          <p>Try clearing a filter or searching for something else.</p>
        </div>
      ) : (
        <div className="look-grid">
          {looks.map(l => (
            <LookCard key={l.id} look={l} onOpen={setOpen} />
          ))}
        </div>
      )}

      <LookModal look={open} onClose={() => setOpen(null)} />
    </div>
  )
}
