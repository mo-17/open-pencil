import { describe, expect, test } from 'bun:test'

import { mpxAdapter } from '#compiler/adapters/mpx'
import { taroAdapter } from '#compiler/adapters/taro'
import type { FrameworkAdapter } from '#compiler/adapters/types'
import { uniAppAdapter } from '#compiler/adapters/uni-app'
import { wechatMiniProgramAdapter } from '#compiler/adapters/wechat-miniprogram'
import type { IRTree } from '#compiler/ir/types'

import {
  withDefaults,
  type CompilerRouter,
  type MiniProgramCompilerTarget
} from '@open-pencil/compiler'

const LITERAL = 'Literal {{ apiToken }}'

const IR: IRTree = {
  pageId: 'page',
  pageName: 'Home',
  usesRouteParams: false,
  children: [{ kind: 'text', value: LITERAL }],
  states: [],
  docStates: [],
  docStateReads: [],
  docStateWrites: [],
  warnings: []
}

function emit(
  adapter: FrameworkAdapter,
  target: MiniProgramCompilerTarget,
  router: CompilerRouter
) {
  return adapter.emit(
    [IR],
    withDefaults({ packageName: 'markup-test', target, router, devMode: false })
  ).files
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`)
  return value
}

describe('Mini Program literal markup safety', () => {
  test('keeps authored braces literal in WXML, Vue, and Mpx templates', () => {
    const cases = [
      {
        source: textFile(
          emit(wechatMiniProgramAdapter, 'wechat-miniprogram', 'wechat-native'),
          'pages/home/index.wxml'
        )
      },
      {
        source: textFile(emit(uniAppAdapter, 'uni-app', 'uni-pages'), 'pages/home/index.vue')
      },
      {
        source: textFile(emit(mpxAdapter, 'mpx', 'mpx-router'), 'src/pages/home/index.mpx')
      }
    ]

    for (const { source } of cases) {
      expect(source).not.toContain(LITERAL)
      expect(source).toContain('Literal &#123;&#123; apiToken &#125;&#125;')
    }
  })

  test('uses a JavaScript string expression for Taro literal text', () => {
    const source = textFile(emit(taroAdapter, 'taro', 'taro-router'), 'src/pages/home/index.tsx')

    expect(source).toContain('{"Literal {{ apiToken }}"}')
  })
})
