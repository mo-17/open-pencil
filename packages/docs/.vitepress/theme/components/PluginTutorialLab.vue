<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

import documentSummaryManifest from '#docs-examples/third-party-plugin/document-summary/manifest.payload.json'
import nodeTypeCounterManifest from '#docs-examples/third-party-plugin/node-type-counter/manifest.payload.json'
import styleUsageManifest from '#docs-examples/third-party-plugin/style-usage/manifest.payload.json'
import variableOverviewManifest from '#docs-examples/third-party-plugin/variable-overview/manifest.payload.json'

interface TutorialExample {
  id: string
  order: string
  name: string
  level: string
  focus: string
  summary: string
  directory: string
  permissions: readonly string[]
  parameters: string
  result: string
  commandContribution: string
}

interface ExampleManifest {
  contributions: {
    commands?: readonly unknown[]
  }
}

function commandContribution(manifest: ExampleManifest): string {
  const command = manifest.contributions.commands?.[0]
  if (!command) throw new TypeError('Tutorial example manifest must contain one command')
  return JSON.stringify(command, null, 2)
}

const examples: readonly TutorialExample[] = Object.freeze([
  {
    id: 'document-summary',
    order: '01',
    name: 'Document Summary',
    level: '起步',
    focus: '最小完整流程',
    summary: '从公开页面开始遍历，只返回页面、节点与当前选中数量。',
    directory: 'examples/third-party-plugin/document-summary',
    permissions: ['document.read', 'document.selection.read'],
    parameters: '空对象，不接受额外字段',
    result: 'pageCount · nodeCount · selectedNodeCount',
    commandContribution: commandContribution(documentSummaryManifest)
  },
  {
    id: 'node-type-counter',
    order: '02',
    name: 'Node Type Counter',
    level: '参数',
    focus: '封闭枚举输入',
    summary: '用可选的 nodeType 枚举过滤公开节点，省略时统计全部节点。',
    directory: 'examples/third-party-plugin/node-type-counter',
    permissions: ['document.read'],
    parameters: 'nodeType?: ALL | FRAME | TEXT | RECTANGLE',
    result: 'nodeType · matchingNodeCount',
    commandContribution: commandContribution(nodeTypeCounterManifest)
  },
  {
    id: 'style-usage',
    order: '03',
    name: 'Style Usage',
    level: '遍历',
    focus: '隐私安全聚合',
    summary: '跳过内部子树，只统计启用的 fill、stroke 与 effect 条目。',
    directory: 'examples/third-party-plugin/style-usage',
    permissions: ['document.read'],
    parameters: '空对象，不接受额外字段',
    result: 'nodeCount · visibleFillCount · visibleStrokeCount · visibleEffectCount',
    commandContribution: commandContribution(styleUsageManifest)
  },
  {
    id: 'variable-overview',
    order: '04',
    name: 'Variable Overview',
    level: '权限',
    focus: '专用读取能力',
    summary: '只读取变量域，并只返回集合、变量、模式与可发布变量数量。',
    directory: 'examples/third-party-plugin/variable-overview',
    permissions: ['document.variables.read'],
    parameters: '空对象，不接受额外字段',
    result: 'collectionCount · variableCount · modeCount · publishableVariableCount',
    commandContribution: commandContribution(variableOverviewManifest)
  }
])

const activeId = ref(examples[0].id)
const copyStatus = ref<'idle' | 'copied' | 'failed'>('idle')
const activeExample = computed(
  () => examples.find((example) => example.id === activeId.value) ?? examples[0]
)

function selectExample(id: string) {
  activeId.value = id
  copyStatus.value = 'idle'
}

async function focusExample(index: number) {
  const normalizedIndex = (index + examples.length) % examples.length
  const example = examples[normalizedIndex]
  selectExample(example.id)
  await nextTick()
  document.getElementById(`plugin-example-tab-${example.id}`)?.focus()
}

function handleExampleKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    void focusExample(index - 1)
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    void focusExample(index + 1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    void focusExample(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    void focusExample(examples.length - 1)
  }
}

