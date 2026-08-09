import type { EditorStore } from '@/app/editor/active-store'
import {
  appPluginStore,
  appPluginStoreReady,
  runInstalledPluginCommand,
  runInstalledPluginExporter,
  type AppPluginHostExecutionResult,
  type AppPluginStoreSnapshot,
  type InstalledPluginCommand,
  type InstalledPluginExporter
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
  NEXTJS_EXPORTER,
  NEXTJS_EXPORTER_PLUGIN_ID,
  TAURI_REACT_EXPORTER,
  TAURI_REACT_EXPORTER_PLUGIN_ID
} from '@/app/plugins/host/ids'
import { PLUGIN_MENU_ACTION_IDS } from '@/app/shell/menu/schema'
import { toast } from '@/app/shell/ui'

interface PluginMenuStore {
  snapshot(): AppPluginStoreSnapshot
  command(pluginId: string, commandId: string): InstalledPluginCommand | null
  exporter(pluginId: string, exporterId: string): InstalledPluginExporter | null
}

export interface PluginMenuExecutionDependencies {
  store: PluginMenuStore
  ready: Promise<unknown>
  runCommand(
    editor: EditorStore,
    plugin: InstalledPluginCommand['plugin'],
    contribution: InstalledPluginCommand['contribution']
  ): Promise<AppPluginHostExecutionResult>
  runExporter(
    editor: EditorStore,
    plugin: InstalledPluginExporter['plugin'],
    contribution: InstalledPluginExporter['contribution']
  ): Promise<AppPluginHostExecutionResult>
}

interface PluginMenuNotifications {
  info(message: string): void
  warning(message: string): void
  error(message: string): void
}

export interface PluginMenuActionOptions {
  execution?: PluginMenuExecutionDependencies
  notifications?: PluginMenuNotifications
  formatError?: (message: string) => string
}

const DEFAULT_EXECUTION: PluginMenuExecutionDependencies = Object.freeze({
  store: appPluginStore,
  ready: appPluginStoreReady,
  runCommand: runInstalledPluginCommand,
  runExporter: runInstalledPluginExporter
})

function pluginUnavailableError(
  store: PluginMenuStore,
  pluginId: string,
  pluginName: string,
  contributionKind: 'command' | 'exporter'
): Error {
  const snapshot = store.snapshot()
  if (!snapshot.ready) return new Error('Plugins are still loading. Try again in a moment.')
  if (snapshot.error) return new Error(`Plugins could not be loaded: ${snapshot.error.message}`)
  const plugin = snapshot.installed.find(
    (candidate) => candidate.package.manifest.plugin.id === pluginId
  )
  if (!plugin) {
    return new Error(`${pluginName} is not installed. Install it in Settings → Plugins.`)
  }
  if (plugin.blockedReason) {
    return new Error(`${pluginName} is blocked: ${plugin.blockedReason}`)
  }
  if (!plugin.enabled) {
    return new Error(`${pluginName} is disabled. Enable it in Settings → Plugins.`)
  }
  return new Error(`${pluginName} ${contributionKind} is unavailable in the installed version.`)
}

export async function executeClipboardPluginMenuCommand(
  editor: EditorStore,
  commandId: string,
  dependencies: PluginMenuExecutionDependencies = DEFAULT_EXECUTION
): Promise<AppPluginHostExecutionResult> {
  await dependencies.ready
  const installed = dependencies.store.command(CLIPBOARD_TOOLKIT_PLUGIN_ID, commandId)
  if (!installed) {
    throw pluginUnavailableError(
      dependencies.store,
      CLIPBOARD_TOOLKIT_PLUGIN_ID,
      'Clipboard Toolkit',
      'command'
    )
  }
  return dependencies.runCommand(editor, installed.plugin, installed.contribution)
}

export async function executeTauriReactPluginMenuExporter(
  editor: EditorStore,
  dependencies: PluginMenuExecutionDependencies = DEFAULT_EXECUTION
): Promise<AppPluginHostExecutionResult> {
  return executePluginMenuExporter(
    editor,
    TAURI_REACT_EXPORTER_PLUGIN_ID,
    TAURI_REACT_EXPORTER.exporterId,
    'Tauri React Exporter',
    dependencies
  )
}

async function executePluginMenuExporter(
  editor: EditorStore,
  pluginId: string,
  exporterId: string,
  pluginName: string,
  dependencies: PluginMenuExecutionDependencies
): Promise<AppPluginHostExecutionResult> {
  await dependencies.ready
  const installed = dependencies.store.exporter(pluginId, exporterId)
  if (!installed) {
    throw pluginUnavailableError(dependencies.store, pluginId, pluginName, 'exporter')
  }
  return dependencies.runExporter(editor, installed.plugin, installed.contribution)
}

