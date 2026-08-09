const MUTATION_ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function createConnectorMutationAttemptId(): string {
  return globalThis.crypto.randomUUID()
}

export function parseConnectorMutationAttemptId(value: unknown): string {
  if (typeof value !== 'string' || !MUTATION_ATTEMPT_ID.test(value)) {
    throw new TypeError('Connector mutation attempt ID must be a canonical UUID v4')
  }
  return value.toLowerCase()
}
