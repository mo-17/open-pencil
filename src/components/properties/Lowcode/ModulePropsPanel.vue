<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import {
  BUILTIN_PLUGIN_REGISTRY,
  HTML_MODULE_TYPE,
  HTML_PLUGIN_ID,
  RICH_TEXT_MODULE_TYPE,
  RICH_TEXT_PLUGIN_ID,
  SLIDE_MENU_MODULE_TYPE,
  SLIDE_MENU_PLUGIN_ID,
  TABLE_MODULE_TYPE,
  TABLE_PLUGIN_ID,
  VIDEO_MODULE_TYPE,
  VIDEO_PLUGIN_ID,
  type ModulePropertyField,
  type RichTextDocumentV1,
  type SlideMenuItemV1,
  type TableDataV1
} from '@open-pencil/core/plugins'
import { readModuleInstance } from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'
import { useI18n, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import NumberField from '@/components/inputs/NumberField.vue'
import { useSectionUI } from '@/components/ui/section'

import HtmlContentEditor from './HtmlContentEditor.vue'
import RichTextContentEditor from './RichTextContentEditor.vue'
import SlideMenuItemsEditor from './SlideMenuItemsEditor.vue'
import TableContentEditor from './TableContentEditor.vue'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()
const jsonErrors = reactive<Record<string, string>>({})

const rawModule = computed(() => selectedNode.value?.interactiveProps?.module)
const instance = computed(() => readModuleInstance(rawModule.value))
watch(
  () => [selectedNode.value?.id, instance.value?.pluginId, instance.value?.moduleType],
  () => {
    for (const key of Object.keys(jsonErrors)) Reflect.deleteProperty(jsonErrors, key)
  }
)
const definition = computed(() => {
  const current = instance.value
  return current
    ? BUILTIN_PLUGIN_REGISTRY.getModule(current.pluginId, current.moduleType)
    : undefined
})
const resolution = computed(() => definition.value?.resolve(rawModule.value) ?? null)
const fields = computed(() => definition.value?.fields ?? [])
const config = computed<JsonObject>(() => {
  const current = resolution.value
  return current?.ok ? current.config : {}
})
const statusMessage = computed(() => {
  if (!instance.value) return panels.value.lowcodeModuleInvalidData
  if (!definition.value) {
    return panels.value.lowcodeModuleNotInstalled({
      pluginId: instance.value.pluginId,
      moduleType: instance.value.moduleType
    })
  }
  if (resolution.value && !resolution.value.ok) return resolution.value.reason
  return ''
})
function localizedPanelText(key: string | undefined, fallback: string): string {
  if (!key) return fallback
  const localized = Reflect.get(panels.value, key)
  return typeof localized === 'string' ? localized : fallback
}

const moduleName = computed(() =>
  definition.value ? localizedPanelText(definition.value.i18nNameKey, definition.value.name) : ''
)
const moduleDescription = computed(() =>
  definition.value
    ? localizedPanelText(definition.value.i18nDescriptionKey, definition.value.description)
    : ''
)

function fieldLabel(field: ModulePropertyField): string {
  return localizedPanelText(field.i18nLabelKey, field.label)
}

function fieldKey(field: ModulePropertyField): string {
  return field.path.map(String).join('.')
}

function valueAtPath(root: unknown, path: readonly (string | number)[]): unknown {
  let current = root
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = Reflect.get(current, segment)
  }
  return current
}

function withValueAtPath(
  root: JsonObject,
  path: readonly (string | number)[],
  value: unknown
): JsonObject {
  if (path.length === 0) throw new TypeError('Module property path must not be empty')
  const next = structuredClone(root)
  let current: object = next
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]
    const child = Reflect.get(current, segment)
    if (child === null || typeof child !== 'object') {
      const replacement: object = typeof path[index + 1] === 'number' ? [] : {}
      Reflect.set(current, segment, replacement)
      current = replacement
    } else {
      current = child
    }
  }
  const finalSegment = path[path.length - 1]
  Reflect.set(current, finalSegment, value)
  return next
}

