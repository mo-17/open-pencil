import { isFileUIPart } from 'ai'
import type { FileUIPart, UIDataTypes, UIMessage, UIMessagePart, UITools } from 'ai'

type ChatPart = UIMessagePart<UIDataTypes, UITools>

const MAX_CHAT_SOURCES = 12
const MAX_URL_LENGTH = 4096
const MAX_LABEL_LENGTH = 240
const MAX_MEDIA_TYPE_LENGTH = 128
const MAX_ARCHIVE_OMITTED_COUNT = 10_000
const ASSISTANT_FILE_ARCHIVE_SCHEMA = 'openpencil.assistant-file-archive.v1'
const ASSISTANT_FILE_ARCHIVE_KEY = 'assistantFileArchive'

export const MAX_ASSISTANT_FILES = 8
export const MAX_ASSISTANT_INLINE_DATA_URL_CHARS = 256 * 1024
export const MAX_INLINE_IMAGE_DATA_URL_LENGTH = MAX_ASSISTANT_INLINE_DATA_URL_CHARS
const SAFE_INLINE_IMAGE_MEDIA_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
])

export interface ChatURLSource {
  kind: 'url'
  key: string
  sourceId: string
  title: string
  url: string
  hostname: string
  secure: boolean
}

export interface ChatDocumentSource {
  kind: 'document'
  key: string
  sourceId: string
  title: string
  filename: string | null
  mediaType: string
}

export type ChatSource = ChatURLSource | ChatDocumentSource

export interface ChatPresentationLabels {
  document: string
  generatedImage: string
  file: string
}

export interface AssistantFilePresentation {
  key: string
  name: string
  mediaType: string
  previewUrl: string | null
  openUrl: string | null
  blocked: boolean
}

export type AssistantFileArchiveReason = 'unsafe' | 'inline-budget' | 'count-limit'

export interface AssistantFileArchiveEntry {
  filename: string | null
  mediaType: string
  reason: AssistantFileArchiveReason
  omittedCount?: number
}

export interface AssistantFileArchive {
  schema: typeof ASSISTANT_FILE_ARCHIVE_SCHEMA
  files: AssistantFileArchiveEntry[]
}

interface RankedSource {
  source: ChatSource
  index: number
  rank: number
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, MAX_LABEL_LENGTH) : null
}

function cleanMediaType(value: unknown): string {
  if (typeof value !== 'string') return 'application/octet-stream'
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase()
  if (
    !mediaType ||
    mediaType.length > MAX_MEDIA_TYPE_LENGTH ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType)
  ) {
    return 'application/octet-stream'
  }
  return mediaType
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key))
}

function parseArchiveEntry(value: unknown): AssistantFileArchiveEntry | null {
  if (!isRecord(value)) return null
  const reason = value.reason
  if (reason !== 'unsafe' && reason !== 'inline-budget' && reason !== 'count-limit') return null
  const allowedKeys =
    reason === 'count-limit'
      ? ['filename', 'mediaType', 'reason', 'omittedCount']
      : ['filename', 'mediaType', 'reason']
  if (!hasOnlyKeys(value, allowedKeys)) return null

  const filename = value.filename
  if (filename !== null && (typeof filename !== 'string' || cleanLabel(filename) !== filename)) {
    return null
  }
  if (typeof value.mediaType !== 'string' || cleanMediaType(value.mediaType) !== value.mediaType) {
    return null
  }
  if (reason === 'count-limit') {
    if (
      !Number.isInteger(value.omittedCount) ||
      (value.omittedCount as number) < 1 ||
      (value.omittedCount as number) > MAX_ARCHIVE_OMITTED_COUNT
    ) {
      return null
    }
    return {
      filename,
      mediaType: value.mediaType,
      reason,
      omittedCount: value.omittedCount as number
    }
  }
  return { filename, mediaType: value.mediaType, reason }
}

