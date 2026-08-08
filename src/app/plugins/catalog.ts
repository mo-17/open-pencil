import {
  CAROUSEL_MODULE_DEFINITION,
  CAROUSEL_PLUGIN,
  CHART_MODULE_DEFINITION,
  CHART_PLUGIN,
  DATA_GRID_MODULE_DEFINITION,
  DATA_GRID_PLUGIN,
  HTML_MODULE_DEFINITION,
  HTML_PLUGIN,
  MAP_MODULE_DEFINITION,
  MAP_PLUGIN,
  LOTTIE_MODULE_DEFINITION,
  LOTTIE_PLUGIN,
  RICH_TEXT_MODULE_DEFINITION,
  RICH_TEXT_PLUGIN,
  SLIDE_MENU_MODULE_DEFINITION,
  SLIDE_MENU_PLUGIN,
  TABLE_MODULE_DEFINITION,
  TABLE_PLUGIN,
  VIDEO_MODULE_DEFINITION,
  VIDEO_PLUGIN,
  type DeclarativeCommandContributionV1,
  type DeclarativeCommandContributionV2,
  type DeclarativeExporterContributionV1,
  type DeclarativeExporterContributionV2,
  type ModuleDefinition,
  type PluginDefinition,
  type PluginContributionDataContractV2,
  type PluginManifestPayloadV1,
  type PluginManifestPayloadV2,
  type PluginObjectParameterSchemaV2
} from '@open-pencil/core/plugins'

import {
  ACCESSIBILITY_AUDIT_COMMAND,
  ACCESSIBILITY_AUDIT_PLUGIN_ID,
  CLIPBOARD_COMMANDS,
  CLIPBOARD_TOOLKIT_PLUGIN_ID,
  DESIGN_TOKENS_EXPORTER,
  DESIGN_TOKENS_EXPORTER_PLUGIN_ID,
  EXPO_REACT_NATIVE_EXPORTER,
  EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
  FLUTTER_EXPORTER,
  FLUTTER_EXPORTER_PLUGIN_ID,
  FIGMA_PROJECTION_EXPORTER,
  FIGMA_PROJECTION_EXPORTER_PLUGIN_ID,
  TAURI_REACT_EXPORTER,
  TAURI_REACT_EXPORTER_PLUGIN_ID
} from './host/ids'
import type { AppPluginCatalogEntry } from './types'

const APP_BUNDLE_PUBLISHER = Object.freeze({
  id: 'open-pencil',
  name: 'OpenPencil',
  keyId: 'app-bundle-v1'
})

type BundledPluginIdentity = Readonly<{ id: string; name: string; version: string }>

function bundledManifestHeader<SchemaVersion extends 1 | 2>(
  plugin: BundledPluginIdentity,
  schemaVersion: SchemaVersion
) {
  return {
    format: 'openpencil-plugin' as const,
    schemaVersion,
    plugin: { id: plugin.id, name: plugin.name, version: plugin.version },
    publisher: { ...APP_BUNDLE_PUBLISHER },
    engineRange: '*' as const,
    capabilities: [] as const
  }
}

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
    ...bundledManifestHeader(plugin, 1),
    contributions: { modules: [declarativeModule(definition, adapterId)] }
  }
}

function bundledUtilityManifest(
  plugin: BundledPluginIdentity,
  contributions: Readonly<{
    commands?: readonly DeclarativeCommandContributionV1[]
    exporters?: readonly DeclarativeExporterContributionV1[]
  }>
): PluginManifestPayloadV1 {
  return {
    ...bundledManifestHeader(plugin, 1),
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

function bundledUtilityManifestV2(
  plugin: BundledPluginIdentity,
  contributions: Readonly<{
    commands?: readonly DeclarativeCommandContributionV2[]
    exporters?: readonly DeclarativeExporterContributionV2[]
  }>
): PluginManifestPayloadV2 {
  return {
    ...bundledManifestHeader(plugin, 2),
    contributions: {
      modules: [],
      ...(contributions.commands
        ? { commands: contributions.commands.map((value) => structuredClone(value)) }
        : {}),
      ...(contributions.exporters
        ? { exporters: contributions.exporters.map((value) => structuredClone(value)) }
        : {})
    }
  }
}

const EMPTY_OBJECT_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({}),
  additionalProperties: false,
  maxProperties: 0
})

const EMPTY_DATA_CONTRACT: PluginContributionDataContractV2 = Object.freeze({
  schema: EMPTY_OBJECT_SCHEMA,
  maxBytes: 2
})

