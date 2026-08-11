import { afterEach, describe, expect, test } from 'bun:test'

import { createPluginExportResultData } from '@/app/plugins/host/export-result'
import {
  appPluginExportSessionSnapshot,
  cancelAppPluginExport,
  isAppPluginExportActive,
  runAppPluginExportSession,
  updateActiveAppPluginExportStage,
  updateAppPluginExportStage
} from '@/app/plugins/host/export-session'
import { runPluginFileExport } from '@/app/plugins/host/source-exporter-runtime'

function pendingUntilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const abort = (): void => reject(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

afterEach(() => {
  cancelAppPluginExport()
})

describe('plugin export session', () => {
  test('publishes bounded progress, rejects overlap, and cancels the exact export', async () => {
    const pending = runAppPluginExportSession({
      pluginId: 'open-pencil.vue-exporter',
      exporterId: 'vue-source',
      operation: pendingUntilAbort
    })
    expect(appPluginExportSessionSnapshot.value).toMatchObject({
      pluginId: 'open-pencil.vue-exporter',
      exporterId: 'vue-source',
      stage: 'choosing-destination'
    })
    expect(isAppPluginExportActive()).toBe(true)
    expect(isAppPluginExportActive('open-pencil.vue-exporter')).toBe(true)

    updateActiveAppPluginExportStage('compiling')
    expect(appPluginExportSessionSnapshot.value?.stage).toBe('compiling')
    updateAppPluginExportStage('another-plugin', 'vue-source', 'saving')
    expect(appPluginExportSessionSnapshot.value?.stage).toBe('compiling')

    await expect(
      runAppPluginExportSession({
        pluginId: 'open-pencil.another-exporter',
        exporterId: 'other',
        operation: async () => undefined
      })
    ).rejects.toThrow('Plugin export is already running')
    expect(cancelAppPluginExport('open-pencil.another-exporter')).toBe(false)
    expect(cancelAppPluginExport('open-pencil.vue-exporter')).toBe(true)
    expect(appPluginExportSessionSnapshot.value?.stage).toBe('cancelling')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(appPluginExportSessionSnapshot.value).toBeNull()
    expect(isAppPluginExportActive()).toBe(false)
  })

  test('links a parent abort signal and clears the session after failure', async () => {
    const controller = new AbortController()
    const pending = runAppPluginExportSession({
      pluginId: 'open-pencil.vue-exporter',
      exporterId: 'vue-source',
      signal: controller.signal,
      operation: pendingUntilAbort
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(appPluginExportSessionSnapshot.value).toBeNull()
  })

  test('ignores late progress after cancellation begins', async () => {
    const pending = runAppPluginExportSession({
      pluginId: 'open-pencil.vue-exporter',
      exporterId: 'vue-source',
      operation: pendingUntilAbort
    })
    cancelAppPluginExport()
    updateActiveAppPluginExportStage('saving')
    expect(appPluginExportSessionSnapshot.value?.stage).toBe('cancelling')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('tracks destination, generation, and saving across shared file exporters', async () => {
    const stages: string[] = []
    const result = await runAppPluginExportSession({
      pluginId: 'open-pencil.design-tokens',
      exporterId: 'design-tokens',
      async operation(signal) {
        return runPluginFileExport({
          fileName: 'tokens.json',
          signal,
          warnings: [],
          async chooseDestination() {
            stages.push(appPluginExportSessionSnapshot.value?.stage ?? 'missing')
            return {
              async write() {
                stages.push(appPluginExportSessionSnapshot.value?.stage ?? 'missing')
              }
            }
          },
          createBytes() {
            stages.push(appPluginExportSessionSnapshot.value?.stage ?? 'missing')
            return new Uint8Array([1, 2, 3])
          }
        })
      }
    })
    expect(result.saved).toBe(true)
    expect(stages).toEqual(['choosing-destination', 'compiling', 'saving'])
    expect(appPluginExportSessionSnapshot.value).toBeNull()
  })

  test('serializes bounded warning summaries without invoking accessors', () => {
    let getterReads = 0
    const accessor = Object.create(null)
    Object.defineProperty(accessor, 'code', {
      enumerable: true,
      get() {
        getterReads += 1
        return 'unsafe'
      }
    })
    const data = createPluginExportResultData({
      fileName: 'demo.zip',
      fileCount: 4,
      warnings: [
        { code: 'vue-font-assets-omitted', message: 'Fonts\nwere  omitted', nodeId: '12:4' },
        accessor
      ],
      saved: true
    })
    expect(getterReads).toBe(0)
    expect(data).toEqual({
      kind: 'plugin-export',
      fileName: 'demo.zip',
      fileCount: 4,
      warningCount: 2,
      warnings: [
        {
          code: 'vue-font-assets-omitted',
          message: 'Fonts were omitted',
          nodeId: '12:4'
        }
      ],
      warningsTruncated: true
    })
  })

  test('keeps progress, cancellation, and plugin lifecycle guards visible in Settings', async () => {
    const panel = await Bun.file('src/components/settings/plugins/PluginsPanel.vue').text()
    const result = await Bun.file('src/components/settings/plugins/PluginExporterResult.vue').text()

    expect(panel).toContain('appPluginExportSessionSnapshot')
    expect(panel).toContain('cancelAppPluginExport(pluginId(plugin))')
    expect(panel).toContain(
      'v-if="supportsPluginExporterCancellation(pluginId(plugin), contribution)"'
    )
    expect(panel).toContain('dialogs.value.pluginExportLifecycleBlocked')
    expect(panel).toContain('rejectActivePluginOperation(pluginId(plugin))')
    expect(panel).toContain('min-h-11')
    expect(panel).toContain('<PluginExporterResult :data="hostActionData" />')
    expect(result).toContain('data-test-id="plugin-export-result"')
    expect(result).toContain('data-test-id="plugin-export-warnings"')
    expect(result).not.toContain('v-html')

    const hostAction = panel.slice(
      panel.indexOf('async function runHostContribution'),
      panel.indexOf('function runCommand')
    )
    const documentLock = panel.slice(
      panel.indexOf('function writeDocumentLock'),
      panel.indexOf('function addModule')
    )
    const exporterAction = panel.slice(
      panel.indexOf('function runExporter'),
      panel.indexOf('function withoutPluginRuntimeValue')
    )
    expect(hostAction).toContain("error.name === 'AbortError'")
    expect(hostAction).toContain('cancelledMessage')
    expect(exporterAction).toContain('dialogs.value.pluginExportCancelled')
    expect(documentLock).not.toContain('pluginExportCancelled')
  })
})
