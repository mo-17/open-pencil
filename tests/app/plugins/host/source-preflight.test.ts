import { describe, expect, test } from 'bun:test'

import { withDefaults, type CompilerOutput } from '@open-pencil/compiler'
import { createShaderPaint, SceneGraph, withShaderPaints } from '@open-pencil/scene-graph'

import { exportPreflightReport } from '@/app/document/export/preflight/state'
import {
  prepareSourceProjectCompilerInput,
  runSourceProjectExport,
  type RunSourceProjectExportOptions,
  type SourceExporterEditor
} from '@/app/plugins/host/source-exporter-runtime'
import { createDeferred } from '@/app/runtime/deferred'

function fixture() {
  const editor: SourceExporterEditor = {
    graph: new SceneGraph(),
    state: { documentName: 'Preflight project', sceneVersion: 0 }
  }
  const calls: string[] = []
  const options: RunSourceProjectExportOptions<SourceExporterEditor> = {
    editor,
    fileName: 'preflight.zip',
    compilerTargetName: 'React',
    dependencies: {
      chooseDestination: async () => ({
        write: async () => {
          calls.push('write')
          return true
        }
      }),
      resolveFontManifest: async () => ({ faces: [] }),
      compile: async () => {
        calls.push('compile')
        return {
          files: new Map<string, string | Uint8Array>([
            ['src/App.tsx', 'export default function App() {}']
          ]),
          warnings: []
        }
      },
      archive: async () => {
        calls.push('archive')
        return new Uint8Array([1, 2, 3])
      }
    },
    createCompilerInput: ({ pageIds, fontManifest }) => ({
      graph: editor.graph,
      pageIds,
      fontManifest,
      options: withDefaults({ target: 'react' })
    }),
    buildProject: (files) => new Map(files)
  }
  return { editor, options, calls }
}

function applicationFixture() {
  const base = fixture()
  const graph = base.editor.graph
  const page = graph.getPages()[0]
  const entry = graph.createNode('FRAME', page.id, { width: 320, height: 240 })
  graph.updateNode(page.id, {
    lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: entry.id }
  })
  const reference = graph.addPage('Reference')
  graph.updateNode(reference.id, { lowcodeApplicationPage: { version: 1, role: 'reference' } })
  const shell = graph.createNode('FRAME', reference.id, {
    width: 400,
    height: 300,
    layoutMode: 'VERTICAL'
  })
  const slot = graph.createNode('FRAME', shell.id, {
    width: 320,
    height: 240,
    layoutMode: 'VERTICAL'
  })
  graph.updateNode(graph.rootId, {
    lowcodeApplication: {
      version: 1,
      enabled: true,
      startPageId: page.id,
      shell: { frameNodeId: shell.id, slotNodeId: slot.id }
    }
  })
  return { ...base, page, entry, reference, shell, slot }
}

function missingImage(graph: SceneGraph, parentId: string) {
  return graph.createNode('RECTANGLE', parentId, {
    fills: [
      {
        type: 'IMAGE',
        imageHash: 'unavailable-source',
        imageScaleMode: 'FILL',
        color: { r: 0, g: 0, b: 0, a: 1 },
        visible: true,
        opacity: 1
      }
    ]
  })
}

