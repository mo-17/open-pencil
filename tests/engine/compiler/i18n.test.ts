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

/**
 * Phase 3 §9 v8 — configurable source locale. `CompilerOptions.sourceLocale`
 * selects the language the canvas strings are authored in; it drives the source
 * catalog filename, the runtime default locale, and the target-exclusion seed.
 */
function compileWithSource(sourceLocale: string | undefined, locales: string[] = []) {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const frame = graph.createNode('FRAME', pageId, { width: 200, height: 100, layoutMode: 'VERTICAL' })
  graph.createNode('TEXT', frame.id, { text: 'Hello', width: 80, height: 20 })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'comp', i18n: true, sourceLocale, locales })
  })
}

describe('compile — configurable source locale (Phase 3 §9 v8)', () => {
  test('sourceLocale changes the source catalog filename + runtime default locale', () => {
    const out = compileWithSource('zh')
    expect(out.files.has('src/locales/zh.json')).toBe(true)
    expect(out.files.has('src/locales/en.json')).toBe(false)
    const runtime = out.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).toContain("import zh from './locales/zh.json'")
    expect(runtime).toContain('export const SOURCE_LOCALE = "zh"')
    expect(runtime).toContain('{ zh }')
  })

  test('a target equal to the new sourceLocale is dropped; other targets become catalogs', () => {
    const out = compileWithSource('zh', ['zh', 'en'])
    expect(out.files.has('src/locales/zh.json')).toBe(true)
    expect(out.files.has('src/locales/en.json')).toBe(true)
    const runtime = out.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).toContain('{ zh, en }')
    expect(out.files.has('src/components/LocaleSwitcher.tsx')).toBe(true)
  })

  test('unset / blank sourceLocale defaults to en (v7 byte-identical)', () => {
    const out = compileWithSource(undefined)
    expect(out.files.has('src/locales/en.json')).toBe(true)
    const runtime = out.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).toContain('export const SOURCE_LOCALE = "en"')
    const blank = compileWithSource('   ')
    const blankRuntime = blank.files.get('src/_lowcode_i18n.tsx') as string
    expect(blankRuntime).toContain('export const SOURCE_LOCALE = "en"')
  })
})

/**
 * Phase 3 §9 v11 — RTL direction. When an RTL locale (Arabic, Hebrew, …) is the
 * source or any target, the i18n runtime reflects the active locale's writing
 * direction onto `document.documentElement.dir`. LTR-only apps stay byte-identical
 * to v8 (no dir machinery emitted).
 */
describe('compile — RTL direction (Phase 3 §9 v11)', () => {
  test('an RTL source locale wires document direction', () => {
    const out = compileWithSource('ar')
    const runtime = out.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).toContain('useEffect')
    expect(runtime).toContain("document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr'")
    expect(runtime).toContain('export function isRtl(locale: string)')
    expect(runtime).toContain('const RTL_LOCALES = new Set([')
    expect(runtime).toContain('"ar"')
  })

  test('an RTL target locale (LTR source) also wires direction', () => {
    const out = compileWithSource('en', ['he'])
    const runtime = out.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).toContain('document.documentElement.dir')
    expect(runtime).toContain('useEffect')
  })

  test('LTR-only locales emit no direction machinery (v8 byte-identical)', () => {
    const ltr = compileWithSource('en', ['fr', 'de'])
    const runtime = ltr.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).not.toContain('document.documentElement.dir')
    expect(runtime).not.toContain('useEffect')
    expect(runtime).not.toContain('isRtl')
    // identical to the same compile through the v8 path (no targets) for the
    // shared header — the React import line is unchanged
    expect(runtime).toContain('import { createContext, useContext, useMemo, useState, type ReactNode }')
  })
})

/**
 * Phase 3 §9 v12 — index.html reflects the source locale on `<html lang>` (a11y /
 * SEO) and pre-sets `dir="rtl"` for an RTL source so the page doesn't flash LTR
 * before the runtime effect runs. Default ('en', LTR) stays byte-identical.
 */
