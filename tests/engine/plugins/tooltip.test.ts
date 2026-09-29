import { expect, test } from 'bun:test'

import {
  TOOLTIP_MODULE_DEFAULT_CONFIG,
  TOOLTIP_MODULE_DEFINITION,
  createTooltipModuleInstance,
  resolveTooltipModule,
  createTooltipModuleFrameOverrides
} from '#core/plugins/tooltip'

test('Tooltip retains plain help text in a strict portable frame contract', () => {
  const module = createTooltipModuleInstance({ triggerLabel: '查看说明', content: '<b>纯文本</b>' })
  expect(resolveTooltipModule(module)).toMatchObject({
    ok: true,
    config: { content: '<b>纯文本</b>' }
  })
  expect(createTooltipModuleFrameOverrides().interactiveProps?.module).toEqual(
    createTooltipModuleInstance()
  )
  expect(TOOLTIP_MODULE_DEFINITION.fields.map((field) => field.path[0]).sort()).toEqual(
    Object.keys(TOOLTIP_MODULE_DEFAULT_CONFIG).sort()
  )
  for (const placement of ['top', 'right', 'bottom', 'left'])
    expect(resolveTooltipModule(createTooltipModuleInstance({ placement }))?.ok).toBe(true)
  expect('initialOpen' in module.config).toBe(false)
})
test('Tooltip rejects coercion, incomplete versions, executable configuration and unsupported slots', () => {
  for (const invalid of [
    { content: '' },
    { content: 'x'.repeat(1001) },
    { triggerLabel: '' },
    { placement: 'auto' },
    { gap: -1 },
    { gap: 33 },
    { maxWidth: 601 },
    { maxWidth: '280' },
    { fontSize: 9 },
    { openDelay: 2001 },
    { closeDelay: 1.5 },
    { html: '<a>unsafe</a>' },
    { contentChildName: 'unsupported' },
    { initialOpen: true },
    { backgroundColor: 'url(https://example.com)' }
  ])
    expect(() => createTooltipModuleInstance(invalid)).toThrow()
  const module = createTooltipModuleInstance()
  for (const key of Object.keys(TOOLTIP_MODULE_DEFAULT_CONFIG)) {
    const config = Object.fromEntries(
      Object.entries(module.config).filter(([name]) => name !== key)
    )
    expect(resolveTooltipModule({ ...module, config })?.ok).toBe(false)
  }
  expect(resolveTooltipModule({ ...module, configVersion: 2 })?.ok).toBe(false)
  expect(resolveTooltipModule({ ...module, pluginId: 'other.tooltip' })).toBeNull()
  let reads = 0
  Object.defineProperty(module.config, 'content', {
    enumerable: true,
    get() {
      reads++
      return 'secret'
    }
  })
  expect(resolveTooltipModule(module)?.ok).toBe(false)
  expect(reads).toBe(0)
})
