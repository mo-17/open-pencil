import { readPackageJSON } from 'pkg-types'
import * as v from 'valibot'

import { parseJSONObject } from '../json'
import { packageManifestSchema } from './schema'
import type { PackageManifest } from './types'

export async function readPackageManifest(path: string): Promise<PackageManifest> {
  return validatePackageIdentity(await readPackageJSON(path), path)
}

function validatePackageIdentity(manifest: Record<string, unknown>, path: string): PackageManifest {
  const parsed = v.safeParse(packageManifestSchema, manifest)
  if (!parsed.success) {
    throw new Error(`${path}: invalid package manifest: ${v.summarize(parsed.issues)}`)
  }
  return parsed.output
}

export function parsePackageManifest(text: string, context: string): PackageManifest {
  return validatePackageIdentity(parseJSONObject(text, context), context)
}

/** Validate fields present in private or intermediate workspace manifests before publication. */
export function parseWorkspacePackageJSON(text: string, context: string) {
  const parsed = v.safeParse(v.partial(packageManifestSchema), parseJSONObject(text, context))
  if (!parsed.success)
    throw new Error(`${context}: invalid package fields: ${v.summarize(parsed.issues)}`)
  return parsed.output
}
