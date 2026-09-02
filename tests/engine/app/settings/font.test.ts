import { describe, expect, test } from 'bun:test'

import { useFontSettings, type FontSettingsActions } from '@/components/FontSettings/use'

function actions(overrides: Partial<FontSettingsActions> = {}): FontSettingsActions {
  let accessState: ReturnType<FontSettingsActions['localFontAccessState']> = 'prompt'
  return {
    async clearDownloadedFontCache() {
      return undefined
    },
    async downloadedFontCacheSummary() {
      return { count: 2, byteLength: 1_572_864, updatedAt: 1_700_000_000_000 }
    },
    localFontAccessState() {
      return accessState
    },
    async predownloadFallbackFonts() {
      return undefined
    },
    async importFontFile() {
      return { family: 'Imported Sans', style: 'Regular' }
    },
    async requestLocalFontAccess() {
      accessState = 'granted'
      return ['Inter']
    },
    onlineFontsEnabled: { value: true },
    fontProviderSettings: {
      value: { google: true, fontsource: true, bunny: false, fontshare: false }
    },
    ...overrides
  }
}

describe('useFontSettings', () => {
  test('loads cache summary and formats labels', async () => {
    const settings = useFontSettings(actions())

    await settings.refreshSummary()

    expect(settings.cacheCount.value).toBe(2)
    expect(settings.accessStateLabel.value).toBe('Not requested')
    expect(settings.canRequestLocalFonts.value).toBe(true)
    expect(settings.cacheSize.value).toBe('1.5 MB')
    expect(settings.cacheUpdatedLabel.value).not.toBe('Never')
    expect(settings.busyAction.value).toBeNull()
  })

  test('requests local font access and updates status', async () => {
    const settings = useFontSettings(actions())

    await settings.requestAccess()

    expect(settings.accessState.value).toBe('granted')
    expect(settings.accessStateLabel.value).toBe('Enabled')
    expect(settings.canRequestLocalFonts.value).toBe(false)
    expect(settings.status.value).toBe('Local font access enabled.')
    expect(settings.busyAction.value).toBeNull()
  })

  test('downloads fallbacks then refreshes cache summary', async () => {
    const calls: string[] = []
    const settings = useFontSettings(
      actions({
        async predownloadFallbackFonts() {
          calls.push('download')
        },
        async downloadedFontCacheSummary() {
          calls.push('summary')
          return { count: 3, byteLength: 3_145_728, updatedAt: null }
        }
      })
    )

    await settings.downloadFallbacks()

    expect(calls).toEqual(['download', 'summary'])
    expect(settings.cacheCount.value).toBe(3)
    expect(settings.cacheSize.value).toBe('3.0 MB')
    expect(settings.status.value).toBe('Fallback fonts downloaded.')
  })

  test('clears cache then refreshes cache summary', async () => {
    const calls: string[] = []
    const settings = useFontSettings(
      actions({
        async clearDownloadedFontCache() {
          calls.push('clear')
        },
        async downloadedFontCacheSummary() {
          calls.push('summary')
          return { count: 0, byteLength: 0, updatedAt: null }
        }
      })
    )

    await settings.clearCache()

    expect(calls).toEqual(['clear', 'summary'])
    expect(settings.cacheCount.value).toBe(0)
    expect(settings.cacheSize.value).toBe('0 MB')
    expect(settings.status.value).toBe('Font cache cleared.')
  })

  test('imports a font file and refreshes the shared cache summary', async () => {
    const calls: string[] = []
    const settings = useFontSettings(
      actions({
        async importFontFile() {
          calls.push('import')
          return { family: 'Bebas Neue', style: 'Bold' }
        },
        async downloadedFontCacheSummary() {
          calls.push('summary')
          return { count: 1, byteLength: 1234, updatedAt: 1_700_000_000_000 }
        }
      })
    )

    await expect(settings.importFont()).resolves.toEqual({ family: 'Bebas Neue', style: 'Bold' })
    expect(calls).toEqual(['import', 'summary'])
    expect(settings.cacheCount.value).toBe(1)
    expect(settings.status.value).toBe('Imported Bebas Neue (Bold).')
    expect(settings.busyAction.value).toBeNull()
  })

  test('reports a font import failure without changing the cache summary', async () => {
    const settings = useFontSettings(
      actions({
        async importFontFile() {
          throw new Error('damaged file')
        }
      })
    )

    await expect(settings.importFont()).resolves.toBeNull()
    expect(settings.status.value).toBe('Could not import font: damaged file')
    expect(settings.busyAction.value).toBeNull()
  })

  test('reports action failures without leaving busy state stuck', async () => {
    const settings = useFontSettings(
      actions({
        async requestLocalFontAccess() {
          throw new Error('denied')
        }
      })
    )

    await settings.requestAccess()

    expect(settings.status.value).toBe('Local font access was not granted.')
    expect(settings.busyAction.value).toBeNull()
  })
})
