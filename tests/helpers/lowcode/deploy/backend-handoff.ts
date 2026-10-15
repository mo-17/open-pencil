import * as v from 'valibot'

import {
  BACKEND_COMPILATION_MODES,
  BACKEND_PROVIDER_OUTPUT_KINDS,
  type BackendArtifactManifestV1
} from '@open-pencil/compiler/backend'
import {
  BACKEND_CAPABILITIES,
  isBackendCredentialRef,
  type BackendCredentialRef
} from '@open-pencil/lowcode/backend'

import type {
  DeploymentPluginReview,
  DeploymentPluginResult
} from '@/app/plugins/host/deployment/provider'

const deploymentProvider = v.picklist(['vercel', 'cloudflare'])
const deploymentEnvironment = v.picklist(['preview', 'staging', 'production'])
const capabilityStatus = v.picklist([
  'supported',
  'source-only',
  'unsupported',
  'requires-server-bridge'
])

export const backendArtifactManifestSchema = v.looseObject({
  format: v.literal('openpencil.backend-artifacts.v1'),
  version: v.literal(1),
  authority: v.looseObject({
    pluginId: v.string(),
    packageDigest: v.string(),
    contributionId: v.string(),
    providerId: v.string(),
    adapterId: v.string(),
    adapterVersion: v.string(),
    contractVersion: v.literal(1),
    supportedModelVersions: v.array(v.number()),
    capabilities: v.array(v.picklist(BACKEND_CAPABILITIES)),
    outputs: v.array(v.picklist(BACKEND_PROVIDER_OUTPUT_KINDS))
  }),
  applicationDigest: v.string(),
  planDigest: v.string(),
  target: v.picklist([
    'react',
    'vue',
    'expo',
    'flutter',
    'wechat-miniprogram',
    'taro',
    'uni-app',
    'mpx'
  ]),
  mode: v.picklist(BACKEND_COMPILATION_MODES),
  capabilities: v.array(
    v.looseObject({
      capability: v.picklist(BACKEND_CAPABILITIES),
      required: v.boolean(),
      providerSupported: v.boolean(),
      targetStatus: capabilityStatus,
      resolution: capabilityStatus,
      included: v.boolean()
    })
  ),
  requiredSecrets: v.array(
    v.variant('kind', [
      v.looseObject({
        kind: v.literal('environment'),
        name: v.string(),
        exposure: v.picklist(['server', 'client-public']),
        required: v.boolean()
      }),
      v.looseObject({
        kind: v.literal('credential'),
        credentialRef: v.custom<BackendCredentialRef>(isBackendCredentialRef),
        name: v.string(),
        exposure: v.picklist(['host', 'server']),
        required: v.boolean()
      })
    ])
  ),
  artifacts: v.array(
    v.looseObject({
      path: v.string(),
      kind: v.picklist(BACKEND_PROVIDER_OUTPUT_KINDS),
      mediaType: v.string(),
      byteLength: v.number(),
      digest: v.string()
    })
  )
}) satisfies v.GenericSchema<unknown, BackendArtifactManifestV1>

const deploymentReviewSchema = v.looseObject({
  pluginId: v.string(),
  contributionId: v.string(),
  provider: deploymentProvider,
  environment: deploymentEnvironment,
  target: v.string(),
  uiKit: v.picklist(['none', 'shadcn']),
  locales: v.array(v.string()),
  hasRuntimeOverrides: v.boolean(),
  environmentNotice: v.string(),
  sideEffects: v.array(v.string()),
  credentialLabel: v.string(),
  documentLabel: v.string(),
  documentIdentity: v.string(),
  backendProvider: v.optional(
    v.looseObject({
      pluginId: v.string(),
      contributionId: v.string(),
      providerId: v.string(),
      adapterId: v.string(),
      packageDigest: v.string(),
      applicationDigest: v.string(),
      planDigest: v.string(),
      manifestDigest: v.string()
    })
  )
}) satisfies v.GenericSchema<unknown, DeploymentPluginReview>

const deploymentResultSchema = v.object({
  provider: deploymentProvider,
  environment: deploymentEnvironment,
  url: v.string(),
  deployId: v.string(),
  fileCount: v.number(),
  backendDeploymentRequired: v.boolean()
}) satisfies v.GenericSchema<unknown, DeploymentPluginResult>

export const providerObservationSchema = v.looseObject({
  url: v.string(),
  method: v.optional(v.string()),
  staticPaths: v.array(v.string()),
  manifest: backendArtifactManifestSchema,
  manifestDigest: v.string(),
  migrationProposal: v.string()
})

export const hostReportSchema = v.looseObject({
  review: deploymentReviewSchema,
  markerCount: v.number(),
  legacyHasBackendManifest: v.boolean(),
  result: v.optional(deploymentResultSchema),
  error: v.optional(
    v.looseObject({ name: v.string(), message: v.string(), code: v.optional(v.string()) })
  )
})
