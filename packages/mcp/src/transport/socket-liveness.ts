/**
 * Returns true only for Unix-socket connection errors that prove no listener
 * owns the path. Other errors remain inconclusive so cleanup never unlinks a
 * potentially live server's socket.
 */
export function isDeadSocketConnectError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ECONNREFUSED' || code === 'ENOENT'
}
