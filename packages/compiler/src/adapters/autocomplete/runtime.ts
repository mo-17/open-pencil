/** INPUT keeps native form/value semantics; this controller owns only its local suggestions. */
export function autocompleteRuntimeSource(): string {
  return String.raw`export interface AutocompleteConfig {
  suggestions: readonly string[]
  onSelect(value: string): void
  portalRoot?: HTMLElement
}
let nextId = 0
export function autocompleteMatches(suggestions: readonly string[], value: string): string[] {
  const query = value.toLocaleLowerCase()
  return [...new Set(suggestions.slice(0, 100).filter(item => typeof item === 'string' && item.length <= 200))]
    .filter(item => item.toLocaleLowerCase().includes(query))
}
export function mountAutocomplete(input: HTMLInputElement, initial: AutocompleteConfig) {
  const doc = input.ownerDocument
  const defaultView = doc.defaultView
  if (!defaultView) throw new Error('Autocomplete requires a live input document')
  const win = defaultView
  const id = 'op-autocomplete-' + ++nextId
  let config = initial, popup: HTMLDivElement | undefined, list: HTMLDivElement | undefined
  let filtered: string[] = [], active = -1, composing = false, committing = false, destroyed = false
  let signature = JSON.stringify(config.suggestions), previousValue = input.value, language = chinese()
  let owner: HTMLFormElement | null = null
  const previous = new Map(['role', 'aria-autocomplete', 'aria-haspopup', 'aria-controls', 'aria-expanded', 'aria-activedescendant', 'autocomplete'].map(name => [name, input.getAttribute(name)]))
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-haspopup', 'listbox')
  input.setAttribute('aria-controls', id)
  input.setAttribute('aria-expanded', 'false')
  // These authored suggestions are separate from browser credential/autofill storage.
  input.autocomplete = 'off'
  function allowed() { return !destroyed && !input.disabled && !input.readOnly && ['text', 'search'].includes(input.type) && config.suggestions.length > 0 }
  function chinese() { return (input.closest('[lang]')?.getAttribute('lang') || doc.documentElement.lang || win.navigator.language).toLowerCase().startsWith('zh') }
  function inside(target: EventTarget | null) { return target instanceof win.Node && (target === input || !!popup?.contains(target)) }
  function place() {
    if (!popup || !list) return
    if (!input.isConnected) { close(); return }
    const rect = input.getBoundingClientRect()
    const width = Math.min(Math.max(rect.width, 160), Math.max(0, win.innerWidth - 16))
    popup.style.width = width + 'px'
    const below = Math.max(0, win.innerHeight - rect.bottom - 14), above = Math.max(0, rect.top - 14)
    const useBelow = below >= 200 || below >= above
    const space = Math.max(0, useBelow ? below : above)
    list.style.maxHeight = Math.max(0, Math.min(240, space - 48)) + 'px'
    popup.style.maxHeight = space + 'px'
    popup.style.left = Math.min(Math.max(8, rect.left), Math.max(8, win.innerWidth - width - 8)) + 'px'
    popup.style.top = (useBelow ? rect.bottom + 6 : Math.max(8, rect.top - popup.offsetHeight - 6)) + 'px'
  }
  function close() {
    popup?.remove(); popup = undefined; list = undefined; active = -1
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    doc.removeEventListener('pointerdown', outside, true)
    doc.removeEventListener('scroll', scroll, true)
    win.removeEventListener('resize', place)
  }
  function commit(value: string) {
    close()
    if (value === input.value) return
    committing = true
    try { config.onSelect(value) } finally { committing = false; previousValue = input.value }
  }
  function choose(index: number) {
    const value = filtered[index]
    if (!allowed() || composing || value === undefined) return
    commit(value)
  }
  function render() {
    const container = list
    if (!container) return
    container.replaceChildren()
    input.removeAttribute('aria-activedescendant')
    if (!filtered.length) {
      const empty = doc.createElement('div')
      empty.setAttribute('role', 'status')
      empty.textContent = chinese() ? '无匹配建议，可继续输入' : 'No suggestions. Keep typing your own value.'
      Object.assign(empty.style, { padding: '10px 12px', overflowWrap: 'anywhere', opacity: '0.7' })
      container.append(empty)
    }
    filtered.forEach((value, index) => {
      const row = doc.createElement('div')
      row.id = id + '-' + index
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(index === active))
      row.textContent = value
      row.title = value
      Object.assign(row.style, { padding: '8px 12px', minHeight: '36px', boxSizing: 'border-box', overflowWrap: 'anywhere', cursor: 'pointer', background: index === active ? 'color-mix(in srgb, Highlight 14%, Canvas)' : 'transparent', outline: index === active ? '1px solid Highlight' : 'none', outlineOffset: '-1px' })
      row.addEventListener('pointerdown', event => event.preventDefault())
      row.addEventListener('click', () => choose(index))
      container.append(row)
      if (index === active) input.setAttribute('aria-activedescendant', row.id)
    })
    const row = active >= 0 ? container.children[active] as HTMLElement | undefined : undefined
    if (row) {
      if (row.offsetTop < container.scrollTop) container.scrollTop = row.offsetTop
      else if (row.offsetTop + row.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = row.offsetTop + row.offsetHeight - container.clientHeight
    }
  }
  function filter() { filtered = autocompleteMatches(config.suggestions, input.value); active = -1; render(); place() }
  function open() {
    if (!allowed() || composing || popup) return
    const computed = win.getComputedStyle(input)
    popup = doc.createElement('div')
    popup.dataset.opAutocompletePopup = ''
    Object.assign(popup.style, { position: 'fixed', zIndex: '1000', boxSizing: 'border-box', padding: '4px', overflow: 'hidden', border: '1px solid color-mix(in srgb, CanvasText 20%, Canvas)', borderRadius: '8px', background: 'Canvas', color: 'CanvasText', colorScheme: computed.colorScheme, boxShadow: '0 8px 24px #00000029', font: computed.font, direction: computed.direction })
    list = doc.createElement('div')
    list.id = id
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-label', chinese() ? '输入建议' : 'Input suggestions')
    Object.assign(list.style, { overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', position: 'relative' })
    popup.append(list)
    const clear = doc.createElement('button')
    clear.type = 'button'; clear.tabIndex = -1
    clear.textContent = chinese() ? '清空输入' : 'Clear input'
    Object.assign(clear.style, { display: 'block', width: '100%', minHeight: '36px', border: '0', borderTop: '1px solid color-mix(in srgb, CanvasText 20%, Canvas)', background: 'Canvas', color: 'CanvasText', font: 'inherit', cursor: 'pointer' })
    clear.addEventListener('pointerdown', event => event.preventDefault())
    clear.addEventListener('click', () => { if (allowed() && !composing) commit('') })
    popup.append(clear)
    const root = input.getRootNode()
    const target = config.portalRoot ?? (root instanceof win.ShadowRoot ? root.querySelector('[data-openpencil-portal]') ?? root : doc.body)
    target.appendChild(popup)
    input.setAttribute('aria-expanded', 'true')
    doc.addEventListener('pointerdown', outside, true)
    doc.addEventListener('scroll', scroll, true)
    win.addEventListener('resize', place)
    filter()
  }
  function keydown(event: KeyboardEvent) {
    if (!allowed() || composing || event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape' && popup) { event.preventDefault(); event.stopPropagation(); close(); return }
    if (event.key === 'Tab') { close(); return }
    if (event.key === 'Enter' && popup && active >= 0) { event.preventDefault(); choose(active); return }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault(); open()
    if (!filtered.length) return
    active = event.key === 'ArrowDown' ? Math.min(filtered.length - 1, active + 1) : active < 0 ? filtered.length - 1 : Math.max(0, active - 1)
    render()
  }
  function change() { previousValue = input.value; if (!composing && !committing) { open(); filter() } }
  function start() { composing = true; close() }
  function end() { composing = false; change() }
  function outside(event: PointerEvent) { if (!event.composedPath().some(inside)) close() }
  function scroll(event: Event) { if (!popup?.contains(event.target as Node)) place() }
  function reset() { close() }
  function refreshOwner() {
    if (owner === input.form) return
    owner?.removeEventListener('reset', reset); owner = input.form; owner?.addEventListener('reset', reset)
  }
  input.addEventListener('focus', open)
  input.addEventListener('click', open)
  input.addEventListener('blur', close)
  input.addEventListener('input', change)
  input.addEventListener('keydown', keydown)
  input.addEventListener('compositionstart', start)
  input.addEventListener('compositionend', end)
  refreshOwner()
  return {
    update(next: AutocompleteConfig) {
      const nextSignature = JSON.stringify(next.suggestions)
      const portalChanged = config.portalRoot !== next.portalRoot
      const localeChanged = language !== chinese()
      const changed = signature !== nextSignature || previousValue !== input.value
      signature = nextSignature; previousValue = input.value; language = chinese(); config = next
      refreshOwner()
      if (!allowed() || localeChanged) close()
      else if (popup && portalChanged) { close(); open() }
      else if (popup && changed) filter()
    },
    destroy() {
      destroyed = true; close(); owner?.removeEventListener('reset', reset)
      input.removeEventListener('focus', open); input.removeEventListener('click', open)
      input.removeEventListener('blur', close); input.removeEventListener('input', change)
      input.removeEventListener('keydown', keydown); input.removeEventListener('compositionstart', start)
      input.removeEventListener('compositionend', end)
      for (const [name, value] of previous) { if (value === null) input.removeAttribute(name); else input.setAttribute(name, value) }
    }
  }
}
`
}
