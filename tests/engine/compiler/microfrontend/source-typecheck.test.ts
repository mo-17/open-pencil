import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

setDefaultTimeout(30_000)

const directories: string[] = []

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true })
})

function generatedProject(target: 'react' | 'vue'): string {
  const graph = new SceneGraph()
  const home = graph.getPages()[0]
  graph.updateNode(home.id, { name: 'Home' })
  graph.createNode('TEXT', home.id, {
    name: 'Welcome',
    characters: 'Welcome',
    width: 200,
    height: 32
  })
  const details = graph.addPage('Details')
  graph.createNode('RECTANGLE', details.id, { width: 100, height: 80 })
  const output = compile({
    graph,
    pageIds: [home.id, details.id],
    options: withDefaults({
      packageName: `${target}-microfrontend-typecheck`,
      target,
      router: target === 'react' ? 'react-router-v6' : 'vue-router-v4',
      devMode: false,
      packaging: { kind: 'microfrontend', appId: `acme.${target}` }
    })
  })
  const directory = mkdtempSync(join(process.cwd(), `.openpencil-mfe-${target}-`))
  directories.push(directory)
  for (const [path, content] of output.files) {
    const destination = join(directory, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, content)
  }
  return directory
}

async function typecheck(target: 'react' | 'vue'): Promise<void> {
  const directory = generatedProject(target)
  const { readdirSync, readFileSync } = await import('node:fs')
  const files = new Map<string, string>()
  for (const path of readdirSync(directory, { recursive: true })) {
    if (typeof path !== 'string') continue
    const fullPath = join(directory, path)
    const { statSync } = await import('node:fs')
    if (statSync(fullPath).isFile()) files.set(path, readFileSync(fullPath, 'utf8'))
  }
  typeCheckCompilerFiles(files, target)
}

describe('generated microfrontend source projects', () => {
  test('React lifecycle source typechecks without a compiler package dependency', async () => {
    await typecheck('react')
  })

  test('Vue lifecycle source typechecks without a compiler package dependency', async () => {
    await typecheck('vue')
  })
})
