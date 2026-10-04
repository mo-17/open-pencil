/** Instance-owned Vue RichText control. DOM parsing/projection is supplied by the shared runtime. */
export const RICH_TEXT_VUE_STATE_RUNTIME = `
const host = ref<HTMLDivElement | null>(null)
const editor = ref<HTMLElement | null>(null)
const hiddenInput = ref<HTMLInputElement | null>(null)
const status = ref('')
const controlled = computed(() => props.valueBound === true || props.value !== undefined)
const projection = computed(() => controlled.value ? projectReactiveRichText(props.value) : props.config.content)
const unavailable = computed(() => controlled.value && projection.value === null)
const readOnly = computed(() => props.readOnly === true || props.disabled === true || unavailable.value || (controlled.value && typeof props['onUpdate:value'] !== 'function'))
const documentValue = shallowRef<OpenPencilRichTextDocument>(projection.value ?? { type: 'doc', blocks: [] })
const serialized = computed(() => JSON.stringify(documentValue.value))
let selection: Range | null = null
let mounted = false
let disposed = false
let composing = false
let compositionValue = ''
let compositionCancelled = false
let forceProjection = false
let lastDOMValue = ''

function syncHidden(): void {
  if (hiddenInput.value) hiddenInput.value.value = serialized.value
}

function projectDocument(): void {
  const target = editor.value
  if (disposed || !target) return
  for (const link of target.querySelectorAll<HTMLAnchorElement>('a')) link.style.color = props.config.linkColor
  if (composing && controlled.value && JSON.stringify(projection.value ?? { type: 'doc', blocks: [] }) !== compositionValue) compositionCancelled = true
  if (composing && !unavailable.value) return
  if (unavailable.value) composing = false
  const next = controlled.value ? projection.value ?? { type: 'doc' as const, blocks: [] } : documentValue.value
  if (!mounted || forceProjection || (controlled.value && JSON.stringify(next) !== serialized.value)) {
    mountDocument(target, next, props.config.linkColor)
    documentValue.value = next
    lastDOMValue = JSON.stringify(readDocument(target).document)
    selection = null
  }
  mounted = true
  forceProjection = false
  syncHidden()
}

function syncDocument(): void {
  if (disposed || readOnly.value || composing || !editor.value) return
  const next = readDocument(editor.value)
  const nextDOMValue = JSON.stringify(next.document)
  if (nextDOMValue === lastDOMValue) {
    if (next.truncated) status.value = 'Content limit reached'
    return
  }
  lastDOMValue = nextDOMValue
  documentValue.value = next.document
  syncHidden()
  emit('update:value', next.document)
  host.value?.dispatchEvent(new CustomEvent('openpencil:rich-text-change', { bubbles: true, detail: next.document }))
  status.value = next.truncated ? 'Content limit reached' : 'Changes ready'
  if (controlled.value) void nextTick(projectDocument)
}

function startComposition(): void {
  if (disposed || readOnly.value) return
  composing = true
  compositionValue = serialized.value
  compositionCancelled = false
}

function endComposition(): void {
  composing = false
  if (disposed) return
  if (compositionCancelled || readOnly.value || (controlled.value && JSON.stringify(projection.value ?? { type: 'doc', blocks: [] }) !== compositionValue)) {
    forceProjection = true
    projectDocument()
    return
  }
  syncDocument()
}

watch([readOnly, controlled, projection], () => {
  if (composing && (readOnly.value || (controlled.value && JSON.stringify(projection.value ?? { type: 'doc', blocks: [] }) !== compositionValue))) compositionCancelled = true
}, { flush: 'sync' })
watch([controlled, projection, readOnly, () => props.config.linkColor], projectDocument, { flush: 'post' })
onMounted(projectDocument)
onUpdated(projectDocument)
onBeforeUnmount(() => { disposed = true; composing = false; selection = null })
`
