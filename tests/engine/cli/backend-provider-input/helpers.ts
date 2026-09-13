import { PassThrough } from 'node:stream'

import { createBackendProviderCompileHandoff } from '@open-pencil/compiler/backend'

import { BackendProviderInput } from '#cli/backend-provider-input'

import { handoffFixture } from '#tests/engine/compiler/backend/handoff/helpers'

export function inputFixture(timeoutMs = 1000) {
  const stream = new PassThrough()
  const input = new BackendProviderInput(stream, timeoutMs)
  const request = createBackendProviderCompileHandoff(handoffFixture().input)
  const line = `${JSON.stringify(request)}\n`
  return { stream, input, request, line }
}

export async function preparedInput(timeoutMs = 1000) {
  const fixture = inputFixture(timeoutMs)
  const reading = fixture.input.readRequest()
  fixture.stream.write(fixture.line)
  await reading
  return fixture
}
