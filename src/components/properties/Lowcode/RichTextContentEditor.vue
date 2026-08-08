<script setup lang="ts">
import { ref } from 'vue'

import {
  RICH_TEXT_MODULE_LIMITS,
  type RichTextAlignmentV1,
  type RichTextBlockV1,
  type RichTextDocumentV1,
  type RichTextInlineV1
} from '@open-pencil/core/plugins'
import { useI18n } from '@open-pencil/vue'

import RichTextInlineEditor from './RichTextInlineEditor.vue'
import {
  RICH_TEXT_EDITOR_BLOCK_KINDS,
  convertRichTextBlock,
  createRichTextBlock,
  richTextEditorBlockKind,
  type RichTextEditorBlockKind
} from '@/app/plugins/rich-text-editor-model'

const { modelValue } = defineProps<{ modelValue: RichTextDocumentV1 }>()
const emit = defineEmits<{ commit: [value: RichTextDocumentV1] }>()
const { panels } = useI18n()
const nextBlockKind = ref<RichTextEditorBlockKind>('paragraph')

const blockTypeLabels: Record<RichTextEditorBlockKind, () => string> = {
  paragraph: () => panels.value.lowcodeRichTextParagraph,
  'heading-1': () => panels.value.lowcodeRichTextHeading1,
  'heading-2': () => panels.value.lowcodeRichTextHeading2,
  'heading-3': () => panels.value.lowcodeRichTextHeading3,
  blockquote: () => panels.value.lowcodeRichTextBlockquote,
  codeBlock: () => panels.value.lowcodeRichTextCodeBlock,
  bulletList: () => panels.value.lowcodeRichTextBulletList,
  orderedList: () => panels.value.lowcodeRichTextOrderedList
}

function commitBlocks(blocks: RichTextBlockV1[]): void {
  emit('commit', { type: 'doc', blocks })
}

function replaceBlock(index: number, block: RichTextBlockV1): void {
  commitBlocks(
    modelValue.blocks.map((candidate, candidateIndex) =>
      candidateIndex === index ? block : structuredClone(candidate)
    )
  )
}

function changeBlockType(index: number, kind: RichTextEditorBlockKind): void {
  replaceBlock(index, convertRichTextBlock(modelValue.blocks[index], kind))
}

function moveBlock(index: number, offset: -1 | 1): void {
  const destination = index + offset
  if (destination < 0 || destination >= modelValue.blocks.length) return
  const blocks = structuredClone(modelValue.blocks)
  const [block] = blocks.splice(index, 1)
  blocks.splice(destination, 0, block)
  commitBlocks(blocks)
}

function deleteBlock(index: number): void {
  commitBlocks(
    modelValue.blocks
      .filter((_, candidateIndex) => candidateIndex !== index)
      .map((block) => structuredClone(block))
  )
}

function addBlock(): void {
  if (modelValue.blocks.length >= RICH_TEXT_MODULE_LIMITS.blocks) return
  commitBlocks([...structuredClone(modelValue.blocks), createRichTextBlock(nextBlockKind.value)])
}

function replaceBlockChildren(index: number, children: RichTextInlineV1[]): void {
  const block = modelValue.blocks[index]
  if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'blockquote') {
    replaceBlock(index, { ...structuredClone(block), children })
  }
}

function setAlignment(index: number, align: RichTextAlignmentV1): void {
  const block = modelValue.blocks[index]
  if (block.type !== 'paragraph' && block.type !== 'heading') return
  replaceBlock(index, { ...structuredClone(block), align })
}

function updateCodeBlock(index: number, patch: { language?: string; text?: string }): void {
  const block = modelValue.blocks[index]
  if (block.type !== 'codeBlock') return
  replaceBlock(index, { ...structuredClone(block), ...patch })
}

