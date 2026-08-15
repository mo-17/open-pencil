import {
  ACCORDION_MODULE_DEFINITION,
  ACCORDION_PLUGIN,
  AUDIO_PLAYER_MODULE_DEFINITION,
  AUDIO_PLAYER_PLUGIN,
  CAROUSEL_MODULE_DEFINITION,
  CAROUSEL_PLUGIN,
  CHART_MODULE_DEFINITION,
  CHART_PLUGIN,
  CODE_BLOCK_MODULE_DEFINITION,
  CODE_BLOCK_PLUGIN,
  DATA_GRID_MODULE_DEFINITION,
  DATA_GRID_PLUGIN,
  DROPDOWN_MENU_MODULE_DEFINITION,
  DROPDOWN_MENU_PLUGIN,
  HTML_MODULE_DEFINITION,
  HTML_PLUGIN,
  MAP_MODULE_DEFINITION,
  MAP_PLUGIN,
  MARKDOWN_MODULE_DEFINITION,
  MARKDOWN_PLUGIN,
  MODAL_MODULE_DEFINITION,
  MODAL_PLUGIN,
  LOTTIE_MODULE_DEFINITION,
  LOTTIE_PLUGIN,
  PDF_VIEWER_MODULE_DEFINITION,
  PDF_VIEWER_PLUGIN,
  QR_BARCODE_MODULE_DEFINITION,
  QR_BARCODE_PLUGIN,
  RICH_TEXT_MODULE_DEFINITION,
  RICH_TEXT_PLUGIN,
  SLIDE_MENU_MODULE_DEFINITION,
  SLIDE_MENU_PLUGIN,
  TABLE_MODULE_DEFINITION,
  TABLE_PLUGIN,
  TABS_MODULE_DEFINITION,
  TABS_PLUGIN,
  UPLOAD_BUTTON_MODULE_DEFINITION,
  UPLOAD_BUTTON_PLUGIN,
  VIDEO_MODULE_DEFINITION,
  VIDEO_PLUGIN,
  type ModuleDefinition,
  type PluginDefinition
} from '@open-pencil/core/plugins'
import {
  type DeclarativeCommandContributionV1,
  type DeclarativeCommandContributionV2,
  type DeclarativeExporterContributionV1,
  type DeclarativeExporterContributionV2,
  type PluginContributionDataContractV2,
  type PluginConnectorContractV1,
  type PluginManifestPayloadV1,
  type PluginManifestPayloadV2,
  type PluginObjectParameterSchemaV2,
  type PluginStorageProviderContributionV2
} from '@open-pencil/plugin-contracts'

import {
  GOOGLE_DRIVE_STORAGE_ADAPTER_ID,
  GOOGLE_DRIVE_STORAGE_PLUGIN_ID,
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID
} from '@/app/integrations/storage/google-drive/config'

