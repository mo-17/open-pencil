import { expect, test } from 'bun:test'

import { omit } from 'es-toolkit/object'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { exportFigFile } from '#core/io/formats/fig'
import { initCodec, parseFigFile } from '#core/kiwi'
import {
  CAROUSEL_NAVIGATION_DEFAULTS,
  CAROUSEL_STYLE_DEFAULTS,
  createCarouselModuleFrameOverrides,
  createCarouselModuleInstance,
  resolveCarouselModule,
  type CarouselArrowPositionV3
} from '#core/plugins/carousel'

import { expectDefined } from '#tests/helpers/assert'

function assertRestoredCarousel(original: SceneNode, restored: SceneGraph): void {
  const node = expectDefined(
    [...restored.getAllNodes()].find((candidate) => candidate.name === original.name)
  )
  expect(node.type).toBe('FRAME')
  const before = expectDefined(original.interactiveProps?.module)
  expect(node.interactiveProps?.module).toEqual(before)
  const resolution = resolveCarouselModule(node.interactiveProps?.module)
  if (!resolution?.ok) throw new Error('Restored carousel must resolve')
  expect(node.interactiveProps?.module).toEqual(before)
  if (before.configVersion < 3) {
    expect(resolution.config).toMatchObject({
      layout: 'split',
      paginationStyle: 'dots',
      arrowPosition: 'bottom-corners',
      swipeEnabled: false
    })
  }
}

test('Carousel styles and navigation survive fig readback without upgrading legacy v1 or v2 data', async () => {
  await initCodec()
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const nodes = [1, 2].map((version) => {
    const legacy = createCarouselModuleInstance()
    legacy.configVersion = version
    const keys =
      version === 1
        ? { ...CAROUSEL_STYLE_DEFAULTS, ...CAROUSEL_NAVIGATION_DEFAULTS }
        : CAROUSEL_NAVIGATION_DEFAULTS
    legacy.config = omit(legacy.config, Object.keys(keys))
    return graph.createNode('FRAME', pageId, {
      ...createCarouselModuleFrameOverrides(),
      name: `Legacy carousel ${version}`,
      interactiveProps: { module: legacy }
    })
  })
  const positions: CarouselArrowPositionV3[] = [
    'sides',
    'top-corners',
    'bottom-corners',
    'bottom-left',
    'bottom-right'
  ]
  for (const paginationStyle of ['dots', 'numbers', 'fraction'] as const) {
    for (const arrowPosition of positions) {
      nodes.push(
        graph.createNode('FRAME', pageId, {
          ...createCarouselModuleFrameOverrides({
            layout: 'overlay',
            imageFit: 'contain',
            textPosition: 'top',
            textAlign: 'right',
            overlayOpacity: 0.75,
            paginationStyle,
            arrowPosition,
            swipeEnabled: arrowPosition !== 'sides'
          }),
          name: `${paginationStyle} ${arrowPosition}`
        })
      )
    }
  }
  const bytes = await exportFigFile(graph)
  const restored = await parseFigFile(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  )
  for (const original of nodes) {
    assertRestoredCarousel(original, restored)
  }
})
