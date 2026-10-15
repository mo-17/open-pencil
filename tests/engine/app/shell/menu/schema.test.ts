import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import * as v from 'valibot'

import type { AppMenuEntry } from '@/app/shell/menu/schema'
import { APP_MENU_SCHEMA, PLUGIN_MENU_ACTION_IDS } from '@/app/shell/menu/schema'

import { repoPath } from '#tests/helpers/paths'

const NativeMenuEntrySchema: v.GenericSchema<AppMenuEntry> = v.lazy(() =>
  v.union([
    v.object({ type: v.literal('separator') }),
    v.object({
      type: v.optional(v.literal('item')),
      id: v.string(),
      label: v.string(),
      sub: v.optional(v.array(NativeMenuEntrySchema))
    })
  ])
)

function readGeneratedMenu() {
  return v.parse(
    v.pipe(
      v.string(),
      v.parseJson(),
      v.array(v.object({ label: v.string(), items: v.array(NativeMenuEntrySchema) }))
    ),
    readFileSync(repoPath('desktop/generated/menu.json'), 'utf8')
  )
}

function actionItems(entries: readonly AppMenuEntry[]): AppMenuEntry[] {
  const result: AppMenuEntry[] = []
  for (const entry of entries) {
    if ('type' in entry && entry.type === 'separator') continue
    result.push(entry)
    if (entry.sub) result.push(...actionItems(entry.sub))
  }
  return result
}

