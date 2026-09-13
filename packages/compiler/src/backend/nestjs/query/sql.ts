export const LIST_SQL_SOURCE = String.raw`
interface ListStatement {
  readonly projection: string
  readonly table: string
  readonly key: string
  readonly where: string
}
function readSort(field: QueryField): string {
  if (field.type === 'date') return "to_char(" + field.column + ", 'YYYY-MM-DD')"
  if (field.type === 'datetime') return "to_char(" + field.column + " AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')"
  return field.column
}
/** All identifiers come from the validated generated specification; request values are parameters. */
export function listStatement(statement: ListStatement, query: ListQuery, values: unknown[]): string {
  const bind = (value: unknown) => '$' + values.push(value)
  const predicates: string[] = ['(' + statement.where + ')']
  for (const { field, value } of query.filter) {
    predicates.push(field.column + (value === null ? ' IS NULL' : ' = ' + bind(value)))
  }
  if (query.search) {
    const pattern = '%' + query.search.value.replace(/[\\%_]/gu, (character) => '\\' + character) + '%'
    const parameter = bind(pattern)
    predicates.push('(' + query.search.fields.map((field) => field.column + ' ILIKE ' + parameter + " ESCAPE E'\\\\'").join(' OR ') + ')')
  }
  const direction = query.direction === 'desc' ? ' DESC' : ' ASC'
  const comparison = query.direction === 'desc' ? ' < ' : ' > '
  const sort = query.sort
  if (sort && query.cursor) {
    predicates.push('(' + sort.column + ', ' + statement.key + ')' + comparison + '(' + bind(query.cursor.value) + ', ' + bind(query.cursor.id) + ')')
  } else if (query.after) predicates.push(statement.key + ' > ' + bind(query.after))
  const projection = statement.projection + ', ' + statement.key + ' AS "__openpencil_cursor"' +
    (sort ? ', ' + readSort(sort) + ' AS "__openpencil_sort"' : '')
  const order = (sort ? sort.column + direction + ', ' : '') + statement.key + direction
  return 'SELECT ' + projection + ' FROM ' + statement.table + ' WHERE ' + predicates.join(' AND ') +
    ' ORDER BY ' + order + ' LIMIT ' + bind(query.limit + 1)
}
export function listPage(rows: readonly Record<string, unknown>[], query: ListQuery) {
  const page = rows.slice(0, query.limit)
  const last = page[page.length - 1]
  let nextCursor: string | null = null
  if (rows.length > query.limit && last) {
    const id = itemId(last.__openpencil_cursor)
    nextCursor = query.sort ? Buffer.from(JSON.stringify([query.sort.id, query.direction, query.context,
      scalar(last.__openpencil_sort, query.sort), id])).toString('base64url') : id
  }
  return { data: page.map(({ __openpencil_cursor, __openpencil_sort, ...row }) => row), nextCursor }
}
`
