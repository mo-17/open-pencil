import { describe, expect, test } from 'bun:test'

import {
  BackendProviderRegistryConfigurationError,
  createBackendProviderPlan,
  createBackendProviderRegistry,
  parseBackendProviderDescriptor
} from '@open-pencil/compiler'
import type { BackendProviderDescriptor } from '@open-pencil/compiler'

import {
  createFakeBackendProviderBundle,
  fakeBackendApplication,
  fakeSelection,
  FAKE_PACKAGE_DIGEST
} from './helpers'

function stripeSecretCanary(suffix: string): string {
  return ['sk', 'live', suffix].join('_')
}

describe('Compiler Backend Provider registry', () => {
  test('resolves only the exact trusted descriptor and host package authority', () => {
    const bundle = createFakeBackendProviderBundle()
    const registry = createBackendProviderRegistry([bundle])
    const resolved = registry.resolve(fakeSelection(bundle))

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.value.bundle.descriptor).toEqual(bundle.descriptor)
    expect(resolved.value.selection.packageDigest).toBe(FAKE_PACKAGE_DIGEST)
    expect(registry.list()).toEqual([bundle.descriptor])

    const mismatch = registry.resolve({
      ...fakeSelection(bundle),
      descriptor: { ...bundle.descriptor, providerId: 'other' }
    })
    expect(mismatch).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-descriptor-mismatch' }]
    })
  })

  test('fails closed for disabled, unregistered, or unbound selections', () => {
    const bundle = createFakeBackendProviderBundle()
    const registry = createBackendProviderRegistry([bundle])

    expect(registry.resolve({ ...fakeSelection(bundle), enabled: false })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-disabled' }]
    })
    expect(
      registry.resolve({
        ...fakeSelection(bundle),
        descriptor: { ...bundle.descriptor, adapterId: 'open-pencil.unknown-v1' }
      })
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-adapter-unregistered' }]
    })
    expect(
      registry.resolve({ ...fakeSelection(bundle), packageDigest: 'contains whitespace' })
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-package-digest-invalid' }]
    })
    expect(
      registry.resolve({ ...fakeSelection(bundle), packageDigest: 'printable-but-not-a-digest' })
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-package-digest-invalid' }]
    })
    for (const prefix of ['sha256:', 'app-bundle-sha256:']) {
      expect(
        registry.resolve({
          ...fakeSelection(bundle),
          packageDigest: `${prefix}${'A'.repeat(43)}`
        }).ok
      ).toBe(true)
      expect(
        registry.resolve({
          ...fakeSelection(bundle),
          packageDigest: `${prefix}${'B'.repeat(43)}`
        })
      ).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'backend-provider-package-digest-invalid' }]
      })
    }
    expect(
      registry.resolve({
        ...fakeSelection(bundle),
        descriptor: { ...bundle.descriptor, contractVersion: 2 as 1 }
      })
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-contract-version-unsupported' }]
    })
  })

  test('snapshots public selection input without invoking accessors', () => {
    const bundle = createFakeBackendProviderBundle()
    const registry = createBackendProviderRegistry([bundle])
    const fields = ['descriptor', 'packageDigest', 'enabled'] as const

    for (const field of fields) {
      let getterCalls = 0
      const selection = fakeSelection(bundle)
      const fieldValue = selection[field]
      Object.defineProperty(selection, field, {
        enumerable: true,
        get() {
          getterCalls += 1
          return fieldValue
        }
      })
      const resolved = registry.resolve(selection)
      expect(resolved).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'backend-provider-selection-invalid', path: '$.selection' }]
      })
      expect(getterCalls).toBe(0)
    }

    let planGetterCalls = 0
    const planSelection = fakeSelection(bundle)
    Object.defineProperty(planSelection, 'enabled', {
      enumerable: true,
      get() {
        planGetterCalls += 1
        return true
      }
    })
    const planned = createBackendProviderPlan(registry, {
      selection: planSelection,
      application: fakeBackendApplication(),
      target: 'react',
      mode: 'production'
    })
    expect(planned).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-selection-invalid', path: '$.selection' }]
    })
    expect(planGetterCalls).toBe(0)

    const canary = stripeSecretCanary('selectionobjectkey1234567890')
    let unknownGetterCalls = 0
    const selectionWithUnknownAccessor = fakeSelection(bundle)
    Object.defineProperty(selectionWithUnknownAccessor, canary, {
      enumerable: true,
      get() {
        unknownGetterCalls += 1
        return 'must-not-be-read'
      }
    })
    const unknownResult = registry.resolve(selectionWithUnknownAccessor)
    expect(unknownResult).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-selection-invalid', path: '$.selection' }]
    })
    expect(JSON.stringify(unknownResult)).not.toContain(canary)
    expect(unknownGetterCalls).toBe(0)

    const nonPlainSelection = Object.assign(
      Object.create({ inherited: true }),
      fakeSelection(bundle)
    )
    expect(registry.resolve(nonPlainSelection)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-selection-invalid', path: '$.selection' }]
    })

    let proxyGetCalls = 0
    const throwingProxy = new Proxy(fakeSelection(bundle), {
      get(target, key, receiver) {
        proxyGetCalls += 1
        return Reflect.get(target, key, receiver)
      },
      ownKeys() {
        throw new Error(canary)
      }
    })
    const proxyResult = registry.resolve(throwingProxy)
    expect(proxyResult).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'backend-provider-selection-invalid', path: '$.selection' }]
    })
    expect(JSON.stringify(proxyResult)).not.toContain(canary)
    expect(proxyGetCalls).toBe(0)
  })

  test('strictly parses bounded descriptors without invoking accessors', () => {
    const bundle = createFakeBackendProviderBundle()
    const unknown = { ...bundle.descriptor, endpoint: 'https://example.invalid' }
    expect(parseBackendProviderDescriptor(unknown)).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-provider-descriptor-field-unknown' })
      ])
    })

    let invoked = false
    const accessor = { ...bundle.descriptor } as BackendProviderDescriptor
    Object.defineProperty(accessor, 'providerId', {
      enumerable: true,
      get() {
        invoked = true
        return 'fake'
      }
    })
    expect(parseBackendProviderDescriptor(accessor)).toMatchObject({ ok: false })
    expect(invoked).toBe(false)

    const secretKeyCanary = stripeSecretCanary('descriptorobjectkey1234567890')
    let unknownGetterCalls = 0
    const unknownAccessor = { ...bundle.descriptor }
    Object.defineProperty(unknownAccessor, secretKeyCanary, {
      enumerable: true,
      get() {
        unknownGetterCalls++
        return 'must-not-be-read'
      }
    })
    const unknownResult = parseBackendProviderDescriptor(unknownAccessor)
    expect(unknownResult).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-provider-descriptor-field-unknown', path: '$' })
      ])
    })
    expect(JSON.stringify(unknownResult)).not.toContain(secretKeyCanary)
    expect(unknownGetterCalls).toBe(0)

    const symbolDescriptor = { ...bundle.descriptor }
    Object.defineProperty(symbolDescriptor, Symbol(secretKeyCanary), {
      enumerable: true,
      value: 'must-not-enter-diagnostics'
    })
    const symbolResult = parseBackendProviderDescriptor(symbolDescriptor)
    expect(symbolResult).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-provider-descriptor-field-unknown', path: '$' })
      ])
    })
    expect(JSON.stringify(symbolResult)).not.toContain(secretKeyCanary)
  })

  test('rejects secret-like authority strings before planning without echoing material', () => {
    const bundle = createFakeBackendProviderBundle()
    const identifierCanary = stripeSecretCanary('abcdefghijklmnopqrstuvwxyz012345')
    const versionCanary = '1.0.0-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'
    const secretAuthorityFields = [
      ['pluginId', identifierCanary],
      ['contributionId', identifierCanary],
      ['providerId', identifierCanary],
      ['adapterId', identifierCanary],
      ['adapterVersion', versionCanary]
    ] as const

    for (const [field, canary] of secretAuthorityFields) {
      const parsed = parseBackendProviderDescriptor({
        ...bundle.descriptor,
        [field]: canary
      })
      expect(parsed.ok).toBe(false)
      expect(JSON.stringify(parsed)).not.toContain(canary)
    }

    const taintedBundle = {
      ...bundle,
      descriptor: { ...bundle.descriptor, pluginId: identifierCanary }
    }
    expect(() => createBackendProviderRegistry([taintedBundle])).toThrow(
      BackendProviderRegistryConfigurationError
    )

    const registry = createBackendProviderRegistry([bundle])
    const planned = createBackendProviderPlan(registry, {
      selection: {
        ...fakeSelection(bundle),
        descriptor: taintedBundle.descriptor
      },
      application: fakeBackendApplication(),
      target: 'react',
      mode: 'production'
    })
    expect(planned.ok).toBe(false)
    expect(JSON.stringify(planned)).not.toContain(identifierCanary)
  })

  test('rejects sparse, accessor-backed, custom, and custom-prototype descriptor arrays', () => {
    const bundle = createFakeBackendProviderBundle()
    let getterCalls = 0
    const accessorCapabilities = [...bundle.descriptor.capabilities]
    Object.defineProperty(accessorCapabilities, '0', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'data.read'
      }
    })
    const sparseOutputs: unknown[] = []
    sparseOutputs.length = 1
    const customModelVersions = [1]
    Object.defineProperty(customModelVersions, 'metadata', {
      enumerable: true,
      value: 'untrusted'
    })
    const customPrototypeOutputs = [...bundle.descriptor.outputs]
    Object.setPrototypeOf(customPrototypeOutputs, Object.create(Array.prototype))

    for (const descriptor of [
      { ...bundle.descriptor, capabilities: accessorCapabilities },
      { ...bundle.descriptor, outputs: sparseOutputs },
      { ...bundle.descriptor, supportedModelVersions: customModelVersions },
      { ...bundle.descriptor, outputs: customPrototypeOutputs }
    ]) {
      expect(parseBackendProviderDescriptor(descriptor)).toMatchObject({
        ok: false,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'backend-provider-descriptor-array-invalid' })
        ])
      })
    }
    expect(getterCalls).toBe(0)
  })

  test('rejects static bundles whose adapters exceed or understate the descriptor', () => {
    const bundle = createFakeBackendProviderBundle()
    const invalid = {
      ...bundle,
      descriptor: {
        ...bundle.descriptor,
        capabilities: ['data.read'] as const
      }
    }

    expect(() => createBackendProviderRegistry([invalid])).toThrow(
      BackendProviderRegistryConfigurationError
    )
    try {
      createBackendProviderRegistry([invalid])
    } catch (cause) {
      expect(cause).toMatchObject({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'backend-provider-registry-value-unknown' }),
          expect.objectContaining({ code: 'backend-provider-registry-capabilities-mismatch' })
        ])
      })
    }
  })
})
