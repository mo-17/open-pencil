/** Generated, DOM-owned native picker; business data stays in the named text input. */
export function colorInputRuntimeSource(): string {
  return `function mountColorInput(wrapper: HTMLElement, input: HTMLInputElement, readonly: () => boolean, commit: (value: string) => void, label: (english: string, chinese: string) => string) {
  const document = input.ownerDocument, swatch = document.createElement('span'), picker = document.createElement('input')
  let disposed = false
  swatch.setAttribute('data-color-swatch',''); picker.type='color'; picker.setAttribute('data-color-picker','')
  swatch.append(picker); wrapper.insertBefore(swatch,input)
  const valid = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value)
  function refresh() {
    if (disposed) return
    const value = input.value, hasColor = valid(value), form = input.getAttribute('form')
    picker.disabled = input.disabled || readonly()
    if (form !== null) picker.setAttribute('form',form); else picker.removeAttribute('form')
    // This black value is only the native chooser's unavoidable fallback. It has no name,
    // never participates in submitted data, and is never written into business state.
    picker.value = hasColor ? value.toLowerCase() : '#000000'
    swatch.style.background = hasColor ? value : 'repeating-linear-gradient(135deg,#f1f5f9 0 5px,#cbd5e1 5px 6px)'
    swatch.setAttribute('data-color-empty',String(!hasColor)); swatch.style.opacity = picker.disabled ? '.45' : '1'
    wrapper.setAttribute('data-color-readonly',String(readonly()))
    const name = input.getAttribute('aria-label') || Array.from(input.labels ?? []).map(item=>item.textContent ?? '').join(' ').trim()
    picker.setAttribute('aria-label',label('Choose color','选择颜色') + (name ? ': ' + name : ''))
    picker.setAttribute('aria-required',String(input.required))
    const invalid = (value !== '' && !hasColor) || (value === '' && input.required)
    picker.setCustomValidity(invalid ? label('Choose a six-digit hex color.','请选择六位十六进制颜色。') : '')
    if (invalid) picker.setAttribute('aria-invalid','true'); else picker.removeAttribute('aria-invalid')
  }
  function change() {
    if (disposed || picker.disabled || readonly() || input.disabled || !valid(picker.value)) return
    // Native pickers may emit both events for one selection; keep one business write.
    if (input.value !== picker.value) commit(picker.value)
    refresh()
  }
  picker.addEventListener('input',change); picker.addEventListener('change',change)
  refresh()
  return { refresh, destroy() { disposed=true; picker.removeEventListener('input',change);picker.removeEventListener('change',change);swatch.remove();wrapper.removeAttribute('data-color-readonly') } }
}
`
}
