import {
  convertToModelMessages,
  generateText,
  isFileUIPart,
  type ChatTransport,
  type FileUIPart,
  type UIMessage,
  type UIMessageChunk
} from 'ai'

import {
  formatVisualReferenceSourceContext,
  stripVisualAttachmentMetadata
} from '@/app/ai/chat/attachments'
import VISUAL_ANALYSIS_PROMPT from '@/app/ai/chat/visual-analysis-prompt.md?raw'
import { createAIModelRuntime } from '@/app/ai/models'

const ARCHIVED_VISUAL_REFERENCE =
  '[A visual reference was attached to this earlier request and was omitted from later model calls.]'
const MAX_PERSISTED_VISUAL_ANALYSIS_CHARS = 16_000
const UNTRUSTED_VISUAL_ANALYSIS_BEGIN = '[BEGIN_UNTRUSTED_VISUAL_REFERENCE_ANALYSIS]'
const UNTRUSTED_VISUAL_ANALYSIS_END = '[END_UNTRUSTED_VISUAL_REFERENCE_ANALYSIS]'
const VISUAL_ANALYSIS_SCHEMA = 'openpencil.visual-reference-analysis.v1'

type VisualMessageAnalyzer = (message: UIMessage, abortSignal: AbortSignal) => Promise<string>

type VisualReferenceTransportOptions = {
  transport: ChatTransport<UIMessage>
  designSupportsVision: boolean
  analyze?: VisualMessageAnalyzer
}

type VisualMessageMetadata = {
  visualAttachments?: unknown
  visualAnalysis?: unknown
  [key: string]: unknown
}

function fileParts(message: UIMessage): FileUIPart[] {
  return message.parts.filter(isFileUIPart)
}

function isVisualMessageMetadata(metadata: unknown): metadata is VisualMessageMetadata {
  return Boolean(metadata) && typeof metadata === 'object' && !Array.isArray(metadata)
}

function persistedVisualAnalysis(message: UIMessage): string | null {
  const metadata = isVisualMessageMetadata(message.metadata) ? message.metadata : null
  const analysis = metadata?.visualAnalysis
  return typeof analysis === 'string' && analysis.trim() ? analysis.trim() : null
}

function persistVisualAnalysis(message: UIMessage, analysis: string): string {
  const bounded = analysis.trim().slice(0, MAX_PERSISTED_VISUAL_ANALYSIS_CHARS)
  const metadata = isVisualMessageMetadata(message.metadata) ? message.metadata : {}
  message.metadata = { ...metadata, visualAnalysis: bounded }
  return bounded
}

function formatUntrustedVisualAnalysis(analysis: string): string {
  const payload = JSON.stringify({
    schema: VISUAL_ANALYSIS_SCHEMA,
    trust: 'untrusted',
    content: analysis.trim()
  })
  return `${UNTRUSTED_VISUAL_ANALYSIS_BEGIN}\n${payload}\n${UNTRUSTED_VISUAL_ANALYSIS_END}`
}

function withoutFiles(message: UIMessage): UIMessage {
  const sourceContext = formatVisualReferenceSourceContext(message)
  const sanitized = stripVisualAttachmentMetadata(message)
  if (!fileParts(message).length && !sourceContext) return sanitized
  const parts = sanitized.parts.filter((part) => !isFileUIPart(part))
  const analysis = persistedVisualAnalysis(message)
  return {
    ...sanitized,
    parts: [
      ...parts,
      ...(sourceContext ? [{ type: 'text' as const, text: sourceContext }] : []),
      {
        type: 'text' as const,
        text: analysis ? formatUntrustedVisualAnalysis(analysis) : ARCHIVED_VISUAL_REFERENCE
      }
    ]
  }
}

function withVisualAnalysis(
  message: UIMessage,
  analysis: string,
  sourceContext: string | null
): UIMessage {
  const parts = message.parts.filter((part) => !isFileUIPart(part))
  return {
    ...message,
    parts: [
      ...parts,
      ...(sourceContext ? [{ type: 'text' as const, text: sourceContext }] : []),
      {
        type: 'text' as const,
        text: formatUntrustedVisualAnalysis(analysis)
      }
    ]
  }
}

