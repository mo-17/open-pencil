import {
  hasExactPluginKeys,
  parsePluginBackendProviderConfiguration
} from '../dist/adapter-helpers.js'
import {
  parsePluginBackendProviderContribution,
  parsePluginObjectParameterSchema
} from '../dist/index.js'

const schema = parsePluginObjectParameterSchema({
  type: 'object',
  properties: { enabled: { type: 'boolean' } },
  required: ['enabled'],
  additionalProperties: false
})

if (schema.properties.enabled?.type !== 'boolean') {
  throw new Error('Plugin parameter contract smoke failed')
}
if (!hasExactPluginKeys({ enabled: true }, new Set(['enabled']))) {
  throw new Error('Plugin adapter helper smoke failed')
}

const backendProvider = parsePluginBackendProviderContribution({
  providerId: 'supabase',
  contributionId: 'supabase.backend',
  name: 'Supabase Backend',
  description: 'Reviewed backend artifact emitter.',
  adapterId: 'open-pencil.backend.supabase',
  contractVersion: 1,
  supportedModelVersions: [1],
  capabilities: ['data.read', 'data.write'],
  configuration: {
    schema: {
      type: 'object',
      properties: { projectRef: { type: 'string', minLength: 1, maxLength: 64 } },
      required: ['projectRef'],
      additionalProperties: false
    },
    maxBytes: 256
  },
  outputKinds: ['database-schema'],
  permissions: []
})
const backendConfiguration = parsePluginBackendProviderConfiguration(backendProvider, {
  projectRef: 'project-1'
})
if (backendConfiguration.projectRef !== 'project-1') {
  throw new Error('Plugin backend provider adapter helper smoke failed')
}

process.stdout.write('@open-pencil/plugin-contracts dist smoke passed\n')
