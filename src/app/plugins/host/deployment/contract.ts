import type {
  DeclarativeCommandContributionV2,
  PluginContributionDataContractV2
} from '@open-pencil/plugin-contracts'

import type { DeployProvider } from '@/app/lowcode/preview-pane/deploy/runner'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialRef } from '@/app/settings/credentials/types'

export const DEPLOYMENT_PLUGIN_CONTRACT_VERSION = 1 as const

export type DeploymentPluginProvider = Extract<DeployProvider, 'vercel' | 'cloudflare'>

export interface DeploymentPluginDefinition {
  readonly contractVersion: typeof DEPLOYMENT_PLUGIN_CONTRACT_VERSION
  readonly pluginId: string
  readonly contributionId: string
  readonly adapterId: string
  readonly name: string
  readonly description: string
  readonly provider: DeploymentPluginProvider
  readonly credentialRef: CredentialRef
  readonly installation: Readonly<{
    installedByDefault: false
    enabledByDefault: false
    mcpVisibility: 'installed-enabled-only'
  }>
  readonly authority: Readonly<{
    processCommand: 'lowcode-preview'
    networkOrigins: readonly string[]
    credentialEnvironmentVariable: 'VERCEL_TOKEN' | 'CLOUDFLARE_API_TOKEN'
    sideEffect: 'remote-deployment'
    confirmation: 'every-invocation'
    cancellation: 'before-dispatch-only'
  }>
  readonly ui: Readonly<{
    targetLabel: string
    targetPlaceholder: string
    targetRequired: boolean
    tokenLabel: string
    tokenHelpUrl: string
    environmentNotice: string
    confirmationItems: readonly string[]
  }>
  /** Read-only contribution that can be exposed through the existing installed-plugin MCP path. */
  readonly mcpSafePlan: DeclarativeCommandContributionV2
  readonly parameters: PluginContributionDataContractV2
  readonly result: PluginContributionDataContractV2
}

const RUNTIME_CONFIG_SCHEMA = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    supabaseUrl: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 2_048 }),
    supabasePublishableKey: Object.freeze({
      type: 'string' as const,
      minLength: 1,
      maxLength: 8_192
    }),
    supabaseAnonKey: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 8_192 }),
    supabaseSchema: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 63 })
  }),
  additionalProperties: false as const,
  maxProperties: 4
})

export const DEPLOYMENT_PLUGIN_PARAMETERS = Object.freeze({
  schema: Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({
      environment: Object.freeze({
        type: 'string' as const,
        enum: Object.freeze(['preview', 'staging', 'production'] as const),
        description:
          'OpenPencil deployment history label. Provider targeting is shown in the confirmation review.'
      }),
      target: Object.freeze({
        type: 'string' as const,
        minLength: 1,
        maxLength: 256,
        description:
          'Vercel project name, or the required Cloudflare account-id/project-name target.'
      }),
      uiKit: Object.freeze({
        type: 'string' as const,
        enum: Object.freeze(['none', 'shadcn'] as const)
      }),
      locales: Object.freeze({
        type: 'array' as const,
        items: Object.freeze({ type: 'string' as const, minLength: 2, maxLength: 35 }),
        maxItems: 20
      }),
      runtimeConfig: RUNTIME_CONFIG_SCHEMA
    }),
    additionalProperties: false as const,
    maxProperties: 5
  }),
  maxBytes: 16 * 1024
}) satisfies PluginContributionDataContractV2

const DEPLOYMENT_PROVIDER_SCHEMA = Object.freeze({
  type: 'string' as const,
  enum: Object.freeze(['vercel', 'cloudflare'] as const)
})

const DEPLOYMENT_ENVIRONMENT_SCHEMA = Object.freeze({
  type: 'string' as const,
  enum: Object.freeze(['preview', 'staging', 'production'] as const)
})

export const DEPLOYMENT_PLUGIN_RESULT = Object.freeze({
  schema: Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({
      provider: DEPLOYMENT_PROVIDER_SCHEMA,
      environment: DEPLOYMENT_ENVIRONMENT_SCHEMA,
      url: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 4_096 }),
      deployId: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 1_024 }),
      fileCount: Object.freeze({ type: 'integer' as const, minimum: 0 }),
      backendDeploymentRequired: Object.freeze({ type: 'boolean' as const })
    }),
    required: Object.freeze([
      'provider',
      'environment',
      'url',
      'deployId',
      'fileCount',
      'backendDeploymentRequired'
    ]),
    additionalProperties: false as const,
    minProperties: 6,
    maxProperties: 6
  }),
  maxBytes: 16 * 1024
}) satisfies PluginContributionDataContractV2

