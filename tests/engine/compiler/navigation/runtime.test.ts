import { expect, test } from 'bun:test'

import { navigationFixture } from '#tests/helpers/compiler/modules/navigation/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

test.each(['react', 'vue'] as const)(
  '%s navigation modules compile and generated source typechecks',
  (target) => {
    const result = navigationFixture(target)
    expect(result.warnings).toEqual([])
    const extension = target === 'react' ? 'tsx' : 'vue'
    expect(result.files.has(`src/__openpencil_stepper.${extension}`)).toBe(true)
    expect(result.files.has(`src/__openpencil_breadcrumb.${extension}`)).toBe(true)
    const files = new Map<string, string>()
    for (const [path, content] of result.files)
      if (typeof content === 'string') files.set(path, content)
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
  },
  35_000
)
