import { describe, expect, test } from 'bun:test'

import { trustedNativeSlideMenuTrigger } from '#compiler/adapters/native-shared'
import type { IRElement } from '#compiler/ir/types'

import { compile, withDefaults, type CompilerOutput } from '@open-pencil/compiler'
import {
  createAccordionModuleInstance,
  createAudioPlayerModuleInstance,
  createCarouselModuleInstance,
  createCodeBlockModuleInstance,
  createDataGridModuleInstance,
  createLottieModuleInstance,
  createMarkdownModuleInstance,
  createPDFViewerModuleInstance,
  createQrBarcodeModuleInstance,
  createSlideMenuModuleFrameOverrides,
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
const STATIC_SLIDE_MENU_LABEL = 'Open static navigation'
const FORGED_SLIDE_MENU_LABEL = 'forged-slide-menu-config-must-not-leak'
const LEGACY_SLIDE_MENU_LABEL = 'Open migrated legacy navigation'

const SLIDE_MENU_TRIGGER_VISIBILITIES = [
  { label: 'Native icon and label', showTriggerIcon: true, showTriggerLabel: true },
  {
    label: 'native-icon-only-label-must-not-render',
    showTriggerIcon: true,
    showTriggerLabel: false
  },
  { label: 'Native label only', showTriggerIcon: false, showTriggerLabel: true },
  {
    label: 'native-hidden-label-must-not-render',
    showTriggerIcon: false,
    showTriggerLabel: false
  }
] as const

interface AdditionalModuleFallback {
  nodeId: string
  identity: string
  authoredText: string
}

interface NativeModuleFixture {
  output: CompilerOutput
  emptySlideMenuNodeId: string
  slideMenuNodeId: string
  tableNodeId: string
  videoNodeId: string
  additionalModules: AdditionalModuleFallback[]
}

function legacySlideMenuConfig(triggerLabel: string) {
  return {
    presentation: 'menu',
    direction: 'left',
    triggerLabel,
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

function slideMenuTriggerElement(
  configVersion: number,
  payload: Record<string, unknown>
): IRElement {
  return {
    kind: 'element',
    sourceId: `slide-menu-v${configVersion}`,
    tag: 'div',
    className: '',
    attrs: {},
    children: [],
    module: {
      pluginId: 'open-pencil.slide-menu',
      moduleType: 'slide-menu',
      configVersion,
      payload
    }
  }
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
        config: legacySlideMenuConfig('Open navigation')
      }
    }
  })
  graph.createNode('TEXT', slideMenu.id, { text: 'Authored slide menu fallback' })

  const emptySlideMenu = graph.createNode('FRAME', pageId, {
    ...createSlideMenuModuleFrameOverrides({ triggerLabel: STATIC_SLIDE_MENU_LABEL })
  })

  graph.createNode('FRAME', pageId, {
    width: 180,
    height: 48,
    interactiveProps: {
      module: {
        version: 1,
        pluginId: 'open-pencil.slide-menu',
        moduleType: 'slide-menu',
        configVersion: 1,
        config: { triggerLabel: FORGED_SLIDE_MENU_LABEL }
      }
    }
  })

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
      createPDFViewerModuleInstance({ sourceUrl: PDF_PRIVATE_URL }),
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
    emptySlideMenuNodeId: emptySlideMenu.id,
    slideMenuNodeId: slideMenu.id,
    tableNodeId: table.id,
    videoNodeId: video.id,
    additionalModules
  }
}

