import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { compileScript, compileTemplate, parse as parseVueSfc } from 'vue/compiler-sfc'

const componentPath = resolve(
  import.meta.dir,
  '../../../../../src/components/properties/Lowcode/SupabaseSourceMigrationExport.vue'
)
const source = readFileSync(componentPath, 'utf8')
const controllerSource = readFileSync(
  resolve(
    import.meta.dir,
    '../../../../../src/components/properties/Lowcode/supabase-source-migration-export-controller.ts'
  ),
  'utf8'
)

describe('Supabase source migration export component', () => {
  test('is a compilable controlled Vue SFC with the mount contract exposed to its parent', () => {
    const parsed = parseVueSfc(source, { filename: componentPath })
    expect(parsed.errors).toEqual([])
    compileScript(parsed.descriptor, { id: componentPath })
    const template = parsed.descriptor.template
    if (!template) throw new Error('SupabaseSourceMigrationExport.vue is missing a template')
    expect(
      compileTemplate({ source: template.content, filename: componentPath, id: componentPath })
        .errors
    ).toEqual([])

    expect(source).toContain('config?: SupabaseConfig')
    expect(source).toContain('graph: AppBackendProviderDocumentGraph')
    expect(source).toContain('reviewed: DesktopSupabaseBackendReviewResult')
    expect(source).toContain('externalBusy?: boolean')
    expect(source).toContain('busy: [value: boolean]')
    expect(source).toContain('exported: [result: DesktopSupabaseSourceMigrationExportResult]')
  })

  test('normalizes and bounds the slug and imports ledgers only through bounded file inputs', () => {
    expect(controllerSource).toContain('.toLowerCase()')
    expect(controllerSource).toContain(".replace(/[^a-z0-9-]/gu, '')")
    expect(source).toContain(':maxlength="SUPABASE_SOURCE_MIGRATION_NAME_MAX_LENGTH"')
    expect(source).toContain(':value="migrationName"')
    expect(source).not.toContain('v-model="migrationName"')
    expect(source.match(/type="file"/gu)).toHaveLength(2)
    expect(source).not.toContain('<textarea')
    expect(controllerSource).toContain('MAX_SUPABASE_SOURCE_LEDGER_IMPORT_BYTES')
    expect(controllerSource).toContain('new TextEncoder().encode(text).byteLength')
    expect(controllerSource).toContain('clearSelectedLedgerFiles()')
    expect(controllerSource).toContain("inspectedSourceLedgerJSON = ''")
    expect(controllerSource).toContain("promotionLedgerJSON = ''")
  })

  test('uses the app singleton with single-flight, cancellation, and source-only result semantics', () => {
    expect(controllerSource).toContain(
      'appDesktopSupabaseSourceMigrationExportService.exportMigration({'
    )
    expect(controllerSource).toContain('if (!canExport.value || localBusy.value) return')
    expect(controllerSource).toContain("if (exported.outcome === 'cancelled') return")
    expect(controllerSource).toContain(
      "if (code === 'outcome-unknown') outcomeUnknown.value = true"
    )
    expect(controllerSource).toContain('activeController.value?.abort()')
    expect(source).toContain(':disabled="!canExport"')
    expect(source).toContain('result.fileName')
    expect(source).toContain('result.migrationPath')
    expect(source).toContain('result.bundleManifestDigest')
    expect(source).toContain('result.promotionLedgerIncluded')
    expect(`${source}\n${controllerSource}`).not.toMatch(
      /\b(?:accessToken|personalAccessToken|credentialResolver)\b/u
    )
  })

  test('routes every user-facing label and error through the panels locale contract', () => {
    expect(source).toContain('const { panels } = useI18n()')
    expect(source).toContain('panels.value.lowcodeSupabaseSourceMigrationErrorInvalidLedger')
    expect(source).toContain('panels.lowcodeSupabaseSourceMigrationDescription')
    expect(source).toContain('panels.lowcodeSupabaseSourceMigrationPostSaveHint')
    const template = parseVueSfc(source, { filename: componentPath }).descriptor.template?.content
    if (!template) throw new Error('SupabaseSourceMigrationExport.vue is missing a template')
    const literalText = template.replace(/<[^>]*>/gu, '').replace(/\{\{[\s\S]*?\}\}/gu, '')
    expect(literalText).not.toMatch(/[\u3400-\u9fff]/u)
    expect(literalText).toMatch(/^[\s:·]*$/u)
  })
})