async function copyContractExcerpt() {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    copyStatus.value = 'failed'
    return
  }
  try {
    await navigator.clipboard.writeText(activeExample.value.commandContribution)
    copyStatus.value = 'copied'
  } catch {
    copyStatus.value = 'failed'
  }
}
</script>

<template>
  <section class="plugin-lab" aria-labelledby="plugin-lab-title">
    <header class="lab-hero">
      <div>
        <p class="eyebrow">OPENPENCIL · MANIFEST V2 LAB</p>
        <h2 id="plugin-lab-title">先看清边界，再写第一份插件</h2>
        <p class="hero-copy">
          四个示例共用同一条安全链：发布者描述契约，Marketplace 验证来源，OpenPencil
          宿主执行已经审查的能力。
        </p>
      </div>
      <dl class="metrics" aria-label="教程概览">
        <div>
          <dt>示例</dt>
          <dd>4</dd>
        </div>
        <div>
          <dt>信任域</dt>
          <dd>3</dd>
        </div>
        <div>
          <dt>任意 JS</dt>
          <dd>0</dd>
        </div>
      </dl>
    </header>

    <div class="example-grid">
      <div
        class="example-picker"
        role="tablist"
        aria-label="选择插件示例"
        aria-orientation="vertical"
      >
        <button
          v-for="(example, index) in examples"
          :key="example.id"
          :id="`plugin-example-tab-${example.id}`"
          type="button"
          class="example-button"
          :class="{ active: example.id === activeExample.id }"
          role="tab"
          aria-controls="plugin-contract-panel"
          :aria-selected="example.id === activeExample.id"
          :tabindex="example.id === activeExample.id ? 0 : -1"
          @click="selectExample(example.id)"
          @keydown="handleExampleKeydown($event, index)"
        >
          <span class="example-order" aria-hidden="true">{{ example.order }}</span>
          <span class="example-button-copy">
            <strong>{{ example.name }}</strong>
            <span>{{ example.focus }}</span>
          </span>
          <span v-if="example.id === activeExample.id" class="current-label">当前</span>
        </button>
      </div>

      <article
        id="plugin-contract-panel"
        class="contract-panel"
        role="tabpanel"
        tabindex="0"
        :aria-labelledby="`plugin-example-tab-${activeExample.id}`"
      >
        <header class="contract-heading">
          <div>
            <span class="level-label">{{ activeExample.level }}</span>
            <h3>{{ activeExample.name }}</h3>
          </div>
          <code>{{ activeExample.id }}</code>
        </header>
        <p class="contract-summary">{{ activeExample.summary }}</p>

        <dl class="contract-facts">
          <div>
            <dt>最小权限</dt>
            <dd>
              <code v-for="permission in activeExample.permissions" :key="permission">
                {{ permission }}
              </code>
            </dd>
          </div>
          <div>
            <dt>参数</dt>
            <dd>{{ activeExample.parameters }}</dd>
          </div>
          <div>
            <dt>结果</dt>
            <dd>{{ activeExample.result }}</dd>
          </div>
          <div>
            <dt>目录</dt>
            <dd>
              <code>{{ activeExample.directory }}</code>
            </dd>
          </div>
        </dl>

        <div class="code-shell">
          <div class="code-toolbar">
            <span>完整命令贡献</span>
            <button type="button" @click="copyContractExcerpt">
              {{ copyStatus === 'copied' ? '已复制' : '复制完整命令' }}
            </button>
          </div>
          <pre><code>{{ activeExample.commandContribution }}</code></pre>
        </div>
        <p class="copy-status" aria-live="polite">
          <span v-if="copyStatus === 'failed'">浏览器未允许复制，请手动选择代码。</span>
          <span v-else-if="copyStatus === 'copied'">完整命令贡献已复制。</span>
        </p>
      </article>
    </div>

    <section class="trust-section" aria-labelledby="trust-chain-title">
      <div class="section-heading">
        <p class="eyebrow">TRUST CHAIN</p>
        <h3 id="trust-chain-title">从本地文件到用户安装，六步都不能跳</h3>
      </div>
      <ol class="trust-chain">
        <li><span>1</span><strong>定义</strong><small>Manifest + Listing</small></li>
        <li><span>2</span><strong>适配</strong><small>宿主代码审查</small></li>
        <li><span>3</span><strong>签名</strong><small>发布者 Ed25519</small></li>
        <li><span>4</span><strong>校验</strong><small>Portal 预检</small></li>
        <li><span>5</span><strong>发布</strong><small>根签名快照</small></li>
        <li><span>6</span><strong>安装</strong><small>用户明确启用</small></li>
      </ol>
      <div class="boundary-grid">
        <div>
          <span class="boundary-number">A</span>
          <strong>插件包</strong>
          <p>只描述身份、参数、结果与权限；不携带实现代码或凭据。</p>
        </div>
        <div>
          <span class="boundary-number">B</span>
          <strong>Marketplace</strong>
          <p>验证发布者、所有权、签名、审查状态和不可变发布坐标。</p>
        </div>
        <div>
          <span class="boundary-number">C</span>
          <strong>OpenPencil 宿主</strong>
          <p>精确匹配 adapter 与完整契约，然后执行受限、已审查的本地能力。</p>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.plugin-lab {
  --lab-accent: var(--vp-c-brand-1);
  --lab-surface: var(--vp-c-bg-soft);
  --lab-surface-strong: var(--vp-c-bg-alt);
  margin: 2rem 0 3rem;
  color: var(--vp-c-text-1);
}

