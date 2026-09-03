import { describe, expect, test } from 'bun:test'

import {
  BackendProviderRegistryConfigurationErrorV2,
  createBackendProviderRegistryV2,
  parseBackendProviderDescriptorV2,
  type BackendProviderBundleV2,
  type BackendProviderDescriptorV2
} from '@open-pencil/compiler'

import { createFakeBackendProviderBundleV2, fakeSelectionV2 } from './helpers'

describe('Compiler Backend Provider V2 registry', () => {
  test('parses and normalizes exact contract-v2 descriptor authority', () => {
    const source = {
      pluginId: 'open-pencil.fake-backend-v2',
      contributionId: 'fake-backend-v2',
      providerId: 'fake-v2',
      adapterId: 'open-pencil.fake-backend-v2',
      adapterVersion: '2.0.0',
      contractVersion: 2,
      supportedModelVersions: [2, 1],
      capabilities: ['realtime.subscribe', 'events.data-change'],
      outputs: ['security-policy', 'database-schema']
    }
    const result = parseBackendProviderDescriptorV2(source)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.value.supportedModelVersions).toEqual([1, 2])
    expect(result.value.capabilities).toEqual(['events.data-change', 'realtime.subscribe'])
    expect(result.value.outputs).toEqual(['database-schema', 'security-policy'])
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value.capabilities)).toBe(true)
  })

  test('requires contract and model version 2 without invoking descriptor getters', () => {
    const getterDescriptor = createFakeBackendProviderBundleV2().descriptor
    let getterCalls = 0
    Object.defineProperty(getterDescriptor, 'adapterId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'open-pencil.untrusted'
      }
    })
    expect(parseBackendProviderDescriptorV2(getterDescriptor)).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-provider-v2-descriptor-field-invalid' })
      ])
    })
    expect(getterCalls).toBe(0)

    const contractV1 = { ...createFakeBackendProviderBundleV2().descriptor, contractVersion: 1 }
    expect(parseBackendProviderDescriptorV2(contractV1)).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-provider-v2-contract-version-unsupported' })
      ])
    })

    const modelV1Only = {
      ...createFakeBackendProviderBundleV2().descriptor,
      supportedModelVersions: [1]
    }
    expect(parseBackendProviderDescriptorV2(modelV1Only)).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-provider-v2-model-version-required' })
      ])
    })
  })

  test('resolves only an enabled exact descriptor and current package authority', () => {
    const bundle = createFakeBackendProviderBundleV2()
    const registry = createBackendProviderRegistryV2([bundle])
    expect(registry.list()).toEqual([bundle.descriptor])
    expect(Object.isFrozen(registry.list())).toBe(true)
    expect(registry.resolve(fakeSelectionV2(bundle))).toMatchObject({ ok: true })
    expect(registry.resolve({ ...fakeSelectionV2(bundle), enabled: false })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-v2-disabled' }]
    })
    expect(
      registry.resolve({
        ...fakeSelectionV2(bundle),
        descriptor: { ...bundle.descriptor, adapterVersion: '2.0.1' }
      })
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-v2-descriptor-mismatch' }]
    })
  })

  test('requires exact descriptor capability and output unions across reviewed adapters', () => {
    const base = createFakeBackendProviderBundleV2()
    const missingCapability: BackendProviderBundleV2 = {
      ...base,
      descriptor: {
        ...base.descriptor,
        capabilities: ['migrations.schema', 'realtime.subscribe']
      }
    }
    expect(() => createBackendProviderRegistryV2([missingCapability])).toThrow(
      BackendProviderRegistryConfigurationErrorV2
    )

    const duplicate = {
      ...base,
      descriptor: {
        ...base.descriptor,
        adapterId: base.descriptor.adapterId
      } as BackendProviderDescriptorV2
    }
    expect(() => createBackendProviderRegistryV2([base, duplicate])).toThrow(
      BackendProviderRegistryConfigurationErrorV2
    )
  })
})
