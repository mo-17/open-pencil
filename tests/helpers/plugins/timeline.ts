import type { Page } from '@playwright/test'

import { readSelectedModule } from './module'

/** Simulate a collaborator update without clicking away from the open inspector popup. */
export async function reorderSelectedTimelineItems(page: Page) {
  const { nodeId, module } = await readSelectedModule(page)
  if (module.moduleType !== 'timeline') throw new Error('Timeline owner unavailable')
  const items = module.config.items
  if (!Array.isArray(items) || items.length < 2) throw new Error('Two timeline events required')
  await page.evaluate(
    ({ id, module }) => {
      const editor = window.openPencil?.getStore?.()
      const node = editor?.graph.getNode(id)
      if (!editor || !node) throw new Error('Timeline owner unavailable')
      editor.graph.updateNode(node.id, {
        interactiveProps: { ...node.interactiveProps, module }
      })
    },
    {
      id: nodeId,
      module: {
        ...module,
        config: { ...module.config, items: [items[1], items[0], ...items.slice(2)] }
      }
    }
  )
}

/** Keep an old option so a late pointer event targets the original popup, never a new row. */
export async function captureTimelineStatusChoice(page: Page, label: string) {
  const option = await page.getByRole('option', { name: label, exact: true }).elementHandle()
  if (!option) throw new Error('Timeline status option unavailable')
  return {
    connected: () => option.evaluate((element) => element.isConnected),
    deliver: () =>
      option.evaluate((element) => {
        element.dispatchEvent(
          new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })
        )
      }),
    dispose: () => option.dispose()
  }
}
