/** Browser and Node declarations disagree on timer handles; inspect the runtime capability. */
export function unrefTimer(timer: unknown): void {
  if (typeof timer !== 'object' || timer === null) return
  const unref = Reflect.get(timer, 'unref')
  if (typeof unref === 'function') Reflect.apply(unref, timer, [])
}
