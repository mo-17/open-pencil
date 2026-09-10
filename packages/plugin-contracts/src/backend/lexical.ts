export const BACKEND_PROVIDER_LEXICAL_LIMITS = Object.freeze({
  maxSymbolLength: 64
})

const UNSAFE_WORDS = new Set([
  'accesskey',
  'accesstoken',
  'apikey',
  'auth',
  'authentication',
  'authorization',
  'bash',
  'bearer',
  'bun',
  'chmod',
  'clientsecret',
  'cmd',
  'code',
  'command',
  'commands',
  'connectionstring',
  'credential',
  'credentials',
  'curl',
  'deploy',
  'deploys',
  'driver',
  'drop',
  'dsn',
  'endpoint',
  'endpoints',
  'eval',
  'exec',
  'execute',
  'executor',
  'file',
  'filesystem',
  'ftp',
  'http',
  'https',
  'javascript',
  'js',
  'key',
  'keys',
  'localhost',
  'mailto',
  'native',
  'network',
  'node',
  'npm',
  'npx',
  'origin',
  'origins',
  'password',
  'passphrase',
  'pnpm',
  'port',
  'powershell',
  'process',
  'require',
  'rm',
  'run',
  'runs',
  'script',
  'scripts',
  'secret',
  'secrets',
  'shell',
  'signingkey',
  'spawn',
  'sql',
  'sudo',
  'terminal',
  'token',
  'tokens',
  'uri',
  'uris',
  'url',
  'urls',
  'wget',
  'yarn',
  'zsh'
])

const UNSAFE_COMPACT_FRAGMENTS = [
  'accesskey',
  'accesstoken',
  'adminkey',
  'adminsecret',
  'apikey',
  'apitoken',
  'authorizationheader',
  'bearertoken',
  'clientsecret',
  'clienttoken',
  'connectionstring',
  'createtable',
  'credential',
  'databaseurl',
  'dbkey',
  'dburl',
  'deletefrom',
  'deploycommand',
  'droptable',
  'endpoint',
  'executescript',
  'executor',
  'insertinto',
  'javascript',
  'managementkey',
  'masterkey',
  'password',
  'privatekey',
  'rolekey',
  'rootdbkey',
  'rootkey',
  'secret',
  'selectfrom',
  'servicekey',
  'servicerole',
  'shellcommand',
  'signingkey',
  'token',
  'updateset',
  'url'
] as const

