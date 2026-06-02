import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { SceneGraph } from '@open-pencil/core/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §9 — emitted-artifact i18n runtime (react-intl). With
 * `options.i18n` on, every visible design string (TEXT content, BUTTON text,
 * SELECT/RADIO option labels) is externalized into `src/locales/en.json` under
 * a content-hash id and rendered via `<FormattedMessage>`; the app is wrapped in
 * `<I18nProvider>` and `react-intl` is added to package.json. Off → output is
 * byte-identical to a non-i18n compile.
 */
function pageWithText(): { graph: SceneGraph; pageId: string } {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const frame = graph.createNode('FRAME', pageId, { width: 200, height: 100, layoutMode: 'VERTICAL' })
  graph.createNode('TEXT', frame.id, { text: 'Hello world', width: 120, height: 20 })
  return { graph, pageId }
}

function compileI18n(graph: SceneGraph, pageId: string, i18n: boolean) {
  return compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'comp', i18n }) })
}

describe('compile — emitted i18n runtime (Phase 3 §9)', () => {
  test('i18n off (default): no FormattedMessage / locales / react-intl dep', () => {
    const { graph, pageId } = pageWithText()
    const out = compileI18n(graph, pageId, false)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('Hello world')
    expect(app).not.toContain('FormattedMessage')
    expect(out.files.has('src/locales/en.json')).toBe(false)
    expect(out.files.has('src/_lowcode_i18n.tsx')).toBe(false)
    expect(out.files.get('package.json') as string).not.toContain('react-intl')
    expect(out.files.get('src/main.tsx') as string).not.toContain('I18nProvider')
  })

  test('i18n on: text → FormattedMessage + catalog + provider + dep', () => {
    const { graph, pageId } = pageWithText()
    const out = compileI18n(graph, pageId, true)
    const app = out.files.get('src/App.tsx') as string
    // FormattedMessage with a content-hash id + the source as defaultMessage
    expect(app).toMatch(/<FormattedMessage id="m[a-z0-9]+" defaultMessage=\{"Hello world"\} \/>/)
    expect(app).toContain("import { FormattedMessage } from 'react-intl'")
    expect(app).not.toContain('>Hello world<') // literal no longer inlined

    // catalog carries the source string
    const catalog = JSON.parse(out.files.get('src/locales/en.json') as string) as Record<string, string>
    expect(Object.values(catalog)).toContain('Hello world')

    // runtime + provider + dep
    const runtime = out.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).toContain('IntlProvider')
    expect(runtime).toContain('export function I18nProvider')
    const main = out.files.get('src/main.tsx') as string
    expect(main).toContain("import { I18nProvider } from './_lowcode_i18n'")
    expect(main).toContain('<I18nProvider>')
    expect(out.files.get('package.json') as string).toContain('"react-intl"')
  })

  test('identical strings collapse onto one catalog entry (content-hash dedupe)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, { width: 200, height: 100, layoutMode: 'VERTICAL' })
    graph.createNode('TEXT', frame.id, { text: 'Save', width: 80, height: 20 })
    graph.createNode('TEXT', frame.id, { text: 'Save', width: 80, height: 20 })
    graph.createNode('TEXT', frame.id, { text: 'Cancel', width: 80, height: 20 })

    const out = compileI18n(graph, pageId, true)
    const catalog = JSON.parse(out.files.get('src/locales/en.json') as string) as Record<string, string>
    // two "Save" + one "Cancel" → 2 entries
    expect(Object.keys(catalog).length).toBe(2)
    expect(Object.values(catalog).filter((v) => v === 'Save').length).toBe(1)
  })

  test('BUTTON text and SELECT option labels are externalized', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, {
      width: 100,
      height: 32,
      interactiveProps: { text: 'Submit' }
    })
    graph.createNode('SELECT', pageId, {
      width: 100,
      height: 32,
      interactiveProps: { options: ['Red', 'Green'] }
    })

    const out = compileI18n(graph, pageId, true)
    const catalog = JSON.parse(out.files.get('src/locales/en.json') as string) as Record<string, string>
    const values = Object.values(catalog)
    expect(values).toContain('Submit')
    expect(values).toContain('Red')
    expect(values).toContain('Green')
    const app = out.files.get('src/App.tsx') as string
    // the option's value= stays the literal form value (not translated)
    expect(app).toContain('value="Red"')
  })

  test('component-body text gets a FormattedMessage import in the component file + a catalog entry', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Card',
      width: 120,
      height: 40,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', master.id, { text: 'Badge', width: 100, height: 20 })
    graph.createInstance(master.id, pageId)

    const out = compileI18n(graph, pageId, true)
    const comp = out.files.get('src/components/Card.tsx') as string
    expect(comp).toContain("import { FormattedMessage } from 'react-intl'")
    expect(comp).toMatch(/<FormattedMessage id="m[a-z0-9]+" defaultMessage=\{"Badge"\} \/>/)
    const catalog = JSON.parse(out.files.get('src/locales/en.json') as string) as Record<string, string>
    expect(Object.values(catalog)).toContain('Badge')
  })
})

