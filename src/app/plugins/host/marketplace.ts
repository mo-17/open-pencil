import type { PluginManifestPayload } from '@open-pencil/plugin-contracts'

import { createBundledPluginCatalog } from '../catalog'
import { APPLICATION_SECURITY_READINESS_HOST_CONTRACT } from './application-security-readiness'
import {
  ACCESSIBILITY_AUDIT_COMMAND,
  ACCESSIBILITY_AUDIT_PLUGIN_ID,
  DESIGN_SYSTEM_AUDIT_COMMAND,
  DESIGN_SYSTEM_AUDIT_PLUGIN_ID,
  DESIGN_TOKENS_EXPORTER,
  DESIGN_TOKENS_EXPORTER_PLUGIN_ID,
  FIGMA_PROJECTION_EXPORTER,
  FIGMA_PROJECTION_EXPORTER_PLUGIN_ID,
  FLUTTER_EXPORTER,
  FLUTTER_EXPORTER_PLUGIN_ID,
  NEXTJS_EXPORTER,
  NEXTJS_EXPORTER_PLUGIN_ID,
  VUE_EXPORTER,
  VUE_EXPORTER_PLUGIN_ID
} from './ids'

interface MarketplaceHostPluginAlias {
  readonly kind: 'command' | 'exporter'
  readonly originalPluginId: string
  readonly newPluginId: string
  readonly originalAdapterId: string
  readonly newAdapterId: string
}

/** Fixed marketplace identities reuse reviewed host implementations without replacing bundled IDs. */
export const MARKETPLACE_HOST_PLUGIN_ALIASES = Object.freeze([
  {
    kind: 'command',
    originalPluginId: ACCESSIBILITY_AUDIT_PLUGIN_ID,
    newPluginId: 'marketplace.accessibility-audit',
    originalAdapterId: ACCESSIBILITY_AUDIT_COMMAND.adapterId,
    newAdapterId: 'marketplace.audit.static-accessibility'
  },
  {
    kind: 'command',
    originalPluginId: DESIGN_SYSTEM_AUDIT_PLUGIN_ID,
    newPluginId: 'marketplace.design-system-audit',
    originalAdapterId: DESIGN_SYSTEM_AUDIT_COMMAND.adapterId,
    newAdapterId: 'marketplace.audit.design-system'
  },
  {
    kind: 'command',
    originalPluginId: APPLICATION_SECURITY_READINESS_HOST_CONTRACT.pluginId,
    newPluginId: 'marketplace.application-security-readiness',
    originalAdapterId: APPLICATION_SECURITY_READINESS_HOST_CONTRACT.command.adapterId,
    newAdapterId: 'marketplace.audit.application-security-readiness'
  },
  {
    kind: 'exporter',
    originalPluginId: DESIGN_TOKENS_EXPORTER_PLUGIN_ID,
    newPluginId: 'marketplace.design-tokens-exporter',
    originalAdapterId: DESIGN_TOKENS_EXPORTER.adapterId,
    newAdapterId: 'marketplace.export.design-tokens-json'
  },
  {
    kind: 'exporter',
    originalPluginId: VUE_EXPORTER_PLUGIN_ID,
    newPluginId: 'marketplace.vue-exporter',
    originalAdapterId: VUE_EXPORTER.adapterId,
    newAdapterId: 'marketplace.export.vue-source'
  },
  {
    kind: 'exporter',
    originalPluginId: NEXTJS_EXPORTER_PLUGIN_ID,
    newPluginId: 'marketplace.nextjs-exporter',
    originalAdapterId: NEXTJS_EXPORTER.adapterId,
    newAdapterId: 'marketplace.export.nextjs-source'
  },
  {
    kind: 'exporter',
    originalPluginId: FLUTTER_EXPORTER_PLUGIN_ID,
    newPluginId: 'marketplace.flutter-exporter',
    originalAdapterId: FLUTTER_EXPORTER.adapterId,
    newAdapterId: 'marketplace.export.flutter-source'
  },
  {
    kind: 'exporter',
    originalPluginId: FIGMA_PROJECTION_EXPORTER_PLUGIN_ID,
    newPluginId: 'marketplace.figma-projection-exporter',
    originalAdapterId: FIGMA_PROJECTION_EXPORTER.adapterId,
    newAdapterId: 'marketplace.export.figma-editable-projection'
  }
] as const satisfies readonly MarketplaceHostPluginAlias[])

/** Fresh payloads retain the exact bundled contribution contracts; the publisher signs separately. */
export function createMarketplacePluginManifests(): readonly PluginManifestPayload[] {
  const bundled = createBundledPluginCatalog()
  return Object.freeze(
    MARKETPLACE_HOST_PLUGIN_ALIASES.map((alias) => {
      const original = bundled.find(
        (entry) =>
          entry.trustSource === 'app-bundle' && entry.manifest.plugin.id === alias.originalPluginId
      )
      if (!original)
        throw new Error(`Bundled marketplace source is unavailable: ${alias.originalPluginId}`)
      const manifest: PluginManifestPayload = structuredClone(original.manifest)
      manifest.plugin.id = alias.newPluginId
      const contribution =
        alias.kind === 'command'
          ? manifest.contributions.commands?.find(
              (entry) => entry.adapterId === alias.originalAdapterId
            )
          : manifest.contributions.exporters?.find(
              (entry) => entry.adapterId === alias.originalAdapterId
            )
      if (!contribution)
        throw new Error(`Bundled marketplace adapter is unavailable: ${alias.originalAdapterId}`)
      contribution.adapterId = alias.newAdapterId
      return manifest
    })
  )
}
