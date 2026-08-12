import { defaultSleep, discard, retryDelay } from './client-helpers'
import { GoogleDriveError, isAbortError, isRetryableStatus, throwIfAborted } from './errors'
import {
  GOOGLE_DRIVE_MAX_UPLOAD_CHUNK_BYTES,
  GOOGLE_DRIVE_UPLOAD_CHUNK_BYTES,
  type GoogleDriveSleep
} from './types'

export type ResumableUploadRequest = (sessionURL: string, init: RequestInit) => Promise<Response>

export type ResumableUploadOptions = {
  bytes: Uint8Array
  createSession: () => Promise<string>
  request: ResumableUploadRequest
  responseError: (response: Response) => Promise<GoogleDriveError>
  signal?: AbortSignal
  onProgress?: (progress: { transferredBytes: number; totalBytes: number }) => void
  chunkBytes?: number
  maxAttempts?: number
  maxSessionRestarts?: number
  sleep?: GoogleDriveSleep
}

const DEFAULT_MAX_ATTEMPTS = 12
const DEFAULT_MAX_SESSION_RESTARTS = 2

export function validateUploadChunkBytes(chunkBytes: number): number {
  if (
    !Number.isSafeInteger(chunkBytes) ||
    chunkBytes < GOOGLE_DRIVE_UPLOAD_CHUNK_BYTES ||
    chunkBytes > GOOGLE_DRIVE_MAX_UPLOAD_CHUNK_BYTES ||
    chunkBytes % GOOGLE_DRIVE_UPLOAD_CHUNK_BYTES !== 0
  ) {
    throw new GoogleDriveError(
      'invalid-input',
      'Google Drive upload chunks must be a 256 KiB multiple no larger than 8 MiB'
    )
  }
  return chunkBytes
}

export function nextOffsetFromRange(range: string | null, totalBytes: number): number {
  if (!range) return 0
  const match = /^bytes=0-(\d+)$/.exec(range.trim())
  if (!match) {
    throw new GoogleDriveError('invalid-response', 'Google Drive returned an invalid upload Range')
  }
  const lastByte = Number(match[1])
  if (!Number.isSafeInteger(lastByte) || lastByte < 0 || lastByte >= totalBytes) {
    throw new GoogleDriveError(
      'invalid-response',
      'Google Drive acknowledged bytes outside the upload bounds'
    )
  }
  return lastByte + 1
}

function isRetryableError(error: unknown): boolean {
  return error instanceof GoogleDriveError && error.retryable
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function validateAttemptLimits(maxAttempts: number, maxSessionRestarts: number): void {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new GoogleDriveError('invalid-input', 'Google Drive upload attempt limit is invalid')
  }
  if (!Number.isSafeInteger(maxSessionRestarts) || maxSessionRestarts < 0) {
    throw new GoogleDriveError('invalid-input', 'Google Drive upload restart limit is invalid')
  }
}

/**
 * Uploads one immutable byte snapshot. A 404 restarts from byte zero with a new
 * session; ambiguous network/5xx outcomes are resolved with an empty status PUT.
 */
