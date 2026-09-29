import { expect, test } from 'bun:test'

import { progressFixture } from '#tests/helpers/compiler/modules/progress/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const updates of [false, true])
  test.each(['react', 'vue'] as const)(
    `%s Progress generates type-correct linear/circular and changing states (updates: ${updates})`,
    (target) => {
      const result = progressFixture(target, updates)
      expect(result.warnings).toEqual([])
      expect(
        result.files.has(`src/__openpencil_progress.${target === 'react' ? 'tsx' : 'vue'}`)
      ).toBe(true)
      const files = new Map<string, string>()
      for (const [path, content] of result.files)
        if (typeof content === 'string') files.set(path, content)
      expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
    },
    35_000
  )

test.each(['expo', 'flutter', 'wechat-miniprogram'] as const)(
  '%s does not silently claim a Progress runtime',
  (target) => {
    const result = progressFixture(target)
    const code = {
      expo: 'expo-module-unsupported',
      flutter: 'flutter-element-feature-unsupported',
      'wechat-miniprogram': 'wechat-miniprogram-node-runtime-unsupported'
    }[target]
    expect(result.warnings.filter((warning) => warning.code === code)).toHaveLength(7)
    expect([...result.files.keys()].some((path) => path.includes('__openpencil_progress'))).toBe(
      false
    )
  }
)
