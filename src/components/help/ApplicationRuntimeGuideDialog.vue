<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Markdown, type NodeRenderers } from 'vue-stream-markdown'
import { useI18n } from '@open-pencil/vue'
import 'vue-stream-markdown/index.css'

import APPLICATION_RUNTIME_GUIDE_SOURCE from '@/app/help/application-runtime-guide.md?raw'
import APPLICATION_RUNTIME_GUIDE_ZH_CN_SOURCE from '@/app/help/application-runtime-guide.zh-cn.md?raw'
import {
  applicationRuntimeGuideHeadings,
  applicationRuntimeGuideLanguagePreference,
  applicationRuntimeGuideOpen,
  prepareApplicationRuntimeGuideMarkdown,
  resolveApplicationRuntimeGuideLanguage,
  setApplicationRuntimeGuideLanguagePreference,
  type ApplicationRuntimeGuideLanguagePreference
} from '@/app/help/application-runtime-guide'
import ApplicationRuntimeGuideLink from '@/components/help/ApplicationRuntimeGuideLink.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { AppDialogHeader, AppDialogRoot } from '@/components/ui/dialog'

const { dialogs, menu, locale, localeLabels } = useI18n()
const guideScroller = ref<HTMLElement | null>(null)
const guideLanguagePreference = computed<ApplicationRuntimeGuideLanguagePreference>({
  get: () => applicationRuntimeGuideLanguagePreference.value,
  set: setApplicationRuntimeGuideLanguagePreference
})
const guideLanguage = computed(() =>
  resolveApplicationRuntimeGuideLanguage(guideLanguagePreference.value, locale.value)
)
const guideLanguageOptions = computed(() => [
  {
    value: 'follow-app' as const,
    label: dialogs.value.applicationRuntimeGuideFollowApp
  },
  { value: 'zh-CN' as const, label: localeLabels['zh-CN'] },
  { value: 'en' as const, label: localeLabels.en }
])
const guideSource = computed(() =>
  guideLanguage.value === 'zh-CN'
    ? APPLICATION_RUNTIME_GUIDE_ZH_CN_SOURCE
    : APPLICATION_RUNTIME_GUIDE_SOURCE
)
const guideMarkdown = computed(() =>
  prepareApplicationRuntimeGuideMarkdown(guideSource.value, guideLanguage.value)
)
const guideHeadings = computed(() => applicationRuntimeGuideHeadings(guideMarkdown.value))
const guideNodeRenderers: NodeRenderers = { link: ApplicationRuntimeGuideLink }
const offlineDescription = () =>
  dialogs.value.applicationRuntimeGuideDescription({ version: __OPENPENCIL_APP_VERSION__ })

watch(guideLanguage, async () => {
  await nextTick()
  if (guideScroller.value) guideScroller.value.scrollTop = 0
})

function onOpenChange(open: boolean): void {
  applicationRuntimeGuideOpen.value = open
}

function scrollToHeading(index: number): void {
  const elements = guideScroller.value?.querySelectorAll<HTMLElement>(
    '[data-stream-markdown="heading-2"], [data-stream-markdown="heading-3"]'
  )
  elements?.[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <AppDialogRoot
    :open="applicationRuntimeGuideOpen"
    size="xl"
    height="full"
    data-test-id="app-application-runtime-guide-dialog"
    @update:open="onOpenChange"
  >
    <AppDialogHeader
      :heading="menu.applicationRuntimeGuide"
      :description="offlineDescription()"
      :close-label="dialogs.close"
    >
      <template #actions>
        <AppSelect
          v-model="guideLanguagePreference"
          :label="menu.language"
          :options="guideLanguageOptions"
          :ui="{ trigger: 'min-w-40' }"
          data-test-id="app-application-runtime-guide-language"
        />
      </template>
    </AppDialogHeader>

    <div class="flex min-h-0 flex-1">
      <nav
        class="hidden w-60 shrink-0 overflow-y-auto border-r border-border bg-panel-secondary p-3 md:block"
        :aria-label="dialogs.applicationRuntimeGuideContents"
      >
        <p class="mb-2 text-[10px] font-semibold tracking-wide text-muted uppercase">
          {{ dialogs.applicationRuntimeGuideContents }}
        </p>
        <button
          v-for="(heading, index) in guideHeadings"
          :key="`${heading.depth}-${heading.title}`"
          type="button"
          class="block w-full rounded py-1 pr-2 text-left text-[11px] leading-4 text-muted hover:bg-hover hover:text-surface"
          :class="heading.depth === 3 ? 'pl-5' : 'pl-2 font-medium'"
          @click="scrollToHeading(index)"
        >
          {{ heading.title }}
        </button>
      </nav>

      <div ref="guideScroller" class="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <article
          :lang="guideLanguage"
          class="application-runtime-guide mx-auto max-w-4xl select-text px-5 py-6 text-sm text-surface sm:px-8"
        >
          <Markdown
            :key="guideLanguage"
            mode="static"
            :content="guideMarkdown"
            :node-renderers="guideNodeRenderers"
            :controls="false"
            :previewers="false"
            :enable-animate="false"
            :cdn-options="{
              shiki: false,
              mermaid: false,
              beautifulMermaid: false,
              katex: false
            }"
            class="stream-markdown"
          />
        </article>
      </div>
    </div>
  </AppDialogRoot>
</template>

<style scoped>
.application-runtime-guide {
  --foreground: var(--color-surface);
  --background: var(--color-panel);
  --card: var(--color-panel);
  --card-foreground: var(--color-surface);
  --popover: var(--color-panel);
  --popover-foreground: var(--color-surface);
  --primary: var(--color-accent);
  --primary-foreground: white;
  --secondary: var(--color-panel-secondary);
  --secondary-foreground: var(--color-surface);
  --muted: var(--color-panel-field);
  --muted-foreground: var(--color-muted);
  --accent: var(--color-hover);
  --accent-foreground: var(--color-surface);
  --destructive: var(--color-error);
  --border: var(--color-border);
  --input: var(--color-input);
  --ring: var(--color-accent);
}

.application-runtime-guide :deep(p) {
  margin-block: 0.65rem;
}

.application-runtime-guide :deep(blockquote) {
  border-left-color: var(--color-warning-border);
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
  padding: 0.65rem 0.9rem;
}

.application-runtime-guide :deep(pre) {
  border: 1px solid var(--color-border);
  background: var(--color-input);
}

.application-runtime-guide :deep(table) {
  min-width: 100%;
}
</style>
