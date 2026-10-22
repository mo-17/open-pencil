import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} })
  )
  await page.goto('/?test&no-chrome&no-rulers')
  await new CanvasHelper(page).waitForInit()
})

test('simulated content playback discards an old capture after source edits', async ({ page }) => {
  const probe = await page.evaluateHandle(async () => {
    const { contentPlaybackProbe } =
      await import('/packages/vue/tests/canvas/surface/shader/content-playback-probe.ts')
    return contentPlaybackProbe('capture')
  })
  try {
    await expect.poll(() => probe.evaluate((p) => p.stats.captures)).toBe(1)
    await probe.evaluate((p) => p.edit())
    await expect.poll(() => probe.evaluate((p) => p.stats.published)).toBeGreaterThan(0)
    expect(await probe.evaluate((p) => p.stats.starts)).toBe(1)
    await probe.evaluate((p) => p.release())
    expect(await probe.evaluate((p) => p.saved())).toEqual([42])
    expect(await probe.evaluate((p) => p.stats.starts)).toBe(1)
  } finally {
    await probe.evaluate((p) => p.close())
    await probe.dispose()
  }
})

for (const action of ['pause', 'delete', 'switch'] as const) {
  test(`simulated late content renderer releases resources after ${action}`, async ({ page }) => {
    const probe = await page.evaluateHandle(async () => {
      const { contentPlaybackProbe } =
        await import('/packages/vue/tests/canvas/surface/shader/content-playback-probe.ts')
      return contentPlaybackProbe('renderer')
    })
    try {
      await expect.poll(() => probe.evaluate((p) => p.stats.starts)).toBe(1)
      await probe.evaluate((p, action) => p[action](), action)
      await expect.poll(() => probe.evaluate((p) => p.stats.closedTextures)).toBe(1)
      await probe.evaluate((p) => p.release())
      await expect.poll(() => probe.evaluate((p) => p.stats.disposed)).toBe(1)
      expect(await probe.evaluate((p) => p.stats.published)).toBe(0)
      expect(await probe.evaluate((p) => p.saved())).toEqual([42])
    } finally {
      await probe.evaluate((p) => p.close())
      await probe.dispose()
    }
  })
}

for (const action of ['pause', 'switch'] as const) {
  test(`simulated pending content frame releases its player after ${action}`, async ({ page }) => {
    const probe = await page.evaluateHandle(async () => {
      const { contentPlaybackProbe } =
        await import('/packages/vue/tests/canvas/surface/shader/content-playback-probe.ts')
      return contentPlaybackProbe('frame')
    })
    try {
      await expect.poll(() => probe.evaluate((p) => p.stats.draws)).toBe(3)
      await probe.evaluate((p, action) => p[action](), action)
      await expect.poll(() => probe.evaluate((p) => p.stats.disposed)).toBe(1)
      expect(await probe.evaluate((p) => p.stats.closedTextures)).toBe(1)
      await probe.evaluate((p) => p.release())
      expect(await probe.evaluate((p) => p.stats.published)).toBe(0)
      expect(await probe.evaluate((p) => p.saved())).toEqual([42])
    } finally {
      await probe.evaluate((p) => p.close())
      await probe.dispose()
    }
  })
}

test('simulated content loss retains saved bytes and retries only on request', async ({ page }) => {
  const probe = await page.evaluateHandle(async () => {
    const { contentPlaybackProbe } =
      await import('/packages/vue/tests/canvas/surface/shader/content-playback-probe.ts')
    return contentPlaybackProbe('none')
  })
  try {
    await expect.poll(() => probe.evaluate((p) => p.stats.published)).toBeGreaterThan(3)
    expect(await probe.evaluate((p) => p.stats.captures)).toBe(1)
    expect(await probe.evaluate((p) => p.stats.textures)).toBe(1)
    await probe.evaluate((p) => p.lose())
    await expect.poll(() => probe.evaluate((p) => p.stats.disposed)).toBe(1)
    expect(await probe.evaluate((p) => p.stats.starts)).toBe(1)
    expect(await probe.evaluate((p) => p.saved())).toEqual([42])
    await probe.evaluate((p) => p.retry())
    await expect.poll(() => probe.evaluate((p) => p.stats.starts)).toBe(2)
    await expect.poll(() => probe.evaluate((p) => p.stats.live)).toBe(1)
  } finally {
    await probe.evaluate((p) => p.close())
    await probe.dispose()
  }
})

