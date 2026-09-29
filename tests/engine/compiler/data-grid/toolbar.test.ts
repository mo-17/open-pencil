import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { buildOpenPencilDataGridComponent } from '#compiler/adapters/react/modules/data-grid'
import { buildOpenPencilVueDataGrid } from '#compiler/adapters/vue/modules/data-grid'
import { compileScript, parse } from 'vue/compiler-sfc'

import { DATA_GRID_MODULE_DEFAULT_CONFIG } from '#core/plugins/data-grid'

async function renderGrids(target: 'react' | 'vue', configs: unknown[]): Promise<string[]> {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-grid-toolbar-'))
  try {
    mkdirSync(join(directory, 'components'))
    symlinkSync(
      resolve(target === 'react' ? 'packages/compiler/node_modules' : 'node_modules'),
      join(directory, 'node_modules'),
      'dir'
    )
    const source =
      target === 'react'
        ? buildOpenPencilDataGridComponent()
        : compileScript(
            parse(buildOpenPencilVueDataGrid(), { filename: 'DataGrid.vue' }).descriptor,
            { id: 'grid-toolbar', inlineTemplate: true }
          ).content
    writeFileSync(join(directory, 'components/grid.tsx'), source)
    writeFileSync(join(directory, 'configs.json'), JSON.stringify(configs))
    const framework =
      target === 'react'
        ? `import { createElement } from 'react'\nimport { renderToStaticMarkup } from 'react-dom/server'\nconst render = config => renderToStaticMarkup(createElement(Grid, { config, lang: 'en' }))`
        : `import { createSSRApp } from 'vue'\nimport { renderToString } from 'vue/server-renderer'\nconst render = config => renderToString(createSSRApp(Grid, { config, lang: 'en' }))`
    writeFileSync(
      join(directory, 'render.ts'),
      `import { readFileSync, writeFileSync } from 'node:fs'
import Grid from './components/grid'
${framework}
const configs = JSON.parse(readFileSync('configs.json', 'utf8'))
writeFileSync('rendered.json', JSON.stringify(await Promise.all(configs.map(render))))
`
    )
    execFileSync(process.execPath, [join(directory, 'render.ts')], {
      cwd: directory,
      timeout: 10000
    })
    return JSON.parse(readFileSync(join(directory, 'rendered.json'), 'utf8')) as string[]
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('DataGrid runtime tool visibility', () => {
  test.each(['react', 'vue'] as const)(
    '%s keeps ordinary tables clear while preserving optional CSV tools and accessible state',
    async (target) => {
      const legacy = { ...DATA_GRID_MODULE_DEFAULT_CONFIG }
      Reflect.deleteProperty(legacy, 'showCsvTools')
      const [plain, csv, filtered, noSelection] = await renderGrids(target, [
        legacy,
        { ...legacy, showCsvTools: true },
        {
          ...legacy,
          filters: [{ columnId: legacy.data.columns[0].id, operator: 'contains', value: 'a' }]
        },
        { ...legacy, selectionMode: 'none' }
      ])
      expect(plain).not.toContain('data-openpencil-data-grid-csv-tools')
      expect(plain).not.toContain('Clear selection')
      expect(plain).not.toContain('Clear column filters')
      expect(plain).toContain('0 selected')
      expect(plain).toContain('aria-live="polite"')
      expect(plain).toContain('data-openpencil-data-grid-feedback-hidden')
      const summaryId = plain.match(/id="([^"]+-summary)"/)?.[1]
      expect(summaryId).toBeDefined()
      expect(plain).toContain(`aria-describedby="${summaryId}"`)
      expect(plain).toContain('type="search"')
      expect(plain).toContain('Data grid pagination')
      expect(csv).toContain('data-openpencil-data-grid-csv-tools')
      expect(csv).toContain('Paste CSV (local session)')
      expect(csv).toContain('Prepare CSV text')
      expect(filtered).toContain('Filters configured in the design remain active.')
      expect(filtered).not.toContain('data-openpencil-data-grid-feedback-hidden')
      expect(filtered).not.toContain('Clear column filters')
      expect(noSelection).not.toContain('data-openpencil-data-grid-feedback')
    }
  )
})