describe('compile — index.html lang/dir (Phase 3 §9 v12)', () => {
  test('an RTL source locale sets lang + dir="rtl" on <html>', () => {
    const html = compileWithSource('ar').files.get('index.html') as string
    expect(html).toContain('<html lang="ar" dir="rtl">')
  })

  test('a non-en LTR source sets lang only (no dir)', () => {
    const html = compileWithSource('zh').files.get('index.html') as string
    expect(html).toContain('<html lang="zh">')
    expect(html).not.toContain('dir=')
  })

  test('the default (en) source is byte-identical (lang="en", no dir)', () => {
    const html = compileWithSource(undefined).files.get('index.html') as string
    expect(html).toContain('<html lang="en">')
    expect(html).not.toContain('dir=')
  })
})

/**
 * Phase 3 §9 v3 — attribute-string i18n. A `<FormattedMessage>` is a JSX element
 * and can't sit in an attribute, so a user-facing attribute (an INPUT's
 * `placeholder`) is emitted as `placeholder={intl.formatMessage({ id, defaultMessage })}`
 * and the enclosing function gets a `const intl = useIntl()` hook. Off, or an
 * empty placeholder, → the plain literal (byte-identical to pre-§9-v3).
 */
describe('compile — attribute-string i18n (Phase 3 §9 v3)', () => {
  function pageWithPlaceholder(placeholder: string): { graph: SceneGraph; pageId: string } {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      width: 200,
      height: 100,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('INPUT', frame.id, {
      width: 160,
      height: 32,
      interactiveProps: { placeholder }
    })
    return { graph, pageId }
  }

  test('i18n off: placeholder stays a literal, no useIntl', () => {
    const { graph, pageId } = pageWithPlaceholder('Email')
    const app = compileI18n(graph, pageId, false).files.get('src/App.tsx') as string
    expect(app).toContain('placeholder="Email"')
    expect(app).not.toContain('useIntl')
    expect(app).not.toContain('intl.formatMessage')
  })

  test('i18n on: placeholder → intl.formatMessage + useIntl import + hook + catalog', () => {
    const { graph, pageId } = pageWithPlaceholder('Email')
    const out = compileI18n(graph, pageId, true)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(
      /placeholder=\{intl\.formatMessage\(\{ id: "m[a-z0-9]+", defaultMessage: "Email" \}\)\}/
    )
    expect(app).toContain("import { useIntl } from 'react-intl'")
    expect(app).toContain('const intl = useIntl()')
    expect(app).not.toContain('placeholder="Email"') // literal no longer emitted
    // placeholder string lands in the catalog like visible text
    const catalog = JSON.parse(out.files.get('src/locales/en.json') as string) as Record<
      string,
      string
    >
    expect(Object.values(catalog)).toContain('Email')
  })

  test('placeholder + visible text → one combined react-intl import', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      width: 200,
      height: 100,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', frame.id, { text: 'Sign in', width: 120, height: 20 })
    graph.createNode('INPUT', frame.id, {
      width: 160,
      height: 32,
      interactiveProps: { placeholder: 'Email' }
    })
    const app = compileI18n(graph, pageId, true).files.get('src/App.tsx') as string
    // both symbols, one import line (not two separate react-intl imports)
    expect(app).toContain("import { FormattedMessage, useIntl } from 'react-intl'")
    expect(app.match(/from 'react-intl'/g)?.length).toBe(1)
  })

  test('a placeholder identical to visible text shares one catalog entry', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      width: 200,
      height: 100,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', frame.id, { text: 'Search', width: 120, height: 20 })
    graph.createNode('INPUT', frame.id, {
      width: 160,
      height: 32,
      interactiveProps: { placeholder: 'Search' }
    })
    const out = compileI18n(graph, pageId, true)
    const catalog = JSON.parse(out.files.get('src/locales/en.json') as string) as Record<
      string,
      string
    >
    // same content-hash → one entry shared by the text and the placeholder
    expect(Object.keys(catalog).length).toBe(1)
    expect(Object.values(catalog)).toEqual(['Search'])
  })

  test('an empty placeholder is not externalized (stays literal, off the catalog)', () => {
    const { graph, pageId } = pageWithPlaceholder('')
    const out = compileI18n(graph, pageId, true)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('placeholder=""')
    expect(app).not.toContain('intl.formatMessage')
    // no translatable string at all → no i18n runtime emitted
    expect(out.files.has('src/locales/en.json')).toBe(false)
  })

  test('a placeholder inside a component body gets useIntl in the component file', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Search Box',
      width: 160,
      height: 40,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('INPUT', master.id, {
      width: 140,
      height: 32,
      interactiveProps: { placeholder: 'Find…' }
    })
    graph.createInstance(master.id, pageId)

    const out = compileI18n(graph, pageId, true)
    const comp = out.files.get('src/components/SearchBox.tsx') as string
    expect(comp).toBeDefined()
    expect(comp).toContain("import { useIntl } from 'react-intl'")
    expect(comp).toContain('const intl = useIntl()')
    expect(comp).toMatch(/placeholder=\{intl\.formatMessage\(\{ id: "m[a-z0-9]+", defaultMessage: "Find…" \}\)\}/)
  })
})

