import { expect, test } from 'bun:test'

import { skeletonFixture } from '#tests/helpers/compiler/modules/skeleton/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const target of ['react', 'vue'] as const)
  for (const updates of [false, true])
    test(`${target} Skeleton produces type-correct shapes and caller-controlled visibility (updates ${updates})`, () => {
      const result = skeletonFixture(target, updates)
      expect(result.warnings).toEqual([])
      expect(
        result.files.has(`src/__openpencil_skeleton.${target === 'react' ? 'tsx' : 'vue'}`)
      ).toBe(true)
      const files = new Map<string, string>()
      for (const [path, content] of result.files)
        if (typeof content === 'string') files.set(path, content)
      expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
    }, 35000)
test.each(['expo', 'flutter', 'wechat-miniprogram'] as const)(
  '%s does not silently claim a Skeleton runtime',
  (target) => {
    const result = skeletonFixture(target)
    const code = {
      expo: 'expo-module-unsupported',
      flutter: 'flutter-element-feature-unsupported',
      'wechat-miniprogram': 'wechat-miniprogram-node-runtime-unsupported'
    }[target]
    expect(result.warnings.filter((warning) => warning.code === code)).toHaveLength(5)
    expect([...result.files.keys()].some((path) => path.includes('__openpencil_skeleton'))).toBe(
      false
    )
  }
)