.lab-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(15rem, 0.8fr);
  gap: 2rem;
  align-items: end;
  padding: clamp(1.5rem, 4vw, 3rem);
  border: 1px solid var(--vp-c-divider);
  border-radius: 1.25rem;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--lab-accent) 12%, var(--vp-c-bg)) 0%,
    var(--vp-c-bg-soft) 72%
  );
}

.eyebrow {
  margin: 0 0 0.75rem;
  color: var(--lab-accent);
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.lab-hero h2,
.trust-section h3,
.contract-heading h3 {
  margin: 0;
  border: 0;
  padding: 0;
  letter-spacing: -0.025em;
}

.lab-hero h2 {
  max-width: 16ch;
  font-size: clamp(1.9rem, 4vw, 3rem);
  line-height: 1.08;
}

.hero-copy {
  max-width: 42rem;
  margin: 1rem 0 0;
  color: var(--vp-c-text-2);
  line-height: 1.75;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin: 0;
}

.metrics div {
  min-width: 0;
  padding: 1rem 0.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--vp-c-bg) 84%, transparent);
  text-align: center;
}

.metrics dt {
  color: var(--vp-c-text-2);
  font-size: 0.75rem;
}

.metrics dd {
  margin: 0.25rem 0 0;
  font-family: var(--vp-font-family-mono);
  font-size: 1.5rem;
  font-weight: 700;
}

.example-grid {
  display: grid;
  grid-template-columns: minmax(15rem, 0.72fr) minmax(0, 1.6fr);
  gap: 1rem;
  margin-top: 1rem;
}

.example-picker {
  display: grid;
  gap: 0.625rem;
  align-content: start;
}

.example-button {
  display: grid;
  grid-template-columns: 2.25rem minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  min-height: 4.5rem;
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.875rem;
  background: var(--lab-surface);
  color: var(--vp-c-text-1);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 180ms ease,
    background-color 180ms ease;
}

.example-button:hover {
  border-color: var(--vp-c-brand-soft);
  background: color-mix(in srgb, var(--lab-accent) 8%, var(--lab-surface));
}

.example-button.active {
  border-color: var(--lab-accent);
  background: color-mix(in srgb, var(--lab-accent) 12%, var(--lab-surface));
}

.example-button:focus-visible,
.contract-panel:focus-visible,
.code-toolbar button:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--lab-accent) 45%, transparent);
  outline-offset: 2px;
}

.example-order,
.boundary-number {
  display: inline-grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  background: var(--vp-c-bg);
  color: var(--lab-accent);
  font-family: var(--vp-font-family-mono);
  font-weight: 700;
}

