import { describe, expect, test } from 'bun:test'

import { resolveGoogleDriveClientId } from '@/app/integrations/storage/google-drive/config'

describe('Google Drive storage configuration', () => {
  test('prefers an explicit developer override over the bundled public client ID', () => {
    expect(
      resolveGoogleDriveClientId(
        { 'client-id': 'override.apps.googleusercontent.com' },
        'bundled.apps.googleusercontent.com'
      )
    ).toBe('override.apps.googleusercontent.com')
  })

  test('uses the bundled client ID and treats blank values as missing', () => {
    expect(resolveGoogleDriveClientId({}, ' bundled.apps.googleusercontent.com ')).toBe(
      'bundled.apps.googleusercontent.com'
    )
    expect(resolveGoogleDriveClientId({ 'client-id': '   ' }, undefined)).toBeNull()
  })
})
