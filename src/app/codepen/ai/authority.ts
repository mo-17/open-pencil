import type { AIShadowCommitResult, AIShadowDiagnosticCode } from '@open-pencil/core/ai-draft'

import type { EditorStore } from '@/app/editor/session'

import type { CodePenAIDraftRecord, CodePenAISealedDraftSummary } from './contracts'

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/
const SAFE_DIGEST = /^[A-Za-z0-9_-]{43}$/

let handleIdentitySequence = 0
const handleIdentities = new WeakMap<FileSystemFileHandle, number>()

function handleIdentity(handle: FileSystemFileHandle | null): number | null {
  if (!handle) return null
  let identity = handleIdentities.get(handle)
  if (!identity) {
    identity = ++handleIdentitySequence
    handleIdentities.set(handle, identity)
  }
  return identity
}

export function codePenDocumentIdentity(store: EditorStore): string {
  const storage = store.getStorageBinding()
  if (storage) {
    return JSON.stringify([
      'storage',
      storage.providerId,
      storage.profileId,
      storage.authority?.accountId ?? null,
      storage.authority?.authorizationVersion ?? null,
      storage.documentId
    ])
  }
  const source = store.getSourceIdentity()
  return JSON.stringify(['file', source.path, handleIdentity(source.handle)])
}

export function throwIfCodePenOperationAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('CodePen AI operation cancelled')
  error.name = 'AbortError'
  throw error
}

export function validateCodePenDigest(value: string, path = 'evidenceDigest'): string {
  if (typeof value !== 'string' || !SAFE_DIGEST.test(value)) {
    throw new TypeError(`${path} must be a SHA-256 base64url digest`)
  }
  return value
}

export function validateCodePenID(value: string, path: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new TypeError(`${path} is invalid`)
  return value
}

export function finiteCodePenCoordinate(
  value: number | undefined,
  path: string
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    throw new TypeError(`${path} must be finite and within the canvas bound`)
  }
  return value
}

export function createCodePenDraftID(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `cp_${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

export function codePenSealedSummary(record: CodePenAIDraftRecord): CodePenAISealedDraftSummary {
  const draft = record.sealed
  if (!draft || record.state !== 'sealed') throw new Error('Shadow draft is not sealed')
  return Object.freeze({
    draftId: record.draftId,
    evidenceDigest: record.evidenceDigest,
    draftDigest: draft.draftDigest,
    nodeCount: draft.nodeCount,
    imageBytes: draft.imageBytes,
    expectedRevision: draft.expectedRevision,
    pageId: draft.pageId
  })
}

export function codePenCommitFailure(
  store: EditorStore,
  code: AIShadowDiagnosticCode,
  message: string
): AIShadowCommitResult {
  return Object.freeze({
    ok: false,
    revision: store.state.sceneVersion,
    diagnostics: Object.freeze([Object.freeze({ code, message, severity: 'error' as const })])
  })
}
