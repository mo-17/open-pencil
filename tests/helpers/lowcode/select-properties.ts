import type { Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { prepareInputFonts } from '#tests/helpers/plugins/input-components'

export async function prepareSelectPropertiesEditor(page: Page) {
  await prepareInputFonts(page)
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  return canvas
}

export async function createSelectPropertiesFixture(page: Page) {
  return page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Missing editor')
    const first = store.createShape('SELECT', 100, 100, 240, 44)
    const second = store.createShape('SELECT', 100, 180, 240, 44)
    const bound = store.createShape('SELECT', 100, 260, 240, 44)
    store.graph.updateNode(first, {
      name: 'Static choices',
      interactiveProps: {
        value: 'b',
        options: [
          { label: 'Alpha', value: 'a' },
          { label: 'Beta', value: 'b' },
          { label: 'Unavailable', value: 'c', disabled: true }
        ]
      }
    })
    store.graph.updateNode(second, {
      name: 'Other choices',
      interactiveProps: {
        multiple: true,
        value: ['east'],
        options: [
          { label: 'East', value: 'east' },
          { label: 'West', value: 'west' }
        ]
      }
    })
    store.graph.updateNode(store.state.currentPageId, {
      state: [
        { id: 'selected_topics', name: 'selected_topics', type: 'array', defaultValue: ['a'] }
      ]
    })
    store.graph.updateNode(bound, {
      name: 'Bound choices',
      interactiveProps: {
        multiple: true,
        value: ['a'],
        options: [
          { label: 'Bound alpha', value: 'a' },
          { label: 'Bound beta', value: 'b' }
        ]
      },
      bindings: { value: { kind: 'ref', stateId: 'selected_topics' } }
    })
    store.select([first])
    return { first, second, bound }
  })
}

export async function readSelectProperties(page: Page, id: string) {
  return page.evaluate(
    (nodeId) => window.openPencil?.getStore?.().graph.getNode(nodeId)?.interactiveProps,
    id
  )
}
