import { describe, expect, test } from 'bun:test'

import {
  assertMiniProgramExportProjectBudget,
  type MiniProgramCompilerTarget,
  type MiniProgramProjectBudgetDiagnosticCode
} from '@open-pencil/compiler'

const MIB = 1024 * 1024

function expectBudgetFailure(run: () => void, code: MiniProgramProjectBudgetDiagnosticCode): void {
  const error = (() => {
    try {
      run()
      return undefined
    } catch (cause) {
      return cause
    }
  })()
  expect(error).toMatchObject({
    code: 'MINIPROGRAM_PROJECT_BUDGET',
    diagnostic: { code }
  })
}

describe('final mini-program source project budget', () => {
  test('accepts bounded final projects for all four targets', () => {
    const projects: ReadonlyArray<
      readonly [MiniProgramCompilerTarget, ReadonlyMap<string, string | Uint8Array>]
    > = [
      ['wechat-miniprogram', new Map([['pages/home/index.wxml', '<view />']])],
      ['taro', new Map([['src/pages/home/index.tsx', 'export default () => null']])],
      ['uni-app', new Map([['pages/home/index.vue', '<template><view /></template>']])],
      ['mpx', new Map([['src/pages/home/index.mpx', '<template><view /></template>']])]
    ]

    for (const [target, project] of projects) {
      expect(() => assertMiniProgramExportProjectBudget(target, project)).not.toThrow()
    }
  })

  test('accepts 512 files and rejects the 513th with a stable diagnostic', () => {
    const project = new Map<string, string>()
    for (let index = 0; index < 512; index++) project.set(`src/file-${index}.txt`, '')
    expect(() => assertMiniProgramExportProjectBudget('taro', project)).not.toThrow()

    project.set('src/file-512.txt', '')
    expectBudgetFailure(
      () => assertMiniProgramExportProjectBudget('taro', project),
      'mini-program-file-count-limit'
    )
  })

  test('rejects a final project over the 16 MiB aggregate budget', () => {
    const chunk = 'x'.repeat(MIB)
    const project = new Map<string, string>()
    for (let index = 0; index < 17; index++) project.set(`src/chunk-${index}.txt`, chunk)

    expectBudgetFailure(
      () => assertMiniProgramExportProjectBudget('uni-app', project),
      'mini-program-aggregate-byte-limit'
    )
  })

  test('enforces binary file, path, asset, and target page limits', () => {
    expectBudgetFailure(
      () =>
        assertMiniProgramExportProjectBudget(
          'mpx',
          new Map([['src/assets/large.png', new Uint8Array(2 * MIB + 1)]])
        ),
      'mini-program-binary-file-byte-limit'
    )
    expectBudgetFailure(
      () => assertMiniProgramExportProjectBudget('taro', new Map([['x'.repeat(241), '']])),
      'mini-program-path-byte-limit'
    )

    const assets = new Map<string, Uint8Array>()
    for (let index = 0; index < 257; index++) {
      assets.set(`static/asset-${index}.png`, new Uint8Array([index % 256]))
    }
    expectBudgetFailure(
      () => assertMiniProgramExportProjectBudget('uni-app', assets),
      'mini-program-asset-count-limit'
    )

    const pages = new Map<string, string>()
    for (let index = 0; index < 101; index++) {
      pages.set(`src/pages/page-${index}/index.tsx`, '')
    }
    expectBudgetFailure(
      () => assertMiniProgramExportProjectBudget('taro', pages),
      'mini-program-page-count-limit'
    )
  })

  test('rechecks the 2 MiB native WeChat main package budget', () => {
    const chunk = 'x'.repeat(MIB)
    const project = new Map<string, string>([
      ['app.js', chunk],
      ['pages/home/index.js', chunk],
      ['EXPORT_WARNINGS.md', 'review']
    ])

    expectBudgetFailure(
      () => assertMiniProgramExportProjectBudget('wechat-miniprogram', project),
      'wechat-miniprogram-main-package-byte-limit'
    )
  })
})
