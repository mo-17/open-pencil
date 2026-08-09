import { describe, expect, test } from 'bun:test'

import { GoogleDriveClient } from '@/app/integrations/storage/google-drive/client'
import type { GoogleDriveOAuthToken } from '@/app/integrations/storage/google-drive/types'

const TOKEN: GoogleDriveOAuthToken = {
  accessToken: 'access-token',
  accountId: 'oidc-subject-1',
  authorizationVersion: 'grant-1'
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(value), { ...init, headers })
}

function uploadedFile(): Record<string, unknown> {
  return {
    id: 'document_1',
    name: 'document_1.fig',
    mimeType: 'application/octet-stream',
    modifiedTime: '2026-08-09T01:02:03.000Z',
    size: '1',
    version: '1',
    trashed: false,
    appProperties: { openPencil: 'document-v1' }
  }
}

describe('GoogleDriveClient rate-limit retries', () => {
  test('retries a reason-classified 403 on an ordinary request', async () => {
    const sleeps: number[] = []
    let calls = 0
    const client = new GoogleDriveClient({
      tokenSource: { getAccessToken: () => Promise.resolve(TOKEN) },
      transport: () => {
        calls++
        return Promise.resolve(
          calls === 1
            ? jsonResponse(
                {
                  error: {
                    message: 'User rate limit exceeded',
                    errors: [{ reason: 'userRateLimitExceeded' }]
                  }
                },
                { status: 403, headers: { 'retry-after': '2' } }
              )
            : jsonResponse({ ids: ['document_1'] })
        )
      },
      sleep: (delayMs) => {
        sleeps.push(delayMs)
        return Promise.resolve()
      }
    })

    await expect(client.generateIds()).resolves.toEqual(['document_1'])
    expect(calls).toBe(2)
    expect(sleeps).toEqual([2_000])
  })

  test('retries a reason-classified 403 during resumable upload recovery', async () => {
    const sleeps: number[] = []
    let calls = 0
    const client = new GoogleDriveClient({
      tokenSource: { getAccessToken: () => Promise.resolve(TOKEN) },
      transport: () => {
        calls++
        if (calls === 1) {
          return Promise.resolve(
            new Response(null, {
              headers: {
                location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=rate-limit'
              }
            })
          )
        }
        if (calls === 2) {
          return Promise.resolve(
            jsonResponse(
              {
                error: {
                  message: 'Rate limit exceeded',
                  errors: [{ reason: 'rateLimitExceeded' }]
                }
              },
              { status: 403, headers: { 'retry-after': '1' } }
            )
          )
        }
        if (calls === 3) return Promise.resolve(new Response(null, { status: 308 }))
        return Promise.resolve(jsonResponse(uploadedFile(), { headers: { etag: '"uploaded"' } }))
      },
      sleep: (delayMs) => {
        sleeps.push(delayMs)
        return Promise.resolve()
      }
    })

    await expect(
      client.createFile({
        id: 'document_1',
        bytes: new Uint8Array([1]),
        metadata: { name: 'test.fig' }
      })
    ).resolves.toMatchObject({ remoteRevision: { etag: '"uploaded"' } })
    expect(calls).toBe(4)
    expect(sleeps).toEqual([1_000])
  })
})
