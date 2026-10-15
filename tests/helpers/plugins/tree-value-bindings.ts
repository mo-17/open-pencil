import type { Page } from '@playwright/test'

import { readNodeModule, readSelectedModule } from './module'

export type TreePresentation = 'tree' | 'select'

/** Seed a typed value and fixed layout; inspector controls own all state edits in the test. */
export async function prepareTreeControlFixture(page: Page, presentation: TreePresentation) {
  const { nodeId, module } = await readSelectedModule(page)
  return page.evaluate(
    ({ mode, nodeId, module }) => {
      const initializedEditorBridge = window.openPencil
      if (!initializedEditorBridge?.getStore) throw new Error('OpenPencil store not initialized')

      const editor = initializedEditorBridge.getStore(),
        node = editor.graph.getNode(nodeId)
      if (!node || !module) throw new Error('Inserted Tree module unavailable')
      editor.updateNode(editor.state.currentPageId, {
        state: [{ id: 'category', name: 'category', type: 'string', defaultValue: 'design' }]
      })
      editor.updateNode(node.id, {
        width: 420,
        height: mode === 'tree' ? 320 : 84,
        bindings: { value: { kind: 'ref', stateId: 'category' } },
        interactiveProps: {
          ...node.interactiveProps,
          module: {
            ...module,
            config: {
              ...module.config,
              presentation: mode,
              label: 'Project categories / 项目分类',
              searchable: false
            }
          }
        }
      })
      return node.id
    },
    { mode: presentation, nodeId, module }
  )
}

export async function treeControlState(page: Page, nodeId: string) {
  const module = await readNodeModule(page, nodeId)
  const node = await page.evaluate((id) => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('OpenPencil store not initialized')
    const node = editor.graph.getNode(id)
    if (!node) throw new Error('Tree control unavailable')
    return { readOnly: node.interactiveProps?.readOnly === true, binding: node.bindings?.value }
  }, nodeId)
  return { ...node, disabled: module.config.disabled === true, module }
}

/** A second valid owner proves that the retained panel observes the new target's own flag. */
export async function selectIndependentTree(page: Page, nodeId: string) {
  return page.evaluate((id) => {
    const initializedEditorBridge = window.openPencil
    if (!initializedEditorBridge?.getStore) throw new Error('OpenPencil store not initialized')

    const editor = initializedEditorBridge.getStore(),
      node = editor.graph.getNode(id)
    if (!node) throw new Error('Tree control unavailable')
    const other = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      name: 'Independent Tree',
      x: node.x + 40,
      y: node.y + 40,
      width: node.width,
      height: node.height,
      bindings: structuredClone(node.bindings),
      interactiveProps: { ...structuredClone(node.interactiveProps), readOnly: false }
    })
    editor.select([other.id])
    return other.id
  }, nodeId)
}

export async function selectTreeControl(page: Page, nodeId: string) {
  await page.evaluate((id) => {
    const initializedEditorBridge = window.openPencil
    if (!initializedEditorBridge?.getStore) throw new Error('OpenPencil store not initialized')
    return initializedEditorBridge.getStore().select([id])
  }, nodeId)
}

export async function selectPlainFrame(page: Page) {
  await page.evaluate(() => {
    const initializedEditorBridge = window.openPencil
    if (!initializedEditorBridge?.getStore) throw new Error('OpenPencil store not initialized')

    const editor = initializedEditorBridge.getStore(),
      frame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        name: 'Plain FRAME',
        width: 160,
        height: 100
      })
    editor.select([frame.id])
  })
}

/** Disabled text intentionally changes color, so settlement cannot poll normal glyph colors. */
export async function waitForTreeControlPaint(page: Page) {
  await page.waitForFunction(
    () => {
      const initializedEditorBridge = window.openPencil
      if (!initializedEditorBridge?.getStore) throw new Error('OpenPencil store not initialized')

      const editor = initializedEditorBridge.getStore(),
        renderers = editor.canvasRenderers.filter(
          (renderer) =>
            renderer.tracksSceneSettlement && renderer.pageId === editor.state.currentPageId
        )
      return (
        renderers.length > 0 &&
        renderers.every(
          (renderer) =>
            renderer.sceneBacking?.sceneVersion === editor.state.sceneVersion &&
            renderer.sceneBacking.fontGeneration === renderer.fontGeneration &&
            !renderer.sceneBackingBuild &&
            !renderer.sceneBackingNeedsCrispRender &&
            (!renderer.tiledSceneEnabled ||
              (renderer.tiledSceneCovered && !renderer.tiledScenePending))
        )
      )
    },
    undefined,
    { timeout: 15000 }
  )
}
