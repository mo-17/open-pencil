import { expect, test } from 'bun:test'

import { compileComponentTemplates } from '#tests/helpers/compiler/components/templates/fixture'

for (const target of ['react', 'vue'] as const) {
  for (const locale of ['zh-CN', 'en'] as const) {
    test(`${target} ${locale} content templates emit authored language on each runtime host`, () => {
      const output = compileComponentTemplates(target, ['code-block', 'markdown-note'], locale)
      expect(output.warnings).toEqual([])
      const emitted = [...output.files]
        .filter(([path]) =>
          target === 'vue' ? path.startsWith('src/pages/') : path === 'src/App.tsx'
        )
        .map(([, content]) => content)
        .join('\n')
      expect(emitted).toContain(`lang="${locale}"`)
      expect(emitted.match(new RegExp(`lang="${locale}"`, 'g'))).toHaveLength(2)
    })
  }
}
