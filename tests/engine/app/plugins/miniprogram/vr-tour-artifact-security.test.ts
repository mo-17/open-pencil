import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { taroAdapter } from '#compiler/adapters/taro'
import { collectTree } from '#compiler/ir/collect/tree'

import { reviewTaroVRTourHybridArtifacts, withDefaults } from '@open-pencil/compiler'
import { VR_TOUR_SAMPLE_ASSETS } from '@open-pencil/core/plugins'

import {
  MiniProgramArtifactSecurityError,
  assertMiniProgramProjectArtifactSafe
} from '@/app/plugins/host/miniprogram/artifact-security'
import {
  MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
  parseMiniProgramSourceCompilerWorkerResponse
} from '@/app/plugins/host/miniprogram/compiler/protocol'

import { tourFixture } from '#tests/engine/compiler/vr-tour/helpers'

type Files = Map<string, string | Uint8Array>
interface Manifest {
  version: number
  target: string
  tours: Array<{ sourceId: string; key: string; config: Record<string, unknown> }>
  assets: Array<{ url: string; mime: string; sha256: string; byteLength: number; chunks: string[] }>
}
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const options = withDefaults({ target: 'taro', router: 'taro-router', devMode: false })

function output(bytes = PNG, url = '/assets/vr-tour/living-room.png', label?: string) {
  const fixture = tourFixture()
  const config = structuredClone(fixture.module.config)
  const scenes = config.scenes as Array<Record<string, unknown>>
  scenes[0].panoramaUrl = url
  if (label) config.label = label
  fixture.graph.updateNode(fixture.node.id, {
    interactiveProps: { module: { ...fixture.module, config } }
  })
  const ir = collectTree(fixture.graph, fixture.pageId)
  ir.assets = url.startsWith('/assets/') ? [{ path: 'public' + url, bytes }] : []
  return taroAdapter.emit([ir], options)
}

function manifest(files: Files): Manifest {
  const source = files.get('vr-tour-web/manifest.json')
  if (typeof source !== 'string') throw new Error('Missing VR manifest')
  return JSON.parse(source) as Manifest
}

function setManifest(files: Files, value: unknown): Files {
  const copy = new Map(files)
  copy.set('vr-tour-web/manifest.json', JSON.stringify(value, null, 2) + '\n')
  return copy
}

function blocked(files: Files): MiniProgramArtifactSecurityError {
  try {
    assertMiniProgramProjectArtifactSafe(files, 'taro')
  } catch (error) {
    if (error instanceof MiniProgramArtifactSecurityError) return error
    throw error
  }
  throw new Error('Expected VR artifact rejection')
}

test('only the trusted Taro request context admits a complete reviewed sidecar', () => {
  const result = output()
  expect(() => assertMiniProgramProjectArtifactSafe(result.files, 'taro')).not.toThrow()
  for (const target of [undefined, 'wechat-miniprogram', 'uni-app', 'mpx'] as const) {
    expect(() => assertMiniProgramProjectArtifactSafe(result.files, target)).toThrow()
  }
  const requestId = 'vr-tour-artifact-proof'
  const response = {
    version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
    type: 'result',
    requestId,
    output: result
  }
  expect(parseMiniProgramSourceCompilerWorkerResponse(response, requestId, 'taro')?.type).toBe(
    'result'
  )
  expect(() => parseMiniProgramSourceCompilerWorkerResponse(response, requestId)).toThrow()
  expect(() => parseMiniProgramSourceCompilerWorkerResponse(response, requestId, 'mpx')).toThrow()
})

test('modified executable files and unknown, missing or provenance files cannot claim sidecar trust', () => {
  const files = output().files
  for (const path of ['runtime.ts', 'entry.ts', 'build.mjs', 'package.json', 'README.md']) {
    const copy = new Map(files)
    copy.set('vr-tour-web/' + path, String(copy.get('vr-tour-web/' + path)) + '\n/* modified */')
    expect(blocked(copy).diagnostic.code).toBe('unreviewed-vr-tour-artifact')
  }
  const unknown = new Map(files)
  unknown.set('vr-tour-web/extra.ts', 'export const harmless = true')
  expect(blocked(unknown).diagnostic.code).toBe('unreviewed-vr-tour-artifact')
  const missing = new Map(files)
  missing.delete('vr-tour-web/entry.ts')
  expect(blocked(missing).diagnostic.code).toBe('unreviewed-vr-tour-artifact')
  const provenance = new Map(files)
  provenance.set('vr-tour-web/SOURCES.json', '{"sourceUrl":"https://example.invalid/fake"}')
  expect(blocked(provenance).diagnostic.code).toBe('unreviewed-vr-tour-artifact')
  const outside = new Map(files)
  outside.set('src/untrusted.ts', "fetch('https://example.invalid/api')")
  expect(blocked(outside).diagnostic.code).toBe('remote-url-detected')
})

