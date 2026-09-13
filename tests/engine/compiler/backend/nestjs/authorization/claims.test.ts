import { describe, expect, test } from 'bun:test'

import { SUBJECT, authorizationRuntime, type RequestFixture } from './helpers'

describe('generated NestJS signed role claim boundary', () => {
  test('pins issuer, audience, algorithm and expiry before taking roles from the top-level claim', async () => {
    const runtime = await authorizationRuntime()
    try {
      runtime.jwt.tokens.set('header.valid.signature', {
        sub: SUBJECT,
        exp: 9999999999,
        openpencil_roles: ['catalog-admin']
      })
      expect(await runtime.authentication.verify('header.valid.signature')).toEqual({
        subject: SUBJECT,
        roles: ['catalog-admin']
      })
      expect(runtime.jwt.calls[0]?.options).toEqual({
        issuer: runtime.configuration.issuer,
        audience: runtime.configuration.audience,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp'],
        clockTolerance: 0
      })
      runtime.jwt.tokens.set('header.userdata.signature', {
        sub: SUBJECT,
        exp: 9999999999,
        user_metadata: { openpencil_roles: ['catalog-admin'] }
      })
      expect((await runtime.authentication.verify('header.userdata.signature')).roles).toEqual([])
    } finally {
      runtime.dispose()
    }
  })

  test('rejects malformed role claims rather than broadening or downgrading authorization', async () => {
    const runtime = await authorizationRuntime()
    try {
      for (const openpencil_roles of [
        null,
        'catalog-admin',
        ['catalog-admin', 'catalog-admin'],
        ['bad role'],
        [42],
        Array.from({ length: 65 }, () => 'a')
      ]) {
        runtime.jwt.tokens.set('header.invalid.signature', {
          sub: SUBJECT,
          exp: 9999999999,
          openpencil_roles
        })
        await expect(runtime.authentication.verify('header.invalid.signature')).rejects.toThrow(
          'Authentication required.'
        )
      }
    } finally {
      runtime.dispose()
    }
  })

  test('only absent tokens on public reads can use anonymous access', async () => {
    const runtime = await authorizationRuntime('catalog')
    try {
      const request: RequestFixture = {
        rawHeaders: [],
        headers: {},
        principal: { subject: SUBJECT, roles: ['catalog-admin'] }
      }
      expect(await runtime.guard(request, true)).toBe(true)
      expect(request.principal).toBeUndefined()
      await expect(runtime.guard({ rawHeaders: [], headers: {} }, false)).rejects.toThrow(
        'Authentication required.'
      )
      for (const authorization of ['', 'Basic arbitrary', 'Bearer header.bad.signature']) {
        await expect(
          runtime.guard(
            { rawHeaders: ['Authorization', authorization], headers: { authorization } },
            true
          )
        ).rejects.toThrow('Authentication required.')
      }
      await expect(
        runtime.guard(
          { rawHeaders: [], headers: { authorization: 'Bearer header.valid.signature' } },
          true
        )
      ).rejects.toThrow('Authentication required.')
      await expect(
        runtime.guard(
          {
            rawHeaders: ['Authorization', 'Bearer a.b.c', 'Authorization', 'Bearer a.b.c'],
            headers: { authorization: 'Bearer a.b.c' }
          },
          true
        )
      ).rejects.toThrow('Authentication required.')
    } finally {
      runtime.dispose()
    }
  })
})
