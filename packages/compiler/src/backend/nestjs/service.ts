import { nestJSArtifact, sqlIdentifier } from './artifact'
import type { NestJSResource } from './model'
import { nestJSReadColumn } from './schema-fields'

function databaseColumns(model: NestJSResource, ids: readonly string[]): string[] {
  return ids.map((id) => {
    const field = model.entity.fields.find((entry) => entry.id === id)
    if (!field) throw new Error('Missing validated SQL column.')
    return sqlIdentifier(field.name)
  })
}

function readMethods(model: NestJSResource): string {
  const result: string[] = []
  if (model.resource.operations.includes('list')) {
    result.push(`  async list(principal: VerifiedPrincipal | null, query: ListQuery) {
    const values: unknown[] = []
    const where = rowScope(principal, ACCESS.select, OWNER, values)
    const statement = listStatement({ projection: PROJECTION, table: TABLE, key: KEY, where }, query, values)
    const result = await this.database.query(statement, values)
    return listPage(result.rows, query)
  }`)
  }
  if (model.resource.operations.includes('read')) {
    result.push(`  async read(principal: VerifiedPrincipal | null, id: string) {
    const values: unknown[] = []
    const where = rowScope(principal, ACCESS.select, OWNER, values)
    const key = '$' + values.push(id)
    const result = await this.database.query(
      'SELECT ' + PROJECTION + ' FROM ' + TABLE + ' WHERE (' + where + ') AND ' + KEY + ' = ' + key + ' LIMIT 1', values)
    if (!result.rows[0]) throw new NotFoundException('Record not found')
    return result.rows[0]
  }`)
  }
  return result.join('\n\n')
}

function mutationMethods(model: NestJSResource, index: number): string {
  const methods: string[] = []
  const tenantCreate = Boolean(model.authorization.insert.tenants?.length)
  if (model.resource.operations.includes('create')) {
    methods.push(`  async create(principal: VerifiedPrincipal | null, body: Resource${index}CreateDTO) {
    const subject = createSubject(principal, ACCESS.insert)
    const fields = CREATE_FIELDS.filter((field) => Reflect.get(body, field.id) !== undefined)
    const columns = [OWNER, ...fields.map((field) => field.column)]
    const values: unknown[] = [subject, ...fields.map((field) => Reflect.get(body, field.id))]
    const placeholders = values.map((_value, index) => '$' + (index + 1))
${tenantCreate ? '    const where = tenantCreateScope(principal, ACCESS.insert, body, values)\n' : ''}\
    const result = await this.database.query(
      'INSERT INTO ' + TABLE + ' (' + columns.join(', ') + ') ${tenantCreate ? "SELECT ' + placeholders.join(', ') + ' WHERE ' + where + ' RETURNING ' + PROJECTION, values)" : "VALUES (' +\n      placeholders.join(', ') + ') RETURNING ' + PROJECTION, values)"}
${tenantCreate ? "    if (!result.rows[0]) throw new ForbiddenException('Operation is not permitted.')\n" : ''}\
    return result.rows[0]
  }`)
  }
  if (model.resource.operations.includes('update')) {
    methods.push(`  async update(principal: VerifiedPrincipal | null, id: string, body: Resource${index}UpdateDTO) {
    const values: unknown[] = []
    const where = rowScope(principal, ACCESS.update, OWNER, values)
    const key = '$' + values.push(id)
    const fields = UPDATE_FIELDS.filter((field) => Reflect.get(body, field.id) !== undefined)
    if (fields.length === 0) throw new BadRequestException('An update requires at least one field')
    const assignments = fields.map((field) => field.column + ' = $' + values.push(Reflect.get(body, field.id)))
    const result = await this.database.query(
      'UPDATE ' + TABLE + ' SET ' + assignments.join(', ') +
      ' WHERE (' + where + ') AND ' + KEY + ' = ' + key + ' RETURNING ' + PROJECTION, values)
    if (result.rows.length === 0) throw new NotFoundException('Record not found')
    return result.rows[0]
  }`)
  }
  if (model.resource.operations.includes('delete')) {
    methods.push(`  async delete(principal: VerifiedPrincipal | null, id: string) {
    const values: unknown[] = []
    const where = rowScope(principal, ACCESS.delete, OWNER, values)
    const key = '$' + values.push(id)
    const result = await this.database.query(
      'DELETE FROM ' + TABLE + ' WHERE (' + where + ') AND ' + KEY +
      ' = ' + key + ' RETURNING ' + KEY, values)
    if (result.rows.length === 0) throw new NotFoundException('Record not found')
    return { deleted: true }
  }`)
  }
  return methods.join('\n\n')
}

export function emitNestJSService(model: NestJSResource, index: number) {
  const keyId = model.entity.primaryKey?.fields[0]
  if (!keyId) throw new Error('Missing validated primary key.')
  const key = databaseColumns(model, [keyId])[0]
  const owner = databaseColumns(model, [model.ownership.identityFieldId])[0]
  const table = sqlIdentifier('public') + '.' + sqlIdentifier(model.entity.name)
  const projection = model.resource.readFields
    .map((id) => {
      const field = model.entity.fields.find((entry) => entry.id === id)
      if (!field) throw new Error('Missing validated read projection.')
      return nestJSReadColumn(field) + ' AS ' + sqlIdentifier(id)
    })
    .join(', ')
  const fields = (ids: readonly string[]) =>
    ids.map((id, position) => ({ id, column: databaseColumns(model, ids)[position] }))
  const dtoNames = [
    ...(model.resource.operations.includes('create') ? ['Resource' + index + 'CreateDTO'] : []),
    ...(model.resource.operations.includes('update') ? ['Resource' + index + 'UpdateDTO'] : [])
  ]
  const tenantCreate = Boolean(model.authorization.insert.tenants?.length)
  const source = `import { Injectable, BadRequestException, NotFoundException${tenantCreate ? ', ForbiddenException' : ''} } from '@nestjs/common'
import { DatabaseService } from '../database.service.js'
import { createSubject, rowScope, ${tenantCreate ? 'tenantCreateScope, ' : ''}type VerifiedPrincipal } from '../identity.js'
import { listStatement, listPage } from '../list-query.js'
import type { ListQuery } from '../request-validation.js'
${dtoNames.length ? 'import type { ' + dtoNames.join(', ') + ' } from ' + JSON.stringify('./' + model.resource.id + '.dto.js') : ''}

const KEY = ${JSON.stringify(key)}
const OWNER = ${JSON.stringify(owner)}
const TABLE = ${JSON.stringify(table)}
const PROJECTION = ${JSON.stringify(projection)}
const ACCESS = ${JSON.stringify(model.authorization)} as const
const CREATE_FIELDS = ${JSON.stringify(fields(model.resource.createFields ?? []))} as const
const UPDATE_FIELDS = ${JSON.stringify(fields(model.resource.updateFields ?? []))} as const

@Injectable()
export class Resource${index}Service {
  constructor(private readonly database: DatabaseService) {}

${readMethods(model)}

${mutationMethods(model, index)}
}
`
  return nestJSArtifact('src/resources/' + model.resource.id + '.service.ts', source)
}
