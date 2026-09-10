export interface CredentialPersistenceExclusiveGateStartedV1<Result> {
  readonly started: Result
}

let credentialPersistenceExclusiveTail: Promise<void> = Promise.resolve()

/**
 * Same-realm exclusion for credential snapshot switches, credential rotations, and privileged
 * request start. Callbacks must not re-enter this gate. A network Promise belongs inside
 * `started`, so the gate releases after synchronous request creation without adopting it.
 */
export async function withCredentialPersistenceExclusiveGateV1<Result>(
  operation: () =>
    | CredentialPersistenceExclusiveGateStartedV1<Result>
    | Promise<CredentialPersistenceExclusiveGateStartedV1<Result>>
): Promise<CredentialPersistenceExclusiveGateStartedV1<Result>> {
  if (typeof operation !== 'function') {
    throw new TypeError('Credential persistence exclusive gate operation is invalid')
  }
  const preceding = credentialPersistenceExclusiveTail
  let release: () => void = () => undefined
  credentialPersistenceExclusiveTail = new Promise<void>((resolve) => {
    release = resolve
  })
  await preceding.catch(() => undefined)
  try {
    const result: unknown = await operation()
    if (result === null || typeof result !== 'object') {
      throw new TypeError('Credential persistence exclusive gate result is invalid')
    }
    const keys = Reflect.ownKeys(result)
    const descriptor = Object.getOwnPropertyDescriptor(result, 'started')
    if (
      keys.length !== 1 ||
      keys[0] !== 'started' ||
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError('Credential persistence exclusive gate result is invalid')
    }
    return Object.freeze({ started: descriptor.value as Result })
  } finally {
    release()
  }
}
