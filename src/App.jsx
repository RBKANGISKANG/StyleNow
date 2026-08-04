import { useState } from 'react'
import { useStore } from './store.jsx'
import Discover from './pages/Discover.jsx'
import Builder from './pages/Builder.jsx'
import Quiz from './pages/Quiz.jsx'
import Wardrobe from './pages/Wardrobe.jsx'
import Saved from './pages/Saved.jsx'

const TABS = [
  { id: 'discover', label: 'Discover', icon: '🏠' },
  { id: 'builder', label: 'Builder', icon: '🎨' },
  { id: 'quiz', label: 'Quiz', icon: '🔮' },
  { id: 'wardrobe', label: 'Wardrobe', icon: '👗' },
  { id: 'saved', label: 'Saved', icon: '❤️' },
]

export default function App() {
  const { theme, toggleTheme, toast } = useStore()
  const [tab, setTab] = useState('discover')

  const go = id => {
    setTab(id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          Style<span className="now">Now</span><span className="spark">✦</span>
        </div>
        <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </header>

      <main>
        {tab === 'discover' && <Discover go={go} />}
        {tab === 'builder' && <Builder />}
        {tab === 'quiz' && <Quiz go={go} />}
        {tab === 'wardrobe' && <Wardrobe />}
        {tab === 'saved' && <Saved go={go} />}
      </main>

      <nav className="nav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => go(t.id)}
          >
            <span className="ico">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
