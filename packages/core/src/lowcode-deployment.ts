export type DeployEnvironment = 'preview' | 'staging' | 'production'

export function resolveDeployEnvironment(raw: string | undefined): DeployEnvironment {
  const environment = (raw ?? 'preview').toLowerCase()
  if (environment === 'preview' || environment === 'staging' || environment === 'production') {
    return environment
  }
  throw new Error(
    `Unknown deploy environment '${environment}'. Supported: preview, staging, production.`
  )
}
