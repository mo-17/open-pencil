import { describe, expect, mock, test } from 'bun:test'

import type { Surface } from 'canvaskit-wasm'

import { SkiaRenderer, type SubtreePictureCacheEntry } from '#core/canvas/renderer'

function surface() {
  return { delete: mock() } as Surface & { delete: ReturnType<typeof mock> }
}

describe('renderer surface replacement', () => {
  test('clears context-owned tiled resources before replacing the main surface', () => {
    const previous = surface()
    const next = surface()
    const buildSurface = surface()
    const retainedImage = { delete: mock() }
    const subtreePicture = { delete: mock() }
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
      sceneBacking: { image: retainedImage } as unknown as SkiaRenderer['sceneBacking'],
      sceneBackingBuild: {
        surface: buildSurface
      } as unknown as SkiaRenderer['sceneBackingBuild'],
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
