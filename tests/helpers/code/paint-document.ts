import { execFileSync } from 'node:child_process'

import { expect, type Page } from '@playwright/test'

import type { SceneNode } from '@open-pencil/scene-graph'

import { parseJSONBytes } from '#tests/helpers/serialization'

export type CodePaintObservation = Pick<SceneNode, 'id' | 'width' | 'pluginData' | 'strokes'>

export async function openCodePaintDocument(
  page: Page,
  bytes?: number[],
  withChild = false
): Promise<void> {
  const data =
    bytes ??
    parseJSONBytes(
      execFileSync(
        'bun',
        [
          '-e',
          `import {codePaintFixture} from './tests/helpers/code/paint-fixture'; process.stdout.write(JSON.stringify([...await codePaintFixture(${withChild})]));`
        ],
        { encoding: 'utf8' }
      )
    )
  await page.evaluate(async (content) => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor not initialized')
    await editor.openFigFile(new File([new Uint8Array(content)], 'code-paint.fig'))
    const node = [...editor.graph.nodes.values()].find((node) => node.name === 'Code paint')
    if (!node) throw new Error('Code paint fixture missing')
    editor.select([node.id])
  }, data)
}

export function codeChildObservation(page: Page): Promise<Pick<SceneNode, 'id' | 'pluginData'>> {
  return page.evaluate(() => {
    const editor = window.openPencil?.getStore?.()
    const node =
      editor && [...editor.graph.nodes.values()].find((node) => node.name === 'Unchanged child')
    if (!node) throw new Error('Unchanged child missing')
    return { id: node.id, pluginData: node.pluginData }
  })
}

export function codeParentType(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = window.openPencil?.getStore?.()
    const node =
      editor && [...editor.graph.nodes.values()].find((node) => node.name === 'Code paint')
    if (!node) throw new Error('Code paint missing')
    return node.type
  })
}

/** The editor virtualizes lines; the product Copy action returns its complete source. */
export async function copyCodeSource(page: Page): Promise<string> {
  await page.context().grantPermissions(['clipboard-write'])
  const capture = await page.evaluateHandle(() => {
    const clipboard = navigator.clipboard
    const original = clipboard.write
    let text: string | undefined
    clipboard.write = async (items) => {
      const item = items[0]
      if (item) text = await (await item.getType('text/plain')).text()
    }
    return {
      read: () => text,
      restore: () => {
        clipboard.write = original
      }
    }
  })
  try {
    await page.getByTestId('code-panel-copy').click()
    await expect.poll(() => capture.evaluate((value) => value.read())).toBeTruthy()
    const source = await capture.evaluate((value) => value.read())
    if (!source) throw new Error('Code Copy did not provide source')
    return source
  } finally {
    await capture.evaluate((value) => value.restore())
    await capture.dispose()
  }
}

/** Read only the contract the Code UI edit and subsequent saved file must retain. */
export function codePaintObservation(page: Page): Promise<CodePaintObservation> {
  return page.evaluate(() => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor not initialized')
    const node = [...editor.graph.nodes.values()].find((node) => node.name === 'Code paint')
    if (!node) throw new Error('Code paint fixture missing')
    return { id: node.id, width: node.width, pluginData: node.pluginData, strokes: node.strokes }
  })
}
