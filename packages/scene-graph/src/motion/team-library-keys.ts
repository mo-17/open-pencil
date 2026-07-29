const TEAM_MOTION_KEY_MAX_BYTES = 32_768

function boundedKeyText(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    new TextEncoder().encode(value).byteLength > TEAM_MOTION_KEY_MAX_BYTES
  ) {
    throw new TypeError(`${label} must be bounded PEM text`)
  }
  return value
}

function pemBuffer(value: string, label: 'PRIVATE KEY' | 'PUBLIC KEY'): ArrayBuffer {
  const text = boundedKeyText(value, label)
  const match = text.match(new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`))
  if (!match) throw new TypeError(`Expected ${label} PEM data`)
  const encoded = match[1].replaceAll(/\s/g, '')
  let binary: string
  try {
    binary = atob(encoded)
  } catch (cause) {
    throw new TypeError(`Invalid ${label} PEM encoding`, { cause })
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return bytes.buffer
}

function bufferToPem(value: ArrayBuffer, label: 'PUBLIC KEY'): string {
  let binary = ''
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte)
  const lines =
    btoa(binary)
      .match(/.{1,64}/g)
      ?.join('\n') ?? ''
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`
}

export async function importTeamMotionPrivateKey(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pemBuffer(value, 'PRIVATE KEY'), 'Ed25519', false, [
    'sign'
  ])
}

export async function importTeamMotionPublicKey(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', pemBuffer(value, 'PUBLIC KEY'), 'Ed25519', true, [
    'verify'
  ])
}

export async function exportTeamMotionPublicKey(value: CryptoKey): Promise<string> {
  if (value.type !== 'public' || value.algorithm.name !== 'Ed25519') {
    throw new TypeError('Expected an Ed25519 public CryptoKey')
  }
  return bufferToPem(await crypto.subtle.exportKey('spki', value), 'PUBLIC KEY')
}
