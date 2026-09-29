import { expect, type Locator, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

import { expansionField, type ExpansionRenderer } from './component-expansion'

export type ContentModule = 'code-block' | 'markdown'
export const CONTENT_MODULES = ['code-block', 'markdown'] as const
const names: Record<ContentModule, string> = { 'code-block': 'Code Block', markdown: 'Markdown' }

export function contentSource(page: Page, module: ContentModule) {
  return expansionField(page, module === 'code-block' ? 'code' : 'source').getByTestId(
    'multiline-module-text-source'
  )
}

export async function insertContentModule(page: Page, module: ContentModule) {
  await page.getByTestId('toolbar-plugin-modules').click()
  await page.getByTestId(`toolbar-plugin-module-open-pencil.${module}-${module}`).click()
  await expect(contentSource(page, module)).toBeVisible()
}

export async function prepareContentModule(
  page: Page,
  renderer: ExpansionRenderer,
  module: ContentModule
) {
  await page.goto(`/?test&no-rulers&renderer=${renderer}`)
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await page.getByTestId('settings-plugins-view').getByText('Browse', { exact: true }).click()
  await page.getByTestId('plugin-discover-search').fill(names[module])
  await page.getByTestId(`plugin-install-open-pencil.${module}`).click()
  await expect(page.getByTestId(`plugin-installed-open-pencil.${module}`)).toBeVisible()
  await page.getByTestId(`plugin-enabled-open-pencil.${module}`).click()
  await page.getByTestId('app-settings-done').click()
  await insertContentModule(page, module)
  return canvas
}

export async function selectedContentNodeId(page: Page) {
  return page.evaluate(() => {
    const id = [...window.openPencil.getStore().state.selectedIds][0]
    if (!id) throw new Error('Selected content module unavailable')
    return id
  })
}

/** Read document state only; edits and selection use visible editor controls. */
export async function savedContentSource(page: Page, id: string, module: ContentModule) {
  return page.evaluate(
    ({ id, module }) => {
      const config = window.openPencil.getStore().graph.getNode(id)?.interactiveProps
        ?.module?.config
      const value = config?.[module === 'code-block' ? 'code' : 'source']
      if (typeof value !== 'string') throw new Error('Saved module content unavailable')
      return value
    },
    { id, module }
  )
}

export async function selectContentLayer(page: Page, id: string) {
  await page.locator(`[data-node-id="${id}"]`).getByTestId('layers-item').click()
}

/** Delay native blur/change delivery across a real UI selection or retained deactivation. */
export async function deferContentCommit(source: Locator) {
  const input = await source.elementHandle()
  if (!input) throw new Error('Content textarea unavailable')
  const blocker = await input.evaluateHandle((element) => {
    const block = (event: Event) => event.stopImmediatePropagation()
    element.addEventListener('blur', block, true)
    element.addEventListener('change', block, true)
    return block
  })
  async function release() {
    await input.evaluate((element, block) => {
      element.removeEventListener('blur', block, true)
      element.removeEventListener('change', block, true)
    }, blocker)
  }
  return {
    async deliver() {
      await release()
      await input.evaluate((element) => {
        element.dispatchEvent(new Event('change', { bubbles: true }))
        element.dispatchEvent(new FocusEvent('blur'))
      })
    },
    async dispose() {
      await release()
      await blocker.dispose()
      await input.dispose()
    }
  }
}
