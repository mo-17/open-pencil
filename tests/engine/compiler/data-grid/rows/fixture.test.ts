import { expect, test } from 'bun:test'

import { dataGridRowsFixture } from '#tests/helpers/compiler/modules/data-grid/rows-fixture'

for (const target of ['react', 'vue'] as const)
  for (const document of [false, true])
    test(`${target} ${document ? 'document' : 'page'} data-grid browser fixture emits usable dataset actions`, () => {
      const output = dataGridRowsFixture(target, document)
      expect(output.warnings).toEqual([])
      const source = [...output.files.values()].join('\n')
      expect(source).toContain(target === 'react' ? 'rowsBound rows={' : ':rows-bound="true"')
      for (const name of [
        'equalRows',
        'replacementRows',
        'emptyRows',
        'invalidRows',
        'initialRows'
      ]) {
        expect(source).toContain(name)
      }
    })