function withCurrentVisualFiles(message: UIMessage, sourceContext: string | null): UIMessage {
  const sanitized = stripVisualAttachmentMetadata(message)
  if (!sourceContext) return sanitized
  return {
    ...sanitized,
    parts: [...sanitized.parts, { type: 'text' as const, text: sourceContext }]
  }
}

/**
 * Keep image bytes in the model context only for the newly submitted user turn.
 * Older UI messages retain their thumbnails, while the transport sends a copy
 * without their data URLs on subsequent requests.
 */
export async function prepareVisualReferenceMessages(
  messages: UIMessage[],
  options: {
    designSupportsVision: boolean
    abortSignal: AbortSignal
    analyze?: VisualMessageAnalyzer
  }
): Promise<UIMessage[]> {
  options.abortSignal.throwIfAborted()
  const latestIndex = messages.length - 1
  const latest = messages.at(-1)
  if (!latest) return messages
  const latestFiles = latest.role === 'user' ? fileParts(latest) : []
  const latestSourceContext =
    latest.role === 'user' ? formatVisualReferenceSourceContext(latest) : null

  const prepared = messages.map((message, index) =>
    index === latestIndex && latestFiles.length > 0
      ? withCurrentVisualFiles(message, latestSourceContext)
      : withoutFiles(message)
  )

  if (latestFiles.length === 0 || options.designSupportsVision) return prepared
  if (!options.analyze) {
    throw new Error(
      'The Design model cannot read images. Configure a Vision model in Settings, or choose a vision-capable Design model.'
    )
  }

  options.abortSignal.throwIfAborted()
  const analysis = await options.analyze(stripVisualAttachmentMetadata(latest), options.abortSignal)
  options.abortSignal.throwIfAborted()
  if (!analysis.trim()) throw new Error('The Vision model returned an empty visual analysis.')
  const persisted = persistVisualAnalysis(latest, analysis)
  prepared[latestIndex] = withVisualAnalysis(
    stripVisualAttachmentMetadata(latest),
    persisted,
    latestSourceContext
  )
  return prepared
}

export function createVisionRoleAnalyzer(): VisualMessageAnalyzer {
  return async (message, abortSignal) => {
    const runtime = await createAIModelRuntime('vision')
    if (!runtime) {
      throw new Error(
        'The Design model cannot read images and no Vision model is configured. Open Settings and assign a vision-capable model.'
      )
    }
    if (runtime.kind !== 'direct') {
      throw new Error('The configured Vision model must use direct API access.')
    }

    const result = await generateText({
      model: runtime.model,
      system: VISUAL_ANALYSIS_PROMPT,
      messages: await convertToModelMessages([message]),
      maxOutputTokens: Math.min(runtime.role.profile.maxOutputTokens, 4_096),
      abortSignal
    })
    return result.text
  }
}

export class VisualReferenceChatTransport implements ChatTransport<UIMessage> {
  private readonly transport: ChatTransport<UIMessage>
  private readonly designSupportsVision: boolean
  private readonly analyze?: VisualMessageAnalyzer

  constructor(options: VisualReferenceTransportOptions) {
    this.transport = options.transport
    this.designSupportsVision = options.designSupportsVision
    this.analyze = options.analyze
  }

  async sendMessages(
    request: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]
  ): Promise<ReadableStream<UIMessageChunk>> {
    const abortSignal = request.abortSignal ?? new AbortController().signal
    const messages = await prepareVisualReferenceMessages(request.messages, {
      designSupportsVision: this.designSupportsVision,
      abortSignal,
      analyze: this.analyze
    })
    abortSignal.throwIfAborted()
    return this.transport.sendMessages({ ...request, messages })
  }

  reconnectToStream(
    request: Parameters<ChatTransport<UIMessage>['reconnectToStream']>[0]
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    return this.transport.reconnectToStream(request)
  }
}
