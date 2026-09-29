import { expect, test } from 'bun:test'

import { renderOrgChartSSR } from '#tests/helpers/compiler/components/org-chart/ssr'

for (const target of ['react', 'vue'] as const)
  test(`${target} SSR escapes authored labels and applies initial collapsed state without browser globals`, async () => {
    const html = await renderOrgChartSSR(target)
    expect(html).toContain('Organization &lt;script&gt;')
    expect(html).toContain('CEO &lt;script&gt;')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Hidden child')
    expect(html).not.toContain('<script>')
  })