test('closed manifest validation rejects malformed schemas, identities and budgets', () => {
  const files = output().files
  const original = manifest(files)
  const cases: unknown[] = [
    null,
    [],
    {},
    { ...original, extra: true },
    { ...original, target: 'expo' },
    { ...original, tours: [] },
    { ...original, tours: Array.from({ length: 101 }, () => original.tours[0]) },
    { ...original, tours: [{ ...original.tours[0], config: null }] },
    {
      ...original,
      tours: [{ ...original.tours[0], config: { ...original.tours[0].config, script: 'run' } }]
    },
    { ...original, tours: [{ ...original.tours[0], sourceId: 'different-node' }] },
    { ...original, tours: [{ ...original.tours[0], extra: true }] },
    { ...original, assets: [{ ...original.assets[0], byteLength: 25 * 1024 * 1024 }] },
    { ...original, assets: [{ ...original.assets[0], mime: 'text/javascript' }] },
    { ...original, assets: [{ ...original.assets[0], chunks: ['../outside.bin'] }] },
    { ...original, assets: [{ ...original.assets[0], extra: true }] }
  ]
  for (const invalid of cases) {
    expect(blocked(setManifest(files, invalid)).diagnostic.code).toBe('unreviewed-vr-tour-artifact')
  }
  const oversized = new Map(files)
  oversized.set('vr-tour-web/manifest.json', ' '.repeat(1024 * 1024 + 1))
  expect(blocked(oversized).diagnostic.code).toBe('unreviewed-vr-tour-artifact')
})

test('image chunks require exact content and authored URLs do not exempt credentials', () => {
  const files = output().files
  const path = 'vr-tour-web/' + manifest(files).assets[0].chunks[0]
  const corrupt = new Map(files)
  corrupt.set(path, new Uint8Array([1, 2, 3]))
  expect(blocked(corrupt).diagnostic.code).toBe('unreviewed-vr-tour-artifact')
  const missing = new Map(files)
  missing.delete(path)
  expect(blocked(missing).diagnostic.code).toBe('unreviewed-vr-tour-artifact')
  expect(() =>
    assertMiniProgramProjectArtifactSafe(
      output(PNG, 'https://cdn.example.invalid/room.jpg').files,
      'taro'
    )
  ).not.toThrow()
  const secret = `sk-proj-${'Z'.repeat(24)}`
  const rejected = blocked(output(PNG, '/assets/vr-tour/living-room.png', secret).files)
  expect(rejected.diagnostic.code).toBe('secret-detected')
  expect(rejected.message).not.toContain(secret)
})

test('non-pinned image metadata is scanned after reassembly across chunk boundaries', () => {
  const bytes = new Uint8Array(1024 * 1024 + 256)
  bytes.set(PNG)
  bytes.set(new TextEncoder().encode(' /Users/example/private/source.psd'), 1024 * 1024 - 4)
  const files = output(bytes).files
  expect(manifest(files).assets[0].chunks).toHaveLength(2)
  expect(blocked(files).diagnostic.code).toBe('absolute-local-path-detected')
})

test('only exact public sample bytes bypass compressed-entropy false positives', () => {
  const sample = VR_TOUR_SAMPLE_ASSETS[0]
  const bytes = new Uint8Array(readFileSync('packages/demos/vr-tour/' + sample.fileName))
  const files = output(bytes, sample.panoramaUrl).files
  expect(reviewTaroVRTourHybridArtifacts(files)?.images).toHaveLength(0)
  expect(() => assertMiniProgramProjectArtifactSafe(files, 'taro')).not.toThrow()
  const changed = bytes.slice()
  changed[changed.length - 1] ^= 1
  const changedFiles = output(changed, sample.panoramaUrl).files
  expect(reviewTaroVRTourHybridArtifacts(changedFiles)?.images).toHaveLength(1)
  expect(blocked(changedFiles).diagnostic.code).toBe('absolute-local-path-detected')
  const forged = manifest(changedFiles)
  forged.assets[0].sha256 = sample.sha256
  expect(blocked(setManifest(changedFiles, forged)).diagnostic.code).toBe(
    'unreviewed-vr-tour-artifact'
  )
})
