import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { nestJSArtifact } from './artifact'
import {
  nestJSClientCommands,
  NESTJS_COMMAND_CLIENT_HELPERS,
  NESTJS_COMMAND_CLIENT_METHOD
} from './client/commands'
import { nestJSFieldType } from './dto'
import { nestJSResources, type NestJSResource } from './model'

function projectedClientType(
  model: NestJSResource,
  ids: readonly string[],
  mode: 'read' | 'create' | 'update'
): string {
  return (
    '{ ' +
    ids
      .map((id) => {
        const field = model.entity.fields.find((entry) => entry.id === id)
        if (!field) throw new Error('Missing validated client field.')
        const optional =
          mode === 'update' || (mode === 'create' && (field.nullable || field.default))
        return (
          JSON.stringify(id) +
          (optional ? '?' : '') +
          ': ' +
          nestJSFieldType(field, model.dataModel) +
          (field.nullable ? ' | null' : '')
        )
      })
      .join('; ') +
    ' }'
  )
}

export function emitNestJSClient(application: BackendApplicationSpecV1) {
  const types: string[] = []
  const commands = nestJSClientCommands(application)
  const resources = nestJSResources(application).map((model, index) => {
    const name = 'Resource' + index
    types.push(
      'export type ' +
        name +
        'Row = ' +
        projectedClientType(model, model.resource.readFields, 'read')
    )
    const entries: string[] = []
    const path = JSON.stringify(model.resource.path)
    const publicRead = model.authorization.select.public
    const publicArgument = publicRead ? ', undefined, true' : ''
    const query = model.resource.query
    const filter = query?.filterFields.length
      ? '; filter?: Partial<Pick<' +
        name +
        'Row, ' +
        query.filterFields.map((field) => JSON.stringify(field)).join(' | ') +
        '>>'
      : ''
    const search = query?.searchFields.length ? '; q?: string' : ''
    const sort = query?.sortFields.length
      ? '; sort?: ' +
        query.sortFields.map((field) => JSON.stringify(field)).join(' | ') +
        "; direction?: 'asc' | 'desc'"
      : ''
    if (model.resource.operations.includes('list'))
      entries.push(
        `list: (query: { limit?: number; after?: string${filter}${search}${sort} } = {}) => request<Page<${name}Row>>('GET', ${path} + pagination(query)${publicArgument})`
      )
    if (model.resource.operations.includes('read'))
      entries.push(
        `read: (id: string) => request<${name}Row>('GET', ${path} + '/' + encodeURIComponent(id)${publicArgument})`
      )
    if (model.resource.operations.includes('create')) {
      types.push(
        'export type ' +
          name +
          'Create = ' +
          projectedClientType(model, model.resource.createFields ?? [], 'create')
      )
      entries.push(`create: (body: ${name}Create) => request<${name}Row>('POST', ${path}, body)`)
    }
    if (model.resource.operations.includes('update')) {
      types.push(
        'export type ' +
          name +
          'Update = ' +
          projectedClientType(model, model.resource.updateFields ?? [], 'update')
      )
      entries.push(
        `update: (id: string, body: ${name}Update) => request<${name}Row>('PATCH', ${path} + '/' + encodeURIComponent(id), body)`
      )
    }
    if (model.resource.operations.includes('delete'))
      entries.push(
        `delete: (id: string) => request<{ deleted: true }>('DELETE', ${path} + '/' + encodeURIComponent(id))`
      )
    return (
      '    ' +
      JSON.stringify(model.resource.id) +
      ': {\n      ' +
      entries.join(',\n      ') +
      '\n    }'
    )
  })
  const source = `// Copy into a React/Vue client; token acquisition remains owned by your identity integration.
${types.join('\n')}
${commands.types}
${NESTJS_COMMAND_CLIENT_HELPERS}
export interface Page<T> { data: T[]; nextCursor: string | null }
export interface NestJSClientOptions {
  baseUrl: string
  getAccessToken?: () => Promise<string | null>
  fetch?: typeof fetch
}
export class NestJSAPIError extends Error {
  constructor(readonly status: number) { super('API request failed (' + status + ')') }
}
function pagination(query: { limit?: number; after?: string; filter?: object; q?: string; sort?: string; direction?: string }): string {
  const parameters = new URLSearchParams()
  if (query.limit !== undefined) parameters.set('limit', String(query.limit))
  if (query.after !== undefined) parameters.set('after', query.after)
  const filter = query.filter === undefined ? undefined : JSON.stringify(query.filter)
  if (filter !== undefined && filter !== '{}') parameters.set('filter', filter)
  if (query.q !== undefined) parameters.set('q', query.q)
  if (query.sort !== undefined) parameters.set('sort', query.sort)
  if (query.direction !== undefined) parameters.set('direction', query.direction)
  return parameters.size ? '?' + parameters.toString() : ''
}
export function createNestJSClient(options: NestJSClientOptions) {
  const base = options.baseUrl.replace(/\\/$/u, '')
  const transport = options.fetch ?? globalThis.fetch
  const optionsToken = () => options.getAccessToken?.()
${NESTJS_COMMAND_CLIENT_METHOD}
  async function request<T>(method: string, path: string, body?: object, publicRead = false): Promise<T> {
    const token = await options.getAccessToken?.()
    if ((token !== null && token !== undefined && (typeof token !== 'string' || !token || /[\\r\\n]/u.test(token))) || (!token && !publicRead)) throw new NestJSAPIError(401)
    const response = await transport(base + path, {
      method, redirect: 'error', credentials: 'omit',
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    if (!response.ok) throw new NestJSAPIError(response.status)
    return response.json() as Promise<T>
  }
  return {
    ${commands.entries ? 'commands: { ' + commands.entries + ' },' : ''}
${resources.join(',\n')}
  }
}
`
  return nestJSArtifact('client.ts', source, 'client-config', 'text/typescript')
}
