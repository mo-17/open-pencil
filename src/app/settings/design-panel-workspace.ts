import { useLocalStorage } from '@vueuse/core'
import { computed, watch } from 'vue'

export const DESIGN_PANEL_WORKSPACE_STORAGE_KEY = 'open-pencil:design-panel-workspace:v1'
export const DESIGN_PANEL_STUDIO_LAYOUT_STORAGE_KEY = 'open-pencil:design-panel-studio-layout:v1'

export const DESIGN_PANEL_WORKSPACES = ['classic', 'focused', 'studio'] as const
export const DESIGN_PANEL_CONTEXTS = ['single', 'multi', 'empty'] as const

export type DesignPanelWorkspace = (typeof DESIGN_PANEL_WORKSPACES)[number]
export type DesignPanelContext = (typeof DESIGN_PANEL_CONTEXTS)[number]

export const DEFAULT_DESIGN_PANEL_WORKSPACE: DesignPanelWorkspace = 'classic'

export const DEFAULT_DESIGN_PANEL_SECTION_ORDER = Object.freeze({
  single: Object.freeze([
    'component',
    'interaction-states',
    'module',
    'position',
    'layout',
    'appearance',
    'motion',
    'export',
    'lowcode-bindings',
    'lowcode-events',
    'lowcode-validation',
    'lowcode-advanced'
  ]),
  multi: Object.freeze(['component', 'position', 'appearance', 'motion', 'export']),
  empty: Object.freeze([
    'page',
    'lowcode-document-state',
    'lowcode-document-services',
    'lowcode-document-content',
    'assets-variables',
    'export'
  ])
}) satisfies Readonly<Record<DesignPanelContext, readonly string[]>>

const FOCUSED_DESIGN_PANEL_SECTIONS = Object.freeze({
  single: Object.freeze([
    'component',
    'interaction-states',
    'module',
    'position',
    'layout',
    'appearance'
  ]),
  multi: Object.freeze(['component', 'position', 'appearance']),
  empty: Object.freeze(['page', 'assets-variables'])
}) satisfies Readonly<Record<DesignPanelContext, readonly string[]>>

export interface DesignPanelStudioContextLayout {
  order: string[]
  hidden: string[]
}

export type DesignPanelStudioLayout = Record<DesignPanelContext, DesignPanelStudioContextLayout>

function defaultStudioContextLayout(context: DesignPanelContext): DesignPanelStudioContextLayout {
  return {
    order: [...DEFAULT_DESIGN_PANEL_SECTION_ORDER[context]],
    hidden: []
  }
}

export function createDefaultDesignPanelStudioLayout(): DesignPanelStudioLayout {
  return {
    single: defaultStudioContextLayout('single'),
    multi: defaultStudioContextLayout('multi'),
    empty: defaultStudioContextLayout('empty')
  }
}

export const DEFAULT_DESIGN_PANEL_STUDIO_LAYOUT = Object.freeze({
  single: Object.freeze({
    order: DEFAULT_DESIGN_PANEL_SECTION_ORDER.single,
    hidden: Object.freeze([] as string[])
  }),
  multi: Object.freeze({
    order: DEFAULT_DESIGN_PANEL_SECTION_ORDER.multi,
    hidden: Object.freeze([] as string[])
  }),
  empty: Object.freeze({
    order: DEFAULT_DESIGN_PANEL_SECTION_ORDER.empty,
    hidden: Object.freeze([] as string[])
  })
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeKnownSections(value: unknown, context: DesignPanelContext): string[] {
  if (!Array.isArray(value)) return []
  const known = new Set(DEFAULT_DESIGN_PANEL_SECTION_ORDER[context])
  const result: string[] = []
  for (const candidate of value) {
    if (typeof candidate !== 'string' || !known.has(candidate) || result.includes(candidate)) {
      continue
    }
    result.push(candidate)
  }
  return result
}

function normalizeStudioContextLayout(
  value: unknown,
  context: DesignPanelContext
): DesignPanelStudioContextLayout {
  const record = isRecord(value) ? value : {}
  const requestedOrder = normalizeKnownSections(record.order, context)
  const requested = new Set(requestedOrder)
  return {
    order: [
      ...requestedOrder,
      ...DEFAULT_DESIGN_PANEL_SECTION_ORDER[context].filter((id) => !requested.has(id))
    ],
    hidden: normalizeKnownSections(record.hidden, context)
  }
}

export function normalizeDesignPanelStudioLayout(value: unknown): DesignPanelStudioLayout {
  const record = isRecord(value) ? value : {}
  return {
    single: normalizeStudioContextLayout(record.single, 'single'),
    multi: normalizeStudioContextLayout(record.multi, 'multi'),
    empty: normalizeStudioContextLayout(record.empty, 'empty')
  }
}

function stringArraysEqual(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index])
}

function isCanonicalStudioContextLayout(
  value: unknown,
  normalized: DesignPanelStudioContextLayout
): boolean {
  if (!isRecord(value)) return false
  if (
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'order') ||
    !Object.hasOwn(value, 'hidden')
  ) {
    return false
  }
  return (
    Array.isArray(value.order) &&
    Array.isArray(value.hidden) &&
    stringArraysEqual(value.order, normalized.order) &&
    stringArraysEqual(value.hidden, normalized.hidden)
  )
}