const SAFE_SYMBOL = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/
const EXPLICIT_URL_OR_NETWORK_REFERENCE =
  /(?:\b[a-z][a-z0-9+.-]{1,20}:\/\/|\b(?:data|file|ftp|https?|javascript|mailto|wss?):|\bhttps?%3a%2f%2f|\bwww\.|\blocalhost(?::[0-9]+)?\b|\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b|\[(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\]|\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b)/iu
const DOMAIN_REFERENCE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})\b/iu
const SECRET_LIKE_VALUE =
  /(?:\b(?:ghp|github_pat|xox[baprs])[-_a-z0-9]{12,}\b|\bAKIA[A-Z0-9]{12,}\b|\b(?:pk|sk)_(?:live|prod|test)(?:_[A-Za-z0-9_-]+)?\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/iu
const SQL_OR_CODE_MATERIAL =
  /(?:=>|<\/?script\b|\b(?:alert|eval|exec|fetch|require|spawn|system)\s*\(|\bfunction\s+[A-Za-z_$]|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|\b(?:alter|create|drop|truncate)\s+(?:database|role|schema|table|user)\b|\bdelete\s+from\b|\binsert\s+into\b|\bselect\b[^.;]{0,160}\bfrom\b|\bupdate\s+[a-z0-9_.-]+\s+set\b)/iu
const SHELL_OR_COMMAND_MATERIAL =
  /(?:\$\s*[({]|`|(?:^|[;&|\r\n])\s*(?:\/(?:usr\/)?bin\/)?(?:osascript|perl|printf|python3?|ruby|sh|touch|whoami)(?=$|\s)|(?:^|[;&|\r\n])\s*(?:\/(?:usr\/)?bin\/)?(?:cat|open)(?=\s+(?:--?|\/|~\/|\.\.?\/)))/iu
const FORMAT_CONTROL = /\p{Cf}/u
const HIGH_ENTROPY_TOKEN = /[A-Za-z0-9_+/=-]{20,}/gu

export function backendProviderTextWords(value: string): readonly string[] {
  return value
    .normalize('NFKC')
    .replace(/\bPostgreSQL\b/giu, 'postgresql')
    .replace(/\bMySQL\b/giu, 'mysql')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function containsHighEntropyToken(value: string): boolean {
  return [...value.matchAll(HIGH_ENTROPY_TOKEN)].some((match) => {
    const token = match[0]
    const categoryCount = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((pattern) =>
      pattern.test(token)
    ).length
    const distinctCharacters = new Set(token).size
    return (
      distinctCharacters / token.length >= 0.55 && (categoryCount >= 2 || distinctCharacters >= 18)
    )
  })
}

function assertBackendProviderInputDataPropertiesAt(
  value: unknown,
  path: string,
  depth: number,
  ancestors: WeakSet<object>
): void {
  if (value === null || typeof value !== 'object') return
  if (depth > 64) throw new TypeError(`${path} exceeds the data-only depth limit`)
  if (ancestors.has(value)) throw new TypeError(`${path} must not contain circular values`)
  ancestors.add(value)
  try {
    let index = 0
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue
      if (typeof key !== 'string') {
        index += 1
        continue
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        SECRET_LIKE_VALUE.test(key) ||
        (key.length >= 32 && containsHighEntropyToken(key)) ||
        !descriptor?.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw new TypeError(
          `${path} must contain only enumerable data property descriptors and JSON data properties`
        )
      }
      assertBackendProviderInputDataPropertiesAt(
        descriptor.value,
        Array.isArray(value) ? `${path}[${index}]` : `${path}.values[${index}]`,
        depth + 1,
        ancestors
      )
      index += 1
    }
  } finally {
    ancestors.delete(value)
  }
}

/** Reject non-data descriptors and secret-bearing keys without ever reading or echoing a key. */
export function assertBackendProviderInputDataProperties(value: unknown, path: string): void {
  assertBackendProviderInputDataPropertiesAt(value, path, 0, new WeakSet<object>())
}

export interface BackendProviderTextPolicy {
  readonly symbolic?: boolean
  readonly allowOpaqueIdentifier?: boolean
  /** Dots are established namespace separators in provider IDs, not endpoint authority. */
  readonly allowQualifiedIdentifier?: boolean
}

export function assertInertBackendProviderText(
  value: string,
  path: string,
  policy: BackendProviderTextPolicy = {}
): void {
  const folded = value.normalize('NFKC')
  const words = backendProviderTextWords(folded)
  const compact = words.join('')
  const unsafe =
    FORMAT_CONTROL.test(folded) ||
    EXPLICIT_URL_OR_NETWORK_REFERENCE.test(folded) ||
    (!policy.allowQualifiedIdentifier && DOMAIN_REFERENCE.test(folded)) ||
    SECRET_LIKE_VALUE.test(folded) ||
    SQL_OR_CODE_MATERIAL.test(folded) ||
    SHELL_OR_COMMAND_MATERIAL.test(folded) ||
    words.some((word) => UNSAFE_WORDS.has(word)) ||
    UNSAFE_WORDS.has(compact) ||
    UNSAFE_COMPACT_FRAGMENTS.some((fragment) => compact.includes(fragment)) ||
    (!policy.allowOpaqueIdentifier && containsHighEntropyToken(folded))
  if (unsafe) {
    throw new TypeError(
      policy.symbolic
        ? `${path} must be a small inert symbolic value`
        : `${path} must be inert data text without authority, secret, URL, code, or command material`
    )
  }
  if (
    policy.symbolic &&
    (folded.length === 0 ||
      folded.length > BACKEND_PROVIDER_LEXICAL_LIMITS.maxSymbolLength ||
      !SAFE_SYMBOL.test(folded))
  ) {
    throw new TypeError(`${path} must be a small inert symbolic value`)
  }
}
