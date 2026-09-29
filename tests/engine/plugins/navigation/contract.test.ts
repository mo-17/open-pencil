import { describe, expect, test } from 'bun:test'

import { createBreadcrumbModuleInstance, resolveBreadcrumbModule } from '#core/plugins/breadcrumb'
import { createStepperModuleInstance, resolveStepperModule } from '#core/plugins/stepper'

describe('navigation module data boundaries', () => {
  test('round-trips independently owned configs and rejects unsupported versions', () => {
    for (const [create, resolve] of [
      [createStepperModuleInstance, resolveStepperModule],
      [createBreadcrumbModuleInstance, resolveBreadcrumbModule]
    ] as const) {
      const module = create()
      expect(resolve(module)?.ok).toBe(true)
      expect(resolve({ ...module, configVersion: 2 })?.ok).toBe(false)
      expect(resolve({ ...module, config: { ...module.config, script: 'alert(1)' } })?.ok).toBe(
        false
      )
      module.config.label = 'Changed'
      expect(create().config.label).not.toBe('Changed')
    }
  })
  test('stepper requires an in-range integer and bounded, valid steps', () => {
    for (const currentIndex of [-1, 0.5, 3, Number.NaN])
      expect(() => createStepperModuleInstance({ currentIndex })).toThrow()
    expect(() => createStepperModuleInstance({ items: [], currentIndex: 0 })).toThrow()
    const step = { title: '第一步', description: '', status: 'auto', disabled: false }
    expect(() => createStepperModuleInstance({ items: [step], currentIndex: 0 })).not.toThrow()
    expect(() =>
      createStepperModuleInstance({
        items: Array.from({ length: 13 }, () => step),
        currentIndex: 0
      })
    ).toThrow()
    expect(() =>
      createStepperModuleInstance({ items: [{ ...step, status: 'success' }], currentIndex: 0 })
    ).toThrow()
  })
  test('breadcrumb rejects executable and ambiguous URLs instead of repairing them', () => {
    for (const href of [
      ['javascript', 'alert(1)'].join(':'),
      'data:text/html,test',
      '//evil.example',
      '/\\evil.example',
      'https://user:secret@example.com/',
      'https://127.0.0.1/',
      'http://example.com/',
      '/path\nother'
    ]) {
      expect(() => createBreadcrumbModuleInstance({ items: [{ label: 'Link', href }] })).toThrow()
    }
    for (const href of ['', '/', '/library?view=grid', '#details', 'https://example.com/guide']) {
      expect(() =>
        createBreadcrumbModuleInstance({ items: [{ label: 'Link', href }] })
      ).not.toThrow()
    }
  })
  test('items reject holes and accessors without executing them', () => {
    let accessed = false
    const item = Object.defineProperty({ href: '/' }, 'label', {
      enumerable: true,
      get: () => {
        accessed = true
        return 'Label'
      }
    })
    expect(() => createBreadcrumbModuleInstance({ items: [item] })).toThrow()
    expect(accessed).toBe(false)
    expect(() =>
      createBreadcrumbModuleInstance({ items: Object.assign([], { length: 2 }) })
    ).toThrow()
  })
})
