import type { Page } from '@playwright/test'

import { readModuleInstance, type ModuleInstanceV1 } from '@open-pencil/scene-graph'

/** Validate persisted module metadata with the same parser used by the editor. */
export async function readSelectedModule(
  page: Page
): Promise<{ nodeId: string; module: ModuleInstanceV1 }> {
  const snapshot = await page.evaluate(() => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('OpenPencil store not initialized')
    const node = editor.graph.getNode([...editor.state.selectedIds][0])
    if (!node) throw new Error('Selected module unavailable')
    return { nodeId: node.id, module: node.interactiveProps?.module }
  })
  const module = readModuleInstance(snapshot.module)
  if (!module) throw new Error('Selected module metadata invalid')
  return { nodeId: snapshot.nodeId, module }
}

export async function readNodeModule(page: Page, nodeId: string): Promise<ModuleInstanceV1> {
  const snapshot = await page.evaluate((id) => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('OpenPencil store not initialized')
    return editor.graph.getNode(id)?.interactiveProps?.module
  }, nodeId)
  const module = readModuleInstance(snapshot)
  if (!module) throw new Error('Module metadata unavailable')
  return module
}
