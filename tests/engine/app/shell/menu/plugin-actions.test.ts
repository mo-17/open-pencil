import { describe, expect, test } from 'bun:test'

import type { EditorStore } from '@/app/editor/active-store'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  CAPACITOR_EXPORTER,
  CAPACITOR_EXPORTER_PLUGIN_ID,
  CLIPBOARD_COMMANDS,
  CLIPBOARD_TOOLKIT_PLUGIN_ID,
  ELECTRON_EXPORTER,
  ELECTRON_EXPORTER_PLUGIN_ID,
  EXPO_REACT_NATIVE_EXPORTER,
  EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
  FLUTTER_EXPORTER,
  FLUTTER_EXPORTER_PLUGIN_ID,
  MPX_EXPORTER,
  MPX_EXPORTER_PLUGIN_ID,
  NEXTJS_EXPORTER,
  NEXTJS_EXPORTER_PLUGIN_ID,
  TARO_EXPORTER,
  TARO_EXPORTER_PLUGIN_ID,
  TAURI_REACT_EXPORTER,
  TAURI_REACT_EXPORTER_PLUGIN_ID,
  UNI_APP_EXPORTER,
  UNI_APP_EXPORTER_PLUGIN_ID,
  VUE_EXPORTER,
  VUE_EXPORTER_PLUGIN_ID,
  WECHAT_MINIPROGRAM_EXPORTER,
  WECHAT_MINIPROGRAM_EXPORTER_PLUGIN_ID
} from '@/app/plugins/host/ids'
import {
  createPluginMenuActions,
  executeCapacitorPluginMenuExporter,
  executeClipboardPluginMenuCommand,
  executeElectronPluginMenuExporter,
  executeExpoReactNativePluginMenuExporter,
  executeFlutterPluginMenuExporter,
  executeMpxPluginMenuExporter,
  executeNextJsPluginMenuExporter,
  executeTaroPluginMenuExporter,
  executeTauriReactPluginMenuExporter,
  executeUniAppPluginMenuExporter,
  executeVuePluginMenuExporter,
  executeWechatMiniProgramPluginMenuExporter,
  type PluginMenuExecutionDependencies
} from '@/app/shell/menu/plugin-actions'
import { PLUGIN_MENU_ACTION_IDS } from '@/app/shell/menu/schema'

const EDITOR = {} as EditorStore

function pluginStore() {
  return createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    catalog: createBundledPluginCatalog(),
    engineVersion: '0.13.2'
  })
}

function execution(
  store: ReturnType<typeof pluginStore>,
  calls: string[]
): PluginMenuExecutionDependencies {
  return {
    store,
    ready: Promise.resolve(),
    async runCommand(_editor, plugin, contribution) {
      calls.push(`${plugin.package.manifest.plugin.id}:${contribution.commandId}`)
      return { status: 'completed', message: `ran ${contribution.commandId}` }
    },
    async runExporter(_editor, plugin, contribution) {
      calls.push(`${plugin.package.manifest.plugin.id}:${contribution.exporterId}`)
      return { status: 'completed', message: `ran ${contribution.exporterId}` }
    }
  }
}

