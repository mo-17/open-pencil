import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { effectPickRuntimeSource } from '#compiler/adapters/effect-pick/source'
import { buildBrowserPreview } from '#compiler/browser-preview'
import { buildPreviewProject } from '#compiler/build'
import { compile, withDefaults } from '#compiler/index'
import { collectTree } from '#compiler/ir/collect/tree'
import type { IRElement } from '#compiler/ir/types'

import {
  createEffectPickModuleFrameOverrides,
  EFFECT_PICK_CATALOG,
  resolveEffectPickModule
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import { effectEntry, effectPickFixture } from '../helpers/effect-pick'

describe('EffectPick compiler module', () => {
  for (const target of ['react', 'vue'] as const) {
    test(`exports only authored outer frame paints in ${target}`, () => {
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      const defaults = EFFECT_PICK_CATALOG.map((entry, index) =>
        graph.createNode('FRAME', page.id, {
          ...createEffectPickModuleFrameOverrides(entry.defaultConfig),
          x: 20,
          y: 20 + index * 200
        })
      )
      const authored = graph.createNode('FRAME', page.id, {
        ...createEffectPickModuleFrameOverrides(),
        x: 380,
        y: 20,
        fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
        strokes: [
          {
            color: { r: 0, g: 1, b: 0, a: 1 },
            weight: 3,
            align: 'INSIDE',
            opacity: 1,
            visible: true
          }
        ]
      })
      const ir = collectTree(graph, page.id)
      const elements = ir.children.filter((child): child is IRElement => child.kind === 'element')
      expect(elements).toHaveLength(defaults.length + 1)
      for (const node of defaults) {
        expect(node.fills).toEqual([])
        expect(node.strokes).toEqual([])
        const element = elements.find((candidate) => candidate.sourceId === node.id)
        if (!element) throw new Error('Missing default EffectPick IR')
        const resolved = resolveEffectPickModule(node.interactiveProps?.module)
        if (!resolved?.ok) throw new Error('Invalid default EffectPick module')
        expect(element.module?.payload.effectId).toBe(resolved.config.effectId)
        expect(element.className).not.toMatch(/(?:^|\s)(?:bg-|border(?:-|$)|shadow-)/)
        expect(element.attrs.style).toBeUndefined()
      }
      const painted = elements.find((candidate) => candidate.sourceId === authored.id)
      if (!painted) throw new Error('Missing authored EffectPick IR')
      expect(painted.module?.payload.effectId).toBe('diagonal-fill')
      const authoredPaintClasses = ['bg-[#FF0000]', 'border-[#00FF00]', 'border-[3px]']
      for (const className of authoredPaintClasses) expect(painted.className).toContain(className)

      const output = compile({
        graph,
        pageIds: [page.id],
        options: withDefaults({ target, devMode: false })
      })
      const pageSources = [...output.files.entries()]
        .filter(([path]) => path === 'src/App.tsx' || path.startsWith('src/pages/'))
        .map(([, source]) => source)
        .join('\n')
      const hostClasses = [
        ...pageSources.matchAll(/<OpenPencilEffectPick\b[^\n]*\bclass(?:Name)?="([^"]+)"/g)
      ].map((match) => match[1])
      expect(hostClasses).toHaveLength(defaults.length + 1)
      for (const [index, element] of elements.entries())
        expect(hostClasses[index]).toBe(element.className)
      for (const className of authoredPaintClasses) expect(hostClasses.at(-1)).toContain(className)
      expect(output.warnings).toEqual([])
    })
  }

  test('preserves data-only config and emits only the effects used by both framework projects', () => {
    const { graph, pageId, selected } = effectPickFixture()
    const ir = collectTree(graph, pageId)
    const first = ir.children[0] as IRElement
    expect(first.module?.payload.effectId).toBe('diagonal-fill')
    expect(first.module?.payload).not.toHaveProperty('onClick')
    for (const target of ['react', 'vue'] as const) {
      const output = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ target, packageName: 'effect-pick-test', devMode: false })
      })
      const extension = target === 'react' ? 'tsx' : 'vue'
      const runtime = output.files.get(`src/__openpencil_effect_pick.${extension}`)
      if (typeof runtime !== 'string') throw new Error('Missing emitted runtime')
      expect(runtime).toContain('fx-diagonal-fill')
      expect(runtime).toContain('fx-water-text')
      expect(runtime).not.toContain('fx-neon-sign')
      expect(runtime).not.toContain('/Users/')
      const notices = output.files.get('EFFECT_PICK_SOURCES.md')
      expect(notices).toContain('UNLICENSED')
      for (const selectedEntry of selected) expect(notices).toContain(selectedEntry.source.url)
      expect(output.warnings).toEqual([])
    }
  })

  for (const target of ['react', 'vue'] as const) {
    test(`exports exact reviewed metadata for the twenty authored additions in ${target}`, () => {
      const selected = EFFECT_PICK_CATALOG.filter((entry) => entry.collectionVersion === '0.7.0')
      expect(selected).toHaveLength(20)
      for (const entry of selected) {
        const graph = new SceneGraph(),
          page = graph.getPages()[0]
        graph.createNode('FRAME', page.id, {
          ...createEffectPickModuleFrameOverrides(entry.defaultConfig),
          name: entry.title
        })
        const output = compile({
          graph,
          pageIds: [page.id],
          options: withDefaults({ target, devMode: false })
        })
        const extension = target === 'react' ? 'tsx' : 'vue'
        const source = output.files.get(`src/__openpencil_effect_pick.${extension}`)
        if (typeof source !== 'string') throw new Error('Missing emitted EffectPick runtime')
        const artifactJSON = source.match(/^const effectPickArtifacts = (.+)$/m)?.[1]
        if (!artifactJSON) throw new Error('Missing emitted reviewed artifact data')
        const emitted: unknown = JSON.parse(artifactJSON)
        expect(emitted).toEqual([
          {
            id: entry.id,
            collectionVersion: entry.collectionVersion,
            artifactDigest: entry.artifactDigest,
            events: entry.events,
            artifact: entry.artifact
          }
        ])
        const notices = output.files.get('EFFECT_PICK_SOURCES.md')
        if (typeof notices !== 'string') throw new Error('Missing source provenance notice')
        expect(notices).toContain('UNLICENSED')
        expect(notices).toContain(`(${entry.id}), collection 0.7.0, digest ${entry.artifactDigest}`)
        expect(notices).toContain(
          `Source: ${entry.source.url}; author: ${entry.source.authorName || entry.source.author};`
        )
        for (const unused of EFFECT_PICK_CATALOG.filter((candidate) => candidate.id !== entry.id)) {
          expect(notices).not.toContain(`(${unused.id}),`)
        }
        expect(output.warnings).toEqual([])
      }
    })
  }

  test('fails closed on mismatched content digest', () => {
    const { graph, pageId } = effectPickFixture()
    const node = graph.getChildren(pageId)[0]
    if (!node.interactiveProps?.module) throw new Error('Missing authored module')
    graph.updateNode(node.id, {
      interactiveProps: {
        ...node.interactiveProps,
        module: {
          ...node.interactiveProps.module,
          config: { ...effectEntry('diagonal-fill').defaultConfig, artifactDigest: '0'.repeat(64) }
        }
      }
    })
    const ir = collectTree(graph, pageId)
    expect((ir.children[0] as IRElement).module).toBeUndefined()
    expect(ir.warnings.some((warning) => warning.code === 'effect-pick-module-invalid')).toBe(true)
    expect(() =>
      effectPickRuntimeSource([{ ...effectEntry('diagonal-fill'), artifactDigest: '0'.repeat(64) }])
    ).toThrow('reviewed catalog')
  })

  test('retains the existing explicit Vue browser preview boundary', async () => {
    const { graph, pageId } = effectPickFixture()
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target: 'vue', devMode: false })
    })
    const result = await buildBrowserPreview({
      files: output.files,
      target: 'vue',
      channel: 'effectpick_browser_test_001',
      wasmURL: '/esbuild.wasm'
    })
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported')
      throw new Error('Expected existing Vue browser-preview boundary')
    expect(result.reason.code).toBe('browser-preview-vue-unsupported')
  })

  test('reports unsupported native and mini-program effect runtimes', () => {
    const { graph, pageId } = effectPickFixture()
    for (const target of [
      'expo',
      'flutter',
      'wechat-miniprogram',
      'taro',
      'uni-app',
      'mpx'
    ] as const) {
      const output = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ target, devMode: false })
      })
      expect(
        output.warnings.some(
          (warning) =>
            warning.code.includes('unsupported') && /module|runtime/.test(warning.message)
        )
      ).toBe(true)
      expect(
        [...output.files.keys()].some((path) => path.includes('__openpencil_effect_pick'))
      ).toBe(false)
    }
  })

  for (const target of ['react', 'vue'] as const) {
    test(`builds the generated ${target} project with workspace dependencies`, async () => {
      const { graph, pageId } = effectPickFixture()
      const additions = EFFECT_PICK_CATALOG.filter((entry) => entry.collectionVersion === '0.7.0')
      expect(additions).toHaveLength(20)
      for (const [index, entry] of additions.entries()) {
        graph.createNode('FRAME', pageId, {
          ...createEffectPickModuleFrameOverrides(entry.defaultConfig),
          name: entry.title,
          x: 380,
          y: 20 + index * 200
        })
      }
      const output = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ target, packageName: 'effect-pick-build', devMode: false })
      })
      expect(output.warnings).toEqual([])
      const directory = mkdtempSync(join(tmpdir(), `openpencil-effectpick-${target}-`))
      try {
        const result = await buildPreviewProject({ files: output.files, outDir: directory, target })
        expect(result.files).toContain('index.html')
        expect(result.files.some((file) => file.endsWith('.js'))).toBe(true)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }, 30_000)
  }
})
