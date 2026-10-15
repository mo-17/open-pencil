/** Do not keep Node running for a background timer; numeric browser/Bun handles stay valid. */
export function unrefTimer(timer: number | { unref(): unknown }): void {
  if (typeof timer !== 'number') timer.unref()
}
