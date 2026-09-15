import { nestJSArtifact } from '../artifact'

export const PRISMA_CRM_DATABASE_IMPORT =
  "import { createCRMPrismaDatabase, type CRMPrismaDatabase } from './prisma/database.js'\n"
export const PRISMA_CRM_QUERY_SOURCE = `  async prismaQuery<T>(operation: (database: CRMPrismaDatabase) => Promise<T>): Promise<T> {
    if (this.closing || this.active >= 16) throw new ServiceUnavailableException('Database operation unavailable.')
    this.active += 1
    try { return await operation(this.prisma) }
    catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException('Database operation unavailable.')
    } finally { this.active -= 1 }
  }

`

const DATABASE_SOURCE = `import postgres from '@prisma/orm-postgres/runtime'
import type { Pool } from 'pg'
import type { Contract } from './contract.d.js'
import contractJson from './contract.json' with { type: 'json' }

export function createCRMPrismaDatabase(pool: Pool) {
  // SQL migrations own the database. This is not a Prisma schema verification gate.
  return postgres<Contract>({ contractJson, pg: pool, verifyMarker: false })
}

export type CRMPrismaDatabase = ReturnType<typeof createCRMPrismaDatabase>
`
const TIMESTAMP_SOURCE = String.raw`/** Preserve PostgreSQL microseconds when mapping the Prisma string codec to the existing HTTP API. */
export function crmTimestamp(value: string): string {
  const matched = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value)
  if (!matched) throw new Error('Unexpected database timestamp')
  const offset = matched[4]
  const zone = offset === 'Z' ? 'Z' : offset.length === 3 ? offset + ':00' : offset
  const seconds = new Date(matched[1] + 'T' + matched[2] + zone)
  if (!Number.isFinite(seconds.getTime())) throw new Error('Unexpected database timestamp')
  return seconds.toISOString().slice(0, 19) + '.' + (matched[3] ?? '').padEnd(6, '0') + 'Z'
}
`

export function emitPrismaCRMRuntime() {
  return [
    nestJSArtifact('src/prisma/database.ts', DATABASE_SOURCE),
    nestJSArtifact('src/prisma/timestamp.ts', TIMESTAMP_SOURCE)
  ]
}
