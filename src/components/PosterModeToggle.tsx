import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'qikpoll-poster-mode'

type ThemeMode = 'light' | 'dark'

function applyThemeMode(mode: ThemeMode) {
  document.body.dataset.themeMode = mode
}

export default function PosterModeToggle() {
  const [mode, setMode] = useState<ThemeMode>('light')

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') {
      setMode(stored)
      applyThemeMode(stored)
      return
    }

    applyThemeMode('light')
  }, [])

  useEffect(() => {
    applyThemeMode(mode)
    window.localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  return (
    <div className="mode-toggle" role="radiogroup" aria-label="Color mode">
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'light'}
        className={`mode-toggle-btn ${mode === 'light' ? 'is-active' : ''}`}
        onClick={() => setMode('light')}
      >
        <Sun size={16} /> Light
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'dark'}
        className={`mode-toggle-btn ${mode === 'dark' ? 'is-active' : ''}`}
        onClick={() => setMode('dark')}
      >
        <Moon size={16} /> Dark
      </button>
    </div>
  )
}
