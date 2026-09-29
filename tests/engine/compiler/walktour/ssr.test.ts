import { expect, test } from 'bun:test'

import { renderWalktourSSR } from '#tests/helpers/compiler/components/walktour/ssr'
for (const target of ['react', 'vue'] as const)
  test(`${target} Walktour SSR does not open a dialog or access browser globals`, async () => {
    const html = await renderWalktourSSR(target)
    expect(html).toContain('Start &lt;script&gt;')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-walktour-dialog')
    expect(html).not.toMatch(/<dialog[^>]*\sopen(?:[=>\s])|data-walktour-open=|<script>/)
  })