import {
  AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
  AIRTABLE_RECORDS_PLUGIN_ID
} from './connectors/airtable-records'
import { RESEND_EMAIL_CONNECTOR_CONTRACT, RESEND_EMAIL_PLUGIN_ID } from './connectors/resend-email'
import { REVIEWED_EXTERNAL_SERVICE_CATALOG } from './connectors/services'
import {
  STRIPE_BILLING_CONNECTOR_CONTRACT,
  STRIPE_BILLING_PLUGIN_ID
} from './connectors/stripe-billing'
import {
  SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
  SUPABASE_BUSINESS_PLUGIN_ID
} from './connectors/supabase-business'
import {
  SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
  SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID
} from './connectors/supabase-schema-inspector'
import { APPLICATION_SECURITY_READINESS_HOST_CONTRACT } from './host/application-security-readiness'
import { REVIEWED_DEPLOYMENT_PLUGINS } from './host/deployment/contract'
import {
  ACCESSIBILITY_AUDIT_COMMAND,
  ACCESSIBILITY_AUDIT_PLUGIN_ID,
  AI_POPOUT_COMMAND,
  AI_POPOUT_PLUGIN_ID,
  CAPACITOR_EXPORTER,
  CAPACITOR_EXPORTER_PLUGIN_ID,
  CLIPBOARD_COMMANDS,
  CLIPBOARD_TOOLKIT_PLUGIN_ID,
  COMPILER_PREVIEW_POPOUT_COMMAND,
  COMPILER_PREVIEW_POPOUT_PLUGIN_ID,
  DESIGN_TOKENS_EXPORTER,
  DESIGN_TOKENS_EXPORTER_PLUGIN_ID,
  DESIGN_SYSTEM_AUDIT_COMMAND,
  DESIGN_SYSTEM_AUDIT_PLUGIN_ID,
  ELECTRON_EXPORTER,
  ELECTRON_EXPORTER_PLUGIN_ID,
  EXPO_REACT_NATIVE_EXPORTER,
  EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
  FLUTTER_EXPORTER,
  FLUTTER_EXPORTER_PLUGIN_ID,
  FIGMA_PROJECTION_EXPORTER,
  FIGMA_PROJECTION_EXPORTER_PLUGIN_ID,
  GOOGLE_DRIVE_STORAGE_CAPABILITIES,
  GOOGLE_DRIVE_STORAGE_CONFIG_VERSION,
  NEXTJS_EXPORTER,
  NEXTJS_EXPORTER_PLUGIN_ID,
  TAURI_REACT_EXPORTER,
  TAURI_REACT_EXPORTER_PLUGIN_ID,
  VUE_EXPORTER,
  VUE_EXPORTER_PLUGIN_ID
} from './host/ids'
import type { AppPluginCatalogEntry } from './types'

const APP_BUNDLE_PUBLISHER = Object.freeze({
  id: 'open-pencil',
  name: 'OpenPencil',
  keyId: 'app-bundle-v1'
})

const NON_NEGATIVE_INTEGER_SCHEMA = Object.freeze({ type: 'integer' as const, minimum: 0 })
const BOOLEAN_SCHEMA = Object.freeze({ type: 'boolean' as const })

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
    connectors?: readonly PluginConnectorContractV1[]
    storageProviders?: readonly PluginStorageProviderContributionV2[]
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
        : {}),
      ...(contributions.connectors
        ? { connectors: contributions.connectors.map((value) => structuredClone(value)) }
        : {}),
      ...(contributions.storageProviders
        ? {
            storageProviders: contributions.storageProviders.map((value) => structuredClone(value))
          }
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
      errorCount: NON_NEGATIVE_INTEGER_SCHEMA,
      warningCount: NON_NEGATIVE_INTEGER_SCHEMA,
      infoCount: NON_NEGATIVE_INTEGER_SCHEMA,
      issueCount: NON_NEGATIVE_INTEGER_SCHEMA,
      truncated: BOOLEAN_SCHEMA,
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

const DESIGN_SYSTEM_ISSUE_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    category: Object.freeze({
      type: 'string',
      enum: Object.freeze(['tokens', 'components', 'spacing', 'typography'])
    }),
    code: Object.freeze({ type: 'string', minLength: 1, maxLength: 96 }),
    severity: Object.freeze({ type: 'string', enum: Object.freeze(['warning', 'info']) }),
    message: Object.freeze({ type: 'string', maxLength: 800 }),
    nodeId: Object.freeze({ type: 'string', maxLength: 256 }),
    nodeName: Object.freeze({ type: 'string', maxLength: 256 })
  }),
  required: Object.freeze(['category', 'code', 'severity', 'message']),
  additionalProperties: false,
  minProperties: 4,
  maxProperties: 6
})

