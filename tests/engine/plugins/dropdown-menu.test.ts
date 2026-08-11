import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_PLUGIN_REGISTRY,
  DROPDOWN_MENU_MODULE_CONFIG_VERSION,
  DROPDOWN_MENU_MODULE_DEFAULT_CONFIG,
  DROPDOWN_MENU_MODULE_DEFAULT_SIZE,
  DROPDOWN_MENU_MODULE_LIMITS,
  DROPDOWN_MENU_MODULE_TYPE,
  DROPDOWN_MENU_PLUGIN_ID,
  createDropdownMenuModuleFrameOverrides,
  createDropdownMenuModuleInstance,
  resolveDropdownMenuModule,
  type DropdownMenuEntryV1
} from '@open-pencil/core/plugins'

const CONFIG_KEYS = [
  'triggerLabel',
  'showTriggerLabel',
  'showTriggerChevron',
  'triggerMode',
  'placement',
  'items',
  'closeOnSelect',
  'closeOnEscape',
  'closeOnOutsidePress',
  'menuWidth',
  'triggerBackground',
  'triggerTextColor',
  'menuBackground',
  'itemTextColor',
  'accentColor',
  'dangerColor'
] as const

const ITEM: DropdownMenuEntryV1 = {
  type: 'item',
  label: 'Account',
  href: '/account',
  disabled: false,
  danger: false,
  shortcut: '⌘A'
}

