import { describe, expect, test } from 'bun:test'

import {
  fetchSupabaseDatabaseOpenAPI,
  projectRefFromSupabaseURL,
  SupabaseManagementError
} from '@/app/lowcode/supabase/management-client'

describe('Supabase Management OpenAPI client', () => {
  test('extracts project refs only from canonical HTTPS project URLs', () => {
    expect(projectRefFromSupabaseURL('https://abc-project.supabase.co/')).toBe('abc-project')
    expect(() => projectRefFromSupabaseURL('http://abc.supabase.co')).toThrow(
      SupabaseManagementError
    )
    expect(() => projectRefFromSupabaseURL('https://supabase.co/project/abc')).toThrow(
      'https://<project-ref>.supabase.co'
    )
    expect(() => projectRefFromSupabaseURL('https://abc.supabase.co/rest/v1')).toThrow(
      'no path, query, or credentials'
    )
  })

  test('requests the official endpoint with a bearer PAT and bounded transport options', async () => {
    let requestedURL = ''
    let requestedInit: RequestInit | undefined
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedURL = String(input)
      requestedInit = init
      return new Response(JSON.stringify({ definitions: { todos: { properties: {} } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as typeof fetch

    const result = await fetchSupabaseDatabaseOpenAPI(
      {
        projectUrl: 'https://project-ref.supabase.co',
        schema: 'private data',
        personalAccessToken: 'sbp_secret'
      },
      { fetchImpl }
    )

    expect(requestedURL).toBe(
      'https://api.supabase.com/v1/projects/project-ref/database/openapi?schema=private+data'
    )
    expect(requestedInit?.method).toBe('GET')
    expect(requestedInit?.credentials).toBe('omit')
    expect(requestedInit?.redirect).toBe('error')
    expect(new Headers(requestedInit?.headers).get('authorization')).toBe('Bearer sbp_secret')
    expect(result).toEqual({
      projectRef: 'project-ref',
      schema: 'private data',
      openApi: { definitions: { todos: { properties: {} } } }
    })
  })

  test('surfaces rate limits, permission failures, and oversized responses', async () => {
    const rateLimited = (() =>
      Promise.resolve(
        new Response(null, { status: 429, headers: { 'retry-after': '12' } })
      )) as typeof fetch
    await expect(
      fetchSupabaseDatabaseOpenAPI(
        {
          projectUrl: 'https://project-ref.supabase.co',
          personalAccessToken: 'pat'
        },
        { fetchImpl: rateLimited }
      )
    ).rejects.toMatchObject({
      code: 'rate-limited',
      status: 429,
      message: expect.stringContaining('12')
    })

    const forbidden = (() => Promise.resolve(new Response(null, { status: 403 }))) as typeof fetch
    await expect(
      fetchSupabaseDatabaseOpenAPI(
        {
          projectUrl: 'https://project-ref.supabase.co',
          personalAccessToken: 'pat'
        },
        { fetchImpl: forbidden }
      )
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 })

    const oversized = (() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-length': '1000' } })
      )) as typeof fetch
    await expect(
      fetchSupabaseDatabaseOpenAPI(
        {
          projectUrl: 'https://project-ref.supabase.co',
          personalAccessToken: 'pat'
        },
        { fetchImpl: oversized, maxResponseBytes: 10 }
      )
    ).rejects.toMatchObject({ code: 'response-too-large' })

    const echoedSecret = (() =>
      Promise.resolve(
        new Response('request failed for pat-do-not-expose', { status: 500 })
      )) as typeof fetch
    await expect(
      fetchSupabaseDatabaseOpenAPI(
        {
          projectUrl: 'https://project-ref.supabase.co',
          personalAccessToken: 'pat-do-not-expose'
        },
        { fetchImpl: echoedSecret }
      )
    ).rejects.not.toThrow('pat-do-not-expose')
  })

  test('aborts requests at the configured timeout without exposing the PAT', async () => {
    const pending = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })) as typeof fetch

    const result = fetchSupabaseDatabaseOpenAPI(
      {
        projectUrl: 'https://project-ref.supabase.co',
        personalAccessToken: 'do-not-expose'
      },
      { fetchImpl: pending, timeoutMs: 5 }
    )
    await expect(result).rejects.toMatchObject({ code: 'timeout' })
    await expect(result).rejects.not.toThrow('do-not-expose')
  })
})
