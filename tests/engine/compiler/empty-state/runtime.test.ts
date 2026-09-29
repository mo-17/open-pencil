import { expect, test } from 'bun:test'

import { emptyStateFixture } from '#tests/helpers/compiler/modules/empty-state/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

test.each(['react', 'vue'] as const)(
  '%s empty state generated project and replacement harness typecheck',
  (target) => {
    for (const replacement of [false, true]) {
      const result = emptyStateFixture(target, replacement)
      expect(result.warnings).toEqual([])
      const files = new Map<string, string>()
      for (const [path, content] of result.files)
        if (typeof content === 'string') files.set(path, content)
      expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
    }
  },
  35000
)