export async function uploadResumable(options: ResumableUploadOptions): Promise<Response> {
  const {
    bytes,
    createSession,
    request,
    responseError,
    signal,
    onProgress,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    maxSessionRestarts = DEFAULT_MAX_SESSION_RESTARTS,
    sleep = defaultSleep
  } = options
  const chunkBytes = validateUploadChunkBytes(options.chunkBytes ?? GOOGLE_DRIVE_UPLOAD_CHUNK_BYTES)
  validateAttemptLimits(maxAttempts, maxSessionRestarts)

  const totalBytes = bytes.byteLength
  let sessionURL = await createSession()
  let offset = 0
  let attempts = 0
  let restarts = 0
  let noProgressResponses = 0

  const restartSession = async (): Promise<void> => {
    if (restarts >= maxSessionRestarts) {
      throw new GoogleDriveError(
        'upload-session-expired',
        'Google Drive upload session expired repeatedly',
        { status: 404, retryable: false }
      )
    }
    restarts += 1
    sessionURL = await createSession()
    offset = 0
    noProgressResponses = 0
    onProgress?.({ transferredBytes: 0, totalBytes })
  }

  const responseRetryDelay = async (response: Response): Promise<number | null> => {
    if (isRetryableStatus(response.status)) return retryDelay(response, attempts)
    if (response.status !== 403) return null
    const classified = await responseError(response.clone())
    return classified.retryable ? (classified.retryAfterMs ?? retryDelay(response, attempts)) : null
  }

  const sendBounded = async (init: RequestInit): Promise<Response> => {
    throwIfAborted(signal)
    if (attempts >= maxAttempts) {
      throw new GoogleDriveError('network', 'Google Drive upload retry limit was reached', {
        retryable: false
      })
    }
    attempts += 1
    try {
      return await request(sessionURL, { ...init, signal })
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        throw new GoogleDriveError('aborted', 'Google Drive operation was cancelled', {
          cause: error
        })
      }
      if (error instanceof GoogleDriveError) throw error
      throw new GoogleDriveError('network', 'Google Drive upload request failed', {
        retryable: true,
        cause: error
      })
    }
  }

  const applyResumeResponse = async (
    response: Response
  ): Promise<'complete' | 'restart' | 'resume'> => {
    if (response.status === 200 || response.status === 201) return 'complete'
    if (response.status === 404) {
      await discard(response)
      return 'restart'
    }
    if (response.status !== 308) throw await responseError(response)
    const nextOffset = nextOffsetFromRange(response.headers.get('range'), totalBytes)
    await discard(response)
    if (nextOffset === offset) {
      noProgressResponses += 1
      if (noProgressResponses > 3) {
        throw new GoogleDriveError(
          'invalid-response',
          'Google Drive upload made no acknowledged progress'
        )
      }
    } else {
      noProgressResponses = 0
    }
    offset = nextOffset
    onProgress?.({ transferredBytes: offset, totalBytes })
    return 'resume'
  }

  const probe = async (): Promise<Response | 'restart' | null> => {
    for (;;) {
      let response: Response
      try {
        response = await sendBounded({
          method: 'PUT',
          headers: {
            'Content-Length': '0',
            'Content-Range': `bytes */${totalBytes}`
          }
        })
      } catch (error) {
        if (!isRetryableError(error)) throw error
        await sleep(retryDelay(null, attempts), signal)
        continue
      }

      const delayMs = await responseRetryDelay(response)
      if (delayMs !== null) {
        await discard(response)
        await sleep(delayMs, signal)
        continue
      }
      const state = await applyResumeResponse(response)
      if (state === 'complete') return response
      if (state === 'restart') return 'restart'
      return null
    }
  }

  onProgress?.({ transferredBytes: 0, totalBytes })
  for (;;) {
    throwIfAborted(signal)
    const endExclusive = Math.min(offset + chunkBytes, totalBytes)
    const body = exactArrayBuffer(bytes.subarray(offset, endExclusive))
    const contentRange =
      totalBytes === 0
        ? 'bytes */0'
        : `bytes ${offset}-${Math.max(offset, endExclusive - 1)}/${totalBytes}`

    let response: Response
    try {
      response = await sendBounded({
        method: 'PUT',
        headers: {
          'Content-Length': String(body.byteLength),
          'Content-Range': contentRange
        },
        body
      })
    } catch (error) {
      if (!isRetryableError(error)) throw error
      await sleep(retryDelay(null, attempts), signal)
      const probed = await probe()
      if (probed instanceof Response) return probed
      if (probed === 'restart') await restartSession()
      continue
    }

    const delayMs = await responseRetryDelay(response)
    if (delayMs !== null) {
      await discard(response)
      await sleep(delayMs, signal)
      const probed = await probe()
      if (probed instanceof Response) return probed
      if (probed === 'restart') await restartSession()
      continue
    }

    const state = await applyResumeResponse(response)
    if (state === 'complete') {
      onProgress?.({ transferredBytes: totalBytes, totalBytes })
      return response
    }
    if (state === 'restart') await restartSession()
  }
}
