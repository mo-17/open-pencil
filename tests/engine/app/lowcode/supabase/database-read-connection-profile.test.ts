import { describe, expect, test } from 'bun:test'

import {
  SUPABASE_DATABASE_READ_CONNECTION_PROFILE_FORMAT,
  createSupabaseDatabaseReadConnectionProfileV1,
  digestSupabaseDatabaseReadConnectionProfileV1,
  parseSupabaseDatabaseReadConnectionProfileV1,
  serializeSupabaseDatabaseReadConnectionProfileV1
} from '@/app/lowcode/supabase/database-read-connection-profile'

const PROJECT_REF = 'abcdefghijklmnopqrst'
const ACCOUNT_ID = 'account.staging_01'

function directProfile() {
  return createSupabaseDatabaseReadConnectionProfileV1({
    projectRef: PROJECT_REF,
    accountId: ACCOUNT_ID,
    mode: 'direct'
  })
}

describe('Supabase database-read connection profile', () => {
  test('derives every direct connection field except the non-secret identity', () => {
    expect(directProfile()).toEqual({
      format: SUPABASE_DATABASE_READ_CONNECTION_PROFILE_FORMAT,
      version: 1,
      providerId: 'supabase',
      environment: 'staging',
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      mode: 'direct',
      host: `db.${PROJECT_REF}.supabase.co`,
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      tlsMode: 'verify-full'
    })
    expect(Object.isFrozen(directProfile())).toBe(true)
  })

  test('accepts only an explicit bounded Supavisor session host', async () => {
    const profile = createSupabaseDatabaseReadConnectionProfileV1({
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      mode: 'supavisor-session',
      sessionPoolerHost: 'aws-0-ap-southeast-1.pooler.supabase.com'
    })

    expect(profile.host).toBe('aws-0-ap-southeast-1.pooler.supabase.com')
    expect(profile.port).toBe(5432)
    expect(profile.user).toBe(`postgres.${PROJECT_REF}`)
    expect(profile.tlsMode).toBe('verify-full')
    expect(await digestSupabaseDatabaseReadConnectionProfileV1(profile)).toBe(
      'LDZUCdNRCwB-OXRw5lmcPZNmWB5Uahuf6iUhdI1bV7E'
    )
  })

  test('rejects transaction poolers, URLs, ports, paths, IPs, and unrelated domains', () => {
    for (const sessionPoolerHost of [
      'aws-0-ap-southeast-1.pooler.supabase.com:6543',
      'postgresql://aws-0-ap-southeast-1.pooler.supabase.com',
      'aws-0-ap-southeast-1.pooler.supabase.com/path',
      '127.0.0.1',
      'pooler.supabase.com',
      'aws-0-ap-southeast-1.pooler.supabase.com.evil.test',
      'AWS-0-ap-southeast-1.pooler.supabase.com',
      '-aws.pooler.supabase.com',
      'aws-.pooler.supabase.com'
    ]) {
      expect(() =>
        createSupabaseDatabaseReadConnectionProfileV1({
          projectRef: PROJECT_REF,
          accountId: ACCOUNT_ID,
          mode: 'supavisor-session',
          sessionPoolerHost
        })
      ).toThrow()
    }
  })

  test('rejects invalid project and account identities', () => {
    for (const projectRef of [PROJECT_REF.slice(1), `${PROJECT_REF}x`, PROJECT_REF.toUpperCase()]) {
      expect(() =>
        createSupabaseDatabaseReadConnectionProfileV1({
          projectRef,
          accountId: ACCOUNT_ID,
          mode: 'direct'
        })
      ).toThrow()
    }
    for (const accountId of ['', '.account', 'account/other', `a${'b'.repeat(128)}`]) {
      expect(() =>
        createSupabaseDatabaseReadConnectionProfileV1({
          projectRef: PROJECT_REF,
          accountId,
          mode: 'direct'
        })
      ).toThrow()
    }
    for (const accountId of [
      'anon',
      'service_role',
      'sbp_secret-shaped-value',
      'sb_publishable_secret-shaped-value',
      'sb_secret_secret-shaped-value',
      'eyJsecretShapedJwt'
    ]) {
      expect(() =>
        createSupabaseDatabaseReadConnectionProfileV1({
          projectRef: PROJECT_REF,
          accountId,
          mode: 'direct'
        })
      ).toThrow()
    }
  })

  test('strict parser rejects unknown fields and substitutions of fixed fields', () => {
    const profile = directProfile()
    for (const candidate of [
      { ...profile, extra: true },
      { ...profile, providerId: 'other' },
      { ...profile, environment: 'production' },
      { ...profile, host: 'db.attacker.invalid' },
      { ...profile, port: 6543 },
      { ...profile, database: 'other' },
      { ...profile, user: `postgres.${PROJECT_REF}` },
      { ...profile, tlsMode: 'require' },
      { ...profile, mode: 'transaction' }
    ]) {
      expect(() => parseSupabaseDatabaseReadConnectionProfileV1(candidate)).toThrow()
    }
  })

  test('snapshots data properties and rejects accessors, symbols, and exotic prototypes', () => {
    const profile = directProfile()
    let getterCalls = 0
    const accessor = { ...profile }
    Object.defineProperty(accessor, 'host', {
      enumerable: true,
      get() {
        getterCalls += 1
        return getterCalls === 1 ? profile.host : 'attacker.invalid'
      }
    })
    expect(() => parseSupabaseDatabaseReadConnectionProfileV1(accessor)).toThrow()
    expect(getterCalls).toBe(0)

    const symbol = { ...profile, [Symbol('hidden')]: true }
    expect(() => parseSupabaseDatabaseReadConnectionProfileV1(symbol)).toThrow()
    const exotic = Object.assign(Object.create({ inherited: true }), profile)
    expect(() => parseSupabaseDatabaseReadConnectionProfileV1(exotic)).toThrow()

    let proxyGetCalls = 0
    const proxy = new Proxy(
      { ...profile },
      {
        get() {
          proxyGetCalls += 1
          return 'attacker.invalid'
        }
      }
    )
    expect(parseSupabaseDatabaseReadConnectionProfileV1(proxy)).toEqual(profile)
    expect(proxyGetCalls).toBe(0)

    const throwingProxy = new Proxy(profile, {
      getPrototypeOf() {
        throw new Error('attacker supplied secret text')
      }
    })
    expect(() => parseSupabaseDatabaseReadConnectionProfileV1(throwingProxy)).toThrow(
      'could not be inspected safely'
    )
  })

  test('creator rejects connection strings and arbitrary connection options by shape', () => {
    for (const candidate of [
      {
        projectRef: PROJECT_REF,
        accountId: ACCOUNT_ID,
        mode: 'direct',
        dsn: 'postgresql://postgres:secret@example.test/postgres'
      },
      {
        projectRef: PROJECT_REF,
        accountId: ACCOUNT_ID,
        mode: 'direct',
        password: 'secret'
      },
      {
        projectRef: PROJECT_REF,
        accountId: ACCOUNT_ID,
        mode: 'direct',
        sslmode: 'disable'
      }
    ]) {
      expect(() =>
        createSupabaseDatabaseReadConnectionProfileV1(
          candidate as Parameters<typeof createSupabaseDatabaseReadConnectionProfileV1>[0]
        )
      ).toThrow()
    }
  })

  test('serialization and digest are canonical across property order', async () => {
    const profile = directProfile()
    const reordered = {
      tlsMode: profile.tlsMode,
      user: profile.user,
      database: profile.database,
      port: profile.port,
      host: profile.host,
      mode: profile.mode,
      accountId: profile.accountId,
      projectRef: profile.projectRef,
      environment: profile.environment,
      providerId: profile.providerId,
      version: profile.version,
      format: profile.format
    }

    expect(serializeSupabaseDatabaseReadConnectionProfileV1(reordered)).toBe(
      serializeSupabaseDatabaseReadConnectionProfileV1(profile)
    )
    const digest = await digestSupabaseDatabaseReadConnectionProfileV1(reordered)
    expect(digest).toBe(await digestSupabaseDatabaseReadConnectionProfileV1(profile))
    expect(digest).toBe('4hodbEkFZompjmmZ5HCeqfAJMqz67OWIyIjrF49SwfA')
  })
})
