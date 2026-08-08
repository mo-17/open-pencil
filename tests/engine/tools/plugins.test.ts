import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_PLUGIN_REGISTRY,
  CHART_MODULE_CONFIG_VERSION,
  CHART_MODULE_DEFINITION,
  CHART_MODULE_LIMITS,
  CHART_MODULE_TYPE,
  CHART_PLUGIN_ID,
  MAP_MODULE_ATTRIBUTION,
  MAP_MODULE_CONFIG_VERSION,
  MAP_MODULE_DEFINITION,
  MAP_MODULE_DEFAULT_SIZE,
  MAP_MODULE_LIMITS,
  MAP_MODULE_TYPE,
  MAP_PLUGIN_ID,
  PluginRegistry,
  createChartModuleInstance,
  createMapModuleFrameOverrides,
  createMapModuleInstance,
  resolveChartModule,
  resolveMapModule
} from '@open-pencil/core/plugins'

describe('core plugin registry and modules', () => {
  test('registers the built-in modules and freezes startup registration', () => {
    const definition = BUILTIN_PLUGIN_REGISTRY.getModule(MAP_PLUGIN_ID, MAP_MODULE_TYPE)
    expect(definition).toBeDefined()
    expect(definition?.name).toBe('Map')
    expect(definition?.defaultSize).toEqual(MAP_MODULE_DEFAULT_SIZE)
    expect(definition?.defaultConfig.provider).toBe('openstreetmap')
    expect(definition?.defaultConfig.attribution).toBe(MAP_MODULE_ATTRIBUTION)
    expect(definition?.fields.map((field) => field.path)).toContainEqual(['zoom'])
    expect(definition?.fields.map((field) => field.path)).not.toContainEqual(['attribution'])
    expect(definition?.i18nNameKey).toBe('lowcodeModuleMapName')
    expect(definition?.fields.find((field) => field.path[0] === 'zoom')?.i18nLabelKey).toBe(
      'lowcodeModuleFieldZoom'
    )
    expect(BUILTIN_PLUGIN_REGISTRY.getModule(CHART_PLUGIN_ID, CHART_MODULE_TYPE)).toMatchObject({
      pluginId: CHART_MODULE_DEFINITION.pluginId,
      moduleType: CHART_MODULE_DEFINITION.moduleType,
      configVersion: CHART_MODULE_DEFINITION.configVersion
    })
    expect(BUILTIN_PLUGIN_REGISTRY.listModules()).toHaveLength(7)
    expect(() =>
      BUILTIN_PLUGIN_REGISTRY.register({
        id: 'late.plugin',
        name: 'Late',
        version: '1',
        modules: []
      })
    ).toThrow('frozen')
  })

  test('deep-freezes nested default config after registration', () => {
    const inputDefinition = {
      ...MAP_MODULE_DEFINITION,
      defaultConfig: structuredClone(MAP_MODULE_DEFINITION.defaultConfig)
    }
    const registry = new PluginRegistry()
      .register({
        id: MAP_PLUGIN_ID,
        name: 'Map defaults',
        version: '1',
        modules: [inputDefinition]
      })
      .freeze()
    const definition = registry.getModule(MAP_PLUGIN_ID, MAP_MODULE_TYPE)
    if (!definition) throw new Error('Map module was not registered')
    const defaultConfig = definition.defaultConfig
    const center = defaultConfig.center
    const markers = defaultConfig.markers
    if (!Array.isArray(center) || !Array.isArray(markers)) {
      throw new TypeError('Map defaults must contain center and markers arrays')
    }

    inputDefinition.defaultConfig.center[0] = 120
    inputDefinition.defaultConfig.markers.push({ id: 'outside', lng: 120, lat: 30 })
    expect(Object.isFrozen(defaultConfig)).toBe(true)
    expect(Object.isFrozen(center)).toBe(true)
    expect(Object.isFrozen(markers)).toBe(true)
    expect(() => {
      center[0] = 120
    }).toThrow()
    expect(() => {
      markers.push({ id: 'mutated' })
    }).toThrow()
    expect(center).toEqual([0, 0])
    expect(markers).toEqual([])
    expect(registry.getModule(MAP_PLUGIN_ID, MAP_MODULE_TYPE)?.defaultConfig).toEqual({
      ...MAP_MODULE_DEFINITION.defaultConfig,
      center: [0, 0],
      markers: []
    })
  })

  test('rejects duplicate module contributions atomically', () => {
    const duplicateModuleRegistry = new PluginRegistry()
    expect(() =>
      duplicateModuleRegistry.register({
        id: MAP_PLUGIN_ID,
        name: 'Duplicate modules',
        version: '1',
        modules: [MAP_MODULE_DEFINITION, MAP_MODULE_DEFINITION]
      })
    ).toThrow(`Duplicate module: ${MAP_PLUGIN_ID}/${MAP_MODULE_TYPE}`)
    expect(duplicateModuleRegistry.listPlugins()).toHaveLength(0)
  })

  test('creates and resolves a bounded OpenStreetMap config', () => {
    const instance = createMapModuleInstance({
      center: [121.4737, 31.2304],
      zoom: 12,
      style: 'dark',
      markers: [{ id: 'shanghai', lng: 121.4737, lat: 31.2304, label: 'Shanghai' }]
    })
    const resolved = resolveMapModule(instance)
    expect(resolved).toMatchObject({
      ok: true,
      config: { provider: 'openstreetmap', style: 'dark', zoom: 12 }
    })
    expect(resolveMapModule(null)).toBeNull()
    expect(
      resolveMapModule({
        version: 1,
        pluginId: 'test.chart',
        moduleType: 'chart',
        configVersion: 1,
        config: {}
      })
    ).toBeNull()

    const frame = createMapModuleFrameOverrides({ zoom: 5 })
    expect(frame.width).toBe(MAP_MODULE_DEFAULT_SIZE.width)
    expect(frame.type).toBeUndefined()
    expect(resolveMapModule(frame.interactiveProps?.module)).toMatchObject({
      ok: true,
      config: { zoom: 5 }
    })
  })

  test('fails closed for secret-like fields and unbounded map data', () => {
    expect(() => createMapModuleInstance({ token: 'secret' })).toThrow()
    expect(() => createMapModuleInstance({ layers: [{ html: '<script />' }] })).toThrow()
    expect(() => createMapModuleInstance({ center: [181, 0] })).toThrow()
    expect(() => createMapModuleInstance({ attribution: '   ' })).toThrow()
    expect(() => createMapModuleInstance({ attribution: 'Map data by Example' })).toThrow(
      MAP_MODULE_ATTRIBUTION
    )
    expect(() =>
      createMapModuleInstance({
        markers: Array.from({ length: 101 }, (_, index) => ({ id: `m${index}`, lng: 0, lat: 0 }))
      })
    ).toThrow()
  })

  test('enforces geographic and zoom boundaries', () => {
    expect(
      resolveMapModule(createMapModuleInstance({ center: [-180, -90], zoom: 0 }))
    ).toMatchObject({ ok: true, config: { center: [-180, -90], zoom: 0 } })
    expect(
      resolveMapModule(createMapModuleInstance({ center: [180, 90], zoom: MAP_MODULE_LIMITS.zoom }))
    ).toMatchObject({
      ok: true,
      config: { center: [180, 90], zoom: MAP_MODULE_LIMITS.zoom }
    })
    expect(() => createMapModuleInstance({ center: [0, -90.0001] })).toThrow()
    expect(() => createMapModuleInstance({ center: [0, 90.0001] })).toThrow()
    expect(() => createMapModuleInstance({ zoom: -0.01 })).toThrow()
    expect(() => createMapModuleInstance({ zoom: MAP_MODULE_LIMITS.zoom + 0.01 })).toThrow()
  })

  test('validates marker identities, labels, coordinates, and config versions', () => {
    const maxId = 'm'.repeat(MAP_MODULE_LIMITS.markerId)
    const maxLabel = 'L'.repeat(MAP_MODULE_LIMITS.label)
    expect(
      resolveMapModule(
        createMapModuleInstance({
          markers: [{ id: maxId, lng: -180, lat: 90, label: maxLabel }]
        })
      )
    ).toMatchObject({ ok: true })
    expect(() =>
      createMapModuleInstance({ markers: [{ id: `${maxId}m`, lng: 0, lat: 0 }] })
    ).toThrow()
    expect(() => createMapModuleInstance({ markers: [{ id: 'bad id', lng: 0, lat: 0 }] })).toThrow()
    expect(() =>
      createMapModuleInstance({ markers: [{ id: 'm', lng: 0, lat: 0, label: `${maxLabel}L` }] })
    ).toThrow()
    expect(() => createMapModuleInstance({ markers: [{ id: 'm', lng: 180.01, lat: 0 }] })).toThrow()
    expect(() =>
      createMapModuleInstance({
        markers: [
          { id: 'duplicate', lng: 0, lat: 0 },
          { id: 'duplicate', lng: 1, lat: 1 }
        ]
      })
    ).toThrow()

    const unsupported = {
      ...createMapModuleInstance(),
      configVersion: MAP_MODULE_CONFIG_VERSION + 1
    }
    expect(resolveMapModule(unsupported)).toMatchObject({
      ok: false,
      reason: `unsupported map config version ${MAP_MODULE_CONFIG_VERSION + 1}`
    })
  })

  test('creates and validates bounded declarative chart data', () => {
    const instance = createChartModuleInstance({
      values: [-12, 0, 48],
      labels: ['Loss', 'Flat', 'Growth'],
      color: '#ef4444',
      showValues: true
    })
    expect(resolveChartModule(instance)).toMatchObject({
      ok: true,
      config: {
        values: [-12, 0, 48],
        labels: ['Loss', 'Flat', 'Growth'],
        color: '#EF4444',
        showValues: true
      }
    })
    expect(() => createChartModuleInstance({ script: 'alert(1)' })).toThrow()
    expect(() =>
      createChartModuleInstance({
        values: Array.from({ length: CHART_MODULE_LIMITS.values + 1 }, () => 1),
        labels: Array.from({ length: CHART_MODULE_LIMITS.values + 1 }, (_, index) => String(index))
      })
    ).toThrow()
    expect(() => createChartModuleInstance({ values: [1], labels: [] })).toThrow()
    expect(() => createChartModuleInstance({ values: [Number.NaN], labels: ['bad'] })).toThrow()
    expect(() => createChartModuleInstance({ color: 'url(javascript:alert(1))' })).toThrow()
    expect(
      resolveChartModule({ ...instance, configVersion: CHART_MODULE_CONFIG_VERSION + 1 })
    ).toMatchObject({
      ok: false,
      reason: `unsupported chart config version ${CHART_MODULE_CONFIG_VERSION + 1}`
    })
  })
})
