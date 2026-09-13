import SYSTEM_PROMPT from '@/app/ai/chat/system-prompt.md?raw'
import BUILTIN_PLUGIN_AI_INSTRUCTIONS from '@/app/ai/tools/builtin/instructions.md?raw'
import PERSONAL_NOTES_AI_INSTRUCTIONS from '@/app/ai/tools/personal-notes.md?raw'
import SINGLE_SKU_SHOP_AI_INSTRUCTIONS from '@/app/ai/tools/single-sku-shop.md?raw'

export type AIChatPromptMode = 'direct' | 'delegated'

/**
 * Direct owns OpenPencil's local ToolSet, while delegated ACP/Harness agents own their own tools.
 * Keep local built-in-plugin instructions out of transports that cannot call the facade.
 */
export function designSystemPromptFor(mode: AIChatPromptMode): string {
  return mode === 'direct'
    ? [
        SYSTEM_PROMPT,
        BUILTIN_PLUGIN_AI_INSTRUCTIONS,
        PERSONAL_NOTES_AI_INSTRUCTIONS,
        SINGLE_SKU_SHOP_AI_INSTRUCTIONS
      ].join('\n\n')
    : SYSTEM_PROMPT
}
