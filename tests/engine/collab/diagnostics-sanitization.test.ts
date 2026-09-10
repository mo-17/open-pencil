import { describe, expect, test } from 'bun:test'

import { sanitizeDiagnosticMessage } from '#tests/helpers/collab/diagnostics'

describe('native collaboration diagnostic sanitization', () => {
  test('redacts URL, authorization, JSON, and plain key/value secrets', () => {
    const secrets = [
      'query-secret',
      'fragment-secret',
      'bearer-secret',
      'json-secret',
      'password-secret',
      'client-secret',
      'plain-secret'
    ]
    const diagnostic = sanitizeDiagnosticMessage(
      'request https://127.0.0.1/share/room?access_token=query-secret#k=fragment-secret ' +
        'Authorization: Bearer bearer-secret ' +
        '{"refresh_token":"json-secret","password":"password-secret",' +
        '"client_secret":"client-secret"} token: plain-secret'
    )

    for (const secret of secrets) expect(diagnostic).not.toContain(secret)
    expect(diagnostic).toContain('[redacted]')
  })

  test('preserves useful non-sensitive failure context', () => {
    expect(sanitizeDiagnosticMessage(new Error('Alice peer roster timed out'))).toBe(
      'Error: Alice peer roster timed out'
    )
  })
})