/**
 * Phase 3 §9 v4 — ICU interpolation: a visible text literal with `${expr}`
 * placeholders is externalized as an ICU message (`Welcome, {name}!`) plus a
 * `values={{ name: <expr> }}` prop on `<FormattedMessage>`. Interpolation is
 * gated on i18n; a parse failure / unknown reference falls back to a static
 * message; no `${}` → byte-identical to §9 v1.
 */
function pageWithInterpolation(
  text: string,
  opts: { state?: string; docState?: string } = {}
): { graph: SceneGraph; pageId: string } {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  if (opts.state) {
    graph.updateNode(pageId, {
      state: [{ id: 's1', name: opts.state, type: 'string', defaultValue: '' }]
    })
  }
  if (opts.docState) {
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: opts.docState, type: 'string', defaultValue: '' }]
    })
  }
  const frame = graph.createNode('FRAME', pageId, { width: 200, height: 100, layoutMode: 'VERTICAL' })
  graph.createNode('TEXT', frame.id, { text, width: 160, height: 20 })
  return { graph, pageId }
}

describe('compile — i18n ICU interpolation (Phase 3 §9 v4)', () => {
  test('a state-interpolated text → ICU message + values prop + ICU catalog entry', () => {
    const { graph, pageId } = pageWithInterpolation('Welcome, ${userName}!', { state: 'userName' })
    const out = compileI18n(graph, pageId, true)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(
      /<FormattedMessage id="m[a-z0-9]+" defaultMessage=\{"Welcome, \{userName\}!"\} values=\{\{ userName: userName \}\} \/>/
    )
    const catalog = JSON.parse(out.files.get('src/locales/en.json') as string) as Record<string, string>
    expect(Object.values(catalog)).toContain('Welcome, {userName}!')
  })

  test('a docState interpolation registers a useDocState read', () => {
    const { graph, pageId } = pageWithInterpolation('Hi ${name}', { docState: 'name' })
    const out = compileI18n(graph, pageId, true)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('const name = useDocState("name")')
    expect(app).toContain('values={{ name: name }}')
  })

  test('multiple interpolations: member leaf name + numeric de-dup (§9 v9: same expr shares one placeholder)', () => {
    const { graph, pageId } = pageWithInterpolation('${greeting} ${greeting} for ${name}', {
      state: 'greeting',
      docState: 'name'
    })
    const out = compileI18n(graph, pageId, true)
    const app = out.files.get('src/App.tsx') as string
    // §9 v9 — the two identical `${greeting}` interpolations now collapse onto
    // ONE placeholder (was `{greeting} {greeting2}` in v4) + one values entry
    expect(app).toContain('defaultMessage={"{greeting} {greeting} for {name}"}')
    expect(app).toContain('values={{ greeting: greeting, name: name }}')
  })

  test('an unknown interpolation identifier falls back to a static literal message + warns', () => {
    const { graph, pageId } = pageWithInterpolation('Hi ${mystery}')
    const out = compileI18n(graph, pageId, true)
    const app = out.files.get('src/App.tsx') as string
    // no values prop; the raw `${mystery}` survives as the static defaultMessage
    expect(app).not.toContain('values={{')
    expect(app).toContain('defaultMessage={"Hi ${mystery}"}')
    expect(out.warnings.some((w) => w.code === 'i18n-interpolation-unknown-identifier')).toBe(true)
  })

  test('plain text without ${} stays a static §9 v1 message (no values)', () => {
    const { graph, pageId } = pageWithInterpolation('No placeholders here')
    const out = compileI18n(graph, pageId, true)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(/<FormattedMessage id="m[a-z0-9]+" defaultMessage=\{"No placeholders here"\} \/>/)
    expect(app).not.toContain('values={{')
  })

  test('i18n off: interpolation lowers to a JSX template expression (§9 v5)', () => {
    const { graph, pageId } = pageWithInterpolation('Welcome, ${userName}!', { state: 'userName' })
    const out = compileI18n(graph, pageId, false)
    const app = out.files.get('src/App.tsx') as string
    // §9 v5 — non-i18n interpolation emits `{`Welcome, ${userName}!`}` (no FormattedMessage).
    expect(app).toContain('{`Welcome, ${userName}!`}')
    expect(app).not.toContain('FormattedMessage')
  })
})