describe('APP_MENU_SCHEMA', () => {
  test('does not duplicate shortcuts for command-backed entries', () => {
    const duplicated = APP_MENU_SCHEMA.flatMap((group) =>
      actionItems(group.items).filter(
        (entry) => !('type' in entry) && entry.command && entry.shortcut
      )
    )

    expect(duplicated).toEqual([])
  })

  test('exposes every menu-backed editor command to shared dispatch', () => {
    const commandIds = actionItems(
      APP_MENU_SCHEMA.flatMap<AppMenuEntry>((group) => group.items)
    ).flatMap((entry) => {
      if ('type' in entry || !entry.command) return []
      return [entry.command]
    })

    expect(commandIds).toContain('selection.frameSelection')
    expect(commandIds).toContain('selection.toggleMask')
    expect(commandIds).toContain('selection.toggleVisibility')
    expect(commandIds).toContain('selection.toggleLock')
    expect(commandIds).toContain('selection.flipHorizontal')
    expect(commandIds).toContain('selection.flipVertical')
    expect(commandIds).toContain('selection.createInstance')
    expect(commandIds).toContain('selection.goToMainComponent')
    expect(commandIds).toContain('selection.moveToPage')
  })

  test('marks route-neutral native actions for shell dispatch', () => {
    const shellEntries = actionItems(
      APP_MENU_SCHEMA.flatMap<AppMenuEntry>((group) => group.items)
    ).filter((entry) => !('type' in entry) && entry.handler === 'shell')

    expect(shellEntries.map((entry) => ('type' in entry ? '' : entry.id))).toEqual([
      'open-storage-workspace',
      'open-tour',
      'settings',
      'view-design-issues',
      'theme-light',
      'theme-dark',
      'theme-auto',
      'snap-geometry',
      'snap-objects',
      'snap-pixel-grid'
    ])
  })

  test('includes storage workspace navigation in the shared File menu', () => {
    const fileMenu = APP_MENU_SCHEMA.find((group) => group.label === 'File')
    const entries = fileMenu ? actionItems(fileMenu.items) : []

    expect(entries).toContainEqual(
      expect.objectContaining({ id: 'open-storage-workspace', label: 'Open Storage Workspace…' })
    )
  })

  test('exposes recent files through the native File menu', () => {
    const fileMenu = APP_MENU_SCHEMA.find((group) => group.label === 'File')
    const entries = fileMenu ? actionItems(fileMenu.items) : []

    expect(entries).toContainEqual(
      expect.objectContaining({ id: 'open-recent', label: 'Open Recent', target: 'native' })
    )
  })

  test('exposes cloud storage copy actions only in the native File menu', () => {
    const fileMenu = APP_MENU_SCHEMA.find((group) => group.label === 'File')
    const entries = fileMenu ? actionItems(fileMenu.items) : []

    expect(entries).toContainEqual(
      expect.objectContaining({
        id: 'save-copy-google-drive',
        label: 'Save Copy to Google Drive',
        target: 'native'
      })
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        id: 'save-copy-onedrive',
        label: 'Save Copy to OneDrive',
        target: 'native'
      })
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        id: 'save-copy-aliyun-drive',
        label: 'Save Copy to Aliyun Drive',
        target: 'native'
      })
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        id: 'save-copy-baidu-netdisk',
        label: 'Save Copy to Baidu Netdisk',
        target: 'native'
      })
    )

    const generated = readGeneratedMenu()
    const nativeFile = generated.find((group) => group.label === 'File')
    const nativeIds = nativeFile
      ? actionItems(nativeFile.items).map((entry) => ('type' in entry ? null : entry.id))
      : []
    expect(nativeIds).toContain('save-copy-google-drive')
    expect(nativeIds).toContain('save-copy-onedrive')
    expect(nativeIds).toContain('save-copy-aliyun-drive')
    expect(nativeIds).toContain('save-copy-baidu-netdisk')
  })

  test('keeps move-to-page destination selection in the browser menu', () => {
    const objectMenu = APP_MENU_SCHEMA.find((group) => group.label === 'Object')
    const entries = objectMenu ? actionItems(objectMenu.items) : []
    const moveEntries = entries.filter(
      (entry) => !('type' in entry) && entry.id.startsWith('selection.moveToPage')
    )

    expect(moveEntries).toEqual([
      expect.objectContaining({ id: 'selection.moveToPage', target: 'browser' })
    ])
  })

  test('shares plugin command and exporter entries with the generated native menu', () => {
    const fileMenu = APP_MENU_SCHEMA.find((group) => group.label === 'File')
    const editMenu = APP_MENU_SCHEMA.find((group) => group.label === 'Edit')
    const fileEntries = fileMenu ? actionItems(fileMenu.items) : []
    const editEntries = editMenu ? actionItems(editMenu.items) : []

    expect(fileEntries).toContainEqual(
      expect.objectContaining({ id: PLUGIN_MENU_ACTION_IDS.exportTauriReact })
    )
    expect(fileEntries).toContainEqual(
      expect.objectContaining({ id: PLUGIN_MENU_ACTION_IDS.exportExpoReactNative })
    )
    expect(fileEntries).toContainEqual(
      expect.objectContaining({ id: PLUGIN_MENU_ACTION_IDS.exportFlutter })
    )
    expect(fileEntries).toContainEqual(
      expect.objectContaining({ id: PLUGIN_MENU_ACTION_IDS.exportNextJs })
    )
    expect(fileEntries).toContainEqual(
      expect.objectContaining({ id: PLUGIN_MENU_ACTION_IDS.exportVue })
    )
    expect(fileEntries).toContainEqual(
      expect.objectContaining({ id: PLUGIN_MENU_ACTION_IDS.exportCapacitor })
    )
    expect(fileEntries).toContainEqual(
      expect.objectContaining({ id: PLUGIN_MENU_ACTION_IDS.exportElectron })
    )
    expect(fileEntries).toContainEqual(
      expect.objectContaining({ id: PLUGIN_MENU_ACTION_IDS.exportWechatMiniProgram })
    )
    expect(fileEntries).toContainEqual(
      expect.objectContaining({ id: PLUGIN_MENU_ACTION_IDS.exportTaro })
    )
    expect(fileEntries).toContainEqual(
      expect.objectContaining({ id: PLUGIN_MENU_ACTION_IDS.exportUniApp })
    )
    expect(fileEntries).toContainEqual(
      expect.objectContaining({ id: PLUGIN_MENU_ACTION_IDS.exportMpx })
    )
    expect(editEntries.map((entry) => ('type' in entry ? null : entry.id))).toEqual(
      expect.arrayContaining([
        PLUGIN_MENU_ACTION_IDS.clipboardText,
        PLUGIN_MENU_ACTION_IDS.clipboardSvg,
        PLUGIN_MENU_ACTION_IDS.clipboardJsx,
        PLUGIN_MENU_ACTION_IDS.clipboardPng
      ])
    )

    const generated = readGeneratedMenu()
    const nativeFile = generated.find((group) => group.label === 'File')
    const nativeEdit = generated.find((group) => group.label === 'Edit')
    const nativeIds = [nativeFile, nativeEdit].flatMap((group) =>
      group ? actionItems(group.items).map((entry) => ('type' in entry ? null : entry.id)) : []
    )

    expect(nativeIds).toEqual(
      expect.arrayContaining([
        PLUGIN_MENU_ACTION_IDS.exportTauriReact,
        PLUGIN_MENU_ACTION_IDS.exportExpoReactNative,
        PLUGIN_MENU_ACTION_IDS.exportFlutter,
        PLUGIN_MENU_ACTION_IDS.exportNextJs,
        PLUGIN_MENU_ACTION_IDS.exportVue,
        PLUGIN_MENU_ACTION_IDS.exportCapacitor,
        PLUGIN_MENU_ACTION_IDS.exportElectron,
        PLUGIN_MENU_ACTION_IDS.exportWechatMiniProgram,
        PLUGIN_MENU_ACTION_IDS.exportTaro,
        PLUGIN_MENU_ACTION_IDS.exportUniApp,
        PLUGIN_MENU_ACTION_IDS.exportMpx,
        PLUGIN_MENU_ACTION_IDS.clipboardText,
        PLUGIN_MENU_ACTION_IDS.clipboardSvg,
        PLUGIN_MENU_ACTION_IDS.clipboardJsx,
        PLUGIN_MENU_ACTION_IDS.clipboardPng
      ])
    )
  })

  test('exposes the Application Runtime guide in browser and generated native menus', () => {
    const helpMenu = APP_MENU_SCHEMA.find((group) => group.label === 'Help')
    const entries = helpMenu ? actionItems(helpMenu.items) : []

    expect(entries).toEqual([
      expect.objectContaining({
        id: 'application-runtime-guide',
        label: 'Application Runtime Guide'
      })
    ])
    expect(helpMenu && 'target' in helpMenu ? helpMenu.target : undefined).toBeUndefined()
    expect(entries[0] && 'target' in entries[0] ? entries[0].target : undefined).toBeUndefined()

    const generated = readGeneratedMenu()
    const nativeHelp = generated.find((group) => group.label === 'Help')

    expect(nativeHelp?.items).toContainEqual({
      id: 'application-runtime-guide',
      label: 'Application Runtime Guide'
    })
  })
})
