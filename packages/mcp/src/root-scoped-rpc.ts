import type { SafePathResult } from '#mcp/tool/output'
import { resolveSafePath } from '#mcp/tool/output'

export interface RPCSendOptions {
  signal?: AbortSignal
  onProgress?: (progress: unknown) => void
}

export type RootScopedRPCSender = (
  body: Record<string, unknown>,
  options?: RPCSendOptions
) => Promise<unknown>

interface AutomationDocumentPath {
  id?: unknown
  active?: unknown
  path?: unknown
}

interface RPCResponse {
  ok?: boolean
  result?: unknown
  error?: string
}

export interface PreparedRootScopedRPCRequest {
  body: Record<string, unknown>
  safePath?: SafePathResult
}

export interface RootScopedRPCPolicyOptions {
  /** Carry the selected existing path across an outer forwarding hop for revalidation. */
  markPathlessSaveForRevalidation?: boolean
}

const EXPECTED_EXISTING_PATH = '__openpencil_expected_existing_path'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestArgs(body: Record<string, unknown>): Record<string, unknown> {
  const args = body.args
  if (args === undefined) return {}
  if (!isRecord(args)) {
    throw new TypeError(`${String(body.command)} args must be an object`)
  }
  return args
}

function explicitPath(args: Record<string, unknown>): string | undefined {
  const path = args.path
  if (path === undefined) return undefined
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('File-scoped RPC path must be a non-empty string')
  }
  return path
}

function pathlessSaveTarget(
  response: unknown,
  requestedDocumentId: unknown
): { documentId: string; path: string } {
  if (
    requestedDocumentId !== undefined &&
    (typeof requestedDocumentId !== 'string' || requestedDocumentId.length === 0)
  ) {
    throw new TypeError('save_file document_id must be a non-empty string')
  }

  const rpc = response as RPCResponse
  if (rpc.ok === false) throw new Error(rpc.error ?? 'OpenPencil RPC failed')
  const result = rpc.result
  const documents =
    result && typeof result === 'object' && !Array.isArray(result) && 'documents' in result
      ? (result as { documents?: unknown }).documents
      : undefined
  if (!Array.isArray(documents)) {
    throw new TypeError('OpenPencil did not return a document list for pathless save_file')
  }

  const document = documents.find((candidate): candidate is AutomationDocumentPath => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
    const summary = candidate as AutomationDocumentPath
    return typeof requestedDocumentId === 'string'
      ? summary.id === requestedDocumentId
      : summary.active === true
  })
  if (!document) {
    throw new Error(
      typeof requestedDocumentId === 'string'
        ? `Document "${requestedDocumentId}" not found for pathless save_file`
        : 'No active OpenPencil document found for pathless save_file'
    )
  }
  if (typeof document.id !== 'string' || document.id.length === 0) {
    throw new Error('OpenPencil returned an invalid document ID for pathless save_file')
  }
  if (typeof document.path !== 'string' || document.path.length === 0) {
    throw new Error(
      'Pathless save_file requires the selected document to have an existing local file path when OPENPENCIL_MCP_ROOT is configured'
    )
  }
  return { documentId: document.id, path: document.path }
}

function hasReservedControlField(rawArgs: unknown): boolean {
  return isRecord(rawArgs) && Object.hasOwn(rawArgs, EXPECTED_EXISTING_PATH)
}

async function prepareExplicitPathRequest(
  body: Record<string, unknown>,
  args: Record<string, unknown>,
  command: unknown,
  requestedPath: string,
  resolvedRoot: string,
  sendRPC: RootScopedRPCSender,
  options: RPCSendOptions
): Promise<PreparedRootScopedRPCRequest> {
  const safePath = await resolveSafePath(requestedPath, resolvedRoot)
  if (command !== 'save_file' || args[EXPECTED_EXISTING_PATH] === undefined) {
    return { body: { ...body, args: { ...args, path: safePath.realPath } }, safePath }
  }

  const expectedExistingPath = args[EXPECTED_EXISTING_PATH]
  if (typeof expectedExistingPath !== 'string' || expectedExistingPath.length === 0) {
    throw new TypeError('save_file expected existing path must be a non-empty string')
  }
  const response = await sendRPC(
    { command: 'list_documents', args: {} },
    { signal: options.signal }
  )
  const selected = pathlessSaveTarget(response, args.document_id)
  const currentPath = await resolveSafePath(selected.path, resolvedRoot)
  if (safePath.realPath !== expectedExistingPath || currentPath.realPath !== expectedExistingPath) {
    throw new Error('Selected document path changed before pathless save_file was forwarded')
  }
  const { [EXPECTED_EXISTING_PATH]: _expectedExistingPath, ...forwardArgs } = args
  return {
    body: {
      ...body,
      args: {
        ...forwardArgs,
        document_id: selected.documentId,
        path: safePath.realPath
      }
    },
    safePath
  }
}

/**
 * Apply OPENPENCIL_MCP_ROOT immediately before an automation RPC is forwarded
 * to the desktop app. The app receives a canonical path, but this boundary
 * cannot atomically prevent filesystem changes after the cross-process handoff.
 */
export async function prepareRootScopedRPCRequest(
  body: Record<string, unknown>,
  resolvedRoot: string | null,
  sendRPC: RootScopedRPCSender,
  options: RPCSendOptions = {},
  policy: RootScopedRPCPolicyOptions = {}
): Promise<PreparedRootScopedRPCRequest> {
  const command = body.command
  const rawArgs = body.args
  const includesReservedControlField = hasReservedControlField(rawArgs)
  if (includesReservedControlField && (!resolvedRoot || command !== 'save_file')) {
    throw new TypeError('Internal pathless save_file control field is not accepted here')
  }
  if (!resolvedRoot) {
    return { body }
  }
  if (command !== 'save_file' && command !== 'open_file' && command !== 'new_document') {
    return { body }
  }

  const args = requestArgs(body)
  const requestedPath = explicitPath(args)
  if (includesReservedControlField && requestedPath === undefined) {
    throw new TypeError('Internal pathless save_file control field is not accepted here')
  }
  if (requestedPath !== undefined) {
    return prepareExplicitPathRequest(
      body,
      args,
      command,
      requestedPath,
      resolvedRoot,
      sendRPC,
      options
    )
  }

  if (command === 'open_file') {
    throw new Error('open_file requires a path when OPENPENCIL_MCP_ROOT is configured')
  }
  if (command === 'new_document') return { body: { ...body, args } }

  const response = await sendRPC(
    { command: 'list_documents', args: {} },
    { signal: options.signal }
  )
  const selected = pathlessSaveTarget(response, args.document_id)
  const safePath = await resolveSafePath(selected.path, resolvedRoot)
  return {
    body: {
      ...body,
      args: {
        ...args,
        document_id: selected.documentId,
        path: safePath.realPath,
        ...(policy.markPathlessSaveForRevalidation
          ? { [EXPECTED_EXISTING_PATH]: safePath.realPath }
          : {})
      }
    },
    safePath
  }
}
