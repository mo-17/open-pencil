import type { PluginContributionDataContractV2 } from '@open-pencil/plugin-contracts'

/** Shared no-argument contract for app-owned example adapters. */
export const EXAMPLE_EMPTY_PARAMETERS = Object.freeze({
  schema: Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({}),
    additionalProperties: false as const,
    maxProperties: 0
  }),
  maxBytes: 2
}) satisfies PluginContributionDataContractV2