/**
 * Phase 3 §9 v6 — ICU plural / select. A visible text written with raw ICU
 * (`{count, plural, one {# item} other {# items}}`) is externalized as a
 * `<FormattedMessage>` whose `values` carries the plural/select argument (a
 * state / docState identifier). An unknown argument can't be satisfied at
 * runtime, so the message degrades to a plain literal with a warning; with i18n
 * off, plural syntax warns and stays literal (it needs react-intl).
 */
describe('compile — i18n ICU plural / select (Phase 3 §9 v6)', () => {
  test('a plural block passes its argument through values + keeps the ICU defaultMessage', () => {
    const { graph, pageId } = pageWithInterpolation(
      'You have {count, plural, one {# item} other {# items}}',
      { docState: 'count' }
    )
    const out = compileI18n(graph, pageId, true)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('const count = useDocState("count")')
    expect(app).toContain(
      'defaultMessage={"You have {count, plural, one {# item} other {# items}}"}'
    )
    expect(app).toContain('values={{ count: count }}')
    const catalog = JSON.parse(out.files.get('src/locales/en.json') as string) as Record<string, string>
    expect(Object.values(catalog)).toContain('You have {count, plural, one {# item} other {# items}}')
  })

  test('plural composes with a §9 v4 ${} interpolation in the same message', () => {
    const { graph, pageId } = pageWithInterpolation(
      '${name}: {count, plural, one {# task} other {# tasks}}',
      { state: 'name', docState: 'count' }
    )
    const out = compileI18n(graph, pageId, true)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('defaultMessage={"{name}: {count, plural, one {# task} other {# tasks}}"}')
    expect(app).toContain('values={{ name: name, count: count }}')
  })

  test('a select block is handled the same way', () => {
    const { graph, pageId } = pageWithInterpolation(
      '{gender, select, male {He} female {She} other {They}} replied',
      { docState: 'gender' }
    )
    const app = compileI18n(graph, pageId, true).files.get('src/App.tsx') as string
    expect(app).toContain('values={{ gender: gender }}')
    expect(app).toContain('{gender, select, male {He} female {She} other {They}}')
  })

  test('an unknown plural argument degrades to a literal + warns', () => {
    const { graph, pageId } = pageWithInterpolation('{qty, plural, one {#} other {#}}')
    const out = compileI18n(graph, pageId, true)
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('values={{')
    expect(out.warnings.some((w) => w.code === 'i18n-plural-unknown-identifier')).toBe(true)
  })

  test('i18n off: plural syntax warns and stays a plain literal', () => {
    const { graph, pageId } = pageWithInterpolation(
      '{count, plural, one {# item} other {# items}}',
      { docState: 'count' }
    )
    const out = compileI18n(graph, pageId, false)
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('FormattedMessage')
    expect(out.warnings.some((w) => w.code === 'text-plural-requires-i18n')).toBe(true)
  })
})

