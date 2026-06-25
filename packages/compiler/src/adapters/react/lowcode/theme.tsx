export function buildLowcodeThemeRuntime(): string {
  return `import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type LowcodeTheme = 'light' | 'dark'

const STORAGE_KEY = 'open-pencil:lowcode-theme'
const ThemeContext = createContext<{
  theme: LowcodeTheme
  setTheme: (theme: LowcodeTheme) => void
}>({ theme: 'light', setTheme: () => undefined })

function isTheme(value: unknown): value is LowcodeTheme {
  return value === 'light' || value === 'dark'
}

function systemTheme(): LowcodeTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readInitialTheme(): LowcodeTheme {
  if (typeof window === 'undefined') return 'light'
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return isTheme(saved) ? saved : systemTheme()
}

function applyTheme(theme: LowcodeTheme): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

export function LowcodeThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<LowcodeTheme>(readInitialTheme)

  const setTheme = useCallback((next: LowcodeTheme) => {
    setThemeState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      const data = event.data as { source?: unknown; type?: unknown; theme?: unknown } | null
      if (!data || data.source !== 'op-lowcode-editor' || data.type !== 'theme') return
      if (isTheme(data.theme)) setTheme(data.theme)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [setTheme])

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
`
}
