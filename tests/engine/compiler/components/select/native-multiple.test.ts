import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '#compiler/index'
import type { CompilerOptions } from '#compiler/types'

import { SceneGraph } from '@open-pencil/scene-graph'

const targets = [
  ['expo', 'none'],
  ['flutter', 'none'],
  ['taro', 'taro-router'],
  ['wechat-miniprogram', 'wechat-native'],
  ['uni-app', 'uni-pages'],
  ['mpx', 'mpx-router']
] as const satisfies readonly (readonly [CompilerOptions['target'], CompilerOptions['router']])[]

describe('source-only targets fail closed for multiple SELECT', () => {
  test.each(targets)('%s omits a multiple control and diagnoses its node', (target, router) => {
    const graph = new SceneGraph(),
      pageId = graph.getPages()[0].id
    graph.updateNode(pageId, {
      state: [
        { id: 'choices', name: 'choices', type: 'array', defaultValue: ['a'] },
        { id: 'eventOutput', name: 'eventOutput', type: 'string', defaultValue: '' }
      ]
    })
    const node = graph.createNode('SELECT', pageId, {
      name: 'Multiple choices',
      width: 200,
      height: 44,
      bindings: { value: { kind: 'ref', stateId: 'choices' } },
      events: {
        onChange: [
          { kind: 'setState', targetStateId: 'eventOutput', valueExpr: '"MULTI_UNSUPPORTED_WRITE"' }
        ]
      },
      interactiveProps: {
        multiple: true,
        value: ['a'],
        options: [
          { value: 'a', label: 'MULTI_OPTION_ALPHA' },
          { value: 'b', label: 'MULTI_OPTION_BETA' }
        ]
      }
    })
    graph.createNode('TEXT', pageId, { text: 'Unaffected content' })
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target, router, devMode: false })
    })
    expect(
      output.warnings.filter((warning) => warning.code === `${target}-select-multiple-unsupported`)
    ).toEqual([
      {
        code: `${target}-select-multiple-unsupported`,
        message:
          'This source-only target omitted the multiple SELECT control; array selection is supported by React and Vue exports only.',
        nodeId: node.id
      }
    ])
    const sources = [...output.files.values()]
      .filter((value): value is string => typeof value === 'string')
      .join('\n')
    expect(sources).not.toContain('MULTI_OPTION_ALPHA')
    expect(sources).not.toContain('MULTI_OPTION_BETA')
    expect(sources).not.toContain('MULTI_UNSUPPORTED_WRITE')
    expect(sources).toContain('Unaffected content')
    expect(sources).not.toMatch(/<(?:Picker|picker|select)\b/)
  })
})
