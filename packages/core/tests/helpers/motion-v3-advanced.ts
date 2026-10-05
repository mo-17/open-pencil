import { parseMotionSpec } from '@open-pencil/scene-graph'

import example from '../fixtures/motion-v3-advanced.json'

/** Fresh validator-checked data covering every structured Motion v3 channel. */
export function advancedMotionSpec() {
  return parseMotionSpec(structuredClone(example))
}