function compileNativeSlideMenuTrigger(
  target: 'expo' | 'flutter',
  visibility: (typeof SLIDE_MENU_TRIGGER_VISIBILITIES)[number] | 'legacy'
): CompilerOutput {
  const graph = makeSceneGraph('Native Slide Menu trigger visibility')
  const pageId = firstPageId(graph)
  graph.createNode(
    'FRAME',
    pageId,
    visibility === 'legacy'
      ? {
          width: 180,
          height: 48,
          fills: [
            {
              type: 'SOLID',
              color: { r: 0.15, g: 0.39, b: 0.92, a: 1 },
              opacity: 1,
              visible: true
            }
          ],
          interactiveProps: {
            module: {
              version: 1,
              pluginId: 'open-pencil.slide-menu',
              moduleType: 'slide-menu',
              configVersion: 1,
              config: legacySlideMenuConfig(LEGACY_SLIDE_MENU_LABEL)
            }
          }
        }
      : createSlideMenuModuleFrameOverrides({
          triggerLabel: visibility.label,
          showTriggerIcon: visibility.showTriggerIcon,
          showTriggerLabel: visibility.showTriggerLabel
        })
  )
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target,
      router: 'none',
      devMode: false,
      packageName:
        target === 'flutter' ? 'native_slide_menu_visibility' : 'native-slide-menu-visibility'
    })
  })
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
  test('accepts only complete typed v2 trigger payloads while safely defaulting legacy v1', () => {
    const label = 'Trusted trigger'
    expect(
      trustedNativeSlideMenuTrigger(slideMenuTriggerElement(1, { triggerLabel: label }))
    ).toEqual({ label, showIcon: true, showLabel: true })

    const rejected: [number, Record<string, unknown>][] = [
      [2, { triggerLabel: label, showTriggerLabel: true }],
      [2, { triggerLabel: label, showTriggerIcon: true }],
      [1, { triggerLabel: label, showTriggerIcon: 'true' }],
      [2, { triggerLabel: label, showTriggerIcon: true, showTriggerLabel: 1 }]
    ]
    for (const [configVersion, payload] of rejected) {
      expect(
        trustedNativeSlideMenuTrigger(slideMenuTriggerElement(configVersion, payload))
      ).toBeUndefined()
    }
  })

  test('Expo warns for reviewed modules while preserving authored static fallbacks', () => {
    const {
      output,
      emptySlideMenuNodeId,
      slideMenuNodeId,
      tableNodeId,
      videoNodeId,
      additionalModules
    } = compileNativeModuleFixture('expo')
    const source = nativeSources(output, 'expo')
    const moduleWarnings = output.warnings.filter(
      (warning) => warning.code === 'expo-module-unsupported'
    )

    expect(moduleWarnings).toHaveLength(4 + additionalModules.length)
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
    expect(moduleWarnings).toContainEqual({
      code: 'expo-module-unsupported',
      message:
        'Expo static MVP emitted a static native fallback and dropped open-pencil.slide-menu/slide-menu module',
      nodeId: emptySlideMenuNodeId
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
    expect(source).toContain(STATIC_SLIDE_MENU_LABEL)
    expect(source).not.toContain('Open navigation')
    expect(source).toContain('pointerEvents="none"')
    expect(source).toContain('"width":18,"height":14,"justifyContent":"space-between"')
    expect(source.match(/"width":18,"height":2,"backgroundColor":"#FFFFFF"/g)).toHaveLength(3)
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
    expect(source).not.toContain(FORGED_SLIDE_MENU_LABEL)
  })

  test('Flutter warns for reviewed modules while preserving authored static fallbacks', () => {
    const {
      output,
      emptySlideMenuNodeId,
      slideMenuNodeId,
      tableNodeId,
      videoNodeId,
      additionalModules
    } = compileNativeModuleFixture('flutter')
    const source = nativeSources(output, 'flutter')
    const moduleWarnings = output.warnings.filter(
      (warning) => warning.code === 'flutter-element-feature-unsupported'
    )

    expect(moduleWarnings).toHaveLength(4 + additionalModules.length)
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
    expect(moduleWarnings).toContainEqual({
      code: 'flutter-element-feature-unsupported',
      message: 'Flutter static MVP emitted a static fallback and omitted: plugin module',
      nodeId: emptySlideMenuNodeId
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
    expect(source).toContain(STATIC_SLIDE_MENU_LABEL)
    expect(source).not.toContain('Open navigation')
    expect(source).toContain('mainAxisAlignment: MainAxisAlignment.spaceBetween')
    expect(source.match(/width: 18\.0,\n\s+height: 2\.0,/g)).toHaveLength(3)
    expect(source).toContain('const SizedBox(width: 8.0)')
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
    expect(source).not.toContain(FORGED_SLIDE_MENU_LABEL)
  })

  for (const target of ['expo', 'flutter'] as const) {
    test(`${target} keeps Slide Menu trigger icon and label visibility independent`, () => {
      const barPattern =
        target === 'expo'
          ? /"width":18,"height":2,"backgroundColor":"#FFFFFF"/g
          : /width: 18\.0,\n\s+height: 2\.0,/g
      for (const visibility of SLIDE_MENU_TRIGGER_VISIBILITIES) {
        const source = nativeSources(compileNativeSlideMenuTrigger(target, visibility), target)
        expect(source.includes(visibility.label)).toBe(visibility.showTriggerLabel)
        expect(source.match(barPattern) ?? []).toHaveLength(visibility.showTriggerIcon ? 3 : 0)
        if (target === 'expo') {
          expect(source).toContain('pointerEvents="none"')
          expect(source.includes('"marginLeft":8')).toBe(
            visibility.showTriggerIcon && visibility.showTriggerLabel
          )
          expect(source).toContain('"height":48')
          expect(source).toContain('"backgroundColor":"#2663EB"')
          if (!visibility.showTriggerIcon && !visibility.showTriggerLabel) {
            expect(source).toMatch(/<View pointerEvents="none" style=\{[^\n]+\}><\/View>/)
          }
        } else {
          expect(source.includes('const SizedBox(width: 8.0)')).toBe(
            visibility.showTriggerIcon && visibility.showTriggerLabel
          )
          expect(source).toContain('height: 48')
          expect(source).toContain('Color(0xFF2663EB)')
          expect(source).not.toContain('GestureDetector(')
          if (!visibility.showTriggerIcon && !visibility.showTriggerLabel) {
            expect(source).toContain('children: [],')
          }
        }
      }

      const legacySource = nativeSources(compileNativeSlideMenuTrigger(target, 'legacy'), target)
      expect(legacySource).toContain(LEGACY_SLIDE_MENU_LABEL)
      expect(legacySource.match(barPattern) ?? []).toHaveLength(3)
      expect(legacySource).toContain(
        target === 'expo' ? '"marginLeft":8' : 'const SizedBox(width: 8.0)'
      )
    })
  }
})
