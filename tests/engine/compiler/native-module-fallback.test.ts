import { describe, expect, test } from 'bun:test'

import { compile, withDefaults, type CompilerOutput } from '@open-pencil/compiler'
import {
  createAccordionModuleInstance,
  createAudioPlayerModuleInstance,
  createCarouselModuleInstance,
  createCodeBlockModuleInstance,
  createDataGridModuleInstance,
  createLottieModuleInstance,
  createMarkdownModuleInstance,
  createPdfViewerModuleInstance,
  createQrBarcodeModuleInstance,
  createTabsModuleInstance
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const VIDEO_SOURCE = 'https://media.example.com/open-pencil/native-fallback.mp4'
const VIDEO_POSTER = 'https://media.example.com/open-pencil/native-fallback.webp'
const LOTTIE_SOURCE = 'https://media.example.com/open-pencil/native-animation.json'
const CAROUSEL_IMAGE = 'https://media.example.com/open-pencil/native-carousel.webp'
const CAROUSEL_DESTINATION = 'https://example.com/native-carousel-destination'
const GRID_PRIVATE_VALUE = 'grid-module-payload-must-not-leak'
const TABS_PRIVATE_VALUE = 'tabs-module-payload-must-not-leak'
const ACCORDION_PRIVATE_VALUE = 'accordion-module-payload-must-not-leak'
const QR_PRIVATE_VALUE = 'qr-module-payload-must-not-leak'
const MARKDOWN_PRIVATE_VALUE = 'markdown-module-payload-must-not-leak'
const CODE_PRIVATE_VALUE = 'code-module-payload-must-not-leak'
const PDF_PRIVATE_URL = 'https://media.example.com/private-native-fallback.pdf'
const AUDIO_PRIVATE_URL = 'https://media.example.com/private-native-fallback.mp3'

interface AdditionalModuleFallback {
  nodeId: string
  identity: string
  authoredText: string
}

interface NativeModuleFixture {
  output: CompilerOutput
  slideMenuNodeId: string
  tableNodeId: string
  videoNodeId: string
  additionalModules: AdditionalModuleFallback[]
}

function compileNativeModuleFixture(target: 'expo' | 'flutter'): NativeModuleFixture {
  const graph = makeSceneGraph('Native module fallback')
  const pageId = firstPageId(graph)
  const video = graph.createNode('FRAME', pageId, {
    width: 560,
    height: 320,
    interactiveProps: {
      module: {
        version: 1,
        pluginId: 'open-pencil.video',
        moduleType: 'video',
        configVersion: 1,
        config: {
          src: VIDEO_SOURCE,
          poster: VIDEO_POSTER,
          controls: true,
          autoplay: false,
          muted: true,
          loop: false,
          fit: 'cover'
        }
      }
    }
  })
  graph.createNode('TEXT', video.id, { text: 'Authored video fallback' })

  const table = graph.createNode('FRAME', pageId, {
    width: 560,
    height: 240,
    interactiveProps: {
      module: {
        version: 1,
        pluginId: 'open-pencil.table',
        moduleType: 'table',
        configVersion: 1,
        config: {
          table: { columns: ['Name'], rows: [['Native fallback']] },
          showHeader: true,
          striped: false,
          borderColor: '#CBD5E1',
          headerBackground: '#E2E8F0',
          textColor: '#0F172A',
          fontSize: 14
        }
      }
    }
  })
  graph.createNode('TEXT', table.id, { text: 'Authored table fallback' })

  const slideMenu = graph.createNode('FRAME', pageId, {
    width: 240,
    height: 64,
    interactiveProps: {
      module: {
        version: 1,
        pluginId: 'open-pencil.slide-menu',
        moduleType: 'slide-menu',
        configVersion: 1,
        config: {
          presentation: 'menu',
          direction: 'left',
          triggerLabel: 'Open navigation',
          title: 'Navigation',
          description: 'Choose a destination.',
          items: [{ label: 'Settings', href: 'https://example.com/settings' }],
          closeOnBackdrop: true,
          showCloseButton: true,
          panelSize: 320,
          panelBackground: '#FFFFFF',
          textColor: '#111827',
          overlayOpacity: 0.45
        }
      }
    }
  })
  graph.createNode('TEXT', slideMenu.id, { text: 'Authored slide menu fallback' })

  const lottie = graph.createNode('FRAME', pageId, {
    width: 360,
    height: 360,
    interactiveProps: {
      module: createLottieModuleInstance({ source: 'url', url: LOTTIE_SOURCE })
    }
  })
  graph.createNode('TEXT', lottie.id, { text: 'Authored Lottie fallback' })

  const carousel = graph.createNode('FRAME', pageId, {
    width: 640,
    height: 360,
    interactiveProps: {
      module: createCarouselModuleInstance({
        slides: [
          {
            title: 'Module-only carousel title',
            description: 'Module-only carousel description',
            imageUrl: CAROUSEL_IMAGE,
            alt: 'Carousel preview',
            href: CAROUSEL_DESTINATION
          }
        ]
      })
    }
  })
  graph.createNode('TEXT', carousel.id, { text: 'Authored carousel fallback' })

  const dataGrid = graph.createNode('FRAME', pageId, {
    width: 640,
    height: 360,
    interactiveProps: {
      module: createDataGridModuleInstance({
        data: {
          columns: [
            {
              id: 'name',
              label: 'Name',
              type: 'text',
              align: 'start',
              width: 180,
              sortable: true,
              filterable: true
            }
          ],
          rows: [{ id: 'private-row', cells: [GRID_PRIVATE_VALUE] }]
        }
      })
    }
  })
  graph.createNode('TEXT', dataGrid.id, { text: 'Authored data grid fallback' })

  function addFallback(
    identity: string,
    module: ReturnType<typeof createTabsModuleInstance>,
    authoredText: string
  ): AdditionalModuleFallback {
    const node = graph.createNode('FRAME', pageId, {
      width: 560,
      height: 240,
      interactiveProps: { module }
    })
    graph.createNode('TEXT', node.id, { text: authoredText })
    return { nodeId: node.id, identity, authoredText }
  }

  const additionalModules = [
    {
      nodeId: lottie.id,
      identity: 'open-pencil.lottie/lottie',
      authoredText: 'Authored Lottie fallback'
    },
    {
      nodeId: carousel.id,
      identity: 'open-pencil.carousel/carousel',
      authoredText: 'Authored carousel fallback'
    },
    {
      nodeId: dataGrid.id,
      identity: 'open-pencil.data-grid/data-grid',
      authoredText: 'Authored data grid fallback'
    },
    addFallback(
      'open-pencil.tabs/tabs',
      createTabsModuleInstance({
        tabs: [
          { id: 'private', label: 'Private', content: TABS_PRIVATE_VALUE },
          { id: 'public', label: 'Public', content: 'Public fallback tab' }
        ],
        initialTabId: 'private'
      }),
      'Authored tabs fallback'
    ),
    addFallback(
      'open-pencil.accordion/accordion',
      createAccordionModuleInstance({
        items: [{ id: 'private', title: 'Private', content: ACCORDION_PRIVATE_VALUE }],
        initialOpenIds: ['private']
      }),
      'Authored accordion fallback'
    ),
    addFallback(
      'open-pencil.qr-barcode/qr-barcode',
      createQrBarcodeModuleInstance({ value: QR_PRIVATE_VALUE }),
      'Authored QR fallback'
    ),
    addFallback(
      'open-pencil.markdown/markdown',
      createMarkdownModuleInstance({ source: MARKDOWN_PRIVATE_VALUE }),
      'Authored Markdown fallback'
    ),
    addFallback(
      'open-pencil.code-block/code-block',
      createCodeBlockModuleInstance({ code: CODE_PRIVATE_VALUE }),
      'Authored code fallback'
    ),
    addFallback(
      'open-pencil.pdf-viewer/pdf-viewer',
      createPdfViewerModuleInstance({ sourceUrl: PDF_PRIVATE_URL }),
      'Authored PDF fallback'
    ),
    addFallback(
      'open-pencil.audio-player/audio-player',
      createAudioPlayerModuleInstance({ src: AUDIO_PRIVATE_URL }),
      'Authored audio fallback'
    )
  ]

  return {
    output: compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({
        target,
        router: 'none',
        devMode: false,
        packageName: target === 'flutter' ? 'native_module_fallback' : 'native-module-fallback'
      })
    }),
    slideMenuNodeId: slideMenu.id,
    tableNodeId: table.id,
    videoNodeId: video.id,
    additionalModules
  }
}

