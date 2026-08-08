import {
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PLUGIN_MANIFEST_SCHEMA_VERSION_V2,
  type PluginContributionDataContractV2,
  type PluginManifestPayloadV1,
  type PluginManifestPayloadV2
} from '@open-pencil/core/plugins'

export function pluginPayload(version = '1.0.0', moduleName = 'Chart'): PluginManifestPayloadV1 {
  return {
    format: PLUGIN_MANIFEST_FORMAT,
    schemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
    plugin: { id: 'acme.analytics', name: 'Acme Analytics', version },
    publisher: { id: 'acme', name: 'Acme', keyId: 'acme.release' },
    engineRange: '>=0.13.0 <1.0.0',
    capabilities: [],
    contributions: {
      modules: [
        {
          moduleType: 'chart',
          name: moduleName,
          description: 'A declarative chart module',
          adapterId: 'open-pencil.chart',
          configVersion: 1,
          defaultSize: { width: 360, height: 240 },
          defaultConfig: {
            title: 'Revenue',
            count: 4,
            enabled: true,
            mode: 'bar',
            data: { values: [12, 24, 18, 30] }
          },
          fields: [
            { path: ['title'], kind: 'text', label: 'Title' },
            { path: ['count'], kind: 'number', label: 'Count', min: 1, max: 64, step: 1 },
            { path: ['enabled'], kind: 'boolean', label: 'Enabled' },
            {
              path: ['mode'],
              kind: 'select',
              label: 'Mode',
              options: ['bar', 'line']
            },
            { path: ['data'], kind: 'json', label: 'Data' }
          ]
        }
      ]
    }
  }
}

export function pluginPayloadV2(version = '2.0.0'): PluginManifestPayloadV2 {
  const emptyParameters: PluginContributionDataContractV2 = {
    schema: { type: 'object', properties: {}, additionalProperties: false },
    maxBytes: 8 * 1024
  }
  const result: PluginContributionDataContractV2 = {
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'cancelled'] },
        issueCount: { type: 'integer', minimum: 0 }
      },
      required: ['status'],
      additionalProperties: false
    },
    maxBytes: 64 * 1024
  }
  return {
    format: PLUGIN_MANIFEST_FORMAT,
    schemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION_V2,
    plugin: { id: 'acme.analytics', name: 'Acme Analytics', version },
    publisher: { id: 'acme', name: 'Acme', keyId: 'acme.release' },
    engineRange: '>=0.13.0 <1.0.0',
    capabilities: [],
    contributions: {
      modules: [],
      commands: [
        {
          commandId: 'accessibility-audit',
          name: 'Accessibility Audit',
          description: 'Runs a static accessibility audit',
          adapterId: 'open-pencil.audit.accessibility',
          parameters: {
            schema: {
              type: 'object',
              properties: {
                scope: { type: 'string', enum: ['document', 'current-page', 'selection'] }
              },
              additionalProperties: false
            },
            maxBytes: 8 * 1024
          },
          result,
          permissions: ['document.read', 'document.selection.read']
        }
      ],
      exporters: [
        {
          exporterId: 'design-tokens',
          name: 'Design Tokens',
          description: 'Exports public design tokens',
          adapterId: 'open-pencil.export.design-tokens',
          parameters: emptyParameters,
          result,
          permissions: ['document.variables.read', 'file.save'],
          outputs: [
            { extension: '.json', mimeType: 'application/json' },
            { extension: '.css', mimeType: 'text/css' }
          ]
        }
      ]
    }
  }
}
