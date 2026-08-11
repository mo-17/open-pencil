import { describe, expect, test } from 'bun:test'

import {
  ACCORDION_MODULE_TYPE,
  ACCORDION_PLUGIN_ID,
  AUDIO_PLAYER_MODULE_TYPE,
  AUDIO_PLAYER_PLUGIN_ID,
  CAROUSEL_MODULE_TYPE,
  CAROUSEL_PLUGIN_ID,
  CHART_PLUGIN_ID,
  CODE_BLOCK_MODULE_TYPE,
  CODE_BLOCK_PLUGIN_ID,
  DATA_GRID_MODULE_TYPE,
  DATA_GRID_PLUGIN_ID,
  DROPDOWN_MENU_MODULE_TYPE,
  DROPDOWN_MENU_PLUGIN_ID,
  HTML_MODULE_TYPE,
  HTML_PLUGIN_ID,
  MAP_PLUGIN_ID,
  MARKDOWN_MODULE_TYPE,
  MARKDOWN_PLUGIN_ID,
  MODAL_MODULE_CONFIG_VERSION,
  MODAL_MODULE_DEFAULT_CONFIG,
  MODAL_MODULE_TYPE,
  MODAL_PLUGIN_ID,
  LOTTIE_MODULE_TYPE,
  LOTTIE_PLUGIN_ID,
  PDF_VIEWER_MODULE_TYPE,
  PDF_VIEWER_PLUGIN_ID,
  QR_BARCODE_MODULE_TYPE,
  QR_BARCODE_PLUGIN_ID,
  RICH_TEXT_PLUGIN_ID,
  SLIDE_MENU_MODULE_CONFIG_VERSION,
  SLIDE_MENU_MODULE_DEFAULT_CONFIG,
  SLIDE_MENU_MODULE_TYPE,
  SLIDE_MENU_PLUGIN_ID,
  TABLE_MODULE_TYPE,
  TABLE_PLUGIN_ID,
  TABS_MODULE_TYPE,
  TABS_PLUGIN_ID,
  UPLOAD_BUTTON_PLUGIN_ID,
  VIDEO_MODULE_TYPE,
  VIDEO_PLUGIN_ID
} from '@open-pencil/core/plugins'

import {
  GOOGLE_DRIVE_STORAGE_ADAPTER_ID,
  GOOGLE_DRIVE_STORAGE_PLUGIN_ID,
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID
} from '@/app/integrations/storage/google-drive/config'
import {
  AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
  AIRTABLE_RECORDS_CONNECTOR_ID,
  AIRTABLE_RECORDS_PLUGIN_ID,
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  REVIEWED_EXTERNAL_SERVICE_CATALOG,
  RESEND_EMAIL_CONNECTOR_CONTRACT,
  RESEND_EMAIL_CONNECTOR_ID,
  RESEND_EMAIL_PLUGIN_ID,
  STRIPE_BILLING_CONNECTOR_CONTRACT,
  STRIPE_BILLING_CONNECTOR_ID,
  STRIPE_BILLING_PLUGIN_ID,
  SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
  SUPABASE_BUSINESS_CONNECTOR_ID,
  SUPABASE_BUSINESS_PLUGIN_ID,
  SUPABASE_SCHEMA_INSPECTOR_CONNECTOR_ID,
  SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
  SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID
} from '@/app/plugins'
import { APPLICATION_SECURITY_READINESS_PLUGIN_ID } from '@/app/plugins/host/application-security-readiness'
import { REVIEWED_DEPLOYMENT_PLUGINS } from '@/app/plugins/host/deployment/contract'
import {
  ACCESSIBILITY_AUDIT_COMMAND,
  ACCESSIBILITY_AUDIT_PLUGIN_ID,
  CAPACITOR_EXPORTER,
  CAPACITOR_EXPORTER_PLUGIN_ID,
  CLIPBOARD_COMMANDS,
  CLIPBOARD_TOOLKIT_PLUGIN_ID,
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
} from '@/app/plugins/host/ids'

