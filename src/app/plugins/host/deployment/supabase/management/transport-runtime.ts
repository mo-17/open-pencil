interface SupabaseManagementAbortScope {
  readonly signal: AbortSignal
}

interface SupabaseManagementDisposableScope {
  dispose(): void
}

/** Shared lifetime returned by Management transports that only merge abort signals. */
export type SupabaseManagementRequestLifetime = SupabaseManagementAbortScope &
  SupabaseManagementDisposableScope

/** Shared lifetime returned by Management transports that distinguish deadline expiry. */
export type SupabaseManagementRequestDeadline = SupabaseManagementRequestLifetime & {
  readonly timedOut: () => boolean
}

interface SupabaseManagementResponseBody {
  readonly bytes: Uint8Array
}

/** Bounded response snapshot retained after the native/fetch response body is consumed. */
export type SupabaseManagementBoundedResponse = Pick<Response, 'status' | 'url' | 'redirected'> &
  SupabaseManagementResponseBody & {
    readonly contentType: string | null
  }
