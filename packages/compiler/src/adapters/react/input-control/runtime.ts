export function reactInputControlSource(): string {
  return `import * as React from 'react'
import { mountInputControl, listenInputReset, inputControlCSS, type InputControlConfig } from '../lib/open-pencil-input-control'
type Props = React.InputHTMLAttributes<HTMLInputElement> & { config: InputControlConfig; 'data-node-id'?: string }
export function OpenPencilInputControl({ config, className, style, 'data-node-id': nodeId, ...attributes }: Props) {
  const input = React.useRef<HTMLInputElement>(null), wrapper = React.useRef<HTMLSpanElement>(null)
  const controller = React.useRef<ReturnType<typeof mountInputControl> | null>(null)
  const latest = React.useRef({config,attributes}); latest.current = {config,attributes}
  React.useEffect(() => {
    const element = input.current, host = wrapper.current
    if (!element || !host) return
    controller.current = mountInputControl(host,element,latest.current.config,value => {
      const win = element.ownerDocument.defaultView
      if (!win || element.disabled || (latest.current.config.kind === 'color' ? latest.current.config.readOnly : element.readOnly)) return
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,'value')?.set?.call(element,value)
      element.dispatchEvent(new win.Event('input',{bubbles:true,composed:true}))
      element.dispatchEvent(new win.Event('change',{bubbles:true,composed:true}))
    })
    const unbindReset = listenInputReset(element, () => {
      if (latest.current.attributes.value !== undefined) element.value = String(latest.current.attributes.value)
      controller.current?.reset()
    })
    return () => { unbindReset(); controller.current?.destroy(); controller.current = null }
  },[attributes.form])
  React.useEffect(() => { controller.current?.update(config,attributes.type as InputControlConfig['kind'] | undefined) })
  return <><style>{inputControlCSS}</style><span ref={wrapper} data-op-input-control={config.kind} data-node-id={nodeId} className={className} style={style}><input {...attributes} ref={input} type={config.kind === 'color' ? 'text' : config.kind} readOnly={config.kind === 'color' ? config.readOnly : attributes.readOnly} pattern={config.kind === 'color' ? '#[0-9a-fA-F]{6}' : attributes.pattern} placeholder={config.kind === 'color' ? attributes.placeholder ?? '—' : attributes.placeholder}/></span></>
}
`
}
