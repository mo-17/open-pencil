import { describe, expect, test } from 'bun:test'

import {
  ACCORDION_REACT_MODULE_ADAPTER,
  buildOpenPencilAccordionComponent
} from '#compiler/adapters/react/modules/accordion'
import {
  AUDIO_PLAYER_REACT_MODULE_ADAPTER,
  buildOpenPencilAudioPlayerComponent
} from '#compiler/adapters/react/modules/audio-player'
import {
  buildOpenPencilCodeBlockComponent,
  CODE_BLOCK_REACT_MODULE_ADAPTER
} from '#compiler/adapters/react/modules/code-block'
import {
  buildOpenPencilMarkdownComponent,
  MARKDOWN_REACT_MODULE_ADAPTER,
  REACT_MARKDOWN_VERSION,
  REMARK_GFM_VERSION
} from '#compiler/adapters/react/modules/markdown'
import {
  buildOpenPencilPDFViewerComponent,
  PDF_VIEWER_REACT_MODULE_ADAPTER
} from '#compiler/adapters/react/modules/pdf-viewer'
import {
  buildOpenPencilQrBarcodeComponent,
  JSBARCODE_VERSION,
  QRCODE_VERSION,
  QR_BARCODE_REACT_MODULE_ADAPTER
} from '#compiler/adapters/react/modules/qr-barcode'
import {
  buildOpenPencilTabsComponent,
  TABS_REACT_MODULE_ADAPTER
} from '#compiler/adapters/react/modules/tabs'

import { compile, withDefaults } from '@open-pencil/compiler'

import { createAccordionModuleInstance } from '#core/plugins/accordion'
import { createAudioPlayerModuleInstance } from '#core/plugins/audio-player'
import { createCodeBlockModuleInstance } from '#core/plugins/code-block'
import { createMarkdownModuleInstance } from '#core/plugins/markdown'
import { createPDFViewerModuleInstance } from '#core/plugins/pdf-viewer'
import { createQrBarcodeModuleInstance } from '#core/plugins/qr-barcode'
import { createTabsModuleInstance } from '#core/plugins/tabs'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const ADAPTERS = [
  TABS_REACT_MODULE_ADAPTER,
  ACCORDION_REACT_MODULE_ADAPTER,
  QR_BARCODE_REACT_MODULE_ADAPTER,
  MARKDOWN_REACT_MODULE_ADAPTER,
  CODE_BLOCK_REACT_MODULE_ADAPTER,
  PDF_VIEWER_REACT_MODULE_ADAPTER,
  AUDIO_PLAYER_REACT_MODULE_ADAPTER
] as const

const RUNTIMES = [
  buildOpenPencilTabsComponent(),
  buildOpenPencilAccordionComponent(),
  buildOpenPencilQrBarcodeComponent(),
  buildOpenPencilMarkdownComponent(),
  buildOpenPencilCodeBlockComponent(),
  buildOpenPencilPDFViewerComponent({ devMode: true }),
  buildOpenPencilAudioPlayerComponent({ devMode: true })
] as const

