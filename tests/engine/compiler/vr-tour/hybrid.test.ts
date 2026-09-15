import { afterEach, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { assertMiniProgramExportProjectBudget } from '#compiler/adapters/miniprogram-shared'
import { emitVRTourHybridProject, vrTourHybridKey } from '#compiler/adapters/vr-tour/hybrid'
import { VR_TOUR_HYBRID_OWNERSHIP_FILE } from '#compiler/adapters/vr-tour/hybrid/build'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import {
  createLocalizedVRTourConfig,
  createVRTourModuleInstance,
  createVRTourSampleScenes,
  VR_TOUR_SAMPLE_ASSETS
} from '@open-pencil/core/plugins'

import { tourFixture } from './helpers'

const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

function sampleIR() {
  const fixture = tourFixture()
  const config = createLocalizedVRTourConfig('zh-CN')
  config.scenes = createVRTourSampleScenes('zh-CN')
  fixture.graph.updateNode(fixture.node.id, {
    interactiveProps: { module: createVRTourModuleInstance(config) }
  })
  for (const sample of VR_TOUR_SAMPLE_ASSETS)
    fixture.graph.images.set(
      sample.graphImageHash,
      new Uint8Array(readFileSync(resolve('packages/demos/vr-tour', sample.fileName)))
    )
  return { ir: collectTree(fixture.graph, fixture.pageId), nodeId: fixture.node.id }
}

function writeProject(files: ReadonlyMap<string, string | Uint8Array>) {
  const root = mkdtempSync(join(tmpdir(), 'openpencil-vr-hybrid-'))
  directories.push(root)
  for (const [path, value] of files) {
    const destination = join(root, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, value)
  }
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir')
  return root
}

for (const target of ['expo', 'flutter', 'taro'] as const) {
  test(`${target} prepares a real self-contained PSV player with exact saved 8K bytes`, () => {
    const { ir, nodeId } = sampleIR()
    const emission = emitVRTourHybridProject([ir], [], target)
    expect([...emission.tourIds]).toEqual([nodeId])
    expect([...emission.files.keys()].some((path) => path.startsWith('public/'))).toBe(false)
    if (target === 'taro')
      expect(() => assertMiniProgramExportProjectBudget(target, emission.files)).not.toThrow()
    const root = writeProject(emission.files)
    const result = Bun.spawnSync({
      cmd: ['node', 'vr-tour-web/build.mjs'],
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe'
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const html = readFileSync(
      join(
        root,
        target === 'flutter' ? 'assets/vr-tour' : 'vr-tour-web/dist',
        vrTourHybridKey(nodeId) + '.html'
      ),
      'utf8'
    )
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('__openpencilDisposeVRTour')
    expect(html).not.toContain('<script src=')
    const json = html.match(/id="openpencil-tour-data">(.*?)<\/script>/)?.[1]
    expect(json).toBeDefined()
    const data = JSON.parse(json ?? '{}')
    expect(data.config.locale).toBe('zh-CN')
    for (const sample of VR_TOUR_SAMPLE_ASSETS)
      expect(Buffer.from(data.assets[sample.panoramaUrl].base64, 'base64')).toEqual(
        readFileSync(resolve('packages/demos/vr-tour', sample.fileName))
      )
    if (target === 'expo')
      expect(readFileSync(join(root, 'src/vr-tour-html.ts'), 'utf8')).toContain(
        JSON.stringify(nodeId)
      )
    const retain = process.env.OPENPENCIL_VR_HYBRID_EXPORT_ROOT
    if (retain) {
      const destination = join(retain, target)
      mkdirSync(destination, { recursive: true })
      writeFileSync(join(destination, 'index.html'), html)
    }
  }, 30000)
}

test('dynamic bindings never prepare authored fallback HTML', () => {
  const { graph, pageId } = tourFixture({ kind: 'expr', expr: 'selectedProperty.panorama_url' })
  const result = emitVRTourHybridProject([collectTree(graph, pageId)], [], 'expo')
  expect(result.tourIds.size).toBe(0)
  expect(result.files.size).toBe(0)
})

test('preparation fails before output when saved chunks are modified', async () => {
  const { ir } = sampleIR()
  const result = emitVRTourHybridProject([ir], [], 'expo')
  const root = writeProject(result.files)
  const chunk = [...result.files.keys()].find((path) => path.endsWith('.bin'))
  if (!chunk) throw new Error('Missing sample chunks')
  writeFileSync(join(root, chunk), new Uint8Array([1, 2, 3]))
  const process = Bun.spawn({
    cmd: ['node', 'vr-tour-web/build.mjs'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text()
  ])
  expect(exitCode, stderr).not.toBe(0)
  expect(readFileSync(join(root, 'src/vr-tour-html.ts'), 'utf8')).toContain('= {}')
  expect(existsSync(join(root, 'vr-tour-web/dist'))).toBe(false)
  const originalChunk = result.files.get(chunk)
  if (!originalChunk) throw new Error('Missing original chunk')
  writeFileSync(join(root, chunk), originalChunk)
  const repaired = prepareProject(root)
  expect(repaired.exitCode, repaired.stderr.toString()).toBe(0)
  expect(readFileSync(join(root, 'src/vr-tour-html.ts'), 'utf8')).not.toContain('= {}')
})

test('authored closing-script text stays inert in prepared HTML', () => {
  const { ir, nodeId } = sampleIR()
  const emission = emitVRTourHybridProject([ir], [], 'expo')
  const manifest = JSON.parse(String(emission.files.get('vr-tour-web/manifest.json')))
  manifest.tours[0].config.label = '</script><script>throw new Error("injected")</script>'
  emission.files.set('vr-tour-web/manifest.json', JSON.stringify(manifest))
  const root = writeProject(emission.files)
  const result = Bun.spawnSync({
    cmd: ['node', 'vr-tour-web/build.mjs'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  const html = readFileSync(
    join(root, 'vr-tour-web/dist', vrTourHybridKey(nodeId) + '.html'),
    'utf8'
  )
  expect(html).not.toContain('<script>throw new Error("injected")')
  expect(html).toContain('\\u003c/script>')
})

function prepareProject(root: string) {
  return Bun.spawnSync({
    cmd: ['node', 'vr-tour-web/build.mjs'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe'
  })
}

function staticProject(target: 'expo' | 'flutter' | 'taro' = 'taro') {
  const { graph, pageId } = tourFixture()
  const emission = emitVRTourHybridProject([collectTree(graph, pageId)], [], target)
  const root = writeProject(emission.files)
  const manifestPath = join(root, 'vr-tour-web/manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const output = join(root, target === 'flutter' ? 'assets/vr-tour' : 'vr-tour-web/dist')
  return { root, manifest, manifestPath, output }
}

for (const target of ['expo', 'flutter', 'taro'] as const) {
  test(`${target} removes only previously owned tours after a complete successful rebuild`, () => {
    const { root, manifest, manifestPath, output } = staticProject(target)
    const old = manifest.tours[0]
    const retained = { ...old, sourceId: 'retained-tour', key: vrTourHybridKey('retained-tour') }
    manifest.tours.push(retained)
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const first = prepareProject(root)
    expect(first.exitCode, first.stderr.toString()).toBe(0)
    expect(existsSync(join(output, old.key + '.html'))).toBe(true)
    manifest.tours = [retained]
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const second = prepareProject(root)
    expect(second.exitCode, second.stderr.toString()).toBe(0)
    expect(readdirSync(output).sort()).toEqual([
      VR_TOUR_HYBRID_OWNERSHIP_FILE,
      retained.key + '.html'
    ])
    const ownership = JSON.parse(readFileSync(join(output, VR_TOUR_HYBRID_OWNERSHIP_FILE), 'utf8'))
    expect(ownership.files.map((file: { path: string }) => file.path)).toEqual([
      retained.key + '.html'
    ])
  })
}

test('unknown output files prevent rebuilding without deleting or overwriting existing data', () => {
  const { root, manifest, manifestPath, output } = staticProject()
  expect(prepareProject(root).exitCode).toBe(0)
  const name = manifest.tours[0].key + '.html'
  const previousHTML = readFileSync(join(output, name))
  const previousOwnership = readFileSync(join(output, VR_TOUR_HYBRID_OWNERSHIP_FILE))
  writeFileSync(join(output, 'user-notes.txt'), 'keep this user file')
  manifest.tours = []
  writeFileSync(manifestPath, JSON.stringify(manifest))
  expect(prepareProject(root).exitCode).not.toBe(0)
  expect(readFileSync(join(output, 'user-notes.txt'), 'utf8')).toBe('keep this user file')
  expect(readFileSync(join(output, name))).toEqual(previousHTML)
  expect(readFileSync(join(output, VR_TOUR_HYBRID_OWNERSHIP_FILE))).toEqual(previousOwnership)
})

test('a nonempty directory without ownership is never adopted or cleaned', () => {
  const { root, manifest, output } = staticProject()
  mkdirSync(output, { recursive: true })
  const path = join(output, manifest.tours[0].key + '.html')
  writeFileSync(path, 'user owned despite matching the generated filename')
  expect(prepareProject(root).exitCode).not.toBe(0)
  expect(readFileSync(path, 'utf8')).toBe('user owned despite matching the generated filename')
  expect(existsSync(join(output, VR_TOUR_HYBRID_OWNERSHIP_FILE))).toBe(false)
})

test('an owned filename whose contents were edited is preserved instead of overwritten', () => {
  const { root, manifest, output } = staticProject()
  expect(prepareProject(root).exitCode).toBe(0)
  const path = join(output, manifest.tours[0].key + '.html')
  const ownership = readFileSync(join(output, VR_TOUR_HYBRID_OWNERSHIP_FILE))
  writeFileSync(path, 'manually edited output')
  expect(prepareProject(root).exitCode).not.toBe(0)
  expect(readFileSync(path, 'utf8')).toBe('manually edited output')
  expect(readFileSync(join(output, VR_TOUR_HYBRID_OWNERSHIP_FILE))).toEqual(ownership)
})

test('owned-file symlinks and output-directory symlinks cannot redirect a rebuild', () => {
  for (const directoryLink of [false, true]) {
    const { root, manifest, output } = staticProject()
    const outside = join(root, 'outside')
    mkdirSync(outside)
    const protectedFile = join(outside, 'user.txt')
    writeFileSync(protectedFile, 'protected')
    if (directoryLink) symlinkSync(outside, output, 'dir')
    else {
      expect(prepareProject(root).exitCode).toBe(0)
      const path = join(output, manifest.tours[0].key + '.html')
      unlinkSync(path)
      symlinkSync(protectedFile, path)
    }
    expect(prepareProject(root).exitCode).not.toBe(0)
    expect(readFileSync(protectedFile, 'utf8')).toBe('protected')
  }
})

test('all tour entries are validated before the first generated output is written', () => {
  const { root, manifest, manifestPath, output } = staticProject()
  manifest.tours.push({ ...manifest.tours[0], key: '../invalid' })
  writeFileSync(manifestPath, JSON.stringify(manifest))
  expect(prepareProject(root).exitCode).not.toBe(0)
  expect(existsSync(output)).toBe(false)
})
