import { describe, expect, test } from 'bun:test'

import type {
  DeclarativeCommandContributionV2,
  DeclarativeExporterContributionV2
} from '@open-pencil/core/plugins'

import {
  createBundledPluginCatalog,
  inspectPluginCommandCompatibility,
  inspectPluginExporterCompatibility,
  resolveTrustedPluginExporterExecutor
} from '@/app/plugins'
import { inspectPluginExporterMcpExposure } from '@/app/plugins/host'
import { exportCurrentDocumentDesignTokens } from '@/app/plugins/host/design-tokens-exporter'
import { exportCurrentDocumentAsFigmaProjection } from '@/app/plugins/host/figma-projection-exporter'
import {
  ACCESSIBILITY_AUDIT_COMMAND,
  ACCESSIBILITY_AUDIT_PLUGIN_ID,
  DESIGN_TOKENS_EXPORTER,
  DESIGN_TOKENS_EXPORTER_PLUGIN_ID,
  FIGMA_PROJECTION_EXPORTER,
  FIGMA_PROJECTION_EXPORTER_PLUGIN_ID
} from '@/app/plugins/host/ids'

function command(pluginId: string): DeclarativeCommandContributionV2 {
  const manifest = createBundledPluginCatalog().find(
    (entry) => entry.manifest.plugin.id === pluginId
  )?.manifest
  if (manifest?.schemaVersion !== 2) throw new Error(`Missing v2 command for ${pluginId}`)
  const contribution = manifest.contributions.commands?.[0]
  if (!contribution) throw new Error(`Missing command for ${pluginId}`)
  return contribution
}

function exporter(pluginId: string): DeclarativeExporterContributionV2 {
  const manifest = createBundledPluginCatalog().find(
    (entry) => entry.manifest.plugin.id === pluginId
  )?.manifest
  if (manifest?.schemaVersion !== 2) throw new Error(`Missing v2 exporter for ${pluginId}`)
  const contribution = manifest.contributions.exporters?.[0]
  if (!contribution) throw new Error(`Missing exporter for ${pluginId}`)
  return contribution
}

describe('productivity plugin host contributions', () => {
  test('binds accessibility audit to its exact reviewed identity', () => {
    const contribution = command(ACCESSIBILITY_AUDIT_PLUGIN_ID)
    expect(contribution).toMatchObject(ACCESSIBILITY_AUDIT_COMMAND)
    expect(inspectPluginCommandCompatibility(ACCESSIBILITY_AUDIT_PLUGIN_ID, contribution)).toEqual({
      ok: true,
      status: 'compatible'
    })
    expect(inspectPluginCommandCompatibility('publisher.other', contribution)).toMatchObject({
      ok: false,
      status: 'plugin-identity-mismatch'
    })
  })

  test('binds token and Figma exporters to fixed outputs and host executors', () => {
    const tokens = exporter(DESIGN_TOKENS_EXPORTER_PLUGIN_ID)
    const figma = exporter(FIGMA_PROJECTION_EXPORTER_PLUGIN_ID)

    expect(tokens).toMatchObject(DESIGN_TOKENS_EXPORTER)
    expect(figma).toMatchObject(FIGMA_PROJECTION_EXPORTER)
    expect(inspectPluginExporterCompatibility(DESIGN_TOKENS_EXPORTER_PLUGIN_ID, tokens)).toEqual({
      ok: true,
      status: 'compatible'
    })
    expect(inspectPluginExporterCompatibility(FIGMA_PROJECTION_EXPORTER_PLUGIN_ID, figma)).toEqual({
      ok: true,
      status: 'compatible'
    })
    expect(inspectPluginExporterMcpExposure(DESIGN_TOKENS_EXPORTER_PLUGIN_ID, tokens)).toEqual({
      ok: true,
      status: 'compatible'
    })
    expect(
      inspectPluginExporterMcpExposure(FIGMA_PROJECTION_EXPORTER_PLUGIN_ID, figma)
    ).toMatchObject({ ok: false, status: 'mcp-exposure-disabled' })
    expect(resolveTrustedPluginExporterExecutor(tokens.adapterId)).toBeFunction()
    expect(resolveTrustedPluginExporterExecutor(figma.adapterId)).toBeFunction()
    expect(exportCurrentDocumentDesignTokens).toBeFunction()
    expect(exportCurrentDocumentAsFigmaProjection).toBeFunction()
  })
})
