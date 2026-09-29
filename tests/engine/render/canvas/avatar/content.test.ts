import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderAvatarModulePreview } from '#core/canvas/modules/avatar'
import { avatarPreviewGeometry } from '#core/canvas/modules/avatar/geometry'
import { avatarTextNode } from '#core/canvas/modules/avatar/text'
import { renderShapeUncached } from '#core/canvas/scene'
import {
  createAvatarModuleFrameOverrides,
  AVATAR_MODULE_DEFAULT_CONFIG
} from '#core/plugins/avatar'

import { avatarImageFill, AVATAR_PNG } from '#tests/helpers/compiler/modules/avatar/fixture'

import { carouselPixelHarness } from '../carousel/helpers'

test('Avatar shapes CJK fallback and bounds large typography in a short narrow frame', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createAvatarModuleFrameOverrides({ name: '张小明' }),
    width: 64,
    height: 64
  })
  const shaped: string[] = [],
    build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    shaped.push(label.text)
    return build(label, color, options)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderAvatarModulePreview(h.renderer, h.canvas, node, graph)).toBe(true)
    expect(shaped).toEqual(['张小'])
    expect(avatarTextNode(node)?.textAlignHorizontal).toBe('CENTER')
    const config = {
      ...AVATAR_MODULE_DEFAULT_CONFIG,
      size: 256,
      fontSize: 96,
      fallbackText: '长回退文本'
    }
    const geo = avatarPreviewGeometry(40, 24, config)
    expect(geo.size).toBe(24)
    expect(geo.fontSize * 5).toBeLessThanOrEqual(24 * 0.7)
    expect(geo.x).toBe(8)
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
test('Avatar draws local bytes through the actual scene fill path without a rectangular image leaking outside the circle', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  graph.images.set('avatar-fixture', AVATAR_PNG)
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createAvatarModuleFrameOverrides({ name: '本地图片' }),
    fills: [avatarImageFill()]
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    renderShapeUncached(h.renderer, h.canvas, node, graph)
    const pixels = h.pixels()
    expect(h.rgb(pixels, 0, 0)).toEqual([255, 255, 255])
    expect(h.rgb(pixels, 32, 32)).not.toEqual([219, 234, 254])
    expect(h.renderer.imageCache.size).toBeGreaterThan(0)
  } finally {
    h.dispose()
  }
})
test('Avatar decode failure and unsupported SVG preserve the same initials fallback offline', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createAvatarModuleFrameOverrides({ name: 'Alex Morgan' }),
    fills: [avatarImageFill()]
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    renderAvatarModulePreview(h.renderer, h.canvas, node, graph)
    const fallback = h.pixels()
    for (const bytes of [AVATAR_PNG.slice(0, 16), new TextEncoder().encode('<svg/>')]) {
      graph.images.set('avatar-fixture', bytes)
      h.canvas.clear(h.ck.WHITE)
      renderAvatarModulePreview(h.renderer, h.canvas, node, graph)
      expect(h.pixels()).toEqual(fallback)
    }
  } finally {
    h.dispose()
  }
})
