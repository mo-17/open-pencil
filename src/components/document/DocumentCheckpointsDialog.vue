<script setup lang="ts">
import { useStore } from '@nanostores/vue'
import { computed, ref, watch } from 'vue'

import { checkpointMessages } from '@/app/document/checkpoints/messages'
import { CHECKPOINT_LIMITS } from '@/app/document/checkpoints/types'
import { useDocumentCheckpoints } from '@/app/document/checkpoints/use'
import { useEditorStore } from '@/app/editor/active-store'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppDialogBody from '@/components/ui/dialog/AppDialogBody.vue'
import AppDialogFooter from '@/components/ui/dialog/AppDialogFooter.vue'
import AppDialogHeader from '@/components/ui/dialog/AppDialogHeader.vue'
import AppDialogRoot from '@/components/ui/dialog/AppDialogRoot.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppPlaceholder from '@/components/ui/feedback/AppPlaceholder.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'
import { checkpointUI as ui } from '@/theme/document/checkpoints'

const open = defineModel<boolean>('open', { default: false })
const editor = useEditorStore()
const t = useStore(checkpointMessages)
const name = ref('')
const deleting = ref('')
const checkpoints = useDocumentCheckpoints(editor)
const { visible, selected, selectedEntry, difference, busy, error, saved, allDocuments } =
  checkpoints
const errorText = computed(() => {
  if (error.value === 'changed') return t.value.changedError
  if (error.value === 'invalid' || error.value === 'limit' || error.value === 'missing')
    return t.value[error.value]
  return t.value.unavailable
})

watch(
  open,
  (value) => {
    if (value) void checkpoints.load()
  },
  { immediate: true }
)

async function create() {
  if (await checkpoints.create(name.value)) name.value = ''
}
async function restore() {
  if (await checkpoints.restore(t.value.backupName)) open.value = false
}
async function remove() {
  if (await checkpoints.remove(deleting.value)) deleting.value = ''
}
</script>

<template>
  <AppDialogRoot v-model:open="open" size="lg" height="tall">
    <AppDialogHeader :heading="t.title" :description="t.description" :close-label="t.close" />
    <AppDialogBody>
      <div :class="ui.body()" :aria-busy="busy">
        <form :class="ui.form()" @submit.prevent="create">
          <label :class="ui.field()">
            {{ t.name }}
            <AppInput
              v-model="name"
              :maxlength="CHECKPOINT_LIMITS.maxNameLength"
              :disabled="busy"
            />
          </label>
          <AppButton type="submit" variant="solid" color="primary" :disabled="busy || !name.trim()">
            {{ t.create }}
          </AppButton>
        </form>
        <label :class="ui.checkbox()">
          <AppCheckbox v-model="allDocuments" :ariaLabel="t.all" :disabled="busy" />
          {{ t.all }}
        </label>
        <AppPlaceholder v-if="!visible.length" :label="t.empty" size="compact" :fill="false">
          <template #icon><icon-lucide-history class="size-5" /></template>
        </AppPlaceholder>
        <ul :class="ui.list()" :aria-label="t.title">
          <li
            v-for="entry in visible"
            :key="entry.id"
            :class="ui.row()"
            :data-selected="selected === entry.id || undefined"
          >
            <div :class="ui.metadata()">
              <p :class="ui.name()">{{ entry.name }}</p>
              <p>
                {{ entry.documentName }} · {{ new Date(entry.createdAt).toLocaleString() }} ·
                {{ Math.ceil(entry.byteLength / 1024) }} KiB
              </p>
              <p v-if="entry.kind === 'before-restore'">{{ t.beforeRestore }}</p>
            </div>
            <div :class="ui.actions()">
              <AppButton
                variant="outline"
                :disabled="busy"
                @click="checkpoints.inspect(entry.id)"
                >{{ t.inspect }}</AppButton
              >
              <AppButton :disabled="busy" @click="deleting = entry.id">{{ t.remove }}</AppButton>
            </div>
          </li>
        </ul>
        <AppAlert v-if="deleting" tone="warning" :heading="t.confirmDelete">
          <template #actions>
            <AppButton :disabled="busy" variant="outline" @click="deleting = ''">{{
              t.cancel
            }}</AppButton>
            <AppButton :disabled="busy" @click="remove">{{ t.remove }}</AppButton>
          </template>
        </AppAlert>
        <section
          v-if="selectedEntry && difference"
          :class="ui.details()"
          :aria-label="t.difference"
        >
          <h3>{{ t.difference }}: {{ selectedEntry.name }}</h3>
          <p :class="ui.summary()">
            <span>{{ t.added }} {{ difference.added }}</span>
            <span>{{ t.removed }} {{ difference.removed }}</span>
            <span>{{ t.changed }} {{ difference.changed }}</span>
          </p>
          <p v-if="difference.variables">{{ t.variables }}</p>
          <p v-if="difference.assets">{{ t.assets }}</p>
          <p v-if="difference.document">{{ t.document }}</p>
          <p
            v-if="
              !difference.added &&
              !difference.removed &&
              !difference.changed &&
              !difference.variables &&
              !difference.assets &&
              !difference.document
            "
          >
            {{ t.same }}
          </p>
          <ul :class="ui.differences()">
            <li
              v-for="node in difference.nodes"
              :key="node.id"
              :class="ui.entry()"
              :data-change-kind="node.kind"
            >
              {{ t[node.kind] }} · {{ node.name }}
              <span v-if="node.fields.length"> · {{ t.fields }}: {{ node.fields.join(', ') }}</span>
            </li>
          </ul>
          <p v-if="difference.truncated">{{ t.truncated }}</p>
          <AppAlert :heading="t.restoreHint">
            <template #actions>
              <AppButton color="primary" variant="solid" :disabled="busy" @click="restore">{{
                t.restore
              }}</AppButton>
            </template>
          </AppAlert>
        </section>
        <AppAlert v-if="error" tone="error" :heading="errorText" />
        <AppAlert v-else-if="saved" tone="success" :heading="t.saved" />
        <p :class="ui.note()">{{ t.limits }}</p>
      </div>
    </AppDialogBody>
    <AppDialogFooter>
      <AppButton variant="outline" @click="open = false">{{ t.close }}</AppButton>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
