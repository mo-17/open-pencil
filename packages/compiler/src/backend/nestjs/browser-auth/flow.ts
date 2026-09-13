export const FLOW_SOURCE = String.raw`
export async function signIn(returnPath?: string): Promise<void> {
  if (!session.ready) await initialize()
  const path = localReturnPath(returnPath)
  clearSession()
  const generation = session.generation
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
    const config = await configuration(generation)
    const verifier = oidc.randomPKCECodeVerifier()
    const challenge = await oidc.calculatePKCECodeChallenge(verifier)
    const state = oidc.randomState()
    const nonce = oidc.randomNonce()
    const now = Date.now()
    const parameters: Record<string, string> = {
      redirect_uri: redirectURI(), response_type: 'code',
      scope: CONFIG.authentication.scopes.join(' '),
      code_challenge: challenge, code_challenge_method: 'S256', state, nonce,
    }
    if (CONFIG.authentication.resource) parameters.resource = CONFIG.authentication.resource
    const url = oidc.buildAuthorizationUrl(config, parameters)
    assertCurrent(generation)
    storeTransaction({ version: 1, binding: BINDING, state, nonce, verifier,
      redirectURI: redirectURI(), returnPath: path, createdAt: now, expiresAt: now + TRANSACTION_AGE })
    window.location.assign(url.href)
  } catch { throw failure() }
}

function validatedTokens(tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers) {
  const claims = tokens.claims()
  const subject = claims?.sub
  const lifetime = tokens.expires_in
  if (!claims || typeof subject !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(subject) ||
      typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) ||
      typeof lifetime !== 'number' || !Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 86400 ||
      tokens.token_type.toLowerCase() !== 'bearer' || typeof tokens.access_token !== 'string' ||
      tokens.access_token.length > 8192 || tokens.access_token === tokens.id_token ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(tokens.access_token)) throw failure()
  const deadline = Math.min(Date.now() + lifetime * 1000, claims.exp * 1000)
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) throw failure()
  return { token: tokens.access_token, deadline, id: subject.toLowerCase(),
    email: typeof claims.email === 'string' && claims.email.length <= 320 ? claims.email : null }
}

function acceptTokens(value: ReturnType<typeof validatedTokens>, generation: number): void {
  assertCurrent(generation)
  accessToken = value.token
  expiresAt = value.deadline
  expiryTimer = setTimeout(expire, Math.max(0, value.deadline - Date.now()))
  publish({ ready: true, signedIn: true, id: value.id, email: value.email })
}

async function initializeSession(): Promise<void> {
  if (window.location.pathname !== CONFIG.authentication.callbackPath) {
    clearSession()
    return
  }
  clearSession(false)
  const generation = session.generation
  try {
    const current = new URL(window.location.href)
    window.history.replaceState(null, '', CONFIG.authentication.callbackPath)
    const transaction = consumeTransaction()
    if (current.href.length > 16384 || current.hash ||
        current.searchParams.getAll('state').length !== 1 ||
        current.searchParams.get('state') !== transaction.state ||
        current.searchParams.getAll('code').length !== 1 || current.searchParams.has('error')) throw failure()
    const config = await configuration(generation)
    const tokens = await oidc.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: transaction.verifier, expectedState: transaction.state,
      expectedNonce: transaction.nonce, idTokenExpected: true,
    }, CONFIG.authentication.resource ? { resource: CONFIG.authentication.resource } : undefined)
    assertCurrent(generation)
    const validated = validatedTokens(tokens)
    window.history.replaceState(null, '', transaction.returnPath)
    acceptTokens(validated, generation)
  } catch {
    if (generation === session.generation) clearSession()
    throw failure()
  }
}

export function initialize(): Promise<void> {
  initialization ??= initializeSession()
  return initialization
}
`
