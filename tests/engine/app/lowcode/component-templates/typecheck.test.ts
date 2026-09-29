import { expect, test } from 'bun:test'

import { compileComponentTemplates } from '#tests/helpers/compiler/components/templates/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

test.each(['react', 'vue'] as const)(
  '%s type checks the complete template library as one application',
  (target) => {
    const output = compileComponentTemplates(target)
    expect(output.warnings).toEqual([])
    expect(() => typeCheckCompilerFiles(output.files, target)).not.toThrow()
  },
  35000
)