/**
 * Phase 3 §9 v2 — target locales + LocaleSwitcher. `options.locales` declares
 * extra languages: each gets a `src/locales/<code>.json` stub (pre-filled with
 * the source strings) registered in the runtime, plus a `<LocaleSwitcher>`.
 */
function compileLocales(locales: string[]) {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const frame = graph.createNode('FRAME', pageId, { width: 200, height: 100, layoutMode: 'VERTICAL' })
  graph.createNode('TEXT', frame.id, { text: 'Hello', width: 80, height: 20 })
  return compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'comp', i18n: true, locales }) })
}

describe('compile — i18n target locales + switcher (Phase 3 §9 v2)', () => {
  test('target locales emit pre-filled stubs + a registered runtime + a switcher', () => {
    const out = compileLocales(['fr', 'es'])
    // pre-filled stubs (same content as the source catalog)
    const en = out.files.get('src/locales/en.json') as string
    expect(out.files.get('src/locales/fr.json')).toBe(en)
    expect(out.files.get('src/locales/es.json')).toBe(en)
    // runtime imports + registers all three
    const runtime = out.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).toContain("import en from './locales/en.json'")
    expect(runtime).toContain("import fr from './locales/fr.json'")
    expect(runtime).toContain("import es from './locales/es.json'")
    expect(runtime).toContain('{ en, fr, es }')
    // switcher
    const switcher = out.files.get('src/components/LocaleSwitcher.tsx') as string
    expect(switcher).toContain("import { useLocale } from '../_lowcode_i18n'")
    expect(switcher).toContain('export function LocaleSwitcher()')
    expect(switcher).toContain('onChange={(e) => setLocale(e.target.value)}')
  })

  test('no target locales → no switcher, single-locale runtime (v1 byte-identical)', () => {
    const out = compileLocales([])
    expect(out.files.has('src/components/LocaleSwitcher.tsx')).toBe(false)
    expect(out.files.has('src/locales/fr.json')).toBe(false)
    const runtime = out.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).toContain('{ en }')
  })

  test('duplicates, the source locale, and empties are dropped', () => {
    const out = compileLocales(['en', 'fr', 'fr', ''])
    // only one fr stub; en is the source (not a re-emitted target); no '' file
    expect(out.files.has('src/locales/fr.json')).toBe(true)
    expect(out.files.has('src/locales/.json')).toBe(false)
    // CATALOGS registers en + fr exactly once each (no duplicate fr, no empty)
    const runtime = out.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).toContain('{ en, fr }')
  })

  test('a locale code with non-identifier chars sanitizes its import binding', () => {
    const out = compileLocales(['zh-CN'])
    expect(out.files.has('src/locales/zh-CN.json')).toBe(true)
    const runtime = out.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).toContain("import zhCN from './locales/zh-CN.json'")
    expect(runtime).toContain('{ en, "zh-CN": zhCN }')
  })
})