/**
 * Phase 3 §9 v9 — interpolation placeholders dedupe by expression, so a variable
 * that repeats (most notably across every branch of a plural body) maps to ONE
 * ICU placeholder + one `values` entry instead of `{name} {name2}`. The numeric
 * suffix still separates *different* expressions whose leaf names collide.
 */
describe('compile — i18n placeholder de-dup by expression (Phase 3 §9 v9)', () => {
  test('a variable repeated across plural branches collapses to one placeholder', () => {
    const { graph, pageId } = pageWithInterpolation(
      '{count, plural, one {Hi ${name}, # item} other {Hi ${name}, # items}}',
      { state: 'name', docState: 'count' }
    )
    const app = compileI18n(graph, pageId, true).files.get('src/App.tsx') as string
    expect(app).toContain(
      'defaultMessage={"{count, plural, one {Hi {name}, # item} other {Hi {name}, # items}}"}'
    )
    expect(app).toContain('values={{ name: name, count: count }}')
    expect(app).not.toContain('name2')
  })

  test('the same member expression repeated shares one placeholder', () => {
    const { graph, pageId } = pageWithInterpolation('${greeting.first} hi ${greeting.first}', {
      state: 'greeting'
    })
    const app = compileI18n(graph, pageId, true).files.get('src/App.tsx') as string
    expect(app).toContain('defaultMessage={"{first} hi {first}"}')
    expect(app).toContain('values={{ first: greeting.first }}')
  })

  test('different expressions with the same leaf name stay distinct (suffix preserved)', () => {
    const { graph, pageId } = pageWithInterpolation('${greeting.name} / ${title.name}', {
      state: 'greeting',
      docState: 'title'
    })
    const app = compileI18n(graph, pageId, true).files.get('src/App.tsx') as string
    expect(app).toContain('defaultMessage={"{name} / {name2}"}')
    expect(app).toContain('values={{ name: greeting.name, name2: title.name }}')
  })
})

/**
 * Phase 3 §9 v7 — translation authoring data model. The document carries a
 * root-level `lowcodeTranslations` catalog (locale → source message → translated
 * string). The compiler pre-fills each target `locales/<code>.json` from it,
 * falling back to the source string for missing entries; authoring a translation
 * for a locale auto-wires its catalog + runtime + switcher even when the locale
 * is not listed in `options.locales`.
 */
function compileWithTranslations(
  translations: Record<string, Record<string, string>>,
  locales: string[] = []
) {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const frame = graph.createNode('FRAME', pageId, { width: 200, height: 100, layoutMode: 'VERTICAL' })
  graph.createNode('TEXT', frame.id, { text: 'Hello', width: 80, height: 20 })
  graph.createNode('BUTTON', frame.id, { width: 100, height: 32, interactiveProps: { text: 'Submit' } })
  graph.updateNode(graph.rootId, { lowcodeTranslations: translations })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'comp', i18n: true, locales })
  })
}