.example-button-copy {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.example-button-copy span {
  color: var(--vp-c-text-2);
  font-size: 0.8rem;
}

.current-label,
.level-label {
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  background: var(--lab-accent);
  color: var(--vp-c-white);
  font-size: 0.7rem;
  font-weight: 700;
}

.contract-panel,
.trust-section {
  padding: clamp(1.25rem, 3vw, 2rem);
  border: 1px solid var(--vp-c-divider);
  border-radius: 1rem;
  background: var(--lab-surface);
}

.contract-panel {
  min-width: 0;
}

.contract-heading,
.code-toolbar,
.section-heading {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
}

.contract-heading > div {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.contract-heading > code {
  overflow-wrap: anywhere;
  color: var(--vp-c-text-2);
  font-size: 0.75rem;
}

.contract-summary {
  margin: 1rem 0;
  color: var(--vp-c-text-2);
}

.contract-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0 0 1rem;
}

.contract-facts div {
  min-width: 0;
  padding: 0.875rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-c-bg);
}

.contract-facts dt {
  margin-bottom: 0.35rem;
  color: var(--vp-c-text-2);
  font-size: 0.75rem;
  font-weight: 600;
}

.contract-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 0.875rem;
}

.contract-facts dd code {
  display: inline-block;
  margin: 0.125rem 0.25rem 0.125rem 0;
}

.code-shell {
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-code-block-bg);
}

.code-toolbar {
  min-height: 3rem;
  padding: 0.4rem 0.5rem 0.4rem 0.875rem;
  border-bottom: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  font-size: 0.75rem;
}

.code-toolbar button {
  min-height: 2.75rem;
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.5rem;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
}

.code-shell pre {
  max-height: 24rem;
  margin: 0;
  padding: 1rem;
  overflow: auto;
  background: transparent;
  font-size: 0.78rem;
  line-height: 1.65;
}

.copy-status {
  min-height: 1.25rem;
  margin: 0.4rem 0 0;
  color: var(--vp-c-text-2);
  font-size: 0.75rem;
}

.trust-section {
  margin-top: 1rem;
}

.trust-section h3 {
  font-size: clamp(1.35rem, 3vw, 1.85rem);
}

.trust-chain {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0;
  margin: 1.5rem 0;
  padding: 0;
  list-style: none;
}

.trust-chain li {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 0.35rem;
  min-width: 0;
  text-align: center;
}

.trust-chain li:not(:last-child)::after {
  position: absolute;
  top: 1rem;
  left: calc(50% + 1.2rem);
  width: calc(100% - 2.4rem);
  height: 1px;
  background: var(--vp-c-divider);
  content: '';
}

.trust-chain span {
  z-index: 1;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--lab-accent);
  border-radius: 50%;
  background: var(--vp-c-bg);
  color: var(--lab-accent);
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  font-weight: 700;
}

.trust-chain small {
  color: var(--vp-c-text-2);
  font-size: 0.68rem;
  line-height: 1.35;
}

.boundary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.boundary-grid > div {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem 0.75rem;
  align-items: center;
  padding: 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-c-bg);
}

.boundary-grid p {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 0.82rem;
  line-height: 1.55;
}

@media (max-width: 760px) {
  .lab-hero,
  .example-grid {
    grid-template-columns: 1fr;
  }

  .contract-facts,
  .boundary-grid {
    grid-template-columns: 1fr;
  }

  .contract-heading,
  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .trust-chain {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }

  .trust-chain li {
    grid-template-columns: 2rem minmax(0, 1fr);
    justify-items: start;
    text-align: left;
  }

  .trust-chain li strong,
  .trust-chain li small {
    grid-column: 2;
  }

  .trust-chain li strong {
    grid-row: 1;
    align-self: center;
  }

  .trust-chain li small {
    grid-row: 2;
  }

  .trust-chain li:not(:last-child)::after {
    top: 2rem;
    left: 1rem;
    width: 1px;
    height: calc(100% - 0.5rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .example-button {
    transition: none;
  }
}
</style>
