import { test } from 'bun:test'

import { selectFoundationFixture } from '#tests/helpers/compiler/components/select/foundation'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

test.each(['react', 'vue', 'shadcn'] as const)(
  '%s SELECT project type-checks dynamic options, empty-value guards, and native validation',
  (scenario) => {
    const target = scenario === 'vue' ? 'vue' : 'react'
    const fixture = selectFoundationFixture(target, scenario === 'shadcn')
    typeCheckCompilerFiles(new Map(fixture.files), target)
  },
  35000
)