describe('phase 6 React content module adapters', () => {
  test('emit collision-safe, syntactically valid generated TSX', () => {
    const transpiler = new Bun.Transpiler({ loader: 'tsx', target: 'browser' })
    for (const runtime of RUNTIMES) {
      expect(() => transpiler.transformSync(runtime)).not.toThrow()
    }

    expect(new Set(ADAPTERS.map((adapter) => adapter.runtimePath)).size).toBe(ADAPTERS.length)
    expect(new Set(ADAPTERS.map((adapter) => adapter.componentName)).size).toBe(ADAPTERS.length)
    for (const adapter of ADAPTERS) {
      expect(adapter.pluginId).toStartWith('open-pencil.')
      expect(adapter.runtimePath).toStartWith('src/__openpencil_')
    }
  })

  test('emits tabs and accordion keyboard/focus contracts', () => {
    const tabs = buildOpenPencilTabsComponent()
    expect(tabs).toContain('role="tablist"')
    expect(tabs).toContain('role="tab"')
    expect(tabs).toContain('role="tabpanel"')
    expect(tabs).toContain("event.key === 'Home'")
    expect(tabs).toContain("event.key === 'End'")
    expect(tabs).toContain("config.orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'")
    expect(tabs).toContain("config.orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'")
    expect(tabs).toContain("config.activationMode === 'manual'")
    expect(tabs).toContain('tabRefs.current[nextIndex]?.focus()')
    expect(tabs).toContain('tabIndex={tab.id === focusId ? 0 : -1}')

    const accordion = buildOpenPencilAccordionComponent()
    expect(accordion).toContain('aria-expanded={open}')
    expect(accordion).toContain('aria-controls={panelId}')
    expect(accordion).toContain("event.key === 'ArrowUp'")
    expect(accordion).toContain("event.key === 'ArrowDown'")
    expect(accordion).toContain("event.key === 'Home'")
    expect(accordion).toContain("event.key === 'End'")
    expect(accordion).toContain('buttonRefs.current[next]?.focus()')
  })

  test('keeps Markdown HTML inert and allows only canonical safe link destinations', () => {
    const runtime = buildOpenPencilMarkdownComponent()
    expect(runtime).toContain('skipHtml')
    expect(runtime).toContain('urlTransform={safeHref}')
    expect(runtime).toContain("parsed.protocol === 'https:'")
    expect(runtime).toContain("parsed.username === '' && parsed.password === ''")
    expect(runtime).toContain("if (value.startsWith('//')) return ''")
    expect(runtime).toContain("rel={newTab ? 'nofollow noopener noreferrer' : undefined}")
    expect(runtime).toContain('img: ({ alt }) => <InertImage alt={alt} />')
    expect(runtime).toContain('data-openpencil-markdown-image=""')
    expect(runtime).not.toContain('<img')
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('rehypeRaw')
    expect(runtime).not.toContain('.innerHTML')
    expect(MARKDOWN_REACT_MODULE_ADAPTER.dependencies).toEqual({
      'react-markdown': REACT_MARKDOWN_VERSION,
      'remark-gfm': REMARK_GFM_VERSION
    })
  })

  test('generates QR and Code 128 locally without a network transport', () => {
    const runtime = buildOpenPencilQrBarcodeComponent()
    expect(runtime).toContain("from 'qrcode'")
    expect(runtime).toContain("from 'jsbarcode'")
    expect(runtime).toContain('QRCode.toDataURL(config.value')
    expect(runtime).toContain('JsBarcode(barcodeRef.current, config.value')
    expect(runtime).not.toContain('fetch(')
    expect(runtime).not.toContain('XMLHttpRequest')
    expect(runtime).not.toContain('WebSocket')
    expect(runtime).not.toContain('https://')
    expect(QR_BARCODE_REACT_MODULE_ADAPTER.dependencies).toEqual({
      jsbarcode: JSBARCODE_VERSION,
      qrcode: QRCODE_VERSION
    })
  })

  test('gates development PDF/audio requests and revokes consent whenever the source changes', () => {
    const pdfDevelopment = buildOpenPencilPDFViewerComponent({ devMode: true })
    const pdfProduction = buildOpenPencilPDFViewerComponent({ devMode: false })
    expect(pdfDevelopment).toContain("const [authorizedSource, setAuthorizedSource] = useState('')")
    expect(pdfDevelopment).toContain("setAuthorizedSource('')\n  }, [config.sourceUrl])")
    expect(pdfDevelopment).toContain('authorizedSource === config.sourceUrl')
    expect(pdfDevelopment).toContain('Load PDF preview')
    expect(pdfProduction).not.toContain('Load PDF preview')
    expect(pdfProduction).not.toContain('useState')

    const audioDevelopment = buildOpenPencilAudioPlayerComponent({ devMode: true })
    const audioProduction = buildOpenPencilAudioPlayerComponent({ devMode: false })
    expect(audioDevelopment).toContain(
      "const [authorizedSource, setAuthorizedSource] = useState('')"
    )
    expect(audioDevelopment).toContain("setAuthorizedSource('')\n  }, [config.src])")
    expect(audioDevelopment).toContain('authorizedSource === config.src')
    expect(audioDevelopment).toContain('Load audio preview')
    expect(audioProduction).not.toContain('Load audio preview')
    expect(audioProduction).not.toContain('useState')
  })

  test('renders code only as text and exposes copy without an execution path', () => {
    const runtime = buildOpenPencilCodeBlockComponent()
    expect(runtime).toContain('navigator.clipboard.writeText(config.code)')
    expect(runtime).toContain('<code>{config.code}</code>')
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('.innerHTML')
    expect(runtime).not.toContain('eval(')
    expect(runtime).not.toContain('new Function')
    expect(runtime).not.toContain('setTimeout(config.code')
  })

  test('compiles all seven installed module adapters into one React source project', () => {
    const graph = makeSceneGraph('Phase 6 content adapters')
    const pageId = firstPageId(graph)
    const modules = [
      createTabsModuleInstance(),
      createAccordionModuleInstance(),
      createQrBarcodeModuleInstance(),
      createMarkdownModuleInstance({
        source: '<script>globalThis.compromised = true</script>\n\n[Safe](https://example.com/)',
        flavor: 'gfm'
      }),
      createCodeBlockModuleInstance({ code: 'globalThis.compromised = true' }),
      createPDFViewerModuleInstance({ sourceUrl: 'https://assets.example.com/document.pdf' }),
      createAudioPlayerModuleInstance({ src: 'https://assets.example.com/audio.mp3' })
    ]
    for (const [index, module] of modules.entries()) {
      graph.createNode('FRAME', pageId, {
        height: 240,
        interactiveProps: { module },
        name: `Module ${index + 1}`,
        width: 420,
        x: index * 24,
        y: index * 260
      })
    }

    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({
        devMode: true,
        packageName: 'phase6-content-adapters',
        target: 'react'
      })
    })
    const app = String(output.files.get('src/App.tsx'))
    const packageJSON = JSON.parse(String(output.files.get('package.json'))) as {
      dependencies: Record<string, string>
    }

    for (const adapter of ADAPTERS) {
      expect(output.files.has(adapter.runtimePath)).toBe(true)
      expect(app).toContain(`import ${adapter.componentName}`)
      expect(app).toContain(`<${adapter.componentName} config={{`)
    }
    expect(packageJSON.dependencies).toMatchObject({
      jsbarcode: JSBARCODE_VERSION,
      qrcode: QRCODE_VERSION,
      'react-markdown': REACT_MARKDOWN_VERSION,
      'remark-gfm': REMARK_GFM_VERSION
    })
    expect(output.warnings).toEqual([])
  })
})