const ACCESSIBILITY_ISSUE_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    ruleId: Object.freeze({ type: 'string', minLength: 1, maxLength: 128 }),
    severity: Object.freeze({ type: 'string', enum: Object.freeze(['error', 'warning', 'info']) }),
    message: Object.freeze({ type: 'string', maxLength: 1_000 }),
    nodeId: Object.freeze({ type: 'string', maxLength: 256 }),
    nodeName: Object.freeze({ type: 'string', maxLength: 256 }),
    nodePath: Object.freeze({
      type: 'array',
      items: Object.freeze({ type: 'string', maxLength: 256 }),
      maxItems: 32
    }),
    suggestion: Object.freeze({ type: 'string', maxLength: 1_000 })
  }),
  required: Object.freeze(['ruleId', 'severity', 'message', 'nodeId', 'nodeName', 'nodePath']),
  additionalProperties: false,
  minProperties: 6,
  maxProperties: 7
})

const ACCESSIBILITY_RESULT_CONTRACT: PluginContributionDataContractV2 = Object.freeze({
  schema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      kind: Object.freeze({ type: 'string', enum: Object.freeze(['static-accessibility-audit']) }),
      scope: Object.freeze({ type: 'string', enum: Object.freeze(['document']) }),
      errorCount: Object.freeze({ type: 'integer', minimum: 0 }),
      warningCount: Object.freeze({ type: 'integer', minimum: 0 }),
      infoCount: Object.freeze({ type: 'integer', minimum: 0 }),
      issueCount: Object.freeze({ type: 'integer', minimum: 0 }),
      truncated: Object.freeze({ type: 'boolean' }),
      issues: Object.freeze({
        type: 'array',
        items: ACCESSIBILITY_ISSUE_SCHEMA,
        maxItems: 2_000
      }),
      notEvaluated: Object.freeze({
        type: 'array',
        items: Object.freeze({ type: 'string', maxLength: 1_000 }),
        maxItems: 16
      })
    }),
    required: Object.freeze([
      'kind',
      'scope',
      'errorCount',
      'warningCount',
      'infoCount',
      'issueCount',
      'truncated',
      'issues',
      'notEvaluated'
    ]),
    additionalProperties: false,
    minProperties: 9,
    maxProperties: 9
  }),
  maxBytes: 512 * 1024
})

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

function accessibilityAuditManifest(): PluginManifestPayloadV2 {
  return bundledUtilityManifestV2(
    {
      id: ACCESSIBILITY_AUDIT_PLUGIN_ID,
      name: 'Static Accessibility Audit',
      version: '1.0.0'
    },
    {
      commands: [
        {
          ...ACCESSIBILITY_AUDIT_COMMAND,
          name: 'Run static accessibility audit',
          description:
            'Inspect the current document with OpenPencil static accessibility rules and return a bounded report.',
          parameters: EMPTY_DATA_CONTRACT,
          result: ACCESSIBILITY_RESULT_CONTRACT
        }
      ]
    }
  )
}

function designTokensExporterManifest(): PluginManifestPayloadV2 {
  return bundledUtilityManifestV2(
    {
      id: DESIGN_TOKENS_EXPORTER_PLUGIN_ID,
      name: 'Design Tokens Exporter',
      version: '1.0.0'
    },
    {
      exporters: [
        {
          ...DESIGN_TOKENS_EXPORTER,
          name: 'Export design tokens JSON',
          description:
            'Export published variables, modes, types, descriptions, and aliases as deterministic JSON.',
          parameters: EMPTY_DATA_CONTRACT,
          result: EMPTY_DATA_CONTRACT
        }
      ]
    }
  )
}

function figmaProjectionExporterManifest(): PluginManifestPayloadV2 {
  return bundledUtilityManifestV2(
    {
      id: FIGMA_PROJECTION_EXPORTER_PLUGIN_ID,
      name: 'Figma Editable Projection Exporter',
      version: '1.0.0'
    },
    {
      exporters: [
        {
          ...FIGMA_PROJECTION_EXPORTER,
          name: 'Export Figma editable projection',
          description:
            'Create a derived .fig projection with editable native layers; OpenPencil runtime behavior is not preserved.',
          parameters: EMPTY_DATA_CONTRACT,
          result: EMPTY_DATA_CONTRACT
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
      manifest: bundledModuleManifest(LOTTIE_PLUGIN, LOTTIE_MODULE_DEFINITION, 'open-pencil.lottie')
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(
        CAROUSEL_PLUGIN,
        CAROUSEL_MODULE_DEFINITION,
        'open-pencil.carousel'
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(
        DATA_GRID_PLUGIN,
        DATA_GRID_MODULE_DEFINITION,
        'open-pencil.data-grid'
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
    },
    {
      trustSource: 'app-bundle',
      manifest: accessibilityAuditManifest()
    },
    {
      trustSource: 'app-bundle',
      manifest: designTokensExporterManifest()
    },
    {
      trustSource: 'app-bundle',
      manifest: figmaProjectionExporterManifest()
    }
  ])
}
