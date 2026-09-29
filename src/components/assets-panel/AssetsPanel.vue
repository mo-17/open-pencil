<script setup lang="ts">
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger
} from 'reka-ui'
import { computed, onMounted, ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'
import { usePanelMessages, useCommandMessages, useDialogMessages } from '@open-pencil/vue'

import { componentAssetKey, matchesAssetQuery } from '@/app/assets/catalog'
import { captureAssetTarget } from '@/app/assets/target'
import type { LocalAsset } from '@/app/assets/types'
import { useAssetWorkbench } from '@/app/assets/use'
import { useEditorStore } from '@/app/editor/active-store'
import { nodeIcon } from '@/app/editor/icons'
import { useLibraryService } from '@/app/libraries'
import type { ComponentTemplateId } from '@/app/lowcode/component-templates'
import { openSettingsDialog } from '@/app/settings/dialog'
import { openExternalLink } from '@/app/shell/ui'
import AssetDetailsDialog from '@/components/assets-panel/AssetDetailsDialog.vue'
import AssetThumbnail from '@/components/assets-panel/AssetThumbnail.vue'
import ComponentTemplateAssets from '@/components/assets-panel/ComponentTemplateAssets.vue'
import { findAssetPage } from '@/components/assets-panel/page'
import PluginModuleAssets from '@/components/assets-panel/PluginModuleAssets.vue'
import DesignBriefLauncher from '@/components/design-brief/DesignBriefLauncher.vue'
import LibraryManagerDialog from '@/components/libraries/LibraryManagerDialog.vue'
import { useLibraryEntry } from '@/components/libraries/useLibraryEntry'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppPlaceholder from '@/components/ui/feedback/AppPlaceholder.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import { useMenuUI } from '@/components/ui/menu/menu'
import Tip from '@/components/ui/overlay/Tip.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import SegmentedControl from '@/components/ui/select/SegmentedControl.vue'
import { ASSET_GRID_THUMBNAIL_SIZE, ASSET_LIST_THUMBNAIL_SIZE } from '@/constants'

type AssetView = 'grid' | 'list'

type AssetGroup = {
  pageId: string
  pageName: string
  assets: LocalAsset[]
}

const editor = useEditorStore()
const libraryService = useLibraryService()
const remoteAssets = libraryService.enabledAssets
const panels = usePanelMessages()
const commands = useCommandMessages()
const dialogs = useDialogMessages()
const {
  query,
  source,
  category,
  favoritesOnly,
  favorites,
  toggleFavorite,
  filteredModules,
  filteredTemplates,
  templateKind,
  templateKindOptions,
  sourceOptions,
  categoryOptions,
  insertModule,
  busyModule,
  busyTemplate,
  insertTemplate,
  clearFilters,
  error,
  notice
} = useAssetWorkbench()
const assetView = ref<AssetView>('grid')
const detailsOpen = ref(false)
const {
  open: librariesOpen,
  initialSection: libraryInitialSection,
  updateCount: libraryUpdateCount,
  openManager: openLibraries
} = useLibraryEntry(editor, libraryService)
const selectedAssetId = ref<string | null>(null)
const insertingAssetId = ref<string | null>(null)
const insertButton = {
  color: 'neutral' as const,
  variant: 'ghost' as const,
  size: 'sm' as const,
  shape: 'square' as const
}
const contextMenu = useMenuUI({ content: 'min-w-44' })
const viewOptions = computed(() => [
  { value: 'grid', label: panels.value.gridView },
  { value: 'list', label: panels.value.listView }
])
const viewUI = { root: 'w-16', item: 'px-1' }

function componentSetVariantInfo(componentSetId: string) {
  return [...editor.collectVariantOptions(componentSetId)].map(([name, values]) => ({
    name,
    values: [...values].sort((a, b) => a.localeCompare(b))
  }))
}

const graphNodes = computed(() => ({
  sceneVersion: editor.state.sceneVersion,
  nodes: [...editor.graph.nodes.values()]
}))

const assetNodes = computed(() =>
  graphNodes.value.nodes.filter(
    (node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
  )
)

const pageByNodeId = computed(() => {
  const pages = new Map<string, { id: string; name: string }>()
  for (const node of assetNodes.value) {
    const page = findAssetPage(node, editor.graph)
    if (page) pages.set(node.id, { id: page.id, name: page.name })
  }
  return pages
})

const assets = computed<LocalAsset[]>(() => {
  const local = assetNodes.value
    .filter((node) => !node.librarySource?.readOnly)
    .filter((node) => {
      if (node.type === 'COMPONENT_SET') return true
      const parent = node.parentId ? editor.graph.getNode(node.parentId) : null
      return parent?.type !== 'COMPONENT_SET'
    })
    .map((node) => {
      const defaultVariant =
        node.type === 'COMPONENT_SET' ? editor.getDefaultVariantForComponentSet(node.id) : node
      const conflicts =
        node.type === 'COMPONENT_SET' ? editor.getComponentSetVariantConflicts(node.id) : []
      const variants = node.type === 'COMPONENT_SET' ? componentSetVariantInfo(node.id) : []
      const page = pageByNodeId.value.get(node.id)
      return {
        id: node.id,
        name: node.name,
        node,
        componentId: defaultVariant?.id ?? null,
        variants,
        variantCount: node.type === 'COMPONENT_SET' ? node.childIds.length : 0,
        hasConflicts: conflicts.length > 0,
        sourceLibraryKey: node.sourceLibraryKey,
        description: node.symbolDescription,
        docsURL: node.symbolLinks[0]?.uri ?? null,
        libraryId: null,
        revisionId: null,
        assetKey: null,
        libraryName: null,
        pageId: page?.id ?? editor.state.currentPageId,
        pageName: page?.name ?? panels.value.page
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const remote = remoteAssets.value.map(({ libraryId, libraryName, revisionId, asset }) => ({
    id: `${libraryId}:${asset.key}`,
    name: asset.name,
    node: createDefaultNode(() => asset.sourceNodeId, asset.type, {
      name: asset.name,
      symbolDescription: asset.description,
      sourceLibraryKey: asset.key
    }),
    componentId: null,
    variants: [],
    variantCount: 0,
    hasConflicts: false,
    sourceLibraryKey: asset.key,
    description: asset.description,
    docsURL: null,
    libraryId,
    revisionId,
    assetKey: asset.key,
    libraryName,
    pageId: `library:${libraryId}`,
    pageName: libraryName
  }))
  return [...local, ...remote]
})

function favoriteKey(asset: LocalAsset): string {
  const binding = editor.getStorageBinding()
  const documentKey = binding
    ? JSON.stringify([binding.providerId, binding.profileId, binding.documentId])
    : (editor.getDocumentPath() ?? editor.getRecoveryId())
  return componentAssetKey(documentKey, asset.id, asset.libraryId, asset.assetKey)
}

const filteredAssets = computed(() =>
  assets.value.filter((asset) => {
    if (source.value === 'plugin' || source.value === 'template') return false
    if (source.value === 'local' && asset.libraryId) return false
    if (source.value === 'library' && !asset.libraryId) return false
    if (category.value !== 'all' && category.value !== 'components') return false
    if (favoritesOnly.value && !favorites.value.keys.has(favoriteKey(asset))) return false
    return matchesAssetQuery(
      query.value,
      asset.name,
      asset.description,
      asset.libraryName,
      asset.pageName
    )
  })
)

const assetGroups = computed<AssetGroup[]>(() => {
  const groups = new Map<string, AssetGroup>()
  for (const asset of filteredAssets.value) {
    const group = groups.get(asset.pageId) ?? {
      pageId: asset.pageId,
      pageName: asset.pageName,
      assets: []
    }
    group.assets.push(asset)
    groups.set(asset.pageId, group)
  }
  return [...groups.values()].sort((a, b) => a.pageName.localeCompare(b.pageName))
})

const selectedAsset = computed(
  () => assets.value.find((asset) => asset.id === selectedAssetId.value) ?? null
)

onMounted(() => {
  void libraryService.refresh(editor).catch(() => {
    error.value = panels.value.assetLibraryLoadFailed
  })
})

function openDetails(asset: LocalAsset) {
  selectedAssetId.value = asset.id
  detailsOpen.value = true
}

function insertionPoint(component: SceneNode, parentId: string) {
  const canvasCenter = editor.viewportCanvasCenter()
  const center = editor.screenToCanvas(canvasCenter.x, canvasCenter.y)
  const parentOffset =
    parentId === editor.state.currentPageId
      ? { x: 0, y: 0 }
      : editor.graph.getAbsolutePosition(parentId)
  return {
    x: center.x - parentOffset.x - component.width / 2,
    y: center.y - parentOffset.y - component.height / 2
  }
}

async function insertAsset(asset: LocalAsset): Promise<boolean> {
  if (insertingAssetId.value || busyModule.value || busyTemplate.value) return false
  const isCurrent = captureAssetTarget(() => ({
    graph: editor.graph,
    pageId: editor.state.currentPageId,
    parentId: editor.state.enteredContainerId,
    sourceIdentity: editor.getSourceIdentity()
  }))
  insertingAssetId.value = asset.id
  error.value = ''
  notice.value = ''
  try {
    let componentId = asset.componentId
    if (!componentId && asset.libraryId && asset.revisionId && asset.assetKey) {
      const libraryId = asset.libraryId
      const current = () =>
        isCurrent() && editor.graph.enabledLibraries.get(libraryId)?.enabled === true
      const result = await libraryService.materialize(
        editor,
        libraryId,
        asset.revisionId,
        asset.assetKey,
        () => {
          if (!current()) throw new Error(panels.value.assetTargetChanged)
        }
      )
      componentId = result.componentId
    }
    if (!isCurrent()) throw new Error(panels.value.assetTargetChanged)
    const component = componentId ? editor.graph.getNode(componentId) : null
    if (!component) throw new Error(panels.value.assetTargetChanged)
    const parentId = editor.state.enteredContainerId ?? editor.state.currentPageId
    const point = insertionPoint(component, parentId)
    editor.createInstanceFromComponent(component.id, point.x, point.y, parentId)
    editor.requestRender()
    notice.value = panels.value.assetInsertedHint
    return true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    return false
  } finally {
    insertingAssetId.value = null
  }
}

function onDragStart(event: DragEvent, asset: LocalAsset) {
  if (!event.dataTransfer || !asset.componentId) return
  event.dataTransfer.setData('application/x-openpencil-component', asset.componentId)
  event.dataTransfer.effectAllowed = 'copy'
}

function focusAsset(asset: LocalAsset) {
  if (asset.libraryId) return
  void editor.focusComponent(asset.id)
}

function onAssetKeydown(event: KeyboardEvent, asset: LocalAsset) {
  if ((event.metaKey || event.ctrlKey) && event.code === 'Enter') {
    event.preventDefault()
    openDetails(asset)
    return
  }
  if (event.code === 'Enter' || event.code === 'Space') {
    event.preventDefault()
    void insertAsset(asset)
  }
}

async function insertSelectedAsset() {
  if (!selectedAsset.value) return
  if (await insertAsset(selectedAsset.value)) detailsOpen.value = false
}

function insertTemplateAsset(id: ComponentTemplateId) {
  if (insertingAssetId.value) return
  insertTemplate(id)
}

const hasNoResults = computed(
  () =>
    !filteredAssets.value.length && !filteredModules.value.length && !filteredTemplates.value.length
)
</script>

<template>
  <section data-test-id="assets-panel" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex shrink-0 items-center justify-between gap-2 px-2 pt-2">
      <h2 class="text-xs font-medium text-surface">{{ panels.assetWorkbench }}</h2>
      <DesignBriefLauncher />
    </div>
    <div class="flex shrink-0 items-center gap-2 px-2 py-2">
      <AppInput
        v-model="query"
        type="search"
        data-test-id="assets-search"
        size="sm"
        class="min-w-0 flex-1"
        :placeholder="panels.assetSearch"
        :aria-label="panels.assetSearch"
      />
    </div>
    <div class="flex shrink-0 items-center justify-between gap-2 px-2 pb-2">
      <AppButton
        v-bind="insertButton"
        class="relative"
        :aria-label="libraryUpdateCount > 0 ? panels.reviewLibraryUpdates : panels.manageLibraries"
        @click="openLibraries"
      >
        <icon-lucide-library class="size-3.5" />
        <span
          v-if="libraryUpdateCount > 0"
          class="absolute top-0.5 right-0.5 min-w-2.5 rounded-full bg-accent px-0.5 text-center text-[8px] leading-2.5 text-white"
        >
          {{ libraryUpdateCount }}
        </span>
      </AppButton>
      <SegmentedControl
        v-model="assetView"
        data-test-id="assets-view-toggle"
        :options="viewOptions"
        :label="panels.assetView"
        :ui="viewUI"
      >
        <template #option="{ option }">
          <icon-lucide-layout-grid v-if="option.value === 'grid'" class="size-3" />
          <icon-lucide-list v-else class="size-3" />
        </template>
      </SegmentedControl>
    </div>

    <div class="flex shrink-0 flex-col gap-2 px-2 pb-2">
      <AppSelect
        v-model="source"
        :options="sourceOptions"
        :label="panels.assetSource"
        class="w-full min-w-0"
      />
      <AppSelect
        v-if="source === 'template'"
        v-model="templateKind"
        :options="templateKindOptions"
        :label="panels.assetTemplateKind"
        class="w-full min-w-0"
      />
      <div class="flex min-w-0 gap-1">
        <AppSelect
          v-model="category"
          :options="categoryOptions"
          :label="panels.assetCategory"
          class="min-w-0 flex-1"
        />
        <AppButton
          color="neutral"
          variant="ghost"
          size="sm"
          shape="square"
          :aria-label="panels.assetFavoritesOnly"
          :aria-pressed="favoritesOnly"
          @click="favoritesOnly = !favoritesOnly"
        >
          <icon-lucide-star class="size-3.5" :fill="favoritesOnly ? 'currentColor' : 'none'" />
        </AppButton>
      </div>
      <p v-if="favorites.persistenceFailed" role="alert" class="text-[11px] text-warning">
        {{ panels.assetFavoritesStorageFailed }}
      </p>
      <AppAlert v-if="error" tone="error" :heading="error" />
      <p v-else-if="notice" role="status" class="text-[11px] text-muted">{{ notice }}</p>
    </div>
    <div class="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
      <section v-for="group in assetGroups" :key="group.pageId" class="mb-3">
        <h2 class="mb-1 px-1 text-[10px] font-medium tracking-wide text-muted uppercase">
          {{ group.pageName }}
        </h2>
        <div :class="assetView === 'grid' ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-0.5'">
          <ContextMenuRoot v-for="asset in group.assets" :key="asset.id">
            <ContextMenuTrigger as-child>
              <div
                role="button"
                tabindex="0"
                data-test-id="asset-item"
                :data-asset-id="asset.id"
                :data-asset-view="assetView"
                :draggable="!!asset.componentId"
                :aria-busy="insertingAssetId === asset.id"
                :class="[
                  'group/asset rounded text-left text-xs text-surface outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent',
                  assetView === 'grid'
                    ? 'flex min-w-0 flex-col items-center gap-1 p-1.5'
                    : 'flex w-full flex-col items-stretch gap-1 px-1.5 py-1'
                ]"
                @click="openDetails(asset)"
                @keydown="onAssetKeydown($event, asset)"
                @dragstart="onDragStart($event, asset)"
              >
                <div
                  class="flex w-full min-w-0 items-center gap-2 group-data-[asset-view=grid]/asset:flex-col"
                >
                  <AssetThumbnail
                    v-if="asset.componentId"
                    :node-id="asset.componentId"
                    :alt="`${asset.name} preview`"
                    :size="
                      assetView === 'grid' ? ASSET_GRID_THUMBNAIL_SIZE : ASSET_LIST_THUMBNAIL_SIZE
                    "
                  />
                  <component
                    :is="nodeIcon(asset.node)"
                    v-else
                    class="size-4 shrink-0 text-component"
                    aria-hidden="true"
                  />
                  <span :class="assetView === 'grid' ? 'w-full min-w-0' : 'min-w-0 flex-1'">
                    <span class="flex min-w-0 items-center gap-1">
                      <span data-test-id="asset-name" class="truncate">{{ asset.name }}</span>
                      <span
                        v-if="asset.sourceLibraryKey"
                        data-test-id="asset-library-badge"
                        class="shrink-0 rounded bg-component/15 px-1 py-px text-[9px] font-medium text-component uppercase"
                      >
                        {{ panels.assetLibraryBadge }}
                      </span>
                    </span>
                    <span
                      v-if="assetView === 'list' && asset.variants.length > 0"
                      data-test-id="asset-variant-summary"
                      class="mt-0.5 block truncate text-[10px] text-muted"
                    >
                      {{
                        panels.assetVariantSummary({
                          count: asset.variantCount,
                          names: asset.variants.map((variant) => variant.name).join(', ')
                        })
                      }}
                    </span>
                    <span
                      v-if="assetView === 'list' && asset.description"
                      data-test-id="asset-description"
                      class="mt-0.5 block truncate text-[10px] text-muted"
                    >
                      {{ asset.description }}
                    </span>
                    <span
                      v-if="assetView === 'list' && asset.hasConflicts"
                      data-test-id="asset-variant-conflict"
                      class="mt-0.5 block truncate text-[10px] text-[var(--color-warning-text)]"
                    >
                      {{ panels.duplicateVariantValues }}
                    </span>
                  </span>
                </div>
                <div class="flex w-full items-center justify-end gap-1">
                  <AppButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    shape="square"
                    :aria-label="
                      favorites.keys.has(favoriteKey(asset))
                        ? panels.assetRemoveFavorite
                        : panels.assetAddFavorite
                    "
                    :aria-pressed="favorites.keys.has(favoriteKey(asset))"
                    @pointerdown.stop
                    @click.stop="toggleFavorite(favoriteKey(asset))"
                    @keydown.stop
                  >
                    <icon-lucide-star
                      class="size-3.5"
                      :fill="favorites.keys.has(favoriteKey(asset)) ? 'currentColor' : 'none'"
                    />
                  </AppButton>
                  <div v-if="assetView === 'list'" class="flex shrink-0 items-center">
                    <Tip v-if="asset.docsURL" :label="panels.openDocumentation">
                      <AppButton
                        v-bind="insertButton"
                        data-test-id="asset-docs"
                        :aria-label="panels.openDocumentation"
                        @keydown.stop
                        @pointerdown.stop
                        @click.stop="asset.docsURL ? openExternalLink(asset.docsURL) : undefined"
                      >
                        <icon-lucide-book-open class="size-3" />
                      </AppButton>
                    </Tip>
                    <Tip :label="commands.createInstance">
                      <AppButton
                        v-bind="insertButton"
                        data-test-id="asset-insert"
                        :aria-label="commands.createInstance"
                        @keydown.stop
                        :disabled="insertingAssetId === asset.id"
                        @pointerdown.stop
                        @click.stop="insertAsset(asset)"
                      >
                        <icon-lucide-plus class="size-3" />
                      </AppButton>
                    </Tip>
                  </div>
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuPortal>
              <ContextMenuContent :class="contextMenu.content">
                <ContextMenuItem
                  v-if="!asset.libraryId"
                  data-test-id="asset-context-go-to-main"
                  :class="contextMenu.item"
                  @select="focusAsset(asset)"
                >
                  {{ panels.goToMainComponent }}
                </ContextMenuItem>
                <ContextMenuItem
                  data-test-id="asset-context-view-details"
                  :class="contextMenu.item"
                  @select="openDetails(asset)"
                >
                  {{ panels.viewDetails }}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenuPortal>
          </ContextMenuRoot>
        </div>
      </section>

      <ComponentTemplateAssets
        :items="filteredTemplates"
        :favorites="favorites.keys"
        :busy="!!busyModule || !!busyTemplate || !!insertingAssetId"
        @favorite="toggleFavorite"
        @insert="insertTemplateAsset"
        @plugins="openSettingsDialog('plugins')"
      />
      <PluginModuleAssets
        :items="filteredModules"
        :favorites="favorites.keys"
        :busy="!!busyModule || !!busyTemplate || !!insertingAssetId"
        @favorite="toggleFavorite"
        @insert="insertModule"
      />
      <AppPlaceholder
        v-if="hasNoResults"
        data-test-id="assets-empty"
        :label="favoritesOnly ? panels.assetNoFavorites : panels.assetNoResults"
        size="compact"
      >
        <template #icon>
          <icon-lucide-component class="size-4" />
        </template>
      </AppPlaceholder>
      <div v-if="hasNoResults" class="flex flex-col gap-2 pb-2">
        <p class="text-center text-[11px] text-muted">
          {{ favoritesOnly ? panels.assetFavoritesHint : panels.assetEmptyHint }}
        </p>
        <AppButton color="neutral" variant="outline" size="sm" @click="clearFilters">{{
          panels.assetClearFilters
        }}</AppButton>
      </div>
      <div class="mt-auto flex flex-wrap gap-1 border-t border-border pt-2">
        <AppButton color="neutral" variant="ghost" size="sm" @click="openLibraries">{{
          panels.manageLibraries
        }}</AppButton>
        <AppButton
          color="neutral"
          variant="ghost"
          size="sm"
          @click="openSettingsDialog('plugins')"
          >{{ dialogs.settingsPlugins }}</AppButton
        >
      </div>
    </div>

    <LibraryManagerDialog v-model="librariesOpen" :initial-section="libraryInitialSection" />

    <AssetDetailsDialog
      v-model:open="detailsOpen"
      :asset="selectedAsset"
      :busy="!!insertingAssetId"
      :error="error"
      @insert="insertSelectedAsset"
    />
  </section>
</template>
