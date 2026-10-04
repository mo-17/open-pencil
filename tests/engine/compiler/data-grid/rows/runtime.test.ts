import { describe, expect, test } from 'bun:test'

import { buildOpenPencilDataGridComponent } from '#compiler/adapters/react/modules/data-grid'
import { buildOpenPencilVueDataGrid } from '#compiler/adapters/vue/modules/data-grid'

import { dataModulesFixture } from '#tests/helpers/compiler/modules/data-grid/fixtures'
import { typeCheckDataModules } from '#tests/helpers/compiler/modules/data-grid/typecheck'

describe('bound data grid generated targets', () => {
  test.each(['react', 'vue'] as const)(
    '%s accepts typed host props and strict unknown bound rows',
    (target) => {
      const output = dataModulesFixture(target)
      output.files.set(
        target === 'react' ? 'src/__openpencil_data_grid.tsx' : 'src/__openpencil_data_grid.vue',
        target === 'react' ? buildOpenPencilDataGridComponent() : buildOpenPencilVueDataGrid()
      )
      typeCheckDataModules(output, target)
      const source =
        target === 'react' ? buildOpenPencilDataGridComponent() : buildOpenPencilVueDataGrid()
      expect(source).toContain('resolveBoundDataGridRows')
      expect(source).toContain('data-openpencil-data-grid-unavailable')
      expect(source).toContain('boundReadOnly')
      expect(source).not.toContain('onRowsChange')
    }
  )
})
