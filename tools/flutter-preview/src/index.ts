import { BoundedEventWriter, runFlutterPreviewProtocol } from './protocol'

export async function runFlutterPreviewCompanion(): Promise<void> {
  const writer = new BoundedEventWriter(
    (line) =>
      new Promise<void>((resolve, reject) => {
        process.stdout.write(line, (error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
  )
  await runFlutterPreviewProtocol(process.stdin, writer, undefined, (stop) => {
    const signal = () => {
      void stop().finally(() => process.exit(0))
    }
    process.once('SIGTERM', signal)
    process.once('SIGINT', signal)
    return () => {
      process.removeListener('SIGTERM', signal)
      process.removeListener('SIGINT', signal)
    }
  })
}

if (import.meta.main) await runFlutterPreviewCompanion()
