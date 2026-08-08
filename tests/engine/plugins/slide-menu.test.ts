import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_PLUGIN_REGISTRY,
  SLIDE_MENU_MODULE_DEFAULT_CONFIG,
  SLIDE_MENU_MODULE_DEFAULT_SIZE,
  SLIDE_MENU_MODULE_LIMITS,
  SLIDE_MENU_MODULE_TYPE,
  SLIDE_MENU_PLUGIN_ID,
  createSlideMenuModuleFrameOverrides,
  createSlideMenuModuleInstance,
  isSafeSlideMenuHref,
  resolveSlideMenuModule,
  type SlideMenuItemV1
} from '@open-pencil/core/plugins'

function sparseArray<T>(length: number): T[] {
  const value: T[] = []
  value.length = length
  return value
}

describe('built-in slide menu plugin', () => {
  test('registers the exact bounded default contract and frame', () => {
    const definition = BUILTIN_PLUGIN_REGISTRY.getModule(
      SLIDE_MENU_PLUGIN_ID,
      SLIDE_MENU_MODULE_TYPE
    )
    const instance = createSlideMenuModuleInstance()
    const resolved = resolveSlideMenuModule(instance)

    expect(definition?.name).toBe('Slide Menu')
    expect(definition?.configVersion).toBe(1)
    expect(definition?.defaultSize).toEqual(SLIDE_MENU_MODULE_DEFAULT_SIZE)
    expect(definition?.i18nNameKey).toBe('lowcodeModuleSlideMenuName')
    expect(definition?.i18nDescriptionKey).toBe('lowcodeModuleSlideMenuDescription')
    expect(definition?.fields.map((field) => [field.path, field.kind])).toEqual([
      [['presentation'], 'select'],
      [['direction'], 'select'],
      [['triggerLabel'], 'text'],
      [['title'], 'text'],
      [['description'], 'text'],
      [['items'], 'json'],
      [['closeOnBackdrop'], 'boolean'],
      [['showCloseButton'], 'boolean'],
      [['panelSize'], 'number'],
      [['panelBackground'], 'color'],
      [['textColor'], 'color'],
      [['overlayOpacity'], 'number']
    ])
    expect(definition?.fields.map((field) => field.i18nLabelKey)).toEqual([
      'lowcodeModuleFieldSlideMenuPresentation',
      'lowcodeModuleFieldSlideMenuDirection',
      'lowcodeModuleFieldSlideMenuTriggerLabel',
      'lowcodeModuleFieldSlideMenuTitle',
      'lowcodeModuleFieldSlideMenuDescription',
      'lowcodeModuleFieldSlideMenuItems',
      'lowcodeModuleFieldSlideMenuCloseOnBackdrop',
      'lowcodeModuleFieldSlideMenuShowCloseButton',
      'lowcodeModuleFieldSlideMenuPanelSize',
      'lowcodeModuleFieldSlideMenuPanelBackground',
      'lowcodeModuleFieldSlideMenuTextColor',
      'lowcodeModuleFieldSlideMenuOverlayOpacity'
    ])
    expect(Object.keys(instance.config)).toEqual([
      'presentation',
      'direction',
      'triggerLabel',
      'title',
      'description',
      'items',
      'closeOnBackdrop',
      'showCloseButton',
      'panelSize',
      'panelBackground',
      'textColor',
      'overlayOpacity'
    ])
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected slide menu module to resolve')
    expect(resolved.config).toEqual(SLIDE_MENU_MODULE_DEFAULT_CONFIG)
    expect(createSlideMenuModuleFrameOverrides()).toMatchObject({
      name: 'Slide Menu',
      width: 180,
      height: 48,
      cornerRadius: 8,
      interactiveProps: {
        module: {
          pluginId: SLIDE_MENU_PLUGIN_ID,
          moduleType: SLIDE_MENU_MODULE_TYPE,
          configVersion: 1
        }
      }
    })
  })

  test('accepts only local paths, fragments, or canonical public HTTPS hrefs', () => {
    const hrefs = [
      '/',
      '/features?source=menu#details',
      '#section',
      '#contact',
      'https://docs.example.com/start?source=menu'
    ]
    expect(hrefs.every(isSafeSlideMenuHref)).toBe(true)
    const resolved = resolveSlideMenuModule(
      createSlideMenuModuleInstance({
        items: hrefs.map((href, index) => ({ label: `Item ${index + 1}`, href }))
      })
    )
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected safe hrefs to resolve')
    expect(resolved.config.items.map((item) => item.href)).toEqual(hrefs)
    expect(resolveSlideMenuModule(createSlideMenuModuleInstance({ items: [] }))).toMatchObject({
      ok: true,
      config: { items: [] }
    })
    expect(
      resolveSlideMenuModule(
        createSlideMenuModuleInstance({
          items: [{ label: '<script>plain text</script>', href: '#section' }]
        })
      )
    ).toMatchObject({
      ok: true,
      config: { items: [{ label: '<script>plain text</script>', href: '#section' }] }
    })
  })

  test('rejects protocol-relative, non-HTTPS, local, non-canonical, and malformed hrefs', () => {
    const scriptHref = ['java', 'script:alert(1)'].join('')
    const unsafeHrefs = [
      '',
      '#',
      '//evil.example/path',
      '/features\\admin',
      '/features\nadmin',
      '/features\tadmin',
      `/features${String.fromCharCode(127)}admin`,
      'features',
      '?tab=menu',
      scriptHref,
      'data:text/html,unsafe',
      'http://docs.example.com/start',
      'mailto:team@example.com',
      'tel:+15551234567',
      'https://localhost/start',
      'https://service.local/start',
      'https://127.0.0.1/start',
      'https://[::1]/start',
      'https://user:secret@docs.example.com/start',
      'https://docs.example.com/start#fragment',
      'https://docs.example.com:443/start',
      'https://docs.example.com:444/start'
    ]
    for (const href of unsafeHrefs) {
      expect(isSafeSlideMenuHref(href)).toBe(false)
      expect(() => createSlideMenuModuleInstance({ items: [{ label: 'Unsafe', href }] })).toThrow(
        'safe bounded href'
      )
    }
  })

  test('rejects extra config/item keys, missing item keys, and sparse item arrays', () => {
    expect(() => createSlideMenuModuleInstance({ execute: 'alert(1)' })).toThrow('contain exactly')
    expect(() =>
      createSlideMenuModuleInstance({ items: [{ label: 'Home', href: '/', html: '<b>x</b>' }] })
    ).toThrow('exactly label and href')
    expect(() => createSlideMenuModuleInstance({ items: [{ label: 'Home' }] })).toThrow(
      'exactly label and href'
    )
    expect(() => createSlideMenuModuleInstance({ items: sparseArray<SlideMenuItemV1>(1) })).toThrow(
      'items[0] must be a menu item object'
    )

    const instance = createSlideMenuModuleInstance()
    const missingTitle = structuredClone(instance)
    Reflect.deleteProperty(missingTitle.config, 'title')
    expect(resolveSlideMenuModule(missingTitle)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('contain exactly')
    })
    expect(resolveSlideMenuModule(null)).toBeNull()
    expect(resolveSlideMenuModule({ ...instance, pluginId: 'open-pencil.other' })).toBeNull()
  })

  test('bounds strings, items, numbers, colors, booleans, and enum values', () => {
    expect(() => createSlideMenuModuleInstance({ triggerLabel: '' })).toThrow('1 to 80')
    expect(() => createSlideMenuModuleInstance({ triggerLabel: '   ' })).toThrow('1 to 80')
    expect(() =>
      createSlideMenuModuleInstance({
        triggerLabel: 'x'.repeat(SLIDE_MENU_MODULE_LIMITS.triggerLabel + 1)
      })
    ).toThrow('1 to 80')
    expect(() => createSlideMenuModuleInstance({ title: '' })).toThrow('1 to 120')
    expect(() => createSlideMenuModuleInstance({ title: '\t' })).toThrow('1 to 120')
    expect(() =>
      createSlideMenuModuleInstance({ title: 'x'.repeat(SLIDE_MENU_MODULE_LIMITS.title + 1) })
    ).toThrow('1 to 120')
    expect(() =>
      createSlideMenuModuleInstance({
        description: 'x'.repeat(SLIDE_MENU_MODULE_LIMITS.description + 1)
      })
    ).toThrow('0 to 1000')
    expect(() =>
      createSlideMenuModuleInstance({
        items: Array.from({ length: SLIDE_MENU_MODULE_LIMITS.items + 1 }, (_, index) => ({
          label: `${index}`,
          href: '/'
        }))
      })
    ).toThrow(`at most ${SLIDE_MENU_MODULE_LIMITS.items}`)
    expect(() => createSlideMenuModuleInstance({ items: [{ label: '', href: '/' }] })).toThrow(
      '1 to 80'
    )
    expect(() => createSlideMenuModuleInstance({ items: [{ label: '\n', href: '/' }] })).toThrow(
      '1 to 80'
    )
    expect(() =>
      createSlideMenuModuleInstance({
        items: [{ label: 'x'.repeat(SLIDE_MENU_MODULE_LIMITS.itemLabel + 1), href: '/' }]
      })
    ).toThrow('1 to 80')
    expect(() =>
      createSlideMenuModuleInstance({
        items: [{ label: 'Too long', href: `/${'x'.repeat(SLIDE_MENU_MODULE_LIMITS.itemHref)}` }]
      })
    ).toThrow('safe bounded href')
    expect(() => createSlideMenuModuleInstance({ presentation: 'popover' })).toThrow(
      'menu or dialog'
    )
    expect(() => createSlideMenuModuleInstance({ direction: 'center' })).toThrow(
      'left, right, top, or bottom'
    )
    expect(() => createSlideMenuModuleInstance({ closeOnBackdrop: 'yes' })).toThrow('boolean')
    expect(() => createSlideMenuModuleInstance({ showCloseButton: 1 })).toThrow('boolean')
    expect(() =>
      createSlideMenuModuleInstance({ panelSize: SLIDE_MENU_MODULE_LIMITS.panelSizeMin - 1 })
    ).toThrow('between 160 and 720')
    expect(() => createSlideMenuModuleInstance({ panelSize: Number.NaN })).toThrow(
      'between 160 and 720'
    )
    expect(() => createSlideMenuModuleInstance({ panelSize: Number.POSITIVE_INFINITY })).toThrow(
      'between 160 and 720'
    )
    expect(() => createSlideMenuModuleInstance({ overlayOpacity: 0.91 })).toThrow(
      'between 0 and 0.9'
    )
    expect(() => createSlideMenuModuleInstance({ panelBackground: 'white' })).toThrow('#RRGGBB')
    expect(() => createSlideMenuModuleInstance({ textColor: '#12345G' })).toThrow('#RRGGBB')

    for (const presentation of ['menu', 'dialog'] as const) {
      for (const direction of ['left', 'right', 'top', 'bottom'] as const) {
        expect(
          resolveSlideMenuModule(createSlideMenuModuleInstance({ presentation, direction }))
        ).toMatchObject({ ok: true, config: { presentation, direction } })
      }
    }
    expect(
      resolveSlideMenuModule(
        createSlideMenuModuleInstance({
          panelSize: SLIDE_MENU_MODULE_LIMITS.panelSizeMin,
          overlayOpacity: SLIDE_MENU_MODULE_LIMITS.overlayOpacityMin
        })
      )
    ).toMatchObject({ ok: true, config: { panelSize: 160, overlayOpacity: 0 } })
    expect(
      resolveSlideMenuModule(
        createSlideMenuModuleInstance({
          panelSize: SLIDE_MENU_MODULE_LIMITS.panelSizeMax,
          overlayOpacity: SLIDE_MENU_MODULE_LIMITS.overlayOpacityMax
        })
      )
    ).toMatchObject({ ok: true, config: { panelSize: 720, overlayOpacity: 0.9 } })
  })

  test('returns defensive item copies and rejects unsupported versions', () => {
    const items = [{ label: 'Docs', href: '/docs' }]
    const instance = createSlideMenuModuleInstance({ items, panelBackground: '#abcdef' })
    items[0].label = 'Changed'
    const resolved = resolveSlideMenuModule(instance)

    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected slide menu module to resolve')
    expect(resolved.config.items).toEqual([{ label: 'Docs', href: '/docs' }])
    expect(resolved.config.panelBackground).toBe('#ABCDEF')
    expect(resolveSlideMenuModule({ ...instance, configVersion: 2 })).toEqual({
      ok: false,
      reason: 'unsupported slide menu config version 2'
    })
  })
})
