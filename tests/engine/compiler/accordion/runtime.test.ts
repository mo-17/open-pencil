import { expect, test } from 'bun:test'

import { accordionFixture } from '#tests/helpers/compiler/modules/accordion/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const lifecycle of [false, true])
  test.each(['react', 'vue'] as const)(
    `%s accordion compiles without fallback and type checks (lifecycle: ${lifecycle})`,
    (target) => {
      const result = accordionFixture(target, lifecycle)
      expect(result.warnings).toEqual([])
      expect(
        result.files.has(`src/__openpencil_accordion.${target === 'react' ? 'tsx' : 'vue'}`)
      ).toBe(true)
      const files = new Map<string, string>()
      for (const [path, content] of result.files) {
        if (typeof content === 'string') files.set(path, content)
      }
      expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
    },
    35_000
  )
