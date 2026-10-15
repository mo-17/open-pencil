import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { FontManager } from '@open-pencil/core/text'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'
import { parseCompilerFigOutput } from '#tests/helpers/compiler/output'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'

function diskFixture(path: string, create: boolean) {
  if (create) {
    mkdirSync(dirname(path), { recursive: true })
    execFileSync(
      'bun',
      [
        'tests/helpers/compiler/components/templates/compile-fig.ts',
        'react',
        path,
        '--create-fixture'
      ],
      {
        cwd: process.cwd(),
        maxBuffer: 16 * 1024 * 1024
      }
    )
  }
  return readFileSync(path)
}

test.use({ viewport: { width: 1400, height: 1000 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: saved RADIO paints CJK options and refreshes bound initial selection`, async ({
    page
  }, info) => {
    test.setTimeout(90000)
    const supplied = process.env.OPENPENCIL_TEMPLATE_FIG_PATH
    const path = supplied ? resolve(supplied) : info.outputPath('all-templates.fig')
    const bytes = diskFixture(path, !supplied)
    await trackFontModuleResources(page)
    await mockFontsource(page, [])
    await page.goto(`/?test&renderer=${renderer}&navigation-benchmark`)
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    const ids = await page.evaluate(async (data) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

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
      if (!response.ok) throw new Error('Licensed CJK font fixture unavailable')
      fontManager.markLoaded('Noto Sans CJK SC', 'Regular', await response.arrayBuffer())
      fontManager.setCJKFallbackFamily('Noto Sans CJK SC')
      await store.openFigFile(new File([new Uint8Array(data)], 'all-templates.fig'))
      const root = store.graph
        .getChildren(store.state.currentPageId)
        .find((node) => node.name === '单选组')
      const radio = root && store.graph.getChildren(root.id).find((node) => node.type === 'RADIO')
      if (!root || !radio) throw new Error('Radio template missing')
      await store.loadFontsForNodes([root.id])
      store.select([radio.id])
      store.zoomToBounds(
        root.x - 30,
        root.y - 30,
        root.x + root.width + 30,
        root.y + root.height + 30
      )
      store.requestRender()
      return { root: root.id, radio: radio.id }
    }, Array.from(bytes))
    await page.evaluate(() => {
      if (!window.openPencil) throw new Error('Editor test API is unavailable')
      return window.openPencil?.test?.navigation?.waitForSettlement()
    })
    await page.screenshot({ path: info.outputPath(`${renderer}-editor-radio.png`) })
    const result = await page.evaluate(async (ids) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const store = window.openPencil?.getStore?.()
      const root = store?.graph.getNode(ids.root)
      const radio = store?.graph.getNode(ids.radio)
      if (!store || !root || !radio) throw new Error('Imported radio missing')
      const render = async () => {
        const png = await store.renderExportImage([root.id], 1, 'PNG')
        if (!png?.length) throw new Error('Radio export failed')
        const image = await createImageBitmap(
          new Blob([new Uint8Array(png)], { type: 'image/png' })
        )
        const output = document.createElement('canvas')
        output.width = image.width
        output.height = image.height
        const ctx = output.getContext('2d')
        if (!ctx) throw new Error('Pixel reader unavailable')
        ctx.drawImage(image, 0, 0)
        image.close()
        return { png: Array.from(png), pixels: ctx.getImageData(0, 0, output.width, output.height) }
      }
      const initial = await render()
      const updateBoundRadioValue = () => {
        const pageNode = store.graph.getNode(store.state.currentPageId)
        const binding = radio.bindings?.value
        if (binding?.kind === 'docState') {
          const document = store.graph.getNode(store.graph.rootId)
          if (!document) throw new Error('Document state unavailable')
          store.graph.updateNode(document.id, {
            lowcodeDocumentState: (document.lowcodeDocumentState ?? []).map((state) =>
              state.name === binding.docStateName ? { ...state, defaultValue: '团队' } : state
            )
          })
        } else if (pageNode && binding?.kind === 'ref') {
          store.graph.updateNode(pageNode.id, {
            state: (pageNode.state ?? []).map((state) =>
              state.id === binding.stateId ? { ...state, defaultValue: '团队' } : state
            )
          })
        } else throw new Error('Template must use a writable state binding')
      }
      updateBoundRadioValue()
      const changed = await render()
      const changedPixels = { count: 0, minX: initial.pixels.width, maxX: -1 }
      for (let i = 0; i < initial.pixels.data.length; i += 4) {
        if (
          [0, 1, 2, 3].some(
            (channel) => initial.pixels.data[i + channel] !== changed.pixels.data[i + channel]
          )
        ) {
          changedPixels.count++
          const x = (i / 4) % initial.pixels.width
          changedPixels.minX = Math.min(changedPixels.minX, x)
          changedPixels.maxX = Math.max(changedPixels.maxX, x)
        }
      }
      const radioPosition = store.graph.getAbsolutePosition(radio.id)
      const rootPosition = store.graph.getAbsolutePosition(root.id)
      const x = radioPosition.x - rootPosition.x
      const y = radioPosition.y - rootPosition.y
      const rowHeight = Math.max(20, radio.lineHeight || radio.fontSize * 1.5)
      const rowInk = [0, 1].map((row) => {
        let count = 0
        for (
          let py = Math.ceil(y + row * (rowHeight + 8));
          py < y + row * (rowHeight + 8) + rowHeight;
          py++
        ) {
          for (let px = Math.ceil(x + 24); px < x + 60; px++) {
            const i = (py * initial.pixels.width + px) * 4
            if (
              initial.pixels.data[i] < 150 &&
              initial.pixels.data[i + 1] < 150 &&
              initial.pixels.data[i + 2] < 150
            )
              count++
          }
        }
        return count
      })
      store.requestRender()
      return {
        initial: initial.png,
        changed: changed.png,
        changedPixels,
        rowInk,
        x,
        y,
        width: root.width,
        height: root.height,
        type: radio.type,
        children: radio.childIds
      }
    }, ids)
    expect(result.rowInk[0], 'First CJK option must have visible glyphs').toBeGreaterThan(15)
    expect(result.rowInk[1], 'Second CJK option must have visible glyphs').toBeGreaterThan(15)
    expect(result.changedPixels.count, 'Bound state must update selected circle').toBeGreaterThan(5)
    expect(result.changedPixels.minX).toBeGreaterThanOrEqual(result.x)
    expect(
      result.changedPixels.maxX,
      'Changing selection must not change option text'
    ).toBeLessThan(result.x + 24)
    expect(result.type).toBe('RADIO')
    expect(result.children).toEqual([])
    for (const state of ['initial', 'changed'] as const) {
      const output = info.outputPath(`${renderer}-radio-${state}.png`)
      writeFileSync(output, Buffer.from(result[state]))
      await info.attach(state, { path: output, contentType: 'image/png' })
    }
    await page.evaluate(() => {
      if (!window.openPencil) throw new Error('Editor test API is unavailable')
      return window.openPencil?.test?.navigation?.waitForSettlement()
    })
    await page.screenshot({ path: info.outputPath(`${renderer}-editor-radio-team.png`) })
    const { initial: _initial, changed: _changed, ...measurements } = result
    writeFileSync(
      info.outputPath('radio-evidence.json'),
      JSON.stringify(
        { path, sha256: createHash('sha256').update(bytes).digest('hex'), ...measurements },
        null,
        2
      )
    )
    canvas.assertNoErrors()
  })
}

for (const target of ['react', 'vue'] as const) {
  test(`${target}: saved RADIO stays exclusive and updates feedback using keyboard and pointer`, async ({
    page
  }, info) => {
    test.setTimeout(90000)
    const supplied = process.env.OPENPENCIL_TEMPLATE_FIG_PATH
    const path = supplied ? resolve(supplied) : info.outputPath('all-templates.fig')
    diskFixture(path, !supplied)
    const compiled = parseCompilerFigOutput(
      execFileSync(
        'bun',
        ['tests/helpers/compiler/components/templates/compile-fig.ts', target, path],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024
        }
      )
    )
    await withComponentTemplateFiles(page, target, new Map(compiled.files), async () => {
      const personal = page.getByRole('radio', { name: '个人', exact: true })
      const team = page.getByRole('radio', { name: '团队', exact: true })
      await expect(personal).toBeChecked()
      await expect(team).not.toBeChecked()
      await team.check()
      await expect(team).toBeChecked()
      await expect(personal).not.toBeChecked()
      await expect(page.getByText('当前值: 团队', { exact: true })).toBeVisible()
      await team.press('ArrowUp')
      await expect(personal).toBeChecked()
      await expect(team).not.toBeChecked()
      await expect(page.getByText('当前值: 个人', { exact: true })).toBeVisible()
      await page
        .getByRole('radiogroup')
        .screenshot({ path: info.outputPath(`${target}-radio-preview.png`) })
    })
  })
}
