import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  BACKEND_PROVIDER_COMPILE_HANDOFF_MAX_BYTES,
  BACKEND_PROVIDER_DECLARATION_MAX_BYTES,
  BACKEND_PROVIDER_DEPLOY_READY_PREFIX,
  createBackendProviderCompileHandoff,
  digestBackendProviderCompileHandoff,
  parseBackendProviderCompileHandoff,
  parseBackendProviderDeployMessage,
  resolveBackendProviderCompileHandoff
} from '@open-pencil/compiler/backend'

import { deployMessage, handoffDeclaration, handoffFixture, OTHER_DIGEST } from './helpers'

describe('Compiler Backend Provider compile handoff', () => {
  test.each(['react', 'vue'] as const)(
    '%s binds real production artifacts and detached input',
    (target) => {
      const fixture = handoffFixture(target)
      const frame = createBackendProviderCompileHandoff(fixture.input)
      const wire = JSON.stringify(frame)
      const parsed = parseBackendProviderCompileHandoff(JSON.parse(wire))
      expect(parsed).toEqual(frame)
      expect(frame.declarationDigest).toBe(
        createHash('sha256').update(fixture.input.declaration, 'utf8').digest('base64url')
      )
      expect(frame.planDigest).toBe(fixture.plan.planDigest)
      expect(frame.manifestDigest).toBe(fixture.emission.manifestDigest)
      expect(fixture.emission.manifest).toMatchObject({ target, mode: 'production' })
      expect([...fixture.emission.files.values()].join('\n')).toContain('handoff_records')
      expect(
        resolveBackendProviderCompileHandoff(parsed, fixture.input.declaration, target)
      ).toEqual({ selection: frame.request.selection, application: fixture.plan.application })
      expect(Object.isFrozen(frame)).toBe(true)
      expect(Object.isFrozen(frame.request.selection.descriptor.capabilities)).toBe(true)
      expect(Object.isFrozen(frame.request.application.dataModel.entities[0])).toBe(true)
      fixture.input.application.applicationId = 'changed-after-create'
      expect(frame.request.application.applicationId).toBe('handoff-application')
      expect(digestBackendProviderCompileHandoff(parsed)).toBe(
        digestBackendProviderCompileHandoff(frame)
      )
    }
  )

  test('hashes canonical frame order while binding exact declaration bytes', () => {
    const { input } = handoffFixture()
    const frame = createBackendProviderCompileHandoff(input)
    const reordered = Object.fromEntries(Object.entries(frame).reverse())
    expect(digestBackendProviderCompileHandoff(reordered)).toBe(
      digestBackendProviderCompileHandoff(frame)
    )
    const spaced = createBackendProviderCompileHandoff({
      ...input,
      declaration: `${input.declaration}\n`
    })
    expect(spaced.request).toEqual(frame.request)
    expect(spaced.declarationDigest).not.toBe(frame.declarationDigest)
    expect(digestBackendProviderCompileHandoff(spaced)).not.toBe(
      digestBackendProviderCompileHandoff(frame)
    )
    expect(() =>
      resolveBackendProviderCompileHandoff(frame, `${input.declaration}\n`, 'react')
    ).toThrow(TypeError)
  })

  test('rejects unsupported targets, nonproduction modes and malformed digests', () => {
    const frame = createBackendProviderCompileHandoff(handoffFixture().input)
    for (const change of [
      { target: 'flutter' },
      { target: 'vue' },
      { mode: 'preview' },
      { format: 'openpencil.backend-provider-compile.v2' },
      { declarationDigest: 'A'.repeat(42) },
      { declarationDigest: 'B'.repeat(43) },
      { planDigest: OTHER_DIGEST },
      { manifestDigest: OTHER_DIGEST }
    ]) {
      expect(() => parseBackendProviderCompileHandoff({ ...frame, ...change })).toThrow(TypeError)
    }
  })

  test('rejects disabled, unregistered, altered or unbound provider selection', () => {
    const frame = createBackendProviderCompileHandoff(handoffFixture().input)
    for (const change of [
      { enabled: false },
      { enabled: 'true' },
      { packageDigest: 'synthetic-invalid-digest' },
      { packageDigest: `sha256:${'B'.repeat(43)}` },
      { packageDigest: `sha256:${OTHER_DIGEST}` },
      { descriptor: { ...frame.request.selection.descriptor, adapterId: 'unregistered' } },
      { descriptor: { ...frame.request.selection.descriptor, providerId: 'other' } }
    ]) {
      const request = { ...frame.request, selection: { ...frame.request.selection, ...change } }
      expect(() => parseBackendProviderCompileHandoff({ ...frame, request })).toThrow(TypeError)
    }
  })

  test('rejects a changed application with stale plan and manifest', () => {
    const frame = createBackendProviderCompileHandoff(handoffFixture().input)
    const application = { ...frame.request.application, applicationId: 'different-application' }
    expect(() =>
      parseBackendProviderCompileHandoff({
        ...frame,
        request: { ...frame.request, application }
      })
    ).toThrow(TypeError)
  })

  test('checks the declaration projection even when the caller recomputes its raw digest', () => {
    const { input, declarationValue } = handoffFixture()
    const changes = [
      { ...declarationValue, format: 'other' },
      {
        ...declarationValue,
        application: { ...input.application, applicationId: 'other-application' }
      },
      { ...declarationValue, selection: { ...declarationValue.selection, providerId: 'other' } },
      { ...declarationValue, selection: { ...declarationValue.selection, outputKinds: [] } },
      {
        ...declarationValue,
        selection: {
          ...declarationValue.selection,
          packageAuthority: { packageDigest: `sha256:${OTHER_DIGEST}` }
        }
      }
    ]
    for (const changed of changes) {
      const declaration = JSON.stringify(changed)
      expect(() => createBackendProviderCompileHandoff({ ...input, declaration })).toThrow(
        TypeError
      )
      const frame = createBackendProviderCompileHandoff(input)
      const forged = {
        ...frame,
        declarationDigest: createHash('sha256').update(declaration).digest('base64url')
      }
      expect(() => resolveBackendProviderCompileHandoff(forged, declaration, 'react')).toThrow(
        TypeError
      )
    }
  })

  test('binds the target and refuses compiler selection disguised as a document declaration', () => {
    const { input } = handoffFixture()
    const frame = createBackendProviderCompileHandoff(input)
    expect(() => resolveBackendProviderCompileHandoff(frame, input.declaration, 'vue')).toThrow(
      TypeError
    )
    const declaration = JSON.stringify({
      format: 'openpencil.backend-provider-request.v1',
      selection: input.selection,
      application: input.application
    })
    expect(() => createBackendProviderCompileHandoff({ ...input, declaration })).toThrow(TypeError)
    expect(() => parseBackendProviderCompileHandoff(JSON.parse(input.declaration))).toThrow(
      TypeError
    )
  })

  test('rejects malformed, excessive or extra-field input without leaking its content', () => {
    const { input } = handoffFixture()
    const frame = createBackendProviderCompileHandoff(input)
    for (const value of [
      null,
      [],
      true,
      'frame',
      {},
      { ...frame, unexpected: 'fixture-sensitive-canary' },
      { ...frame, request: { ...frame.request, unexpected: true } },
      {
        ...frame,
        request: { ...frame.request, selection: { ...frame.request.selection, extra: true } }
      },
      {
        ...frame,
        request: {
          ...frame.request,
          application: {
            ...frame.request.application,
            applicationId: 'x'.repeat(BACKEND_PROVIDER_COMPILE_HANDOFF_MAX_BYTES)
          }
        }
      }
    ]) {
      expect(() => parseBackendProviderCompileHandoff(value)).toThrow(
        'Invalid Backend Provider compile handoff.'
      )
    }
    for (const declaration of [
      '{',
      '{}',
      'x'.repeat(BACKEND_PROVIDER_DECLARATION_MAX_BYTES + 1),
      '界'.repeat(Math.ceil(BACKEND_PROVIDER_DECLARATION_MAX_BYTES / 3))
    ]) {
      expect(() => createBackendProviderCompileHandoff({ ...input, declaration })).toThrow(
        'Invalid Backend Provider compile handoff.'
      )
    }
  })

  test('rejects accessors and throwing proxies without executing getters or exposing errors', () => {
    const frame = createBackendProviderCompileHandoff(handoffFixture().input)
    let reads = 0
    const accessor = { ...frame }
    Object.defineProperty(accessor, 'request', {
      enumerable: true,
      get() {
        reads += 1
        return frame.request
      }
    })
    const proxy = new Proxy(frame, {
      ownKeys() {
        throw new Error('fixture-sensitive-canary')
      }
    })
    const inherited = Object.assign(Object.create({ inherited: true }), frame)
    const symbol = { ...frame, [Symbol('hidden')]: true }
    for (const value of [accessor, proxy, inherited, symbol]) {
      expect(() => parseBackendProviderCompileHandoff(value)).toThrow(
        'Invalid Backend Provider compile handoff.'
      )
    }
    expect(reads).toBe(0)
  })

  test('does not confuse content validation with authentication of installed lifecycle', () => {
    const { input } = handoffFixture()
    const declaration = handoffDeclaration(input.selection, input.application)
    declaration.selection.packageAuthority.publisherId = 'synthetic-unreviewed-host'
    const frame = createBackendProviderCompileHandoff({
      ...input,
      declaration: JSON.stringify(declaration)
    })
    expect(frame.request.selection.enabled).toBe(true)
    // The trusted process must separately revalidate its App installation. This pure
    // contract only proves that the explicit selection and declaration agree.
    expect(() => resolveBackendProviderCompileHandoff(frame, input.declaration, 'react')).toThrow(
      TypeError
    )
  })
})

