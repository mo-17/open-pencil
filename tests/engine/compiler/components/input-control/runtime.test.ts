import { describe, expect, test } from 'bun:test'

import { inputControlRuntimeFixture } from '#tests/helpers/compiler/components/input-control/runtime'
import { renderInputControlSSR } from '#tests/helpers/compiler/components/input-control/ssr'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

describe('generated native number and password controls', () => {
  test.each(['react', 'vue'] as const)(
    '%s generated project preserves native prop and event types',
    (target) => {
      const result = inputControlRuntimeFixture(target)
      expect(result.warnings).toEqual([])
      typeCheckCompilerFiles(
        new Map(
          result.files.filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        target
      )
    },
    35000
  )
  for (const target of ['react', 'vue'] as const)
    for (const kind of ['number', 'password'] as const) {
      test(`${target} ${kind} SSR keeps exactly one escaped native form control`, async () => {
        const html = await renderInputControlSSR(target, kind)
        expect(html.match(/<input\b/g)).toHaveLength(1)
        expect(html).toContain(`type="${kind}"`)
        expect(html).toContain('name="field"')
        expect(html).toContain('id="field"')
        expect(html).toContain('form="external"')
        expect(html).toContain('aria-label="输入"')
        expect(html).toContain('step="0.1"')
        const wrapper = html.match(/<span\b[^>]*>/)?.[0] ?? ''
        const input = html.match(/<input\b[^>]*>/)?.[0] ?? ''
        expect(wrapper).toContain('data-node-id="field-node"')
        expect(input).not.toContain('data-node-id')
        expect(input).toContain('data-business-key="field-key"')
        expect(input).toContain('form="external"')
        expect(input).toContain('aria-label="输入"')
        expect(wrapper).not.toContain('name=')
        expect(html).not.toContain('<button')
        if (kind === 'password') expect(html).toContain('秘密 &lt;b&gt;text&lt;/b&gt;')
        else expect(html).toContain('value="0.2"')
      })
    }
})