test('simulated content initialization failure preserves fallback without a retry loop', async ({
  page
}) => {
  const probe = await page.evaluateHandle(async () => {
    const { contentPlaybackProbe } =
      await import('/packages/vue/tests/canvas/surface/shader/content-playback-probe.ts')
    return contentPlaybackProbe('initialization')
  })
  try {
    await expect.poll(() => probe.evaluate((p) => p.stats.disposed)).toBe(1)
    expect(await probe.evaluate((p) => p.stats.closedTextures)).toBe(1)
    expect(await probe.evaluate((p) => p.stats.published)).toBe(0)
    expect(await probe.evaluate((p) => p.saved())).toEqual([42])
    await probe.evaluate((p) => p.pan(1))
    expect(await probe.evaluate((p) => p.stats.starts)).toBe(1)
  } finally {
    await probe.evaluate((p) => p.close())
    await probe.dispose()
  }
})

test('simulated content edits, undo, redo and unsupported bindings refresh playback ownership', async ({
  page
}) => {
  const probe = await page.evaluateHandle(async () => {
    const { contentPlaybackProbe } =
      await import('/packages/vue/tests/canvas/surface/shader/content-playback-probe.ts')
    return contentPlaybackProbe('none')
  })
  try {
    await expect.poll(() => probe.evaluate((p) => p.stats.starts)).toBe(1)
    for (const [index, action] of (['edit', 'undo', 'redo'] as const).entries()) {
      await probe.evaluate((p, action) => p[action](), action)
      await expect.poll(() => probe.evaluate((p) => p.stats.starts)).toBe(index + 2)
      await expect.poll(() => probe.evaluate((p) => p.stats.live)).toBe(1)
    }
    await probe.evaluate((p) => p.unsupported())
    await expect.poll(() => probe.evaluate((p) => p.stats.live)).toBe(0)
    expect(await probe.evaluate((p) => p.stats.closedTextures)).toBe(4)
    expect(await probe.evaluate((p) => p.saved())).toEqual([42])
    await probe.evaluate((p) => p.undo())
    await expect.poll(() => probe.evaluate((p) => p.stats.starts)).toBe(5)
  } finally {
    await probe.evaluate((p) => p.close())
    await probe.dispose()
  }
})

test('simulated content initialization is serial, bounded, and releases offscreen players', async ({
  page
}) => {
  const probe = await page.evaluateHandle(async () => {
    const { contentPlaybackProbe } =
      await import('/packages/vue/tests/canvas/surface/shader/content-playback-probe.ts')
    return contentPlaybackProbe('renderer', 5)
  })
  try {
    await expect.poll(() => probe.evaluate((p) => p.stats.starts)).toBe(1)
    expect(await probe.evaluate((p) => p.stats.captures)).toBe(1)
    await probe.evaluate((p) => p.release())
    await expect.poll(() => probe.evaluate((p) => p.stats.live)).toBe(4)
    expect(await probe.evaluate((p) => p.stats.starts)).toBe(4)
    await probe.evaluate((p) => p.pan(-10000))
    await expect.poll(() => probe.evaluate((p) => p.stats.live)).toBe(0)
    expect(await probe.evaluate((p) => p.stats.closedTextures)).toBe(4)
  } finally {
    await probe.evaluate((p) => p.close())
    await probe.dispose()
  }
})
