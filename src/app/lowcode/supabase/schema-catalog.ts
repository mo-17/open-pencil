export const SUPABASE_SCHEMA_CATALOG_VERSION = 1 as const

export const SUPABASE_SCHEMA_CATALOG_LIMITS = Object.freeze({
  maxTables: 256,
  maxColumnsPerTable: 512,
  maxRelationsPerTable: 512,
  maxNameLength: 128,
  maxTextLength: 2048,
  maxTypeLength: 128
})

export interface SupabaseSchemaColumn {
  name: string
  type: string
  required: boolean
  nullable: boolean
  format?: string
  description?: string
}

export interface SupabaseSchemaRelation {
  sourceColumn: string
  targetTable: string
  targetColumn?: string
}

export interface SupabaseSchemaTable {
  name: string
  description?: string
  required: string[]
  columns: SupabaseSchemaColumn[]
  relations: SupabaseSchemaRelation[]
}

export interface SupabaseSchemaCatalog {
  version: typeof SUPABASE_SCHEMA_CATALOG_VERSION
  projectRef: string
  schema: string
  tables: SupabaseSchemaTable[]
}

export interface SupabaseSchemaCatalogIdentity {
  projectRef: string
  schema: string
}

interface UnknownRecord {
  [key: string]: unknown
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true
  }
  return false
}

function boundedName(value: unknown, label: string): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || hasControlCharacters(name)) return null
  if (name.length > SUPABASE_SCHEMA_CATALOG_LIMITS.maxNameLength) {
    throw new Error(`${label} exceeds the schema catalog name limit.`)
  }
  return name
}

function boundedType(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const type = value.trim()
  if (!type) return null
  return type.slice(0, SUPABASE_SCHEMA_CATALOG_LIMITS.maxTypeLength)
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text.slice(0, SUPABASE_SCHEMA_CATALOG_LIMITS.maxTextLength) : undefined
}

function referenceTarget(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('#/')) return null
  const segment = value.split('/').at(-1)
  if (!segment) return null
  try {
    return boundedName(
      decodeURIComponent(segment.replaceAll('~1', '/').replaceAll('~0', '~')),
      'Reference'
    )
  } catch {
    return null
  }
}

function schemaVariants(schema: UnknownRecord): UnknownRecord[] {
  let value: unknown[] = []
  if (Array.isArray(schema.anyOf)) value = schema.anyOf
  else if (Array.isArray(schema.oneOf)) value = schema.oneOf
  return value.map(asRecord).filter((item): item is UnknownRecord => item !== null)
}

function schemaNullable(schema: UnknownRecord): boolean {
  if (schema.nullable === true) return true
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true
  return schemaVariants(schema).some((variant) => variant.type === 'null')
}

function schemaType(schema: UnknownRecord): string {
  const direct = boundedType(schema.type)
  if (direct === 'array') {
    const items = asRecord(schema.items)
    return `${items ? schemaType(items) : 'unknown'}[]`
  }
  if (direct && direct !== 'null') return direct
  if (Array.isArray(schema.type)) {
    const types = schema.type
      .map(boundedType)
      .filter((value): value is string => value !== null && value !== 'null')
    if (types.length > 0)
      return types.join(' | ').slice(0, SUPABASE_SCHEMA_CATALOG_LIMITS.maxTypeLength)
  }
  const variants = schemaVariants(schema)
    .filter((variant) => variant.type !== 'null')
    .map(schemaType)
  if (variants.length > 0) {
    return [...new Set(variants)].join(' | ').slice(0, SUPABASE_SCHEMA_CATALOG_LIMITS.maxTypeLength)
  }
  if (referenceTarget(schema.$ref)) return 'object'
  return 'unknown'
}

function relation(
  sourceColumn: string,
  targetTableValue: unknown,
  targetColumnValue?: unknown
): SupabaseSchemaRelation | null {
  const targetTable = boundedName(targetTableValue, 'Relation table')
  if (!targetTable) return null
  const targetColumn = boundedName(targetColumnValue, 'Relation column')
  return {
    sourceColumn,
    targetTable,
    ...(targetColumn ? { targetColumn } : {})
  }
}

function relationFromString(sourceColumn: string, value: string): SupabaseSchemaRelation | null {
  const referencedTable = referenceTarget(value)
  if (referencedTable) return relation(sourceColumn, referencedTable)
  const parts = value
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  return relation(sourceColumn, parts.at(-2), parts.at(-1))
}

