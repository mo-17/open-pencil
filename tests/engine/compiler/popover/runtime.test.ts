import { expect, test } from 'bun:test'

import { popoverFixture } from '#tests/helpers/compiler/modules/popover/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const target of ['react', 'vue'] as const) {
  for (const dynamic of [false, true])
    test(`Popover ${target} ${dynamic ? 'dynamic' : 'slotted document'} sources typecheck`, () => {
      const output = popoverFixture(target, dynamic)
      expect(output.warnings).toEqual([])
      typeCheckCompilerFiles(
        new Map(
          [...output.files].filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        ),
        target
      )
    }, 35000)
}