describe('compile — translation authoring data model (Phase 3 §9 v7)', () => {
  test('target stub uses authored translations; missing entries fall back to source', () => {
    const out = compileWithTranslations({ fr: { Hello: 'Bonjour' } }, ['fr'])
    const en = JSON.parse(out.files.get('src/locales/en.json') as string) as Record<string, string>
    const fr = JSON.parse(out.files.get('src/locales/fr.json') as string) as Record<string, string>
    // source catalog is unchanged (always the source strings)
    expect(Object.values(en).sort()).toEqual(['Hello', 'Submit'])
    // fr: Hello → translated, Submit → falls back to source
    expect(Object.values(fr).sort()).toEqual(['Bonjour', 'Submit'])
    expect(Object.values(fr)).not.toContain('Hello')
    // same id keys across catalogs (output is keyed by content-hash id)
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort())
  })

  test('a translation-only locale (not in options.locales) is still wired', () => {
    const out = compileWithTranslations({ es: { Hello: 'Hola', Submit: 'Enviar' } }, [])
    // es stub emitted from the union of options.locales + translation locales
    expect(out.files.has('src/locales/es.json')).toBe(true)
    const es = JSON.parse(out.files.get('src/locales/es.json') as string) as Record<string, string>
    expect(Object.values(es).sort()).toEqual(['Enviar', 'Hola'])
    // registered in the runtime + a switcher is emitted
    const runtime = out.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).toContain("import es from './locales/es.json'")
    expect(runtime).toContain('{ en, es }')
    expect(out.files.has('src/components/LocaleSwitcher.tsx')).toBe(true)
  })

  test('options.locales ∪ translation locales (deduped, source excluded)', () => {
    const out = compileWithTranslations({ fr: { Hello: 'Bonjour' }, en: { Hello: 'IGNORED' } }, ['fr', 'de'])
    // fr (both), de (declared only), NOT en (source) → never re-emitted as a target
    expect(out.files.has('src/locales/fr.json')).toBe(true)
    expect(out.files.has('src/locales/de.json')).toBe(true)
    const runtime = out.files.get('src/_lowcode_i18n.tsx') as string
    expect(runtime).toContain('{ en, fr, de }')
    // de has no authored translations → all entries fall back to source
    const de = JSON.parse(out.files.get('src/locales/de.json') as string) as Record<string, string>
    expect(Object.values(de).sort()).toEqual(['Hello', 'Submit'])
  })

  test('no translations + declared locales → §9 v2 byte-identical (stub = source)', () => {
    const out = compileWithTranslations({}, ['fr'])
    const en = out.files.get('src/locales/en.json') as string
    // v2 behavior: target stub equals the source catalog verbatim
    expect(out.files.get('src/locales/fr.json')).toBe(en)
  })
})

/**
 * Phase 3 §9 v10 — build-time translation-coverage report. `_coverage.json`
 * lists, per target locale, how many of the externalized source strings have an
 * authored translation and which ones are still missing. Emitted only when ≥1
 * target locale exists.
 */
interface CoverageReport {
  sourceLocale: string
  locales: Record<string, { total: number; translated: number; missing: string[] }>
}

describe('compile — translation coverage report (Phase 3 §9 v10)', () => {
  test('reports per-locale translated counts + the missing source strings', () => {
    const out = compileWithTranslations({ fr: { Hello: 'Bonjour' } }, ['fr', 'de'])
    const report = JSON.parse(out.files.get('src/locales/_coverage.json') as string) as CoverageReport
    expect(report.sourceLocale).toBe('en')
    // two distinct externalized sources: 'Hello' and 'Submit'
    expect(report.locales.fr).toEqual({ total: 2, translated: 1, missing: ['Submit'] })
    // de has no authored translations → everything missing (sorted)
    expect(report.locales.de).toEqual({ total: 2, translated: 0, missing: ['Hello', 'Submit'] })
  })

  test('a fully-translated locale reports zero missing', () => {
    const out = compileWithTranslations({ es: { Hello: 'Hola', Submit: 'Enviar' } }, ['es'])
    const report = JSON.parse(out.files.get('src/locales/_coverage.json') as string) as CoverageReport
    expect(report.locales.es).toEqual({ total: 2, translated: 2, missing: [] })
  })

  test('a blank translation entry counts as missing', () => {
    const out = compileWithTranslations({ fr: { Hello: '   ', Submit: 'Envoyer' } }, ['fr'])
    const report = JSON.parse(out.files.get('src/locales/_coverage.json') as string) as CoverageReport
    expect(report.locales.fr).toEqual({ total: 2, translated: 1, missing: ['Hello'] })
  })

  test('no coverage file when there are no target locales', () => {
    const out = compileWithTranslations({}, [])
    expect(out.files.has('src/locales/_coverage.json')).toBe(false)
  })
})
