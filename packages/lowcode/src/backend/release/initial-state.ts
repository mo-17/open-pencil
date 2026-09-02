import { sealBackendReleaseState } from './state-authority'
import type { BackendReleaseStateV1 } from './types'
import { BACKEND_RELEASE_STATE_VERSION } from './types'
import { releaseIdentifier } from './validation'

export function createBackendReleaseState(releaseId: string): BackendReleaseStateV1 {
  return sealBackendReleaseState({
    version: BACKEND_RELEASE_STATE_VERSION,
    releaseId: releaseIdentifier(releaseId, 'releaseId'),
    phase: 'inspect',
    outcome: 'pending',
    dispatch: 'not-dispatched',
    automaticRetryAllowed: true,
    reconcileRequired: false,
    inspection: null,
    plan: null,
    artifacts: null,
    review: null,
    confirmations: [],
    applyReinspectionAccepted: false,
    singleFlightKey: null,
    remoteOperationIds: [],
    verifiedAt: null,
    gates: [],
    releaseReady: false,
    backendDeploymentRequired: true,
    failureCode: null,
    receipt: null
  })
}
