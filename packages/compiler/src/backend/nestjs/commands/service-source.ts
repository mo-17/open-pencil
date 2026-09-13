import { NESTJS_COMMAND_LEDGER_TABLE } from './ledger'

export const COMMAND_SERVICE_SOURCE = String.raw`import { createHash } from 'node:crypto'
import { ConflictException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { DatabaseService } from './database.service.js'
import type { VerifiedPrincipal } from './identity.js'
import { commandInput, commandScalar } from './command-input.js'
import { executeCommand } from './command-execution.js'
import type { CommandPlan, CommandRow } from './command-types.js'

const TABLE = 'public.${NESTJS_COMMAND_LEDGER_TABLE}'
const HASH = (value: string) => createHash('sha256').update(value).digest('base64url')
const KEY = /^[A-Za-z0-9._:-]{16,128}$/
const WHERE = 'application_id=$1 AND command_id=$2 AND subject=$3 AND request_key=$4'

function storedResponse(source: unknown, fields: readonly string[]): CommandRow {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 65536)
    throw new ServiceUnavailableException('Service unavailable.')
  let parsed: unknown
  try { parsed = JSON.parse(source) } catch { throw new ServiceUnavailableException('Service unavailable.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      Object.keys(parsed).length !== fields.length || fields.some((field) => !Object.hasOwn(parsed, field)))
    throw new ServiceUnavailableException('Service unavailable.')
  const response: CommandRow = Object.create(null) as CommandRow
  for (const field of fields) response[field] = commandScalar(Reflect.get(parsed, field))
  return response
}

@Injectable()
export class CommandService {
  constructor(private readonly database: DatabaseService) {}

  async execute(plan: CommandPlan, principal: VerifiedPrincipal | null, key: string, body: unknown): Promise<CommandRow> {
    if (!principal) throw new UnauthorizedException('Authentication required.')
    if (plan.access.kind === 'role' && !principal.roles.includes(plan.access.roleId))
      throw new ForbiddenException('Access denied.')
    if (!KEY.test(key)) throw new ConflictException('Request conflict.')
    const input = commandInput(plan.parameters, body)
    const requestDigest = HASH(JSON.stringify(input))
    const identity = [plan.applicationId, plan.id, principal.subject, key]
    return this.database.transaction(async (client) => {
      const inserted = await client.query('INSERT INTO ' + TABLE +
        ' (application_id,command_id,subject,request_key,command_digest,request_digest) VALUES ($1,$2,$3,$4,$5,$6)' +
        ' ON CONFLICT (application_id,command_id,subject,request_key) DO NOTHING RETURNING request_key',
        [...identity, plan.digest, requestDigest])
      if (inserted.rows.length === 0) {
        // A distinct statement sees the concurrently committed winner at READ COMMITTED.
        const saved = (await client.query('SELECT command_digest,request_digest,response_json FROM ' + TABLE +
          ' WHERE ' + WHERE + ' FOR UPDATE', identity)).rows[0]
        if (!saved) throw new ServiceUnavailableException('Service unavailable.')
        if (saved.command_digest !== plan.digest || saved.request_digest !== requestDigest)
          throw new ConflictException('Request conflict.')
        return storedResponse(saved.response_json, plan.return.fields)
      }
      const response = await executeCommand(client, plan, input, principal.subject)
      const serialized = JSON.stringify(response)
      if (Buffer.byteLength(serialized, 'utf8') > 65536) throw new ConflictException('Request conflict.')
      const saved = await client.query('UPDATE ' + TABLE + ' SET response_json=$5 WHERE ' + WHERE,
        [...identity, serialized])
      if (saved.rowCount !== 1) throw new ServiceUnavailableException('Service unavailable.')
      return response
    })
  }
}
`
