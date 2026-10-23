import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import * as v from 'valibot'

import { CanvasHelper } from '#tests/helpers/canvas'

import {
  configureMarketplaceExportSource,
  createMarketplaceExportDocument,
  EXPORT_DOCUMENT_TEXT,
  MARKETPLACE_EXPORT_SOURCE_URL,
  MARKETPLACE_EXPORTERS,
  readSavedMarketplaceFig,
  routeSignedMarketplaceExportFixture
} from './marketplace-export-fixture'

const JSONDocument = v.pipe(v.string(), v.parseJson(), v.record(v.string(), v.unknown()))
const TokenDocument = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({
    format: v.literal('openpencil-design-tokens'),
    schemaVersion: v.literal(1),
    collections: v.array(
      v.object({
        name: v.string(),
        defaultModeId: v.string(),
        tokens: v.array(
          v.object({
            name: v.string(),
            $type: v.string(),
            valuesByMode: v.record(v.string(), v.number())
          })
        )
      })
    )
  })
)
type ExportKind = (typeof MARKETPLACE_EXPORTERS)[number]['kind']

async function inspectSavedExport(
  page: Page,
  bytes: Uint8Array,
  kind: ExportKind
): Promise<string[]> {
  if (kind === 'tokens') {
    const result = v.safeParse(TokenDocument, new TextDecoder().decode(bytes))
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('Saved tokens are not a JSON object')
    const theme = result.output.collections.find(({ name }) => name === 'Marketplace Theme')
    expect(theme).toBeDefined()
    if (!theme) throw new Error('Saved design token collection is missing')
    const token = theme.tokens.find(({ name }) => name === 'spacing/base')
    expect(token?.$type).toBe('number')
    expect(token?.valuesByMode[theme.defaultModeId]).toBe(8)
    return ['JSON parsed', 'spacing/base number token = 8']
  }
  if (kind === 'fig') {
    const nodes = await readSavedMarketplaceFig(page, bytes)
    expect(
      nodes.some((node) => node.type === 'RECTANGLE' && node.width === 140 && node.height === 80)
    ).toBe(true)
    expect(nodes.some((node) => node.type === 'TEXT' && node.text === EXPORT_DOCUMENT_TEXT)).toBe(
      true
    )
    return ['FIG parsed', '140x80 rectangle restored', 'Chinese text restored']
  }
  const files = unzipSync(bytes)
  const markers = {
    vue: ['package.json', 'src/App.vue', 'src/main.ts'],
    nextjs: ['package.json', 'app/[[...path]]/page.tsx', 'next.config.mjs'],
    flutter: ['pubspec.yaml', 'lib/main.dart', 'analysis_options.yaml']
  }[kind]
  for (const marker of markers) expect(files[marker], marker).toBeDefined()
  const sourceText = Object.entries(files)
    .filter(([path]) => /\.(vue|tsx|dart)$/.test(path))
    .map(([, data]) => new TextDecoder().decode(data))
    .join('\n')
  expect(sourceText).toContain(EXPORT_DOCUMENT_TEXT)
  if (kind === 'vue' || kind === 'nextjs') {
    const result = v.safeParse(JSONDocument, new TextDecoder().decode(files['package.json']))
    expect(result.success).toBe(true)
  }
  return ['ZIP decompressed', ...markers, 'Chinese text in generated source']
}

