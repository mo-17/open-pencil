import type { Page } from '@playwright/test'

/** Seed independent declarations; binding and history are exercised through the inspector. */
export async function prepareStepperStates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const initializedEditorBridge = window.openPencil
    if (!initializedEditorBridge?.getStore) throw new Error('OpenPencil store not initialized')

    const editor = initializedEditorBridge.getStore()
    editor.updateNode(editor.state.currentPageId, {
      state: [
        { id: 'progress', name: 'progress', type: 'number', defaultValue: 0 },
        { id: 'computed', name: 'computed', type: 'number', defaultValue: 1, computedExpr: '1' },
        { id: 'text', name: 'text', type: 'string', defaultValue: '0' }
      ]
    })
    editor.updateNode(editor.graph.rootId, {
      lowcodeDocumentState: [
        { id: 'doc-progress', name: 'docProgress', type: 'number', defaultValue: 2 }
      ]
    })
  })
}

export async function makeStepperDefaultInvalid(page: Page): Promise<void> {
  await page.evaluate(() => {
    const initializedEditorBridge = window.openPencil
    if (!initializedEditorBridge?.getStore) throw new Error('OpenPencil store not initialized')

    const editor = initializedEditorBridge.getStore()
    editor.updateNode(editor.graph.rootId, {
      lowcodeDocumentState: [
        { id: 'doc-progress', name: 'docProgress', type: 'number', defaultValue: 9 }
      ]
    })
  })
}