describe('built-in dropdown menu plugin', () => {
  test('registers the exact bounded default contract and trigger frame', () => {
    const definition = BUILTIN_PLUGIN_REGISTRY.getModule(
      DROPDOWN_MENU_PLUGIN_ID,
      DROPDOWN_MENU_MODULE_TYPE
    )
    const instance = createDropdownMenuModuleInstance()
    const resolved = resolveDropdownMenuModule(instance)

    expect(definition?.name).toBe('Dropdown Menu')
    expect(definition?.configVersion).toBe(DROPDOWN_MENU_MODULE_CONFIG_VERSION)
    expect(definition?.defaultSize).toEqual(DROPDOWN_MENU_MODULE_DEFAULT_SIZE)
    expect(definition?.i18nNameKey).toBe('lowcodeModuleDropdownMenuName')
    expect(definition?.i18nDescriptionKey).toBe('lowcodeModuleDropdownMenuDescription')
    expect(definition?.fields.map((field) => [field.path, field.kind])).toEqual([
      [['triggerLabel'], 'text'],
      [['showTriggerLabel'], 'boolean'],
      [['showTriggerChevron'], 'boolean'],
      [['triggerMode'], 'select'],
      [['placement'], 'select'],
      [['items'], 'json'],
      [['closeOnSelect'], 'boolean'],
      [['closeOnEscape'], 'boolean'],
      [['closeOnOutsidePress'], 'boolean'],
      [['menuWidth'], 'number'],
      [['triggerBackground'], 'color'],
      [['triggerTextColor'], 'color'],
      [['menuBackground'], 'color'],
      [['itemTextColor'], 'color'],
      [['accentColor'], 'color'],
      [['dangerColor'], 'color']
    ])
    expect(Object.keys(instance.config)).toEqual(CONFIG_KEYS)
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected dropdown menu module to resolve')
    expect(resolved.config).toEqual(DROPDOWN_MENU_MODULE_DEFAULT_CONFIG)
    expect(resolved.config.items.at(-1)).toEqual({
      type: 'item',
      label: 'Documentation',
      href: 'https://openpencil.dev/',
      disabled: false,
      danger: false,
      shortcut: ''
    })
    expect(Object.isFrozen(DROPDOWN_MENU_MODULE_DEFAULT_CONFIG)).toBe(true)
    expect(Object.isFrozen(DROPDOWN_MENU_MODULE_DEFAULT_CONFIG.items)).toBe(true)
    expect(DROPDOWN_MENU_MODULE_DEFAULT_CONFIG.items.every(Object.isFrozen)).toBe(true)
    expect(Object.isFrozen(definition?.defaultConfig)).toBe(true)
    expect(Object.isFrozen(definition?.defaultConfig.items)).toBe(true)
    expect(createDropdownMenuModuleFrameOverrides()).toMatchObject({
      name: 'Dropdown Menu',
      width: 180,
      height: 48,
      cornerRadius: 8,
      clipsContent: true,
      interactiveProps: {
        module: {
          pluginId: DROPDOWN_MENU_PLUGIN_ID,
          moduleType: DROPDOWN_MENU_MODULE_TYPE,
          configVersion: DROPDOWN_MENU_MODULE_CONFIG_VERSION
        }
      }
    })
  })

  test('parses flat items and separators without retaining caller-owned objects', () => {
    const items: DropdownMenuEntryV1[] = [
      { ...ITEM, href: '', disabled: true, danger: true },
      { type: 'separator' },
      { ...ITEM, label: 'Help', href: 'https://example.com/help', shortcut: '' }
    ]
    const instance = createDropdownMenuModuleInstance({
      items,
      triggerBackground: '#abcdef',
      dangerColor: '#dc2626'
    })
    items[0] = { type: 'separator' }
    const resolved = resolveDropdownMenuModule(instance)

    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected dropdown menu module to resolve')
    expect(resolved.config.items).toEqual([
      { ...ITEM, href: '', disabled: true, danger: true },
      { type: 'separator' },
      { ...ITEM, label: 'Help', href: 'https://example.com/help', shortcut: '' }
    ])
    expect(resolved.config.triggerBackground).toBe('#ABCDEF')
    expect(resolved.config.dangerColor).toBe('#DC2626')
  })

  test('rejects non-JSON partial configs without invoking caller-owned accessors', () => {
    let getterCalls = 0
    const rootAccessor: Record<string, unknown> = {}
    Object.defineProperty(rootAccessor, 'triggerLabel', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'Accessor trigger'
      }
    })
    expect(() => createDropdownMenuModuleInstance(rootAccessor)).toThrow(
      'must be an enumerable data property'
    )
    expect(getterCalls).toBe(0)

    const itemAccessor = { ...ITEM }
    Object.defineProperty(itemAccessor, 'label', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'Accessor item'
      }
    })
    expect(() => createDropdownMenuModuleInstance({ items: [itemAccessor] })).toThrow(
      'must be an enumerable data property'
    )
    expect(getterCalls).toBe(0)

    const arrayAccessor: unknown[] = []
    Object.defineProperty(arrayAccessor, '0', {
      enumerable: true,
      get() {
        getterCalls += 1
        return ITEM
      }
    })
    arrayAccessor.length = 1
    expect(() => createDropdownMenuModuleInstance({ items: arrayAccessor })).toThrow(
      'must be an enumerable data property'
    )
    expect(getterCalls).toBe(0)

    const symbolConfig = { [Symbol('extra')]: true }
    expect(() => createDropdownMenuModuleInstance(symbolConfig)).toThrow('symbol keys')

    const nonEnumerable: Record<string, unknown> = {}
    Object.defineProperty(nonEnumerable, 'triggerLabel', {
      enumerable: false,
      value: 'Hidden trigger'
    })
    expect(() => createDropdownMenuModuleInstance(nonEnumerable)).toThrow(
      'must be an enumerable data property'
    )

    const circular: Record<string, unknown> = {}
    circular.items = [circular]
    expect(() => createDropdownMenuModuleInstance(circular)).toThrow('circular reference')

    const exotic = Object.assign(Object.create({ inherited: true }), {
      triggerLabel: 'Exotic trigger'
    })
    expect(() => createDropdownMenuModuleInstance(exotic)).toThrow('contain exactly')
  })

  test('rejects extra or missing config keys and invalid identities fail closed', () => {
    expect(() => createDropdownMenuModuleInstance({ execute: 'alert(1)' })).toThrow(
      'contain exactly'
    )

    const instance = createDropdownMenuModuleInstance()
    const missingItems = structuredClone(instance)
    Reflect.deleteProperty(missingItems.config, 'items')
    expect(resolveDropdownMenuModule(missingItems)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('contain exactly')
    })
    expect(resolveDropdownMenuModule(null)).toBeNull()
    expect(resolveDropdownMenuModule({ ...instance, pluginId: 'open-pencil.other' })).toBeNull()
    expect(resolveDropdownMenuModule({ ...instance, moduleType: 'other' })).toBeNull()
    expect(resolveDropdownMenuModule({ ...instance, configVersion: 2 })).toEqual({
      ok: false,
      reason: 'unsupported dropdown menu config version 2'
    })
  })

  test('enforces exact entry shapes, a valid item, safe hrefs, and bounded text', () => {
    expect(() => createDropdownMenuModuleInstance({ items: [] })).toThrow('1 to 20 entries')
    expect(() => createDropdownMenuModuleInstance({ items: [{ type: 'separator' }] })).toThrow(
      'at least one item'
    )
    expect(() =>
      createDropdownMenuModuleInstance({
        items: Array.from({ length: DROPDOWN_MENU_MODULE_LIMITS.itemsMax + 1 }, () => ITEM)
      })
    ).toThrow('1 to 20 entries')

    const sparse: unknown[] = [{ ...ITEM }]
    sparse.length = 2
    expect(() => createDropdownMenuModuleInstance({ items: sparse })).toThrow(
      'items[1] must be a menu entry object'
    )
    expect(() =>
      createDropdownMenuModuleInstance({ items: [{ type: 'separator', label: 'No' }] })
    ).toThrow('separator must contain exactly type')
    expect(() => createDropdownMenuModuleInstance({ items: [{ ...ITEM, unknown: true }] })).toThrow(
      'item must contain exactly'
    )
    expect(() =>
      createDropdownMenuModuleInstance({ items: [{ ...ITEM, type: 'submenu' }] })
    ).toThrow('must be item or separator')
    expect(() => createDropdownMenuModuleInstance({ items: [{ ...ITEM, label: '' }] })).toThrow(
      '1 to 80 characters'
    )
    expect(() =>
      createDropdownMenuModuleInstance({
        items: [{ ...ITEM, label: 'x'.repeat(DROPDOWN_MENU_MODULE_LIMITS.itemLabel + 1) }]
      })
    ).toThrow('1 to 80 characters')
    const unsafeHref = ['java', 'script:alert(1)'].join('')
    expect(() =>
      createDropdownMenuModuleInstance({ items: [{ ...ITEM, href: unsafeHref }] })
    ).toThrow('empty or a safe bounded href')
    expect(() =>
      createDropdownMenuModuleInstance({
        items: [{ ...ITEM, shortcut: 'x'.repeat(DROPDOWN_MENU_MODULE_LIMITS.itemShortcut + 1) }]
      })
    ).toThrow('0 to 24 characters')
    expect(() =>
      createDropdownMenuModuleInstance({ items: [{ ...ITEM, disabled: 'yes' }] })
    ).toThrow('disabled must be a boolean')
    expect(() => createDropdownMenuModuleInstance({ items: [{ ...ITEM, danger: 1 }] })).toThrow(
      'danger must be a boolean'
    )
  })

  test('bounds trigger, behavior, width, colors, and encoded config size', () => {
    expect(() => createDropdownMenuModuleInstance({ triggerLabel: '' })).toThrow('1 to 80')
    expect(() => createDropdownMenuModuleInstance({ triggerLabel: '   ' })).toThrow('1 to 80')
    expect(() =>
      createDropdownMenuModuleInstance({
        triggerLabel: 'x'.repeat(DROPDOWN_MENU_MODULE_LIMITS.triggerLabel + 1)
      })
    ).toThrow('1 to 80')
    expect(() =>
      createDropdownMenuModuleInstance({ showTriggerLabel: false, showTriggerChevron: false })
    ).toThrow('must show a trigger label or chevron')

    for (const key of [
      'showTriggerLabel',
      'showTriggerChevron',
      'closeOnSelect',
      'closeOnEscape',
      'closeOnOutsidePress'
    ] as const) {
      expect(() => createDropdownMenuModuleInstance({ [key]: 'yes' }), key).toThrow('boolean')
    }
    expect(() => createDropdownMenuModuleInstance({ triggerMode: 'focus' })).toThrow(
      'click or hover'
    )
    expect(() => createDropdownMenuModuleInstance({ placement: 'auto' })).toThrow(
      '12 supported placements'
    )
    expect(() =>
      createDropdownMenuModuleInstance({
        menuWidth: DROPDOWN_MENU_MODULE_LIMITS.menuWidthMin - 1
      })
    ).toThrow('between 160 and 480')
    expect(() =>
      createDropdownMenuModuleInstance({
        menuWidth: DROPDOWN_MENU_MODULE_LIMITS.menuWidthMax + 1
      })
    ).toThrow('between 160 and 480')
    expect(() => createDropdownMenuModuleInstance({ menuWidth: Number.NaN })).toThrow(
      'between 160 and 480'
    )
    for (const key of [
      'triggerBackground',
      'triggerTextColor',
      'menuBackground',
      'itemTextColor',
      'accentColor',
      'dangerColor'
    ] as const) {
      expect(() => createDropdownMenuModuleInstance({ [key]: 'red' }), key).toThrow('#RRGGBB')
    }

    const maximumHref = `/${'a'.repeat(DROPDOWN_MENU_MODULE_LIMITS.itemHref - 1)}`
    expect(() =>
      createDropdownMenuModuleInstance({
        items: Array.from({ length: DROPDOWN_MENU_MODULE_LIMITS.itemsMax }, (_, index) => ({
          ...ITEM,
          label: `Item ${index}`,
          href: maximumHref
        }))
      })
    ).toThrow('encoded bytes')
  })

  test('accepts every placement, trigger mode, visibility side, and inclusive width boundary', () => {
    const placements = [
      'bottomLeft',
      'bottom',
      'bottomRight',
      'topLeft',
      'top',
      'topRight',
      'leftTop',
      'left',
      'leftBottom',
      'rightTop',
      'right',
      'rightBottom'
    ] as const
    for (const placement of placements) {
      for (const triggerMode of ['click', 'hover'] as const) {
        expect(
          resolveDropdownMenuModule(createDropdownMenuModuleInstance({ placement, triggerMode }))
            ?.ok,
          `${placement}/${triggerMode}`
        ).toBe(true)
      }
    }
    expect(
      resolveDropdownMenuModule(
        createDropdownMenuModuleInstance({
          showTriggerLabel: false,
          showTriggerChevron: true,
          menuWidth: DROPDOWN_MENU_MODULE_LIMITS.menuWidthMin
        })
      )?.ok
    ).toBe(true)
    expect(
      resolveDropdownMenuModule(
        createDropdownMenuModuleInstance({
          showTriggerLabel: true,
          showTriggerChevron: false,
          menuWidth: DROPDOWN_MENU_MODULE_LIMITS.menuWidthMax
        })
      )?.ok
    ).toBe(true)
  })
})
