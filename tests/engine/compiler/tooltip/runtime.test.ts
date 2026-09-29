import { expect, test } from 'bun:test'

import { tooltipFixture } from '#tests/helpers/compiler/modules/tooltip/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'
for (const target of ['react', 'vue'] as const)
  for (const dynamic of [false, true])
    test(`Tooltip ${target} ${dynamic ? 'dynamic' : 'document'} sources typecheck`, () => {
      const result = tooltipFixture(target, dynamic)
      expect(result.warnings).toEqual([])
      const files = new Map(
        [...result.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
      typeCheckCompilerFiles(files, target)
    }, 35000)
