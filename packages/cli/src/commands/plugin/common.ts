import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { importEd25519PrivateKeyPem, importEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import { bold, fmtList, ok, printError } from '#cli/format'

const MAX_KEY_BYTES = 32_768
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export const jsonArg = {
  type: 'boolean',
  default: false,
  description: 'Output JSON'
} as const

export const outputArg = {
  type: 'string',
  alias: 'o',
  required: true,
  description: 'Output JSON path'
} as const

export const privateKeyArgs = {
  'private-key': {
    type: 'string',
    description: 'Ed25519 private key PKCS8 PEM file path'
  },
  'private-key-env': {
    type: 'string',
    description: 'Environment variable containing an Ed25519 PKCS8 PEM private key'
  }
} as const

export const publicKeyArgs = {
  'public-key': {
    type: 'string',
    description: 'Trusted Ed25519 public key SPKI PEM file path'
  },
  'public-key-env': {
    type: 'string',
    description: 'Environment variable containing a trusted Ed25519 SPKI PEM public key'
  }
} as const

interface KeyReference {
  'private-key'?: string
  'private-key-env'?: string
  'public-key'?: string
  'public-key-env'?: string
}

export async function readBoundedBytes(
  path: string,
  maximum: number,
  label: string
): Promise<Uint8Array> {
  const absolute = resolve(path)
  const info = await stat(absolute)
  if (!info.isFile()) throw new Error(`${label} must be a file.`)
  if (info.size > maximum) throw new Error(`${label} may not exceed ${maximum} bytes.`)
  const bytes = new Uint8Array(await readFile(absolute))
  if (bytes.byteLength > maximum) throw new Error(`${label} may not exceed ${maximum} bytes.`)
  return bytes
}

export async function readBoundedJSON(
  path: string,
  maximum: number,
  label: string
): Promise<unknown> {
  const bytes = await readBoundedBytes(path, maximum, label)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} must contain valid UTF-8.`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} must contain valid JSON.`)
  }
}

function environmentKey(name: string, label: string): string {
  if (!ENVIRONMENT_NAME.test(name)) {
    throw new Error(`${label} environment reference must be a valid variable name.`)
  }
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${label} environment variable ${name} is not set.`)
  }
  return value
}

async function keyText(args: KeyReference, kind: 'private' | 'public'): Promise<string> {
  const fileName = kind === 'private' ? 'private-key' : 'public-key'
  const environmentName = kind === 'private' ? 'private-key-env' : 'public-key-env'
  const file = args[fileName]
  const environment = args[environmentName]
  const label = kind === 'private' ? 'Private key' : 'Public key'
  if ((file ? 1 : 0) + (environment ? 1 : 0) !== 1) {
    throw new Error(`Provide exactly one --${fileName} or --${environmentName} reference.`)
  }
  const text = file
    ? new TextDecoder('utf-8', { fatal: true }).decode(
        await readBoundedBytes(file, MAX_KEY_BYTES, label)
      )
    : environmentKey(environment as string, label)
  if (new TextEncoder().encode(text).byteLength > MAX_KEY_BYTES) {
    throw new Error(`${label} may not exceed ${MAX_KEY_BYTES} bytes.`)
  }
  return text
}

export async function importPrivateKey(args: KeyReference): Promise<CryptoKey> {
  const source = await keyText(args, 'private')
  try {
    return await importEd25519PrivateKeyPem(source)
  } catch {
    throw new Error('Private key is not a valid Ed25519 PKCS8 key.')
  }
}

export async function importPublicKey(args: KeyReference): Promise<CryptoKey> {
  const source = await keyText(args, 'public')
  try {
    return await importEd25519PublicKeyPem(source)
  } catch {
    throw new Error('Public key is not a valid Ed25519 SPKI key.')
  }
}

export async function writeJSONOutput(
  path: string,
  source: string,
  maximum: number,
  label: string
): Promise<string> {
  if (new TextEncoder().encode(source).byteLength > maximum) {
    throw new Error(`${label} may not exceed ${maximum} bytes.`)
  }
  const output = resolve(path)
  await writeFile(output, source, 'utf8')
  return output
}

export function printJSON(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

export function optionalNonNegativeInteger(
  value: string | undefined,
  label: string
): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return parsed
}

export function requiredPositiveInteger(value: string, label: string): number {
  const parsed = optionalNonNegativeInteger(value, label)
  if (parsed === undefined || parsed === 0) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return parsed
}

export function printArtifact(
  action: string,
  header: string,
  details: Record<string, unknown>,
  output?: string
): void {
  console.log('')
  console.log(bold(`  ${action}`))
  console.log('')
  console.log(fmtList([{ header, details }]))
  if (output) console.log(ok(`Wrote ${output}`))
  console.log('')
}

export async function runPluginCommandSafely(task: () => Promise<void>): Promise<void> {
  try {
    await task()
  } catch (error) {
    printError(error)
    process.exitCode = 1
  }
}