export function parseAssistantFileArchive(metadata: unknown): AssistantFileArchive | null {
  if (!isRecord(metadata)) return null
  const value = metadata[ASSISTANT_FILE_ARCHIVE_KEY]
  if (!isRecord(value) || !hasOnlyKeys(value, ['schema', 'files'])) return null
  if (value.schema !== ASSISTANT_FILE_ARCHIVE_SCHEMA || !Array.isArray(value.files)) return null
  if (value.files.length === 0 || value.files.length > MAX_ASSISTANT_FILES) return null
  const files = value.files.map(parseArchiveEntry)
  if (files.some((entry) => entry === null)) return null
  return { schema: ASSISTANT_FILE_ARCHIVE_SCHEMA, files: files as AssistantFileArchiveEntry[] }
}

/**
 * Accepts only absolute HTTP(S) URLs that are safe to hand to an external-link opener.
 * Credentials are rejected so a provider cannot disguise an untrusted host behind user-info.
 */
export function safeExternalHttpURL(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!candidate || candidate.length > MAX_URL_LENGTH) return null

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    if (!parsed.hostname || parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}

function safeInlineImageDataURL(value: unknown, mediaType: string): string | null {
  if (typeof value !== 'string' || !SAFE_INLINE_IMAGE_MEDIA_TYPES.has(mediaType)) return null
  if (value.length > MAX_INLINE_IMAGE_DATA_URL_LENGTH) return null

  const header = /^data:([^;,]+);base64,/i.exec(value)
  if (!header || cleanMediaType(header[1]) !== mediaType) return null

  const payload = value.slice(header[0].length)
  if (!payload || /[^A-Za-z0-9+/=\s]/.test(payload)) return null
  return value
}

type AssistantFileCandidate =
  | { kind: 'part'; part: FileUIPart; partIndex: number }
  | { kind: 'archive'; entry: AssistantFileArchiveEntry }

interface AssistantFilePlan {
  retainedParts: Array<{ part: FileUIPart; partIndex: number }>
  archiveEntries: AssistantFileArchiveEntry[]
}

function archiveIdentity(
  candidate: AssistantFileCandidate
): Pick<AssistantFileArchiveEntry, 'filename' | 'mediaType'> {
  if (candidate.kind === 'archive') return candidate.entry
  return {
    filename: cleanLabel(candidate.part.filename),
    mediaType: cleanMediaType(candidate.part.mediaType)
  }
}

function logicalCandidateCount(candidate: AssistantFileCandidate): number {
  return candidate.kind === 'archive' && candidate.entry.reason === 'count-limit'
    ? (candidate.entry.omittedCount ?? 1)
    : 1
}

function boundedCountArchive(
  omitted: readonly AssistantFileCandidate[]
): AssistantFileArchiveEntry {
  const identity = archiveIdentity(omitted[0])
  const omittedCount = Math.min(
    MAX_ARCHIVE_OMITTED_COUNT,
    omitted.reduce((total, candidate) => total + logicalCandidateCount(candidate), 0)
  )
  return { ...identity, reason: 'count-limit', omittedCount }
}

function sanitizedFilePart(part: FileUIPart, mediaType: string, url: string): FileUIPart {
  const filename = cleanLabel(part.filename)
  return {
    type: 'file',
    mediaType,
    ...(filename ? { filename } : {}),
    url
  }
}

