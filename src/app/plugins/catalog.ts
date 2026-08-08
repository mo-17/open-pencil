import {
  CHART_MODULE_DEFINITION,
  CHART_PLUGIN,
  HTML_MODULE_DEFINITION,
  HTML_PLUGIN,
  MAP_MODULE_DEFINITION,
  MAP_PLUGIN,
  RICH_TEXT_MODULE_DEFINITION,
  RICH_TEXT_PLUGIN,
  SLIDE_MENU_MODULE_DEFINITION,
  SLIDE_MENU_PLUGIN,
  TABLE_MODULE_DEFINITION,
  TABLE_PLUGIN,
  VIDEO_MODULE_DEFINITION,
  VIDEO_PLUGIN,
  type DeclarativeCommandContributionV1,
  type DeclarativeExporterContributionV1,
  type ModuleDefinition,
  type PluginDefinition,
  type PluginManifestPayloadV1
} from '@open-pencil/core/plugins'

import {
  CLIPBOARD_COMMANDS,
  CLIPBOARD_TOOLKIT_PLUGIN_ID,
  EXPO_REACT_NATIVE_EXPORTER,
  EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
  FLUTTER_EXPORTER,
  FLUTTER_EXPORTER_PLUGIN_ID,
  TAURI_REACT_EXPORTER,
  TAURI_REACT_EXPORTER_PLUGIN_ID
} from './host/ids'
import type { AppPluginCatalogEntry } from './types'

const APP_BUNDLE_PUBLISHER = Object.freeze({
  id: 'open-pencil',
  name: 'OpenPencil',
  keyId: 'app-bundle-v1'
})

function declarativeModule(definition: ModuleDefinition, adapterId: string) {
  return {
    moduleType: definition.moduleType,
    name: definition.name,
    description: definition.description,
    adapterId,
    configVersion: definition.configVersion,
    defaultSize: structuredClone(definition.defaultSize),
    defaultConfig: structuredClone(definition.defaultConfig),
    fields: definition.fields.map((field) => ({
      path: [...field.path],
      kind: field.kind,
      label: field.label,
      ...(field.min === undefined ? {} : { min: field.min }),
      ...(field.max === undefined ? {} : { max: field.max }),
      ...(field.step === undefined ? {} : { step: field.step }),
      ...(field.options === undefined ? {} : { options: [...field.options] })
    }))
  }
}

function bundledModuleManifest(
  plugin: PluginDefinition,
  definition: ModuleDefinition,
  adapterId: string
): PluginManifestPayloadV1 {
  return {
    format: 'openpencil-plugin',
    schemaVersion: 1,
    plugin: { id: plugin.id, name: plugin.name, version: plugin.version },
    publisher: { ...APP_BUNDLE_PUBLISHER },
    engineRange: '*',
    capabilities: [],
    contributions: { modules: [declarativeModule(definition, adapterId)] }
  }
}

function bundledUtilityManifest(
  plugin: Readonly<{ id: string; name: string; version: string }>,
  contributions: Readonly<{
    commands?: readonly DeclarativeCommandContributionV1[]
    exporters?: readonly DeclarativeExporterContributionV1[]
  }>
): PluginManifestPayloadV1 {
  return {
    format: 'openpencil-plugin',
    schemaVersion: 1,
    plugin: { ...plugin },
    publisher: { ...APP_BUNDLE_PUBLISHER },
    engineRange: '*',
    capabilities: [],
    contributions: {
      modules: [],
      ...(contributions.commands
        ? { commands: contributions.commands.map((value) => ({ ...value })) }
        : {}),
      ...(contributions.exporters
        ? { exporters: contributions.exporters.map((value) => ({ ...value })) }
        : {})
    }
  }
}

function clipboardToolkitManifest(): PluginManifestPayloadV1 {
  return bundledUtilityManifest(
    { id: CLIPBOARD_TOOLKIT_PLUGIN_ID, name: 'Clipboard Toolkit', version: '1.0.0' },
    {
      commands: [
        {
          ...CLIPBOARD_COMMANDS.text,
          name: 'Copy as text',
          description: 'Copy the selected layer text to the system clipboard.'
        },
        {
          ...CLIPBOARD_COMMANDS.svg,
          name: 'Copy as SVG',
          description: 'Copy the selected vector content as SVG source.'
        },
        {
          ...CLIPBOARD_COMMANDS.jsx,
          name: 'Copy as JSX',
          description: 'Copy the selected design as OpenPencil JSX source.'
        },
        {
          ...CLIPBOARD_COMMANDS.png,
          name: 'Copy as PNG',
          description: 'Render the selection at 2x and copy it as a PNG image.'
        }
      ]
    }
  )
}

function tauriReactExporterManifest(): PluginManifestPayloadV1 {
  return bundledUtilityManifest(
    {
      id: TAURI_REACT_EXPORTER_PLUGIN_ID,
      name: 'Tauri React Exporter',
      version: '1.0.0'
    },
    {
      exporters: [
        {
          ...TAURI_REACT_EXPORTER,
          name: 'Export Tauri React source',
          description: 'Package the current document as a Tauri 2 + React source project.'
        }
      ]
    }
  )
}

function expoReactNativeExporterManifest(): PluginManifestPayloadV1 {
  return bundledUtilityManifest(
    {
      id: EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
      name: 'Expo React Native Exporter',
      version: '1.0.0'
    },
    {
      exporters: [
        {
          ...EXPO_REACT_NATIVE_EXPORTER,
          name: 'Export Expo React Native source',
          description: 'Package the current document as an Expo React Native source project.'
        }
      ]
    }
  )
}

function flutterExporterManifest(): PluginManifestPayloadV1 {
  return bundledUtilityManifest(
    {
      id: FLUTTER_EXPORTER_PLUGIN_ID,
      name: 'Flutter Exporter',
      version: '1.0.0'
    },
    {
      exporters: [
        {
          ...FLUTTER_EXPORTER,
          name: 'Export Flutter source',
          description: 'Package the current document as a Flutter source project.'
        }
      ]
    }
  )
}

export function createBundledPluginCatalog(): readonly AppPluginCatalogEntry[] {
  return Object.freeze([
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(MAP_PLUGIN, MAP_MODULE_DEFINITION, 'open-pencil.map'),
      installedByDefault: true,
      enabledByDefault: true
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(CHART_PLUGIN, CHART_MODULE_DEFINITION, 'open-pencil.chart')
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(
        RICH_TEXT_PLUGIN,
        RICH_TEXT_MODULE_DEFINITION,
        'open-pencil.rich-text'
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(HTML_PLUGIN, HTML_MODULE_DEFINITION, 'open-pencil.html')
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(VIDEO_PLUGIN, VIDEO_MODULE_DEFINITION, 'open-pencil.video')
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(TABLE_PLUGIN, TABLE_MODULE_DEFINITION, 'open-pencil.table')
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(
        SLIDE_MENU_PLUGIN,
        SLIDE_MENU_MODULE_DEFINITION,
        'open-pencil.slide-menu'
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: clipboardToolkitManifest()
    },
    {
      trustSource: 'app-bundle',
      manifest: tauriReactExporterManifest()
    },
    {
      trustSource: 'app-bundle',
      manifest: expoReactNativeExporterManifest()
    },
    {
      trustSource: 'app-bundle',
      manifest: flutterExporterManifest()
    }
  ])
}
