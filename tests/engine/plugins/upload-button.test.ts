import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_PLUGIN_REGISTRY,
  UPLOAD_BUTTON_MODULE_CONFIG_VERSION,
  UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG,
  UPLOAD_BUTTON_MODULE_DEFAULT_SIZE,
  UPLOAD_BUTTON_MODULE_LIMITS,
  UPLOAD_BUTTON_MODULE_TYPE,
  UPLOAD_BUTTON_PLUGIN_ID,
  createUploadButtonModuleFrameOverrides,
  createUploadButtonModuleInstance,
  isUploadAcceptToken,
  resolveUploadButtonModule
} from '@open-pencil/core/plugins'

const CONFIG_KEYS = [
  'triggerLabel',
  'showTriggerIcon',
  'showTriggerLabel',
  'accept',
  'multiple',
  'maxFiles',
  'maxFileBytes',
  'allowDrop',
  'showFileList',
  'helperText',
  'buttonBackground',
  'buttonTextColor',
  'accentColor',
  'errorColor'
] as const

describe('built-in upload button plugin', () => {
  test('registers a deeply frozen local-file selection contract and trigger frame', () => {
    const definition = BUILTIN_PLUGIN_REGISTRY.getModule(
      UPLOAD_BUTTON_PLUGIN_ID,
      UPLOAD_BUTTON_MODULE_TYPE
    )
    const instance = createUploadButtonModuleInstance()
    const resolved = resolveUploadButtonModule(instance)

    expect(definition?.name).toBe('Upload Button')
    expect(definition?.description).toContain('without transferring or persisting')
    expect(definition?.configVersion).toBe(UPLOAD_BUTTON_MODULE_CONFIG_VERSION)
    expect(definition?.defaultSize).toEqual(UPLOAD_BUTTON_MODULE_DEFAULT_SIZE)
    expect(definition?.i18nNameKey).toBe('lowcodeModuleUploadButtonName')
    expect(definition?.i18nDescriptionKey).toBe('lowcodeModuleUploadButtonDescription')
    expect(definition?.fields.map((field) => [field.path, field.kind])).toEqual([
      [['triggerLabel'], 'text'],
      [['showTriggerIcon'], 'boolean'],
      [['showTriggerLabel'], 'boolean'],
      [['accept'], 'json'],
      [['multiple'], 'boolean'],
      [['maxFiles'], 'number'],
      [['maxFileBytes'], 'number'],
      [['allowDrop'], 'boolean'],
      [['showFileList'], 'boolean'],
      [['helperText'], 'text'],
      [['buttonBackground'], 'color'],
      [['buttonTextColor'], 'color'],
      [['accentColor'], 'color'],
      [['errorColor'], 'color']
    ])
    expect(Object.keys(instance.config)).toEqual(CONFIG_KEYS)
    expect(instance.config).toEqual(UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG)
    expect(Object.isFrozen(UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG)).toBe(true)
    expect(Object.isFrozen(UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG.accept)).toBe(true)
    expect(Object.isFrozen(instance.config)).toBe(true)
    expect(Object.isFrozen(instance.config.accept)).toBe(true)
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected upload button module to resolve')
    expect(Object.isFrozen(resolved.config)).toBe(true)
    expect(Object.isFrozen(resolved.config.accept)).toBe(true)
    expect(Object.isFrozen(definition?.defaultConfig)).toBe(true)
    expect(Object.isFrozen(definition?.defaultConfig.accept)).toBe(true)
    expect(createUploadButtonModuleFrameOverrides()).toMatchObject({
      name: 'Upload Button',
      width: 200,
      height: 48,
      cornerRadius: 8,
      clipsContent: true,
      interactiveProps: {
        module: {
          pluginId: UPLOAD_BUTTON_PLUGIN_ID,
          moduleType: UPLOAD_BUTTON_MODULE_TYPE,
          configVersion: UPLOAD_BUTTON_MODULE_CONFIG_VERSION
        }
      }
    })
  })

  test('normalizes strict accept tokens without retaining caller-owned arrays', () => {
    const accept = ['.PNG', '.tar.GZ', 'IMAGE/*', 'application/pdf', 'image/svg+xml']
    const instance = createUploadButtonModuleInstance({ accept })
    accept[0] = '.exe'
    const resolved = resolveUploadButtonModule(instance)

    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected upload button module to resolve')
    expect(resolved.config.accept).toEqual([
      '.png',
      '.tar.gz',
      'image/*',
      'application/pdf',
      'image/svg+xml'
    ])
    for (const token of resolved.config.accept) expect(isUploadAcceptToken(token)).toBe(true)
  })

  test('rejects accessors, symbols, cycles, exotic objects, and extra keys without getter calls', () => {
    let getterCalls = 0
    const rootAccessor: Record<string, unknown> = {}
    Object.defineProperty(rootAccessor, 'triggerLabel', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'Choose a file'
      }
    })
    expect(() => createUploadButtonModuleInstance(rootAccessor)).toThrow(
      'must be an enumerable data property'
    )
    expect(getterCalls).toBe(0)

    const acceptAccessor: unknown[] = []
    Object.defineProperty(acceptAccessor, '0', {
      enumerable: true,
      get() {
        getterCalls += 1
        return '.png'
      }
    })
    acceptAccessor.length = 1
    expect(() => createUploadButtonModuleInstance({ accept: acceptAccessor })).toThrow(
      'must be an enumerable data property'
    )
    expect(getterCalls).toBe(0)

    expect(() => createUploadButtonModuleInstance({ [Symbol('extra')]: true })).toThrow(
      'symbol keys'
    )
    const circular: Record<string, unknown> = {}
    circular.accept = [circular]
    expect(() => createUploadButtonModuleInstance(circular)).toThrow('circular reference')
    expect(() => createUploadButtonModuleInstance({ execute: 'alert(1)' })).toThrow(
      'contain exactly'
    )
    const exotic = Object.assign(Object.create({ inherited: true }), { accept: ['.png'] })
    expect(() => createUploadButtonModuleInstance(exotic)).toThrow('contain exactly')

    const malicious = createUploadButtonModuleInstance()
    const configAccessor: Record<string, unknown> = { ...malicious.config }
    Object.defineProperty(configAccessor, 'triggerLabel', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'Choose a file'
      }
    })
    expect(resolveUploadButtonModule({ ...malicious, config: configAccessor })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('enumerable data property')
    })
    expect(getterCalls).toBe(0)
  })

  test('enforces dense, bounded, unique extension and MIME accept tokens', () => {
    const invalid = [
      '',
      '.',
      'png',
      '*/*',
      'image',
      'image/',
      'image//png',
      'image /png',
      '. png',
      '../png',
      'text/plain;charset=utf-8',
      'application/pdf,image/png',
      'https://example.com/file.png'
    ]
    for (const token of invalid) {
      expect(() => createUploadButtonModuleInstance({ accept: [token] }), token).toThrow(
        'file extension or MIME token'
      )
      expect(isUploadAcceptToken(token), token).toBe(false)
    }
    expect(() => createUploadButtonModuleInstance({ accept: ['.PNG', '.png'] })).toThrow(
      'duplicate tokens'
    )
    expect(() =>
      createUploadButtonModuleInstance({
        accept: Array.from(
          { length: UPLOAD_BUTTON_MODULE_LIMITS.acceptMax + 1 },
          (_, index) => `.x${index}`
        )
      })
    ).toThrow('0 to 20 tokens')
    expect(() =>
      createUploadButtonModuleInstance({
        accept: [`.${'x'.repeat(UPLOAD_BUTTON_MODULE_LIMITS.acceptToken)}`]
      })
    ).toThrow('up to 127 characters')

    const sparse: unknown[] = ['.png']
    sparse.length = 2
    expect(() => createUploadButtonModuleInstance({ accept: sparse })).toThrow(
      'dense array without custom keys'
    )
    const custom = ['.png'] as string[] & { custom?: boolean }
    custom.custom = true
    expect(() => createUploadButtonModuleInstance({ accept: custom })).toThrow(
      'without custom or symbol keys'
    )
  })

  test('enforces visible trigger content and exact multiple/count semantics', () => {
    expect(() =>
      createUploadButtonModuleInstance({ showTriggerIcon: false, showTriggerLabel: false })
    ).toThrow('must show a trigger icon or label')
    expect(() => createUploadButtonModuleInstance({ multiple: true })).toThrow(
      'multiple must be false exactly when maxFiles is 1'
    )
    expect(() => createUploadButtonModuleInstance({ maxFiles: 2 })).toThrow(
      'multiple must be false exactly when maxFiles is 1'
    )
    expect(
      resolveUploadButtonModule(createUploadButtonModuleInstance({ multiple: true, maxFiles: 2 }))
        ?.ok
    ).toBe(true)
    expect(
      resolveUploadButtonModule(
        createUploadButtonModuleInstance({
          multiple: true,
          maxFiles: UPLOAD_BUTTON_MODULE_LIMITS.maxFilesMax
        })
      )?.ok
    ).toBe(true)
  })

  test('bounds integers, text, booleans, and canonical colors', () => {
    expect(() => createUploadButtonModuleInstance({ triggerLabel: '' })).toThrow('1 to 80')
    expect(() =>
      createUploadButtonModuleInstance({
        triggerLabel: 'x'.repeat(UPLOAD_BUTTON_MODULE_LIMITS.triggerLabel + 1)
      })
    ).toThrow('1 to 80')
    expect(() =>
      createUploadButtonModuleInstance({
        helperText: 'x'.repeat(UPLOAD_BUTTON_MODULE_LIMITS.helperText + 1)
      })
    ).toThrow('0 to 160')
    for (const key of [
      'showTriggerIcon',
      'showTriggerLabel',
      'multiple',
      'allowDrop',
      'showFileList'
    ] as const) {
      expect(() => createUploadButtonModuleInstance({ [key]: 'yes' }), key).toThrow('boolean')
    }
    for (const maxFiles of [0, 1.5, 101, Number.NaN]) {
      expect(() => createUploadButtonModuleInstance({ maxFiles }), String(maxFiles)).toThrow(
        'integer between 1 and 100'
      )
    }
    for (const maxFileBytes of [0, 1.5, 2_147_483_649, Number.NaN]) {
      expect(
        () => createUploadButtonModuleInstance({ maxFileBytes }),
        String(maxFileBytes)
      ).toThrow('integer between 1 and 2147483648')
    }
    for (const key of [
      'buttonBackground',
      'buttonTextColor',
      'accentColor',
      'errorColor'
    ] as const) {
      expect(() => createUploadButtonModuleInstance({ [key]: 'blue' }), key).toThrow('#RRGGBB')
    }
    const resolved = resolveUploadButtonModule(
      createUploadButtonModuleInstance({
        maxFileBytes: UPLOAD_BUTTON_MODULE_LIMITS.maxFileBytesMax,
        buttonBackground: '#abcdef'
      })
    )
    expect(resolved?.ok).toBe(true)
    if (resolved?.ok) expect(resolved.config.buttonBackground).toBe('#ABCDEF')
  })

  test('fails closed for missing config and invalid identities or versions', () => {
    const instance = createUploadButtonModuleInstance()
    const missingAccept = structuredClone(instance)
    Reflect.deleteProperty(missingAccept.config, 'accept')
    expect(resolveUploadButtonModule(missingAccept)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('contain exactly')
    })
    expect(resolveUploadButtonModule(null)).toBeNull()
    expect(resolveUploadButtonModule({ ...instance, pluginId: 'open-pencil.other' })).toBeNull()
    expect(resolveUploadButtonModule({ ...instance, moduleType: 'other' })).toBeNull()
    expect(resolveUploadButtonModule({ ...instance, configVersion: 2 })).toEqual({
      ok: false,
      reason: 'unsupported upload button config version 2'
    })
  })
})
