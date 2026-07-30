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

function finalizeUnfinishedToolPart(part: ToolPart, errorText: string): ToolPart {
  if (part.state === 'approval-responded' && !part.approval.approved) {
    return {
      ...part,
      state: 'output-denied'
    } as ToolPart
  }
  return failToolPart(part, errorText)
}

function isUnfinishedToolPart(part: UIMessagePart<UIDataTypes, UITools>): part is ToolPart & {
  state: 'input-streaming' | 'input-available' | 'approval-responded'
} {
  return (
    isToolUIPart(part) &&
    (part.state === 'input-streaming' ||
      part.state === 'input-available' ||
      part.state === 'approval-responded')
  )
}

/**
 * Stops unfinished tool cards from spinning after their chat stream was cancelled.
 * Pending approvals keep waiting for the user. Responded approvals are closed with
 * a protocol result when their continuation does not finish.
 */
export function finalizeUnfinishedToolParts(messages: UIMessage[], errorText: string): UIMessage[] {
  if (!messages.some((message) => message.parts.some(isUnfinishedToolPart))) return messages
  return messages.map((message) => {
    if (message.role !== 'assistant' || !message.parts.some(isUnfinishedToolPart)) return message
    return {
      ...message,
      parts: message.parts.map((part) =>
        isUnfinishedToolPart(part) ? finalizeUnfinishedToolPart(part, errorText) : part
      )
    }
  })
}

export function finalizeInterruptedToolParts(messages: UIMessage[]): UIMessage[] {
  return finalizeUnfinishedToolParts(messages, INTERRUPTED_TOOL_ERROR)
}
