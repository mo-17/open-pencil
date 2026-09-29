import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { FontManager } from '@open-pencil/core/text'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'

test('editor canvas reopens text field styles from an on-disk FIG', async ({ page }, info) => {
  test.setTimeout(90000)
  const suppliedPath = process.env.OPENPENCIL_TEMPLATE_FIG_PATH
  const path = suppliedPath ? resolve(suppliedPath) : info.outputPath('all-templates.fig')
  if (!suppliedPath) {
    mkdirSync(dirname(path), { recursive: true })
    execFileSync(
      'bun',
      [
        'tests/helpers/compiler/components/templates/compile-fig.ts',
        'react',
        path,
        '--create-fixture'
      ],
      { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 }
    )
  }
  const bytes = readFileSync(path)
  await trackFontModuleResources(page)
  await mockFontsource(page, [])
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const result = await page.evaluate(async (data) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Editor unavailable')
    const moduleURL = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => url.includes('/packages/core/src/text/fonts.ts'))
    if (!moduleURL) throw new Error('Font manager module unavailable')
    const { fontManager } = (await import(/* @vite-ignore */ moduleURL)) as {
      fontManager: FontManager
    }
    const response = await fetch('/tests/fixtures/fonts/NotoSansCJK-Test.otf')
    if (!response.ok) throw new Error('Licensed local CJK font fixture unavailable')
    fontManager.markLoaded('Noto Sans CJK SC', 'Regular', await response.arrayBuffer())
    fontManager.setCJKFallbackFamily('Noto Sans CJK SC')
    await store.openFigFile(new File([new Uint8Array(data)], 'all-templates.fig'))
    const roots = store.graph.getChildren(store.state.currentPageId)
    const fields = []
    for (const [name, type] of [
      ['单行输入', 'INPUT'],
      ['多行输入', 'TEXTAREA']
    ]) {
      const root = roots.find((node) => node.name === name)
      if (!root) throw new Error(`Missing template ${name}`)
      const field = store.graph.getChildren(root.id).find((node) => node.name.endsWith(' field'))
      const node = field && store.graph.getChildren(field.id).find((node) => node.type === type)
      if (!node) throw new Error(`Missing control ${type}`)
      await store.loadFontsForNodes([root.id])
      const image = await store.renderExportImage([root.id], 2, 'PNG')
      if (!image?.length) throw new Error(`Canvas export failed for ${name}`)
      fields.push({
        name,
        type: node.type,
        width: node.width,
        height: node.height,
        fontSize: node.fontSize,
        lineHeight: node.lineHeight,
        padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft],
        image: Array.from(image)
      })
    }
    return { rootCount: roots.length, fields }
  }, Array.from(bytes))
  expect(result.rootCount).toBe(18)
  for (const field of result.fields) {
    expect(field.fontSize).toBe(16)
    expect(field.lineHeight).toBe(24)
    expect(field.height).toBe(field.type === 'INPUT' ? 44 : 128)
    expect(field.padding).toEqual(field.type === 'INPUT' ? [9, 12, 9, 12] : [12, 12, 12, 12])
    const screenshot = info.outputPath(`canvas-${field.type.toLowerCase()}.png`)
    writeFileSync(screenshot, Buffer.from(field.image))
    await info.attach(field.name, { path: screenshot, contentType: 'image/png' })
  }
  const evidencePath = info.outputPath('canvas-fig-style.json')
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        path,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.byteLength,
        rootCount: result.rootCount,
        fields: result.fields.map(({ image: _image, ...field }) => field)
      },
      null,
      2
    )
  )
  await info.attach('canvas-fig-style', { path: evidencePath, contentType: 'application/json' })
  canvas.assertNoErrors()
})
