import type {
  DeclarativeCommandContributionV2,
  PluginConnectorContractV1,
  PluginConnectorOperationV1
} from '@open-pencil/plugin-contracts'

import type { InstalledAppPlugin } from '../types'

export const THIRD_PARTY_PLUGIN_AI_ALLOWED_KINDS = Object.freeze(['command', 'connector'] as const)

export type ThirdPartyPluginAIContributionKind =
  (typeof THIRD_PARTY_PLUGIN_AI_ALLOWED_KINDS)[number]

export interface ThirdPartyPluginAIContributionRequest {
  readonly pluginId: string
  readonly kind: ThirdPartyPluginAIContributionKind
  readonly contributionId: string
}

interface ThirdPartyPluginAIReviewBase extends ThirdPartyPluginAIContributionRequest {
  readonly adapterId: string
  readonly packageDigest: string
  readonly pluginVersion: string
  readonly publisherId: string
  readonly publisherKeyId: string
}

export type ThirdPartyPluginAIContributionReview = Readonly<
  | (ThirdPartyPluginAIReviewBase & {
      readonly kind: 'command'
    })
  | (ThirdPartyPluginAIReviewBase & {
      readonly kind: 'connector'
      readonly connectorId: string
      readonly operationId: string
    })
>

export type ThirdPartyPluginAIContributionGrant = Readonly<
  ThirdPartyPluginAIContributionReview & {
    readonly grantId: string
    readonly grantedAt: number
  }
>

export type ThirdPartyPluginAIGrantListener = (
  grants: readonly ThirdPartyPluginAIContributionGrant[]
) => void

export type ThirdPartyPluginAIEligibilityFailureCode =
  | 'plugin-unavailable'
  | 'not-publisher-signed'
  | 'plugin-disabled'
  | 'plugin-blocked'
  | 'signed-package-unavailable'
  | 'contribution-kind-denied'
  | 'contribution-unavailable'
  | 'manifest-version-denied'
  | 'write-permission-denied'
  | 'mutation-denied'
  | 'host-review-denied'

export type ThirdPartyPluginAIEligibility =
  | Readonly<{ ok: true; review: ThirdPartyPluginAIContributionReview }>
  | Readonly<{
      ok: false
      code: ThirdPartyPluginAIEligibilityFailureCode
      reason: string
    }>

export interface ThirdPartyPluginAIHostPolicy {
  inspectCommand(
    pluginId: string,
    contribution: DeclarativeCommandContributionV2
  ): Readonly<{ ok: true } | { ok: false; reason: string }>
  isConnectorQueryEligible(
    contribution: PluginConnectorContractV1,
    operation: PluginConnectorOperationV1
  ): boolean
}

export interface CreateThirdPartyPluginAIGrantManagerOptions {
  readonly resolveInstalledPlugin: (pluginId: string) => InstalledAppPlugin | undefined
  readonly hostPolicy?: ThirdPartyPluginAIHostPolicy
  readonly createGrantId?: () => string
  readonly now?: () => number
  readonly maxGrants?: number
}
