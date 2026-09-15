import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_PLUGIN_REGISTRY,
  VR_TOUR_MODULE_DEFAULT_CONFIG,
  VR_TOUR_MODULE_DEFINITION,
  VR_TOUR_MODULE_LIMITS,
  createLocalizedVRTourConfig,
  createVRTourModuleFrameOverrides,
  createVRTourModuleInstance,
  createVRTourSampleScenes,
  parseVRTourPanoramaURL,
  resolveVRTourModule,
  type VRTourModuleConfigV1
} from '#core/plugins'

function config(): VRTourModuleConfigV1 {
  return structuredClone(VR_TOUR_MODULE_DEFAULT_CONFIG)
}

describe('VR tour module contract', () => {
  test('registers an ordinary FRAME and keeps defaults and input scenes isolated', () => {
    expect(BUILTIN_PLUGIN_REGISTRY.getModule('open-pencil.vr-tour', 'vr-tour')).toBeDefined()
    const source = config()
    const instance = createVRTourModuleInstance(source)
    source.scenes[0].title = 'Changed later'
    const resolved = resolveVRTourModule(instance)
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('Expected valid tour.')
    expect(resolved.config.scenes[0].title).toBe('Living room')
    expect(resolved.config.scenes[0].panoramaUrl).toBe('')
    expect(createVRTourModuleFrameOverrides()).toMatchObject({
      width: 640,
      height: 400,
      interactiveProps: {
        module: {
          version: 1,
          pluginId: 'open-pencil.vr-tour',
          moduleType: 'vr-tour',
          configVersion: 1
        }
      }
    })
    expect(resolveVRTourModule(structuredClone(instance))).toEqual(resolved)
    expect(Object.isFrozen(resolved.config.scenes[0].hotspots[0])).toBe(true)
  })

  test('normalizes legacy version 1 documents to English and preserves authored labels', () => {
    const legacy = config()
    delete legacy.locale
    legacy.label = 'My authored property'
    legacy.scenes[0].title = 'Custom room'
    const instance = createVRTourModuleInstance()
    const resolved = resolveVRTourModule({ ...instance, config: legacy })
    expect(resolved).toMatchObject({
      ok: true,
      instance: { configVersion: 1, config: { locale: 'en' } },
      config: { locale: 'en', label: 'My authored property' }
    })
    if (!resolved?.ok) throw new Error('Expected valid legacy tour.')
    expect(resolved.config.scenes[0].title).toBe('Custom room')
    expect(legacy.locale).toBeUndefined()
    expect(
      resolveVRTourModule({ ...instance, config: { ...legacy, locale: 'zh-CN' } })
    ).toMatchObject({
      ok: true,
      config: { locale: 'zh-CN', label: 'My authored property', scenes: legacy.scenes }
    })
    expect(VR_TOUR_MODULE_DEFINITION.fields.find((field) => field.path[0] === 'locale')).toEqual({
      path: ['locale'],
      i18nLabelKey: 'lowcodeModuleFieldVRTourLocale',
      kind: 'select',
      label: 'Interface language',
      options: ['en', 'zh-CN']
    })
  })

  test('rejects unsupported and accessor-backed locales without reading accessors', () => {
    for (const locale of ['zh', 'fr', '', null, false, {}, 1]) {
      expect(() => createVRTourModuleInstance({ locale })).toThrow()
      expect(
        resolveVRTourModule({ ...createVRTourModuleInstance(), config: { ...config(), locale } })
      ).toMatchObject({ ok: false })
    }
    let reads = 0
    const source = config()
    Object.defineProperty(source, 'locale', {
      enumerable: true,
      get: () => {
        reads++
        return 'zh-CN'
      }
    })
    expect(() => createVRTourModuleInstance(source)).toThrow()
    expect(resolveVRTourModule({ ...createVRTourModuleInstance(), config: source })).toMatchObject({
      ok: false
    })
    expect(reads).toBe(0)
  })

  test('returns isolated localized defaults and two explicitly independent sample scenes', () => {
    const chinese = createLocalizedVRTourConfig('zh-CN')
    expect(chinese).toMatchObject({ locale: 'zh-CN', label: '房屋全景导览' })
    expect(chinese.scenes.map((scene) => scene.title)).toEqual(['客厅', '卧室'])
    expect(chinese.scenes.map((scene) => scene.hotspots[0].label)).toEqual(['卧室', '客厅'])
    expect(createLocalizedVRTourConfig('zh')).toEqual(chinese)
    expect(createLocalizedVRTourConfig('en')).toEqual(VR_TOUR_MODULE_DEFAULT_CONFIG)
    expect(createLocalizedVRTourConfig('fr')).toEqual(VR_TOUR_MODULE_DEFAULT_CONFIG)
    const scenes = createVRTourSampleScenes('zh-CN')
    expect(scenes.map((scene) => scene.id)).toEqual(['living-room', 'bedroom'])
    expect(scenes.map((scene) => scene.title)).toEqual(['住宅示例 A', '住宅示例 B'])
    expect(scenes.map((scene) => scene.panoramaUrl)).toEqual([
      '/assets/vr-tour/cayley_interior.jpg',
      '/assets/vr-tour/lebombo.jpg'
    ])
    expect(scenes.map((scene) => scene.hotspots[0].label)).toEqual(['切换示例 B', '切换示例 A'])
    expect(scenes.map((scene) => scene.hotspots[0].yaw)).toEqual([25, -25])
    expect(scenes.map((scene) => scene.hotspots[0].pitch)).toEqual([-10, -10])
    expect(resolveVRTourModule(createVRTourModuleInstance({ ...chinese, scenes }))).toMatchObject({
      ok: true
    })
    const english = createVRTourSampleScenes('en')
    expect(english.map((scene) => scene.title)).toEqual([
      'Residential sample A',
      'Residential sample B'
    ])
    expect(english.map((scene) => scene.hotspots[0].label)).toEqual([
      'Switch to sample B',
      'Switch to sample A'
    ])
    scenes[0].hotspots[0].label = 'Changed sample link'
    chinese.scenes[0].title = 'Changed default room'
    expect(createVRTourSampleScenes('zh-CN')[0].hotspots[0].label).toBe('切换示例 B')
    expect(createLocalizedVRTourConfig('zh-CN').scenes[0].title).toBe('客厅')
    expect(VR_TOUR_MODULE_DEFAULT_CONFIG.scenes[0].title).toBe('Living room')
    expect(VR_TOUR_MODULE_DEFAULT_CONFIG.scenes[0].panoramaUrl).toBe('')
  })

  test.each([
    '',
    'https://media.example.com/room.jpg',
    'https://media.example.com/room.JPEG',
    '/assets/vr-tour/room.webp',
    '/assets/vr-tour/apartment/living-room.png'
  ])('accepts bounded panorama data locators: %s', (value) => {
    expect(parseVRTourPanoramaURL(value)).toBe(value)
  })

  test.each([
    'http://example.com/room.jpg',
    'https://localhost/room.jpg',
    'https://127.0.0.1/room.jpg',
    'https://user:password@example.com/room.jpg',
    'https://example.com/room.jpg?token=secret',
    'https://example.com/room.jpg#view',
    'https://example.com/room.jpg?',
    'https://example.com/room.jpg#',
    'https://example.com/room.svg',
    'https://example.com/room.glb',
    'https://example.com/%72oom.jpg',
    'https://example.com/viewer.html',
    '//example.com/room.jpg',
    '/assets/vr-tour/../room.jpg',
    '/assets/vr-tour/%2e%2e/room.jpg',
    '/assets/vr-tour/room.svg',
    '/assets/vr-tour//room.jpg',
    '/private/room.jpg',
    'data:image/png;base64,AAAA',
    // eslint-disable-next-line no-script-url -- Rejected URL fixture; never rendered or executed.
    'javascript:alert(1)',
    'file:///tmp/room.jpg',
    'blob:https://example.com/room.jpg'
  ])('rejects active, private, credential-bearing and unscoped locators: %s', (value) => {
    expect(() => parseVRTourPanoramaURL(value)).toThrow()
  })

  test('rejects broken scene links, duplicate identifiers and unknown configuration keys', () => {
    expect(() => createVRTourModuleInstance({ initialSceneId: 'missing' })).toThrow(
      'existing scene'
    )
    expect(() => createVRTourModuleInstance({ iframe: 'https://example.com/viewer' })).toThrow()
    const source = config()
    source.scenes[0].hotspots[0].targetSceneId = 'missing'
    expect(() => createVRTourModuleInstance(source)).toThrow('existing scene')
    source.scenes[0].hotspots[0].targetSceneId = 'bedroom'
    source.scenes.push(structuredClone(source.scenes[0]))
    expect(() => createVRTourModuleInstance(source)).toThrow('unique identifiers')
    source.scenes.pop()
    source.scenes[0].hotspots.push(structuredClone(source.scenes[0].hotspots[0]))
    expect(() => createVRTourModuleInstance(source)).toThrow('unique hotspot identifiers')
    source.scenes[0].hotspots.pop()
    source.scenes[0].hotspots[0].html = '<script>alert(1)</script>'
    expect(() => createVRTourModuleInstance(source)).toThrow('exactly')
  })

  test('bounds viewpoints, room and hotspot counts, and labels', () => {
    for (const value of [Number.NaN, Infinity, -181, 181])
      expect(() => createVRTourModuleInstance({ initialYaw: value })).toThrow()
    for (const value of [-86, 86])
      expect(() => createVRTourModuleInstance({ initialPitch: value })).toThrow()
    for (const value of [39, 101])
      expect(() => createVRTourModuleInstance({ initialFov: value })).toThrow()
    expect(() =>
      createVRTourModuleInstance({ label: 'x'.repeat(VR_TOUR_MODULE_LIMITS.label + 1) })
    ).toThrow()
    expect(() => createVRTourModuleInstance({ scenes: [] })).toThrow('1 to 12')
    const source = config()
    source.scenes = Array.from({ length: 7 }, (_, index) => ({
      id: 'room-' + index,
      title: 'Room',
      panoramaUrl: '',
      hotspots: Array.from({ length: 20 }, (_, hotspot) => ({
        id: 'hotspot-' + hotspot,
        label: 'Next',
        targetSceneId: 'room-0',
        yaw: 0,
        pitch: 0
      }))
    }))
    source.initialSceneId = 'room-0'
    expect(() => createVRTourModuleInstance(source)).toThrow('at most 128 hotspots')
  })

  test('never invokes accessor-backed scenes or hotspots and rejects sparse/custom arrays', () => {
    let reads = 0
    const source = config()
    Object.defineProperty(source.scenes[0], 'title', {
      enumerable: true,
      get: () => {
        reads++
        return 'unsafe'
      }
    })
    expect(() => createVRTourModuleInstance(source)).toThrow()
    expect(reads).toBe(0)
    const sparse = config()
    delete sparse.scenes[0]
    expect(() => createVRTourModuleInstance(sparse)).toThrow()
    const custom = config()
    Object.assign(custom.scenes[0].hotspots, { extra: true })
    expect(() => createVRTourModuleInstance(custom)).toThrow()
  })

  test('unsupported versions and malformed envelopes stay unresolved', () => {
    const instance = createVRTourModuleInstance()
    expect(resolveVRTourModule({ ...instance, configVersion: 2 })).toMatchObject({ ok: false })
    expect(resolveVRTourModule({ ...instance, moduleType: 'video' })).toBeNull()
    expect(resolveVRTourModule(undefined)).toBeNull()
    expect(
      resolveVRTourModule({
        ...instance,
        config: { ...instance.config, initialSceneId: 'unknown' }
      })
    ).toMatchObject({ ok: false })
  })
})
