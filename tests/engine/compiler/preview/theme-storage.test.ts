import { describe, expect, test } from 'bun:test'

import { buildLowcodeThemeRuntime } from '#compiler/adapters/react/lowcode/theme'

type Theme = 'light' | 'dark'
interface ThemeValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}
interface ProviderElement {
  value: ThemeValue
}

/** Run the emitted TSX with scoped host/hook doubles, without replacing global modules. */
function themeRuntime(storage: Pick<Storage, 'getItem' | 'setItem'> | null, dark = true) {
  let state: Theme | undefined
  const root = {
    dataset: { theme: '' },
    style: { colorScheme: '' },
    classList: { toggle: () => false }
  }
  const host = {
    get localStorage() {
      if (!storage) throw new DOMException('Opaque preview origin', 'SecurityError')
      return storage
    },
    matchMedia: () => ({ matches: dark }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }
  const source = buildLowcodeThemeRuntime()
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '')
  const javascript = new Bun.Transpiler({
    loader: 'tsx',
    tsconfig: JSON.stringify({ compilerOptions: { jsx: 'react', jsxFactory: 'element' } })
  }).transformSync(source)
  const create = new Function(
    'window',
    'document',
    'createContext',
    'useCallback',
    'useContext',
    'useEffect',
    'useMemo',
    'useState',
    'element',
    `${javascript}\nreturn LowcodeThemeProvider`
  )
  const provider = create(
    host,
    { documentElement: root },
    () => ({ Provider: 'theme' }),
    <T>(callback: T) => callback,
    () => undefined,
    (effect: () => unknown) => {
      effect()
    },
    <T>(factory: () => T) => factory(),
    (initial: () => Theme) => {
      state ??= initial()
      return [
        state,
        (next: Theme) => {
          state = next
        }
      ]
    },
    (_type: unknown, props: ProviderElement) => props
  ) as (props: { children: null }) => ProviderElement
  return { root, render: () => provider({ children: null }).value }
}

describe('generated React theme runtime storage', () => {
  test.each(['getter', 'getItem'] as const)(
    'keeps initialization and theme changes usable when %s throws',
    (failure) => {
      const runtime = themeRuntime(
        failure === 'getter'
          ? null
          : {
              getItem: () => {
                throw new DOMException('Storage denied', 'SecurityError')
              },
              setItem: () => {
                throw new DOMException('Storage denied', 'SecurityError')
              }
            }
      )
      const initial = runtime.render()
      expect(initial.theme).toBe('dark')
      expect(runtime.root.dataset.theme).toBe('dark')
      expect(() => initial.setTheme('light')).not.toThrow()
      expect(runtime.render().theme).toBe('light')
      expect(runtime.root.dataset.theme).toBe('light')
      expect(runtime.root.style.colorScheme).toBe('light')
    }
  )

  test('keeps an in-memory theme change when storage writes fail', () => {
    const runtime = themeRuntime({
      getItem: () => 'light',
      setItem: () => {
        throw new DOMException('Full', 'QuotaExceededError')
      }
    })
    const initial = runtime.render()
    expect(initial.theme).toBe('light')
    expect(() => initial.setTheme('dark')).not.toThrow()
    expect(runtime.render().theme).toBe('dark')
    expect(runtime.root.dataset.theme).toBe('dark')
  })

  test('still reads valid persisted preferences and writes the explicit choice', () => {
    const writes: Array<[string, string]> = []
    const runtime = themeRuntime(
      {
        getItem: () => 'dark',
        setItem: (key, value) => {
          writes.push([key, value])
        }
      },
      false
    )
    const initial = runtime.render()
    expect(initial.theme).toBe('dark')
    initial.setTheme('light')
    expect(runtime.render().theme).toBe('light')
    expect(writes).toEqual([['open-pencil:lowcode-theme', 'light']])
  })
})
