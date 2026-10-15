import { expect, test } from 'bun:test'

import { parsePackageManifest, parseWorkspacePackageJSON } from '#package-artifacts/manifest/read'
import { isRegistryNotFound, validateRegistryVersion } from '#package-artifacts/npm/registry'
import { parseWorkspace } from '#package-artifacts/workspace/schema'

const identity = { name: 'fixture', version: '1.0.0' }

test('manifest boundary rejects malformed fields, including nested export targets', () => {
  for (const fields of [
    { exports: 42 },
    { exports: { '.': { bun: true } } },
    { dependencies: [] },
    { dependencies: { other: 1 } },
    { files: 'dist' },
    { bin: { cli: false } },
    { scripts: { build: 1 } },
    { imports: [] },
    { publishConfig: { provenance: 'true' } }
  ]) {
    expect(() =>
      parsePackageManifest(JSON.stringify({ ...identity, ...fields }), 'fixture.json')
    ).toThrow('fixture.json: invalid package manifest')
  }
})

test('manifest schemas preserve metadata and valid recursive export alternatives', () => {
  const manifest = {
    ...identity,
    custom: { keep: true },
    exports: {
      '.': { bun: ['./src/index.ts', null], default: './dist/index.js' },
      './private': null
    }
  }
  expect(parsePackageManifest(JSON.stringify(manifest), 'fixture')).toEqual(manifest)
})

test('workspace schema rejects unsupported or unsafe directory declarations', () => {
  for (const workspaces of [[], 'packages/*', ['packages/*'], [42], ['../outside'], ['/outside']]) {
    expect(() => parseWorkspace({ workspaces }, 'root')).toThrow(
      'root: expected a workspace manifest'
    )
  }
})

test('registry output distinguishes missing versions from errors and malformed responses', () => {
  expect(isRegistryNotFound('{"error":{"code":"E404"}}')).toBe(true)
  for (const response of ['E404', '{', '{"error":{"code":"E401"}}', '{"error":42}']) {
    expect(isRegistryNotFound(response)).toBe(false)
  }
  expect(() => validateRegistryVersion('"1.0.0"', '1.0.0')).not.toThrow()
  expect(() => validateRegistryVersion('"2.0.0"', '1.0.0')).toThrow('expected version')
})

test('private workspace manifests may omit identity fields without dropping package metadata', () => {
  const manifest = {
    name: '@fixture/private',
    private: true,
    custom: { keep: ['future'] },
    exports: { '.': { bun: ['./src/index.ts', null], default: './dist/index.js' } },
    peerDependenciesMeta: { '@fixture/optional': { optional: true, custom: { keep: true } } },
    publishConfig: { access: 'public' as const, custom: { preservedUntilPolicyValidation: true } }
  }
  expect(parseWorkspacePackageJSON(JSON.stringify(manifest), 'private')).toEqual(manifest)
  expect(() => parsePackageManifest(JSON.stringify(manifest), 'public')).toThrow(
    'public: invalid package manifest'
  )
})

test('partial workspace manifests still reject malformed known nested fields', () => {
  for (const fields of [
    { dependencies: { dependency: 42 } },
    { peerDependenciesMeta: [] },
    { peerDependenciesMeta: { dependency: { optional: 'true' } } },
    { exports: { '.': { bun: false } } },
    { publishConfig: { provenance: 'true' } }
  ]) {
    expect(() => parseWorkspacePackageJSON(JSON.stringify(fields), 'private')).toThrow(
      'private: invalid package fields'
    )
  }
  for (const source of ['[]', 'null', '42', '"manifest"']) {
    expect(() => parseWorkspacePackageJSON(source, 'private')).toThrow(
      'private: expected an object'
    )
  }
})
