import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

import type { SceneNode } from '@open-pencil/scene-graph'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'

interface Fixture {
  files: [string, string][]
  warnings: unknown[]
  root: SceneNode
  nodes: SceneNode[]
}

function fixture(target: 'react' | 'vue', kit = false): Fixture {
  return JSON.parse(
    execFileSync(
      'bun',
      [
        '-e',
        `import { switchAppearanceFixture } from './tests/helpers/compiler/components/switch-appearance'; process.stdout.write(JSON.stringify(switchAppearanceFixture('${target}', ${kit})))`
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      }
    )
  ) as Fixture
}

test.use({ viewport: { width: 1200, height: 800 }, colorScheme: 'light' })

test('canvas uses authored switch sizes and the shared off/on palette', async ({ page }, info) => {
  test.setTimeout(90_000)
  const data = fixture('react')
  await mockFontsource(page, [])
  await page.goto('/?test&renderer=retained&navigation-benchmark')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const result = await page.evaluate(async (data) => {
    const editor = window.openPencil.getStore()
    const graph = editor.graph
    const root = graph.createNode('FRAME', editor.state.currentPageId, {
      width: data.root.width,
      height: data.root.height,
      fills: data.root.fills
    })
    const fields = [
      'x',
      'y',
      'width',
      'height',
      'name',
      'fills',
      'strokes',
      'cornerRadius',
      'paddingLeft',
      'paddingRight',
      'paddingTop',
      'paddingBottom',
      'interactiveProps'
    ] as const
    const nodes = data.nodes.map((node) => {
      const created = graph.createNode(
        'SWITCH',
        root.id,
        Object.fromEntries(fields.map((key) => [key, node[key]]))
      )
      graph.createNode('TEXT', root.id, {
        text: node.name,
        x: node.x,
        y: node.y - 22,
        width: 114,
        height: 18,
        fontFamily: 'Inter',
        fontSize: 12,
        fills: [
          { type: 'SOLID', color: { r: 0.09, g: 0.17, b: 0.3, a: 1 }, visible: true, opacity: 1 }
        ]
      })
      return created
    })
    await editor.loadFontsForNodes([root.id])
    editor.zoomToBounds(-20, -20, 400, 320)
    editor.requestRender()
    const png = await editor.renderExportImage([root.id], 1, 'PNG')
    if (!png) throw new Error('Canvas export unavailable')
    return { png: Array.from(png), sizes: nodes.map(({ width, height }) => [width, height]) }
  }, data)
  await page.evaluate(() => window.openPencil?.test?.navigation?.waitForSettlement())
  await canvas.canvas.screenshot({ path: info.outputPath('canvas-live.png') })
  writeFileSync(info.outputPath('canvas.png'), Buffer.from(result.png))
  expect(Buffer.from(result.png)).toMatchSnapshot('canvas.png', {
    maxDiffPixels: 0,
    threshold: 0.2
  })
  expect(result.sizes).toEqual(data.nodes.map(({ width, height }) => [width, height]))
  canvas.assertNoErrors()
})

for (const variant of ['react', 'vue', 'shadcn'] as const) {
  const target = variant === 'vue' ? 'vue' : 'react'
  test(`${variant} keeps switch size, colors, single thumb and keyboard behavior`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const data = fixture(target, variant === 'shadcn')
    expect(data.warnings).toEqual([])
    await withComponentTemplateFiles(page, target, new Map(data.files), async () => {
      // Finish finite transitions before measurement and avoid system dark-theme defaults.
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const on = page.getByRole('switch', { name: 'Resized on', exact: true })
      await expect(on).toBeChecked()
      await expect(on).toHaveCSS('background-color', 'rgb(37, 99, 235)')
      const metrics = await page.getByRole('switch').evaluateAll((controls) =>
        controls.map((node) => {
          const box = node.getBoundingClientRect()
          const css = getComputedStyle(node)
          const thumb = getComputedStyle(node, '::before')
          return {
            name: node.getAttribute('aria-label'),
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            background: css.backgroundColor,
            radius: css.borderTopLeftRadius,
            opacity: css.opacity,
            thumbContent: thumb.content,
            thumbWidth: thumb.width,
            thumbHeight: thumb.height,
            thumbBackground: thumb.backgroundColor,
            translate: thumb.translate,
            childThumbCount: node.querySelectorAll('[data-slot="switch-thumb"], span').length
          }
        })
      )
      writeFileSync(info.outputPath(`${variant}-metrics.json`), JSON.stringify(metrics, null, 2))
      for (const expected of data.nodes) {
        const actual = metrics.find((item) => item.name === expected.name)
        expect(actual).toBeDefined()
        expect(actual?.width).toBe(expected.width)
        expect(actual?.height).toBe(expected.height)
        expect(actual?.thumbContent).toBe('""')
        expect(actual?.childThumbCount).toBe(0)
        expect(actual?.thumbBackground).toBe('rgb(255, 255, 255)')
      }
      expect(
        Number.parseFloat(metrics.find((item) => item.name === 'Resized on')?.thumbWidth ?? '')
      ).toBeCloseTo(35.2, 1)
      expect(metrics.find((item) => item.name === 'Default off')?.background).toBe(
        'rgb(203, 213, 225)'
      )
      expect(metrics.find((item) => item.name === 'Disabled on')?.opacity).toBe('0.45')
      expect(metrics.find((item) => item.name === 'Narrow')?.thumbWidth).toBe('9px')
      expect(
        Number.parseFloat(metrics.find((item) => item.name === 'Resized on')?.translate ?? '')
      ).toBeCloseTo(40, 1)
      expect(
        Number.parseFloat(metrics.find((item) => item.name === 'Padded on')?.translate ?? '')
      ).toBeCloseTo(62, 1)
      const image = await page.screenshot({
        path: info.outputPath(`${variant}.png`),
        animations: 'disabled',
        scale: 'css',
        clip: { x: 0, y: 0, width: 380, height: 300 }
      })
      expect(image).toMatchSnapshot(`${variant}.png`, { maxDiffPixels: 0, threshold: 0.2 })
      await on.click()
      await expect(on).not.toBeChecked()
      await expect(on).toHaveCSS('background-color', 'rgb(203, 213, 225)')
      expect(await on.evaluate((node) => getComputedStyle(node, '::before').translate)).toBe('none')
      await on.press('Space')
      await expect(on).toBeChecked()
      await on.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await expect(on).toBeFocused()
      const focus = await on.evaluate((node) => ({
        visible: node.matches(':focus-visible'),
        shadow: getComputedStyle(node).boxShadow,
        outline: getComputedStyle(node).outlineStyle
      }))
      expect(focus.visible).toBe(true)
      expect(focus.shadow !== 'none' || focus.outline !== 'none').toBe(true)
      const disabled = page.getByRole('switch', { name: 'Disabled on', exact: true })
      await expect(disabled).toBeDisabled()
      await disabled.click({ force: true })
      await expect(disabled).toBeChecked()
    })
  })
}
