import { expect, setDefaultTimeout, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseOpenPencilMicrofrontendRuntimeManifestJSON,
  type OpenPencilMicrofrontendCompositionManifestV1
} from '@open-pencil/compiler/microfrontend'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/scene-graph'

import { cliSourcePath } from '#tests/helpers/paths'

setDefaultTimeout(60_000)

const CLI = cliSourcePath('index.ts')

async function writeDocument(path: string): Promise<void> {
  const graph = new SceneGraph()
  const home = graph.getPages()[0]
  graph.updateNode(home.id, { name: 'Home' })
  graph.createNode('TEXT', home.id, {
    name: 'Welcome',
    characters: 'Welcome',
    width: 180,
    height: 32
  })
  const details = graph.addPage('Details')
  graph.createNode('RECTANGLE', details.id, { width: 120, height: 80 })
  const written = await new IORegistry(BUILTIN_IO_FORMATS).writeDocument('fig', graph)
  await Bun.write(path, written.data as Uint8Array)
}

async function runCLI(args: string[]): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  const child = Bun.spawn(['bun', CLI, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ])
  return { exitCode, stdout, stderr }
}

async function buildApp(
  document: string,
  outDir: string,
  target: 'react' | 'vue',
  appId: string
): Promise<void> {
  const result = await runCLI([
    'build',
    document,
    '--target',
    target,
    '--packaging',
    'microfrontend',
    '--app-id',
    appId,
    '--app-version',
    '1.0.0',
    '--json',
    '-o',
    outDir
  ])
  expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0)
  const report = JSON.parse(result.stdout) as {
    microfrontend: { manifest: { digest: string; byteLength: number } }
  }
  expect(report.microfrontend.manifest.digest).toMatch(/^[A-Za-z0-9_-]{43}$/)
  const manifest = parseOpenPencilMicrofrontendRuntimeManifestJSON(
    await Bun.file(join(outDir, 'openpencil.microfrontend.json')).text()
  )
  expect(report.microfrontend.manifest.byteLength).toBe(
    (await Bun.file(join(outDir, 'openpencil.microfrontend.json')).arrayBuffer()).byteLength
  )
  expect(manifest.app).toMatchObject({ id: appId, framework: target, version: '1.0.0' })
  expect(manifest.routes).toEqual(['/', '/details'])
  expect(await Bun.file(join(outDir, 'index.html')).exists()).toBe(false)
  expect(
    await Bun.file(join(outDir, manifest.artifact.entry.path.replace(/^\.\//, ''))).exists()
  ).toBe(true)
}

test('CLI builds React and Vue microfrontends and composes their verified local artifacts', async () => {
  const directory = join(tmpdir(), `openpencil-cli-mfe-${randomUUID()}`)
  const document = join(directory, 'document.fig')
  const reactDir = join(directory, 'react-app')
  const vueDir = join(directory, 'vue-app')
  const shellDir = join(directory, 'shell')
  const compositionPath = join(directory, 'openpencil.composition.source.json')
  try {
    await mkdir(directory, { recursive: true })
    await writeDocument(document)
    await buildApp(document, reactDir, 'react', 'acme.react-app')
    await buildApp(document, vueDir, 'vue', 'acme.vue-app')

    const composition: OpenPencilMicrofrontendCompositionManifestV1 = {
      format: 'openpencil-microfrontend-composition',
      schemaVersion: 1,
      abi: 'openpencil.microfrontend.v1',
      composition: { id: 'acme.shell', name: 'Acme Shell', version: '1.0.0' },
      slots: [{ id: 'main' }, { id: 'sidebar' }],
      apps: [
        {
          appId: 'acme.react-app',
          manifest: { kind: 'local', path: './react-app/openpencil.microfrontend.json' },
          routeBase: '/',
          slotId: 'main'
        },
        {
          appId: 'acme.vue-app',
          manifest: { kind: 'local', path: './vue-app/openpencil.microfrontend.json' },
          routeBase: '/',
          slotId: 'sidebar'
        }
      ]
    }
    await Bun.write(compositionPath, JSON.stringify(composition))
    const composed = await runCLI([
      'microfrontend',
      'compose',
      compositionPath,
      '--base',
      '/suite/',
      '--json',
      '-o',
      shellDir
    ])
    expect(composed.exitCode, `${composed.stdout}\n${composed.stderr}`).toBe(0)
    expect(JSON.parse(composed.stdout)).toMatchObject({ apps: 2, slots: 2, outDir: shellDir })
    expect(await Bun.file(join(shellDir, 'index.html')).exists()).toBe(true)
    expect(await Bun.file(join(shellDir, 'react-app/openpencil.microfrontend.json')).exists()).toBe(
      true
    )
    expect(await Bun.file(join(shellDir, 'vue-app/openpencil.microfrontend.json')).exists()).toBe(
      true
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
