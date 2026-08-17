import { describe, expect, test } from 'bun:test'

import {
  FONT_PROVIDER_SETTINGS_STORAGE_SERIALIZER,
  normalizeFontProviderSettings
} from '@/app/editor/fonts/provider-settings'

describe('browser font provider settings', () => {
  test('enables a newly introduced default provider in legacy persisted settings', () => {
    expect(normalizeFontProviderSettings({ google: true, bunny: false, fontshare: false })).toEqual(
      {
        google: true,
        fontsource: true,
        bunny: false,
        fontshare: false
      }
    )
  })

  test('preserves explicit provider choices and drops unreviewed keys', () => {
    expect(
      normalizeFontProviderSettings({
        google: false,
        fontsource: false,
        bunny: true,
        fontshare: true,
        arbitrary: true
      })
    ).toEqual({
      google: false,
      fontsource: false,
      bunny: true,
      fontshare: true
    })
  })

  test('restores reviewed defaults for malformed persisted values', () => {
    expect(
      normalizeFontProviderSettings({
        google: 'yes',
        fontsource: null,
        bunny: 1,
        fontshare: undefined
      })
    ).toEqual({
      google: true,
      fontsource: true,
      bunny: false,
      fontshare: false
    })
  })

  test('normalizes every storage read while preserving explicit false values', () => {
    expect(
      FONT_PROVIDER_SETTINGS_STORAGE_SERIALIZER.read(
        JSON.stringify({ google: false, bunny: true, fontshare: false })
      )
    ).toEqual({
      google: false,
      fontsource: true,
      bunny: true,
      fontshare: false
    })
    expect(FONT_PROVIDER_SETTINGS_STORAGE_SERIALIZER.read('{malformed')).toEqual({
      google: true,
      fontsource: true,
      bunny: false,
      fontshare: false
    })
  })
})
