import { computed, reactive, watch } from 'vue'

import {
  BUILTIN_PLUGIN_REGISTRY,
  VIDEO_MODULE_TYPE,
  VIDEO_PLUGIN_ID,
  type AccordionItemV1,
  type ModulePropertyField,
  type TabsItemV1
} from '@open-pencil/core/plugins'
import { readModuleInstance } from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'
import { useI18n, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  appPluginModuleEditorText,
  localizedAppPluginContributionText,
  localizedAppPluginModulePropertyText
} from '@/app/plugins/localization'
import {
  filterReferencedModuleItemIds,
  reconcileInitialModuleItemId
} from '@/app/plugins/module-items-editor-model'

function fieldKey(field: ModulePropertyField): string {
  return field.path.map(String).join('.')
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
  Reflect.set(current, path[path.length - 1], value)
  return next
}

export function useModulePropsPanelController() {
  const editor = useEditorStore()
  const { locale, panels } = useI18n()
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

  const moduleName = computed(() => {
    const current = definition.value
    if (!current) return ''
    return (
      localizedAppPluginContributionText(current.pluginId, current.moduleType, locale.value)
        ?.name ?? localizedPanelText(current.i18nNameKey, current.name)
    )
  })
  const moduleDescription = computed(() => {
    const current = definition.value
    if (!current) return ''
    return (
      localizedAppPluginContributionText(current.pluginId, current.moduleType, locale.value)
        ?.description ?? localizedPanelText(current.i18nDescriptionKey, current.description)
    )
  })
  const moduleEditorText = computed(() => appPluginModuleEditorText(locale.value))

  function fieldLabel(field: ModulePropertyField): string {
    return (
      (field.i18nLabelKey
        ? localizedAppPluginModulePropertyText(field.i18nLabelKey, locale.value)
        : undefined) ?? localizedPanelText(field.i18nLabelKey, field.label)
    )
  }

  function optionLabel(field: ModulePropertyField, option: string): string {
    const key = field.i18nLabelKey ? `${field.i18nLabelKey}:${option}` : ''
    return (key ? localizedAppPluginModulePropertyText(key, locale.value) : undefined) ?? option
  }

  function commitConfig(field: ModulePropertyField, nextConfig: JsonObject): boolean {
    const node = selectedNode.value
    const moduleDefinition = definition.value
    if (!node || !moduleDefinition || !resolution.value?.ok) return false
    try {
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

  function commitField(field: ModulePropertyField, value: unknown): boolean {
    try {
      return commitConfig(field, withValueAtPath(config.value, field.path, value))
    } catch (error) {
      jsonErrors[fieldKey(field)] = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  function commitBooleanField(field: ModulePropertyField, event: Event): void {
    const input = event.target as HTMLInputElement
    if (!commitField(field, input.checked)) {
      input.checked = valueAtPath(config.value, field.path) === true
    }
  }

  function commitTabsItems(field: ModulePropertyField, value: TabsItemV1[]): void {
    const initialTabId = reconcileInitialModuleItemId(value, config.value.initialTabId)
    commitConfig(field, { ...config.value, tabs: structuredClone(value), initialTabId })
  }

  function commitAccordionItems(field: ModulePropertyField, value: AccordionItemV1[]): void {
    const initialOpenIds = filterReferencedModuleItemIds(value, config.value.initialOpenIds)
    commitConfig(field, { ...config.value, items: structuredClone(value), initialOpenIds })
  }

  function commitJson(field: ModulePropertyField, source: string): void {
    try {
      commitField(field, JSON.parse(source))
    } catch (error) {
      jsonErrors[fieldKey(field)] = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    config,
    definition,
    fields,
    fieldKey,
    fieldLabel,
    optionLabel,
    jsonErrors,
    moduleDescription,
    moduleEditorText,
    moduleName,
    panels,
    statusMessage,
    commitAccordionItems,
    commitBooleanField,
    commitField,
    commitJson,
    commitTabsItems
  }
}

export function valueAtPath(root: unknown, path: readonly (string | number)[]): unknown {
  let current = root
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = Reflect.get(current, segment)
  }
  return current
}
