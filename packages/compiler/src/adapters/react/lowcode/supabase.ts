/**
 * Compatibility exports. Supabase-specific artifact generation is owned by
 * the reviewed Backend Provider helper while legacy import paths stay stable.
 */
export {
  buildLegacySupabaseClientRuntime as buildLowcodeSupabaseRuntime,
  buildLegacySupabaseEnvironmentExample as buildSupabaseEnvExample,
  buildLegacySupabaseViteEnvironmentTypes as buildViteEnvDts,
  SUPABASE_JS_VERSION
} from '#compiler/backend/supabase/legacy-react-artifacts'