describe('source-export preflight integration seam', () => {
  test('application export ignores reference assets and material outside its entry', async () => {
    const { editor, options, calls, page, entry, reference, shell } = applicationFixture()
    missingImage(editor.graph, reference.id)
    missingImage(editor.graph, page.id)
    const pageIds = editor.graph.getPages().map((page) => page.id)
    const compile = options.dependencies.compile
    options.dependencies.compile = async (input, signal) => {
      expect(input.pageIds).toEqual(pageIds)
      return compile(input, signal)
    }
    expect((await runSourceProjectExport(options)).saved).toBe(true)
    expect(calls).toEqual(['compile', 'archive', 'write'])
    expect(exportPreflightReport(editor.graph).value?.nodeIds).toEqual([entry.id, shell.id])
    expect(exportPreflightReport(editor.graph).value?.blockingCount).toBe(0)
  })

  for (const location of ['entry', 'shell'] as const)
    test(`application ${location} missing images block before compilation`, async () => {
      const { editor, options, calls, entry, shell } = applicationFixture()
      const node = missingImage(editor.graph, location === 'entry' ? entry.id : shell.id)
      await expect(runSourceProjectExport(options)).rejects.toThrow('Export preflight failed')
      expect(calls).toEqual([])
      expect(exportPreflightReport(editor.graph).value?.issues).toContainEqual(
        expect.objectContaining({ code: 'missing-image', nodeId: node.id, severity: 'error' })
      )
    })

  test('post-compile inspection resolves the current application entry rather than cached roots', async () => {
    const { editor, options, calls, page, entry, shell } = applicationFixture()
    const next = editor.graph.createNode('FRAME', page.id, { width: 320, height: 240 })
    const choose = options.dependencies.chooseDestination
    options.dependencies.chooseDestination = async (name, signal) => {
      editor.graph.updateNode(page.id, {
        lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: next.id }
      })
      missingImage(editor.graph, entry.id)
      return choose(name, signal)
    }
    expect((await runSourceProjectExport(options)).saved).toBe(true)
    expect(exportPreflightReport(editor.graph).value?.nodeIds).toEqual([next.id, shell.id])
    expect(calls).toEqual(['compile', 'archive', 'write'])
  })

  test('Shader preparation preserves original pages for compiler-owned component dependencies', async () => {
    const { editor, page, reference } = applicationFixture()
    const observed: string[][] = []
    editor.settleShaderFrames = async (options) => {
      observed.push([...(options?.nodeIds ?? [])])
    }
    const pageIds = [page.id, reference.id]
    const input = await prepareSourceProjectCompilerInput(
      { editor, pageIds, fontManifest: { faces: [] } },
      { package: 'scope-test', product: 'Scope test' },
      'react'
    )
    expect(input.pageIds).toEqual(pageIds)
    expect(observed).toEqual([pageIds])
    editor.graph.updateNode(editor.graph.rootId, {
      lowcodeApplication: { version: 1, enabled: false }
    })
    await prepareSourceProjectCompilerInput(
      { editor, pageIds, fontManifest: { faces: [] } },
      { package: 'scope-test', product: 'Scope test' },
      'react'
    )
    expect(observed.at(-1)).toEqual(pageIds)
  })

  test('invalid application scope reaches compiler diagnostics without scanning unrelated assets', async () => {
    const { editor, options, calls, reference } = applicationFixture()
    missingImage(editor.graph, reference.id)
    editor.graph.updateNode(editor.graph.rootId, {
      lowcodeApplication: { version: 1, enabled: true, startPageId: 'missing-page' }
    })
    options.dependencies.compile = async () => {
      calls.push('compile')
      return {
        files: new Map(),
        warnings: [{ code: 'application-start-invalid', message: 'Start page is invalid.' }]
      }
    }
    await expect(runSourceProjectExport(options)).rejects.toThrow('Compiler produced no')
    expect(calls).toEqual(['compile'])
    const report = exportPreflightReport(editor.graph).value
    expect(report?.nodeIds).toEqual([])
    expect(report?.issues).toContainEqual(
      expect.objectContaining({ code: 'application-start-invalid' })
    )
    expect(report?.issues[0]).toMatchObject({ code: 'compiler-empty-output', severity: 'error' })
    expect(report?.blockingCount).toBe(1)
  })

  test('compiler failure reports an error first within the 100-issue display bound', async () => {
    const { editor, options, calls } = fixture()
    for (let index = 0; index < 100; index++) {
      const { paint, shader } = createShaderPaint({
        components: [{ type: 'Pixelate', props: { scale: 12 } }]
      })
      const node = editor.graph.createNode('FRAME', editor.graph.getPages()[0].id, {
        fills: [paint]
      })
      editor.graph.updateNode(node.id, {
        pluginData: withShaderPaints(
          node,
          [paint],
          [{ ...shader, input: { kind: 'self', version: 1 } }]
        )
      })
      editor.graph.images.set(shader.image, new Uint8Array([1, 2, 3]))
    }
    options.dependencies.compile = async () => {
      calls.push('compile')
      throw new Error('Compiler fixture failure')
    }
    await expect(runSourceProjectExport(options)).rejects.toThrow('Compiler fixture failure')
    const report = exportPreflightReport(editor.graph).value
    expect(report?.issues).toHaveLength(100)
    expect(report?.issues[0]).toMatchObject({ code: 'compiler-failed', severity: 'error' })
    expect(report?.truncated).toBe(true)
    expect(report?.blockingCount).toBe(1)
    expect(calls).toEqual(['compile'])
  })

  test('empty compiler output publishes a blocking report and cannot archive or write', async () => {
    const { editor, options, calls } = fixture()
    options.dependencies.compile = async () => {
      calls.push('compile')
      return { files: new Map(), warnings: [] }
    }
    await expect(runSourceProjectExport(options)).rejects.toThrow('Compiler produced no')
    expect(calls).toEqual(['compile'])
    expect(exportPreflightReport(editor.graph).value?.issues[0]).toMatchObject({
      code: 'compiler-empty-output',
      severity: 'error'
    })
    expect(exportPreflightReport(editor.graph).value?.blockingCount).toBe(1)
  })

  test('a saved own-content frame exports with a linked static-fallback warning', async () => {
    const { editor, options, calls } = fixture()
    const { paint, shader } = createShaderPaint({
      components: [{ type: 'Pixelate', props: { scale: 8 } }]
    })
    const node = editor.graph.createNode('FRAME', editor.graph.getPages()[0].id, { fills: [paint] })
    editor.graph.updateNode(node.id, {
      pluginData: withShaderPaints(
        node,
        [paint],
        [{ ...shader, input: { kind: 'self', version: 1 } }]
      )
    })
    // Simulated saved bytes; compilation and ZIP creation are injected stand-ins.
    editor.graph.images.set(shader.image, new Uint8Array([1, 2, 3]))
    const result = await runSourceProjectExport(options)
    expect(result.saved).toBe(true)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'export-shader-static', nodeId: node.id })
    )
    expect(exportPreflightReport(editor.graph).value?.issues).toContainEqual(
      expect.objectContaining({ code: 'shader-static', nodeId: node.id })
    )
    expect(calls).toEqual(['compile', 'archive', 'write'])
  })

  test('changing documents during destination selection prevents compile and write', async () => {
    const { editor, options, calls } = fixture()
    const destination = createDeferred<undefined>()
    const entered = createDeferred<undefined>()
    options.dependencies.chooseDestination = async () => {
      entered.resolve(undefined)
      await destination.promise
      return {
        write: async () => {
          calls.push('write')
          return true
        }
      }
    }
    const pending = runSourceProjectExport(options)
    await entered.promise
    editor.graph = new SceneGraph()
    destination.resolve(undefined)
    await expect(pending).rejects.toThrow('Document changed during source export')
    expect(calls).toEqual([])
  })

  test('same-graph edits during compilation cannot archive or write stale output', async () => {
    const { editor, options, calls } = fixture()
    const compiled = createDeferred<CompilerOutput>()
    const entered = createDeferred<undefined>()
    options.dependencies.compile = async () => {
      calls.push('compile')
      entered.resolve(undefined)
      return compiled.promise
    }
    const pending = runSourceProjectExport(options)
    await entered.promise
    editor.state.sceneVersion = 1
    compiled.resolve({ files: new Map([['src/App.tsx', 'old output']]), warnings: [] })
    await expect(pending).rejects.toThrow('Document changed during source export')
    expect(calls).toEqual(['compile'])
  })
})
