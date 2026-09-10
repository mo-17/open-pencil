/** Stable journal coordinates shared by Supabase backfill mutation authorities. */
export interface SupabaseBackfillDispatchBindingV1 {
  readonly singleFlightKey: string
  readonly dispatchScopeKey: string
  readonly planDigest: string
}
