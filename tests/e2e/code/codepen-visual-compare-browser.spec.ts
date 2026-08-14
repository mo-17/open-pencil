import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

interface VisualCompareBrowserResult {
  createImageBitmapCalls: number
  malformedRejectedBeforeDecode: boolean
  wrongSizeRejectedBeforeDecode: boolean
  formats: string[]
  dimensions: string[]
  identicalRatios: number[]
  changedRatio: number
}

test('production comparator decodes PNG and WebP artifacts at all three fixed sizes', async ({
  page
}) => {
  await page.goto('/?test&no-chrome&no-rulers')

  const result = await page.evaluate(async (): Promise<VisualCompareBrowserResult> => {
    const { codePenPixelComparator, readCodePenVisualReference } =
      await import('/src/app/codepen/visual-compare.ts')
    const viewports = [
      { id: 'mobile', width: 360, height: 800, color: '#1860b4' },
      { id: 'tablet', width: 768, height: 1024, color: '#5b3db8' },
      { id: 'desktop', width: 1280, height: 800, color: '#16856b' }
    ] as const

    const encode = async (
      width: number,
      height: number,
      mediaType: 'image/png' | 'image/webp',
      color: string
    ): Promise<Uint8Array> => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Browser 2D canvas is unavailable')
      context.fillStyle = color
      context.fillRect(0, 0, width, height)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (candidate) => {
            if (!candidate) {
              reject(new Error(`Could not encode ${mediaType}`))
              return
            }
            resolve(candidate)
          },
          mediaType,
          1
        )
      })
      if (blob.type !== mediaType) throw new Error(`Browser did not encode ${mediaType}`)
      return new Uint8Array(await blob.arrayBuffer())
    }

    const nativeCreateImageBitmap = globalThis.createImageBitmap.bind(globalThis)
    let createImageBitmapCalls = 0
    globalThis.createImageBitmap = async (...args: Parameters<typeof createImageBitmap>) => {
      createImageBitmapCalls++
      return nativeCreateImageBitmap(...args)
    }

    try {
      const callsBeforeMalformed = createImageBitmapCalls
      let malformedRejectedBeforeDecode = false
      try {
        await readCodePenVisualReference(
          new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'truncated.png', {
            type: 'image/png'
          }),
          'mobile'
        )
      } catch {
        malformedRejectedBeforeDecode = createImageBitmapCalls === callsBeforeMalformed
      }

      const wrongSizeBytes = await encode(361, 800, 'image/png', '#000000')
      const callsBeforeWrongSize = createImageBitmapCalls
      let wrongSizeRejectedBeforeDecode = false
      try {
        await readCodePenVisualReference(
          new File([wrongSizeBytes], 'wrong-size.png', { type: 'image/png' }),
          'mobile'
        )
      } catch {
        wrongSizeRejectedBeforeDecode = createImageBitmapCalls === callsBeforeWrongSize
      }

      const identicalRatios: number[] = []
      const formats: string[] = []
      const dimensions: string[] = []
      for (const viewport of viewports) {
        const pngBytes = await encode(viewport.width, viewport.height, 'image/png', viewport.color)
        const webpBytes = await encode(
          viewport.width,
          viewport.height,
          'image/webp',
          viewport.color
        )
        const reference = await readCodePenVisualReference(
          new File([pngBytes], `${viewport.id}.png`, { type: 'image/png' }),
          viewport.id
        )
        const candidate = await readCodePenVisualReference(
          new File([webpBytes], `${viewport.id}.webp`, { type: 'image/webp' }),
          viewport.id
        )
        const comparison = await codePenPixelComparator.compare({
          reference,
          candidate,
          viewport,
          round: 0,
          signal: new AbortController().signal
        })
        identicalRatios.push(comparison.differenceRatio)
        formats.push(reference.mediaType, candidate.mediaType)
        dimensions.push(
          `${reference.width}x${reference.height}`,
          `${candidate.width}x${candidate.height}`
        )
      }

      const changedViewport = viewports[0]
      const changedReferenceBytes = await encode(
        changedViewport.width,
        changedViewport.height,
        'image/png',
        '#ff0000'
      )
      const changedCandidateBytes = await encode(
        changedViewport.width,
        changedViewport.height,
        'image/webp',
        '#000000'
      )
      const changedReference = await readCodePenVisualReference(
        new File([changedReferenceBytes], 'changed-reference.png', { type: 'image/png' }),
        changedViewport.id
      )
      const changedCandidate = await readCodePenVisualReference(
        new File([changedCandidateBytes], 'changed-candidate.webp', { type: 'image/webp' }),
        changedViewport.id
      )
      const changed = await codePenPixelComparator.compare({
        reference: changedReference,
        candidate: changedCandidate,
        viewport: changedViewport,
        round: 0,
        signal: new AbortController().signal
      })

      return {
        createImageBitmapCalls,
        malformedRejectedBeforeDecode,
        wrongSizeRejectedBeforeDecode,
        formats,
        dimensions,
        identicalRatios,
        changedRatio: changed.differenceRatio
      }
    } finally {
      globalThis.createImageBitmap = nativeCreateImageBitmap
    }
  })

  expect(result.createImageBitmapCalls).toBe(16)
  expect(result.malformedRejectedBeforeDecode).toBe(true)
  expect(result.wrongSizeRejectedBeforeDecode).toBe(true)
  expect(result.formats).toEqual([
    'image/png',
    'image/webp',
    'image/png',
    'image/webp',
    'image/png',
    'image/webp'
  ])
  expect(result.dimensions).toEqual([
    '360x800',
    '360x800',
    '768x1024',
    '768x1024',
    '1280x800',
    '1280x800'
  ])
  for (const ratio of result.identicalRatios) expect(ratio).toBeLessThan(0.01)
  expect(result.changedRatio).toBeGreaterThan(0.2)
})

test('CodePen AI review dialog is reachable without mutating the live graph', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const initial = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return { sceneVersion: store.state.sceneVersion, nodeCount: store.graph.getNodeCount() }
  })

  await page.getByRole('tab', { name: 'AI' }).click()
  if (!(await page.getByTestId('codepen-ai-review-toggle').isVisible())) {
    await page.getByTestId('provider-setup-open-settings').click()
    await expect(page.getByTestId('app-settings-dialog')).toBeVisible()
    await page.locator('[data-model-id]').first().click()
    await page.getByTestId('settings-model-provider').click()
    await page.getByRole('option', { name: 'OpenRouter' }).click()
    await page.getByLabel('Name').fill('CodePen Review Test')
    await page.getByTestId('provider-settings-api-key').fill('sk-or-codepen-review-test')
    await page.getByRole('button', { name: 'Save model' }).click()
    await page.getByTestId('app-settings-done').click()
  }

  await page.getByTestId('codepen-ai-review-toggle').click()
  const dialog = page.getByTestId('codepen-ai-review-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('CodePen AI reconstruction')).toBeVisible()
  await expect(dialog.getByTestId('codepen-ai-url')).toBeVisible()
  await expect(dialog.getByTestId('codepen-ai-analyze-url')).toBeDisabled()
  await expect(dialog.getByTestId('codepen-ai-commit')).toBeDisabled()

  const after = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return { sceneVersion: store.state.sceneVersion, nodeCount: store.graph.getNodeCount() }
  })
  expect(after).toEqual(initial)
})
