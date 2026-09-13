import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { createBuiltinBackendProviderRegistry } from '../backend/builtins'
import { emitBackendProviderPlan } from '../backend/emit'
import { validateNestJSConnectedPreview } from '../backend/nestjs/connected-preview'
import {
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  NESTJS_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST
} from '../backend/nestjs/descriptor'
import { MANAGED_CONFIGURATION_SOURCE } from '../backend/nestjs/local-run/configuration'
import { nestJSPreviewApplicationDigest } from '../backend/nestjs/preview-digest'
import { createBackendProviderPlan } from '../backend/plan'
import type { ManagedPreviewDirectory } from './directory'

export function rawDigest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}
export function compileManagedGeneration(
  application: BackendApplicationSpecV1
): Map<string, string> {
  const selection = {
    descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
    packageDigest: NESTJS_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST,
    enabled: true
  }
  const registry = createBuiltinBackendProviderRegistry()
  if (
    !validateNestJSConnectedPreview({
      selection,
      application,
      target: 'react',
      applicationDigest: nestJSPreviewApplicationDigest(application)
    }).ok
  )
    throw new Error('The reviewed NestJS preset does not support this managed preview application.')
  const plan = createBackendProviderPlan(registry, {
    selection,
    application,
    mode: 'production',
    target: 'react'
  })
  if (!plan.ok)
    throw new Error('The reviewed NestJS preset does not support this managed preview application.')
  const emitted = emitBackendProviderPlan(registry, { selection, plan: plan.plan })
  if (!emitted.ok) throw new Error('The managed NestJS source could not be emitted.')
  const files = new Map<string, string>()
  for (const [path, content] of emitted.emission.files) {
    if (!path.startsWith('backend/nestjs/')) continue
    const name = path.slice('backend/nestjs/'.length)
    if (
      !name ||
      name.split('/').some((part) => !part || part === '..' || part === '.') ||
      typeof content !== 'string'
    )
      throw new Error('Invalid managed generated artifact.')
    files.set(name, name === 'scripts/local-config.mjs' ? MANAGED_CONFIGURATION_SOURCE : content)
  }
  return files
}
export function writeManagedGeneration(
  directory: ManagedPreviewDirectory,
  application: BackendApplicationSpecV1,
  initialSQL?: string
): string {
  const digest = nestJSPreviewApplicationDigest(application)
  const files = compileManagedGeneration(application)
  if (initialSQL !== undefined) files.set('migrations/001-initial.sql', initialSQL)
  for (const [path, value] of files) directory.write(`generations/${digest}/${path}`, value)
  const packageJSON = files.get('package.json')
  const lock = files.get('package-lock.json')
  if (!packageJSON || !lock) throw new Error('Managed dependency lock is missing.')
  directory.write('package.json', packageJSON)
  directory.write('package-lock.json', lock)
  directory.json(
    `generations/${digest}/generated-files.json`,
    [...files].map(([path, content]) => ({ path, digest: rawDigest(content) }))
  )
  return digest
}
export function verifyManagedGeneration(
  directory: ManagedPreviewDirectory,
  application: BackendApplicationSpecV1,
  initialSQL?: string
): void {
  const digest = nestJSPreviewApplicationDigest(application)
  const files = compileManagedGeneration(application)
  if (initialSQL !== undefined) files.set('migrations/001-initial.sql', initialSQL)
  for (const [path, expected] of files) {
    if (readFileSync(directory.path(`generations/${digest}/${path}`), 'utf8') !== expected)
      throw new Error(
        'Managed generated files changed. Prepare and rebuild the managed preview again.'
      )
  }
}
