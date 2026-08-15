import { describe, expect, test } from 'bun:test'

import * as CoreRoot from '@open-pencil/core'
import * as CorePlugins from '@open-pencil/core/plugins'
import * as PluginContracts from '@open-pencil/plugin-contracts'

const REPRESENTATIVE_RUNTIME_EXPORTS = [
  'parsePluginObjectParameterSchema',
  'parsePluginConnectorContract',
  'parseVersionedPluginManifest',
  'verifyVersionedPluginPackage',
  'parseTrustedPluginKeyring',
  'verifyPluginCatalog',
  'verifyPluginRuntimePackage',
  'verifyPluginRuntimeIndex',
  'verifyMarketplaceSnapshot',
  'verifyMarketplaceRuntimeIndex',
  'PluginTrustError',
  'PluginRuntimeTrustError',
  'MarketplaceSnapshotTrustError'
] as const satisfies readonly (keyof typeof PluginContracts)[]

type Same<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false

type SameAcrossEntrypoints<Owner, PluginsCompat, RootCompat> =
  Same<Owner, PluginsCompat> extends true ? Same<Owner, RootCompat> : false

const TYPE_COMPATIBILITY: readonly [
  SameAcrossEntrypoints<
    PluginContracts.PluginManifest,
    CorePlugins.PluginManifest,
    CoreRoot.PluginManifest
  >,
  SameAcrossEntrypoints<
    PluginContracts.PluginConnectorContractV1,
    CorePlugins.PluginConnectorContractV1,
    CoreRoot.PluginConnectorContractV1
  >,
  SameAcrossEntrypoints<
    PluginContracts.PluginParameterSchemaV2,
    CorePlugins.PluginParameterSchemaV2,
    CoreRoot.PluginParameterSchemaV2
  >,
  SameAcrossEntrypoints<
    PluginContracts.PluginRuntimeIndexPayloadV1,
    CorePlugins.PluginRuntimeIndexPayloadV1,
    CoreRoot.PluginRuntimeIndexPayloadV1
  >,
  SameAcrossEntrypoints<
    PluginContracts.VerifiedMarketplaceSnapshot,
    CorePlugins.VerifiedMarketplaceSnapshot,
    CoreRoot.VerifiedMarketplaceSnapshot
  >,
  SameAcrossEntrypoints<
    PluginContracts.ModulePropertyFieldKind,
    CorePlugins.ModulePropertyFieldKind,
    CoreRoot.ModulePropertyFieldKind
  >
] = [true, true, true, true, true, true]

describe('core plugin-contract compatibility exports', () => {
  test('preserves every owner runtime export through both established core entry points', () => {
    const ownerKeys = Object.keys(PluginContracts)
    expect(ownerKeys.filter((key) => !Reflect.has(CorePlugins, key))).toEqual([])
    expect(ownerKeys.filter((key) => !Reflect.has(CoreRoot, key))).toEqual([])
    for (const key of ownerKeys) {
      expect(Reflect.get(CorePlugins, key)).toBe(Reflect.get(PluginContracts, key))
      expect(Reflect.get(CoreRoot, key)).toBe(Reflect.get(PluginContracts, key))
    }
  })

  test('keeps representative trust classes and validators identical', () => {
    for (const key of REPRESENTATIVE_RUNTIME_EXPORTS) {
      expect(CorePlugins[key]).toBe(PluginContracts[key])
      expect(CoreRoot[key]).toBe(PluginContracts[key])
    }
  })

  test('keeps representative public types identical', () => {
    expect(TYPE_COMPATIBILITY).toEqual([true, true, true, true, true, true])
  })
})