function nativeSources(output: CompilerOutput, target: 'expo' | 'flutter'): string {
  const extensions = target === 'expo' ? ['.ts', '.tsx'] : ['.dart']
  return [...output.files]
    .filter(
      ([path, value]) =>
        typeof value === 'string' && extensions.some((extension) => path.endsWith(extension))
    )
    .map(([, value]) => value)
    .join('\n')
}

describe('native compiler plugin-module fallback', () => {
  test('Expo warns for reviewed modules while preserving authored static fallbacks', () => {
    const { output, slideMenuNodeId, tableNodeId, videoNodeId, additionalModules } =
      compileNativeModuleFixture('expo')
    const source = nativeSources(output, 'expo')
    const moduleWarnings = output.warnings.filter(
      (warning) => warning.code === 'expo-module-unsupported'
    )

    expect(moduleWarnings).toHaveLength(3 + additionalModules.length)
    expect(moduleWarnings).toContainEqual({
      code: 'expo-module-unsupported',
      message:
        'Expo static MVP emitted a static native fallback and dropped open-pencil.video/video module',
      nodeId: videoNodeId
    })
    expect(moduleWarnings).toContainEqual({
      code: 'expo-module-unsupported',
      message:
        'Expo static MVP emitted a static native fallback and dropped open-pencil.table/table module',
      nodeId: tableNodeId
    })
    expect(moduleWarnings).toContainEqual({
      code: 'expo-module-unsupported',
      message:
        'Expo static MVP emitted a static native fallback and dropped open-pencil.slide-menu/slide-menu module',
      nodeId: slideMenuNodeId
    })
    for (const { nodeId, identity } of additionalModules) {
      expect(moduleWarnings).toContainEqual({
        code: 'expo-module-unsupported',
        message: `Expo static MVP emitted a static native fallback and dropped ${identity} module`,
        nodeId
      })
    }
    expect(source).toContain('Authored video fallback')
    expect(source).toContain('Authored table fallback')
    expect(source).toContain('Authored slide menu fallback')
    for (const { authoredText } of additionalModules) expect(source).toContain(authoredText)
    expect(source).not.toContain('WebView')
    expect(source).not.toContain(VIDEO_SOURCE)
    expect(source).not.toContain(VIDEO_POSTER)
    expect(source).not.toContain('https://example.com/settings')
    expect(source).not.toContain(LOTTIE_SOURCE)
    expect(source).not.toContain(CAROUSEL_IMAGE)
    expect(source).not.toContain(CAROUSEL_DESTINATION)
    expect(source).not.toContain(GRID_PRIVATE_VALUE)
    expect(source).not.toContain(TABS_PRIVATE_VALUE)
    expect(source).not.toContain(ACCORDION_PRIVATE_VALUE)
    expect(source).not.toContain(QR_PRIVATE_VALUE)
    expect(source).not.toContain(MARKDOWN_PRIVATE_VALUE)
    expect(source).not.toContain(CODE_PRIVATE_VALUE)
    expect(source).not.toContain(PDF_PRIVATE_URL)
    expect(source).not.toContain(AUDIO_PRIVATE_URL)
  })

  test('Flutter warns for reviewed modules while preserving authored static fallbacks', () => {
    const { output, slideMenuNodeId, tableNodeId, videoNodeId, additionalModules } =
      compileNativeModuleFixture('flutter')
    const source = nativeSources(output, 'flutter')
    const moduleWarnings = output.warnings.filter(
      (warning) => warning.code === 'flutter-element-feature-unsupported'
    )

    expect(moduleWarnings).toHaveLength(3 + additionalModules.length)
    expect(moduleWarnings).toContainEqual({
      code: 'flutter-element-feature-unsupported',
      message: 'Flutter static MVP emitted a static fallback and omitted: plugin module',
      nodeId: videoNodeId
    })
    expect(moduleWarnings).toContainEqual({
      code: 'flutter-element-feature-unsupported',
      message: 'Flutter static MVP emitted a static fallback and omitted: plugin module',
      nodeId: tableNodeId
    })
    expect(moduleWarnings).toContainEqual({
      code: 'flutter-element-feature-unsupported',
      message: 'Flutter static MVP emitted a static fallback and omitted: plugin module',
      nodeId: slideMenuNodeId
    })
    for (const { nodeId } of additionalModules) {
      expect(moduleWarnings).toContainEqual({
        code: 'flutter-element-feature-unsupported',
        message: 'Flutter static MVP emitted a static fallback and omitted: plugin module',
        nodeId
      })
    }
    expect(source).toContain('Authored video fallback')
    expect(source).toContain('Authored table fallback')
    expect(source).toContain('Authored slide menu fallback')
    for (const { authoredText } of additionalModules) expect(source).toContain(authoredText)
    expect(source).not.toContain('WebView')
    expect(source).not.toContain(VIDEO_SOURCE)
    expect(source).not.toContain(VIDEO_POSTER)
    expect(source).not.toContain('https://example.com/settings')
    expect(source).not.toContain(LOTTIE_SOURCE)
    expect(source).not.toContain(CAROUSEL_IMAGE)
    expect(source).not.toContain(CAROUSEL_DESTINATION)
    expect(source).not.toContain(GRID_PRIVATE_VALUE)
    expect(source).not.toContain(TABS_PRIVATE_VALUE)
    expect(source).not.toContain(ACCORDION_PRIVATE_VALUE)
    expect(source).not.toContain(QR_PRIVATE_VALUE)
    expect(source).not.toContain(MARKDOWN_PRIVATE_VALUE)
    expect(source).not.toContain(CODE_PRIVATE_VALUE)
    expect(source).not.toContain(PDF_PRIVATE_URL)
    expect(source).not.toContain(AUDIO_PRIVATE_URL)
  })
})