const DESIGN_SYSTEM_SUMMARY_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    visitedNodeCount: Object.freeze({ type: 'integer', minimum: 0 }),
    variableCount: Object.freeze({ type: 'integer', minimum: 0 }),
    collectionCount: Object.freeze({ type: 'integer', minimum: 0 }),
    componentSetCount: Object.freeze({ type: 'integer', minimum: 0 }),
    spacingValueCount: Object.freeze({ type: 'integer', minimum: 0 }),
    fontFamilyCount: Object.freeze({ type: 'integer', minimum: 0 }),
    fontSizeCount: Object.freeze({ type: 'integer', minimum: 0 }),
    textStyleCount: Object.freeze({ type: 'integer', minimum: 0 })
  }),
  required: Object.freeze([
    'visitedNodeCount',
    'variableCount',
    'collectionCount',
    'componentSetCount',
    'spacingValueCount',
    'fontFamilyCount',
    'fontSizeCount',
    'textStyleCount'
  ]),
  additionalProperties: false,
  minProperties: 8,
  maxProperties: 8
})

const DESIGN_SYSTEM_RESULT_CONTRACT: PluginContributionDataContractV2 = Object.freeze({
  schema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      kind: Object.freeze({ type: 'string', enum: Object.freeze(['static-design-system-audit']) }),
      scope: Object.freeze({ type: 'string', enum: Object.freeze(['document']) }),
      pluginId: Object.freeze({
        type: 'string',
        enum: Object.freeze([DESIGN_SYSTEM_AUDIT_PLUGIN_ID])
      }),
      commandId: Object.freeze({
        type: 'string',
        enum: Object.freeze([DESIGN_SYSTEM_AUDIT_COMMAND.commandId])
      }),
      warningCount: NON_NEGATIVE_INTEGER_SCHEMA,
      infoCount: NON_NEGATIVE_INTEGER_SCHEMA,
      issueCount: NON_NEGATIVE_INTEGER_SCHEMA,
      truncated: BOOLEAN_SCHEMA,
      summary: DESIGN_SYSTEM_SUMMARY_SCHEMA,
      issues: Object.freeze({
        type: 'array',
        items: DESIGN_SYSTEM_ISSUE_SCHEMA,
        maxItems: 1_000
      }),
      notEvaluated: Object.freeze({
        type: 'array',
        items: Object.freeze({ type: 'string', maxLength: 1_000 }),
        maxItems: 8
      })
    }),
    required: Object.freeze([
      'kind',
      'scope',
      'pluginId',
      'commandId',
      'warningCount',
      'infoCount',
      'issueCount',
      'truncated',
      'summary',
      'issues',
      'notEvaluated'
    ]),
    additionalProperties: false,
    minProperties: 11,
    maxProperties: 11
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