export async function executeExpoReactNativePluginMenuExporter(
  editor: EditorStore,
  dependencies: PluginMenuExecutionDependencies = DEFAULT_EXECUTION
): Promise<AppPluginHostExecutionResult> {
  return executePluginMenuExporter(
    editor,
    EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
    EXPO_REACT_NATIVE_EXPORTER.exporterId,
    'Expo React Native Exporter',
    dependencies
  )
}

export async function executeFlutterPluginMenuExporter(
  editor: EditorStore,
  dependencies: PluginMenuExecutionDependencies = DEFAULT_EXECUTION
): Promise<AppPluginHostExecutionResult> {
  return executePluginMenuExporter(
    editor,
    FLUTTER_EXPORTER_PLUGIN_ID,
    FLUTTER_EXPORTER.exporterId,
    'Flutter Exporter',
    dependencies
  )
}

export async function executeNextJsPluginMenuExporter(
  editor: EditorStore,
  dependencies: PluginMenuExecutionDependencies = DEFAULT_EXECUTION
): Promise<AppPluginHostExecutionResult> {
  return executePluginMenuExporter(
    editor,
    NEXTJS_EXPORTER_PLUGIN_ID,
    NEXTJS_EXPORTER.exporterId,
    'Next.js Exporter',
    dependencies
  )
}

export async function executeCapacitorPluginMenuExporter(
  editor: EditorStore,
  dependencies: PluginMenuExecutionDependencies = DEFAULT_EXECUTION
): Promise<AppPluginHostExecutionResult> {
  return executePluginMenuExporter(
    editor,
    CAPACITOR_EXPORTER_PLUGIN_ID,
    CAPACITOR_EXPORTER.exporterId,
    'Capacitor Exporter',
    dependencies
  )
}

export async function executeElectronPluginMenuExporter(
  editor: EditorStore,
  dependencies: PluginMenuExecutionDependencies = DEFAULT_EXECUTION
): Promise<AppPluginHostExecutionResult> {
  return executePluginMenuExporter(
    editor,
    ELECTRON_EXPORTER_PLUGIN_ID,
    ELECTRON_EXPORTER.exporterId,
    'Electron Exporter',
    dependencies
  )
}

async function reportPluginMenuResult(
  operation: Promise<AppPluginHostExecutionResult>,
  notifications: PluginMenuNotifications,
  formatError: (message: string) => string
): Promise<void> {
  try {
    const result = await operation
    if (result.status === 'completed') notifications.info(result.message)
    else notifications.warning(result.message)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    notifications.error(formatError(message))
  }
}

export function createPluginMenuActions(
  editor: EditorStore,
  options: PluginMenuActionOptions = {}
) {
  const execution = options.execution ?? DEFAULT_EXECUTION
  const notifications = options.notifications ?? toast
  const formatError = options.formatError ?? ((message: string) => message)
  const command = (commandId: string) => () =>
    reportPluginMenuResult(
      executeClipboardPluginMenuCommand(editor, commandId, execution),
      notifications,
      formatError
    )

  return {
    [PLUGIN_MENU_ACTION_IDS.clipboardText]: command(CLIPBOARD_COMMANDS.text.commandId),
    [PLUGIN_MENU_ACTION_IDS.clipboardSvg]: command(CLIPBOARD_COMMANDS.svg.commandId),
    [PLUGIN_MENU_ACTION_IDS.clipboardJsx]: command(CLIPBOARD_COMMANDS.jsx.commandId),
    [PLUGIN_MENU_ACTION_IDS.clipboardPng]: command(CLIPBOARD_COMMANDS.png.commandId),
    [PLUGIN_MENU_ACTION_IDS.exportTauriReact]: () =>
      reportPluginMenuResult(
        executeTauriReactPluginMenuExporter(editor, execution),
        notifications,
        formatError
      ),
    [PLUGIN_MENU_ACTION_IDS.exportExpoReactNative]: () =>
      reportPluginMenuResult(
        executeExpoReactNativePluginMenuExporter(editor, execution),
        notifications,
        formatError
      ),
    [PLUGIN_MENU_ACTION_IDS.exportFlutter]: () =>
      reportPluginMenuResult(
        executeFlutterPluginMenuExporter(editor, execution),
        notifications,
        formatError
      ),
    [PLUGIN_MENU_ACTION_IDS.exportNextJs]: () =>
      reportPluginMenuResult(
        executeNextJsPluginMenuExporter(editor, execution),
        notifications,
        formatError
      ),
    [PLUGIN_MENU_ACTION_IDS.exportCapacitor]: () =>
      reportPluginMenuResult(
        executeCapacitorPluginMenuExporter(editor, execution),
        notifications,
        formatError
      ),
    [PLUGIN_MENU_ACTION_IDS.exportElectron]: () =>
      reportPluginMenuResult(
        executeElectronPluginMenuExporter(editor, execution),
        notifications,
        formatError
      )
  }
}
