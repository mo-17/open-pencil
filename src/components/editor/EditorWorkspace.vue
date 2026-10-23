<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import { tv } from 'tailwind-variants'
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'

import { formatShortcut, useI18n, useViewportKind } from '@open-pencil/vue'

import { getActiveEditorStore, provideTabEditorStore } from '@/app/editor/active-store'
import { compilerPreviewPopoutOpen } from '@/app/lowcode/preview-pane/popout/session'
import PreviewPane from '@/app/lowcode/preview-pane/PreviewPane.vue'
import {
  expireWebPreviewWidthRequest,
  setWebPreviewWidthAvailability,
  useWebPreviewWidthRequest
} from '@/app/lowcode/preview-pane/viewport/request'
import { appRuntimeConfig } from '@/app/runtime/config'
import {
  editorPanelDefaultSizes,
  loadEditorLayout,
  previewPanelDefaultSize,
  saveEditorLayout
} from '@/app/shell/layout-storage'
import { appMenuShortcut } from '@/app/shell/menu/shortcut'
import type { Tab } from '@/app/tabs'
import CanvasSplitRoot from '@/components/canvas/CanvasSplitRoot.vue'
import CollabPanel from '@/components/collab-panel/CollabPanel.vue'
import ActiveRoomOverlay from '@/components/collab-room/ActiveRoomOverlay.vue'
import { useRoomActions } from '@/components/collab-room/useRoomActions'
import CommentDeleteDialog from '@/components/comments/CommentDeleteDialog.vue'
import EditorCanvas from '@/components/EditorCanvas.vue'
import LayersPanel from '@/components/LayersPanel.vue'
import MobileDrawer from '@/components/MobileDrawer.vue'
import MobileHud from '@/components/MobileHud/MobileHud.vue'
import PropertiesPanel from '@/components/PropertiesPanel.vue'
import Toolbar from '@/components/toolbar/Toolbar.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import VariablesDialog from '@/components/variables/VariablesDialog.vue'
import splitterTheme from '@/theme/splitter'

import ShaderPreviewStatus from './ShaderPreviewStatus.vue'
import WorkspacePill from './WorkspacePill.vue'

const showChrome = appRuntimeConfig.showChrome
/**
 * The document tab this workspace edits. WorkspaceView keys the workspace by tab, so the tab and
 * its store are fixed for its lifetime, and its editor UI stays bound to that document rather
 * than following the active tab to the next document when this one closes.
 */
const { tab } = defineProps<{ tab: Tab }>()
const store = tab.store
provideTabEditorStore(store)
const { isMobile } = useViewportKind()
const widthRequests = useWebPreviewWidthRequest(getActiveEditorStore)
watch(
  () => [getActiveEditorStore(), isMobile.value, store.state.showUI] as const,
  ([owner, mobile, showUI], previous) => {
    if (previous && previous[0] !== owner) setWebPreviewWidthAvailability(owner, null)
    if (mobile || !showChrome || !showUI) setWebPreviewWidthAvailability(owner, false)
    else if (previous && (previous[1] || !previous[2])) setWebPreviewWidthAvailability(owner, null)
  },
  { immediate: true, flush: 'sync' }
)
onScopeDispose(() => expireWebPreviewWidthRequest(getActiveEditorStore()))
const showPreviewPane = true
const editorLayout = ref(loadEditorLayout())
const previewSize = computed(() => previewPanelDefaultSize(editorLayout.value))
const editorPanelSizes = computed(() =>
  editorPanelDefaultSizes(editorLayout.value, showPreviewPane)
)
const horizontalSplitterStyles = tv(splitterTheme)({ direction: 'horizontal' })

function handleEditorLayout(layout: number[]): void {
  editorLayout.value = [...layout]
  saveEditorLayout(layout)
}

function expandPreviewForAction(expand: () => void, complete: () => void): void {
  expand()
  void nextTick(complete)
}
/** One canvas previewing takes the whole window, in the canvas-only layout; split view keeps panels. */
const playingAlone = computed(() => store.state.play !== null && store.visiblePaneCount.value <= 1)
const { editor } = useI18n()
// Until a room's document arrives there is nothing to edit, so its screen replaces the editor.
const { pending: roomPending } = useRoomActions()
</script>

