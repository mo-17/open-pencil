import { describe, expect, test } from 'bun:test'

import {
  CHART_PLUGIN_ID,
  HTML_MODULE_TYPE,
  HTML_PLUGIN_ID,
  MAP_PLUGIN_ID,
  RICH_TEXT_PLUGIN_ID,
  SLIDE_MENU_MODULE_TYPE,
  SLIDE_MENU_PLUGIN_ID,
  TABLE_MODULE_TYPE,
  TABLE_PLUGIN_ID,
  VIDEO_MODULE_TYPE,
  VIDEO_PLUGIN_ID
} from '@open-pencil/core/plugins'

import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  CLIPBOARD_COMMANDS,
  CLIPBOARD_TOOLKIT_PLUGIN_ID,
  EXPO_REACT_NATIVE_EXPORTER,
  EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
  FLUTTER_EXPORTER,
  FLUTTER_EXPORTER_PLUGIN_ID,
  TAURI_REACT_EXPORTER,
  TAURI_REACT_EXPORTER_PLUGIN_ID
} from '@/app/plugins/host/ids'

const ENGINE_VERSION = '0.13.2'

describe('bundled plugin catalog contributions', () => {
  test('publishes the eleven reviewed built-in plugin identities', () => {
    const ids = createBundledPluginCatalog().map((entry) => entry.manifest.plugin.id)

    expect(ids).toEqual([
      MAP_PLUGIN_ID,
      CHART_PLUGIN_ID,
      RICH_TEXT_PLUGIN_ID,
      HTML_PLUGIN_ID,
      VIDEO_PLUGIN_ID,
      TABLE_PLUGIN_ID,
      SLIDE_MENU_PLUGIN_ID,
      CLIPBOARD_TOOLKIT_PLUGIN_ID,
      TAURI_REACT_EXPORTER_PLUGIN_ID,
      EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
      FLUTTER_EXPORTER_PLUGIN_ID
    ])
  })

  test('keeps the reviewed HTML module opt-in and bound to its trusted adapter', () => {
    const html = createBundledPluginCatalog().find(
      (entry) => entry.manifest.plugin.id === HTML_PLUGIN_ID
    )

    expect(html).toMatchObject({
      trustSource: 'app-bundle',
      manifest: {
        plugin: { id: HTML_PLUGIN_ID, name: '</> HTML' },
        contributions: {
          modules: [
            expect.objectContaining({
              moduleType: HTML_MODULE_TYPE,
              adapterId: 'open-pencil.html'
            })
          ]
        }
      }
    })
    expect(html?.installedByDefault).toBeUndefined()
    expect(html?.enabledByDefault).toBeUndefined()
  })

  test('keeps the reviewed Video, Table, and Slide Menu modules opt-in and trusted', () => {
    const catalog = createBundledPluginCatalog()
    const expected = [
      {
        pluginId: VIDEO_PLUGIN_ID,
        moduleType: VIDEO_MODULE_TYPE,
        adapterId: 'open-pencil.video'
      },
      {
        pluginId: TABLE_PLUGIN_ID,
        moduleType: TABLE_MODULE_TYPE,
        adapterId: 'open-pencil.table'
      },
      {
        pluginId: SLIDE_MENU_PLUGIN_ID,
        moduleType: SLIDE_MENU_MODULE_TYPE,
        adapterId: 'open-pencil.slide-menu'
      }
    ]

    for (const item of expected) {
      const entry = catalog.find((candidate) => candidate.manifest.plugin.id === item.pluginId)
      expect(entry).toMatchObject({
        trustSource: 'app-bundle',
        manifest: {
          plugin: { id: item.pluginId },
          contributions: {
            modules: [
              expect.objectContaining({
                moduleType: item.moduleType,
                adapterId: item.adapterId
              })
            ]
          }
        }
      })
      expect(entry?.installedByDefault).toBeUndefined()
      expect(entry?.enabledByDefault).toBeUndefined()
    }
  })

  test('declares the clipboard commands and project exporters without executable modules', () => {
    const catalog = createBundledPluginCatalog()
    const clipboard = catalog.find(
      (entry) => entry.manifest.plugin.id === CLIPBOARD_TOOLKIT_PLUGIN_ID
    )?.manifest
    const tauriExporter = catalog.find(
      (entry) => entry.manifest.plugin.id === TAURI_REACT_EXPORTER_PLUGIN_ID
    )?.manifest
    const expoExporter = catalog.find(
      (entry) => entry.manifest.plugin.id === EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID
    )?.manifest
    const flutterExporter = catalog.find(
      (entry) => entry.manifest.plugin.id === FLUTTER_EXPORTER_PLUGIN_ID
    )?.manifest

    expect(clipboard?.contributions.modules).toEqual([])
    expect(
      clipboard?.contributions.commands?.map(({ commandId, adapterId }) => ({
        commandId,
        adapterId
      }))
    ).toEqual(Object.values(CLIPBOARD_COMMANDS))
    expect(clipboard?.contributions.exporters).toBeUndefined()

    expect(tauriExporter?.contributions.modules).toEqual([])
    expect(tauriExporter?.contributions.commands).toBeUndefined()
    expect(tauriExporter?.contributions.exporters).toEqual([
      expect.objectContaining(TAURI_REACT_EXPORTER)
    ])
    expect(expoExporter?.contributions.modules).toEqual([])
    expect(expoExporter?.contributions.commands).toBeUndefined()
    expect(expoExporter?.contributions.exporters).toEqual([
      expect.objectContaining(EXPO_REACT_NATIVE_EXPORTER)
    ])
    expect(flutterExporter?.contributions.modules).toEqual([])
    expect(flutterExporter?.contributions.commands).toBeUndefined()
    expect(flutterExporter?.contributions.exporters).toEqual([
      expect.objectContaining(FLUTTER_EXPORTER)
    ])
  })

  test('lists and resolves commands and exporters only while installed and enabled', async () => {
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      activationCompatibilityPolicy: () => ({ ok: true }),
      catalog: createBundledPluginCatalog(),
      engineVersion: ENGINE_VERSION
    })

    await store.load()
    expect(store.installedCommands()).toEqual([])
    expect(store.installedExporters()).toEqual([])

    await store.install(CLIPBOARD_TOOLKIT_PLUGIN_ID)
    expect(store.installedCommands()).toEqual([])
    expect(store.command(CLIPBOARD_TOOLKIT_PLUGIN_ID, CLIPBOARD_COMMANDS.text.commandId)).toBeNull()

    await store.setEnabled(CLIPBOARD_TOOLKIT_PLUGIN_ID, true)
    expect(store.installedCommands()).toHaveLength(Object.keys(CLIPBOARD_COMMANDS).length)
    expect(
      store.command(CLIPBOARD_TOOLKIT_PLUGIN_ID, CLIPBOARD_COMMANDS.svg.commandId)?.contribution
    ).toMatchObject(CLIPBOARD_COMMANDS.svg)

    await store.setEnabled(CLIPBOARD_TOOLKIT_PLUGIN_ID, false)
    expect(store.installedCommands()).toEqual([])
    expect(store.command(CLIPBOARD_TOOLKIT_PLUGIN_ID, CLIPBOARD_COMMANDS.svg.commandId)).toBeNull()

    await store.install(TAURI_REACT_EXPORTER_PLUGIN_ID)
    expect(store.installedExporters()).toEqual([])
    expect(
      store.exporter(TAURI_REACT_EXPORTER_PLUGIN_ID, TAURI_REACT_EXPORTER.exporterId)
    ).toBeNull()

    await store.setEnabled(TAURI_REACT_EXPORTER_PLUGIN_ID, true)
    expect(store.installedExporters()).toHaveLength(1)
    expect(
      store.exporter(TAURI_REACT_EXPORTER_PLUGIN_ID, TAURI_REACT_EXPORTER.exporterId)?.contribution
    ).toMatchObject(TAURI_REACT_EXPORTER)

    await store.setEnabled(TAURI_REACT_EXPORTER_PLUGIN_ID, false)
    expect(store.installedExporters()).toEqual([])
    expect(
      store.exporter(TAURI_REACT_EXPORTER_PLUGIN_ID, TAURI_REACT_EXPORTER.exporterId)
    ).toBeNull()

    await store.install(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID)
    expect(store.installedExporters()).toEqual([])
    expect(
      store.exporter(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID, EXPO_REACT_NATIVE_EXPORTER.exporterId)
    ).toBeNull()

    await store.setEnabled(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID, true)
    expect(store.installedExporters()).toHaveLength(1)
    expect(
      store.exporter(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID, EXPO_REACT_NATIVE_EXPORTER.exporterId)
        ?.contribution
    ).toMatchObject(EXPO_REACT_NATIVE_EXPORTER)

    await store.setEnabled(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID, false)
    expect(store.installedExporters()).toEqual([])

    await store.install(FLUTTER_EXPORTER_PLUGIN_ID)
    expect(store.installedExporters()).toEqual([])
    await store.setEnabled(FLUTTER_EXPORTER_PLUGIN_ID, true)
    expect(
      store.exporter(FLUTTER_EXPORTER_PLUGIN_ID, FLUTTER_EXPORTER.exporterId)?.contribution
    ).toMatchObject(FLUTTER_EXPORTER)
    await store.setEnabled(FLUTTER_EXPORTER_PLUGIN_ID, false)
    expect(store.installedExporters()).toEqual([])
  })
})
