import { expect, test } from 'bun:test'

import { chipFixture } from '#tests/helpers/compiler/modules/chip/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

test.each(['react', 'vue'] as const)(
  '%s chip generated project and lifecycle harness typecheck',
  (target) => {
    for (const lifecycle of [false, true]) {
      const result = chipFixture(target, lifecycle)
      expect(result.warnings).toEqual([])
      const files = new Map<string, string>()
      for (const [path, content] of result.files)
        if (typeof content === 'string') files.set(path, content)
      expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
    }
  },
  35000
)
