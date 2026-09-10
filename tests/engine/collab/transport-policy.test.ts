import { describe, expect, test } from 'bun:test'

import { allowsTestCollabTransport } from '@/app/collab/transport/policy'

const browserDevelopment = {
  isBrowser: true,
  isDevelopment: true,
  mode: 'development',
  search: '?collabTransport=test'
} as const

describe('test collaboration transport policy', () => {
  test('allows an explicit test query in browser development', () => {
    expect(allowsTestCollabTransport(browserDevelopment)).toBe(true)
  })

  test('allows an explicit test query in a native-test production-style build', () => {
    expect(
      allowsTestCollabTransport({
        ...browserDevelopment,
        isDevelopment: false,
        mode: 'native-test'
      })
    ).toBe(true)
  })

  test('rejects the test query in a production build', () => {
    expect(
      allowsTestCollabTransport({
        ...browserDevelopment,
        isDevelopment: false,
        mode: 'production'
      })
    ).toBe(false)
  })

  test('requires both a browser and the explicit query', () => {
    expect(allowsTestCollabTransport({ ...browserDevelopment, isBrowser: false })).toBe(false)
    expect(
      allowsTestCollabTransport({ ...browserDevelopment, search: '?collabRelay=ws://relay' })
    ).toBe(false)
    expect(
      allowsTestCollabTransport({ ...browserDevelopment, search: '?collabTransport=TEST' })
    ).toBe(false)
  })
})
