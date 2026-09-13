import type {
  BackendApplicationSpecV1,
  BackendCommandDefinitionIR,
  BackendCommandParameterIR,
  DataFieldIR,
  DataModelIR
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

type FieldSchema = (field: DataFieldIR, model: DataModelIR) => JSONValue

function parameterSchema(parameter: BackendCommandParameterIR): JSONValue {
  if (parameter.type === 'uuid') return { type: 'string', format: 'uuid' }
  if (parameter.type === 'integer')
    return { type: 'integer', format: 'int32', minimum: parameter.min, maximum: parameter.max }
  if (parameter.type === 'string') return { type: 'string', maxLength: parameter.maxLength }
  return { type: 'boolean' }
}

function responseSchema(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR,
  fieldSchema: FieldSchema
): JSONValue {
  const result = command.steps.find(
    (step) => step.kind !== 'assert' && step.resultName === command.return.resultName
  )
  const entity =
    result && result.kind !== 'assert'
      ? application.dataModel.entities.find((entry) => entry.id === result.entityId)
      : undefined
  if (!entity) throw new Error('Missing validated command response entity.')
  const properties = Object.fromEntries(
    command.return.fields.map((id) => {
      const field = entity.fields.find((entry) => entry.id === id)
      if (!field) throw new Error('Missing validated command response field.')
      return [id, fieldSchema(field, application.dataModel)]
    })
  )
  return {
    type: 'object',
    additionalProperties: false,
    required: command.return.fields,
    properties
  }
}

export function nestJSCommandOpenAPIPaths(
  application: BackendApplicationSpecV1,
  fieldSchema: FieldSchema
): Record<string, Record<string, JSONValue>> {
  return Object.fromEntries(
    (application.commands?.commands ?? []).map((command) => [
      command.path,
      {
        post: {
          operationId: 'command-' + command.id,
          summary: command.name,
          security: [{ bearer: [] }],
          description:
            'Atomic authenticated command. Reuse the same key and parameters after an uncertain result. A changed command definition or changed parameters conflict with a previously committed key.',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: true,
              schema: {
                type: 'string',
                minLength: 16,
                maxLength: 128,
                pattern: '^[A-Za-z0-9._:-]{16,128}$'
              }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: command.parameters.map((parameter) => parameter.name),
                  properties: Object.fromEntries(
                    command.parameters.map((parameter) => [
                      parameter.name,
                      parameterSchema(parameter)
                    ])
                  )
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Committed result or replay of the same committed attempt',
              content: {
                'application/json': { schema: responseSchema(application, command, fieldSchema) }
              }
            },
            '400': { description: 'Invalid parameters or missing/invalid idempotency key' },
            '401': { description: 'JWT authentication required' },
            '403': { description: 'Command role not granted' },
            '404': { description: 'Record absent or not accessible to this command' },
            '409': { description: 'Command assertion, data constraint, or idempotency conflict' },
            '413': { description: 'Request body too large' },
            '503': {
              description: 'Service unavailable; outcome may be unknown, retry with the same key'
            }
          }
        }
      }
    ])
  )
}