function isCanonicalStudioLayout(value: unknown, normalized: DesignPanelStudioLayout): boolean {
  if (!isRecord(value)) return false
  if (
    Object.keys(value).length !== DESIGN_PANEL_CONTEXTS.length ||
    DESIGN_PANEL_CONTEXTS.some((context) => !Object.hasOwn(value, context))
  ) {
    return false
  }
  return DESIGN_PANEL_CONTEXTS.every((context) =>
    isCanonicalStudioContextLayout(value[context], normalized[context])
  )
}

export function repairStoredDesignPanelStudioLayout(
  value: unknown,
  persist: (layout: DesignPanelStudioLayout) => void
): DesignPanelStudioLayout {
  const normalized = normalizeDesignPanelStudioLayout(value)
  if (!isCanonicalStudioLayout(value, normalized)) persist(normalized)
  return normalized
}

export function normalizeDesignPanelWorkspace(value: unknown): DesignPanelWorkspace {
  return typeof value === 'string' &&
    DESIGN_PANEL_WORKSPACES.includes(value as DesignPanelWorkspace)
    ? (value as DesignPanelWorkspace)
    : DEFAULT_DESIGN_PANEL_WORKSPACE
}

export function repairStoredDesignPanelWorkspace(
  value: unknown,
  persist: (workspace: DesignPanelWorkspace) => void
): DesignPanelWorkspace {
  const normalized = normalizeDesignPanelWorkspace(value)
  if (value !== normalized) persist(normalized)
  return normalized
}

const storedWorkspace = useLocalStorage<unknown>(
  DESIGN_PANEL_WORKSPACE_STORAGE_KEY,
  DEFAULT_DESIGN_PANEL_WORKSPACE
)
const storedStudioLayout = useLocalStorage<unknown>(
  DESIGN_PANEL_STUDIO_LAYOUT_STORAGE_KEY,
  createDefaultDesignPanelStudioLayout()
)

watch(
  storedWorkspace,
  (value) => {
    repairStoredDesignPanelWorkspace(value, (workspace) => {
      storedWorkspace.value = workspace
    })
  },
  { immediate: true }
)

watch(
  storedStudioLayout,
  (value) => {
    repairStoredDesignPanelStudioLayout(value, (layout) => {
      storedStudioLayout.value = layout
    })
  },
  { immediate: true, deep: true }
)

export const designPanelWorkspace = computed<DesignPanelWorkspace>({
  get: () => normalizeDesignPanelWorkspace(storedWorkspace.value),
  set: (workspace) => {
    storedWorkspace.value = normalizeDesignPanelWorkspace(workspace)
  }
})

export const designPanelStudioLayout = computed<DesignPanelStudioLayout>({
  get: () => normalizeDesignPanelStudioLayout(storedStudioLayout.value),
  set: (layout) => {
    storedStudioLayout.value = normalizeDesignPanelStudioLayout(layout)
  }
})

export function getDesignPanelSectionOrder(
  context: DesignPanelContext,
  workspace: DesignPanelWorkspace = designPanelWorkspace.value
): string[] {
  return workspace === 'studio'
    ? [...designPanelStudioLayout.value[context].order]
    : [...DEFAULT_DESIGN_PANEL_SECTION_ORDER[context]]
}

export function isDesignPanelSectionHidden(context: DesignPanelContext, id: string): boolean {
  const known = DEFAULT_DESIGN_PANEL_SECTION_ORDER[context].includes(id)
  if (!known || designPanelWorkspace.value === 'classic') return false
  if (designPanelWorkspace.value === 'focused') {
    return !FOCUSED_DESIGN_PANEL_SECTIONS[context].includes(id)
  }
  return designPanelStudioLayout.value[context].hidden.includes(id)
}

export type DesignPanelStudioMoveDirection = 'up' | 'down' | -1 | 1

export function moveDesignPanelStudioSection(
  context: DesignPanelContext,
  id: string,
  direction: DesignPanelStudioMoveDirection
): void {
  const current = designPanelStudioLayout.value
  const order = [...current[context].order]
  const index = order.indexOf(id)
  if (index === -1) return
  const offset = direction === 'up' || direction === -1 ? -1 : 1
  const target = index + offset
  if (target < 0 || target >= order.length) return
  ;[order[index], order[target]] = [order[target], order[index]]
  designPanelStudioLayout.value = {
    ...current,
    [context]: { ...current[context], order }
  }
}

export function toggleDesignPanelStudioSection(context: DesignPanelContext, id: string): void {
  if (!DEFAULT_DESIGN_PANEL_SECTION_ORDER[context].includes(id)) return
  const current = designPanelStudioLayout.value
  const hidden = current[context].hidden.includes(id)
    ? current[context].hidden.filter((candidate) => candidate !== id)
    : [...current[context].hidden, id]
  designPanelStudioLayout.value = {
    ...current,
    [context]: { ...current[context], hidden }
  }
}

export function resetDesignPanelStudioLayout(context?: DesignPanelContext): void {
  if (context === undefined) {
    designPanelStudioLayout.value = createDefaultDesignPanelStudioLayout()
    return
  }
  designPanelStudioLayout.value = {
    ...designPanelStudioLayout.value,
    [context]: defaultStudioContextLayout(context)
  }
}