describe('Compiler Backend Provider deploy coordination message', () => {
  test.each(['ready', 'authorize', 'cancel'] as const)(
    'parses a frozen %s message with both digests',
    (stage) => {
      const value = deployMessage(stage)
      const parsed = parseBackendProviderDeployMessage(structuredClone(value))
      expect(parsed).toEqual(value)
      expect(Object.isFrozen(parsed)).toBe(true)
      expect(BACKEND_PROVIDER_DEPLOY_READY_PREFIX).toBe('OPENPENCIL_BACKEND_READY ')
    }
  )

  test('rejects unknown or missing fields, invalid stages, digest padding and noncanonical UUIDs', () => {
    const value = deployMessage()
    for (const change of [
      { extra: true },
      { stage: 'complete' },
      { format: 'openpencil.backend-provider-deploy.v2' },
      { challenge: value.challenge.toUpperCase() },
      { challenge: 'not-a-uuid' },
      { handoffDigest: `${value.handoffDigest}=` },
      { dispatchDigest: 'B'.repeat(43) }
    ]) {
      expect(() => parseBackendProviderDeployMessage({ ...value, ...change })).toThrow(
        'Invalid Backend Provider deploy message.'
      )
    }
    const missing = { ...value }
    Reflect.deleteProperty(missing, 'dispatchDigest')
    expect(() => parseBackendProviderDeployMessage(missing)).toThrow(TypeError)
    let reads = 0
    Object.defineProperty(value, 'challenge', {
      enumerable: true,
      get() {
        reads += 1
        return 'fixture-sensitive-canary'
      }
    })
    expect(() => parseBackendProviderDeployMessage(value)).toThrow(
      'Invalid Backend Provider deploy message.'
    )
    expect(reads).toBe(0)
  })
})
