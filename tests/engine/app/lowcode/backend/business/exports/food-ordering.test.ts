import { expect, test } from 'bun:test'

import { withBusinessStaticExport } from './helpers'

for (const target of ['react', 'vue'] as const) {
  test(`${target} food ordering builds all routes and keeps server transaction code out of public assets`, async () => {
    await withBusinessStaticExport('food-ordering', target, ({ fixture, result }) => {
      expect(fixture.pageIds).toHaveLength(8)
      expect(result.serverFiles.some((path) => path.endsWith('food-checkout.ts'))).toBe(true)
      expect(fixture.output.files.get('backend/nestjs/src/command.service.ts')).toContain(
        'executeFoodOrdering'
      )
      expect(result.serverFiles.some((path) => path.endsWith('FOOD-ORDERING.md'))).toBe(true)
    })
  }, 60000)
}
