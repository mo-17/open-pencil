import { IS_BROWSER } from '@/constants'

export type TestCollabTransportEnvironment = Readonly<{
  isBrowser: boolean
  isDevelopment: boolean
  mode: string
  search: string
}>

export function allowsTestCollabTransport({
  isBrowser,
  isDevelopment,
  mode,
  search
}: TestCollabTransportEnvironment): boolean {
  if (!isBrowser || (!isDevelopment && mode !== 'native-test')) return false
  return new URLSearchParams(search).get('collabTransport') === 'test'
}

export function usesTestCollabTransport(): boolean {
  return allowsTestCollabTransport({
    isBrowser: IS_BROWSER,
    isDevelopment: import.meta.env.DEV,
    mode: import.meta.env.MODE,
    search: IS_BROWSER ? window.location.search : ''
  })
}