export const DEPLOYMENT_PLUGIN_PLAN_RESULT = Object.freeze({
  schema: Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({
      provider: DEPLOYMENT_PROVIDER_SCHEMA,
      environment: DEPLOYMENT_ENVIRONMENT_SCHEMA,
      target: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 256 }),
      documentSaved: Object.freeze({ type: 'boolean' as const }),
      requiresConfirmation: Object.freeze({
        type: 'boolean' as const,
        enum: Object.freeze([true])
      }),
      environmentNotice: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 1_000 }),
      sideEffects: Object.freeze({
        type: 'array' as const,
        items: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 1_000 }),
        minItems: 1,
        maxItems: 8
      })
    }),
    required: Object.freeze([
      'provider',
      'environment',
      'target',
      'documentSaved',
      'requiresConfirmation',
      'environmentNotice',
      'sideEffects'
    ]),
    additionalProperties: false as const,
    minProperties: 7,
    maxProperties: 7
  }),
  maxBytes: 16 * 1024
}) satisfies PluginContributionDataContractV2

const INSTALLATION = Object.freeze({
  installedByDefault: false as const,
  enabledByDefault: false as const,
  mcpVisibility: 'installed-enabled-only' as const
})

const COMMON_CONFIRMATION_ITEMS = Object.freeze([
  'Build the current saved OpenPencil document locally.',
  'Upload the generated static files to the selected provider.',
  'Create a new remote deployment that may become publicly reachable.'
])

function providerCredentialRef(pluginId: string): CredentialRef {
  return credentialRef(pluginId, 'provider-token')
}

function mcpSafePlanCommand(
  provider: DeploymentPluginProvider,
  commandId: string,
  adapterId: string
): DeclarativeCommandContributionV2 {
  const providerName = provider === 'vercel' ? 'Vercel' : 'Cloudflare Pages'
  return Object.freeze({
    commandId,
    adapterId,
    name: `Review ${providerName} deployment plan`,
    description: `Validate and describe a ${providerName} deployment without reading credentials, building files, or changing remote state.`,
    parameters: DEPLOYMENT_PLUGIN_PARAMETERS,
    result: DEPLOYMENT_PLUGIN_PLAN_RESULT,
    permissions: Object.freeze(['document.read'] as const)
  })
}

function deploymentPluginDefinition(
  provider: DeploymentPluginProvider
): DeploymentPluginDefinition {
  const isVercel = provider === 'vercel'
  const providerName = isVercel ? 'Vercel' : 'Cloudflare Pages'
  const pluginId = isVercel ? 'open-pencil.vercel-deploy' : 'open-pencil.cloudflare-pages-deploy'
  return Object.freeze({
    contractVersion: DEPLOYMENT_PLUGIN_CONTRACT_VERSION,
    pluginId,
    contributionId: isVercel ? 'deploy-vercel-project' : 'deploy-cloudflare-pages',
    adapterId: isVercel ? 'open-pencil.deploy.vercel' : 'open-pencil.deploy.cloudflare-pages',
    name: `${providerName} Deploy`,
    description: `Build and deploy the current saved document through the reviewed OpenPencil ${providerName} engine.`,
    provider,
    credentialRef: providerCredentialRef(pluginId),
    installation: INSTALLATION,
    authority: Object.freeze({
      processCommand: 'lowcode-preview',
      networkOrigins: Object.freeze([
        isVercel ? 'https://api.vercel.com' : 'https://api.cloudflare.com'
      ]),
      credentialEnvironmentVariable: isVercel
        ? ('VERCEL_TOKEN' as const)
        : ('CLOUDFLARE_API_TOKEN' as const),
      sideEffect: 'remote-deployment',
      confirmation: 'every-invocation',
      cancellation: 'before-dispatch-only'
    }),
    ui: Object.freeze({
      targetLabel: isVercel ? 'Vercel project' : 'Cloudflare account and Pages project',
      targetPlaceholder: isVercel ? 'existing-project-name (optional)' : 'account-id/project-name',
      targetRequired: !isVercel,
      tokenLabel: isVercel ? 'Vercel access token' : 'Cloudflare API token',
      tokenHelpUrl: isVercel
        ? 'https://vercel.com/account/tokens'
        : 'https://dash.cloudflare.com/profile/api-tokens',
      environmentNotice: isVercel
        ? 'The current deploy engine creates a Vercel production deployment; the environment field is an OpenPencil history label.'
        : 'The environment field is an OpenPencil history label; the reviewed target remains this exact Pages project.',
      confirmationItems: COMMON_CONFIRMATION_ITEMS
    }),
    mcpSafePlan: mcpSafePlanCommand(
      provider,
      isVercel ? 'review-vercel-deployment-plan' : 'review-cloudflare-pages-deployment-plan',
      isVercel
        ? 'open-pencil.deploy.vercel.review-plan'
        : 'open-pencil.deploy.cloudflare-pages.review-plan'
    ),
    parameters: DEPLOYMENT_PLUGIN_PARAMETERS,
    result: DEPLOYMENT_PLUGIN_RESULT
  })
}

export const VERCEL_DEPLOYMENT_PLUGIN = deploymentPluginDefinition('vercel')

export const CLOUDFLARE_DEPLOYMENT_PLUGIN = deploymentPluginDefinition('cloudflare')

export const REVIEWED_DEPLOYMENT_PLUGINS = Object.freeze([
  VERCEL_DEPLOYMENT_PLUGIN,
  CLOUDFLARE_DEPLOYMENT_PLUGIN
])
