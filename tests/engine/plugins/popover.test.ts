import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  POPOVER_MODULE_DEFAULT_CONFIG,
  POPOVER_MODULE_DEFINITION,
  createPopoverModuleInstance,
  createPopoverModuleFrameOverrides,
  resolvePopoverModule
} from '#core/plugins/popover'

test('Popover uses an ordinary strict frame with named editable content and explicit local-confirmation mode', () => {
  const module = createPopoverModuleInstance({
    mode: 'confirm',
    triggerLabel: '确认变更',
    content: '<script>纯文本</script>',
    contentChildName: '详细表单'
  })
  expect(resolvePopoverModule(module)).toMatchObject({
    ok: true,
    config: { mode: 'confirm', contentChildName: '详细表单' }
  })
  const frame = createPopoverModuleFrameOverrides({ mode: 'confirm' })
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, frame)
  expect(node.type).toBe('FRAME')
  expect(frame.interactiveProps?.module).toEqual(createPopoverModuleInstance({ mode: 'confirm' }))
  expect(POPOVER_MODULE_DEFINITION.fields.map((field) => field.path[0]).sort()).toEqual(
    Object.keys(POPOVER_MODULE_DEFAULT_CONFIG).sort()
  )
  for (const placement of ['top', 'right', 'bottom', 'left'])
    expect(createPopoverModuleInstance({ placement }).config.placement).toBe(placement)
  expect('initialOpen' in module.config).toBe(false)
})

test('Popover rejects unbounded, executable, coercible, partial and wrong-version configurations without invoking accessors', () => {
  for (const patch of [
    { triggerLabel: '' },
    { title: 'a'.repeat(161) },
    { content: 'a'.repeat(4001) },
    { contentChildName: 'a'.repeat(121) },
    { mode: 'delete' },
    { placement: 'auto' },
    { gap: -1 },
    { panelWidth: '320' },
    { panelWidth: 721 },
    { disabled: 'false' },
    { confirmLabel: '' },
    { cancelLabel: '' },
    { fontSize: 33 },
    { borderRadius: 0.5 },
    { accentColor: 'url(https://example.com)' },
    { initialOpen: true },
    { onConfirm: 'delete()' }
  ])
    expect(() => createPopoverModuleInstance(patch)).toThrow()
  const module = createPopoverModuleInstance()
  for (const key of Object.keys(module.config)) {
    const config = Object.fromEntries(
      Object.entries(module.config).filter(([name]) => name !== key)
    )
    expect(resolvePopoverModule({ ...module, config })?.ok).toBe(false)
  }
  expect(resolvePopoverModule({ ...module, configVersion: 2 })?.ok).toBe(false)
  expect(resolvePopoverModule({ ...module, pluginId: 'unrelated' })).toBeNull()
  let reads = 0
  Object.defineProperty(module.config, 'content', {
    enumerable: true,
    get() {
      reads++
      return 'unsafe'
    }
  })
  expect(resolvePopoverModule(module)?.ok).toBe(false)
  expect(reads).toBe(0)
})
