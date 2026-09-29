import { expect, test } from 'bun:test'

import { validationIdentityFixture } from '#tests/helpers/compiler/components/form-validation/identity'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const scenario of ['react', 'vue', 'react-shadcn'] as const) {
  test(`${scenario} nested lists and repeated validated components preserve valid error associations in exported source`, () => {
    const target = scenario === 'vue' ? 'vue' : 'react'
    const result = validationIdentityFixture(target, scenario === 'react-shadcn')
    expect(result.warnings).toEqual([])
    const files = new Map<string, string>()
    for (const [path, source] of result.files)
      if (typeof source === 'string') files.set(path, source)
    const source = [...files.values()].join('\n')
    expect(source).toContain('__opValidationInstance')
    expect(source).not.toMatch(/<p[^>]*\sid="openpencil-validation-error-/)
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
  }, 35_000)
}
