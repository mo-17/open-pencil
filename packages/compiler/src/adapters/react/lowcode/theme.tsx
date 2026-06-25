export function buildLowcodeThemeRuntime(): string {
  return `import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'

export type LowcodeTheme = 'light' | 'dark'
export type LowcodeThemeSwitchPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const STORAGE_KEY = 'open-pencil:lowcode-theme'
const switcherStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 50,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0.25rem',
  border: '1px solid color-mix(in srgb, CanvasText 16%, transparent)',
  borderRadius: '999px',
  background: 'Canvas',
  color: 'CanvasText',
  boxShadow: '0 10px 30px color-mix(in srgb, CanvasText 14%, transparent)',
  colorScheme: 'light dark'
}
const switcherPositionStyles: Record<LowcodeThemeSwitchPosition, CSSProperties> = {
  'top-left': { top: '1rem', left: '1rem' },
  'top-right': { top: '1rem', right: '1rem' },
  'bottom-left': { bottom: '1rem', left: '1rem' },
  'bottom-right': { right: '1rem', bottom: '1rem' }
}
const buttonStyle: CSSProperties = {
  border: 0,
  borderRadius: '999px',
  padding: '0.375rem 0.625rem',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: '600 0.75rem/1 system-ui, sans-serif'
}
const activeButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: 'CanvasText',
  color: 'Canvas'
}
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

export function LowcodeThemeSwitch({
  position = 'bottom-right'
}: {
  position?: LowcodeThemeSwitchPosition
}) {
  const { theme, setTheme } = useTheme()
  return (
    <div aria-label="Theme" style={{ ...switcherStyle, ...switcherPositionStyles[position] }}>
      {(['light', 'dark'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          style={theme === value ? activeButtonStyle : buttonStyle}
        >
          {value === 'light' ? 'Light' : 'Dark'}
        </button>
      ))}
    </div>
  )
}
`
}
