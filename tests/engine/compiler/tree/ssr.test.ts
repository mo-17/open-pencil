import { expect, test } from 'bun:test'

import { renderFormModuleSSR } from '#tests/helpers/compiler/components/form-modules/ssr'

for (const target of ['react', 'vue'] as const) {
  test(`${target} outer disabled Tree keeps its selection while disabling every row, expander and submitted field`, async () => {
    const html = await renderFormModuleSSR(target, 'tree', false, 'disabled')
    const rows = html.match(/<div[^>]*role="treeitem"[^>]*>/g) ?? []
    const expanders = html.match(/<button[^>]*data-tree-expander[^>]*>/g) ?? []
    const submitted = html.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.every((row) => row.includes('aria-disabled="true"'))).toBe(true)
    expect(rows.every((row) => row.includes('tabindex="-1"'))).toBe(true)
    expect(rows.some((row) => row.includes('aria-selected="true"'))).toBe(true)
    expect(expanders.length).toBeGreaterThan(0)
    expect(expanders.every((button) => /\bdisabled(?:="")?(?:\s|>)/.test(button))).toBe(true)
    expect(html.match(/<div[^>]*role="tree"[^>]*>/)?.[0]).toContain('tabindex="-1"')
    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('value="design"')
    expect(submitted[0]).toMatch(/\bdisabled(?:="")?(?:\s|>)/)
  })

  test(`${target} readonly Tree retains a navigable hierarchy and submitted selection`, async () => {
    const html = await renderFormModuleSSR(target, 'tree', false, 'readonly')
    const rows = html.match(/<div[^>]*role="treeitem"[^>]*>/g) ?? []
    const expanders = html.match(/<button[^>]*data-tree-expander[^>]*>/g) ?? []
    const submitted = html.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []
    expect(html.match(/<div[^>]*role="tree"[^>]*>/)?.[0]).toContain('aria-readonly="true"')
    expect(rows.some((row) => row.includes('tabindex="0"'))).toBe(true)
    expect(expanders.some((button) => !/\bdisabled(?:="")?(?:\s|>)/.test(button))).toBe(true)
    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('value="design"')
    expect(submitted[0]).not.toMatch(/\bdisabled(?:="")?(?:\s|>)/)
  })
}