function planAssistantFiles(parts: readonly ChatPart[], metadata: unknown): AssistantFilePlan {
  const candidates: AssistantFileCandidate[] = []
  for (const [partIndex, part] of parts.entries()) {
    if (isFileUIPart(part)) candidates.push({ kind: 'part', part, partIndex })
  }
  const existingArchive = parseAssistantFileArchive(metadata)
  for (const entry of existingArchive?.files ?? []) {
    candidates.push({ kind: 'archive', entry })
  }

  let plannedCandidates = candidates
  let countArchive: AssistantFileArchiveEntry | null = null
  if (candidates.length > MAX_ASSISTANT_FILES) {
    plannedCandidates = candidates.slice(0, MAX_ASSISTANT_FILES - 1)
    countArchive = boundedCountArchive(candidates.slice(MAX_ASSISTANT_FILES - 1))
  }

  const retainedParts: AssistantFilePlan['retainedParts'] = []
  const archiveEntries: AssistantFileArchiveEntry[] = []
  let inlineDataURLChars = 0
  for (const candidate of plannedCandidates) {
    if (candidate.kind === 'archive') {
      archiveEntries.push(candidate.entry)
      continue
    }

    const mediaType = cleanMediaType(candidate.part.mediaType)
    const filename = cleanLabel(candidate.part.filename)
    const httpURL = safeExternalHttpURL(candidate.part.url)
    if (httpURL) {
      retainedParts.push({
        partIndex: candidate.partIndex,
        part: sanitizedFilePart(candidate.part, mediaType, httpURL)
      })
      continue
    }

    const inlineURL = safeInlineImageDataURL(candidate.part.url, mediaType)
    if (inlineURL && inlineDataURLChars + inlineURL.length <= MAX_ASSISTANT_INLINE_DATA_URL_CHARS) {
      inlineDataURLChars += inlineURL.length
      retainedParts.push({
        partIndex: candidate.partIndex,
        part: sanitizedFilePart(candidate.part, mediaType, inlineURL)
      })
      continue
    }

    archiveEntries.push({
      filename,
      mediaType,
      reason: inlineURL ? 'inline-budget' : 'unsafe'
    })
  }
  if (countArchive) archiveEntries.push(countArchive)
  return { retainedParts, archiveEntries }
}

function archiveMetadata(
  metadata: unknown,
  entries: readonly AssistantFileArchiveEntry[]
): UIMessage['metadata'] {
  const next = isRecord(metadata) ? { ...metadata } : {}
  Reflect.deleteProperty(next, ASSISTANT_FILE_ARCHIVE_KEY)
  if (entries.length > 0) {
    next[ASSISTANT_FILE_ARCHIVE_KEY] = {
      schema: ASSISTANT_FILE_ARCHIVE_SCHEMA,
      files: entries.map((entry) => ({ ...entry }))
    } satisfies AssistantFileArchive
  }
  return Object.keys(next).length > 0 ? next : undefined
}

/**
 * Remove unsafe or over-budget assistant file payloads before retaining model history.
 * A tiny schema-checked archive preserves only enough metadata to render a blocked card.
 */
export function archiveAssistantFileMessage(message: UIMessage): UIMessage {
  if (message.role !== 'assistant') return message
  const plan = planAssistantFiles(message.parts, message.metadata)
  const retained = new Map(plan.retainedParts.map(({ partIndex, part }) => [partIndex, part]))
  const parts: UIMessage['parts'] = []
  for (const [partIndex, part] of message.parts.entries()) {
    if (!isFileUIPart(part)) {
      parts.push(part)
      continue
    }
    const safePart = retained.get(partIndex)
    if (safePart) parts.push(safePart)
  }
  const metadata = archiveMetadata(message.metadata, plan.archiveEntries)
  const next: UIMessage = { ...message, parts }
  if (metadata) next.metadata = metadata
  else delete next.metadata
  return next
}

export function archiveAssistantFileMessages(messages: UIMessage[]): UIMessage[] {
  const archived = messages.map(archiveAssistantFileMessage)
  const changed = archived.some((message, index) => message !== messages[index])
  return changed ? archived : messages
}

function sourceId(part: { sourceId?: unknown }, index: number): string {
  return cleanLabel(part.sourceId) || `source-${index + 1}`
}

function urlSource(
  part: Extract<ChatPart, { type: 'source-url' }>,
  index: number
): RankedSource | null {
  const url = safeExternalHttpURL(part.url)
  if (!url) return null

  const parsed = new URL(url)
  const id = sourceId(part, index)
  const secure = parsed.protocol === 'https:'
  return {
    index,
    rank: secure ? 0 : 1,
    source: {
      kind: 'url',
      key: `url:${id}:${url}`,
      sourceId: id,
      title: cleanLabel(part.title) || parsed.hostname,
      url,
      hostname: parsed.hostname,
      secure
    }
  }
}

