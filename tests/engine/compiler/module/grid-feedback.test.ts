import { expect, test } from 'bun:test'

import { dataModulesFixture } from '#tests/helpers/compiler/modules/data-grid/fixtures'
import { typeCheckDataModules } from '#tests/helpers/compiler/modules/data-grid/typecheck'

test.each(['react', 'vue'] as const)(
  'generated %s grid with configured filters type checks',
  (target) => {
    const output = dataModulesFixture(target, 'zh-CN', false, true)
    expect(() => typeCheckDataModules(output, target)).not.toThrow()
  },
  35000
)
