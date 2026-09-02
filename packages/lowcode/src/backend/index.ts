export { BACKEND_LIMITS } from './limits'
export * from './types'
export {
  BACKEND_CAPABILITIES,
  isBackendCredentialRef,
  parseBackendApplicationSpecV1,
  validateDataModelIR
} from './validate'
export { containsBackendSecretLikeMaterial } from './secret-boundary'
export {
  deriveBackendApplicationCapabilities,
  validateBackendCapabilityDeclarations
} from './capability-derivation'
export {
  canonicalBackendApplicationBytes,
  canonicalDataModelBytes,
  digestBackendApplication,
  digestDataModel,
  normalizedBackendApplication,
  normalizedDataModel
} from './canonical'
export {
  classifyMigrationOperationRisk,
  planBackendMigration,
  validateMigrationPlan
} from './migration'
export {
  type LegacyBackendGraph,
  type LegacySupabaseLoweringResult,
  lowerLegacySupabaseApplication
} from './legacy-supabase'
export * from './release'
