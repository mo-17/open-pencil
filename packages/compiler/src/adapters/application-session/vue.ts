export const VUE_APPLICATION_SESSION_FILE = 'src/lib/open-pencil-application-session-vue.ts'

export function vueApplicationSessionSource(): string {
  return `import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { applicationPageKey, mountApplicationScroll, observeApplicationRestore, readApplicationState, writeApplicationState } from './open-pencil-application-session'
export function useApplicationPageState<T>(pageId: string, name: string, initial: T): Ref<T> {
  const route = useRoute()
  const key = applicationPageKey(pageId, route.path, route.fullPath.slice(route.path.length).split('#')[0])
  const value = ref(readApplicationState(key, name, initial)) as Ref<T>
  const stop = watch(value, (next) => writeApplicationState(key, name, next), { deep: true, flush: 'sync' })
  const remove = observeApplicationRestore(() => { value.value = readApplicationState(key, name, initial) })
  onBeforeUnmount(() => { stop(); remove() })
  return value
}
export function useApplicationPageScroll(pageId: string, retention: 'reset' | 'preserve'): void {
  const route = useRoute()
  const key = applicationPageKey(pageId, route.path, route.fullPath.slice(route.path.length).split('#')[0])
  let remove: (() => void) | undefined
  onMounted(() => { remove = mountApplicationScroll(key, retention) })
  onBeforeUnmount(() => { remove?.() })
}
`
}
