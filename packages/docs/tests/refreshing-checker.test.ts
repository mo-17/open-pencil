import { describe, expect, test } from 'bun:test'

import {
  createRefreshingChecker,
  type RefreshableFileChecker
} from '../.vitepress/sdk/refreshing-checker'

class FakeChecker implements RefreshableFileChecker {
  reloads = 0
  updates: Array<{ path: string; source: string }> = []

  reload(): void {
    this.reloads += 1
  }

  updateFile(path: string, source: string): void {
    this.updates.push({ path, source })
  }
}

describe('shared component metadata checker refreshes', () => {
  test('updates only changed component sources', () => {
    const sources = new Map([
      ['/tsconfig.json', '{}'],
      ['/Button.vue', '<template>before</template>']
    ])
    const checker = new FakeChecker()
    const service = createRefreshingChecker(checker, '/tsconfig.json', (path) => sources.get(path)!)

    service.refreshFile('/Button.vue')
    service.refreshFile('/Button.vue')
    sources.set('/Button.vue', '<template>after</template>')
    service.refreshFile('/Button.vue')

    expect(checker.updates).toEqual([{ path: '/Button.vue', source: '<template>after</template>' }])
  })

  test('reloads once when the tsconfig changes and resets source snapshots', () => {
    const sources = new Map([
      ['/tsconfig.json', '{}'],
      ['/Button.vue', '<template>before</template>']
    ])
    const checker = new FakeChecker()
    const service = createRefreshingChecker(checker, '/tsconfig.json', (path) => sources.get(path)!)

    service.refreshFile('/Button.vue')
    sources.set('/tsconfig.json', '{"strict":true}')
    service.refreshConfig()
    service.refreshConfig()
    service.refreshFile('/Button.vue')

    expect(checker.reloads).toBe(1)
    expect(checker.updates).toEqual([])
  })
})
