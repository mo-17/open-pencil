import { describe, expect, test } from 'bun:test'

import { resolveGoogleDriveClientId } from '@/app/integrations/storage/google-drive/config'

describe('Google Drive storage configuration', () => {
  test('always uses the bundled client ID and ignores profile overrides', () => {
    expect(
      resolveGoogleDriveClientId(
        { 'client-id': 'override.apps.googleusercontent.com' },
        'bundled.apps.googleusercontent.com'
      )
    ).toBe('bundled.apps.googleusercontent.com')
  })

  test('trims the bundled client ID and never falls back to a profile override', () => {
    expect(resolveGoogleDriveClientId({}, ' bundled.apps.googleusercontent.com ')).toBe(
      'bundled.apps.googleusercontent.com'
    )
    expect(
      resolveGoogleDriveClientId({ 'client-id': 'override.apps.googleusercontent.com' }, '   ')
    ).toBeNull()
  })
})
