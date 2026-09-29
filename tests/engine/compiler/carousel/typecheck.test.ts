import { expect, test } from 'bun:test'

import { carouselRuntimeFixture } from '#tests/helpers/compiler/modules/carousel/fixture'
import { carouselNavigationFixture } from '#tests/helpers/compiler/modules/carousel/navigation-fixture'
import { carouselStylesFixture } from '#tests/helpers/compiler/modules/carousel/styles-fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const [name, fixture] of [
  ['runtime', carouselRuntimeFixture],
  ['styles', carouselStylesFixture],
  ['navigation', carouselNavigationFixture]
] as const) {
  test.each(['react', 'vue'] as const)(
    `%s carousel ${name} exported project passes its actual type checker`,
    (target) => {
      const result = fixture(target, false)
      expect(result.warnings).toEqual([])
      const files = new Map<string, string>()
      for (const [path, source] of result.files) {
        if (typeof source === 'string') files.set(path, source)
      }
      expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
    },
    35_000
  )
}
