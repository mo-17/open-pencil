import { describe, expect, test } from 'bun:test'

import { buildLowcodeToastRuntime } from '#compiler/adapters/react/lowcode/toast'
import { buildVueToastRuntime } from '#compiler/adapters/vue/lowcode/toast'

interface ToastRecord {
  id: number
  message: string
  variant: string
  position: string
}

interface ToastRuntime {
  show: (
    message: unknown,
    variant?: string,
    options?: { durationMs?: number; position?: string }
  ) => void
  dismiss: (id: number) => void
  clear: () => void
  pause: (id: number, reason: 'pointer' | 'focus') => void
  resume: (id: number, reason: 'pointer' | 'focus') => void
  snapshot: () => ToastRecord[]
  render: () => ToastHostElement
}

interface ToastHostElement {
  type: string
  props: Record<string, unknown>
  children: Array<ToastHostElement | string | ToastHostElement[]>
}

function loadRuntime(target: 'react' | 'vue') {
  let now = 0
  let sequence = 0
  const tasks = new Map<number, { at: number; run: () => void }>()
  const cleanup: Array<() => void> = []
  const source = (target === 'react' ? buildLowcodeToastRuntime() : buildVueToastRuntime())
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '')
  // Execute the emitted code with scoped framework hooks, without replacing global modules.
  const javascript = new Bun.Transpiler({
    loader: 'tsx',
    tsconfig: JSON.stringify({ compilerOptions: { jsx: 'react', jsxFactory: 'element' } })
  }).transformSync(source)
  const create = new Function(
    'setTimeout',
    'clearTimeout',
    'Date',
    'readonly',
    'shallowRef',
    'useEffect',
    'useSyncExternalStore',
    'element',
    'document',
    `${javascript}\nreturn {
      show: __opToast,
      dismiss: ${target === 'react' ? 'dismiss' : '__opDismissToast'},
      clear: typeof __opClearToasts === 'function' ? __opClearToasts : undefined,
      pause: typeof __opPauseToast === 'function' ? __opPauseToast : undefined,
      resume: typeof __opResumeToast === 'function' ? __opResumeToast : undefined,
      snapshot: () => ${target === 'react' ? 'toasts' : 'active.value'},
      render: typeof ToastHost === 'function' ? ToastHost : undefined
    }`
  )
  const runtime = create(
    (run: () => void, delay: number) => {
      const id = ++sequence
      tasks.set(id, { at: now + delay, run })
      return id
    },
    (id: number) => tasks.delete(id),
    { now: () => now },
    <T>(value: T) => value,
    <T>(value: T) => ({ value }),
    (effect: () => () => void) => cleanup.push(effect()),
    (_subscribe: unknown, snapshot: () => ToastRecord[]) => snapshot(),
    (
      type: string,
      props: Record<string, unknown> | null,
      ...children: ToastHostElement['children']
    ) => ({ type, props: props ?? {}, children }),
    { documentElement: { lang: 'zh-CN' } }
  ) as ToastRuntime
  return {
    runtime,
    pending: () => tasks.size,
    unmount: () => cleanup.forEach((remove) => remove()),
    advance(duration: number) {
      const targetTime = now + duration
      for (;;) {
        const next = [...tasks]
          .filter(([, task]) => task.at <= targetTime)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        now = next[1].at
        tasks.delete(next[0])
        next[1].run()
      }
      now = targetTime
    }
  }
}

describe.each(['react', 'vue'] as const)('generated %s toast lifecycle', (target) => {
  test('caps repeated actions and cancels dropped, closed and cleared timers', () => {
    const { runtime, pending } = loadRuntime(target)
    for (let index = 0; index < 8; index++) runtime.show('Saved ' + index, 'success')
    expect(runtime.snapshot().map((toast) => toast.message)).toEqual([
      'Saved 3',
      'Saved 4',
      'Saved 5',
      'Saved 6',
      'Saved 7'
    ])
    expect(pending()).toBe(5)
    runtime.show('Saved 7', 'success')
    expect(pending()).toBe(5)
    runtime.dismiss(runtime.snapshot()[0].id)
    expect(pending()).toBe(4)
    runtime.clear()
    expect(runtime.snapshot()).toEqual([])
    expect(pending()).toBe(0)
  })

  test('preserves the remaining reading time until both pointer and focus leave', () => {
    const { runtime, pending, advance } = loadRuntime(target)
    runtime.show('Saved', 'success', { durationMs: 3000 })
    const id = runtime.snapshot()[0].id
    advance(1000)
    runtime.pause(id, 'pointer')
    runtime.pause(id, 'focus')
    expect(pending()).toBe(0)
    advance(5000)
    runtime.resume(id, 'pointer')
    expect(pending()).toBe(0)
    runtime.resume(id, 'focus')
    expect(pending()).toBe(1)
    advance(1999)
    expect(runtime.snapshot()).toHaveLength(1)
    advance(1)
    expect(runtime.snapshot()).toEqual([])
    expect(pending()).toBe(0)
  })

  test('keeps authored persistent notices dismissible without creating timers', () => {
    const { runtime, pending, advance } = loadRuntime(target)
    runtime.show('Manual notice', 'info', { durationMs: 0 })
    const id = runtime.snapshot()[0].id
    runtime.pause(id, 'focus')
    runtime.resume(id, 'focus')
    advance(100_000)
    expect(runtime.snapshot()).toHaveLength(1)
    expect(pending()).toBe(0)
    runtime.dismiss(id)
    runtime.resume(id, 'pointer')
    expect(runtime.snapshot()).toEqual([])
    expect(pending()).toBe(0)
  })

  test('bounds runtime messages and uses finite durations and known variants', () => {
    const { runtime, advance } = loadRuntime(target)
    runtime.show('x'.repeat(4096), 'unknown', { durationMs: Number.NaN, position: 'elsewhere' })
    expect(runtime.snapshot()[0]).toMatchObject({
      message: 'x'.repeat(2048),
      variant: 'info',
      position: 'bottom-right'
    })
    advance(3000)
    expect(runtime.snapshot()).toEqual([])
    runtime.show('Long duration', 'info', { durationMs: 600_001 })
    advance(60_000)
    expect(runtime.snapshot()).toEqual([])
  })
})

test('React host announces success, supports named manual close, and clears timers on unmount', () => {
  const { runtime, pending, unmount } = loadRuntime('react')
  runtime.show('保存成功', 'success')
  const host = runtime.render()
  expect(host.props['aria-live']).toBe('polite')
  const visit = (node: ToastHostElement): ToastHostElement[] => [
    node,
    ...node.children
      .flat()
      .filter((child): child is ToastHostElement => typeof child !== 'string')
      .flatMap(visit)
  ]
  const nodes = visit(host)
  const notice = nodes.find((node) => node.props.role === 'status')
  expect(notice?.props['aria-atomic']).toBe('true')
  const close = nodes.find((node) => node.type === 'button')
  expect(close?.props['aria-label']).toBe('关闭通知')
  const click = close?.props.onClick
  if (typeof click !== 'function') throw new Error('Missing toast close handler')
  click()
  expect(runtime.snapshot()).toEqual([])
  expect(pending()).toBe(0)
  runtime.show('已复制', 'success')
  expect(pending()).toBe(1)
  unmount()
  expect(runtime.snapshot()).toEqual([])
  expect(pending()).toBe(0)
})
