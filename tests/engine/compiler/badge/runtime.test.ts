import { expect, test } from 'bun:test'

import { badgeFixture } from '#tests/helpers/compiler/modules/badge/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const target of ['react', 'vue'] as const)
  for (const dynamic of [false, true]) {
    test(`Badge ${target} generated ${dynamic ? 'dynamic' : 'document'} project typechecks`, () => {
      const result = badgeFixture(target, dynamic)
      expect(result.warnings).toEqual([])
      const textFiles = new Map(
        [...result.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
      typeCheckCompilerFiles(textFiles, target)
    }, 35000)
  }