function firstText(record: UnknownRecord, fields: readonly string[]): unknown {
  for (const field of fields) {
    if (typeof record[field] === 'string') return record[field]
  }
  return undefined
}

function firstArrayText(record: UnknownRecord, fields: readonly string[]): unknown {
  for (const field of fields) {
    const value = record[field]
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  }
  return undefined
}

function relationFromValue(sourceColumn: string, value: unknown): SupabaseSchemaRelation | null {
  if (typeof value === 'string') return relationFromString(sourceColumn, value)
  const record = asRecord(value)
  if (!record) return null
  const localColumn =
    boundedName(
      firstText(record, ['sourceColumn', 'localColumn']) ??
        firstArrayText(record, ['columns', 'sourceColumns']),
      'Relation source column'
    ) ?? sourceColumn
  const targetTable = firstText(record, [
    'targetTable',
    'foreignTable',
    'referencedTable',
    'referencedRelation',
    'table'
  ])
  const targetColumn =
    firstText(record, ['targetColumn', 'foreignColumn', 'referencedColumn', 'column']) ??
    firstArrayText(record, ['referencedColumns', 'targetColumns'])
  return relation(localColumn, targetTable, targetColumn)
}

function descriptionRelations(
  sourceColumn: string,
  description: unknown
): SupabaseSchemaRelation[] {
  if (typeof description !== 'string') return []
  const relations: SupabaseSchemaRelation[] = []
  for (const match of description.matchAll(/<fk\b([^>]*)\/?\s*>/gi)) {
    const attributes: UnknownRecord = {}
    for (const attribute of match[1].matchAll(/([a-z][\w-]*)\s*=\s*(['"])(.*?)\2/gi)) {
      attributes[attribute[1].toLowerCase()] = attribute[3]
    }
    const candidate = relation(sourceColumn, attributes.table, attributes.column)
    if (candidate) relations.push(candidate)
    if (relations.length > SUPABASE_SCHEMA_CATALOG_LIMITS.maxRelationsPerTable) {
      throw new Error('Table exceeds the schema catalog relation limit.')
    }
  }
  return relations
}

function propertyRelations(
  sourceColumn: string,
  property: UnknownRecord
): SupabaseSchemaRelation[] {
  const relations = descriptionRelations(sourceColumn, property.description)
  const referencedTable =
    referenceTarget(property.$ref) ?? referenceTarget(asRecord(property.items)?.$ref)
  if (referencedTable) {
    const candidate = relation(sourceColumn, referencedTable)
    if (candidate) relations.push(candidate)
  }
  for (const field of ['x-foreign-key', 'x-foreignKey', 'x-relationship']) {
    const candidate = relationFromValue(sourceColumn, property[field])
    if (candidate) relations.push(candidate)
  }
  return relations
}

function tableRelations(table: UnknownRecord): SupabaseSchemaRelation[] {
  const values = table['x-relationships'] ?? table['x-relations']
  if (!Array.isArray(values)) return []
  if (values.length > SUPABASE_SCHEMA_CATALOG_LIMITS.maxRelationsPerTable) {
    throw new Error('Table exceeds the schema catalog relation limit.')
  }
  return values
    .map((value) => relationFromValue('', value))
    .filter(
      (candidate): candidate is SupabaseSchemaRelation =>
        candidate !== null && candidate.sourceColumn !== ''
    )
}

function uniqueRelations(relations: readonly SupabaseSchemaRelation[]): SupabaseSchemaRelation[] {
  const unique = new Map<string, SupabaseSchemaRelation>()
  for (const item of relations) {
    const key = `${item.sourceColumn}\u0000${item.targetTable}\u0000${item.targetColumn ?? ''}`
    unique.set(key, item)
  }
  const result = [...unique.values()].sort((left, right) =>
    `${left.sourceColumn}.${left.targetTable}.${left.targetColumn ?? ''}`.localeCompare(
      `${right.sourceColumn}.${right.targetTable}.${right.targetColumn ?? ''}`
    )
  )
  if (result.length > SUPABASE_SCHEMA_CATALOG_LIMITS.maxRelationsPerTable) {
    throw new Error('Table exceeds the schema catalog relation limit.')
  }
  return result
}

function definitionMap(openAPI: UnknownRecord): UnknownRecord {
  const definitions = asRecord(openAPI.definitions)
  if (definitions) return definitions
  const components = asRecord(openAPI.components)
  const schemas = asRecord(components?.schemas)
  if (schemas) return schemas
  throw new Error('Supabase OpenAPI response does not contain definitions or components.schemas.')
}

function cleanDescription(value: unknown): string | undefined {
  return boundedText(
    typeof value === 'string' ? value.replace(/<fk\b[^>]*\/?\s*>/gi, '').trim() : value
  )
}

function parseTable(name: string, value: unknown): SupabaseSchemaTable | null {
  const table = asRecord(value)
  if (!table) return null
  const properties = asRecord(table.properties) ?? {}
  const entries = Object.entries(properties)
  if (entries.length > SUPABASE_SCHEMA_CATALOG_LIMITS.maxColumnsPerTable) {
    throw new Error(`Table "${name}" exceeds the schema catalog column limit.`)
  }
  if (
    Array.isArray(table.required) &&
    table.required.length > SUPABASE_SCHEMA_CATALOG_LIMITS.maxColumnsPerTable
  ) {
    throw new Error(`Table "${name}" exceeds the schema catalog required-column limit.`)
  }
  const requiredNames = new Set(
    Array.isArray(table.required)
      ? table.required
          .map((item) => boundedName(item, 'Required column'))
          .filter((item): item is string => item !== null)
      : []
  )
  const relations: SupabaseSchemaRelation[] = [...tableRelations(table)]
  const columns: SupabaseSchemaColumn[] = []
  for (const [rawColumnName, rawProperty] of entries) {
    const columnName = boundedName(rawColumnName, 'Column name')
    const property = asRecord(rawProperty)
    if (!columnName || !property) continue
    const description = cleanDescription(property.description)
    const format = boundedType(property.format)
    columns.push({
      name: columnName,
      type: schemaType(property),
      required: requiredNames.has(columnName),
      nullable: schemaNullable(property),
      ...(format ? { format } : {}),
      ...(description ? { description } : {})
    })
    relations.push(...propertyRelations(columnName, property))
  }
  columns.sort((left, right) => left.name.localeCompare(right.name))
  const columnNames = new Set(columns.map((column) => column.name))
  const required = columns.filter((column) => column.required).map((column) => column.name)
  const validRelations = uniqueRelations(
    relations.filter((item) => columnNames.has(item.sourceColumn))
  )
  const description = cleanDescription(table.description)
  return {
    name,
    ...(description ? { description } : {}),
    required,
    columns,
    relations: validRelations
  }
}

export function parseSupabaseSchemaCatalog(
  openAPI: unknown,
  identity: SupabaseSchemaCatalogIdentity
): SupabaseSchemaCatalog {
  const root = asRecord(openAPI)
  if (!root) throw new Error('Supabase OpenAPI response must be an object.')
  const projectRef = boundedName(identity.projectRef, 'Project reference')
  const schema = boundedName(identity.schema, 'Schema name')
  if (!projectRef || !schema) throw new Error('Schema catalog identity is invalid.')
  const definitions = definitionMap(root)
  const entries = Object.entries(definitions)
  if (entries.length > SUPABASE_SCHEMA_CATALOG_LIMITS.maxTables) {
    throw new Error('Supabase schema exceeds the schema catalog table limit.')
  }
  const tables = entries
    .map(([rawName, value]) => {
      const name = boundedName(rawName, 'Table name')
      return name ? parseTable(name, value) : null
    })
    .filter((table): table is SupabaseSchemaTable => table !== null)
    .sort((left, right) => left.name.localeCompare(right.name))
  return {
    version: SUPABASE_SCHEMA_CATALOG_VERSION,
    projectRef,
    schema,
    tables
  }
}

function validateColumn(value: unknown): SupabaseSchemaColumn | null {
  const column = asRecord(value)
  if (!column) return null
  const name = boundedName(column.name, 'Cached column name')
  const type = boundedType(column.type)
  if (
    !name ||
    !type ||
    typeof column.required !== 'boolean' ||
    typeof column.nullable !== 'boolean'
  ) {
    return null
  }
  const format = column.format === undefined ? undefined : boundedType(column.format)
  if (column.format !== undefined && !format) return null
  const description = column.description === undefined ? undefined : boundedText(column.description)
  if (column.description !== undefined && !description) return null
  return {
    name,
    type,
    required: column.required,
    nullable: column.nullable,
    ...(format ? { format } : {}),
    ...(description ? { description } : {})
  }
}

function validateRelation(value: unknown): SupabaseSchemaRelation | null {
  const item = asRecord(value)
  if (!item) return null
  const sourceColumn = boundedName(item.sourceColumn, 'Cached relation source')
  const targetTable = boundedName(item.targetTable, 'Cached relation table')
  if (!sourceColumn || !targetTable) return null
  const targetColumn =
    item.targetColumn === undefined
      ? undefined
      : boundedName(item.targetColumn, 'Cached relation column')
  if (item.targetColumn !== undefined && !targetColumn) return null
  return {
    sourceColumn,
    targetTable,
    ...(targetColumn ? { targetColumn } : {})
  }
}

function validateTable(value: unknown): SupabaseSchemaTable | null {
  const table = asRecord(value)
  if (!table) return null
  const name = boundedName(table.name, 'Cached table name')
  const description = table.description === undefined ? undefined : boundedText(table.description)
  if (!name || (table.description !== undefined && !description)) return null
  if (
    !Array.isArray(table.required) ||
    table.required.length > SUPABASE_SCHEMA_CATALOG_LIMITS.maxColumnsPerTable ||
    !Array.isArray(table.columns) ||
    table.columns.length > SUPABASE_SCHEMA_CATALOG_LIMITS.maxColumnsPerTable ||
    !Array.isArray(table.relations) ||
    table.relations.length > SUPABASE_SCHEMA_CATALOG_LIMITS.maxRelationsPerTable
  ) {
    return null
  }

  const columns = table.columns.map(validateColumn)
  if (columns.some((column) => column === null)) return null
  const normalizedColumns = columns.filter(
    (column): column is SupabaseSchemaColumn => column !== null
  )
  normalizedColumns.sort((left, right) => left.name.localeCompare(right.name))
  const columnNames = new Set(normalizedColumns.map((column) => column.name))
  if (columnNames.size !== normalizedColumns.length) return null

  const declaredRequired = table.required.map((item) => boundedName(item, 'Cached required column'))
  if (declaredRequired.some((item) => item === null)) return null
  const required = normalizedColumns
    .filter((column) => column.required)
    .map((column) => column.name)
  if (
    declaredRequired.length !== required.length ||
    !declaredRequired.every((item) => item !== null && required.includes(item))
  ) {
    return null
  }

  const relations = table.relations.map(validateRelation)
  if (relations.some((item) => item === null)) return null
  const normalizedRelations = uniqueRelations(
    relations.filter(
      (item): item is SupabaseSchemaRelation => item !== null && columnNames.has(item.sourceColumn)
    )
  )
  if (normalizedRelations.length !== relations.length) return null

  return {
    name,
    ...(description ? { description } : {}),
    required,
    columns: normalizedColumns,
    relations: normalizedRelations
  }
}

export function validateSupabaseSchemaCatalog(
  value: unknown,
  expected?: SupabaseSchemaCatalogIdentity
): SupabaseSchemaCatalog | null {
  try {
    const catalog = asRecord(value)
    if (!catalog || catalog.version !== SUPABASE_SCHEMA_CATALOG_VERSION) return null
    const projectRef = boundedName(catalog.projectRef, 'Cached project reference')
    const schema = boundedName(catalog.schema, 'Cached schema name')
    if (!projectRef || !schema || !Array.isArray(catalog.tables)) return null
    if (catalog.tables.length > SUPABASE_SCHEMA_CATALOG_LIMITS.maxTables) return null
    const tables = catalog.tables.map(validateTable)
    if (tables.some((table) => table === null)) return null
    const normalizedTables = tables.filter((table): table is SupabaseSchemaTable => table !== null)
    normalizedTables.sort((left, right) => left.name.localeCompare(right.name))
    if (new Set(normalizedTables.map((table) => table.name)).size !== normalizedTables.length) {
      return null
    }
    if (expected && (projectRef !== expected.projectRef || schema !== expected.schema)) return null
    return {
      version: SUPABASE_SCHEMA_CATALOG_VERSION,
      projectRef,
      schema,
      tables: normalizedTables
    }
  } catch {
    return null
  }
}
