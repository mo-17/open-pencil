import { expect, test } from 'bun:test'

import {
  CANVAS_PERFORMANCE_MODES,
  DEFAULT_CANVAS_PERFORMANCE_MODE,
  SkiaRenderer,
  canvasPerformanceProfile,
  normalizeCanvasPerformanceMode
} from '#core/canvas'

test('canvas performance modes normalize untrusted preferences to balanced', () => {
  expect(CANVAS_PERFORMANCE_MODES).toEqual(['resource-saving', 'balanced', 'smooth'])
  expect(DEFAULT_CANVAS_PERFORMANCE_MODE).toBe('balanced')
  expect(normalizeCanvasPerformanceMode('resource-saving')).toBe('resource-saving')
  expect(normalizeCanvasPerformanceMode('smooth')).toBe('smooth')
  expect(normalizeCanvasPerformanceMode('unknown')).toBe('balanced')
  expect(normalizeCanvasPerformanceMode(null)).toBe('balanced')
})

test('balanced canvas performance profile preserves the previous rendering constants', () => {
  expect(canvasPerformanceProfile('balanced')).toEqual({
    mode: 'balanced',
    smoothGeneratedEffectCadence: 30,
    noiseGeneratedEffectFpsCap: 30,
    collaborationCursorFpsCap: 30,
    fontLoadConcurrency: 4,
    figParseWorkerConcurrency: 1,
    backgroundLayoutTimeSliceMs: 5,
    sceneBackingCoverageScale: 3,
    sceneBackingMaxDevicePixels: 12_000_000,
    sceneBackingMinCrispDelayMs: (1000 / 60) * 2,
    sceneBackingMaxCrispDelayMs: 300,
    sceneBackingMaxQuietInputIntervals: 4,
    sceneBackingMaxTilesPerStep: 1,
    sceneBackingBuildStepBudgetMs: null,
    decodedImageCacheBudgetBytes: 128 * 1024 * 1024
  })
})

test('resource-saving and smooth profiles bound optional animation and backing work', () => {
  expect(canvasPerformanceProfile('resource-saving')).toMatchObject({
    smoothGeneratedEffectCadence: 15,
    noiseGeneratedEffectFpsCap: 15,
    collaborationCursorFpsCap: 15,
    fontLoadConcurrency: 2,
    figParseWorkerConcurrency: 1,
    backgroundLayoutTimeSliceMs: 2,
    sceneBackingCoverageScale: 1.5,
    sceneBackingMaxDevicePixels: 6_000_000,
    sceneBackingMinCrispDelayMs: 67,
    sceneBackingMaxCrispDelayMs: 500,
    sceneBackingMaxQuietInputIntervals: 6,
    sceneBackingMaxTilesPerStep: 1,
    sceneBackingBuildStepBudgetMs: null,
    decodedImageCacheBudgetBytes: 64 * 1024 * 1024
  })
  expect(canvasPerformanceProfile('smooth')).toMatchObject({
    smoothGeneratedEffectCadence: 'animation-frame',
    noiseGeneratedEffectFpsCap: 60,
    collaborationCursorFpsCap: 60,
    fontLoadConcurrency: 6,
    figParseWorkerConcurrency: 2,
    backgroundLayoutTimeSliceMs: 3,
    sceneBackingCoverageScale: 3,
    sceneBackingMaxDevicePixels: 12_000_000,
    sceneBackingMinCrispDelayMs: 1000 / 60,
    sceneBackingMaxCrispDelayMs: 133,
    sceneBackingMaxQuietInputIntervals: 2,
    sceneBackingMaxTilesPerStep: 4,
    sceneBackingBuildStepBudgetMs: 6,
    decodedImageCacheBudgetBytes: 128 * 1024 * 1024
  })
})

test('hot mode changes update the renderer decoded-image budget without recreating it', () => {
  const renderer = {
    performanceMode: 'balanced',
    imageCacheByteBudget: 128 * 1024 * 1024,
    sceneBackingPreviewUntil: 100,
    lastSceneViewport: { panX: 0, panY: 0, zoom: 1 },
    sceneBackingNeedsCrispRender: false,
    sceneBacking: null,
    sceneBackingBuild: null
  }

  expect(
    SkiaRenderer.prototype.setPerformanceMode.call(renderer as SkiaRenderer, 'resource-saving')
  ).toBe(true)
  expect(renderer.performanceMode).toBe('resource-saving')
  expect(renderer.imageCacheByteBudget).toBe(64 * 1024 * 1024)
  expect(renderer.lastSceneViewport).toBeNull()
})