function commitField(field: ModulePropertyField, value: unknown): boolean {
  const node = selectedNode.value
  const moduleDefinition = definition.value
  if (!node || !moduleDefinition || !resolution.value?.ok) return false
  try {
    const nextConfig = withValueAtPath(config.value, field.path, value)
    const nextInstance = moduleDefinition.createInstance(nextConfig)
    editor.updateNodeWithUndo(
      node.id,
      {
        interactiveProps: {
          ...node.interactiveProps,
          module: nextInstance
        }
      },
      `Update ${moduleDefinition.name}`
    )
    const committedFieldKey = fieldKey(field)
    Reflect.deleteProperty(jsonErrors, committedFieldKey)
    if (
      moduleDefinition.pluginId === VIDEO_PLUGIN_ID &&
      moduleDefinition.moduleType === VIDEO_MODULE_TYPE &&
      (committedFieldKey === 'muted' || committedFieldKey === 'autoplay')
    ) {
      Reflect.deleteProperty(jsonErrors, 'muted')
      Reflect.deleteProperty(jsonErrors, 'autoplay')
    }
    return true
  } catch (error) {
    jsonErrors[fieldKey(field)] = error instanceof Error ? error.message : String(error)
    return false
  }
}

function commitBooleanField(field: ModulePropertyField, event: Event): void {
  const input = event.target as HTMLInputElement
  if (!commitField(field, input.checked)) input.checked = booleanValue(field)
}

