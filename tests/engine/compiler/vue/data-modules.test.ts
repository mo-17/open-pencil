import { expect, test } from 'bun:test'

import { dataModulesFixture } from '#tests/helpers/compiler/modules/data-grid/fixtures'
import { typeCheckDataModules } from '#tests/helpers/compiler/modules/data-grid/typecheck'

test.each([false, true])(
  'generated Vue Table and DataGrid project type checks (lifecycle: %s)',
  (lifecycle) => {
    const output = dataModulesFixture('vue', 'en', lifecycle)
    expect(output.warnings.filter((warning) => warning.code === 'vue-module-unsupported')).toEqual(
      []
    )
    expect(output.files.has('src/__openpencil_table.vue')).toBe(true)
    expect(output.files.has('src/__openpencil_data_grid.vue')).toBe(true)
    expect(() => typeCheckDataModules(output, 'vue')).not.toThrow()
  },
  35000
)
