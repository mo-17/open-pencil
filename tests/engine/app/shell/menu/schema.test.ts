import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { AppMenuEntry } from '@/app/shell/menu/schema'
import { APP_MENU_SCHEMA, PLUGIN_MENU_ACTION_IDS } from '@/app/shell/menu/schema'

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
    const commandIds = actionItems(APP_MENU_SCHEMA.flatMap((group) => group.items)).flatMap(
      (entry) => {
        if ('type' in entry || !entry.command) return []
        return [entry.command]
      }
    )

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
    const shellEntries = actionItems(APP_MENU_SCHEMA.flatMap((group) => group.items)).filter(
      (entry) => !('type' in entry) && entry.handler === 'shell'
    )

    expect(shellEntries.map((entry) => ('type' in entry ? '' : entry.id))).toEqual([
      'open-storage-workspace',
      'theme-light',
      'theme-dark',
      'theme-auto',
      'settings'
    ])
  })

  test('includes storage workspace navigation in the shared File menu', () => {
    const fileMenu = APP_MENU_SCHEMA.find((group) => group.label === 'File')
    const entries = fileMenu ? actionItems(fileMenu.items) : []

    expect(entries).toContainEqual(
      expect.objectContaining({ id: 'open-storage-workspace', label: 'Open Storage Workspace…' })
    )
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

    const generated = JSON.parse(
      readFileSync(resolve(import.meta.dir, '../../../../../desktop/generated/menu.json'), 'utf8')
    ) as Array<{ label: string; items: AppMenuEntry[] }>
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
    expect(helpMenu?.target).toBeUndefined()
    expect(entries[0] && 'target' in entries[0] ? entries[0].target : undefined).toBeUndefined()

    const generated = JSON.parse(
      readFileSync(resolve(import.meta.dir, '../../../../../desktop/generated/menu.json'), 'utf8')
    ) as Array<{ label: string; items: Array<{ id?: string; label?: string }> }>
    const nativeHelp = generated.find((group) => group.label === 'Help')

    expect(nativeHelp?.items).toContainEqual({
      id: 'application-runtime-guide',
      label: 'Application Runtime Guide'
    })
  })
})
