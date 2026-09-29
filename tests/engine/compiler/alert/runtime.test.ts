import { expect, test } from 'bun:test'

import { alertFixture } from '#tests/helpers/compiler/modules/alert/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const target of ['react', 'vue'] as const) {
  for (const lifecycle of [false, true]) {
    test(`Alert ${target} generated ${lifecycle ? 'lifecycle' : 'document'} project typechecks`, () => {
      const result = alertFixture(target, lifecycle)
      expect(result.warnings).toEqual([])
      const textFiles = new Map(
        [...result.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
      typeCheckCompilerFiles(textFiles, target)
    }, 35000)
  }
}