const ENGINE_VERSION = '0.13.2'

function bundledManifest(pluginId: string) {
  const manifest = createBundledPluginCatalog().find(
    (entry) => entry.manifest.plugin.id === pluginId
  )?.manifest
  if (!manifest) throw new Error(`Missing bundled plugin: ${pluginId}`)
  return manifest
}

describe('bundled plugin catalog contributions', () => {
  test('publishes the fifty-eight reviewed built-in plugin identities', () => {
    const catalog = createBundledPluginCatalog()
    const ids = catalog.map((entry) => entry.manifest.plugin.id)

    expect(ids).toEqual([
      MAP_PLUGIN_ID,
      CHART_PLUGIN_ID,
      RICH_TEXT_PLUGIN_ID,
      HTML_PLUGIN_ID,
      VIDEO_PLUGIN_ID,
      TABLE_PLUGIN_ID,
      SLIDE_MENU_PLUGIN_ID,
      DROPDOWN_MENU_PLUGIN_ID,
      UPLOAD_BUTTON_PLUGIN_ID,
      MODAL_PLUGIN_ID,
      LOTTIE_PLUGIN_ID,
      CAROUSEL_PLUGIN_ID,
      DATA_GRID_PLUGIN_ID,
      TABS_PLUGIN_ID,
      ACCORDION_PLUGIN_ID,
      QR_BARCODE_PLUGIN_ID,
      MARKDOWN_PLUGIN_ID,
      CODE_BLOCK_PLUGIN_ID,
      PDF_VIEWER_PLUGIN_ID,
      AUDIO_PLAYER_PLUGIN_ID,
      CLIPBOARD_TOOLKIT_PLUGIN_ID,
      TAURI_REACT_EXPORTER_PLUGIN_ID,
      EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
      FLUTTER_EXPORTER_PLUGIN_ID,
      ACCESSIBILITY_AUDIT_PLUGIN_ID,
      DESIGN_SYSTEM_AUDIT_PLUGIN_ID,
      APPLICATION_SECURITY_READINESS_PLUGIN_ID,
      DESIGN_TOKENS_EXPORTER_PLUGIN_ID,
      FIGMA_PROJECTION_EXPORTER_PLUGIN_ID,
      NEXTJS_EXPORTER_PLUGIN_ID,
      CAPACITOR_EXPORTER_PLUGIN_ID,
      ELECTRON_EXPORTER_PLUGIN_ID,
      VUE_EXPORTER_PLUGIN_ID,
      SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID,
      AIRTABLE_RECORDS_PLUGIN_ID,
      SUPABASE_BUSINESS_PLUGIN_ID,
      STRIPE_BILLING_PLUGIN_ID,
      RESEND_EMAIL_PLUGIN_ID,
      ...REVIEWED_EXTERNAL_SERVICE_CATALOG.map(
        (descriptor) => descriptor.connector.contract.pluginId
      ),
      ...REVIEWED_DEPLOYMENT_PLUGINS.map((definition) => definition.pluginId),
      GOOGLE_DRIVE_STORAGE_PLUGIN_ID
    ])
    expect(
      catalog.reduce(
        (total, entry) =>
          total +
          entry.manifest.contributions.modules.length +
          (entry.manifest.contributions.commands?.length ?? 0) +
          (entry.manifest.contributions.exporters?.length ?? 0) +
          (entry.manifest.schemaVersion === 2
            ? (entry.manifest.contributions.connectors?.length ?? 0) +
              (entry.manifest.contributions.storageProviders?.length ?? 0)
            : 0),
        0
      )
    ).toBe(61)
    for (const descriptor of REVIEWED_EXTERNAL_SERVICE_CATALOG) {
      const entry = catalog.find(
        (candidate) => candidate.manifest.plugin.id === descriptor.connector.contract.pluginId
      )
      expect(entry).toMatchObject({
        trustSource: 'app-bundle',
        installedByDefault: false,
        enabledByDefault: false,
        manifest: {
          contributions: { connectors: [descriptor.connector.contract] }
        }
      })
    }
    expect(
      catalog.find((entry) => entry.manifest.plugin.id === GOOGLE_DRIVE_STORAGE_PLUGIN_ID)
    ).toMatchObject({ installedByDefault: true, enabledByDefault: true })
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

  test('keeps all non-default reviewed modules opt-in and bound to trusted adapters', () => {
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
      },
      {
        pluginId: DROPDOWN_MENU_PLUGIN_ID,
        moduleType: DROPDOWN_MENU_MODULE_TYPE,
        adapterId: 'open-pencil.dropdown-menu'
      },
      {
        pluginId: MODAL_PLUGIN_ID,
        moduleType: MODAL_MODULE_TYPE,
        adapterId: 'open-pencil.modal'
      },
      {
        pluginId: LOTTIE_PLUGIN_ID,
        moduleType: LOTTIE_MODULE_TYPE,
        adapterId: 'open-pencil.lottie'
      },
      {
        pluginId: CAROUSEL_PLUGIN_ID,
        moduleType: CAROUSEL_MODULE_TYPE,
        adapterId: 'open-pencil.carousel'
      },
      {
        pluginId: DATA_GRID_PLUGIN_ID,
        moduleType: DATA_GRID_MODULE_TYPE,
        adapterId: 'open-pencil.data-grid'
      },
      {
        pluginId: TABS_PLUGIN_ID,
        moduleType: TABS_MODULE_TYPE,
        adapterId: 'open-pencil.tabs'
      },
      {
        pluginId: ACCORDION_PLUGIN_ID,
        moduleType: ACCORDION_MODULE_TYPE,
        adapterId: 'open-pencil.accordion'
      },
      {
        pluginId: QR_BARCODE_PLUGIN_ID,
        moduleType: QR_BARCODE_MODULE_TYPE,
        adapterId: 'open-pencil.qr-barcode'
      },
      {
        pluginId: MARKDOWN_PLUGIN_ID,
        moduleType: MARKDOWN_MODULE_TYPE,
        adapterId: 'open-pencil.markdown'
      },
      {
        pluginId: CODE_BLOCK_PLUGIN_ID,
        moduleType: CODE_BLOCK_MODULE_TYPE,
        adapterId: 'open-pencil.code-block'
      },
      {
        pluginId: PDF_VIEWER_PLUGIN_ID,
        moduleType: PDF_VIEWER_MODULE_TYPE,
        adapterId: 'open-pencil.pdf-viewer'
      },
      {
        pluginId: AUDIO_PLAYER_PLUGIN_ID,
        moduleType: AUDIO_PLAYER_MODULE_TYPE,
        adapterId: 'open-pencil.audio-player'
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

  test('publishes the current Slide Menu config and independent trigger fields', () => {
    const slideMenu = bundledManifest(SLIDE_MENU_PLUGIN_ID).contributions.modules[0]
    if (!slideMenu) throw new Error('Expected bundled Slide Menu contribution')

    expect(slideMenu.configVersion).toBe(SLIDE_MENU_MODULE_CONFIG_VERSION)
    expect(slideMenu.defaultConfig).toEqual(SLIDE_MENU_MODULE_DEFAULT_CONFIG)
    expect(
      slideMenu.fields.filter(({ path }) =>
        path.some((segment) => segment === 'showTriggerIcon' || segment === 'showTriggerLabel')
      )
    ).toEqual([
      { path: ['showTriggerIcon'], kind: 'boolean', label: 'Show trigger icon' },
      { path: ['showTriggerLabel'], kind: 'boolean', label: 'Show trigger label' }
    ])
  })

  test('publishes the bounded opt-in Modal config and reviewed adapter', () => {
    const modal = bundledManifest(MODAL_PLUGIN_ID).contributions.modules[0]
    if (!modal) throw new Error('Expected bundled Modal contribution')

    expect(modal).toMatchObject({
      moduleType: MODAL_MODULE_TYPE,
      adapterId: 'open-pencil.modal',
      configVersion: MODAL_MODULE_CONFIG_VERSION,
      defaultConfig: MODAL_MODULE_DEFAULT_CONFIG
    })
    expect(
      modal.fields.find(({ path }) => path.length === 1 && path[0] === 'content')
    ).toMatchObject({ kind: 'text', label: 'Content' })
  })

  test('declares the clipboard commands and project exporters without executable modules', () => {
    const clipboard = bundledManifest(CLIPBOARD_TOOLKIT_PLUGIN_ID)
    const tauriExporter = bundledManifest(TAURI_REACT_EXPORTER_PLUGIN_ID)
    const expoExporter = bundledManifest(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID)
    const flutterExporter = bundledManifest(FLUTTER_EXPORTER_PLUGIN_ID)
    const accessibilityAudit = bundledManifest(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    const designSystemAudit = bundledManifest(DESIGN_SYSTEM_AUDIT_PLUGIN_ID)
    const designTokens = bundledManifest(DESIGN_TOKENS_EXPORTER_PLUGIN_ID)
    const figmaProjection = bundledManifest(FIGMA_PROJECTION_EXPORTER_PLUGIN_ID)
    const nextJsExporter = bundledManifest(NEXTJS_EXPORTER_PLUGIN_ID)
    const capacitorExporter = bundledManifest(CAPACITOR_EXPORTER_PLUGIN_ID)
    const electronExporter = bundledManifest(ELECTRON_EXPORTER_PLUGIN_ID)
    const vueExporter = bundledManifest(VUE_EXPORTER_PLUGIN_ID)
    const supabaseSchema = bundledManifest(SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID)
    const airtableRecords = bundledManifest(AIRTABLE_RECORDS_PLUGIN_ID)
    const supabaseBusiness = bundledManifest(SUPABASE_BUSINESS_PLUGIN_ID)
    const stripeBilling = bundledManifest(STRIPE_BILLING_PLUGIN_ID)
    const resendEmail = bundledManifest(RESEND_EMAIL_PLUGIN_ID)
    const googleDriveStorage = bundledManifest(GOOGLE_DRIVE_STORAGE_PLUGIN_ID)

    expect(clipboard.contributions.modules).toEqual([])
    expect(
      clipboard.contributions.commands?.map(({ commandId, adapterId }) => ({
        commandId,
        adapterId
      }))
    ).toEqual(Object.values(CLIPBOARD_COMMANDS))
    expect(clipboard.contributions.exporters).toBeUndefined()

    expect(tauriExporter.contributions.modules).toEqual([])
    expect(tauriExporter.contributions.commands).toBeUndefined()
    expect(tauriExporter.contributions.exporters).toEqual([
      expect.objectContaining(TAURI_REACT_EXPORTER)
    ])
    expect(expoExporter.contributions.modules).toEqual([])
    expect(expoExporter.contributions.commands).toBeUndefined()
    expect(expoExporter.contributions.exporters).toEqual([
      expect.objectContaining(EXPO_REACT_NATIVE_EXPORTER)
    ])
    expect(flutterExporter.contributions.modules).toEqual([])
    expect(flutterExporter.contributions.commands).toBeUndefined()
    expect(flutterExporter.contributions.exporters).toEqual([
      expect.objectContaining(FLUTTER_EXPORTER)
    ])
    expect(accessibilityAudit.contributions.modules).toEqual([])
    expect(accessibilityAudit.schemaVersion).toBe(2)
    expect(accessibilityAudit.contributions.commands).toEqual([
      expect.objectContaining({
        ...ACCESSIBILITY_AUDIT_COMMAND,
        parameters: {
          maxBytes: 2,
          schema: expect.objectContaining({
            type: 'object',
            additionalProperties: false,
            maxProperties: 0
          })
        },
        result: expect.objectContaining({
          maxBytes: 512 * 1024,
          schema: expect.objectContaining({ type: 'object', additionalProperties: false })
        })
      })
    ])
    expect(designSystemAudit.contributions.modules).toEqual([])
    expect(designSystemAudit.schemaVersion).toBe(2)
    expect(designSystemAudit.contributions.commands).toEqual([
      expect.objectContaining({
        ...DESIGN_SYSTEM_AUDIT_COMMAND,
        parameters: expect.objectContaining({ maxBytes: 2 }),
        result: expect.objectContaining({
          maxBytes: 512 * 1024,
          schema: expect.objectContaining({ type: 'object', additionalProperties: false })
        })
      })
    ])
    expect(designTokens.contributions.modules).toEqual([])
    expect(designTokens.schemaVersion).toBe(2)
    expect(designTokens.contributions.exporters).toEqual([
      expect.objectContaining({
        ...DESIGN_TOKENS_EXPORTER,
        parameters: expect.objectContaining({ maxBytes: 2 }),
        result: expect.objectContaining({ maxBytes: 2 })
      })
    ])
    expect(figmaProjection.contributions.modules).toEqual([])
    expect(figmaProjection.schemaVersion).toBe(2)
    expect(figmaProjection.contributions.exporters).toEqual([
      expect.objectContaining({
        ...FIGMA_PROJECTION_EXPORTER,
        parameters: expect.objectContaining({ maxBytes: 2 }),
        result: expect.objectContaining({ maxBytes: 2 })
      })
    ])
    for (const [manifest, exporter] of [
      [nextJsExporter, NEXTJS_EXPORTER],
      [capacitorExporter, CAPACITOR_EXPORTER],
      [electronExporter, ELECTRON_EXPORTER],
      [vueExporter, VUE_EXPORTER]
    ] as const) {
      expect(manifest.contributions.modules).toEqual([])
      expect(manifest.contributions.commands).toBeUndefined()
      expect(manifest.contributions.exporters).toEqual([expect.objectContaining(exporter)])
    }
    for (const [manifest, connector] of [
      [supabaseSchema, SUPABASE_SCHEMA_INSPECTOR_CONTRACT],
      [airtableRecords, AIRTABLE_RECORDS_CONNECTOR_CONTRACT],
      [supabaseBusiness, SUPABASE_BUSINESS_CONNECTOR_CONTRACT],
      [stripeBilling, STRIPE_BILLING_CONNECTOR_CONTRACT],
      [resendEmail, RESEND_EMAIL_CONNECTOR_CONTRACT]
    ] as const) {
      expect(manifest.schemaVersion).toBe(2)
      expect(manifest.contributions.modules).toEqual([])
      expect(manifest.contributions.commands).toBeUndefined()
      expect(manifest.contributions.exporters).toBeUndefined()
      if (manifest.schemaVersion !== 2) throw new Error('Expected connector manifest v2')
      expect(manifest.contributions.connectors).toEqual([connector])
    }
    expect(googleDriveStorage).toMatchObject({
      schemaVersion: 2,
      plugin: { id: GOOGLE_DRIVE_STORAGE_PLUGIN_ID, version: '1.0.0' },
      contributions: {
        modules: [],
        storageProviders: [
          {
            providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
            adapterId: GOOGLE_DRIVE_STORAGE_ADAPTER_ID,
            configVersion: GOOGLE_DRIVE_STORAGE_CONFIG_VERSION,
            capabilities: GOOGLE_DRIVE_STORAGE_CAPABILITIES
          }
        ]
      }
    })
  })

  test('lists and resolves host contributions only while installed and enabled', async () => {
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      activationCompatibilityPolicy: () => ({ ok: true }),
      catalog: createBundledPluginCatalog(),
      engineVersion: ENGINE_VERSION
    })

    await store.load()
    expect(store.installedCommands()).toEqual([])
    expect(store.installedExporters()).toEqual([])
    expect(store.installedConnectors()).toEqual([])
    expect(store.installedStorageProviders()).toHaveLength(1)
    expect(
      store.storageProvider(GOOGLE_DRIVE_STORAGE_PLUGIN_ID, GOOGLE_DRIVE_STORAGE_PROVIDER_ID)
        ?.contribution
    ).toMatchObject({ adapterId: GOOGLE_DRIVE_STORAGE_ADAPTER_ID })
    await store.setEnabled(GOOGLE_DRIVE_STORAGE_PLUGIN_ID, false)
    expect(store.installedStorageProviders()).toEqual([])
    expect(
      store.storageProvider(GOOGLE_DRIVE_STORAGE_PLUGIN_ID, GOOGLE_DRIVE_STORAGE_PROVIDER_ID)
    ).toBeNull()
    await store.setEnabled(GOOGLE_DRIVE_STORAGE_PLUGIN_ID, true)
    expect(store.installedStorageProviders()).toHaveLength(1)

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

    await store.install(VUE_EXPORTER_PLUGIN_ID)
    expect(store.installedExporters()).toEqual([])
    await store.setEnabled(VUE_EXPORTER_PLUGIN_ID, true)
    expect(
      store.exporter(VUE_EXPORTER_PLUGIN_ID, VUE_EXPORTER.exporterId)?.contribution
    ).toMatchObject(VUE_EXPORTER)
    await store.setEnabled(VUE_EXPORTER_PLUGIN_ID, false)
    expect(store.installedExporters()).toEqual([])

    await store.install(SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID)
    expect(store.installedConnectors()).toEqual([])
    expect(
      store.connector(SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID, SUPABASE_SCHEMA_INSPECTOR_CONNECTOR_ID)
    ).toBeNull()
    await store.setEnabled(SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID, true)
    expect(store.installedConnectors()).toHaveLength(1)
    expect(
      store.connector(SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID, SUPABASE_SCHEMA_INSPECTOR_CONNECTOR_ID)
        ?.contribution
    ).toEqual(SUPABASE_SCHEMA_INSPECTOR_CONTRACT)
    await store.setEnabled(SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID, false)
    expect(store.installedConnectors()).toEqual([])

    await store.install(AIRTABLE_RECORDS_PLUGIN_ID)
    await store.setEnabled(AIRTABLE_RECORDS_PLUGIN_ID, true)
    expect(
      store.connector(AIRTABLE_RECORDS_PLUGIN_ID, AIRTABLE_RECORDS_CONNECTOR_ID)?.contribution
    ).toEqual(AIRTABLE_RECORDS_CONNECTOR_CONTRACT)

    for (const [pluginId, connectorId, contract] of [
      [
        SUPABASE_BUSINESS_PLUGIN_ID,
        SUPABASE_BUSINESS_CONNECTOR_ID,
        SUPABASE_BUSINESS_CONNECTOR_CONTRACT
      ],
      [STRIPE_BILLING_PLUGIN_ID, STRIPE_BILLING_CONNECTOR_ID, STRIPE_BILLING_CONNECTOR_CONTRACT],
      [RESEND_EMAIL_PLUGIN_ID, RESEND_EMAIL_CONNECTOR_ID, RESEND_EMAIL_CONNECTOR_CONTRACT]
    ] as const) {
      await store.install(pluginId)
      await store.setEnabled(pluginId, true)
      expect(store.connector(pluginId, connectorId)?.contribution).toEqual(contract)
      await store.setEnabled(pluginId, false)
      expect(store.connector(pluginId, connectorId)).toBeNull()
    }
  })
})
