import { describe, expect, test } from 'bun:test'

import {
  createSupabaseManagementNativeBridge,
  nativeSupabaseManagementError,
  SupabaseManagementNativeError,
  type SupabaseManagementNativeInvoke,
  type SupabaseManagementPgCatalogInspectResultV1
} from '@/app/tauri/supabase-management'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const ORGANIZATION_ID = 'organization-123'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'

function result(): SupabaseManagementPgCatalogInspectResultV1 {
  return {
    projectRef: PROJECT_REF,
    organizationId: ORGANIZATION_ID,
    grantGeneration: GRANT_GENERATION,
    queryVersion: 'openpencil-pg-catalog-v6',
    queryDigest: 'A'.repeat(43),
    queryResponse: []
  }
}

describe('Supabase Management native bridge', () => {
  test('sends only reviewed binding metadata across IPC', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const invoke: SupabaseManagementNativeInvoke = <T>(
      command: string,
      args?: Record<string, unknown>
    ) => {
      calls.push({ command, args })
      return Promise.resolve(result() as T)
    }
    const bridge = createSupabaseManagementNativeBridge(invoke)

    expect(
      await bridge.inspectPgCatalogV1({
        projectRef: PROJECT_REF,
        expectedOrganizationId: ORGANIZATION_ID,
        expectedGrantGeneration: GRANT_GENERATION
      })
    ).toEqual(result())
    expect(calls).toEqual([
      {
        command: 'supabase_management_inspect_pg_catalog_v1',
        args: {
          request: {
            projectRef: PROJECT_REF,
            expectedOrganizationId: ORGANIZATION_ID,
            expectedGrantGeneration: GRANT_GENERATION
          }
        }
      }
    ])
    const serialized = JSON.stringify(calls)
    for (const forbidden of [
      'personalAccessToken',
      'authorization',
      'queryResponse',
      'SELECT',
      'https://',
      'method',
      'headers',
      'body'
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test('maps only bounded structured native error metadata', () => {
    const error = nativeSupabaseManagementError({
      code: 'http-error',
      message: 'provider controlled secret',
      httpStatus: 429,
      retryAfterSeconds: 60
    })
    expect(error).toBeInstanceOf(SupabaseManagementNativeError)
    expect(error).toMatchObject({
      code: 'http-error',
      httpStatus: 429,
      retryAfterSeconds: 60
    })
    expect(error.message).not.toContain('provider controlled secret')

    expect(
      nativeSupabaseManagementError({
        code: 'write-credential-missing',
        message: 'provider controlled secret'
      })
    ).toMatchObject({
      code: 'write-credential-missing',
      message: 'The independent Supabase Management database-write credential is not configured'
    })
    expect(
      nativeSupabaseManagementError({
        code: 'credential-not-independent',
        message: 'provider controlled secret'
      })
    ).toMatchObject({
      code: 'credential-not-independent',
      message: 'The Supabase Management read and database-write credentials must be independent'
    })
  })

  test('preserves an explicit review-only null organization binding', async () => {
    const requests: unknown[] = []
    const bridge = createSupabaseManagementNativeBridge(<T>(_command, args) => {
      requests.push(args?.request)
      return Promise.resolve(result() as T)
    })

    await bridge.inspectPgCatalogV1({
      projectRef: PROJECT_REF,
      expectedOrganizationId: null,
      expectedGrantGeneration: GRANT_GENERATION
    })
    expect(requests).toEqual([
      {
        projectRef: PROJECT_REF,
        expectedOrganizationId: null,
        expectedGrantGeneration: GRANT_GENERATION
      }
    ])
  })

  test('does not invoke native code when already aborted', async () => {
    let calls = 0
    const bridge = createSupabaseManagementNativeBridge(<T>() => {
      calls += 1
      return Promise.resolve(result() as T)
    })
    const controller = new AbortController()
    const reason = new DOMException('stop', 'AbortError')
    controller.abort(reason)

    await expect(
      bridge.inspectPgCatalogV1(
        {
          projectRef: PROJECT_REF,
          expectedOrganizationId: ORGANIZATION_ID,
          expectedGrantGeneration: GRANT_GENERATION
        },
        controller.signal
      )
    ).rejects.toBe(reason)
    expect(calls).toBe(0)
  })
})
