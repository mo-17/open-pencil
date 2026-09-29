import { expect, test } from 'bun:test'

import { renderFormModuleSSR } from '#tests/helpers/compiler/components/form-modules/ssr'
for (const target of ['react', 'vue'] as const)
  for (const kind of ['slider', 'rating', 'date'] as const) {
    test(`${target} ${kind} controlled SSR is DOM-free and preserves named business values`, async () => {
      const valid = await renderFormModuleSSR(target, kind, false)
      expect(valid).toContain('Field &lt;script&gt;')
      expect(valid).toMatch(/name="first"[^>]*value="(?:2|2026-09-01)"/)
      expect(valid).toContain('form="owner"')
      expect(valid).not.toContain('<script>')
      const invalid = await renderFormModuleSSR(target, kind, true)
      expect(invalid).toMatch(/name="first"[^>]*\svalue(?:=""|(?=\s|>))/)
      expect(invalid).toContain('aria-invalid="true"')
      expect(invalid).toContain('The current value is invalid.')
    })
  }

for (const target of ['react', 'vue'] as const)
  for (const kind of ['slider', 'rating', 'date'] as const)
    test(`${target} ${kind} readonly SSR keeps named fields distinct from disabled fields`, async () => {
      const readonly = await renderFormModuleSSR(target, kind, false, 'readonly')
      const disabled = await renderFormModuleSSR(target, kind, false, 'disabled')
      const readonlyInput = readonly.match(/<input[^>]*name="first"[^>]*>/)?.[0]
      const disabledInput = disabled.match(/<input[^>]*name="first"[^>]*>/)?.[0]
      expect(readonlyInput).toMatch(/\sreadonly(?:=""|(?=\s|>))/i)
      expect(readonlyInput).not.toMatch(/\sdisabled(?:=""|(?=\s|>))/)
      expect(readonlyInput).toContain('form="owner"')
      expect(readonlyInput).toMatch(/value="(?:2|2026-09-01)"/)
      expect(disabledInput).toMatch(/\sdisabled(?:=""|(?=\s|>))/)
    })
