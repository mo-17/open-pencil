import { expect, test } from 'bun:test'

import { descriptionsFixture } from '#tests/helpers/compiler/modules/descriptions/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

test.each(['react', 'vue'] as const)(
  '%s Descriptions generated app and replacement harness typecheck',
  (target) => {
    for (const replacement of [false, true]) {
      const result = descriptionsFixture(target, replacement)
      expect(result.warnings).toEqual([])
      const files = new Map<string, string>()
      for (const [path, content] of result.files)
        if (typeof content === 'string') files.set(path, content)
      expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
    }
  },
  35000
)
