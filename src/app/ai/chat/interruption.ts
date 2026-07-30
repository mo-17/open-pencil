import { isToolUIPart } from 'ai'
import type { UIDataTypes, UIMessage, UIMessagePart, UITools } from 'ai'

export const INTERRUPTED_TOOL_ERROR = 'Conversation interrupted'

type ToolPart = Extract<UIMessagePart<UIDataTypes, UITools>, { toolCallId: string }>

function failToolPart(part: ToolPart, errorText: string): ToolPart {
  return {
    ...part,
    state: 'output-error',
    errorText
  } as ToolPart
}

function isUnfinishedToolPart(
  part: UIMessagePart<UIDataTypes, UITools>
): part is ToolPart & { state: 'input-streaming' | 'input-available' } {
  return (
    isToolUIPart(part) && (part.state === 'input-streaming' || part.state === 'input-available')
  )
}

/**
 * Stops unfinished tool cards from spinning after their chat stream was cancelled.
 * Completed, failed, denied, and approval-state calls keep their protocol result.
 */
export function finalizeUnfinishedToolParts(messages: UIMessage[], errorText: string): UIMessage[] {
  if (!messages.some((message) => message.parts.some(isUnfinishedToolPart))) return messages
  return messages.map((message) => {
    if (message.role !== 'assistant' || !message.parts.some(isUnfinishedToolPart)) return message
    return {
      ...message,
      parts: message.parts.map((part) =>
        isUnfinishedToolPart(part) ? failToolPart(part, errorText) : part
      )
    }
  })
}

export function finalizeInterruptedToolParts(messages: UIMessage[]): UIMessage[] {
  return finalizeUnfinishedToolParts(messages, INTERRUPTED_TOOL_ERROR)
}
