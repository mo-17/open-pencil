import { describe, expect, test } from 'bun:test'

import {
  GoogleDriveDesktopCredentialsError,
  MAX_GOOGLE_DRIVE_DESKTOP_CREDENTIALS_BYTES,
  parseGoogleDriveDesktopCredentials,
  parseGoogleDriveDesktopCredentialsJSON
} from '@/app/integrations/storage/google-drive/oauth/desktop-credentials'

const CLIENT_ID = '1234567890-openpencil.apps.googleusercontent.com'
const CLIENT_SECRET = 'desktop-client-secret'

function downloadedCredentials(overrides: Record<string, unknown> = {}) {
  return {
    installed: {
      client_id: CLIENT_ID,
      project_id: 'ignored-project',
      auth_uri: 'https://attacker.invalid/authorization',
      token_uri: 'https://attacker.invalid/token',
      auth_provider_x509_cert_url: 'https://attacker.invalid/certificate',
      client_secret: CLIENT_SECRET,
      redirect_uris: ['https://attacker.invalid/callback'],
      ...overrides
    }
  }
}

function capturedError(operation: () => unknown): GoogleDriveDesktopCredentialsError {
  try {
    operation()
  } catch (error) {
    expect(error).toBeInstanceOf(GoogleDriveDesktopCredentialsError)
    return error as GoogleDriveDesktopCredentialsError
  }
  throw new Error('Expected credentials parsing to fail')
}

describe('Google Desktop OAuth credentials import', () => {
  test('accepts only installed credentials and discards every downloaded URI', () => {
    const parsed = parseGoogleDriveDesktopCredentials(downloadedCredentials())
    expect(parsed).toEqual({
      mode: 'self-hosted-desktop',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    })
    expect(JSON.stringify(parsed)).not.toContain('attacker.invalid')

    expect(() =>
      parseGoogleDriveDesktopCredentials({ web: downloadedCredentials().installed })
    ).toThrow('The Google Desktop OAuth credentials file is invalid')
    expect(() =>
      parseGoogleDriveDesktopCredentials({
        ...downloadedCredentials(),
        web: downloadedCredentials().installed
      })
    ).toThrow('The Google Desktop OAuth credentials file is invalid')
    expect(() =>
      parseGoogleDriveDesktopCredentials({ ...downloadedCredentials(), extra: true })
    ).toThrow('The Google Desktop OAuth credentials file is invalid')
  })

  test('enforces client ID and secret character boundaries', () => {
    expect(
      parseGoogleDriveDesktopCredentials(downloadedCredentials({ client_secret: 's'.repeat(8) }))
        .clientSecret
    ).toHaveLength(8)
    expect(
      parseGoogleDriveDesktopCredentials(
        downloadedCredentials({ client_secret: 's'.repeat(4 * 1024) })
      ).clientSecret
    ).toHaveLength(4 * 1024)

    for (const clientSecret of [
      '',
      's'.repeat(7),
      's'.repeat(4 * 1024 + 1),
      ' secret',
      'secret value',
      'secret\nvalue',
      '秘密'
    ]) {
      const error = capturedError(() =>
        parseGoogleDriveDesktopCredentials(downloadedCredentials({ client_secret: clientSecret }))
      )
      expect(error.code).toBe('invalid-credentials')
      expect(error.message).toBe('The Google Desktop OAuth credentials file is invalid')
      if (clientSecret) expect(error.message).not.toContain(clientSecret)
    }

    const error = capturedError(() =>
      parseGoogleDriveDesktopCredentials(
        downloadedCredentials({ client_id: 'not-a-desktop-client-id' })
      )
    )
    expect(error.code).toBe('invalid-credentials')
    expect(error.message).not.toContain('not-a-desktop-client-id')
  })

  test('uses static errors for malformed JSON without reflecting input', () => {
    const sentinel = 'never-reflect-this-secret'
    const error = capturedError(() =>
      parseGoogleDriveDesktopCredentialsJSON(`{"installed":{"client_secret":"${sentinel}"}`)
    )
    expect(error.code).toBe('invalid-credentials')
    expect(error.message).toBe('The Google Desktop OAuth credentials file is invalid')
    expect(error.message).not.toContain(sentinel)
  })

  test('exports and enforces the 16 KiB pre-read bound', () => {
    expect(MAX_GOOGLE_DRIVE_DESKTOP_CREDENTIALS_BYTES).toBe(16 * 1024)
    const oversized = JSON.stringify(
      downloadedCredentials({
        ignored_padding: 'x'.repeat(MAX_GOOGLE_DRIVE_DESKTOP_CREDENTIALS_BYTES)
      })
    )
    const error = capturedError(() => parseGoogleDriveDesktopCredentialsJSON(oversized))
    expect(error.code).toBe('credentials-too-large')
    expect(error.message).toBe('The Google Desktop OAuth credentials file is too large')

    const objectError = capturedError(() =>
      parseGoogleDriveDesktopCredentials(
        downloadedCredentials({
          ignored_padding: 'x'.repeat(MAX_GOOGLE_DRIVE_DESKTOP_CREDENTIALS_BYTES)
        })
      )
    )
    expect(objectError.code).toBe('credentials-too-large')
  })
})
