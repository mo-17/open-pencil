import { expect, test } from 'bun:test'

import { chartDataFixture } from '#tests/helpers/compiler/modules/chart/data/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const target of ['react', 'vue'] as const) {
  test(`${target} controlled Chart source compiles page/doc/computed/expression object readers`, () => {
    const output = chartDataFixture(target)
    expect(output.warnings).toEqual([])
    const files = new Map<string, string>()
    for (const [path, content] of output.files)
      if (typeof content === 'string') files.set(path, content)
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
    const app = files.get(target === 'react' ? 'src/App.tsx' : 'src/pages/index.vue')
    expect(app).toContain(target === 'react' ? 'dataBound data={' : ':data-bound="true"')
    const runtime = files.get(`src/__openpencil_chart.${target === 'react' ? 'tsx' : 'vue'}`)
    expect(runtime).toContain('function chartGeometry(')
    expect(runtime).toContain('chartSnapshot(')
    expect(runtime).not.toContain('new Function(')
    expect(runtime).not.toContain('eval(')
  }, 35000)
}
