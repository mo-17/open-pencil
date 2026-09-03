import type {
  BackendHostReleaseReconcileInput,
  BackendHostReleaseReconcileResult
} from '../backend/release-controller'

const EMPTY_REMOTE_OPERATION_IDS: readonly string[] = Object.freeze([])
const UNKNOWN_RESULT: BackendHostReleaseReconcileResult = Object.freeze({
  outcome: 'outcome-unknown',
  code: 'supabase-staging-apply-outcome-not-provable',
  remoteOperationIds: EMPTY_REMOTE_OPERATION_IDS
})

/**
 * Supabase's synchronous Management query endpoint does not expose a durable operation ID or a
 * provider-side idempotency fence. An unchanged catalog is only negative evidence: a previously
 * claimed owner can still resume before POST, or an accepted request can finish later. Therefore a
 * pending/unknown claim cannot be terminalized from catalog equality or elapsed local time.
 */
export function reconcileSupabaseStagingBaseline(
  _input: BackendHostReleaseReconcileInput,
  _observedAt: string
): BackendHostReleaseReconcileResult {
  return UNKNOWN_RESULT
}
