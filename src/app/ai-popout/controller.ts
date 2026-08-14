import { parseAIPopoutPayload, type AIPopoutPayload } from './payload'

export interface AIPopoutView {
  apply: (payload: AIPopoutPayload) => void
}

export interface AIPopoutController {
  update: (value: unknown) => boolean
  snapshot: () => AIPopoutPayload | null
}

export function createAIPopoutController(view: AIPopoutView): AIPopoutController {
  let latest: AIPopoutPayload | null = null
  return {
    update(value) {
      const next = parseAIPopoutPayload(value)
      if (latest && next.revision <= latest.revision) return false
      view.apply(next)
      latest = next
      return true
    },
    snapshot() {
      return latest
    }
  }
}
