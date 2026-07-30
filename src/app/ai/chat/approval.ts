import { isToolUIPart } from 'ai'
import type { UIDataTypes, UIMessage, UIMessagePart, UITools } from 'ai'

type ToolPart = Extract<UIMessagePart<UIDataTypes, UITools>, { toolCallId: string }>

const SUPERSEDED_APPROVAL_REASON = 'Superseded by a new message.'

export type ToolApprovalContext<T> = {
  chat: T
  generation: number
  sessionRevision: number
  tabId: string | null
  providerID: string
}

export function isCurrentToolApprovalContext<T>(
  context: ToolApprovalContext<T> | null,
  chat: T | null,
  generation: number,
  sessionRevision: number,
  tabId: string | null,
  providerID: string
): context is ToolApprovalContext<T> {
  return Boolean(
    context &&
    chat &&
    context.chat === chat &&
    context.generation === generation &&
    context.sessionRevision === sessionRevision &&
    context.tabId === tabId &&
    context.providerID === providerID
  )
}

export function hasPendingToolApproval(
  messages: readonly UIMessage[],
  messageId: string,
  approvalId: string
): boolean {
  const message = messages.at(-1)
  if (message?.role !== 'assistant' || message.id !== messageId) return false
  return message.parts.some((part) => {
    return (
      isToolUIPart(part) && part.state === 'approval-requested' && part.approval.id === approvalId
    )
  })
}

function isPendingToolApproval(part: UIMessagePart<UIDataTypes, UITools>): part is ToolPart & {
  state: 'approval-requested'
} {
  return isToolUIPart(part) && part.state === 'approval-requested'
}

/** Close approvals that the user superseded by starting a new conversation turn. */
export function finalizePendingToolApprovals(messages: UIMessage[]): UIMessage[] {
  if (!messages.some((message) => message.parts.some(isPendingToolApproval))) return messages
  return messages.map((message) => {
    if (message.role !== 'assistant' || !message.parts.some(isPendingToolApproval)) return message
    return {
      ...message,
      parts: message.parts.map((part) =>
        isPendingToolApproval(part)
          ? ({
              ...part,
              state: 'output-denied',
              approval: {
                ...part.approval,
                approved: false,
                reason: SUPERSEDED_APPROVAL_REASON
              }
            } as ToolPart)
          : part
      )
    }
  })
}
