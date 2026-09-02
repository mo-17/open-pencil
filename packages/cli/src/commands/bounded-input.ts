import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

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
