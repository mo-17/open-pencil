<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { tv } from 'tailwind-variants'
import { useUrlSearchParams } from '@vueuse/core'
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'

import { formatShortcut, useI18n, useViewportKind } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import PreviewPane from '@/app/lowcode/preview-pane/PreviewPane.vue'
import { compilerPreviewPopoutOpen } from '@/app/lowcode/preview-pane/popout/session'
import {
  editorPanelDefaultSizes,
  loadEditorLayout,
  previewPanelDefaultSize,
  saveEditorLayout
} from '@/app/shell/layout-storage'
import { appMenuShortcut } from '@/app/shell/menu/shortcut'
import { activeTab } from '@/app/tabs'
import CanvasSplitRoot from '@/components/canvas/CanvasSplitRoot.vue'
import CollabPanel from '@/components/CollabPanel/CollabPanel.vue'
import EditorCanvas from '@/components/EditorCanvas.vue'
import LayersPanel from '@/components/LayersPanel.vue'
import MobileDrawer from '@/components/MobileDrawer.vue'
import MobileHud from '@/components/MobileHud/MobileHud.vue'
import PropertiesPanel from '@/components/PropertiesPanel.vue'
import Tip from '@/components/ui/Tip.vue'
import Toolbar from '@/components/Toolbar/Toolbar.vue'
import splitterTheme from '@/theme/splitter'

const params = useUrlSearchParams('history')
const showChrome = !('no-chrome' in params)
const store = useEditorStore()
const { dialogs } = useI18n()
const { isMobile } = useViewportKind()
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
</script>

<template>
  <SplitterGroup
    v-if="!isMobile && showChrome && store.state.showUI"
    :key="activeTab?.id"
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
      <div class="flex shrink-0 items-center justify-between border-b border-border px-1.5 py-1.5">
        <CollabPanel />
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
            <Tip label="Open compiler preview">
              <button
                type="button"
                data-test-id="lowcode-preview-open"
                aria-label="Open compiler preview"
                aria-controls="lowcode-preview-pane"
                :aria-expanded="false"
                class="flex size-7 cursor-pointer items-center justify-center rounded text-muted outline-none transition-colors hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
                @click="expand"
              >
                <icon-lucide-panel-right-open class="size-4" />
              </button>
            </Tip>
          </div>
          <PreviewPane
            v-if="!isCollapsed || compilerPreviewPopoutOpen"
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
    :key="'mobile-' + activeTab?.id"
    class="flex flex-1 overflow-hidden"
  >
    <div class="relative flex min-w-0 flex-1">
      <EditorCanvas />
      <MobileHud />
      <Toolbar />
    </div>
    <MobileDrawer />
  </div>

  <div
    v-else-if="showChrome"
    :key="'collapsed-' + activeTab?.id"
    class="flex flex-1 overflow-hidden"
  >
    <div class="relative flex min-w-0 flex-1">
      <EditorCanvas />
      <div
        v-if="!isMobile"
        class="absolute top-7 left-7 z-10 flex items-center gap-2 rounded-lg border border-border bg-panel px-2 py-1 shadow-sm"
      >
        <img src="/favicon-32.png" class="size-4" alt="OpenPencil" />
        <span data-test-id="editor-document-name" class="text-xs text-surface">{{
          store.state.documentName
        }}</span>
        <Tip
          :label="dialogs.showUI({ shortcut: formatShortcut(appMenuShortcut('toggle-ui')) ?? '' })"
        >
          <button
            data-test-id="editor-show-ui"
            class="ml-1 flex size-6 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-hover hover:text-surface"
            @click="store.state.showUI = true"
          >
            <icon-lucide-sidebar class="size-3.5" />
          </button>
        </Tip>
      </div>
    </div>
  </div>

  <div v-else :key="'bare-' + activeTab?.id" class="flex flex-1 overflow-hidden">
    <div class="relative flex min-w-0 flex-1">
      <EditorCanvas />
    </div>
  </div>
</template>
