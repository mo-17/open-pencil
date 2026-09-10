import { describe, expect, test } from 'bun:test'

import {
  createBackendProviderPlan,
  createBackendProviderPlanV2,
  createBackendProviderRegistry,
  createBackendProviderRegistryV2,
  emitBackendProviderPlan,
  emitBackendProviderPlanV2,
  type BackendArtifactSource
} from '@open-pencil/compiler'

import { createFakeBackendProviderBundle, fakeBackendApplication, fakeSelection } from '../helpers'
import {
  createFakeBackendProviderBundleV2,
  fakeBackendApplicationV2,
  fakeSelectionV2
} from '../v2/helpers'

const artifact: BackendArtifactSource = {
  path: 'backend/schema.sql',
  kind: 'database-schema',
  mediaType: 'application/sql',
  content: '-- deterministic fixture\n'
}

function createEmissions() {
  const bundle = createFakeBackendProviderBundle({ artifacts: [artifact] })
  const registry = createBackendProviderRegistry([bundle])
  const selection = fakeSelection(bundle)
  const plan = createBackendProviderPlan(registry, {
    selection,
    application: fakeBackendApplication(),
    target: 'react',
    mode: 'production'
  })
  if (!plan.ok) throw new Error('Expected a valid V1 fixture plan')

  const bundleV2 = createFakeBackendProviderBundleV2({ artifacts: [artifact] })
  const registryV2 = createBackendProviderRegistryV2([bundleV2])
  const selectionV2 = fakeSelectionV2(bundleV2)
  const planV2 = createBackendProviderPlanV2(registryV2, {
    selection: selectionV2,
    application: fakeBackendApplicationV2(),
    target: 'react',
    mode: 'production'
  })
  if (!planV2.ok) throw new Error('Expected a valid V2 fixture plan')

  return [
    emitBackendProviderPlan(registry, { plan: plan.plan, selection }),
    emitBackendProviderPlanV2(registryV2, { plan: planV2.plan, selection: selectionV2 })
  ] as const
}

describe('versioned Backend artifact file map', () => {
  test('retains canonical artifact bytes and an immutable iterable map through both public emitters', () => {
    const expectedDigests = [
      'PFOVnsvzPUl_tKKZqqvfPyiCVDESDLmVg_eOPHrhVcA',
      'STKxUcpfAdlnzzFVgmWbKoNzBDHDB6vMEJsztveLW8E'
    ]
    for (const [index, result] of createEmissions().entries()) {
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Expected an emitted fixture')
      const { files, manifestDigest, manifestPath } = result.emission
      expect(manifestDigest).toBe(expectedDigests[index])
      expect(files.size).toBe(2)
      expect([...files.keys()]).toEqual([artifact.path, manifestPath])
      expect(files.get(artifact.path)).toBe(artifact.content)
      expect(files.has('injected.sql')).toBe(false)
      expect(files.get('injected.sql')).toBeUndefined()
      expect(Object.isFrozen(files)).toBe(true)
      expect(Object.isFrozen(Object.getPrototypeOf(files))).toBe(true)
      expect(Reflect.get(files, 'set')).toBeUndefined()
      expect(() => Map.prototype.set.call(files, 'injected.sql', '-- altered')).toThrow()

      const context = { label: 'caller context' }
      const visited: string[] = []
      // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Verify ReadonlyMap.forEach's thisArg contract.
      files.forEach(function (this: typeof context, content, path, owner) {
        expect(this).toBe(context)
        expect(owner).toBe(files)
        expect(content).toBe(files.get(path))
        visited.push(path)
      }, context)
      expect(visited).toEqual([artifact.path, manifestPath])
      expect([...files.entries()]).toEqual([...files])
      expect([...files.values()]).toEqual([artifact.content, files.get(manifestPath)])
    }
  })
})
