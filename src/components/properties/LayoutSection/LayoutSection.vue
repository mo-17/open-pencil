<script setup lang="ts">
import { LayoutControlsRoot, useI18n } from '@open-pencil/vue'

import AutoLayoutControls from '@/components/properties/LayoutSection/AutoLayoutControls.vue'
import ClipContentControl from '@/components/properties/LayoutSection/ClipContentControl.vue'
import FlexControls from '@/components/properties/LayoutSection/FlexControls.vue'
import GridControls from '@/components/properties/LayoutSection/GridControls.vue'
import LayoutGridSection from '@/components/properties/LayoutSection/LayoutGridSection.vue'
import IconButton from '@/components/ui/IconButton.vue'
import PaddingControls from '@/components/properties/LayoutSection/PaddingControls.vue'
import SizeControls from '@/components/properties/LayoutSection/size/SizeControls.vue'
import TextResizingControl from '@/components/properties/LayoutSection/TextResizingControl.vue'
import SharedStyleField from '@/components/properties/shared-style/SharedStyleField.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'

const { panels } = useI18n()

const CONTAINER_TYPES = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE']
</script>

<template>
  <LayoutControlsRoot v-slot="ctx">
    <template v-if="ctx.node">
      <PanelSection :label="panels.layout">
        <SharedStyleField kind="grid" :label="panels.gridStyle" />
        <TextResizingControl v-if="ctx.node.type === 'TEXT'" />
        <SizeControls />
      </PanelSection>

      <template v-if="CONTAINER_TYPES.includes(ctx.node.type)">
        <PanelSection :label="panels.autoLayout">
          <template #actions>
            <IconButton
              v-if="ctx.node.layoutMode === 'NONE'"
              :label="panels.addAutoLayout"
              @click="ctx.editor.setLayoutMode(ctx.node.id, 'VERTICAL')"
            >
              <icon-lucide-plus class="size-3.5" />
            </IconButton>
            <IconButton
              v-else
              :label="panels.removeAutoLayout"
              @click="ctx.editor.setLayoutMode(ctx.node.id, 'NONE')"
            >
              <icon-lucide-minus class="size-3.5" />
            </IconButton>
          </template>

          <AutoLayoutControls />

          <!-- Phase 2 §6: FREE has no flex/grid/padding controls (no
               auto-layout); fall through with the existing isFlex /
               isGrid gates which now both return false for FREE. -->
          <template v-if="ctx.isFlex || ctx.isGrid">
            <FlexControls v-if="ctx.isFlex" />
            <template v-if="ctx.isGrid">
              <GridControls />
              <PaddingControls />
              <ClipContentControl />
            </template>
          </template>
        </PanelSection>

        <LayoutGridSection />
      </template>
    </template>
  </LayoutControlsRoot>
</template>
