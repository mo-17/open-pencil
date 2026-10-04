export const RICH_TEXT_VUE_TEMPLATE = `
<template>
  <div v-bind="$attrs" ref="host" :style="hostStyle" :data-openpencil-rich-text-unavailable="unavailable ? 'true' : undefined">
    <span v-if="unavailable" role="alert">Rich text unavailable.</span>
    <div data-openpencil-rich-text-editor="" class="flex h-full min-h-0 w-full flex-col bg-white" @click.stop @keydown.stop @pointerdown.stop>
      <div role="toolbar" aria-label="Rich text formatting" :aria-controls="editorId" class="flex flex-wrap items-center gap-1.5 border-b border-gray-300 px-3 py-2.5 text-gray-700">
        <select aria-label="Block style" :disabled="readOnly" class="h-8 min-w-28 rounded border border-gray-300 bg-white px-2 text-sm" @mousedown="captureSelection" @change="blockStyle">
          <option value="">Block style</option><option value="p">Normal</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="blockquote">Quote</option><option value="pre">Code block</option>
        </select>
        <button v-for="item in commands" :key="item.label" type="button" :aria-label="item.label" :title="item.label" :disabled="readOnly" class="inline-flex h-8 min-w-8 items-center justify-center rounded bg-white px-2 text-sm font-semibold disabled:cursor-not-allowed" @mousedown.prevent @click="runCommand(item.command)">{{ item.text }}</button>
        <button type="button" aria-label="Inline code" :disabled="readOnly" class="h-8 min-w-8 rounded bg-white px-2" @mousedown.prevent @click="toggleInlineCode">{ }</button>
        <button type="button" aria-label="Link" :disabled="readOnly" class="h-8 min-w-8 rounded bg-white px-2" @mousedown.prevent @click="applyLink">↗</button>
      </div>
      <article
        :id="editorId" ref="editor" data-openpencil-rich-text="" role="textbox" aria-label="Rich text editor" aria-multiline="true"
        :aria-readonly="readOnly" :contenteditable="!readOnly" spellcheck="true" :tabindex="disabled ? -1 : 0"
        class="box-border grid min-h-0 w-full flex-1 gap-[0.65em] overflow-auto whitespace-pre-wrap p-[1em] outline-none"
        @input="syncDocument" @blur="blurEditor" @focus="focusEditor" @mouseup="captureSelection" @keyup="captureSelection"
        @compositionstart="startComposition" @compositionend="endComposition" @paste="handlePaste" @drop="handleDrop" @click.capture="preventLinkNavigation"
      />
      <input ref="hiddenInput" type="hidden" :name="name ?? 'openpencil.richText.' + editorId" :form="form" :value="serialized" :disabled="disabled || unavailable" />
      <span aria-live="polite" class="sr-only">{{ status }}</span>
    </div>
    <slot />
  </div>
</template>
`