for (const fixture of MARKETPLACE_EXPORTERS) {
  test(`${fixture.pluginId} saves a non-empty artifact through the native WebKit download path`, async ({
    page
  }, testInfo) => {
    test.setTimeout(90_000)
    const publishFixture = await routeSignedMarketplaceExportFixture(page)
    await page.goto('/?test')
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    await publishFixture()
    expect(await page.evaluate(() => typeof window.showSaveFilePicker)).toBe('undefined')
    await createMarketplaceExportDocument(page)
    await page.getByTestId('app-settings-trigger').click()
    await page.getByTestId('settings-section-plugins').click()
    await expect(page.getByTestId('settings-plugins-panel')).toBeVisible()
    await configureMarketplaceExportSource(page)
    await expect(page.getByTestId('plugin-marketplace-source-controls')).toContainText(
      MARKETPLACE_EXPORT_SOURCE_URL
    )
    await expect(page.getByTestId('plugin-marketplace-status')).toContainText('Verified now')

    await page.getByTestId('settings-plugins-view').getByText('Browse', { exact: true }).click()
    await page.getByTestId(`plugin-install-${fixture.pluginId}`).click()
    await expect(page.getByTestId('plugin-package-review-dialog')).toBeVisible()
    await page.getByTestId('plugin-package-review-confirm').click()
    await expect(page.getByTestId(`plugin-installed-${fixture.pluginId}`)).toBeVisible()
    await page.getByTestId('settings-plugins-view').getByText('Installed', { exact: true }).click()
    const artifactDirectory =
      process.env.OPENPENCIL_PLUGIN_EXPORT_ARTIFACT_DIR ?? testInfo.outputPath('downloads')
    await mkdir(artifactDirectory, { recursive: true })
    try {
      const enabled = page.getByTestId(`plugin-enabled-${fixture.pluginId}`)
      await expect(enabled).not.toBeChecked()
      await enabled.click()
      await expect(enabled).toBeChecked()
      const action = page.getByTestId(`plugin-exporter-${fixture.pluginId}-${fixture.exporterId}`)
      await expect(action).toBeEnabled()
      const failedOperation = page.getByRole('alert').filter({ hasText: 'Plugin operation failed' })
      const [download] = await Promise.all([
        Promise.race([
          page.waitForEvent('download', { timeout: 0 }),
          failedOperation.waitFor({ state: 'visible', timeout: 0 }).then(async () => {
            throw new Error(await failedOperation.innerText())
          })
        ]),
        action.click()
      ])
      expect(download.suggestedFilename()).toMatch(
        new RegExp(`${fixture.suffix.replaceAll('.', '\\.')}$`)
      )
      const path = join(artifactDirectory, download.suggestedFilename())
      await download.saveAs(path)
      expect(await download.failure()).toBeNull()
      const bytes = new Uint8Array(await readFile(path))
      expect(bytes.byteLength).toBeGreaterThan(0)
      const checks = await inspectSavedExport(page, bytes, fixture.kind)
      await expect(page.getByTestId('plugin-export-result')).toContainText(
        download.suggestedFilename()
      )
      await expect(action).toBeEnabled()
      await expect(
        page.getByTestId(`plugin-export-progress-${fixture.pluginId}-${fixture.exporterId}`)
      ).toHaveCount(0)
      const screenshotPath = join(artifactDirectory, `${fixture.kind}-saved.png`)
      await page.screenshot({ path: screenshotPath })
      canvas.assertNoErrors()
      const report = {
        browser: 'webkit',
        nativeDownloadFallback: true,
        pluginId: fixture.pluginId,
        fileName: download.suggestedFilename(),
        path,
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        checks,
        status: 'passed',
        exportSessionIdle: true,
        screenshotPath
      }
      await testInfo.attach(`${fixture.kind}-saved-artifact`, {
        path,
        contentType: 'application/octet-stream'
      })
      await writeFile(
        join(artifactDirectory, `${fixture.kind}-report.json`),
        `${JSON.stringify(report, null, 2)}\n`
      )
    } catch (cause) {
      const screenshotPath = join(artifactDirectory, `${fixture.kind}-failed.png`)
      await page.screenshot({ path: screenshotPath }).catch(() => undefined)
      await writeFile(
        join(artifactDirectory, `${fixture.kind}-report.json`),
        `${JSON.stringify(
          {
            browser: 'webkit',
            pluginId: fixture.pluginId,
            status: 'failed',
            error: cause instanceof Error ? cause.message : String(cause),
            screenshotPath
          },
          null,
          2
        )}\n`
      )
      throw cause
    }
  })
}
