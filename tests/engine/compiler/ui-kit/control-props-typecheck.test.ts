import { test } from 'bun:test'

import { shadcnControlsFixture } from '#tests/helpers/compiler/components/shadcn-controls'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

test.each(['react', 'react-shadcn', 'vue'] as const)(
  '%s generated project type checks with field events',
  (scenario) => {
    const target = scenario === 'vue' ? 'vue' : 'react'
    const output = shadcnControlsFixture(target, scenario === 'react-shadcn')
    typeCheckCompilerFiles(output.files, target)
  },
  35000
)
