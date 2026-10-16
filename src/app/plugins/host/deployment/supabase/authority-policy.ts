/** Local observations/reviews never grant any operation authority. */
export const SUPABASE_NO_CREATED_AUTHORITY = Object.freeze({
  credentialAuthorityCreated: false,
  transportAuthorityCreated: false,
  databaseAuthorityCreated: false,
  mutationAuthorityCreated: false,
  executionAuthorityCreated: false,
  receiptAuthorityCreated: false,
  releaseAuthorityCreated: false
} as const)
