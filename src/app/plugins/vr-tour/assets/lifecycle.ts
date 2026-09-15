import { VRTourSampleAssetError, type VRTourSampleAssetManager } from './types'

/** Order plugin-state commits with cache removal, including an install already committing. */
export function createVRTourSamplePluginLifecycle(
  resources: Pick<VRTourSampleAssetManager, 'ensure' | 'remove'>
) {
  let generation = 0
  let tail: Promise<void> = Promise.resolve()
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation)
    tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
  return {
    install<T>(commit: () => Promise<T>): Promise<T> {
      const requestedGeneration = generation
      return enqueue(async () => {
        const assertCurrent = () => {
          if (generation !== requestedGeneration) throw new VRTourSampleAssetError('cancelled')
        }
        assertCurrent()
        await resources.ensure()
        assertCurrent()
        return commit()
      })
    },
    uninstall<T>(commit: () => Promise<T>): Promise<T> {
      generation += 1
      // Abort downloads immediately; capture errors while waiting for an earlier state commit.
      const removal = resources.remove().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      )
      return enqueue(async () => {
        const result = await removal
        if (!result.ok) throw result.error
        return commit()
      })
    }
  }
}
