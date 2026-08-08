import {
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  type PluginManifestPayloadV1
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
