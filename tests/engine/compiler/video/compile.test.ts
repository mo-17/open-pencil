import { expect, test } from 'bun:test'

import { readBrowserPreviewDependencyPolicy } from '#compiler/browser-preview/dependencies'
import { collectTree } from '#compiler/ir/collect/tree'
import type { IRElement } from '#compiler/ir/types'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createVideoModuleFrameOverrides } from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function fixture() {
  const graph = makeSceneGraph('Video library')
  const pageId = firstPageId(graph)
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      {
        id: 'selected',
        name: 'selectedMedia',
        type: 'object',
        defaultValue: { src: '', poster: '' }
      }
    ]
  })
  const frame = graph.createNode(
    'FRAME',
    pageId,
    createVideoModuleFrameOverrides({ src: 'https://media.example.com/fallback.mp4' })
  )
  graph.updateNode(frame.id, {
    interactiveProps: { ...frame.interactiveProps, lang: 'zh-CN' },
    bindings: {
      src: { kind: 'expr', expr: 'selectedMedia.src' },
      poster: { kind: 'expr', expr: 'selectedMedia.poster' }
    }
  })
  return { graph, pageId, frame }
}

test('exact video bindings collect reactive reads and compile React and Vue with Chinese host language', () => {
  const { graph, pageId } = fixture()
  const ir = collectTree(graph, pageId)
  const element = ir.children[0] as IRElement
  expect(ir.docStateReads).toContain('selectedMedia')
  expect(element.module?.videoSrcExpr).toBeDefined()
  expect(element.module?.videoPosterExpr).toBeDefined()
  expect(element.attrs.lang).toBe('zh-CN')
  for (const target of ['react', 'vue'] as const) {
    const result = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target, router: 'none', devMode: true })
    })
    const files = [...result.files].filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
    const authored = files
      .filter(([path]) => path.startsWith('src/') && !path.includes('__openpencil_video'))
      .map(([, source]) => source)
      .join('\n')
    expect(authored).toContain('selectedMedia')
    expect(authored).toContain('lang="zh-CN"')
    expect(authored).toContain(target === 'react' ? 'srcBound videoSrc=' : ':src-bound="true"')
    expect(authored).toContain(
      target === 'react' ? 'posterBound videoPoster=' : ':poster-bound="true"'
    )
    const pkg = JSON.parse(String(result.files.get('package.json')))
    expect(pkg.dependencies['hls.js']).toBe('1.7.3')
    for (const [filename, source] of files.filter(([path]) => path.endsWith('.vue'))) {
      const { descriptor, errors } = parse(source, { filename })
      expect(errors).toEqual([])
      compileScript(descriptor, { id: filename })
      if (descriptor.template)
        expect(
          compileTemplate({ source: descriptor.template.content, filename, id: filename }).errors
        ).toEqual([])
    }
    expect(
      result.warnings.some((warning) => warning.code === 'vue-plugin-module-unsupported')
    ).toBe(false)
    if (target === 'react')
      expect(() => readBrowserPreviewDependencyPolicy(result.files)).toThrow(
        'unapproved dependency hls.js'
      )
  }
})

test('invalid or wrong-kind video bindings remain present as undefined, without static fallback', () => {
  const { graph, pageId, frame } = fixture()
  graph.updateNode(frame.id, {
    bindings: {
      src: { kind: 'expr', expr: 'unknownSelection.src' },
      poster: { kind: 'state', statePath: 'selectedMedia' }
    }
  })
  const ir = collectTree(graph, pageId)
  const element = ir.children[0] as IRElement
  expect(element.module?.videoSrcExpr).toEqual({ kind: 'ident', name: 'undefined' })
  expect(element.module?.videoPosterExpr).toEqual({ kind: 'ident', name: 'undefined' })
  expect(ir.warnings.some((warning) => warning.code === 'video-binding-invalid')).toBe(true)
})

test('ordinary frames do not inherit video bindings and native targets warn explicitly', () => {
  const { graph, pageId, frame } = fixture()
  for (const [target, router] of [
    ['expo', 'expo-router'],
    ['flutter', 'none'],
    ['taro', 'taro-router']
  ] as const) {
    const result = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target, router, devMode: false })
    })
    expect(
      result.warnings.some(
        (warning) =>
          /module/.test(warning.code + warning.message) &&
          /unsupported|omitted/.test(warning.code + warning.message)
      )
    ).toBe(true)
    expect(result.files.has('src/__openpencil_video.tsx')).toBe(false)
    expect(result.files.has('src/__openpencil_video.vue')).toBe(false)
  }
  graph.updateNode(frame.id, { interactiveProps: {} })
  const element = collectTree(graph, pageId).children[0] as IRElement
  expect(element.module).toBeUndefined()
  expect(element.attrs.lang).toBeUndefined()
})