function replaceListItem(index: number, itemIndex: number, children: RichTextInlineV1[]): void {
  const block = modelValue.blocks[index]
  if (block.type !== 'bulletList' && block.type !== 'orderedList') return
  const items = block.items.map((item, candidateIndex) =>
    candidateIndex === itemIndex ? { children } : structuredClone(item)
  )
  replaceBlock(index, { ...structuredClone(block), items })
}

function addListItem(index: number): void {
  const block = modelValue.blocks[index]
  if (
    (block.type !== 'bulletList' && block.type !== 'orderedList') ||
    block.items.length >= RICH_TEXT_MODULE_LIMITS.listItemsPerBlock
  ) {
    return
  }
  replaceBlock(index, {
    ...structuredClone(block),
    items: [...structuredClone(block.items), { children: [{ type: 'text', text: '', marks: [] }] }]
  })
}

function deleteListItem(index: number, itemIndex: number): void {
  const block = modelValue.blocks[index]
  if (block.type !== 'bulletList' && block.type !== 'orderedList') return
  replaceBlock(index, {
    ...structuredClone(block),
    items: block.items
      .filter((_, candidateIndex) => candidateIndex !== itemIndex)
      .map((item) => structuredClone(item))
  })
}
</script>

<template>
  <div class="flex flex-col gap-2" data-test-id="rich-text-content-editor">
    <article
      v-for="(block, index) in modelValue.blocks"
      :key="index"
      class="rounded border border-border bg-secondary/20 p-2"
      data-test-id="rich-text-block"
    >
      <header class="mb-1.5 flex items-center gap-1">
        <span class="w-4 shrink-0 text-center text-[9px] text-muted">{{ index + 1 }}</span>
        <select
          :value="richTextEditorBlockKind(block)"
          :aria-label="panels.lowcodeRichTextBlockType"
          class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 text-[10px] text-surface outline-none focus:border-accent"
          data-test-id="rich-text-block-type"
          @change="
            changeBlockType(
              index,
              ($event.target as HTMLSelectElement).value as RichTextEditorBlockKind
            )
          "
        >
          <option v-for="kind in RICH_TEXT_EDITOR_BLOCK_KINDS" :key="kind" :value="kind">
            {{ blockTypeLabels[kind]() }}
          </option>
        </select>
        <button
          type="button"
          class="rounded p-1 text-muted hover:bg-secondary hover:text-surface disabled:opacity-30"
          :disabled="index === 0"
          :aria-label="panels.lowcodeRichTextMoveUp"
          data-test-id="rich-text-move-up"
          @click="moveBlock(index, -1)"
        >
          <icon-lucide-chevron-up class="size-3" />
        </button>
        <button
          type="button"
          class="rounded p-1 text-muted hover:bg-secondary hover:text-surface disabled:opacity-30"
          :disabled="index === modelValue.blocks.length - 1"
          :aria-label="panels.lowcodeRichTextMoveDown"
          data-test-id="rich-text-move-down"
          @click="moveBlock(index, 1)"
        >
          <icon-lucide-chevron-down class="size-3" />
        </button>
        <button
          type="button"
          class="rounded p-1 text-muted hover:bg-secondary hover:text-danger"
          :aria-label="panels.lowcodeRichTextDeleteBlock"
          data-test-id="rich-text-delete-block"
          @click="deleteBlock(index)"
        >
          <icon-lucide-trash-2 class="size-3" />
        </button>
      </header>

      <div
        v-if="block.type === 'paragraph' || block.type === 'heading'"
        class="mb-1.5 flex gap-1"
        :aria-label="panels.textAlignment"
      >
        <button
          v-for="alignment in ['left', 'center', 'right'] as const"
          :key="alignment"
          type="button"
          class="rounded border px-1.5 py-0.5 text-[9px]"
          :class="
            block.align === alignment
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-border text-muted'
          "
          :aria-label="
            alignment === 'left'
              ? panels.alignLeft
              : alignment === 'center'
                ? panels.alignCenter
                : panels.alignRight
          "
          data-test-id="rich-text-align"
          @click="setAlignment(index, alignment)"
        >
          <icon-lucide-align-left v-if="alignment === 'left'" class="size-3" />
          <icon-lucide-align-center v-else-if="alignment === 'center'" class="size-3" />
          <icon-lucide-align-right v-else class="size-3" />
        </button>
      </div>

      <RichTextInlineEditor
        v-if="block.type === 'paragraph' || block.type === 'heading' || block.type === 'blockquote'"
        :model-value="block.children"
        @commit="replaceBlockChildren(index, $event)"
      />

      <div v-else-if="block.type === 'codeBlock'" class="flex flex-col gap-1">
        <input
          :value="block.language"
          type="text"
          :maxlength="RICH_TEXT_MODULE_LIMITS.language"
          :placeholder="panels.lowcodeRichTextLanguage"
          :aria-label="panels.lowcodeRichTextLanguage"
          class="rounded border border-border bg-input px-1.5 py-1 text-[10px] text-surface outline-none focus:border-accent"
          data-test-id="rich-text-code-language"
          @change="updateCodeBlock(index, { language: ($event.target as HTMLInputElement).value })"
        />
        <textarea
          :value="block.text"
          :maxlength="RICH_TEXT_MODULE_LIMITS.codeBlockText"
          rows="4"
          spellcheck="false"
          :aria-label="panels.lowcodeRichTextCodeBlock"
          class="resize-y rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] leading-relaxed text-surface outline-none focus:border-accent"
          data-test-id="rich-text-code-text"
          @change="updateCodeBlock(index, { text: ($event.target as HTMLTextAreaElement).value })"
        />
      </div>

      <div v-else class="flex flex-col gap-1.5">
        <div
          v-for="(item, itemIndex) in block.items"
          :key="itemIndex"
          class="flex items-start gap-1"
          data-test-id="rich-text-list-item"
        >
          <span class="mt-2 w-4 shrink-0 text-center text-[9px] text-muted">
            {{ block.type === 'orderedList' ? `${itemIndex + 1}.` : '•' }}
          </span>
          <div class="min-w-0 flex-1">
            <RichTextInlineEditor
              :model-value="item.children"
              @commit="replaceListItem(index, itemIndex, $event)"
            />
          </div>
          <button
            type="button"
            class="mt-1 rounded p-1 text-muted hover:bg-secondary hover:text-danger"
            :aria-label="panels.lowcodeRichTextDeleteListItem"
            data-test-id="rich-text-delete-list-item"
            @click="deleteListItem(index, itemIndex)"
          >
            <icon-lucide-trash-2 class="size-3" />
          </button>
        </div>
        <button
          type="button"
          class="rounded border border-dashed border-border px-2 py-1 text-[10px] text-muted hover:text-surface disabled:opacity-40"
          :disabled="block.items.length >= RICH_TEXT_MODULE_LIMITS.listItemsPerBlock"
          data-test-id="rich-text-add-list-item"
          @click="addListItem(index)"
        >
          <icon-lucide-plus class="mr-1 inline size-3" />
          {{ panels.lowcodeRichTextAddListItem }}
        </button>
      </div>
    </article>

    <div class="flex gap-1">
      <select
        v-model="nextBlockKind"
        :aria-label="panels.lowcodeRichTextBlockType"
        class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 text-[10px] text-surface outline-none focus:border-accent"
        data-test-id="rich-text-new-block-type"
      >
        <option v-for="kind in RICH_TEXT_EDITOR_BLOCK_KINDS" :key="kind" :value="kind">
          {{ blockTypeLabels[kind]() }}
        </option>
      </select>
      <button
        type="button"
        class="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white disabled:opacity-40"
        :disabled="modelValue.blocks.length >= RICH_TEXT_MODULE_LIMITS.blocks"
        data-test-id="rich-text-add-block"
        @click="addBlock"
      >
        <icon-lucide-plus class="mr-1 inline size-3" />
        {{ panels.lowcodeRichTextAddBlock }}
      </button>
    </div>
  </div>
</template>
