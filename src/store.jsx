import { createContext, useContext, useEffect, useState } from 'react'
import { STARTER_WARDROBE } from './data.js'

const StoreContext = createContext(null)

function usePersistedState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw !== null ? JSON.parse(raw) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // storage full or unavailable — app still works, just without persistence
    }
  }, [key, value])
  return [value, setValue]
}

export function StoreProvider({ children }) {
  const [theme, setTheme] = usePersistedState('sn-theme', 'light')
  const [savedLooks, setSavedLooks] = usePersistedState('sn-saved-looks', [])
  const [wardrobe, setWardrobe] = usePersistedState('sn-wardrobe', STARTER_WARDROBE)
  const [outfits, setOutfits] = usePersistedState('sn-outfits', [])
  const [persona, setPersona] = usePersistedState('sn-persona', null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const toggleTheme = () => setTheme(t => (t === 'light' ? 'dark' : 'light'))

  const toggleSavedLook = id =>
    setSavedLooks(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))

  const addWardrobeItem = item =>
    setWardrobe(list => [{ ...item, id: `w-${Date.now()}` }, ...list])

  const removeWardrobeItem = id => setWardrobe(list => list.filter(x => x.id !== id))

  const saveOutfit = outfit =>
    setOutfits(list => [{ ...outfit, id: `o-${Date.now()}` }, ...list])

  const removeOutfit = id => setOutfits(list => list.filter(x => x.id !== id))

  const value = {
    theme, toggleTheme,
    savedLooks, toggleSavedLook,
    wardrobe, addWardrobeItem, removeWardrobeItem,
    outfits, saveOutfit, removeOutfit,
    persona, setPersona,
    toast, setToast,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  return useContext(StoreContext)
}
