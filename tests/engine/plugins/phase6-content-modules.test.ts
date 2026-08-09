import { describe, expect, test } from 'bun:test'

import {
  ACCORDION_MODULE_DEFINITION,
  ACCORDION_MODULE_LIMITS,
  ACCORDION_MODULE_TYPE,
  ACCORDION_PLUGIN_ID,
  createAccordionModuleInstance,
  resolveAccordionModule
} from '#core/plugins/accordion'
import {
  AUDIO_PLAYER_MODULE_DEFINITION,
  AUDIO_PLAYER_MODULE_TYPE,
  AUDIO_PLAYER_PLUGIN_ID,
  createAudioPlayerModuleInstance,
  resolveAudioPlayerModule
} from '#core/plugins/audio-player'
import {
  CODE_BLOCK_MODULE_DEFINITION,
  CODE_BLOCK_MODULE_LIMITS,
  CODE_BLOCK_MODULE_TYPE,
  CODE_BLOCK_PLUGIN_ID,
  createCodeBlockModuleInstance,
  resolveCodeBlockModule
} from '#core/plugins/code-block'
import {
  MARKDOWN_MODULE_DEFINITION,
  MARKDOWN_MODULE_LIMITS,
  MARKDOWN_MODULE_TYPE,
  MARKDOWN_PLUGIN_ID,
  createMarkdownModuleInstance,
  resolveMarkdownModule
} from '#core/plugins/markdown'
import {
  PDF_VIEWER_MODULE_DEFINITION,
  PDF_VIEWER_MODULE_TYPE,
  PDF_VIEWER_PLUGIN_ID,
  createPdfViewerModuleInstance,
  resolvePdfViewerModule
} from '#core/plugins/pdf-viewer'
import {
  QR_BARCODE_MODULE_DEFINITION,
  QR_BARCODE_MODULE_LIMITS,
  QR_BARCODE_MODULE_TYPE,
  QR_BARCODE_PLUGIN_ID,
  createQrBarcodeModuleInstance,
  resolveQrBarcodeModule
} from '#core/plugins/qr-barcode'
import {
  TABS_MODULE_DEFINITION,
  TABS_MODULE_LIMITS,
  TABS_MODULE_TYPE,
  TABS_PLUGIN_ID,
  createTabsModuleInstance,
  resolveTabsModule
} from '#core/plugins/tabs'

const MODULES = [
  {
    pluginId: TABS_PLUGIN_ID,
    moduleType: TABS_MODULE_TYPE,
    definition: TABS_MODULE_DEFINITION,
    create: createTabsModuleInstance,
    resolve: resolveTabsModule,
    size: { width: 520, height: 300 }
  },
  {
    pluginId: ACCORDION_PLUGIN_ID,
    moduleType: ACCORDION_MODULE_TYPE,
    definition: ACCORDION_MODULE_DEFINITION,
    create: createAccordionModuleInstance,
    resolve: resolveAccordionModule,
    size: { width: 520, height: 360 }
  },
  {
    pluginId: QR_BARCODE_PLUGIN_ID,
    moduleType: QR_BARCODE_MODULE_TYPE,
    definition: QR_BARCODE_MODULE_DEFINITION,
    create: createQrBarcodeModuleInstance,
    resolve: resolveQrBarcodeModule,
    size: { width: 320, height: 320 }
  },
  {
    pluginId: MARKDOWN_PLUGIN_ID,
    moduleType: MARKDOWN_MODULE_TYPE,
    definition: MARKDOWN_MODULE_DEFINITION,
    create: createMarkdownModuleInstance,
    resolve: resolveMarkdownModule,
    size: { width: 640, height: 480 }
  },
  {
    pluginId: CODE_BLOCK_PLUGIN_ID,
    moduleType: CODE_BLOCK_MODULE_TYPE,
    definition: CODE_BLOCK_MODULE_DEFINITION,
    create: createCodeBlockModuleInstance,
    resolve: resolveCodeBlockModule,
    size: { width: 640, height: 360 }
  },
  {
    pluginId: PDF_VIEWER_PLUGIN_ID,
    moduleType: PDF_VIEWER_MODULE_TYPE,
    definition: PDF_VIEWER_MODULE_DEFINITION,
    create: createPdfViewerModuleInstance,
    resolve: resolvePdfViewerModule,
    size: { width: 640, height: 720 }
  },
  {
    pluginId: AUDIO_PLAYER_PLUGIN_ID,
    moduleType: AUDIO_PLAYER_MODULE_TYPE,
    definition: AUDIO_PLAYER_MODULE_DEFINITION,
    create: createAudioPlayerModuleInstance,
    resolve: resolveAudioPlayerModule,
    size: { width: 520, height: 120 }
  }
] as const