function documentSource(
  part: Extract<ChatPart, { type: 'source-document' }>,
  index: number,
  labels: ChatPresentationLabels
): RankedSource {
  const id = sourceId(part, index)
  const filename = cleanLabel(part.filename)
  const title = cleanLabel(part.title) || filename || cleanLabel(labels.document) || part.mediaType
  return {
    index,
    rank: 2,
    source: {
      kind: 'document',
      key: `document:${id}:${filename || title}`,
      sourceId: id,
      title,
      filename,
      mediaType: cleanMediaType(part.mediaType)
    }
  }
}

export function collectChatSources(
  parts: readonly ChatPart[],
  labels: ChatPresentationLabels,
  limit = MAX_CHAT_SOURCES
): ChatSource[] {
  if (!Number.isFinite(limit) || limit <= 0) return []

  const ranked: RankedSource[] = []
  const seen = new Set<string>()

  for (const [index, part] of parts.entries()) {
    let candidate: RankedSource | null = null
    if (part.type === 'source-url') candidate = urlSource(part, index)
    else if (part.type === 'source-document') candidate = documentSource(part, index, labels)
    if (!candidate || seen.has(candidate.source.key)) continue
    seen.add(candidate.source.key)
    ranked.push(candidate)
  }

  return ranked
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, Math.floor(limit))
    .map(({ source }) => source)
}

export function presentAssistantFile(
  part: FileUIPart,
  index: number,
  labels: ChatPresentationLabels
): AssistantFilePresentation {
  const mediaType = cleanMediaType(part.mediaType)
  const httpURL = safeExternalHttpURL(part.url)
  const inlineImageURL = safeInlineImageDataURL(part.url, mediaType)
  // Never auto-fetch provider-controlled remote images from the renderer. A
  // public-looking URL can redirect or DNS-rebind to a private host and also
  // acts as a tracking pixel. Hosted files remain explicit external links.
  const previewURL = SAFE_INLINE_IMAGE_MEDIA_TYPES.has(mediaType) ? inlineImageURL : null
  const openUrl = httpURL
  const image = mediaType.startsWith('image/')
  const fallbackName = image ? labels.generatedImage : labels.file

  return {
    key: `assistant-file:${index}:${cleanLabel(part.filename) || mediaType}`,
    name: cleanLabel(part.filename) || `${cleanLabel(fallbackName) || mediaType} ${index + 1}`,
    mediaType,
    previewUrl: previewURL,
    openUrl,
    blocked: !previewURL && !openUrl
  }
}

function presentArchivedAssistantFile(
  entry: AssistantFileArchiveEntry,
  index: number,
  labels: ChatPresentationLabels
): AssistantFilePresentation {
  const image = entry.mediaType.startsWith('image/')
  const fallbackName = image ? labels.generatedImage : labels.file
  const baseName = entry.filename || `${cleanLabel(fallbackName) || entry.mediaType} ${index + 1}`
  const omittedSuffix =
    entry.reason === 'count-limit' && (entry.omittedCount ?? 1) > 1
      ? ` (+${(entry.omittedCount ?? 1) - 1})`
      : ''
  return {
    key: `assistant-file-archive:${index}:${entry.reason}:${baseName}`,
    name: `${baseName}${omittedSuffix}`,
    mediaType: entry.mediaType,
    previewUrl: null,
    openUrl: null,
    blocked: true
  }
}

/** Apply the same count, URL, and aggregate-inline budgets used by history archival. */
export function collectAssistantFiles(
  parts: readonly ChatPart[],
  metadata: unknown,
  labels: ChatPresentationLabels
): AssistantFilePresentation[] {
  const plan = planAssistantFiles(parts, metadata)
  const retained = plan.retainedParts.map(({ part, partIndex }) =>
    presentAssistantFile(part, partIndex, labels)
  )
  const archived = plan.archiveEntries.map((entry, index) =>
    presentArchivedAssistantFile(entry, retained.length + index, labels)
  )
  return [...retained, ...archived].slice(0, MAX_ASSISTANT_FILES)
}
