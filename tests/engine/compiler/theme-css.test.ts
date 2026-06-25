import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildDesignTokenThemeCss } from '@open-pencil/compiler/theme-css'
import type { Fill, Stroke } from '@open-pencil/core/scene-graph'
import type { Color } from '@open-pencil/core/types'

import { createRect, firstPageId, makeSceneGraph } from '#tests/helpers/scene'

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
    variableIds: ['var-primary', 'var-radius', 'var-alias', 'var-opacity']
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
  graph.addVariable({
    id: 'var-opacity',
    name: 'opacity/muted',
    type: 'FLOAT',
    collectionId: 'col-theme',
    valuesByMode: { light: 0.48, dark: 0.72 },
    description: '',
    hiddenFromPublishing: false
  })
  return graph
}

function solidFill(color: Color, opacity = 1): Fill {
  return { type: 'SOLID', color, opacity, visible: true }
}

function solidStroke(color: Color, opacity = 1): Stroke {
  return { color, opacity, visible: true, weight: 2, align: 'INSIDE' }
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
    expect(runtime).toContain('export function LowcodeThemeSwitch({')
    expect(runtime).toContain("position = 'bottom-right'")
    expect(runtime).toContain("'bottom-right': { right: '1rem', bottom: '1rem' }")
    expect(runtime).toContain('aria-pressed={theme === value}')
    expect(runtime).toContain("data.source !== 'op-lowcode-editor' || data.type !== 'theme'")
    expect(runtime).toContain("document.documentElement.classList.toggle('dark'")
  })

  test('themeSwitch false keeps theme provider but omits the generated app switch', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({
        packageName: 'theme-demo',
        themeSwitch: false
      })
    })

    expect(out.files.has('src/_lowcode_theme.tsx')).toBe(true)
    const main = out.files.get('src/main.tsx') as string
    expect(main).toContain("import { LowcodeThemeProvider } from './_lowcode_theme'")
    expect(main).toContain('<LowcodeThemeProvider>')
    expect(main).not.toContain('LowcodeThemeSwitch')

    const configuredOut = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({
        packageName: 'theme-demo',
        themeSwitch: { enabled: false }
      })
    })
    expect(configuredOut.files.get('src/main.tsx') as string).not.toContain('LowcodeThemeSwitch')
  })

  test('themeSwitch position config repositions the generated app switch', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({
        packageName: 'theme-demo',
        themeSwitch: { position: 'top-left' }
      })
    })

    const main = out.files.get('src/main.tsx') as string
    expect(main).toContain('<LowcodeThemeSwitch position="top-left" />')
    const runtime = out.files.get('src/_lowcode_theme.tsx') as string
    expect(runtime).toContain("'top-left': { top: '1rem', left: '1rem' }")
  })

  test('compile maps bound fill color variables to generated inline CSS vars', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)
    const rect = createRect(graph, pageId, { name: 'Token Card' })
    const text = graph.createNode('TEXT', pageId, { text: 'Token copy' })
    rect.fills = [solidFill({ r: 0.2, g: 0.4, b: 0.8, a: 1 })]
    text.fills = [solidFill({ r: 0.8, g: 0.9, b: 1, a: 1 })]
    graph.bindVariable(rect.id, 'fills/0/color', 'var-primary')
    graph.bindVariable(text.id, 'fills/0/color', 'var-alias')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'theme-demo' })
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain('style={{ backgroundColor: "var(--op-brand-theme-color-primary)" }}')
    expect(appTsx).toContain('style={{ color: "var(--op-brand-theme-color-accent)" }}')
  })

  test('compile maps bound stroke color variables to generated inline CSS vars', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)
    const rect = createRect(graph, pageId, { name: 'Token Border' })
    rect.strokes = [solidStroke({ r: 0.2, g: 0.4, b: 0.8, a: 1 })]
    graph.bindVariable(rect.id, 'strokes/0/color', 'var-primary')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'theme-demo' })
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain('style={{ borderColor: "var(--op-brand-theme-color-primary)" }}')
  })

  test('compile maps bound opacity and translucent fill variables to generated inline CSS vars', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)
    const rect = createRect(graph, pageId, { name: 'Token Scrim' })
    rect.fills = [solidFill({ r: 0.2, g: 0.4, b: 0.8, a: 1 }, 0.5)]
    graph.bindVariable(rect.id, 'fills/0/color', 'var-primary')
    graph.bindVariable(rect.id, 'opacity', 'var-opacity')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'theme-demo' })
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain(
      'backgroundColor: "color-mix(in srgb, var(--op-brand-theme-color-primary) 50%, transparent)"'
    )
    expect(appTsx).toContain('opacity: "var(--op-brand-theme-opacity-muted)"')
  })

  test('compile maps bound token colors inside multi-layer backgrounds', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)
    const rect = createRect(graph, pageId, { name: 'Token Layers' })
    rect.fills = [
      solidFill({ r: 1, g: 0, b: 0, a: 1 }),
      solidFill({ r: 0.2, g: 0.4, b: 0.8, a: 1 })
    ]
    graph.bindVariable(rect.id, 'fills/1/color', 'var-alias')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'theme-demo' })
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain(
      'backgroundImage: "linear-gradient(var(--op-brand-theme-color-accent), var(--op-brand-theme-color-accent)), linear-gradient(#FF0000, #FF0000)"'
    )
    expect(appTsx).toContain('backgroundRepeat: "no-repeat, no-repeat"')
  })

  test('component usage roots preserve bound token styles', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Token Card',
      width: 120,
      height: 40
    })
    graph.createNode('TEXT', master.id, { text: 'Card body' })
    const inst = graph.createInstance(master.id, pageId)
    if (!inst) throw new Error('instance not created')
    inst.fills = [solidFill({ r: 0.2, g: 0.4, b: 0.8, a: 1 })]
    graph.bindVariable(inst.id, 'fills/0/color', 'var-primary')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'theme-demo' })
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toMatch(
      /<TokenCard[^>]*style=\{\{ backgroundColor: "var\(--op-brand-theme-color-primary\)" \}\}/
    )
    const component = out.files.get('src/components/TokenCard.tsx') as string
    expect(component).toContain("import type { CSSProperties } from 'react'")
    expect(component).toContain('style?: CSSProperties')
    expect(component).toContain('<div className={className} style={style}>')
  })

  test('compile warns when a bound design token cannot be resolved', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)
    const rect = createRect(graph, pageId, { name: 'Missing Token' })
    rect.fills = [solidFill({ r: 0.2, g: 0.4, b: 0.8, a: 1 })]
    rect.boundVariables = { ...rect.boundVariables, 'fills/0/color': 'var-missing' }

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'theme-demo' })
    })

    const warning = out.warnings.find((item) => item.code === 'design-token-binding-missing')
    expect(warning?.nodeId).toBe(rect.id)
    expect(warning?.message).toContain('fills/0/color')
    expect(warning?.message).toContain('var-missing')
  })

  test('shadcn composed controls preserve bound fill variable styles', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)
    const toggle = graph.createNode('SWITCH', pageId, { name: 'Theme Toggle' })
    toggle.fills = [solidFill({ r: 0.2, g: 0.4, b: 0.8, a: 1 })]
    graph.bindVariable(toggle.id, 'fills/0/color', 'var-primary')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'theme-demo', uiKit: 'shadcn' })
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain('<Switch')
    expect(appTsx).toContain('style={{ backgroundColor: "var(--op-brand-theme-color-primary)" }}')
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