function sparseArray<T>(length: number): T[] {
  const value: T[] = []
  value.length = length
  return value
}

describe('phase 6 bounded content module contracts', () => {
  test('exposes seven stable independent identities with translated metadata hooks', () => {
    for (const module of MODULES) {
      const instance = module.create()
      const resolved = module.resolve(instance)
      expect(instance.pluginId).toBe(module.pluginId)
      expect(instance.moduleType).toBe(module.moduleType)
      expect(module.definition.defaultSize).toEqual(module.size)
      expect(module.definition.i18nNameKey?.startsWith('lowcodeModule')).toBe(true)
      expect(module.definition.i18nDescriptionKey?.startsWith('lowcodeModule')).toBe(true)
      expect(
        module.definition.fields.every((field) => field.i18nLabelKey?.startsWith('lowcodeModule'))
      ).toBe(true)
      expect(resolved?.ok).toBe(true)
      expect(module.resolve({ ...instance, configVersion: 2 })).toEqual({
        ok: false,
        reason: expect.stringContaining('unsupported')
      })
      expect(module.resolve({ ...instance, pluginId: 'unknown.plugin' })).toBeNull()
    }
  })

  test('tabs enforce exact item shape, unique references, text budgets, and defensive copies', () => {
    const tabs = [
      { id: 'one', label: 'One', content: 'First' },
      { id: 'two', label: 'Two', content: 'Second' }
    ]
    const resolved = resolveTabsModule(createTabsModuleInstance({ tabs, initialTabId: 'two' }))
    tabs[1].content = 'Changed'
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected tabs module to resolve')
    expect(resolved.config.tabs[1].content).toBe('Second')
    expect(() => createTabsModuleInstance({ tabs: sparseArray(2) })).toThrow('tab object')
    expect(() =>
      createTabsModuleInstance({
        tabs: [tabs[0], { ...tabs[1], id: 'one' }],
        initialTabId: 'one'
      })
    ).toThrow('must be unique')
    expect(() => createTabsModuleInstance({ initialTabId: 'missing' })).toThrow('existing tab')
    expect(() =>
      createTabsModuleInstance({
        tabs: Array.from({ length: TABS_MODULE_LIMITS.tabsMax + 1 }, (_, index) => ({
          id: `tab${index}`,
          label: 'Tab',
          content: ''
        }))
      })
    ).toThrow(`to ${TABS_MODULE_LIMITS.tabsMax}`)
    expect(() => createTabsModuleInstance({ accentColor: 'blue' })).toThrow('#RRGGBB')
    expect(() => createTabsModuleInstance({ extra: true })).toThrow('contain exactly')
  })

  test('accordion validates open state cardinality, references, sparse arrays, and aggregate bounds', () => {
    expect(() => createAccordionModuleInstance({ initialOpenIds: ['first', 'second'] })).toThrow(
      'at most one'
    )
    expect(() =>
      createAccordionModuleInstance({ allowMultiple: true, initialOpenIds: ['first', 'first'] })
    ).toThrow('must be unique')
    expect(() => createAccordionModuleInstance({ initialOpenIds: ['missing'] })).toThrow(
      'existing item'
    )
    expect(() => createAccordionModuleInstance({ items: sparseArray(1) })).toThrow(
      'accordion item object'
    )
    expect(() =>
      createAccordionModuleInstance({
        items: Array.from({ length: 6 }, (_, index) => ({
          id: `item${index}`,
          title: 'T',
          content: 'x'.repeat(ACCORDION_MODULE_LIMITS.content)
        })),
        initialOpenIds: []
      })
    ).toThrow(`not exceed ${ACCORDION_MODULE_LIMITS.totalText}`)
  })

  test('QR and Code 128 payloads remain bounded inert data', () => {
    expect(
      resolveQrBarcodeModule(
        createQrBarcodeModuleInstance({ format: 'code128', value: 'SKU-123:BLUE' })
      )?.ok
    ).toBe(true)
    expect(() => createQrBarcodeModuleInstance({ format: 'code128', value: '商品' })).toThrow(
      'printable ASCII'
    )
    expect(() => createQrBarcodeModuleInstance({ value: 'bad\nvalue' })).toThrow(
      'control characters'
    )
    expect(() =>
      createQrBarcodeModuleInstance({
        format: 'code128',
        value: 'x'.repeat(QR_BARCODE_MODULE_LIMITS.barcodeValue + 1)
      })
    ).toThrow(`to ${QR_BARCODE_MODULE_LIMITS.barcodeValue}`)
    expect(() => createQrBarcodeModuleInstance({ quietZone: 1.5 })).toThrow('integer')
  })

  test('Markdown and code source are character and encoded-byte bounded', () => {
    expect(() =>
      createMarkdownModuleInstance({ source: 'x'.repeat(MARKDOWN_MODULE_LIMITS.source + 1) })
    ).toThrow(`to ${MARKDOWN_MODULE_LIMITS.source}`)
    expect(() => createMarkdownModuleInstance({ source: '界'.repeat(40_000) })).toThrow(
      `not exceed ${MARKDOWN_MODULE_LIMITS.configBytes} encoded bytes`
    )
    expect(() => createMarkdownModuleInstance({ flavor: 'unsafe-html' })).toThrow(
      'commonmark or gfm'
    )
    expect(() =>
      createCodeBlockModuleInstance({ code: 'x'.repeat(CODE_BLOCK_MODULE_LIMITS.code + 1) })
    ).toThrow(`to ${CODE_BLOCK_MODULE_LIMITS.code}`)
    expect(() => createCodeBlockModuleInstance({ code: '界'.repeat(40_000) })).toThrow(
      `not exceed ${CODE_BLOCK_MODULE_LIMITS.configBytes} encoded bytes`
    )
    expect(() => createCodeBlockModuleInstance({ tabSize: 3 })).toThrow('2, 4, or 8')
    expect(() => createCodeBlockModuleInstance({ language: 'brainfuck' })).toThrow(
      'supported language'
    )
  })

  test('PDF and audio sources accept only empty, canonical HTTPS, or safe canonical root paths', () => {
    const accepted = [
      '',
      '/assets/manual.pdf?lang=zh-CN',
      'https://cdn.example.com/manual.pdf?version=1'
    ]
    for (const source of accepted) {
      expect(resolvePdfViewerModule(createPdfViewerModuleInstance({ sourceUrl: source }))?.ok).toBe(
        true
      )
      expect(resolveAudioPlayerModule(createAudioPlayerModuleInstance({ src: source }))?.ok).toBe(
        true
      )
    }

    const rejected = [
      '//evil.example/file.pdf',
      '/assets//file.pdf',
      '/assets\\file.pdf',
      '/assets/../secret.pdf',
      '/%2e%2e/secret.pdf',
      '/%252e%252e/secret.pdf',
      '/assets/%2Fsecret.pdf',
      'http://cdn.example.com/file.pdf',
      'https://user@cdn.example.com/file.pdf',
      'https://cdn.example.com:444/file.pdf',
      'https://cdn.example.com/file.pdf#page=2'
    ]
    for (const source of rejected) {
      expect(() => createPdfViewerModuleInstance({ sourceUrl: source })).toThrow()
      expect(() => createAudioPlayerModuleInstance({ src: source })).toThrow()
    }
    expect(() => createPdfViewerModuleInstance({ initialPage: 4, pageCountHint: 3 })).toThrow(
      'must not exceed'
    )
    expect(() => createAudioPlayerModuleInstance({ autoplay: true, muted: false })).toThrow(
      'requires muted'
    )
  })
})
