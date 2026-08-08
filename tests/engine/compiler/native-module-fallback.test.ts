import { describe, expect, test } from 'bun:test'

import { compile, withDefaults, type CompilerOutput } from '@open-pencil/compiler'
import {
  createCarouselModuleInstance,
  createDataGridModuleInstance,
  createLottieModuleInstance
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const VIDEO_SOURCE = 'https://media.example.com/open-pencil/native-fallback.mp4'
const VIDEO_POSTER = 'https://media.example.com/open-pencil/native-fallback.webp'
const LOTTIE_SOURCE = 'https://media.example.com/open-pencil/native-animation.json'
const CAROUSEL_IMAGE = 'https://media.example.com/open-pencil/native-carousel.webp'
const CAROUSEL_DESTINATION = 'https://example.com/native-carousel-destination'
const GRID_PRIVATE_VALUE = 'grid-module-payload-must-not-leak'

interface NativeModuleFixture {
  output: CompilerOutput
  slideMenuNodeId: string
  tableNodeId: string
  videoNodeId: string
  additionalModuleNodeIds: string[]
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
    additionalModuleNodeIds: [lottie.id, carousel.id, dataGrid.id]
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
    const { output, slideMenuNodeId, tableNodeId, videoNodeId, additionalModuleNodeIds } =
      compileNativeModuleFixture('expo')
    const source = nativeSources(output, 'expo')
    const moduleWarnings = output.warnings.filter(
      (warning) => warning.code === 'expo-module-unsupported'
    )

    expect(moduleWarnings).toHaveLength(6)
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
    for (const [nodeId, identity] of [
      [additionalModuleNodeIds[0], 'open-pencil.lottie/lottie'],
      [additionalModuleNodeIds[1], 'open-pencil.carousel/carousel'],
      [additionalModuleNodeIds[2], 'open-pencil.data-grid/data-grid']
    ] as const) {
      expect(moduleWarnings).toContainEqual({
        code: 'expo-module-unsupported',
        message: `Expo static MVP emitted a static native fallback and dropped ${identity} module`,
        nodeId
      })
    }
    expect(source).toContain('Authored video fallback')
    expect(source).toContain('Authored table fallback')
    expect(source).toContain('Authored slide menu fallback')
    expect(source).toContain('Authored Lottie fallback')
    expect(source).toContain('Authored carousel fallback')
    expect(source).toContain('Authored data grid fallback')
    expect(source).not.toContain('WebView')
    expect(source).not.toContain(VIDEO_SOURCE)
    expect(source).not.toContain(VIDEO_POSTER)
    expect(source).not.toContain('https://example.com/settings')
    expect(source).not.toContain(LOTTIE_SOURCE)
    expect(source).not.toContain(CAROUSEL_IMAGE)
    expect(source).not.toContain(CAROUSEL_DESTINATION)
    expect(source).not.toContain(GRID_PRIVATE_VALUE)
  })

  test('Flutter warns for reviewed modules while preserving authored static fallbacks', () => {
    const { output, slideMenuNodeId, tableNodeId, videoNodeId, additionalModuleNodeIds } =
      compileNativeModuleFixture('flutter')
    const source = nativeSources(output, 'flutter')
    const moduleWarnings = output.warnings.filter(
      (warning) => warning.code === 'flutter-element-feature-unsupported'
    )

    expect(moduleWarnings).toHaveLength(6)
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
    for (const nodeId of additionalModuleNodeIds) {
      expect(moduleWarnings).toContainEqual({
        code: 'flutter-element-feature-unsupported',
        message: 'Flutter static MVP emitted a static fallback and omitted: plugin module',
        nodeId
      })
    }
    expect(source).toContain('Authored video fallback')
    expect(source).toContain('Authored table fallback')
    expect(source).toContain('Authored slide menu fallback')
    expect(source).toContain('Authored Lottie fallback')
    expect(source).toContain('Authored carousel fallback')
    expect(source).toContain('Authored data grid fallback')
    expect(source).not.toContain('WebView')
    expect(source).not.toContain(VIDEO_SOURCE)
    expect(source).not.toContain(VIDEO_POSTER)
    expect(source).not.toContain('https://example.com/settings')
    expect(source).not.toContain(LOTTIE_SOURCE)
    expect(source).not.toContain(CAROUSEL_IMAGE)
    expect(source).not.toContain(CAROUSEL_DESTINATION)
    expect(source).not.toContain(GRID_PRIVATE_VALUE)
  })
})
