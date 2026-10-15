<script setup lang="ts">
import { isAutoLayoutMode } from '@open-pencil/scene-graph'
import { LayoutControlsRoot, useI18n } from '@open-pencil/vue'

import ClipContentControl from '@/components/properties/layout/ClipContentControl.vue'
import FlexControls from '@/components/properties/layout/flex/FlexControls.vue'
import GridControls from '@/components/properties/layout/grid/GridControls.vue'
import LayoutFlowControl from '@/components/properties/layout/LayoutFlowControl.vue'
import LayoutWrapToggle from '@/components/properties/layout/LayoutWrapToggle.vue'
import PaddingControls from '@/components/properties/layout/padding/PaddingControls.vue'
import ParentLayoutControl from '@/components/properties/layout/ParentLayoutControl.vue'
import SizeControls from '@/components/properties/layout/size/SizeControls.vue'
import TextResizingControl from '@/components/properties/layout/TextResizingControl.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'
import AppSwitch from '@/components/ui/toggle/AppSwitch.vue'

const { panels } = useI18n()

const CONTAINER_TYPES = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'FORM', 'LIST']
</script>

<template>
  <LayoutControlsRoot v-slot="ctx">
    <template v-if="ctx.node">
      <PanelSection
        :label="CONTAINER_TYPES.includes(ctx.node.type) ? panels.autoLayout : panels.layout"
        :ui="{ actions: 'w-auto' }"
      >
        <template v-if="CONTAINER_TYPES.includes(ctx.node.type)" #actions>
          <AppSwitch
            :label="panels.autoLayout"
            :model-value="isAutoLayoutMode(ctx.node.layoutMode)"
            @update:model-value="
              ctx.editor.setLayoutMode(ctx.node.id, $event ? 'VERTICAL' : 'NONE')
            "
          />
        </template>

        <LayoutFlowControl v-if="CONTAINER_TYPES.includes(ctx.node.type)">
          <LayoutWrapToggle v-if="ctx.isFlex" />
        </LayoutFlowControl>
        <div v-if="ctx.node.type !== 'TEXT'" class="mt-2 mb-1 text-[11px] text-muted">
          {{ panels.dimensions }}
        </div>
        <TextResizingControl v-if="ctx.node.type === 'TEXT'" />
        <SizeControls />
        <ParentLayoutControl />
        <ClipContentControl
          v-if="CONTAINER_TYPES.includes(ctx.node.type) && !isAutoLayoutMode(ctx.node.layoutMode)"
        />

        <template
          v-if="CONTAINER_TYPES.includes(ctx.node.type) && isAutoLayoutMode(ctx.node.layoutMode)"
        >
          <FlexControls v-if="ctx.isFlex" />
          <template v-if="ctx.isGrid">
            <GridControls />
            <PaddingControls />
            <ClipContentControl />
          </template>
        </template>
      </PanelSection>
    </template>
  </LayoutControlsRoot>
</template>
