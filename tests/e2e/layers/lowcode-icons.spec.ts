import type { Locator } from '@playwright/test'

import { createAccordionModuleInstance, createTabsModuleInstance } from '@open-pencil/core/plugins'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

async function iconShape(icon: Locator): Promise<string> {
  return icon.evaluate((element) => element.innerHTML)
}

test('lowcode layers use distinct control icons while containers keep their layout icon', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const ids = await page.evaluate(() => {
    const store = window.openPencil.getStore()
    const graph = store.graph
    const parent = graph.createNode('FRAME', store.state.currentPageId, {
      name: 'Form wrapper',
      layoutMode: 'VERTICAL'
    })
    const controls = [
      'INPUT',
      'TEXTAREA',
      'BUTTON',
      'SELECT',
      'CHECKBOX',
      'RADIO',
      'SWITCH',
      'DATEPICKER',
      'FORM',
      'LIST'
    ] as const
    const nodes = controls.map((type) => graph.createNode(type, parent.id, { name: type }))
    store.select(nodes.map((node) => node.id))
    return { parent: parent.id, controls: nodes.map((node) => node.id) }
  })
  const icon = (id: string) => page.locator(`[data-node-id="${id}"] [data-slot="icon"]`).first()
  const shapes: string[] = []
  for (const id of ids.controls) {
    await expect(icon(id)).toBeVisible()
    shapes.push(await iconShape(icon(id)))
  }
  expect(new Set(shapes).size).toBe(ids.controls.length)
  expect(shapes).not.toContain(await iconShape(icon(ids.parent)))
  canvas.assertNoErrors()
})

test('module icon follows assignment, replacement, removal and undo without changing its frame type', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const id = await page.evaluate(() => {
    const store = window.openPencil.getStore()
    return store.graph.createNode('FRAME', store.state.currentPageId, {
      name: 'Module frame',
      layoutMode: 'VERTICAL'
    }).id
  })
  const icon = page.locator(`[data-node-id="${id}"] [data-slot="icon"]`).first()
  await expect(icon).toBeVisible()
  const plain = await iconShape(icon)
  await page.evaluate(
    ({ id, module }) => {
      window.openPencil
        .getStore()
        .updateNodeWithUndo(id, { interactiveProps: { module } }, 'Assign Tabs')
    },
    { id, module: createTabsModuleInstance() }
  )
  await expect.poll(() => iconShape(icon)).not.toBe(plain)
  const tabs = await iconShape(icon)
  await page.evaluate(
    ({ id, module }) => {
      window.openPencil
        .getStore()
        .updateNodeWithUndo(id, { interactiveProps: { module } }, 'Assign Accordion')
    },
    { id, module: createAccordionModuleInstance() }
  )
  await expect.poll(() => iconShape(icon)).not.toBe(tabs)
  const accordion = await iconShape(icon)
  await page.evaluate(
    (id) =>
      window.openPencil
        .getStore()
        .updateNodeWithUndo(id, { interactiveProps: {} }, 'Remove module'),
    id
  )
  await expect.poll(() => iconShape(icon)).toBe(plain)
  await canvas.undo()
  await expect.poll(() => iconShape(icon)).toBe(accordion)
  expect(
    await page.evaluate((id) => window.openPencil.getStore().graph.getNode(id)?.type, id)
  ).toBe('FRAME')
  canvas.assertNoErrors()
})