function numberValue(field: ModulePropertyField): number {
  const value = valueAtPath(config.value, field.path)
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(field: ModulePropertyField): boolean {
  return valueAtPath(config.value, field.path) === true
}

function textValue(field: ModulePropertyField): string {
  const value = valueAtPath(config.value, field.path)
  return typeof value === 'string' ? value : ''
}

function jsonValue(field: ModulePropertyField): string {
  const value = valueAtPath(config.value, field.path)
  return JSON.stringify(value ?? null, null, 2)
}

function isRichTextContentField(field: ModulePropertyField): boolean {
  return (
    definition.value?.pluginId === RICH_TEXT_PLUGIN_ID &&
    definition.value.moduleType === RICH_TEXT_MODULE_TYPE &&
    field.path.length === 1 &&
    field.path[0] === 'content'
  )
}

function isHtmlContentField(field: ModulePropertyField): boolean {
  return (
    definition.value?.pluginId === HTML_PLUGIN_ID &&
    definition.value.moduleType === HTML_MODULE_TYPE &&
    field.path.length === 1 &&
    field.path[0] === 'html'
  )
}

function isTableContentField(field: ModulePropertyField): boolean {
  return (
    definition.value?.pluginId === TABLE_PLUGIN_ID &&
    definition.value.moduleType === TABLE_MODULE_TYPE &&
    field.path.length === 1 &&
    field.path[0] === 'table'
  )
}

function isSlideMenuItemsField(field: ModulePropertyField): boolean {
  return (
    definition.value?.pluginId === SLIDE_MENU_PLUGIN_ID &&
    definition.value.moduleType === SLIDE_MENU_MODULE_TYPE &&
    field.path.length === 1 &&
    field.path[0] === 'items'
  )
}

function richTextDocument(field: ModulePropertyField): RichTextDocumentV1 {
  return valueAtPath(config.value, field.path) as RichTextDocumentV1
}

function tableData(field: ModulePropertyField): TableDataV1 {
  return valueAtPath(config.value, field.path) as TableDataV1
}

function slideMenuItems(field: ModulePropertyField): SlideMenuItemV1[] {
  const value = valueAtPath(config.value, field.path)
  return Array.isArray(value) ? (value as SlideMenuItemV1[]) : []
}

function commitJson(field: ModulePropertyField, source: string): void {
  try {
    commitField(field, JSON.parse(source))
  } catch (error) {
    jsonErrors[fieldKey(field)] = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <div data-test-id="module-props-panel" :class="sectionCls.wrapper">
    <div v-if="definition" class="mb-2">
      <div class="text-[11px] font-medium text-surface">{{ moduleName }}</div>
      <p class="mt-0.5 text-[10px] leading-relaxed text-muted">{{ moduleDescription }}</p>
      <p class="mt-0.5 text-[9px] text-muted/70">
        {{ definition.pluginId }}/{{ definition.moduleType }} ·
        {{ panels.lowcodeModuleConfigVersion({ version: definition.configVersion }) }}
      </p>
    </div>

    <p
      v-if="statusMessage"
      data-test-id="module-props-status"
      class="mb-2 rounded border border-orange-500/30 bg-orange-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-orange-400"
    >
      {{ statusMessage }}
    </p>

    <div
      v-for="field in fields"
      :key="fieldKey(field)"
      data-test-id="module-property-field"
      :data-module-path="fieldKey(field)"
      class="mb-2 flex flex-col gap-1"
    >
      <label class="text-[10px] text-muted">{{ fieldLabel(field) }}</label>

      <NumberField
        v-if="field.kind === 'number'"
        :model-value="numberValue(field)"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        :label="fieldLabel(field)"
        data-test-id="module-property-input"
        :data-module-path="fieldKey(field)"
        @commit="commitField(field, $event)"
      />

      <input
        v-else-if="field.kind === 'boolean'"
        type="checkbox"
        :checked="booleanValue(field)"
        :aria-label="fieldLabel(field)"
        data-test-id="module-property-input"
        :data-module-path="fieldKey(field)"
        class="size-3.5 accent-accent"
        @change="commitBooleanField(field, $event)"
      />

      <select
        v-else-if="field.kind === 'select'"
        :value="textValue(field)"
        :aria-label="fieldLabel(field)"
        data-test-id="module-property-input"
        :data-module-path="fieldKey(field)"
        class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
        @change="commitField(field, ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in field.options" :key="option" :value="option">
          {{ option }}
        </option>
      </select>

      <RichTextContentEditor
        v-else-if="isRichTextContentField(field)"
        :model-value="richTextDocument(field)"
        @commit="commitField(field, $event)"
      />

      <HtmlContentEditor
        v-else-if="isHtmlContentField(field)"
        :model-value="textValue(field)"
        :label="fieldLabel(field)"
        :error="jsonErrors[fieldKey(field)]"
        @commit="commitField(field, $event)"
      />

      <TableContentEditor
        v-else-if="isTableContentField(field)"
        :model-value="tableData(field)"
        :label="fieldLabel(field)"
        :error="jsonErrors[fieldKey(field)]"
        @commit="commitField(field, $event)"
      />

      <SlideMenuItemsEditor
        v-else-if="isSlideMenuItemsField(field)"
        :model-value="slideMenuItems(field)"
        :label="fieldLabel(field)"
        :invalid="Boolean(jsonErrors[fieldKey(field)])"
        @commit="commitField(field, $event)"
      />

      <textarea
        v-else-if="field.kind === 'json'"
        :value="jsonValue(field)"
        :aria-label="fieldLabel(field)"
        data-test-id="module-property-input"
        :data-module-path="fieldKey(field)"
        rows="4"
        spellcheck="false"
        class="w-full resize-y rounded border border-border bg-input px-2 py-1 font-mono text-[10px] leading-relaxed text-surface outline-none focus:border-accent"
        @change="commitJson(field, ($event.target as HTMLTextAreaElement).value)"
      />

      <input
        v-else-if="field.kind === 'color'"
        type="color"
        :value="textValue(field)"
        :aria-label="fieldLabel(field)"
        data-test-id="module-property-input"
        :data-module-path="fieldKey(field)"
        class="h-7 w-full cursor-pointer rounded border border-border bg-input p-1"
        @change="commitField(field, ($event.target as HTMLInputElement).value)"
      />

      <input
        v-else
        type="text"
        :value="textValue(field)"
        :aria-label="fieldLabel(field)"
        data-test-id="module-property-input"
        :data-module-path="fieldKey(field)"
        spellcheck="false"
        class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
        @change="commitField(field, ($event.target as HTMLInputElement).value)"
      />

      <p v-if="jsonErrors[fieldKey(field)]" class="text-[10px] text-red-400">
        {{ jsonErrors[fieldKey(field)] }}
      </p>
    </div>
  </div>
</template>
