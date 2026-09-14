export const COMMAND_EXECUTION_SOURCE = String.raw`import { ConflictException, NotFoundException } from '@nestjs/common'
import type { DatabaseTransaction } from './database.service.js'
import { commandDatetime, commandScalar, commandValue } from './command-input.js'
import type { CommandPlan, CommandRow, CommandStep } from './command-types.js'

function exactlyOne(rows: Record<string, unknown>[], missing: 'not-found' | 'conflict'): CommandRow {
  if (rows.length !== 1) {
    if (missing === 'not-found') throw new NotFoundException('Resource not found.')
    throw new ConflictException('Request conflict.')
  }
  const row: CommandRow = Object.create(null) as CommandRow
  for (const [key, value] of Object.entries(rows[0])) row[key] = commandScalar(value)
  return row
}

async function executeStep(client: DatabaseTransaction, step: CommandStep, input: CommandRow,
    results: Map<string, CommandRow>, subject: string): Promise<void> {
  const sources = step.kind === 'assert' ? [step.left, step.right] : step.kind === 'read' ? [step.key] : step.values.map(assignment => assignment.source)
  const needsClock = sources.some(source => source.kind === 'server-now' || source.kind === 'integer-arithmetic' && [source.left, source.right].some(leaf => leaf.kind === 'server-now'))
  // clock_timestamp is sampled after preceding row locks, never at transaction start or from caller input.
  const now = needsClock ? commandDatetime((await client.query('SELECT to_char(clock_timestamp() AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS now', [])).rows[0]?.now) : undefined
  const value = (source: Parameters<typeof commandValue>[0]) => commandValue(source, input, results, subject, now)
  if (step.kind === 'assert') {
    const left = value(step.left)
    const right = value(step.right)
    const matches = step.operator === 'eq' ? left === right : step.operator === 'neq' ? left !== right :
      step.comparison === 'datetime' && typeof left === 'string' && typeof right === 'string' ?
        (step.operator === 'gte' ? commandDatetime(left) >= commandDatetime(right) : commandDatetime(left) <= commandDatetime(right)) :
        typeof left === 'number' && typeof right === 'number' && (step.operator === 'gte' ? left >= right : left <= right)
    if (!matches) {
      if (step.error === 'not-found') throw new NotFoundException('Resource not found.')
      throw new ConflictException('Request conflict.')
    }
    return
  }
  if (step.kind === 'read') {
    const values = [value(step.key)]
    const owner = step.scope === 'owner' ? ' AND ' + step.ownerColumn + ' = $' + values.push(subject) : ''
    const response = await client.query('SELECT ' + step.projection + ' FROM ' + step.table +
      ' WHERE ' + step.keyColumn + ' = $1' + owner + ' FOR UPDATE', values)
    results.set(step.resultName, exactlyOne(response.rows, 'not-found'))
    return
  }
  const values = step.values.map((assignment) => value(assignment.source))
  let sql: string
  if (step.kind === 'insert') {
    sql = 'INSERT INTO ' + step.table + ' (' + step.values.map((assignment) => assignment.column).join(', ') +
      ') VALUES (' + values.map((_entry, index) => '$' + (index + 1)).join(', ') + ')'
  } else {
    const key = commandScalar(results.get(step.record)?.[step.keyField])
    const assignments = step.values.map((assignment, index) => assignment.column + ' = $' + (index + 1))
    sql = 'UPDATE ' + step.table + ' SET ' + assignments.join(', ') + ' WHERE ' + step.keyColumn + ' = $' + values.push(key)
  }
  const response = await client.query(sql + ' RETURNING ' + step.projection, values)
  results.set(step.resultName, exactlyOne(response.rows, 'conflict'))
}

export async function executeCommand(client: DatabaseTransaction, plan: CommandPlan, input: CommandRow, subject: string): Promise<CommandRow> {
  const results = new Map<string, CommandRow>()
  for (const step of plan.steps) await executeStep(client, step, input, results, subject)
  const row = results.get(plan.return.resultName)
  const response: CommandRow = Object.create(null) as CommandRow
  for (const field of plan.return.fields) response[field] = commandScalar(row?.[field])
  return response
}
`
