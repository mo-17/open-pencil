import { X509Certificate } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, unlinkSync } from 'node:fs'
import { isAbsolute } from 'node:path'

import type { ManagedPreviewDirectory } from './directory'
import { parseManagedPreviewCommand } from './parse'
import type { ManagedSnapshot } from './plan'

export interface ManagedPending {
  readonly from: ManagedSnapshot | null
  readonly to: ManagedSnapshot
  readonly planId: string
}
function snapshot(value: unknown): ManagedSnapshot {
  if (
    !value ||
    typeof value !== 'object' ||
    !('application' in value) ||
    !('config' in value) ||
    Object.keys(value).length !== 2
  )
    throw new Error('Managed preview snapshot is invalid.')
  const command = parseManagedPreviewCommand({
    version: 1,
    id: 'snapshot',
    command: 'prepare',
    application: value.application,
    config: value.config
  })
  if (command.command !== 'prepare') throw new Error('Invalid managed snapshot.')
  return { application: command.application, config: command.config }
}
export function loadSnapshot(
  directory: ManagedPreviewDirectory,
  name: string
): ManagedSnapshot | null {
  const value = directory.read(name)
  return value === null ? null : snapshot(value)
}
export function loadPending(directory: ManagedPreviewDirectory): ManagedPending | null {
  const value = directory.read('pending.json')
  if (value === null) return null
  if (
    !value ||
    typeof value !== 'object' ||
    !('from' in value) ||
    !('to' in value) ||
    !('planId' in value) ||
    Object.keys(value).length !== 3
  )
    throw new Error('Managed pending record is invalid.')
  const checked = parseManagedPreviewCommand({
    version: 1,
    id: 'pending',
    command: 'apply',
    planId: value.planId
  })
  if (checked.command !== 'apply') throw new Error('Invalid managed pending identity.')
  return {
    from: value.from === null ? null : snapshot(value.from),
    to: snapshot(value.to),
    planId: checked.planId
  }
}
export function removePending(directory: ManagedPreviewDirectory): void {
  const path = directory.path('pending.json')
  if (existsSync(path)) unlinkSync(path)
}
export function initialSQL(directory: ManagedPreviewDirectory): string | undefined {
  const path = directory.path('initial.sql')
  if (!existsSync(path)) return undefined
  if (lstatSync(path).size > 1048576) throw new Error('Managed initial schema is oversized.')
  return readFileSync(path, 'utf8')
}
export function writeConfiguration(
  directory: ManagedPreviewDirectory,
  value: ManagedSnapshot
): void {
  const authentication = value.application.httpApi?.browserClient?.authentication
  if (!authentication) throw new Error('Managed preview requires the document OIDC browser client.')
  directory.json('.local/config.json', {
    version: 1,
    issuer: authentication.issuer,
    audience: value.config.audience,
    jwksURL: value.config.jwksURL,
    caFile: value.config.caFile,
    webPort: value.config.previewPort,
    apiPort: value.config.apiPort,
    dbPort: value.config.dbPort
  })
}
function parseTrustCertificate(source: string): X509Certificate {
  return new X509Certificate(source)
}
export function validateCertificate(path: string): void {
  if (!path) return
  if (!isAbsolute(path)) throw new Error('Select an absolute trusted trusted certificate path.')
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 262144)
    throw new Error('Select a regular PEM trusted certificate file no larger than 256 KiB.')
  const source = readFileSync(path, 'utf8')
  const certificates = source.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
  if (!certificates?.length || /PRIVATE KEY/.test(source))
    throw new Error(
      'The selected trusted certificate file must contain public PEM certificates only.'
    )
  try {
    for (const certificate of certificates) parseTrustCertificate(certificate)
  } catch {
    throw new Error('The selected trusted certificate could not be parsed.')
  }
}