describe('plugin system menu actions', () => {
  test('explains when Clipboard Toolkit is not installed or not enabled', async () => {
    const store = pluginStore()
    const calls: string[] = []
    const dependencies = execution(store, calls)
    await store.load()

    await expect(
      executeClipboardPluginMenuCommand(EDITOR, CLIPBOARD_COMMANDS.text.commandId, dependencies)
    ).rejects.toThrow('Clipboard Toolkit is not installed. Install it in Settings → Plugins.')

    await store.install(CLIPBOARD_TOOLKIT_PLUGIN_ID)
    await expect(
      executeClipboardPluginMenuCommand(EDITOR, CLIPBOARD_COMMANDS.text.commandId, dependencies)
    ).rejects.toThrow('Clipboard Toolkit is disabled. Enable it in Settings → Plugins.')
    expect(calls).toEqual([])
  })

  test('resolves enabled contributions and passes their reviewed identities to the host gate', async () => {
    const store = pluginStore()
    const calls: string[] = []
    const dependencies = execution(store, calls)
    await store.load()
    await store.install(CLIPBOARD_TOOLKIT_PLUGIN_ID)
    await store.setEnabled(CLIPBOARD_TOOLKIT_PLUGIN_ID, true)
    await store.install(TAURI_REACT_EXPORTER_PLUGIN_ID)
    await store.setEnabled(TAURI_REACT_EXPORTER_PLUGIN_ID, true)
    await store.install(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID)
    await store.setEnabled(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID, true)
    await store.install(FLUTTER_EXPORTER_PLUGIN_ID)
    await store.setEnabled(FLUTTER_EXPORTER_PLUGIN_ID, true)
    await store.install(NEXTJS_EXPORTER_PLUGIN_ID)
    await store.setEnabled(NEXTJS_EXPORTER_PLUGIN_ID, true)
    await store.install(CAPACITOR_EXPORTER_PLUGIN_ID)
    await store.setEnabled(CAPACITOR_EXPORTER_PLUGIN_ID, true)
    await store.install(ELECTRON_EXPORTER_PLUGIN_ID)
    await store.setEnabled(ELECTRON_EXPORTER_PLUGIN_ID, true)
    await store.install(VUE_EXPORTER_PLUGIN_ID)
    await store.setEnabled(VUE_EXPORTER_PLUGIN_ID, true)
    for (const pluginId of [
      WECHAT_MINIPROGRAM_EXPORTER_PLUGIN_ID,
      TARO_EXPORTER_PLUGIN_ID,
      UNI_APP_EXPORTER_PLUGIN_ID,
      MPX_EXPORTER_PLUGIN_ID
    ]) {
      await store.install(pluginId)
      await store.setEnabled(pluginId, true)
    }

    await expect(
      executeClipboardPluginMenuCommand(EDITOR, CLIPBOARD_COMMANDS.svg.commandId, dependencies)
    ).resolves.toEqual({ status: 'completed', message: 'ran copy-as-svg' })
    await expect(executeTauriReactPluginMenuExporter(EDITOR, dependencies)).resolves.toEqual({
      status: 'completed',
      message: `ran ${TAURI_REACT_EXPORTER.exporterId}`
    })
    await expect(executeExpoReactNativePluginMenuExporter(EDITOR, dependencies)).resolves.toEqual({
      status: 'completed',
      message: `ran ${EXPO_REACT_NATIVE_EXPORTER.exporterId}`
    })
    await expect(executeFlutterPluginMenuExporter(EDITOR, dependencies)).resolves.toEqual({
      status: 'completed',
      message: `ran ${FLUTTER_EXPORTER.exporterId}`
    })
    await expect(executeNextJsPluginMenuExporter(EDITOR, dependencies)).resolves.toEqual({
      status: 'completed',
      message: `ran ${NEXTJS_EXPORTER.exporterId}`
    })
    await expect(executeVuePluginMenuExporter(EDITOR, dependencies)).resolves.toEqual({
      status: 'completed',
      message: `ran ${VUE_EXPORTER.exporterId}`
    })
    await expect(executeCapacitorPluginMenuExporter(EDITOR, dependencies)).resolves.toEqual({
      status: 'completed',
      message: `ran ${CAPACITOR_EXPORTER.exporterId}`
    })
    await expect(executeElectronPluginMenuExporter(EDITOR, dependencies)).resolves.toEqual({
      status: 'completed',
      message: `ran ${ELECTRON_EXPORTER.exporterId}`
    })
    await expect(executeWechatMiniProgramPluginMenuExporter(EDITOR, dependencies)).resolves.toEqual(
      {
        status: 'completed',
        message: `ran ${WECHAT_MINIPROGRAM_EXPORTER.exporterId}`
      }
    )
    await expect(executeTaroPluginMenuExporter(EDITOR, dependencies)).resolves.toEqual({
      status: 'completed',
      message: `ran ${TARO_EXPORTER.exporterId}`
    })
    await expect(executeUniAppPluginMenuExporter(EDITOR, dependencies)).resolves.toEqual({
      status: 'completed',
      message: `ran ${UNI_APP_EXPORTER.exporterId}`
    })
    await expect(executeMpxPluginMenuExporter(EDITOR, dependencies)).resolves.toEqual({
      status: 'completed',
      message: `ran ${MPX_EXPORTER.exporterId}`
    })
    expect(calls).toEqual([
      `${CLIPBOARD_TOOLKIT_PLUGIN_ID}:${CLIPBOARD_COMMANDS.svg.commandId}`,
      `${TAURI_REACT_EXPORTER_PLUGIN_ID}:${TAURI_REACT_EXPORTER.exporterId}`,
      `${EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID}:${EXPO_REACT_NATIVE_EXPORTER.exporterId}`,
      `${FLUTTER_EXPORTER_PLUGIN_ID}:${FLUTTER_EXPORTER.exporterId}`,
      `${NEXTJS_EXPORTER_PLUGIN_ID}:${NEXTJS_EXPORTER.exporterId}`,
      `${VUE_EXPORTER_PLUGIN_ID}:${VUE_EXPORTER.exporterId}`,
      `${CAPACITOR_EXPORTER_PLUGIN_ID}:${CAPACITOR_EXPORTER.exporterId}`,
      `${ELECTRON_EXPORTER_PLUGIN_ID}:${ELECTRON_EXPORTER.exporterId}`,
      `${WECHAT_MINIPROGRAM_EXPORTER_PLUGIN_ID}:${WECHAT_MINIPROGRAM_EXPORTER.exporterId}`,
      `${TARO_EXPORTER_PLUGIN_ID}:${TARO_EXPORTER.exporterId}`,
      `${UNI_APP_EXPORTER_PLUGIN_ID}:${UNI_APP_EXPORTER.exporterId}`,
      `${MPX_EXPORTER_PLUGIN_ID}:${MPX_EXPORTER.exporterId}`
    ])
  })

  test('surfaces unavailable plugin errors and completed results through menu notifications', async () => {
    const store = pluginStore()
    const calls: string[] = []
    const notifications: Array<{ tone: string; message: string }> = []
    const notify = (tone: string) => (message: string) => notifications.push({ tone, message })
    await store.load()
    const actions = createPluginMenuActions(EDITOR, {
      execution: execution(store, calls),
      notifications: {
        info: notify('info'),
        warning: notify('warning'),
        error: notify('error')
      },
      formatError: (message) => `Plugin operation failed: ${message}`
    })

    await actions[PLUGIN_MENU_ACTION_IDS.clipboardPng]()
    expect(notifications).toEqual([
      {
        tone: 'error',
        message:
          'Plugin operation failed: Clipboard Toolkit is not installed. Install it in Settings → Plugins.'
      }
    ])
    expect(calls).toEqual([])

    await store.install(CLIPBOARD_TOOLKIT_PLUGIN_ID)
    await store.setEnabled(CLIPBOARD_TOOLKIT_PLUGIN_ID, true)
    await actions[PLUGIN_MENU_ACTION_IDS.clipboardPng]()
    expect(notifications.at(-1)).toEqual({
      tone: 'info',
      message: 'ran copy-as-png'
    })

    await actions[PLUGIN_MENU_ACTION_IDS.exportExpoReactNative]()
    expect(notifications.at(-1)).toEqual({
      tone: 'error',
      message:
        'Plugin operation failed: Expo React Native Exporter is not installed. Install it in Settings → Plugins.'
    })
    expect(calls).toEqual([`${CLIPBOARD_TOOLKIT_PLUGIN_ID}:${CLIPBOARD_COMMANDS.png.commandId}`])

    await store.install(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID)
    await store.setEnabled(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID, true)
    await actions[PLUGIN_MENU_ACTION_IDS.exportExpoReactNative]()
    expect(notifications.at(-1)).toEqual({
      tone: 'info',
      message: `ran ${EXPO_REACT_NATIVE_EXPORTER.exporterId}`
    })

    await actions[PLUGIN_MENU_ACTION_IDS.exportFlutter]()
    expect(notifications.at(-1)).toEqual({
      tone: 'error',
      message:
        'Plugin operation failed: Flutter Exporter is not installed. Install it in Settings → Plugins.'
    })

    await store.install(FLUTTER_EXPORTER_PLUGIN_ID)
    await store.setEnabled(FLUTTER_EXPORTER_PLUGIN_ID, true)
    await actions[PLUGIN_MENU_ACTION_IDS.exportFlutter]()
    expect(notifications.at(-1)).toEqual({
      tone: 'info',
      message: `ran ${FLUTTER_EXPORTER.exporterId}`
    })

    await actions[PLUGIN_MENU_ACTION_IDS.exportNextJs]()
    expect(notifications.at(-1)).toEqual({
      tone: 'error',
      message:
        'Plugin operation failed: Next.js Exporter is not installed. Install it in Settings → Plugins.'
    })

    await store.install(NEXTJS_EXPORTER_PLUGIN_ID)
    await store.setEnabled(NEXTJS_EXPORTER_PLUGIN_ID, true)
    await actions[PLUGIN_MENU_ACTION_IDS.exportNextJs]()
    expect(notifications.at(-1)).toEqual({
      tone: 'info',
      message: `ran ${NEXTJS_EXPORTER.exporterId}`
    })

    await actions[PLUGIN_MENU_ACTION_IDS.exportVue]()
    expect(notifications.at(-1)).toEqual({
      tone: 'error',
      message:
        'Plugin operation failed: Vue Exporter is not installed. Install it in Settings → Plugins.'
    })

    await store.install(VUE_EXPORTER_PLUGIN_ID)
    await store.setEnabled(VUE_EXPORTER_PLUGIN_ID, true)
    await actions[PLUGIN_MENU_ACTION_IDS.exportVue]()
    expect(notifications.at(-1)).toEqual({
      tone: 'info',
      message: `ran ${VUE_EXPORTER.exporterId}`
    })

    await actions[PLUGIN_MENU_ACTION_IDS.exportWechatMiniProgram]()
    expect(notifications.at(-1)).toEqual({
      tone: 'error',
      message:
        'Plugin operation failed: WeChat Mini Program Exporter is not installed. Install it in Settings → Plugins.'
    })

    await store.install(WECHAT_MINIPROGRAM_EXPORTER_PLUGIN_ID)
    await store.setEnabled(WECHAT_MINIPROGRAM_EXPORTER_PLUGIN_ID, true)
    await actions[PLUGIN_MENU_ACTION_IDS.exportWechatMiniProgram]()
    expect(notifications.at(-1)).toEqual({
      tone: 'info',
      message: `ran ${WECHAT_MINIPROGRAM_EXPORTER.exporterId}`
    })
  })
})
