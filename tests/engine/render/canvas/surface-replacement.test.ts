import { describe, expect, mock, test } from 'bun:test'

import type { Image as CKImage, Surface } from 'canvaskit-wasm'

import { SceneGraph } from '@open-pencil/scene-graph'

import { SkiaRenderer, type SubtreePictureCacheEntry } from '#core/canvas/renderer'

function surface() {
  return { delete: mock() } as Surface & { delete: ReturnType<typeof mock> }
}

describe('renderer surface replacement', () => {
  test('clears context-owned tiled resources before replacing the main surface', () => {
    const previous = surface()
    const next = surface()
    const buildSurface = surface()
    const retainedImage = { delete: mock() } as CKImage & { delete: ReturnType<typeof mock> }
    const subtreePicture = { delete: mock() }
    const geometry = {
      pageId: 'page',
      sceneVersion: 1,
      positionPreviewVersion: 1,
      fontGeneration: 1,
      anchorPanX: 0,
      anchorPanY: 0,
      marginDeviceX: 0,
      marginDeviceY: 0,
      panX: 0,
      panY: 0,
      zoom: 1,
      width: 100,
      height: 100,
      dpr: 1,
      worldX: 0,
      worldY: 0,
      worldWidth: 100,
      worldHeight: 100
    }
    const renderer: Pick<
      SkiaRenderer,
      | 'surface'
      | 'tiledScene'
      | 'sceneBacking'
      | 'sceneBackingBuild'
      | 'sceneBackingNeedsCrispRender'
      | 'sceneBackingAllocationFailed'
      | 'subtreePictureCache'
      | 'subtreePictureCachePageId'
      | 'subtreePictureCacheSceneVersion'
      | 'subtreePictureCachePositionPreviewVersion'
      | 'subtreePictureCacheFontGeneration'
      | 'invalidateScenePicture'
      | 'replaceSurface'
    > = {
      surface: previous,
      tiledScene: { destroy: mock() } as SkiaRenderer['tiledScene'],
      sceneBacking: { ...geometry, image: retainedImage },
      sceneBackingBuild: {
        ...geometry,
        surface: buildSurface,
        graph: new SceneGraph(),
        childIds: [],
        index: 0,
        startedAt: 0
      },
      sceneBackingNeedsCrispRender: false,
      sceneBackingAllocationFailed: true,
      subtreePictureCache: new Map([
        [
          'node',
          {
            picture: subtreePicture,
            pageId: 'page',
            sceneVersion: 1,
            positionPreviewVersion: 1,
            fontGeneration: 1
          } as SubtreePictureCacheEntry
        ]
      ]),
      subtreePictureCachePageId: 'page',
      subtreePictureCacheSceneVersion: 1,
      subtreePictureCachePositionPreviewVersion: 1,
      subtreePictureCacheFontGeneration: 1,
      invalidateScenePicture: mock(),
      replaceSurface: SkiaRenderer.prototype.replaceSurface
    }

    renderer.replaceSurface.call(renderer as SkiaRenderer, next)

    expect(renderer.tiledScene.destroy).toHaveBeenCalledTimes(1)
    expect(previous.delete).toHaveBeenCalledTimes(1)
    expect(renderer.surface).toBe(next)
    expect(renderer.sceneBackingAllocationFailed).toBe(false)
    expect(buildSurface.delete).toHaveBeenCalledTimes(1)
    expect(subtreePicture.delete).toHaveBeenCalledTimes(1)
    expect(renderer.sceneBacking).not.toBeNull()
    expect(retainedImage.delete).not.toHaveBeenCalled()
    expect(renderer.sceneBackingNeedsCrispRender).toBe(true)
    expect(renderer.invalidateScenePicture).not.toHaveBeenCalled()
  })
})
