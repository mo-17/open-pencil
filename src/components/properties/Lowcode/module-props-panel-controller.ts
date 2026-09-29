import { computed, reactive, watch } from 'vue'

import {
  ACCORDION_PLUGIN_ID,
  BUILTIN_PLUGIN_REGISTRY,
  CAROUSEL_PLUGIN_ID,
  UPLOAD_BUTTON_MODULE_TYPE,
  UPLOAD_BUTTON_PLUGIN_ID,
  VIDEO_MODULE_TYPE,
  VIDEO_PLUGIN_ID,
  VR_TOUR_MODULE_TYPE,
  VR_TOUR_PLUGIN_ID,
  type ModulePropertyField,
  type TabsItemV1
} from '@open-pencil/core/plugins'
import { readModuleInstance } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { useI18n, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  accordionPropertyVisible,
  commitAccordionEditor,
  type AccordionEditorCommit
} from '@/app/lowcode/accordion-editor'
import {
  carouselPropertyVisible,
  commitCarouselSlides,
  type CarouselSlidesCommit
} from '@/app/lowcode/carousel-editor'
import { commitChartData, type ChartDataCommit } from '@/app/lowcode/chart-editor'
import { chartEditorCopy } from '@/app/lowcode/chart-editor/copy'
import { feedbackPropertyVisible } from '@/app/lowcode/feedback-controls/properties'
import {
  canEditModalContent,
  createModalContent,
  modalContentChild
} from '@/app/lowcode/modal-content'
import { currentModuleEditorOwner } from '@/app/lowcode/module-editor/owner'
import type { ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'
import {
  commitNavigationEditor,
  type NavigationEditorCommit
} from '@/app/lowcode/navigation-editor'
import { commitOrgChartItems } from '@/app/lowcode/org-chart-editor'
import { createTabsContentActions, inspectTabsContent } from '@/app/lowcode/tabs-content'
import { commitTimelineItems, type TimelineEditorCommit } from '@/app/lowcode/timeline-editor'
import { commitTreeEditor, type TreeEditorCommit } from '@/app/lowcode/tree-editor'
import {
  reconcileValueControlConfig,
  valueControlPropertyVisible
} from '@/app/lowcode/value-controls/properties'
import { walktourChildTargets } from '@/app/lowcode/walktour-editor'
import {
  appPluginModuleEditorText,
  localizedAppPluginContributionText,
  localizedAppPluginModulePropertyText
} from '@/app/plugins/localization'
import { reconcileInitialModuleItemId } from '@/app/plugins/module-items-editor-model'
import { moduleOptionPanelKey } from '@/app/plugins/module-option-localization'
import { vrTourEditorCopy } from '@/app/plugins/vr-tour/copy'

function fieldKey(field: ModulePropertyField): string {
  return field.path.map(String).join('.')
}

function withValueAtPath(
  root: JSONObject,
  path: readonly (string | number)[],
  value: unknown
): JSONObject {
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

  const tabsOwner = computed(() => {
    void editor.state.sceneVersion
    const node = selectedNode.value
    return node ? editor.graph.getNode(node.id) : undefined
  })
  const tabsContentStates = computed(() => {
    void editor.state.sceneVersion
    const node = tabsOwner.value
    return node ? inspectTabsContent(editor.graph, node, editor.canEnterContentEdit) : {}
  })
  const tabsPreviewId = computed(() => {
    void editor.state.renderVersion
    const node = tabsOwner.value
    return node ? editor.getTabsTabPreview(node.id) : undefined
  })
  const { viewTabContent, editTabContent, resetTabsPreview } = createTabsContentActions(editor)

  const contentChildOptions = computed(() => {
    void editor.state.sceneVersion
    if (
      readModuleInstance(tabsOwner.value?.interactiveProps?.module)?.pluginId ===
      'open-pencil.walktour'
    )
      return walktourChildTargets(editor.graph, tabsOwner.value)
    const counts = new Map<string, number>()
    for (const id of selectedNode.value?.childIds ?? []) {
      const name = editor.graph.getNode(id)?.name
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts].map(([name, count]) => ({
      value: name,
      label: name,
      disabled: count !== 1 || name.length > 120 || name.trim() !== name
    }))
  })
  const canCreateContent = computed(() => {
    void editor.state.sceneVersion
    const node = selectedNode.value
    return Boolean(node && canEditModalContent(editor.graph, node))
  })
  const canOpenContent = computed(() => {
    void editor.state.sceneVersion
    const node = selectedNode.value
    return Boolean(node && modalContentChild(editor.graph, node))
  })
  function openContent() {
    const node = selectedNode.value
    const child = node && modalContentChild(editor.graph, node)
    if (child) editor.enterContentEdit(child.id)
  }
  function addContent() {
    const node = selectedNode.value
    if (!node) return
    const popover =
      readModuleInstance(node.interactiveProps?.module)?.pluginId === 'open-pencil.popover'
    const id = createModalContent(
      editor,
      node.id,
      popover ? panels.value.lowcodePopoverContentName : panels.value.lowcodeModalContentName
    )
    if (id) editor.enterContentEdit(id)
  }
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
  const fields = computed(() =>
    (definition.value?.fields ?? [])
      .filter(
        (field) =>
          definition.value?.pluginId !== 'open-pencil.stepper' || fieldKey(field) !== 'currentIndex'
      )
      .filter(
        (field) =>
          (definition.value?.pluginId !== 'open-pencil.cascader' ||
            fieldKey(field) !== 'initialPath') &&
          (definition.value?.pluginId !== 'open-pencil.org-chart' ||
            fieldKey(field) !== 'initialCollapsedIds') &&
          feedbackPropertyVisible(definition.value?.pluginId, fieldKey(field), config.value) &&
          valueControlPropertyVisible(definition.value?.pluginId, fieldKey(field), config.value) &&
          (definition.value?.pluginId !== CAROUSEL_PLUGIN_ID ||
            carouselPropertyVisible(fieldKey(field), config.value)) &&
          (definition.value?.pluginId !== ACCORDION_PLUGIN_ID ||
            accordionPropertyVisible(fieldKey(field)))
      )
  )
  const config = computed<JSONObject>(() => {
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

  function localizedPanelValue(key: string | undefined): string | undefined {
    if (!key) return undefined
    const localized = Reflect.get(panels.value, key)
    return typeof localized === 'string' ? localized : undefined
  }

  function localizedPanelText(key: string | undefined, fallback: string): string {
    return localizedPanelValue(key) ?? fallback
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
    if (definition.value?.pluginId === 'open-pencil.chart' && fieldKey(field) === 'values')
      return chartEditorCopy(locale.value).heading
    if (definition.value?.pluginId === CAROUSEL_PLUGIN_ID) {
      const labels: Partial<Record<string, string>> = {
        label: panels.value.lowcodeCarouselAccessibleLabel,
        slides: panels.value.lowcodeCarouselSlides,
        layout: panels.value.lowcodeCarouselLayout,
        imageFit: panels.value.lowcodeCarouselImageFit,
        textPosition: panels.value.lowcodeCarouselTextPosition,
        textAlign: panels.value.lowcodeCarouselTextAlign,
        overlayOpacity: panels.value.lowcodeCarouselOverlayOpacity,
        paginationStyle: panels.value.lowcodeCarouselPaginationStyle,
        transition: panels.value.lowcodeCarouselTransition,
        autoplay: panels.value.lowcodeModuleFieldAutoplay,
        intervalMs: panels.value.lowcodeCarouselInterval,
        loop: panels.value.lowcodeModuleFieldLoop,
        showArrows: panels.value.lowcodeCarouselShowArrows,
        arrowPosition: panels.value.lowcodeCarouselArrowPosition,
        swipeEnabled: panels.value.lowcodeCarouselSwipeEnabled,
        showDots: panels.value.lowcodeCarouselShowDots,
        pauseOnHover: panels.value.lowcodeCarouselPauseOnHover,
        backgroundColor: panels.value.lowcodeModuleFieldModalPanelBackground,
        textColor: panels.value.lowcodeModuleFieldTextColor,
        accentColor: panels.value.lowcodeModuleFieldModalAccentColor
      }
      const label = labels[fieldKey(field)]
      if (label) return label
    }
    return (
      (field.i18nLabelKey
        ? localizedAppPluginModulePropertyText(field.i18nLabelKey, locale.value)
        : undefined) ?? localizedPanelText(field.i18nLabelKey, field.label)
    )
  }

  function optionLabel(field: ModulePropertyField, option: string): string {
    if (definition.value?.pluginId === CAROUSEL_PLUGIN_ID) {
      const styles: Partial<Record<string, string>> = {
        split: panels.value.lowcodeCarouselSplit,
        overlay: panels.value.lowcodeCarouselOverlay,
        cover: panels.value.lowcodeCarouselCover,
        contain: panels.value.lowcodeCarouselContain,
        fill: panels.value.lowcodeCarouselFill,
        top: panels.value.lowcodeCarouselTop,
        center: panels.value.lowcodeCarouselCenter,
        bottom: panels.value.lowcodeCarouselBottom,
        left: panels.value.lowcodeCarouselLeft,
        right: panels.value.lowcodeCarouselRight,
        dots: panels.value.lowcodeCarouselDots,
        numbers: panels.value.lowcodeCarouselNumbers,
        fraction: panels.value.lowcodeCarouselFraction,
        sides: panels.value.lowcodeCarouselArrowSides,
        'top-corners': panels.value.lowcodeCarouselArrowTopCorners,
        'bottom-corners': panels.value.lowcodeCarouselArrowBottomCorners,
        'bottom-left': panels.value.lowcodeCarouselArrowBottomLeft,
        'bottom-right': panels.value.lowcodeCarouselArrowBottomRight
      }
      if (styles[option]) return styles[option]
    }
    if (definition.value?.pluginId === CAROUSEL_PLUGIN_ID && fieldKey(field) === 'transition')
      return option === 'slide'
        ? panels.value.lowcodeCarouselSlideTransition
        : panels.value.lowcodeCarouselFadeTransition
    if (
      definition.value?.pluginId === VR_TOUR_PLUGIN_ID &&
      field.i18nLabelKey === 'lowcodeModuleFieldVRTourLocale'
    )
      return option === 'zh-CN' ? '简体中文' : 'English'
    const key = field.i18nLabelKey ? `${field.i18nLabelKey}:${option}` : ''
    const panelKey = moduleOptionPanelKey(field.i18nLabelKey, option)
    return (
      localizedPanelValue(panelKey) ??
      (key ? localizedAppPluginModulePropertyText(key, locale.value) : undefined) ??
      option
    )
  }

  function commitConfig(field: ModulePropertyField, nextConfig: JSONObject): boolean {
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
      if (
        moduleDefinition.pluginId === UPLOAD_BUTTON_PLUGIN_ID &&
        moduleDefinition.moduleType === UPLOAD_BUTTON_MODULE_TYPE &&
        (committedFieldKey === 'multiple' || committedFieldKey === 'maxFiles')
      ) {
        Reflect.deleteProperty(jsonErrors, 'multiple')
        Reflect.deleteProperty(jsonErrors, 'maxFiles')
      }
      return true
    } catch (error) {
      jsonErrors[fieldKey(field)] = fieldError(field, error)
      return false
    }
  }

  function fieldError(field: ModulePropertyField, error: unknown): string {
    if (
      definition.value?.pluginId === 'open-pencil.chart' &&
      fieldKey(field) === 'chartType' &&
      Array.isArray(config.value.values) &&
      config.value.values.some((value) => typeof value === 'number' && value < 0)
    )
      return chartEditorCopy(locale.value).typeError
    if (definition.value?.pluginId !== VR_TOUR_PLUGIN_ID || !locale.value.startsWith('zh'))
      return error instanceof Error ? error.message : String(error)
    const copy = vrTourEditorCopy(locale.value)
    const key = fieldKey(field)
    if (key === 'scenes') return copy.invalidScenes
    return key === 'locale' ? copy.invalidLocale : copy.invalidSetting
  }

  function commitField(field: ModulePropertyField, value: unknown): boolean {
    try {
      const next = withValueAtPath(config.value, field.path, value)
      if (
        definition.value?.pluginId === 'open-pencil.tree' &&
        fieldKey(field) === 'selectionMode' &&
        value === 'single' &&
        Array.isArray(next.initialSelectedIds)
      ) {
        next.initialSelectedIds = next.initialSelectedIds.slice(0, 1)
      }
      if (
        definition.value?.pluginId === VR_TOUR_PLUGIN_ID &&
        definition.value.moduleType === VR_TOUR_MODULE_TYPE &&
        fieldKey(field) === 'scenes' &&
        Array.isArray(value)
      ) {
        const ids = value.flatMap((entry: unknown) =>
          entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string'
            ? [{ id: entry.id }]
            : []
        )
        next.initialSceneId = reconcileInitialModuleItemId(ids, config.value.initialSceneId)
      }
      return commitConfig(
        field,
        reconcileValueControlConfig(definition.value?.pluginId, fieldKey(field), next)
      )
    } catch (error) {
      jsonErrors[fieldKey(field)] = fieldError(field, error)
      return false
    }
  }

  function commitScalar(field: ModulePropertyField, request: ModuleScalarCommit): void {
    if (!currentModuleEditorOwner(editor, request)) return
    if (request.value.kind === 'boolean') commitBooleanField(field, request.value.event)
    else if (request.value.kind === 'json') commitJSON(field, request.value.source)
    else if (definition.value?.pluginId === 'open-pencil.org-chart' && fieldKey(field) === 'items')
      commitOrgChartItems(editor, request)
    else commitField(field, request.value.value)
  }

  function commitBooleanField(field: ModulePropertyField, event: Event): void {
    const input = event.target as HTMLInputElement
    const moduleDefinition = definition.value
    const isUploadMultiple =
      moduleDefinition?.pluginId === UPLOAD_BUTTON_PLUGIN_ID &&
      moduleDefinition.moduleType === UPLOAD_BUTTON_MODULE_TYPE &&
      fieldKey(field) === 'multiple'
    const committed = isUploadMultiple
      ? commitConfig(field, {
          ...config.value,
          multiple: input.checked,
          maxFiles: input.checked
            ? Math.max(2, typeof config.value.maxFiles === 'number' ? config.value.maxFiles : 2)
            : 1
        })
      : commitField(field, input.checked)
    if (!committed) {
      input.checked = valueAtPath(config.value, field.path) === true
    }
  }

  function commitTabsItems(field: ModulePropertyField, value: TabsItemV1[]): void {
    const initialTabId = reconcileInitialModuleItemId(value, config.value.initialTabId)
    commitConfig(field, { ...config.value, tabs: structuredClone(value), initialTabId })
  }

  function commitCarousel(request: CarouselSlidesCommit): void {
    commitCarouselSlides(editor, request)
  }

  function commitChart(request: ChartDataCommit): void {
    if (commitChartData(editor, request)) Reflect.deleteProperty(jsonErrors, 'chartType')
  }

  function commitTimeline(request: TimelineEditorCommit): void {
    commitTimelineItems(editor, request)
  }

  function commitTree(request: TreeEditorCommit): void {
    commitTreeEditor(editor, request)
  }

  function commitNavigation(request: NavigationEditorCommit): void {
    commitNavigationEditor(editor, request)
  }

  function commitAccordionItems(request: AccordionEditorCommit): void {
    commitAccordionEditor(editor, request)
  }

  function commitJSON(field: ModulePropertyField, source: string): void {
    try {
      commitField(field, JSON.parse(source))
    } catch (error) {
      jsonErrors[fieldKey(field)] = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    tabsOwner,
    tabsContentStates,
    tabsPreviewId,
    viewTabContent,
    editTabContent,
    resetTabsPreview,
    canCreateContent,
    canOpenContent,
    openContent,
    addContent,
    contentChildOptions,
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
    commitScalar,
    commitNavigation,
    commitTree,
    commitChart,
    commitTimeline,
    commitAccordionItems,
    commitCarousel,
    commitBooleanField,
    commitField,
    commitJSON,
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
