import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_PLUGIN_REGISTRY,
  MODAL_MODULE_CONFIG_VERSION,
  MODAL_MODULE_DEFAULT_CONFIG,
  MODAL_MODULE_DEFAULT_SIZE,
  MODAL_MODULE_LIMITS,
  MODAL_MODULE_TYPE,
  MODAL_PLUGIN_ID,
  createModalModuleFrameOverrides,
  createModalModuleInstance,
  resolveModalModule
} from '@open-pencil/core/plugins'

const CONFIG_KEYS = [
  'triggerLabel',
  'showTriggerIcon',
  'showTriggerLabel',
  'title',
  'content',
  'showCloseButton',
  'closeOnBackdrop',
  'closeOnEscape',
  'showCancelButton',
  'cancelLabel',
  'showConfirmButton',
  'confirmLabel',
  'panelWidth',
  'footerAlign',
  'panelBackground',
  'textColor',
  'accentColor',
  'overlayOpacity'
] as const

describe('built-in modal plugin', () => {
  test('registers the exact bounded default contract and trigger frame', () => {
    const definition = BUILTIN_PLUGIN_REGISTRY.getModule(MODAL_PLUGIN_ID, MODAL_MODULE_TYPE)
    const instance = createModalModuleInstance()
    const resolved = resolveModalModule(instance)

    expect(definition?.name).toBe('Modal')
    expect(definition?.configVersion).toBe(MODAL_MODULE_CONFIG_VERSION)
    expect(definition?.defaultSize).toEqual(MODAL_MODULE_DEFAULT_SIZE)
    expect(definition?.i18nNameKey).toBe('lowcodeModuleModalName')
    expect(definition?.i18nDescriptionKey).toBe('lowcodeModuleModalDescription')
    expect(definition?.fields.map((field) => [field.path, field.kind])).toEqual([
      [['triggerLabel'], 'text'],
      [['showTriggerIcon'], 'boolean'],
      [['showTriggerLabel'], 'boolean'],
      [['title'], 'text'],
      [['content'], 'text'],
      [['showCloseButton'], 'boolean'],
      [['closeOnBackdrop'], 'boolean'],
      [['closeOnEscape'], 'boolean'],
      [['showCancelButton'], 'boolean'],
      [['cancelLabel'], 'text'],
      [['showConfirmButton'], 'boolean'],
      [['confirmLabel'], 'text'],
      [['panelWidth'], 'number'],
      [['footerAlign'], 'select'],
      [['panelBackground'], 'color'],
      [['textColor'], 'color'],
      [['accentColor'], 'color'],
      [['overlayOpacity'], 'number']
    ])
    expect(Object.keys(instance.config)).toEqual(CONFIG_KEYS)
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected modal module to resolve')
    expect(resolved.config).toEqual(MODAL_MODULE_DEFAULT_CONFIG)
    expect(createModalModuleFrameOverrides()).toMatchObject({
      name: 'Modal',
      width: 180,
      height: 48,
      cornerRadius: 8,
      clipsContent: true,
      interactiveProps: {
        module: {
          pluginId: MODAL_PLUGIN_ID,
          moduleType: MODAL_MODULE_TYPE,
          configVersion: MODAL_MODULE_CONFIG_VERSION
        }
      }
    })
  })

  test('preserves bounded plain text and canonicalizes colors', () => {
    const instance = createModalModuleInstance({
      title: '',
      content: '<script>render this as plain text</script>',
      panelBackground: '#abcdef',
      textColor: '#123abc',
      accentColor: '#0f62fe'
    })
    const resolved = resolveModalModule(instance)
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected modal module to resolve')
    expect(resolved.config).toMatchObject({
      title: '',
      content: '<script>render this as plain text</script>',
      panelBackground: '#ABCDEF',
      textColor: '#123ABC',
      accentColor: '#0F62FE'
    })
  })

  test('rejects extra or missing config keys and invalid identities fail closed', () => {
    expect(() => createModalModuleInstance({ execute: 'alert(1)' })).toThrow('contain exactly')

    const instance = createModalModuleInstance()
    const missingContent = structuredClone(instance)
    Reflect.deleteProperty(missingContent.config, 'content')
    expect(resolveModalModule(missingContent)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('contain exactly')
    })
    expect(resolveModalModule(null)).toBeNull()
    expect(resolveModalModule({ ...instance, pluginId: 'open-pencil.other' })).toBeNull()
    expect(resolveModalModule({ ...instance, moduleType: 'other' })).toBeNull()
    expect(resolveModalModule({ ...instance, configVersion: 2 })).toEqual({
      ok: false,
      reason: 'unsupported modal config version 2'
    })
  })

  test('bounds all strings, booleans, numbers, colors, and footer alignment', () => {
    expect(() => createModalModuleInstance({ triggerLabel: '' })).toThrow('1 to 80')
    expect(() => createModalModuleInstance({ triggerLabel: '   ' })).toThrow('1 to 80')
    expect(() =>
      createModalModuleInstance({
        triggerLabel: 'x'.repeat(MODAL_MODULE_LIMITS.triggerLabel + 1)
      })
    ).toThrow('1 to 80')
    expect(() =>
      createModalModuleInstance({ title: 'x'.repeat(MODAL_MODULE_LIMITS.title + 1) })
    ).toThrow('0 to 120')
    expect(() =>
      createModalModuleInstance({ content: 'x'.repeat(MODAL_MODULE_LIMITS.content + 1) })
    ).toThrow('0 to 4000')
    expect(() => createModalModuleInstance({ cancelLabel: '' })).toThrow('1 to 40')
    expect(() => createModalModuleInstance({ confirmLabel: '\n' })).toThrow('1 to 40')
    expect(() =>
      createModalModuleInstance({
        confirmLabel: 'x'.repeat(MODAL_MODULE_LIMITS.actionLabel + 1)
      })
    ).toThrow('1 to 40')

    for (const key of [
      'showTriggerIcon',
      'showTriggerLabel',
      'showCloseButton',
      'closeOnBackdrop',
      'closeOnEscape',
      'showCancelButton',
      'showConfirmButton'
    ] as const) {
      expect(() => createModalModuleInstance({ [key]: 'yes' }), key).toThrow('boolean')
    }

    expect(() =>
      createModalModuleInstance({ panelWidth: MODAL_MODULE_LIMITS.panelWidthMin - 1 })
    ).toThrow('between 280 and 720')
    expect(() =>
      createModalModuleInstance({ panelWidth: MODAL_MODULE_LIMITS.panelWidthMax + 1 })
    ).toThrow('between 280 and 720')
    expect(() => createModalModuleInstance({ panelWidth: Number.NaN })).toThrow(
      'between 280 and 720'
    )
    expect(() => createModalModuleInstance({ overlayOpacity: -0.01 })).toThrow('between 0 and 0.9')
    expect(() => createModalModuleInstance({ overlayOpacity: 0.91 })).toThrow('between 0 and 0.9')
    expect(() => createModalModuleInstance({ footerAlign: 'space-between' })).toThrow(
      'left, center, or right'
    )
    expect(() => createModalModuleInstance({ panelBackground: 'white' })).toThrow('#RRGGBB')
    expect(() => createModalModuleInstance({ textColor: '#12345G' })).toThrow('#RRGGBB')
    expect(() => createModalModuleInstance({ accentColor: '#FFF' })).toThrow('#RRGGBB')
    expect(() =>
      createModalModuleInstance({
        showCloseButton: false,
        closeOnBackdrop: false,
        closeOnEscape: false,
        showCancelButton: false,
        showConfirmButton: false
      })
    ).toThrow('at least one dismissal control')
  })

  test('accepts every inclusive boundary and independent visibility combination', () => {
    for (const footerAlign of ['left', 'center', 'right'] as const) {
      for (const showTriggerIcon of [false, true]) {
        for (const showTriggerLabel of [false, true]) {
          const resolved = resolveModalModule(
            createModalModuleInstance({
              triggerLabel: 'x'.repeat(MODAL_MODULE_LIMITS.triggerLabel),
              showTriggerIcon,
              showTriggerLabel,
              title: 'x'.repeat(MODAL_MODULE_LIMITS.title),
              content: 'x'.repeat(MODAL_MODULE_LIMITS.content),
              cancelLabel: 'x'.repeat(MODAL_MODULE_LIMITS.actionLabel),
              confirmLabel: 'x'.repeat(MODAL_MODULE_LIMITS.actionLabel),
              panelWidth: MODAL_MODULE_LIMITS.panelWidthMax,
              footerAlign,
              overlayOpacity: MODAL_MODULE_LIMITS.overlayOpacityMax
            })
          )
          expect(resolved?.ok, `${footerAlign}/${showTriggerIcon}/${showTriggerLabel}`).toBe(true)
        }
      }
    }
    expect(
      resolveModalModule(
        createModalModuleInstance({
          title: '',
          content: '',
          panelWidth: MODAL_MODULE_LIMITS.panelWidthMin,
          overlayOpacity: MODAL_MODULE_LIMITS.overlayOpacityMin
        })
      )?.ok
    ).toBe(true)
  })
})
