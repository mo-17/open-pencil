import type { Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { loadInputFonts, prepareInputFonts } from '#tests/helpers/plugins/input-components'

export async function prepareInputFields(page: Page, renderer = 'retained') {
  await prepareInputFonts(page)
  await page.goto(`/?test&no-rulers&renderer=${renderer}`)
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await loadInputFonts(page)
  return canvas
}

/** Test fixture only; subsequent editing and selection use the visible design panel. */
export async function inputFieldsFixture(page: Page) {
  return page.evaluate(() => {
    const editor = window.openPencil.getStore()
    const first = editor.createShape('INPUT', 120, 140, 320, 44)
    const second = editor.createShape('INPUT', 120, 220, 320, 44)
    const multiple = editor.createShape('SELECT', 120, 300, 320, 44)
    editor.updateNode(first, {
      name: 'Suggested city',
      interactiveProps: {
        inputType: 'text',
        value: '厦门 Xiamen',
        suggestions: ['厦门', '泉州'],
        textColor: '#172B4D'
      },
      fontSize: 16,
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 9,
      paddingBottom: 9
    })
    editor.updateNode(second, { name: 'Other input', interactiveProps: { value: 'Keep me' } })
    editor.updateNode(multiple, {
      name: 'Multiple choices',
      interactiveProps: { multiple: true, options: ['Alpha', 'Beta'], value: [] }
    })
    editor.updateNode(editor.state.currentPageId, {
      state: [
        { id: 'string', name: 'stringState', type: 'string', defaultValue: '' },
        { id: 'number', name: 'numberState', type: 'number', defaultValue: 3 },
        { id: 'array', name: 'arrayState', type: 'array', defaultValue: ['Alpha'] }
      ]
    })
    editor.updateNode(editor.graph.rootId, {
      lowcodeDocumentState: [
        { id: 'doc-string', name: 'documentText', type: 'string', defaultValue: '' },
        { id: 'doc-array', name: 'documentArray', type: 'array', defaultValue: [] }
      ]
    })
    editor.select([first])
    return { first, second, multiple }
  })
}

export async function savedInputFields(page: Page, id: string) {
  return page.evaluate((nodeId) => {
    const node = window.openPencil.getStore().graph.getNode(nodeId)
    return { properties: node?.interactiveProps, binding: node?.bindings?.value }
  }, id)
}
