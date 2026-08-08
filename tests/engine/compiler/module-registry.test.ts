import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { BUILTIN_REACT_MODULE_REGISTRY } from '#compiler/adapters/react/modules/builtin'
import {
  buildReactModuleImports,
  collectReactModuleProject,
  requireReactModuleAdapter
} from '#compiler/adapters/react/modules/registry'
import type { IRElement, IRModule, IRWarning } from '#compiler/ir/types'
import { BUILTIN_COMPILER_MODULE_REGISTRY } from '#compiler/modules/builtin'
import { collectCompilerModule } from '#compiler/modules/collect'
import { CompilerModuleRegistry } from '#compiler/modules/registry'
import type { CompilerModuleLowerer } from '#compiler/modules/types'

import { MAP_MODULE_TYPE, MAP_PLUGIN_ID } from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const MAP_IR_MODULE: IRModule = {
  pluginId: MAP_PLUGIN_ID,
  moduleType: MAP_MODULE_TYPE,
  configVersion: 1,
  payload: {}
}

const MAP_IR_ELEMENT: IRElement = {
  kind: 'element',
  sourceId: 'map-module',
  tag: 'div',
  className: '',
  attrs: {},
  children: [],
  module: MAP_IR_MODULE
}

function collectCustomModule(lower: CompilerModuleLowerer['lower']): {
  module: IRModule | null
  warnings: IRWarning[]
} {
  const registry = new CompilerModuleRegistry()
    .register({
      lowerer: {
        pluginId: 'example.test',
        moduleType: 'test',
        warningCodePrefix: 'test-module',
        displayName: 'test',
        hostTypes: ['FRAME'],
        lower
      },
      targets: {}
    })
    .freeze()
  const graph = makeSceneGraph()
  const node = graph.createNode('FRAME', firstPageId(graph), {
    interactiveProps: {
      module: {
        version: 1,
        pluginId: 'example.test',
        moduleType: 'test',
        configVersion: 1,
        config: {}
      }
    }
  })
  const warnings: IRWarning[] = []
  return { module: collectCompilerModule(node, warnings, registry), warnings }
}

describe('compiler module registry boundaries', () => {
  test('keeps the neutral built-in registry free of React targets and imports', () => {
    const neutralIdentities = BUILTIN_COMPILER_MODULE_REGISTRY.listBundles()
      .map(({ lowerer }) => `${lowerer.pluginId}/${lowerer.moduleType}`)
      .sort()
    const reactIdentities = BUILTIN_REACT_MODULE_REGISTRY.listBundles()
      .map(({ lowerer }) => `${lowerer.pluginId}/${lowerer.moduleType}`)
      .sort()

    expect(reactIdentities).toEqual(neutralIdentities)
    expect(
      BUILTIN_COMPILER_MODULE_REGISTRY.listBundles().every(
        (bundle) => Object.keys(bundle.targets).length === 0
      )
    ).toBe(true)
    expect(
      BUILTIN_COMPILER_MODULE_REGISTRY.getLowerer(MAP_PLUGIN_ID, MAP_MODULE_TYPE)
    ).toBeDefined()
    expect(
      BUILTIN_COMPILER_MODULE_REGISTRY.getTarget('react', MAP_PLUGIN_ID, MAP_MODULE_TYPE)
    ).toBeUndefined()
    expect(
      BUILTIN_REACT_MODULE_REGISTRY.getTarget('react', MAP_PLUGIN_ID, MAP_MODULE_TYPE)
    ).toBeDefined()

    const source = readFileSync(
      new URL('../../../packages/compiler/src/modules/builtin.ts', import.meta.url),
      'utf8'
    )
    expect(source).not.toContain('adapters/react')
  })

  test('fails closed when lowered IR has no React target', () => {
    expect(() =>
      requireReactModuleAdapter(MAP_IR_MODULE, BUILTIN_COMPILER_MODULE_REGISTRY)
    ).toThrow('Missing React module adapter for open-pencil.map/map')
    expect(() =>
      buildReactModuleImports([MAP_IR_ELEMENT], false, BUILTIN_COMPILER_MODULE_REGISTRY)
    ).toThrow('Missing React module adapter for open-pencil.map/map')
    expect(() =>
      collectReactModuleProject([[MAP_IR_ELEMENT]], [], BUILTIN_COMPILER_MODULE_REGISTRY)
    ).toThrow('Missing React module adapter for open-pencil.map/map')
  })

  test('diagnoses malformed envelopes for installed modules only', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const known = graph.createNode('FRAME', pageId, {
      interactiveProps: {
        module: {
          version: 2,
          pluginId: MAP_PLUGIN_ID,
          moduleType: MAP_MODULE_TYPE,
          configVersion: 1,
          config: {}
        }
      }
    })
    const unknown = graph.createNode('FRAME', pageId, {
      interactiveProps: {
        module: {
          version: 2,
          pluginId: 'example.unknown',
          moduleType: 'widget',
          configVersion: 1,
          config: {}
        }
      }
    })
    const warnings: IRWarning[] = []

    expect(collectCompilerModule(known, warnings, BUILTIN_COMPILER_MODULE_REGISTRY)).toBeNull()
    expect(collectCompilerModule(unknown, warnings, BUILTIN_COMPILER_MODULE_REGISTRY)).toBeNull()
    expect(warnings.map((warning) => warning.code)).toEqual(['map-module-invalid'])
    expect(warnings[0]?.message).toContain('module.version must be 1')
  })

  test('contains thrown and non-JSON lowerer payloads before they enter IR', () => {
    const thrown = collectCustomModule(() => {
      throw new Error('do not expose this detail')
    })
    expect(thrown.module).toBeNull()
    expect(thrown.warnings.map((warning) => warning.code)).toEqual(['test-module-invalid'])
    expect(thrown.warnings[0]?.message).toContain('module lowerer failed')
    expect(thrown.warnings[0]?.message).not.toContain('do not expose this detail')

    const cyclicPayload: Record<string, unknown> = {}
    cyclicPayload.self = cyclicPayload
    const cyclic = collectCustomModule(() => ({ ok: true, payload: cyclicPayload }))
    const bigint = collectCustomModule(() => ({ ok: true, payload: { value: 1n } }))
    const unsafePayload: Record<string, unknown> = Object.create(null)
    Object.defineProperty(unsafePayload, '__proto__', {
      enumerable: true,
      value: { polluted: true }
    })
    const unsafe = collectCustomModule(() => ({ ok: true, payload: unsafePayload }))

    for (const result of [cyclic, bigint, unsafe]) {
      expect(result.module).toBeNull()
      expect(result.warnings.map((warning) => warning.code)).toEqual(['test-module-invalid'])
      expect(result.warnings[0]?.message).toContain('module lowerer produced an invalid payload')
    }
  })
})
