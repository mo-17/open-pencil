import type { BackendArtifactSource } from '#compiler/backend/contracts'

import { runtimeArtifact } from './artifact'

const SERVICE_SOURCE = String.raw`import { ConflictException, HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import type { OnModuleDestroy } from '@nestjs/common'
import { Pool } from 'pg'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import { requiredEnvironment } from './environment.js'

export interface DatabaseTransaction {
  query(text: string, values?: unknown[]): Promise<QueryResult<Record<string, unknown>>>
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool
  private readonly logger = new Logger(DatabaseService.name)
  private active = 0
  private closing = false

  constructor() {
    const connectionString = requiredEnvironment('DATABASE_URL', 8192)
    try {
      const url = new URL(connectionString)
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
          !url.username || !url.password || url.pathname.length < 2 || url.hash) {
        throw new Error('Invalid database URL.')
      }
      const host = url.hostname.replace(/^\[|\]$/g, '')
      const loopback = host === '127.0.0.1' || host === '::1'
      const modes = url.searchParams.getAll('sslmode')
      const mode = modes[0]
      if ([...url.searchParams.keys()].some((key) => key !== 'sslmode') || modes.length > 1 ||
          (mode !== undefined && mode !== 'require' && mode !== 'verify-full' &&
            !(loopback && mode === 'disable'))) throw new Error('Invalid database URL.')
      const pass = decodeURIComponent(url.password)
      this.pool = new Pool({
        host,
        port: url.port ? Number(url.port) : 5432,
        user: decodeURIComponent(url.username),
        password: pass,
        database: decodeURIComponent(url.pathname.slice(1)),
        ssl: !loopback || mode === 'require' || mode === 'verify-full'
          ? { rejectUnauthorized: true }
          : false,
        max: 4,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        statement_timeout: 5000,
        query_timeout: 6000,
        idle_in_transaction_session_timeout: 5000,
        application_name: 'openpencil-nestjs',
      })
      this.pool.on('error', () => this.logger.warn('An idle database connection failed.'))
    } catch {
      throw new Error('Backend runtime configuration is invalid.')
    }
  }

  async query<T extends QueryResultRow>(text: string, values: unknown[]): Promise<QueryResult<T>> {
    if (this.closing || this.active >= 16) {
      throw new ServiceUnavailableException('Database operation unavailable.')
    }
    this.active += 1
    try {
      return await this.pool.query<T>(text, values)
    } catch {
      throw new ServiceUnavailableException('Database operation unavailable.')
    } finally {
      this.active -= 1
    }
  }

  async transaction<T>(operation: (client: DatabaseTransaction) => Promise<T>): Promise<T> {
    if (this.closing || this.active >= 16) throw new ServiceUnavailableException('Database operation unavailable.')
    this.active += 1
    let client: PoolClient | undefined
    let discard = false
    try {
      client = await this.pool.connect()
      const connection = client
      await connection.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      await connection.query("SET LOCAL lock_timeout = '3s'")
      const deadline = Date.now() + 10000
      const bounded: DatabaseTransaction = {
        query: async (text, values = []) => {
          const remaining = Math.min(5000, deadline - Date.now())
          if (remaining <= 0) throw new ServiceUnavailableException('Database operation unavailable.')
          await connection.query("SELECT set_config('statement_timeout', $1, true)", [String(remaining)])
          return connection.query<Record<string, unknown>>(text, values)
        },
      }
      const result = await operation(bounded)
      await connection.query('COMMIT')
      return result
    } catch (error) {
      if (client) {
        try { await client.query('ROLLBACK') } catch { discard = true }
      }
      if (error instanceof HttpException) throw error
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (typeof code === 'string' && ['23505', '23503', '23514', '22003'].includes(code))
        throw new ConflictException('Request conflict.')
      throw new ServiceUnavailableException('Database operation unavailable.')
    } finally {
      client?.release(discard)
      this.active -= 1
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true
    try {
      await this.pool.end()
    } catch {
      this.logger.warn('Database shutdown failed.')
    }
  }
}
`

const MODULE_SOURCE = `import { Global, Module } from '@nestjs/common'
import { DatabaseService } from './database.service.js'

@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
`

export function emitDatabaseArtifacts(): BackendArtifactSource[] {
  return [
    runtimeArtifact('database.service.ts', SERVICE_SOURCE),
    runtimeArtifact('database.module.ts', MODULE_SOURCE)
  ]
}
