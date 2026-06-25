import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildDesignTokenThemeCss } from '@open-pencil/compiler/theme-css'
import type { Color } from '@open-pencil/core/types'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function addThemeVariables() {
  const graph = makeSceneGraph()
  graph.addCollection({
    id: 'col-theme',
    name: 'Brand Theme',
    modes: [
      { modeId: 'light', name: 'Light' },
      { modeId: 'dark', name: 'Dark' }
    ],
    defaultModeId: 'light',
    variableIds: ['var-primary', 'var-radius', 'var-alias']
  })
  graph.addVariable({
    id: 'var-primary',
    name: 'color/primary',
    type: 'COLOR',
    collectionId: 'col-theme',
    valuesByMode: {
      light: { r: 0.2, g: 0.4, b: 0.8, a: 1 } satisfies Color,
      dark: { r: 0.8, g: 0.9, b: 1, a: 1 } satisfies Color
    },
    description: '',
    hiddenFromPublishing: false
  })
  graph.addVariable({
    id: 'var-radius',
    name: 'radius/base',
    type: 'FLOAT',
    collectionId: 'col-theme',
    valuesByMode: { light: 8, dark: 10 },
    description: '',
    hiddenFromPublishing: false
  })
  graph.addVariable({
    id: 'var-alias',
    name: 'color/accent',
    type: 'COLOR',
    collectionId: 'col-theme',
    valuesByMode: {
      light: { aliasId: 'var-primary' },
      dark: { aliasId: 'var-primary' }
    },
    description: '',
    hiddenFromPublishing: false
  })
  return graph
}

describe('Phase 5 §5 design token theme CSS', () => {
  test('builds :root and dark mode CSS variables from graph variables', () => {
    const css = buildDesignTokenThemeCss(addThemeVariables())

    expect(css).toContain('/* OpenPencil design tokens */')
    expect(css).toContain(':root {')
    expect(css).toContain('--op-brand-theme-color-primary: #3366CC;')
    expect(css).toContain('--op-brand-theme-color-accent: #3366CC;')
    expect(css).toContain('--op-brand-theme-radius-base: 8;')
    expect(css).toContain(':root[data-theme="dark"], .dark {')
    expect(css).toContain('--op-brand-theme-color-primary: #CCE6FF;')
    expect(css).toContain('--op-brand-theme-radius-base: 10;')
  })

  test('returns empty css when a graph has no variables', () => {
    expect(buildDesignTokenThemeCss(makeSceneGraph())).toBe('')
  })

  test('compile injects design token theme css into index.css', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'theme-demo', devMode: false })
    })

    const css = out.files.get('src/index.css') as string
    expect(css).toContain('@import "tailwindcss"')
    expect(css).toContain('--op-brand-theme-color-primary: #3366CC;')
    expect(css).toContain(':root[data-theme="dark"], .dark')

    const main = out.files.get('src/main.tsx') as string
    expect(main).toContain(
      "import { LowcodeThemeProvider, LowcodeThemeSwitch } from './_lowcode_theme'"
    )
    expect(main).toContain('<LowcodeThemeProvider>')
    expect(main).toContain('<LowcodeThemeSwitch />')
    expect(out.files.has('src/_lowcode_theme.tsx')).toBe(true)
    const runtime = out.files.get('src/_lowcode_theme.tsx') as string
    expect(runtime).toContain('export function useTheme()')
    expect(runtime).toContain('export function LowcodeThemeSwitch()')
    expect(runtime).toContain('aria-pressed={theme === value}')
    expect(runtime).toContain("data.source !== 'op-lowcode-editor' || data.type !== 'theme'")
    expect(runtime).toContain("document.documentElement.classList.toggle('dark'")
  })

  test('compile does not emit theme runtime when no theme css exists', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'plain-demo' })
    })

    expect(out.files.has('src/_lowcode_theme.tsx')).toBe(false)
    expect(out.files.get('src/main.tsx') as string).not.toContain('LowcodeThemeProvider')
  })

  test('explicit themeCss appends after generated design token css', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({
        packageName: 'theme-demo',
        themeCss: ':root { --custom-token: 1; }\n'
      })
    })

    const css = out.files.get('src/index.css') as string
    expect(css.indexOf('--op-brand-theme-color-primary')).toBeLessThan(
      css.indexOf('--custom-token')
    )
  })
})
