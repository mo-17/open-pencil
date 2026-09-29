import { expect, test } from 'bun:test'

import {
  ALERT_MODULE_DEFAULT_CONFIG,
  ALERT_MODULE_DEFINITION,
  alertAppearance,
  createAlertModuleFrameOverrides,
  createAlertModuleInstance,
  resolveAlertModule
} from '#core/plugins/alert'

test('Alert accepts every semantic appearance and either plain-text message field', () => {
  for (const tone of ['info', 'success', 'warning', 'error']) {
    for (const variant of ['soft', 'outlined', 'filled']) {
      const module = createAlertModuleInstance({
        tone,
        variant,
        title: '操作提示',
        description: '<b>此内容保持纯文本</b>'
      })
      const resolved = resolveAlertModule(module)
      expect(resolved?.ok).toBe(true)
      if (!resolved?.ok) throw new Error('Alert did not resolve')
      expect(resolved.config.description).toBe('<b>此内容保持纯文本</b>')
      const colors = alertAppearance(resolved.config)
      expect(colors.foreground).not.toBe(colors.background)
    }
  }
  expect(() => createAlertModuleInstance({ title: '', description: '说明' })).not.toThrow()
  expect(() => createAlertModuleInstance({ title: '标题', description: '' })).not.toThrow()
  expect(createAlertModuleFrameOverrides({ borderRadius: 16 }).cornerRadius).toBe(16)
  expect(ALERT_MODULE_DEFINITION.fields.map((field) => field.path[0]).sort()).toEqual(
    Object.keys(ALERT_MODULE_DEFAULT_CONFIG).sort()
  )
})

test('Alert rejects ambiguous, unbounded and executable configuration without coercion', () => {
  for (const config of [
    { tone: 'fatal' },
    { variant: 'custom' },
    { announcement: 'automatic' },
    { title: '', description: '   ' },
    { title: 'x'.repeat(121) },
    { description: 'x'.repeat(2001) },
    { showIcon: 1 },
    { closable: 'false' },
    { closeLabel: '' },
    { closeLabel: 'x'.repeat(81) },
    { fontSize: 9 },
    { fontSize: 25 },
    { fontSize: Number.NaN },
    { borderRadius: -1 },
    { borderRadius: 25 },
    { html: '<script>alert(1)</script>' },
    { onClose: 'fetch(...)' },
    { dismissed: true }
  ])
    expect(() => createAlertModuleInstance(config)).toThrow()
  const module = createAlertModuleInstance()
  for (const key of Object.keys(ALERT_MODULE_DEFAULT_CONFIG)) {
    const config = Object.fromEntries(
      Object.entries(module.config).filter(([name]) => name !== key)
    )
    expect(resolveAlertModule({ ...module, config })?.ok).toBe(false)
  }
  for (const configVersion of [0, 2, '1', 1.1])
    expect(resolveAlertModule({ ...module, configVersion })?.ok).toBe(false)
  expect(resolveAlertModule({ ...module, pluginId: 'other.alert' })).toBeNull()
})

test('Alert resolution preserves authored data and does not read accessors or share dismissal state', () => {
  const module = createAlertModuleInstance({ title: '本地提示' })
  const before = structuredClone(module)
  const resolved = resolveAlertModule(module)
  if (!resolved?.ok) throw new Error('Alert did not resolve')
  resolved.config.title = 'Changed'
  expect(module).toEqual(before)
  let reads = 0
  Object.defineProperty(module.config, 'title', {
    enumerable: true,
    get() {
      reads++
      return 'unsafe'
    }
  })
  expect(resolveAlertModule(module)?.ok).toBe(false)
  expect(reads).toBe(0)
  expect(createAlertModuleInstance().config).toEqual(ALERT_MODULE_DEFAULT_CONFIG)
  expect(Object.keys(createAlertModuleInstance().config)).not.toContain('dismissed')
})
