import { hasExactPluginKeys } from '../dist/adapter-helpers.js'
import { parsePluginObjectParameterSchema } from '../dist/index.js'

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

process.stdout.write('@open-pencil/plugin-contracts dist smoke passed\n')
