/** Shared generated DOM controller. Option data stays outside the DOM until visible. */
export function selectRuntimeSource(): string {
  return String.raw`export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  placeholder?: boolean
}
export interface SelectConfig {
  options: SelectOption[]
  showSearch: boolean
  virtual: boolean
  value?: string | string[]
  multiple?: boolean
  allowClear?: boolean
  placeholder?: string
  disabled?: boolean
  onSelect(value: string | string[]): void
  onFocus?(): void
  onBlur?(): void
  searchLabel?: string
  emptyLabel?: string
  portalRoot?: HTMLElement
}

export function selectOptionText(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value)
}

let nextId = 0
const ROW_HEIGHT = 36
const MAX_HEIGHT = 240
const OVERSCAN = 3

export function mountSelect(trigger: HTMLButtonElement, select: HTMLSelectElement, initial: SelectConfig) {
  const doc = trigger.ownerDocument
  const win = doc.defaultView!
  const id = 'op-select-list-' + ++nextId
  let config = initial
  let popup: HTMLDivElement | undefined
  let viewport: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  let search: HTMLInputElement | undefined
  let filtered: SelectOption[] = []
  let active = -1
  let query = ''
  let composing = false
  let focused = false
  let blurTimer: number | undefined
  let destroyed = false
  let typeahead = ''
  let typedAt = 0
  const label = doc.createElement('span')
  Object.assign(label.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1', textAlign: 'start' })
  const arrow = doc.createElement('span')
  arrow.setAttribute('aria-hidden', 'true')
  Object.assign(arrow.style, { width: '7px', height: '7px', borderInlineEnd: '1.5px solid currentColor', borderBottom: '1.5px solid currentColor', transform: 'translateY(-2px) rotate(45deg)', flexShrink: '0', marginInline: '4px' })
  trigger.replaceChildren(label, arrow)
  Object.assign(trigger.style, { display: 'inline-flex', alignItems: 'center', gap: '8px', textAlign: 'start' })
  trigger.style.paddingInlineEnd = Math.max(12, parseFloat(win.getComputedStyle(trigger).paddingInlineEnd) || 0) + 'px'
  trigger.setAttribute('role', 'combobox')
  trigger.setAttribute('aria-haspopup', 'listbox')
  trigger.setAttribute('aria-controls', id)
  trigger.setAttribute('aria-expanded', 'false')

  function chinese() {
    return (trigger.closest('[lang]')?.getAttribute('lang') || doc.documentElement.lang || win.navigator.language).toLowerCase().startsWith('zh')
  }
  function searchLabel() { return config.searchLabel ?? (chinese() ? '搜索选项' : 'Search options') }
  function emptyLabel() { return config.emptyLabel ?? (chinese() ? '无匹配选项' : 'No matching options') }
  function inside(target: EventTarget | null) {
    return target instanceof win.Node && (trigger.contains(target) || !!popup?.contains(target) || select.contains(target))
  }
  function actualFocus() {
    let target = doc.activeElement
    while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement
    return target
  }
  function selectedValues(): string[] {
    return config.multiple ? (Array.isArray(config.value) ? config.value : [])
      : typeof config.value === 'string' ? [config.value] : []
  }
  function isSelected(value: string): boolean { return selectedValues().includes(value) }
  function syncTrigger() {
    const chosen = config.options.find((option) => option.value === config.value)
    const labels = config.multiple ? config.options.filter(option => isSelected(option.value)).map(option => option.label) : []
    label.textContent = config.multiple ? labels.join(' · ') || config.placeholder || '' : chosen?.label ?? ''
    label.style.color = config.multiple && labels.length === 0 ? 'GrayText' : ''
    if (config.multiple && labels.length) {
      label.replaceChildren()
      Object.assign(label.style, { display: 'flex', alignItems: 'center', gap: '4px' })
      for (const text of [...labels.slice(0, 3), ...(labels.length > 3 ? ['+' + (labels.length - 3)] : [])]) {
        const chip = doc.createElement('span')
        chip.textContent = text
        Object.assign(chip.style, { padding: '2px 6px', borderRadius: '4px', background: 'color-mix(in srgb, currentColor 8%, transparent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '0' })
        label.append(chip)
      }
    }
    trigger.toggleAttribute('data-op-select-placeholder', config.multiple ? selectedValues().length === 0 : chosen?.placeholder === true)
    trigger.disabled = config.disabled === true
    trigger.setAttribute('aria-disabled', String(config.disabled === true))
    if (config.disabled && popup) close(false)
  }
  function firstEnabled(start: number, direction: number) {
    for (let index = start; index >= 0 && index < filtered.length; index += direction) {
      if (!filtered[index].disabled) return index
    }
    return -1
  }
  function activeAttributes() {
    const itemId = active >= 0 && content?.querySelector('[id="' + id + '-' + active + '"]') ? id + '-' + active : undefined
    for (const element of [trigger, search]) {
      if (!element) continue
      if (itemId) element.setAttribute('aria-activedescendant', itemId)
      else element.removeAttribute('aria-activedescendant')
    }
  }
  function renderRows() {
    if (!viewport || !content) return
    const height = Math.min(MAX_HEIGHT, Math.max(ROW_HEIGHT, filtered.length * ROW_HEIGHT))
    viewport.style.height = height + 'px'
    content.replaceChildren()
    content.style.height = filtered.length * ROW_HEIGHT + 'px'
    if (filtered.length === 0) {
      content.style.height = ROW_HEIGHT + 'px'
      const empty = doc.createElement('div')
      empty.setAttribute('role', 'status')
      empty.textContent = emptyLabel()
      Object.assign(empty.style, { padding: '8px 12px', opacity: '0.65' })
      content.append(empty)
    }
    const start = config.virtual ? Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN) : 0
    const end = config.virtual ? Math.min(filtered.length, Math.ceil((viewport.scrollTop + height) / ROW_HEIGHT) + OVERSCAN) : filtered.length
    for (let index = start; index < end; index++) {
      const option = filtered[index]
      const row = doc.createElement('div')
      row.id = id + '-' + index
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(isSelected(option.value)))
      row.setAttribute('aria-disabled', String(option.disabled === true))
      row.setAttribute('aria-posinset', String(index + 1))
      row.setAttribute('aria-setsize', String(filtered.length))
      row.title = option.label
      Object.assign(row.style, {
        boxSizing: 'border-box', height: ROW_HEIGHT + 'px', position: 'absolute', insetInline: '0', top: index * ROW_HEIGHT + 'px',
        padding: '0 12px', display: 'flex', alignItems: 'center', gap: '8px', cursor: option.disabled ? 'not-allowed' : 'pointer',
        opacity: option.disabled ? '0.45' : '1',
        background: index === active ? 'color-mix(in srgb, Highlight 14%, Canvas)' : 'transparent',
        outline: index === active ? '1px solid Highlight' : 'none', outlineOffset: '-1px'
      })
      const text = doc.createElement('span')
      text.textContent = option.label
      Object.assign(text.style, { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
      row.append(text)
      if (isSelected(option.value)) {
        const check = doc.createElement('span')
        check.textContent = '✓'
        check.setAttribute('aria-hidden', 'true')
        row.append(check)
      }
      row.addEventListener('pointerdown', (event) => event.preventDefault())
      row.addEventListener('click', () => choose(index))
      content.append(row)
    }
    activeAttributes()
  }
  function reveal() {
    if (!viewport || active < 0) return
    const top = active * ROW_HEIGHT
    const height = Math.min(MAX_HEIGHT, filtered.length * ROW_HEIGHT)
    if (top < viewport.scrollTop) viewport.scrollTop = top
    else if (top + ROW_HEIGHT > viewport.scrollTop + height) viewport.scrollTop = top + ROW_HEIGHT - height
  }
  function filter(preferSelected: boolean) {
    filtered = query ? config.options.filter((option) => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : config.options
    active = preferSelected ? filtered.findIndex((option) => isSelected(option.value) && !option.disabled) : -1
    if (active < 0) active = firstEnabled(0, 1)
    if (viewport) viewport.scrollTop = 0
    renderRows()
    reveal()
    renderRows()
  }
  function place() {
    if (!popup) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(Math.max(rect.width, 180), Math.max(0, win.innerWidth - 16))
    popup.style.width = width + 'px'
    const height = popup.offsetHeight
    const below = rect.bottom + 6
    const top = below + height <= win.innerHeight - 8 ? below : Math.max(8, rect.top - height - 6)
    const left = Math.min(Math.max(8, rect.left), Math.max(8, win.innerWidth - width - 8))
    popup.style.top = top + 'px'
    popup.style.left = left + 'px'
  }
  function open() {
    if (popup || config.disabled || destroyed) return
    query = ''
    popup = doc.createElement('div')
    popup.dataset.opSelectPopup = ''
    const computed = win.getComputedStyle(trigger)
    Object.assign(popup.style, {
      position: 'fixed', zIndex: '1000', boxSizing: 'border-box', padding: '4px', border: '1px solid color-mix(in srgb, CanvasText 20%, Canvas)',
      borderRadius: '8px', background: 'Canvas', color: 'CanvasText', colorScheme: computed.colorScheme,
      boxShadow: '0 8px 24px #00000029', font: computed.font, direction: computed.direction
    })
    if (config.showSearch) {
      search = doc.createElement('input')
      search.type = 'search'
      search.autocomplete = 'off'
      search.placeholder = searchLabel()
      search.setAttribute('aria-label', searchLabel())
      search.setAttribute('aria-controls', id)
      search.setAttribute('aria-autocomplete', 'list')
      Object.assign(search.style, { display: 'block', boxSizing: 'border-box', width: '100%', height: '36px', marginBottom: '4px', padding: '6px 10px', border: '1px solid color-mix(in srgb, CanvasText 24%, Canvas)', borderRadius: '5px', background: 'Canvas', color: 'CanvasText', font: 'inherit' })
      search.addEventListener('compositionstart', () => { composing = true })
      search.addEventListener('compositionend', () => { composing = false; query = search?.value ?? ''; filter(false); place() })
      search.addEventListener('input', () => { if (!composing) { query = search?.value ?? ''; filter(false); place() } })
      search.addEventListener('keydown', keydown)
      popup.append(search)
    }
    viewport = doc.createElement('div')
    viewport.id = id
    viewport.setAttribute('role', 'listbox')
    if (config.multiple) viewport.setAttribute('aria-multiselectable', 'true')
    viewport.setAttribute('aria-label', trigger.getAttribute('aria-label') || searchLabel())
    Object.assign(viewport.style, { overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', position: 'relative' })
    content = doc.createElement('div')
    Object.assign(content.style, { position: 'relative', minWidth: '0' })
    viewport.append(content)
    viewport.addEventListener('scroll', renderRows)
    popup.append(viewport)
    if (config.multiple && config.allowClear) {
      const clear = doc.createElement('button')
      clear.type = 'button'
      clear.textContent = chinese() ? '清空选择' : 'Clear selection'
      Object.assign(clear.style, { display: 'block', minHeight: '36px', width: '100%', border: '0', borderTop: '1px solid GrayText', background: 'Canvas', color: 'CanvasText', font: 'inherit', cursor: 'pointer' })
      clear.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
        else if (event.key === 'Tab') close(true)
      })
      clear.addEventListener('click', () => { if (!config.disabled && selectedValues().length > 0) { config.onSelect([]); search?.focus(); renderRows() } })
      popup.append(clear)
    }
    const root = trigger.getRootNode()
    const target = config.portalRoot ?? (root instanceof win.ShadowRoot ? root.querySelector('[data-openpencil-portal]') ?? root : doc.body)
    target.appendChild(popup)
    trigger.setAttribute('aria-expanded', 'true')
    filter(true)
    place()
    doc.addEventListener('pointerdown', outside, true)
    win.addEventListener('resize', place)
    doc.addEventListener('scroll', scroll, true)
    search?.focus({ preventScroll: true })
  }
  function close(restore: boolean) {
    if (blurTimer !== undefined) { win.clearTimeout(blurTimer); blurTimer = undefined }
    if (!popup) return
    // Move focus before removing the search field, preserving normal Tab order.
    if (restore && !trigger.disabled) trigger.focus({ preventScroll: true })
    popup.remove()
    popup = undefined
    viewport = undefined
    content = undefined
    search = undefined
    composing = false
    query = ''
    trigger.setAttribute('aria-expanded', 'false')
    trigger.removeAttribute('aria-activedescendant')
    doc.removeEventListener('pointerdown', outside, true)
    win.removeEventListener('resize', place)
    doc.removeEventListener('scroll', scroll, true)
    // Removing the focused search input does not reliably emit focusout.
    if (!destroyed && focused && !inside(actualFocus())) {
      focused = false
      config.onBlur?.()
    }
  }
  function choose(index: number) {
    const option = filtered[index]
    if (!option || option.disabled || config.disabled) return
    if (config.multiple) {
      const values = selectedValues()
      config.onSelect(values.includes(option.value) ? values.filter(value => value !== option.value) : [...values, option.value])
      renderRows()
      return
    }
    close(true)
    if (option.value !== config.value) config.onSelect(option.value)
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || composing || event.keyCode === 229 || config.disabled) return
    if (event.key === 'Backspace' && config.multiple && event.target === trigger && !popup) {
      const values = selectedValues()
      const removable = [...values].reverse().find(value => config.options.some(option => option.value === value && !option.disabled))
      if (removable !== undefined) { event.preventDefault(); config.onSelect(values.filter(value => value !== removable)) }
      return
    }
    if (event.key === 'Escape' && popup) { event.preventDefault(); event.stopPropagation(); close(true); return }
    if (event.key === 'Tab' && popup) { close(event.target === search); return }
    if (event.key === 'Enter' || (event.key === ' ' && event.target === trigger)) {
      event.preventDefault()
      if (popup) choose(active)
      else open()
      return
    }
    const navigation = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']
    if (navigation.includes(event.key) && !(event.target === search && ['Home', 'End'].includes(event.key))) {
      event.preventDefault()
      if (!popup) { open(); return }
      const direction = ['ArrowUp', 'Home', 'PageUp'].includes(event.key) ? -1 : 1
      const start = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1
        : Math.min(filtered.length - 1, Math.max(0, active + direction * (event.key.startsWith('Page') ? 6 : 1)))
      const next = firstEnabled(start, event.key === 'Home' ? 1 : event.key === 'End' ? -1 : direction)
      if (next >= 0) active = next
      reveal()
      renderRows()
    } else if (!config.showSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      if (!popup) open()
      const now = Date.now()
      typeahead = (now - typedAt < 700 ? typeahead : '') + event.key.toLocaleLowerCase()
      typedAt = now
      const next = filtered.findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(typeahead))
      if (next >= 0) { active = next; reveal(); renderRows() }
    }
  }
  function click() { if (popup) close(true); else open() }
  function outside(event: PointerEvent) {
    if (!event.composedPath().some(inside)) close(false)
  }
  function scroll(event: Event) { if (event.target !== viewport) place() }
  function focusin(event: FocusEvent) {
    if (!inside(event.composedPath()[0])) return
    if (blurTimer !== undefined) { win.clearTimeout(blurTimer); blurTimer = undefined }
    if (!focused) { focused = true; config.onFocus?.() }
  }
  function focusout(event: FocusEvent) {
    if (blurTimer !== undefined) win.clearTimeout(blurTimer)
    const finish = () => {
      blurTimer = undefined
      if (!destroyed && focused && !inside(actualFocus())) {
        focused = false
        close(false)
        config.onBlur?.()
      }
    }
    if (event.relatedTarget && inside(event.relatedTarget)) return
    // activeElement can still be body during focusout. Let focusin settle first.
    blurTimer = win.setTimeout(finish, 0)
  }
  trigger.addEventListener('click', click)
  trigger.addEventListener('keydown', keydown)
  doc.addEventListener('focusin', focusin, true)
  doc.addEventListener('focusout', focusout, true)
  syncTrigger()
  return {
    update(next: SelectConfig) {
      const optionsChanged = config.options !== next.options && (
        config.options.length !== next.options.length || config.options.some((option, index) => {
          const other = next.options[index]
          return option.value !== other.value || option.label !== other.label ||
            option.disabled !== other.disabled || option.placeholder !== other.placeholder
        })
      )
      const valueChanged = JSON.stringify(config.value) !== JSON.stringify(next.value)
      const structureChanged = config.showSearch !== next.showSearch || config.virtual !== next.virtual || config.multiple !== next.multiple || config.allowClear !== next.allowClear || config.portalRoot !== next.portalRoot
      config = next
      syncTrigger()
      if (popup && structureChanged) { close(true); open() }
      else if (popup && optionsChanged) { filter(true); place() }
      else if (popup && valueChanged) { renderRows(); place() }
    },
    destroy() {
      destroyed = true
      close(false)
      trigger.removeEventListener('click', click)
      trigger.removeEventListener('keydown', keydown)
      doc.removeEventListener('focusin', focusin, true)
      doc.removeEventListener('focusout', focusout, true)
    }
  }
}
`
}
