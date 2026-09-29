import { expect, test } from 'bun:test'

import { CASCADER_MODULE_DEFAULT_CONFIG } from '#core/plugins/cascader'

import { cascaderSSR } from '#tests/helpers/compiler/components/cascader/ssr'

for (const target of ['react', 'vue'] as const) {
  test(`${target} Cascader SSR is closed, escapes labels and submits only explicitly named complete path parts`, async () => {
    let calls = 0
    const value = ['asia', 'china', 'xiamen']
    const html = await cascaderSSR(target, {
      value,
      valueBound: true,
      onValueChange: () => {
        calls++
      },
      field: { name: 'location', required: true },
      form: 'destination'
    })
    expect(html).toContain('Asia / China / Xiamen')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="treeitem"')
    const hidden = html.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []
    expect(hidden).toHaveLength(3)
    expect(hidden.map((input) => /value="([^"]*)"/.exec(input)?.[1])).toEqual(value)
    expect(
      hidden.every(
        (input) => input.includes('name="location"') && input.includes('form="destination"')
      )
    ).toBe(true)
    expect(html.match(/name="location"/g)).toHaveLength(3)
    expect(calls).toBe(0)
    const local = await cascaderSSR(target, {
      config: { ...CASCADER_MODULE_DEFAULT_CONFIG, placeholder: '<script>location</script>' }
    })
    expect(local).toContain('&lt;script&gt;location&lt;/script&gt;')
    expect(local).not.toContain('data-module-field-proxy=')
    expect(local).not.toContain('type="hidden"')
  })
  test(`${target} Cascader invalid controlled values never fall back or submit fake path; readonly retains values`, async () => {
    const config = { ...CASCADER_MODULE_DEFAULT_CONFIG, initialPath: ['europe', 'france'] }
    const invalid = await cascaderSSR(target, {
      config,
      valueBound: true,
      value: ['unknown'],
      field: { name: 'place', required: true }
    })
    expect(invalid).toContain('—')
    expect(invalid).not.toContain('Europe / France')
    expect(invalid).not.toContain('type="hidden"')
    expect(invalid).toContain('aria-invalid="true"')
    const readonly = await cascaderSSR(target, {
      config,
      valueBound: true,
      value: ['europe', 'france'],
      readOnly: true,
      field: { name: 'place' },
      form: ''
    })
    expect(readonly).toContain('aria-readonly="true"')
    expect(readonly.match(/type="hidden"/g)).toHaveLength(2)
    const disabled = await cascaderSSR(target, { config, disabled: true, field: { name: 'place' } })
    expect(
      (disabled.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []).every((input) =>
        /\bdisabled(?:="")?(?:\s|>)/.test(input)
      )
    ).toBe(true)
  })
}
