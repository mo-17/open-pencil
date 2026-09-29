import { expect, test } from 'bun:test'

import { colorInputRuntimeFixture } from '#tests/helpers/compiler/components/color/runtime'
import { renderInputControlSSR } from '#tests/helpers/compiler/components/input-control/ssr'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'
for (const target of ['react', 'vue'] as const) {
  test(`${target} dynamic color runtime fixture typechecks`, () => {
    const fixture = colorInputRuntimeFixture(target)
    typeCheckCompilerFiles(new Map(fixture.files), target)
  }, 35000)
  test(`${target} color SSR preserves exactly one business field without DOM access`, async () => {
    const html = await renderInputControlSSR(target, 'color')
    expect(html.match(/<input\b/g)).toHaveLength(1)
    expect(html).toContain('type="text"')
    expect(html).toContain('value="#2563eb"')
    expect(html).toContain('name="field"')
    expect(html.match(/<input\b[^>]*>/)?.[0]).not.toMatch(/\sreadonly(?:=""|(?=\s|>))/i)
    expect(html).toContain('pattern="#[0-9a-fA-F]{6}"')
    expect(html).not.toContain('data-color-picker')
  })
}
