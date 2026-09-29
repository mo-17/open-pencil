import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '#compiler/index'
import { collectTree } from '#compiler/ir/collect/tree'
import type { IRElement } from '#compiler/ir/types'
import type { CompilerOptions } from '#compiler/types'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  autocompleteGraph,
  INPUT_SUGGESTIONS
} from '#tests/helpers/compiler/components/autocomplete/model'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

function sourceFiles(files: Map<string, string | Uint8Array>): Map<string, string> {
  return new Map(
    [...files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

describe('autocomplete compiler contract', () => {
  test('keeps string binding, validation and authored change events on the one real INPUT', () => {
    const { graph, pageId } = autocompleteGraph()
    const form = collectTree(graph, pageId).children[0] as IRElement
    const input = form.children[0] as IRElement
    expect(input.inputSuggestions).toEqual(INPUT_SUGGESTIONS)
    expect(input.controlled?.write.targetType).toBe('string')
    expect(input.validation).toBeDefined()
    expect(input.events?.onChange).toBeDefined()
  })

  test.each(['react', 'vue'] as const)(
    '%s emits type-correct escaped suggestions without any extra successful control',
    (target) => {
      const { graph, pageId } = autocompleteGraph()
      const output = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ target, router: 'none', devMode: false })
      })
      expect(output.warnings).toEqual([])
      expect(output.files.has('src/lib/open-pencil-autocomplete.ts')).toBe(true)
      typeCheckCompilerFiles(sourceFiles(output.files), target)
    }
  )

  test.each([{ suggestions: undefined }, { suggestions: [] }])(
    'does not emit an unused runtime for suggestions=%j',
    ({ suggestions }) => {
      const graph = new SceneGraph(),
        pageId = graph.getPages()[0].id
      graph.createNode('INPUT', pageId, {
        interactiveProps: suggestions === undefined ? {} : { suggestions }
      })
      for (const target of ['react', 'vue'] as const) {
        const output = compile({
          graph,
          pageIds: [pageId],
          options: withDefaults({ target, router: 'none' })
        })
        expect(output.files.has('src/lib/open-pencil-autocomplete.ts')).toBe(false)
      }
    }
  )

  test.each(
    [
      ['A', 'A'],
      ['line\nbreak'],
      [''],
      Array.from({ length: 101 }, (_, index) => String(index))
    ].map((suggestions) => ({ suggestions }))
  )('invalid suggestions fail closed: %j', ({ suggestions }) => {
    const graph = new SceneGraph(),
      pageId = graph.getPages()[0].id
    const input = graph.createNode('INPUT', pageId, {
      interactiveProps: { suggestions, value: 'Keep value' }
    })
    const ir = collectTree(graph, pageId)
    const field = ir.children[0] as IRElement
    expect(field.inputSuggestions).toBeUndefined()
    expect(field.attrs.defaultValue).toBe('Keep value')
    expect(
      ir.warnings.some(
        (warning) => warning.nodeId === input.id && warning.code === 'input-suggestions-invalid'
      )
    ).toBe(true)
  })
})

const targets = [
  ['expo', 'none'],
  ['flutter', 'none'],
  ['taro', 'taro-router'],
  ['wechat-miniprogram', 'wechat-native'],
  ['uni-app', 'uni-pages'],
  ['mpx', 'mpx-router']
] as const satisfies readonly (readonly [CompilerOptions['target'], CompilerOptions['router']])[]

test.each(targets)('%s explicitly omits unsupported autocomplete behavior', (target, router) => {
  const { graph, pageId, input } = autocompleteGraph()
  const output = compile({ graph, pageIds: [pageId], options: withDefaults({ target, router }) })
  expect(
    output.warnings.some(
      (warning) =>
        warning.code === `${target}-input-suggestions-unsupported` && warning.nodeId === input.id
    )
  ).toBe(true)
  expect([...sourceFiles(output.files).values()].join('\n')).not.toContain('北海 Beihai')
})
