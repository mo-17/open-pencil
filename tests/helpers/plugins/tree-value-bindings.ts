import type { Page } from '@playwright/test'

export type TreePresentation = 'tree' | 'select'

/** Seed a typed value and fixed layout; inspector controls own all state edits in the test. */
export async function prepareTreeControlFixture(page: Page, presentation: TreePresentation) {
  return page.evaluate((mode) => {
    const editor = window.openPencil.getStore(),
      node = editor.graph.getNode([...editor.state.selectedIds][0]),
      module = node?.interactiveProps?.module
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
  }, presentation)
}

export async function treeControlState(page: Page, nodeId: string) {
  return page.evaluate((id) => {
    const node = window.openPencil.getStore().graph.getNode(id),
      module = node?.interactiveProps?.module
    if (!node || !module) throw new Error('Tree control unavailable')
    return {
      readOnly: node.interactiveProps?.readOnly === true,
      disabled: module.config.disabled === true,
      binding: node.bindings?.value,
      module: structuredClone(module)
    }
  }, nodeId)
}

/** A second valid owner proves that the retained panel observes the new target's own flag. */
export async function selectIndependentTree(page: Page, nodeId: string) {
  return page.evaluate((id) => {
    const editor = window.openPencil.getStore(),
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
  await page.evaluate((id) => window.openPencil.getStore().select([id]), nodeId)
}

export async function selectPlainFrame(page: Page) {
  await page.evaluate(() => {
    const editor = window.openPencil.getStore(),
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
      const editor = window.openPencil.getStore(),
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
