import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear()

type InstanceChildIds = {
  instanceId: string
  componentId: string | null
  textId: string
  rectId: string
}

async function setupVariantInstance() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page not found')

    const set = store.graph.createNode('COMPONENT_SET', page.id, {
      name: 'Button',
      x: 80,
      y: 80,
      width: 260,
      height: 120,
      componentPropertyDefinitions: [
        {
          id: 'prop:type',
          name: 'Type',
          type: 'VARIANT',
          defaultValue: 'Primary',
          variantOptions: ['Primary', 'Secondary']
        }
      ]
    })
    const primary = store.graph.createNode('COMPONENT', set.id, {
      name: 'Type=Primary',
      x: 0,
      y: 0,
      width: 120,
      height: 44,
      componentPropertyValues: { Type: 'Primary' }
    })
    store.graph.createNode('RECTANGLE', primary.id, {
      name: 'Bg',
      width: 120,
      height: 44,
      fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.9, a: 1 }, opacity: 1, visible: true }]
    })
    store.graph.createNode('TEXT', primary.id, {
      name: 'Label',
      text: 'Primary',
      width: 80,
      height: 20
    })

    const secondary = store.graph.createNode('COMPONENT', set.id, {
      name: 'Type=Secondary',
      x: 140,
      y: 0,
      width: 132,
      height: 44,
      componentPropertyValues: { Type: 'Secondary' }
    })
    store.graph.createNode('RECTANGLE', secondary.id, {
      name: 'Bg',
      width: 132,
      height: 44,
      fills: [
        { type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.85, a: 1 }, opacity: 1, visible: true }
      ]
    })
    store.graph.createNode('TEXT', secondary.id, {
      name: 'Label',
      text: 'Secondary',
      width: 96,
      height: 20
    })

    const instance = store.graph.createInstance(primary.id, page.id, { x: 260, y: 200 })
    if (!instance) throw new Error('Instance not created')
    store.select([instance.id])
    store.requestRender()
    return { primaryId: primary.id, secondaryId: secondary.id, instanceId: instance.id }
  })
}

async function selectedInstanceChildren(): Promise<InstanceChildIds> {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const instanceId = [...store.state.selectedIds][0]
    const instance = instanceId ? store.graph.getNode(instanceId) : null
    if (!instance) throw new Error('Instance not selected')
    const children = store.graph.getChildren(instance.id)
    const text = children.find((child) => child.type === 'TEXT')
    const rect = children.find((child) => child.type === 'RECTANGLE')
    if (!text || !rect) throw new Error('Instance children not found')
    return {
      instanceId: instance.id,
      componentId: instance.componentId,
      textId: text.id,
      rectId: rect.id
    }
  })
}

async function selectedInstanceSnapshot() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const instanceId = [...store.state.selectedIds][0]
    const instance = instanceId ? store.graph.getNode(instanceId) : null
    if (!instance) throw new Error('Instance not selected')
    const children = store.graph.getChildren(instance.id)
    const text = children.find((child) => child.type === 'TEXT')
    const rect = children.find((child) => child.type === 'RECTANGLE')
    const fill = rect?.fills[0]
    return {
      componentId: instance.componentId,
      overrides: instance.overrides,
      text: text?.text,
      fillColor: fill?.type === 'SOLID' ? fill.color : null,
      childIds: children.map((child) => child.id)
    }
  })
}

test('component props panel edits variant, text, and fill props', async () => {
  const ids = await setupVariantInstance()
  await editor.canvas.waitForRender()

  const panel = editor.page.getByTestId('lowcode-component-props')
  await panel.scrollIntoViewIfNeeded()
  await expect(panel).toBeVisible()

  await editor.page.getByTestId('variant-section').getByTestId('app-select-trigger').click()
  await editor.page.getByRole('option', { name: 'Secondary' }).click()
  await editor.canvas.waitForRender()

  const afterSwitch = await selectedInstanceChildren()
  expect(afterSwitch.componentId).toBe(ids.secondaryId)

  const textInput = editor.page.getByTestId(`component-prop-text-${afterSwitch.textId}`)
  await textInput.fill('Launch')
  await textInput.press('Tab')
  await editor.canvas.waitForRender()

  const fillInput = editor.page.getByTestId(`component-prop-fill-${afterSwitch.rectId}`)
  await fillInput.fill('#00ff00')
  await fillInput.press('Tab')
  await editor.canvas.waitForRender()

  expect(await selectedInstanceSnapshot()).toMatchObject({
    componentId: ids.secondaryId,
    text: 'Launch',
    overrides: {
      [`${afterSwitch.textId}:text`]: true,
      [`${afterSwitch.rectId}:fills`]: true
    },
    fillColor: { r: 0, g: 1, b: 0, a: 1 }
  })

  await editor.page.getByTestId(`component-prop-text-reset-${afterSwitch.textId}`).click()
  await editor.page.getByTestId(`component-prop-fill-reset-${afterSwitch.rectId}`).click()
  await editor.canvas.waitForRender()

  expect(await selectedInstanceSnapshot()).toMatchObject({
    componentId: ids.secondaryId,
    text: 'Secondary',
    overrides: {}
  })
  editor.canvas.assertNoErrors()
})
