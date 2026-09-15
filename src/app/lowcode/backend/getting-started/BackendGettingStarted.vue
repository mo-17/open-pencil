<script setup lang="ts">
import { tv } from 'tailwind-variants'
import { computed, ref, watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import AppButton from '@/components/ui/button/AppButton.vue'
import { AppDialogRoot, AppDialogHeader } from '@/components/ui/dialog'
import theme from '@/theme/backend-getting-started'

import type { BackendGettingStartedGuide } from './index'
import { backendGettingStartedViewCopy } from './view-copy'

type GuidePage = Pick<SceneNode, 'id' | 'name' | 'lowcodeRoutePattern'>
const { guide, pages, unsaved, busy } = defineProps<{
  guide: BackendGettingStartedGuide
  pages: readonly GuidePage[]
  unsaved: boolean
  busy: boolean
}>()
const emit = defineEmits<{
  configure: []
  modules: []
  openPage: [id: string]
}>()
const { locale } = useI18n()
const copy = computed(() => backendGettingStartedViewCopy(locale.value))
const styles = tv(theme)()
const open = ref(false)
watch(
  () => guide.applicationId,
  () => {
    open.value = false
  }
)

function configure(): void {
  if (busy) return
  open.value = false
  emit('configure')
}
function modules(): void {
  if (busy) return
  open.value = false
  emit('modules')
}
function openPage(id: string): void {
  if (busy) return
  open.value = false
  emit('openPage', id)
}
</script>

<template>
  <div :class="styles.card()" data-property="backend-getting-started">
    <p :class="styles.title()">{{ copy.title }}</p>
    <p :class="styles.paragraph()">{{ copy.description }}</p>
    <p v-if="unsaved" role="status" :class="styles.paragraph()">{{ copy.savedOnly }}</p>
    <AppButton variant="outline" :disabled="busy" @click="open = true">
      <template #leading><icon-lucide-list-checks /></template>
      {{ copy.open }}
    </AppButton>
  </div>
  <AppDialogRoot v-model:open="open" size="lg" height="tall">
    <AppDialogHeader
      :heading="copy.title"
      :description="copy.description"
      :close-label="copy.close"
    />
    <div :class="styles.body()">
      <p v-if="unsaved" role="status" :class="styles.warning()">{{ copy.unsaved }}</p>
      <p :class="styles.notice()">{{ copy.unverified }}</p>
      <section :class="styles.section()" :aria-label="copy.identity">
        <h3 :class="styles.heading()">{{ copy.identity }}</h3>
        <p :class="styles.paragraph()">{{ copy.saved }}</p>
        <dl :class="styles.fields()">
          <dt :class="styles.label()">{{ copy.issuer }}</dt>
          <dd :class="styles.value()">{{ guide.authentication.issuer }}</dd>
          <dt :class="styles.label()">{{ copy.clientId }}</dt>
          <dd :class="styles.value()">{{ guide.authentication.clientId }}</dd>
          <dt :class="styles.label()">{{ copy.callback }}</dt>
          <dd :class="styles.value()">{{ guide.authentication.callbackPath }}</dd>
        </dl>
        <h4 :class="styles.title()">{{ copy.roles }}</h4>
        <ul v-if="guide.roles.length" :class="styles.tags()">
          <li v-for="role in guide.roles" :key="role" :class="styles.tag()">{{ role }}</li>
        </ul>
        <p v-else :class="styles.paragraph()">{{ copy.noRoles }}</p>
        <p :class="styles.paragraph()">{{ copy.roleHint }}</p>
        <AppButton variant="outline" :disabled="busy" @click="configure">{{
          copy.configure
        }}</AppButton>
      </section>
      <section :class="styles.section()" :aria-label="copy.prepare">
        <h3 :class="styles.heading()">{{ copy.prepare }}</h3>
        <p :class="styles.paragraph()">{{ guide.accountSetup }}</p>
        <details v-for="module in guide.modules" :key="module.kind" :class="styles.module()">
          <summary :class="styles.summary()">{{ module.name }}</summary>
          <ol :class="styles.steps()">
            <li v-for="step in module.steps" :key="step">{{ step }}</li>
          </ol>
          <ul :class="styles.list()">
            <li v-for="boundary in module.boundaries" :key="boundary">{{ boundary }}</li>
          </ul>
        </details>
        <ul v-if="guide.boundaries.length" :class="styles.list()">
          <li v-for="boundary in guide.boundaries" :key="boundary">{{ boundary }}</li>
        </ul>
        <AppButton variant="outline" :disabled="busy || unsaved" @click="modules">{{
          copy.modules
        }}</AppButton>
      </section>
      <section :class="styles.section()" :aria-label="copy.run">
        <h3 :class="styles.heading()">{{ copy.run }}</h3>
        <p :class="styles.paragraph()">{{ copy.preview }}</p>
        <p :class="styles.paragraph()">{{ copy.export }}</p>
        <p v-if="guide.modules.length > 1" :class="styles.paragraph()">{{ copy.combined }}</p>
        <h4 :class="styles.title()">{{ copy.pages }} · {{ pages.length }}</h4>
        <p :class="styles.paragraph()">{{ copy.pagesHint }}</p>
        <div v-if="pages.length" :class="styles.pages()">
          <AppButton
            v-for="page in pages"
            :key="page.id"
            variant="outline"
            :class="styles.page()"
            :disabled="busy"
            @click="openPage(page.id)"
          >
            <span :class="styles.pageText()"
              >{{ page.name
              }}<span :class="styles.path()">{{ page.lowcodeRoutePattern }}</span></span
            >
          </AppButton>
        </div>
        <p v-else :class="styles.warning()">{{ copy.missingPages }}</p>
      </section>
    </div>
  </AppDialogRoot>
</template>
