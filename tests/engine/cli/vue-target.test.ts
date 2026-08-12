import { expect, setDefaultTimeout, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/scene-graph'

import { cliSourcePath } from '#tests/helpers/paths'

setDefaultTimeout(30_000)

const CLI = cliSourcePath('index.ts')

async function writeDocument(path: string): Promise<void> {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, { name: 'Home' })
  graph.createNode('RECTANGLE', page.id, { width: 120, height: 80 })
  const second = graph.addPage('Details')
  graph.createNode('RECTANGLE', second.id, { width: 80, height: 40 })
  const written = await new IORegistry(BUILTIN_IO_FORMATS).writeDocument('fig', graph)
  await Bun.write(path, written.data as Uint8Array)
}

async function runCLI(args: string[]): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  const process = Bun.spawn(['bun', CLI, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text()
  ])
  return { exitCode, stdout, stderr }
}

test('compile/build CLI emits Vue source and a deployable Vue static bundle', async () => {
  const directory = join(tmpdir(), `openpencil-cli-vue-${randomUUID()}`)
  const document = join(directory, 'document.fig')
  const source = join(directory, 'source')
  const dist = join(directory, 'dist')
  try {
    await writeDocument(document)
    const compiled = await runCLI(['compile', document, '--target', 'vue', '--json', '-o', source])
    expect(compiled.exitCode).toBe(0)
    const summary = JSON.parse(compiled.stdout) as {
      target?: unknown
      warnings?: Array<{ code?: unknown }>
    }
    expect(summary.target).toBe('vue')
    expect(summary.warnings?.some((warning) => warning.code === 'vue-font-assets-omitted')).toBe(
      true
    )
    expect(await Bun.file(join(source, 'src/App.vue')).exists()).toBe(true)
    expect(await Bun.file(join(source, 'src/router.ts')).exists()).toBe(true)
    expect(await Bun.file(join(source, 'src/App.tsx')).exists()).toBe(false)

    const built = await runCLI(['build', document, '--target', 'vue', '--json', '-o', dist])
    expect(built.exitCode).toBe(0)
    expect((JSON.parse(built.stdout) as { target?: unknown }).target).toBe('vue')
    expect(await Bun.file(join(dist, 'index.html')).exists()).toBe(true)
    expect(await Bun.file(join(dist, 'src/App.vue')).exists()).toBe(false)
    const assetNames = Array.fromAsync(new Bun.Glob('assets/*.js').scan({ cwd: dist }))
    expect((await assetNames).length).toBeGreaterThan(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Vue CLI rejects unsupported flags before writing source output', async () => {
  const directory = join(tmpdir(), `openpencil-cli-vue-reject-${randomUUID()}`)
  const document = join(directory, 'document.fig')
  const source = join(directory, 'source')
  try {
    await writeDocument(document)
    const result = await runCLI(['compile', document, '--target', 'vue', '--i18n', '-o', source])
    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('Vue v1 does not support --i18n')
    expect(await Bun.file(source).exists()).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('deploy applies the same Vue target feature policy before contacting a provider', async () => {
  const directory = join(tmpdir(), `openpencil-cli-vue-deploy-reject-${randomUUID()}`)
  const document = join(directory, 'document.fig')
  try {
    await writeDocument(document)
    const result = await runCLI([
      'deploy',
      document,
      '--provider',
      'netlify',
      '--token',
      'not-used',
      '--target',
      'vue',
      '--i18n'
    ])
    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('Vue v1 does not support --i18n')
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('api.netlify.com')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
