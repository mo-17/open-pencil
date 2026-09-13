import type {
  BackendApplicationSpecV1,
  DataFieldIR,
  DataModelIR
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import { nestJSJSONArtifact } from './artifact'
import { nestJSCommandOpenAPIPaths } from './commands/openapi'
import { nestJSResources, type NestJSResource } from './model'
import { NESTJS_DATE_PATTERN, NESTJS_DATETIME_PATTERN, nestJSEnum } from './schema-fields'

function fieldSchema(field: DataFieldIR, model: DataModelIR): JSONValue {
  const common = { nullable: field.nullable }
  switch (field.type) {
    case 'uuid':
      return { ...common, type: 'string', format: 'uuid' }
    case 'integer':
      return {
        ...common,
        type: 'integer',
        format: 'int32',
        minimum: -2147483648,
        maximum: 2147483647
      }
    case 'number':
      return { ...common, type: 'number', format: 'double' }
    case 'boolean':
      return { ...common, type: 'boolean' }
    case 'enum':
      return { ...common, type: 'string', enum: nestJSEnum(field, model).values }
    case 'date':
      return { ...common, type: 'string', format: 'date', pattern: NESTJS_DATE_PATTERN }
    case 'datetime':
      return { ...common, type: 'string', format: 'date-time', pattern: NESTJS_DATETIME_PATTERN }
    default:
      return { ...common, type: 'string', maxLength: 16384 }
  }
}

function projectedSchema(
  model: NestJSResource,
  ids: readonly string[],
  mode: 'read' | 'create' | 'update'
): JSONValue {
  const properties: Record<string, JSONValue> = {}
  const required: string[] = []
  for (const id of ids) {
    const field = model.entity.fields.find((entry) => entry.id === id)
    if (!field) throw new Error('Missing validated OpenAPI field.')
    properties[id] = fieldSchema(field, model.dataModel)
    if (mode === 'read' || (mode === 'create' && !field.nullable && !field.default))
      required.push(id)
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
    ...(mode === 'read' ? {} : { minProperties: 1 })
  }
}

function queryParameters(model: NestJSResource): JSONValue[] {
  const query = model.resource.query
  if (!query) return []
  const parameters: JSONValue[] = []
  if (query.filterFields.length) {
    const properties = Object.fromEntries(
      query.filterFields.map((id) => {
        const field = model.entity.fields.find((entry) => entry.id === id)
        if (!field) throw new Error('Missing validated query field.')
        const schema = fieldSchema(field, model.dataModel)
        return [
          id,
          { ...(schema as object), ...(field.type === 'string' ? { maxLength: 512 } : {}) }
        ]
      })
    )
    parameters.push({
      name: 'filter',
      in: 'query',
      description:
        'One JSON object of typed equality filters, encoded as a single query value of at most 4096 characters. Only declared fields are accepted; datetime values must use UTC Z.',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties,
            additionalProperties: false,
            minProperties: 1,
            maxProperties: Math.min(query.filterFields.length, 16)
          }
        }
      }
    })
  }
  if (query.searchFields.length)
    parameters.push({
      name: 'q',
      in: 'query',
      schema: { type: 'string', minLength: 1, maxLength: 128 },
      description: 'Search declared text fields; must contain a non-whitespace character.'
    })
  if (query.sortFields.length) {
    parameters.push(
      { name: 'sort', in: 'query', schema: { type: 'string', enum: query.sortFields } },
      {
        name: 'direction',
        in: 'query',
        schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
        description: 'Accepted only together with sort.'
      }
    )
  }
  return parameters
}

function cursorSchema(model: NestJSResource): JSONValue {
  if (!model.resource.query?.sortFields.length) return { type: 'string', format: 'uuid' }
  return {
    type: 'string',
    maxLength: 4096,
    description:
      'UUID when sort is absent; otherwise an opaque base64url cursor returned by this exact sort, direction, filter and search query. Never reuse it with different query settings.'
  }
}

function operationSchema(model: NestJSResource, operation: string): JSONValue {
  const { resource } = model
  const readSchema = projectedSchema(model, resource.readFields, 'read')
  const parameters: JSONValue[] = []
  if (['read', 'update', 'delete'].includes(operation)) {
    parameters.push({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' }
    })
  }
  if (operation === 'list') {
    parameters.push(
      {
        name: 'limit',
        in: 'query',
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: resource.maxPageSize ?? 1,
          default: resource.maxPageSize ?? 1
        }
      },
      { name: 'after', in: 'query', schema: cursorSchema(model) },
      ...queryParameters(model)
    )
  }
  let schema: JSONValue = readSchema
  if (operation === 'list') {
    schema = {
      type: 'object',
      required: ['data', 'nextCursor'],
      properties: {
        data: { type: 'array', items: readSchema },
        nextCursor: { ...(cursorSchema(model) as object), nullable: true }
      }
    }
  } else if (operation === 'delete') {
    schema = { type: 'object', properties: { deleted: { type: 'boolean', enum: [true] } } }
  }
  return {
    operationId: resource.id + '-' + operation,
    security:
      model.authorization.select.public && ['list', 'read'].includes(operation)
        ? [{}, { bearer: [] }]
        : [{ bearer: [] }],
    parameters,
    ...(['create', 'update'].includes(operation)
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: projectedSchema(
                  model,
                  operation === 'create'
                    ? (resource.createFields ?? [])
                    : (resource.updateFields ?? []),
                  operation === 'create' ? 'create' : 'update'
                )
              }
            }
          }
        }
      : {}),
    responses: {
      [operation === 'create' ? '201' : '200']: {
        description: 'Success',
        content: { 'application/json': { schema } }
      },
      '400': { description: 'Invalid input' },
      '401': { description: 'JWT authentication required' },
      '403': { description: 'Operation forbidden' },
      '404': { description: 'Record absent or access denied' },
      '413': { description: 'Request body too large' },
      '503': { description: 'Database unavailable' }
    }
  }
}

export function emitNestJSOpenAPI(application: BackendApplicationSpecV1) {
  const paths: Record<string, Record<string, JSONValue>> = {}
  const methods = { list: 'get', read: 'get', create: 'post', update: 'patch', delete: 'delete' }
  for (const model of nestJSResources(application)) {
    for (const operation of model.resource.operations) {
      const path =
        model.resource.path + (['read', 'update', 'delete'].includes(operation) ? '/{id}' : '')
      paths[path] ??= {}
      paths[path][methods[operation]] = operationSchema(model, operation)
    }
  }
  Object.assign(paths, nestJSCommandOpenAPIPaths(application, fieldSchema))
  return nestJSJSONArtifact(
    'openapi.json',
    {
      openapi: '3.0.3',
      info: { title: application.applicationId + ' API', version: '1.0.0' },
      paths,
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }
      }
    },
    'server-runtime'
  )
}