<template>
  <div v-if="roomPending" :key="'room-' + tab.id" class="relative flex flex-1 overflow-hidden">
    <ActiveRoomOverlay />
  </div>

  <SplitterGroup
    v-else-if="!isMobile && showChrome && store.state.showUI && !playingAlone"
    :key="tab.id"
    direction="horizontal"
    class="flex-1 overflow-hidden"
    @layout="handleEditorLayout"
  >
    <SplitterPanel
      id="layers"
      :default-size="editorPanelSizes[0]"
      :min-size="10"
      :max-size="30"
      class="flex"
    >
      <LayersPanel />
    </SplitterPanel>
    <SplitterResizeHandle
      data-test-id="left-splitter-handle"
      :class="horizontalSplitterStyles.handle()"
    >
      <div :class="horizontalSplitterStyles.divider()" />
    </SplitterResizeHandle>
    <SplitterPanel id="canvas" :default-size="editorPanelSizes[1]" :min-size="30" class="flex">
      <div class="relative flex min-w-0 flex-1">
        <CanvasSplitRoot />
        <ActiveRoomOverlay />
        <Toolbar />
      </div>
    </SplitterPanel>
    <SplitterResizeHandle :class="horizontalSplitterStyles.handle()">
      <div :class="horizontalSplitterStyles.divider()" />
    </SplitterResizeHandle>
    <SplitterPanel
      id="properties"
      :default-size="editorPanelSizes[2]"
      :min-size="10"
      :max-size="30"
      class="flex flex-col"
    >
      <div class="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1.5">
        <CollabPanel class="min-w-0 flex-1" />
        <IconButton
          :label="
            editor.startPreview({
              shortcut: formatShortcut(appMenuShortcut('toggle-preview')) ?? ''
            })
          "
          data-test-id="editor-start-preview"
          @click="store.startPlay()"
        >
          <icon-lucide-play class="size-3.5" />
        </IconButton>
      </div>
      <PropertiesPanel />
    </SplitterPanel>
    <template v-if="showPreviewPane">
      <SplitterResizeHandle class="group relative z-10 -mx-1 w-2 cursor-col-resize">
        <div class="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2" />
      </SplitterResizeHandle>
      <SplitterPanel
        id="lowcode-preview"
        :default-size="previewSize"
        :min-size="12"
        :max-size="50"
        :collapsed-size="2"
        collapsible
        class="flex"
      >
        <template #default="{ isCollapsed, collapse, expand }">
          <div
            v-if="isCollapsed"
            class="flex min-w-0 flex-1 flex-col items-center border-l border-border bg-panel pt-2"
          >
            <IconButton
              label="Open compiler preview"
              data-test-id="lowcode-preview-open"
              aria-controls="lowcode-preview-pane"
              :aria-expanded="false"
              @click="expand"
            >
              <icon-lucide-panel-right-open class="size-4" />
            </IconButton>
          </div>
          <PreviewPane
            v-if="!isCollapsed || compilerPreviewPopoutOpen || widthRequests.pending.value"
            :embedded-visible="!isCollapsed"
            @close="collapse"
            @request-expand="expandPreviewForAction(expand, $event)"
          />
        </template>
      </SplitterPanel>
    </template>
  </SplitterGroup>

  <div
    v-else-if="isMobile && showChrome && store.state.showUI"
    :key="'mobile-' + tab.id"
    class="flex flex-1 overflow-hidden"
  >
    <div class="relative flex min-w-0 flex-1">
      <EditorCanvas />
      <ActiveRoomOverlay />
      <MobileHud />
      <ShaderPreviewStatus v-if="store.state.play" />
      <Toolbar />
    </div>
    <MobileDrawer />
  </div>

  <div v-else-if="showChrome" :key="'collapsed-' + tab.id" class="flex flex-1 overflow-hidden">
    <div class="relative flex min-w-0 flex-1">
      <EditorCanvas />
      <ActiveRoomOverlay />
      <ShaderPreviewStatus v-if="playingAlone" />
      <WorkspacePill
        v-if="!isMobile && playingAlone"
        mode="preview"
        :document-name="store.state.documentName"
        :shortcut="formatShortcut(appMenuShortcut('toggle-preview')) ?? ''"
        @reset="store.resetPlay()"
        @leave="store.stopPlay()"
      />
      <WorkspacePill
        v-else-if="!isMobile"
        mode="collapsed"
        :document-name="store.state.documentName"
        :shortcut="formatShortcut(appMenuShortcut('toggle-ui')) ?? ''"
        @show-ui="store.state.showUI = true"
      />
    </div>
  </div>

  <div v-else :key="'bare-' + tab.id" class="flex flex-1 overflow-hidden">
    <div class="relative flex min-w-0 flex-1">
      <EditorCanvas />
      <ActiveRoomOverlay />
    </div>
  </div>

  <VariablesDialog />
  <CommentDeleteDialog />
</template>
