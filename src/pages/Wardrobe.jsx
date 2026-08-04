import { useState } from 'react'
import { WARDROBE_CATEGORIES, EMOJI_CHOICES } from '../data.js'
import { useStore } from '../store.jsx'

export default function Wardrobe() {
  const { wardrobe, addWardrobeItem, removeWardrobeItem, setToast } = useStore()
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('All')
  const [form, setForm] = useState({ name: '', category: 'Tops', color: '', emoji: '👕' })

  const items = filter === 'All' ? wardrobe : wardrobe.filter(i => i.category === filter)

  const submit = e => {
    e.preventDefault()
    if (!form.name.trim()) return
    addWardrobeItem({ ...form, name: form.name.trim(), color: form.color.trim() || '—' })
    setForm({ name: '', category: form.category, color: '', emoji: form.emoji })
    setShowForm(false)
    setToast('👗 Added to your wardrobe')
  }

  return (
    <div className="page">
      <div className="section-head">
        <h2>My Wardrobe</h2>
        <button className="btn btn-accent" onClick={() => setShowForm(s => !s)}>
          {showForm ? '✕ Cancel' : '＋ Add piece'}
        </button>
      </div>

      {showForm && (
        <form className="add-form" onSubmit={submit}>
          <div className="row">
            <input
              className="name-input"
              placeholder="Piece name — e.g. Linen Shirt"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              maxLength={40}
              autoFocus
              required
            />
            <input
              className="name-input"
              placeholder="Color — e.g. Sage"
              value={form.color}
              onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
              maxLength={24}
            />
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            >
              {WARDROBE_CATEGORIES.map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="emoji-picker">
            {EMOJI_CHOICES.map(em => (
              <button
                type="button"
                key={em}
                className={`emoji-opt ${form.emoji === em ? 'sel' : ''}`}
                onClick={() => setForm(f => ({ ...f, emoji: em }))}
              >
                {em}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" type="submit" style={{ alignSelf: 'flex-start' }}>
            Add to wardrobe
          </button>
        </form>
      )}

      <div className="chips">
        {['All', ...WARDROBE_CATEGORIES].map(c => (
          <button key={c} className={`chip ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>
            {c}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <div className="big">🧺</div>
          <h3>Nothing here yet</h3>
          <p>Add your first piece and start building your digital closet.</p>
        </div>
      ) : (
        <div className="wardrobe-grid">
          {items.map(item => (
            <div className="w-item" key={item.id}>
              <button
                className="w-del"
                onClick={() => {
                  removeWardrobeItem(item.id)
                  setToast('Removed from wardrobe')
                }}
                aria-label={`Remove ${item.name}`}
              >
                ✕
              </button>
              <div className="big">{item.emoji}</div>
              <div className="name">{item.name}</div>
              <div className="meta">{item.category} · {item.color}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
