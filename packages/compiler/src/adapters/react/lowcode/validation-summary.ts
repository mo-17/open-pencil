import { MOUNTED_VALIDATION_SUMMARY_OBSERVER } from '#compiler/adapters/validation-summary'

export function buildReactMountedValidationSummary(errorClass: string): string {
  return `
import { useEffect, useRef, useState } from 'react'

${MOUNTED_VALIDATION_SUMMARY_OBSERVER}

export function __OpenPencilMountedValidationSummary({ fieldKeys, errors, title }: {
  fieldKeys: readonly string[]
  errors: Readonly<Record<string, string | null>>
  title: string
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const [mountedKeys, setMountedKeys] = useState<string[]>([])
  useEffect(() => {
    if (!anchor.current) return
    return __opObserveMountedValidationKeys(anchor.current, setMountedKeys)
  }, [])
  const keys = fieldKeys.filter(key => mountedKeys.includes(key) && errors[key])
  return <div ref={anchor} hidden={keys.length === 0} className=${JSON.stringify(errorClass)} role="alert">
    {keys.length > 0 && <><p>{title}</p><ul>{keys.map(key => <li key={key}>{errors[key]}</li>)}</ul></>}
  </div>
}
`
}