function additionalWebSourceExporterManifest(
  plugin: BundledPluginIdentity,
  exporter: DeclarativeExporterContributionV1
): PluginManifestPayloadV1 {
  return bundledUtilityManifest(plugin, { exporters: [exporter] })
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

function designSystemAuditManifest(): PluginManifestPayloadV2 {
  return bundledUtilityManifestV2(
    {
      id: DESIGN_SYSTEM_AUDIT_PLUGIN_ID,
      name: 'Static Design System Audit',
      version: '1.0.0'
    },
    {
      commands: [
        {
          ...DESIGN_SYSTEM_AUDIT_COMMAND,
          name: 'Run static design-system audit',
          description:
            'Inspect token, component-variant, spacing, and typography consistency with bounded static checks.',
          parameters: EMPTY_DATA_CONTRACT,
          result: DESIGN_SYSTEM_RESULT_CONTRACT
        }
      ]
    }
  )
}

function applicationSecurityReadinessManifest(): PluginManifestPayloadV2 {
  return bundledUtilityManifestV2(
    {
      id: APPLICATION_SECURITY_READINESS_HOST_CONTRACT.pluginId,
      name: 'Application Security Readiness',
      version: '1.0.0'
    },
    {
      commands: [
        {
          ...APPLICATION_SECURITY_READINESS_HOST_CONTRACT.command,
          name: 'Run application security readiness audit',
          description:
            'Run a bounded, local, static production-readiness review without returning document content or secrets.'
        }
      ]
    }
  )
}

function compilerPreviewPopoutManifest(): PluginManifestPayloadV2 {
  return bundledUtilityManifestV2(
    {
      id: COMPILER_PREVIEW_POPOUT_PLUGIN_ID,
      name: 'Compiler Preview Popout',
      version: '1.0.0'
    },
    {
      commands: [
        {
          ...COMPILER_PREVIEW_POPOUT_COMMAND,
          name: 'Open compiler preview window',
          description:
            'Ask the trusted host to open the active compiler preview in a separate window.',
          parameters: EMPTY_DATA_CONTRACT,
          result: EMPTY_DATA_CONTRACT
        }
      ]
    }
  )
}

function aiPopoutManifest(): PluginManifestPayloadV2 {
  return bundledUtilityManifestV2(
    {
      id: AI_POPOUT_PLUGIN_ID,
      name: 'AI Popout',
      version: '1.0.0'
    },
    {
      commands: [
        {
          ...AI_POPOUT_COMMAND,
          name: 'Open AI window',
          description: 'Ask the trusted host to open the active AI chat in a separate window.',
          parameters: EMPTY_DATA_CONTRACT,
          result: EMPTY_DATA_CONTRACT
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

function bundledConnectorManifest(
  plugin: BundledPluginIdentity,
  connector: PluginConnectorContractV1
): PluginManifestPayloadV2 {
  return bundledUtilityManifestV2(plugin, { connectors: [connector] })
}

function googleDriveStorageManifest(): PluginManifestPayloadV2 {
  return bundledUtilityManifestV2(
    {
      id: GOOGLE_DRIVE_STORAGE_PLUGIN_ID,
      name: 'Google Drive Storage',
      version: '1.0.0'
    },
    {
      storageProviders: [
        {
          providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
          name: 'Google Drive',
          description: 'Store private OpenPencil documents in the connected Google Drive account.',
          adapterId: GOOGLE_DRIVE_STORAGE_ADAPTER_ID,
          configVersion: GOOGLE_DRIVE_STORAGE_CONFIG_VERSION,
          capabilities: GOOGLE_DRIVE_STORAGE_CAPABILITIES
        }
      ]
    }
  )
}

function deploymentPlanManifest(
  definition: (typeof REVIEWED_DEPLOYMENT_PLUGINS)[number]
): PluginManifestPayloadV2 {
  return bundledUtilityManifestV2(
    {
      id: definition.pluginId,
      name: definition.name,
      version: '1.0.0'
    },
    { commands: [definition.mcpSafePlan] }
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
      manifest: bundledModuleManifest(
        DROPDOWN_MENU_PLUGIN,
        DROPDOWN_MENU_MODULE_DEFINITION,
        'open-pencil.dropdown-menu'
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(
        UPLOAD_BUTTON_PLUGIN,
        UPLOAD_BUTTON_MODULE_DEFINITION,
        'open-pencil.upload-button'
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(MODAL_PLUGIN, MODAL_MODULE_DEFINITION, 'open-pencil.modal')
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
      manifest: bundledModuleManifest(TABS_PLUGIN, TABS_MODULE_DEFINITION, 'open-pencil.tabs')
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(
        ACCORDION_PLUGIN,
        ACCORDION_MODULE_DEFINITION,
        'open-pencil.accordion'
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(
        QR_BARCODE_PLUGIN,
        QR_BARCODE_MODULE_DEFINITION,
        'open-pencil.qr-barcode'
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(
        MARKDOWN_PLUGIN,
        MARKDOWN_MODULE_DEFINITION,
        'open-pencil.markdown'
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(
        CODE_BLOCK_PLUGIN,
        CODE_BLOCK_MODULE_DEFINITION,
        'open-pencil.code-block'
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(
        PDF_VIEWER_PLUGIN,
        PDF_VIEWER_MODULE_DEFINITION,
        'open-pencil.pdf-viewer'
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledModuleManifest(
        AUDIO_PLAYER_PLUGIN,
        AUDIO_PLAYER_MODULE_DEFINITION,
        'open-pencil.audio-player'
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
      manifest: designSystemAuditManifest()
    },
    {
      trustSource: 'app-bundle',
      manifest: applicationSecurityReadinessManifest()
    },
    {
      trustSource: 'app-bundle',
      manifest: compilerPreviewPopoutManifest(),
      installedByDefault: true,
      enabledByDefault: true
    },
    {
      trustSource: 'app-bundle',
      manifest: aiPopoutManifest(),
      installedByDefault: true,
      enabledByDefault: true
    },
    {
      trustSource: 'app-bundle',
      manifest: designTokensExporterManifest()
    },
    {
      trustSource: 'app-bundle',
      manifest: figmaProjectionExporterManifest()
    },
    {
      trustSource: 'app-bundle',
      manifest: additionalWebSourceExporterManifest(
        { id: NEXTJS_EXPORTER_PLUGIN_ID, name: 'Next.js Exporter', version: '1.0.0' },
        {
          ...NEXTJS_EXPORTER,
          name: 'Export Next.js source',
          description: 'Package the current document as a Next.js + React source project.'
        }
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: additionalWebSourceExporterManifest(
        { id: CAPACITOR_EXPORTER_PLUGIN_ID, name: 'Capacitor Exporter', version: '1.0.0' },
        {
          ...CAPACITOR_EXPORTER,
          name: 'Export Capacitor source',
          description: 'Package the current document as a Capacitor + React source project.'
        }
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: additionalWebSourceExporterManifest(
        { id: ELECTRON_EXPORTER_PLUGIN_ID, name: 'Electron Exporter', version: '1.0.0' },
        {
          ...ELECTRON_EXPORTER,
          name: 'Export Electron source',
          description: 'Package the current document as an Electron + React source project.'
        }
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: additionalWebSourceExporterManifest(
        { id: VUE_EXPORTER_PLUGIN_ID, name: 'Vue Exporter', version: '1.0.0' },
        {
          ...VUE_EXPORTER,
          name: 'Export Vue source',
          description: 'Package the current document as a Vite + Vue 3 source project.'
        }
      ),
      installedByDefault: false,
      enabledByDefault: false
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledConnectorManifest(
        {
          id: SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID,
          name: 'Supabase Schema Inspector',
          version: '1.0.0'
        },
        SUPABASE_SCHEMA_INSPECTOR_CONTRACT
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledConnectorManifest(
        { id: AIRTABLE_RECORDS_PLUGIN_ID, name: 'Airtable Records', version: '1.0.0' },
        AIRTABLE_RECORDS_CONNECTOR_CONTRACT
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledConnectorManifest(
        {
          id: SUPABASE_BUSINESS_PLUGIN_ID,
          name: 'Supabase Tables',
          version: '1.0.0'
        },
        SUPABASE_BUSINESS_CONNECTOR_CONTRACT
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledConnectorManifest(
        {
          id: STRIPE_BILLING_PLUGIN_ID,
          name: 'Stripe Checkout & Billing',
          version: '1.0.0'
        },
        STRIPE_BILLING_CONNECTOR_CONTRACT
      )
    },
    {
      trustSource: 'app-bundle',
      manifest: bundledConnectorManifest(
        { id: RESEND_EMAIL_PLUGIN_ID, name: 'Resend Email', version: '1.0.0' },
        RESEND_EMAIL_CONNECTOR_CONTRACT
      )
    },
    ...REVIEWED_EXTERNAL_SERVICE_CATALOG.map((descriptor) => ({
      trustSource: 'app-bundle' as const,
      manifest: bundledConnectorManifest(
        {
          id: descriptor.connector.contract.pluginId,
          name: descriptor.connector.contract.name,
          version: '1.0.0'
        },
        descriptor.connector.contract
      ),
      installedByDefault: descriptor.defaultInstalled,
      enabledByDefault: false
    })),
    ...REVIEWED_DEPLOYMENT_PLUGINS.map((definition) => ({
      trustSource: 'app-bundle' as const,
      manifest: deploymentPlanManifest(definition),
      installedByDefault: definition.installation.installedByDefault,
      enabledByDefault: definition.installation.enabledByDefault
    })),
    {
      trustSource: 'app-bundle',
      manifest: googleDriveStorageManifest(),
      installedByDefault: true,
      enabledByDefault: true
    }
  ])
}
