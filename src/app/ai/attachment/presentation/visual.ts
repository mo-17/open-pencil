import type { VisualChatAttachment } from '@/app/ai/chat/attachments'

import type { ImagePresentation } from './types'

/** Uses only bounded, host-normalized thumbnails; it never fetches a remote attachment. */
export function visualAttachmentPresentation(
  messageId: string,
  attachment: VisualChatAttachment
): ImagePresentation {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
    attachment.thumbnail.url
  )
  if (!match || match[2].length > 131_072) throw new Error('Attachment preview is invalid')
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0))
  return {
    id: attachment.id,
    messageId,
    kind: 'image',
    name: attachment.name,
    mediaType: attachment.mediaType,
    originalSize: { x: attachment.sourceWidth, y: attachment.sourceHeight },
    preview: new Blob([bytes], { type: match[1] })
  }
}
