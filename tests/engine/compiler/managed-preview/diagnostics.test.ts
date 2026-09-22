import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { DOCTOR_CHECKS_SOURCE } from '#compiler/backend/nestjs/local-run/doctor-checks'
import {
  parseManagedPreviewCommand,
  parseManagedPreviewEvent,
  type ManagedPreviewDiagnostic
} from '#compiler/managed-preview/protocol'

import { authenticationApplication } from '../backend/nestjs/browser-auth/helpers'

interface DoctorOptions {
  nodeVersion?: string
  tool?(command: string, args: string[]): void
  port?(port: number): Promise<void>
  fetch?(url: string): Promise<Response>
  database?(): Promise<void>
  migration?(): Promise<void>
  running?: boolean
}
const config = {
  issuer: 'http://127.0.0.1:4010',
  jwksURL: 'https://issuer.example/certs',
  caFile: '',
  webPort: 5181,
  apiPort: 3012,
  dbPort: 55443
}
async function doctor() {
  const directory = mkdtempSync(join(tmpdir(), 'doctor-shared-'))
  const file = join(directory, 'doctor.mjs')
  writeFileSync(file, DOCTOR_CHECKS_SOURCE)
  const module = (await import(pathToFileURL(file).href)) as {
    runDoctorChecks: (
      settings: typeof config,
      options: DoctorOptions
    ) => Promise<ManagedPreviewDiagnostic[]>
  }
  return {
    check: module.runDoctorChecks,
    close: () => rmSync(directory, { recursive: true, force: true })
  }
}
const options: DoctorOptions = {
  nodeVersion: '22.12.0',
  tool: () => undefined,
  port: async () => undefined,
  fetch: async (url) =>
    Response.json(
      url.endsWith('openid-configuration')
        ? { issuer: config.issuer, code_challenge_methods_supported: ['S256'] }
        : { keys: [{ kty: 'RSA', n: 'public', e: 'AQAB' }] }
    )
}

test('shared doctor checks are bounded, read-only and do not invent database readiness', async () => {
  const fixture = await doctor()
  const commands: string[] = []
  try {
    const checks = await fixture.check(config, {
      ...options,
      tool: (command, args) => commands.push([command, ...args].join(' '))
    })
    expect(checks).toHaveLength(10)
    expect(checks.filter(({ status }) => status === 'unavailable').map(({ code }) => code)).toEqual(
      ['database', 'migration']
    )
    expect(commands).toEqual(['npm --version', 'docker info --format {{.ServerVersion}}'])
    for (const diagnostic of checks)
      expect(
        parseManagedPreviewEvent({ version: 1, type: 'diagnostic', id: 'check', diagnostic })
      ).toMatchObject({ diagnostic })
    expect(JSON.stringify(checks)).not.toContain(config.issuer)
  } finally {
    fixture.close()
  }
})

test('moved certificate, TLS failure, occupied ports, unreachable DB and missing tools retain distinct codes', async () => {
  const fixture = await doctor()
  try {
    const checks = await fixture.check(
      { ...config, caFile: '/nonexistent/openpencil-ca.pem' },
      {
        ...options,
        tool: () => {
          throw Object.assign(new Error('private details'), { code: 'ENOENT' })
        },
        port: async () => {
          throw new Error('EADDRINUSE private process')
        },
        database: async () => {
          throw new Error('private credentials')
        },
        migration: async () => {
          throw new Error('private SQL')
        },
        fetch: async () => {
          throw Object.assign(new Error('fetch failed'), {
            cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }
          })
        }
      }
    )
    expect(checks).toContainEqual({ code: 'ca-file', status: 'missing' })
    expect(checks).toContainEqual({ code: 'jwks', status: 'tls' })
    expect(checks).toContainEqual({ code: 'database', status: 'failed' })
    expect(checks).toContainEqual({ code: 'api-port', status: 'failed' })
    expect(checks).toContainEqual({ code: 'npm-runtime', status: 'missing' })
    expect(JSON.stringify(checks)).not.toContain('private')
    const retry = await fixture.check(config, options)
    expect(retry.find(({ code }) => code === 'ca-file')?.status).toBe('passed')
    expect(retry.find(({ code }) => code === 'jwks')?.status).toBe('passed')
  } finally {
    fixture.close()
  }
})

test('diagnose is a separate command without SQL authority and rejects arbitrary report contents', () => {
  const value = {
    version: 1,
    id: 'check',
    command: 'diagnose',
    application: authenticationApplication(),
    config: {
      previewPort: 5181,
      apiPort: 3012,
      dbPort: 55443,
      audience: 'notes-api',
      jwksURL: config.jwksURL,
      caFile: ''
    }
  }
  expect(parseManagedPreviewCommand(value).command).toBe('diagnose')
  expect(() => parseManagedPreviewCommand({ ...value, planId: 'unexpected' })).toThrow()
  expect(() =>
    parseManagedPreviewEvent({
      version: 1,
      type: 'diagnostic',
      id: 'check',
      diagnostic: { code: 'jwks', status: 'passed', token: 'private' }
    })
  ).toThrow()
  expect(() =>
    parseManagedPreviewEvent({
      version: 1,
      type: 'diagnostic',
      id: 'check',
      diagnostic: { code: 'private arbitrary output', status: 'passed' }
    })
  ).toThrow()
})
