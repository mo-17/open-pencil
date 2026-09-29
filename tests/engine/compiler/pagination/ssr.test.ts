import { expect, test } from 'bun:test'

import { paginationRuntimeFixture } from '#tests/helpers/compiler/components/pagination/runtime'
import { renderPaginationSSR } from '#tests/helpers/compiler/components/pagination/ssr'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'
for (const target of ['react', 'vue'] as const) {
  test(
    `${target} Pagination dynamic/lifecycle fixture typechecks`,
    () => typeCheckCompilerFiles(paginationRuntimeFixture(target).files, target),
    35000
  )
  test(`${target} Pagination SSR escapes data, supplies semantic controls and never accesses DOM or writes state`, async () => {
    const html = await renderPaginationSSR(target)
    expect(html).toContain('aria-label="Pages &lt;script&gt;"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('aria-label="Next page"')
    expect(html).toContain('Page 2 of 10')
    expect(html).not.toContain('type="submit"')
    const invalid = await renderPaginationSSR(target, true)
    expect(invalid).toContain('data-invalid="true"')
    expect(invalid).toContain('Pagination data unavailable')
    expect(invalid).not.toContain('aria-current="page"')
  })
}
