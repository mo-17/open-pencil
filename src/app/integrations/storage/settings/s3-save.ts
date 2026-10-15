import type { S3CredentialField } from '../s3/authority'

export type S3SettingsSaveOutcome = 'invalid' | 'stale' | 'saved' | 'failed' | 'partial'

interface S3SettingsSaveContext {
  fields: readonly S3CredentialField[]
  validate(): Promise<boolean>
  isCurrent(): boolean
  persistenceRevision(): number
  savePreferences(): Promise<boolean>
  saveCredential(field: S3CredentialField): Promise<boolean>
}

/** Persist one captured profile; previously committed preferences/grants cannot roll back. */
export async function saveS3SettingsDraft(
  context: S3SettingsSaveContext
): Promise<S3SettingsSaveOutcome> {
  const before = context.persistenceRevision()
  const failure = (): S3SettingsSaveOutcome => {
    if (!context.isCurrent()) return 'stale'
    return context.persistenceRevision() === before ? 'failed' : 'partial'
  }
  const valid = await context.validate()
  if (!context.isCurrent()) return 'stale'
  if (!valid) return 'invalid'
  try {
    if (!(await context.savePreferences())) return failure()
    for (const field of context.fields) {
      if (!context.isCurrent()) return 'stale'
      if (!(await context.saveCredential(field))) return failure()
    }
    return context.isCurrent() ? 'saved' : 'stale'
  } catch {
    return failure()
  }
}
