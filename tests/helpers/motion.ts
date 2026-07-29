import type { Page } from '@playwright/test'

export async function readSelectedMotion(page: Page) {
  return page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return [...store.state.selectedIds].map((id) => store.graph.getNode(id)?.motion)
  })
}

export async function readMotionActionSnapshot(page: Page, buttonId: string) {
  return page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return {
      events: store.graph.getNode(id)?.events,
      workflows: store.graph.getNode(store.graph.rootId)?.lowcodeWorkflows
    }
  }, buttonId)
}
