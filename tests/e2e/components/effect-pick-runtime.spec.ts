import { expect, test, type JSHandle, type Page } from '@playwright/test'

import { effectPickRuntimeSource } from '@open-pencil/compiler/browser-preview'
import { EFFECT_PICK_CATALOG, type EffectPickConfigV1 } from '@open-pencil/core/plugins'

import { withEffectPickExport } from '#tests/helpers/compiler/modules/effect-pick/browser'

interface RuntimeController {
  play(): void
  pause(): void
  replay(): void
  setConfig(value: unknown): boolean
  setReducedMotion(value: boolean): void
  destroy(): void
}
type RuntimeFactory = (
  host: HTMLElement,
  config: unknown,
  onClick?: (event: MouseEvent) => void
) => RuntimeController

function config(id: string): EffectPickConfigV1 {
  const entry = EFFECT_PICK_CATALOG.find((candidate) => candidate.id === id)
  if (!entry) throw new Error(`Missing effect ${id}`)
  return { ...entry.defaultConfig }
}

async function runtimeFixture(page: Page): Promise<JSHandle<RuntimeFactory>> {
  await page.setContent('<main></main>')
  await page.addScriptTag({ content: effectPickRuntimeSource(EFFECT_PICK_CATALOG) })
  return page.evaluateHandle<RuntimeFactory>('mountEffectPick')
}

test.describe('EffectPick reviewed DOM runtime', () => {
  test('encodes text once, scopes two instances and destroys idempotently', async ({ page }) => {
    const runtime = await runtimeFixture(page)
    try {
      const result = await runtime.evaluate(
        (mount, { first, second }) => {
          const main = document.querySelector('main')
          if (!main) throw new Error('Missing fixture main')
          const a = document.createElement('div'),
            b = document.createElement('div')
          a.style.cssText = b.style.cssText = 'width:320px;height:180px'
          main.replaceChildren(a, b)
          let clicks = 0
          const instanceA = mount(a, first, () => {
              clicks += 1
            }),
            instanceB = mount(b, second)
          const button = a.shadowRoot?.querySelector<HTMLButtonElement>('button')
          if (!button) throw new Error('Missing button')
          button.click()
          const before = {
            text: button.textContent,
            clicks,
            otherText: b.shadowRoot?.textContent,
            escaped: a.shadowRoot?.querySelector('script,img') === null
          }
          instanceA.destroy()
          instanceA.destroy()
          instanceA.replay()
          const after = {
            destroyed: a.shadowRoot?.childElementCount,
            otherAlive: Boolean(b.shadowRoot?.querySelector('.fx'))
          }
          instanceB.destroy()
          return { before, after }
        },
        {
          first: {
            ...config('diagonal-fill'),
            text: '__EP_INSTANCE__ __EP_CHARACTERS__ <>&"\'汉字'
          },
          second: { ...config('water-text'), text: 'Other instance' }
        }
      )
      expect(result.before.text).toContain('__EP_INSTANCE__ __EP_CHARACTERS__ <>&"\'汉字')
      expect(result.before.clicks).toBe(1)
      expect(result.before.escaped).toBe(true)
      expect(result.before.otherText).toContain('Other instance')
      expect(result.after).toEqual({ destroyed: 0, otherAlive: true })
    } finally {
      await runtime.dispose()
    }
  })

  test('rejects unknown config, accessors, sentinel keys, functions and invalid bounds', async ({
    page
  }) => {
    const runtime = await runtimeFixture(page)
    try {
      const result = await runtime.evaluate((mount, valid) => {
        const host = document.createElement('div')
        document.body.append(host)
        const controller = mount(host, valid)
        let getterCalls = 0
        const getter = { ...valid }
        Object.defineProperty(getter, 'color', {
          enumerable: true,
          get() {
            getterCalls += 1
            return '#ffffff'
          }
        })
        const malicious = JSON.parse(
          JSON.stringify(valid).slice(0, -1) + ',"__proto__":{"hidden":true}}'
        )
        const rejected = [
          { ...valid, effectId: 'unknown' },
          { ...valid, collectionVersion: 'unknown' },
          { ...valid, artifactDigest: '0'.repeat(64) },
          { ...valid, color: 'url(https://example.com)' },
          { ...valid, speed: 0 },
          { ...valid, speed: Infinity },
          { ...valid, onClick: () => true },
          getter,
          malicious
        ].map((value) => controller.setConfig(value))
        const text = host.shadowRoot?.querySelector('button')?.textContent
        controller.destroy()
        host.remove()
        return { rejected, getterCalls, text }
      }, config('diagonal-fill'))
      expect(result.rejected).toEqual(Array.from({ length: 9 }, () => false))
      expect(result.getterCalls).toBe(0)
      expect(result.text).toContain(config('diagonal-fill').text)
    } finally {
      await runtime.dispose()
    }
  })

  test('matches canonical text, alpha-color and speed bounds and supersedes an old mount', async ({
    page
  }) => {
    const runtime = await runtimeFixture(page)
    try {
      const result = await runtime.evaluate((mount, valid) => {
        const host = document.createElement('div')
        document.body.append(host)
        const previous = mount(host, valid),
          current = mount(host, { ...valid, text: 'Current mount' })
        previous.destroy()
        const accepted = current.setConfig({
          ...valid,
          text: '🐚'.repeat(80),
          color: '#ABCDEF88',
          secondaryColor: '#123456',
          speed: 0.1
        })
        const upperSpeed = current.setConfig({ ...valid, speed: 4 })
        const rejected = [
          { ...valid, text: 'x'.repeat(161) },
          { ...valid, text: '🐚'.repeat(81) },
          { ...valid, color: '#123' },
          { ...valid, speed: 4.01 },
          { ...valid, speed: '1' }
        ].map((next) => current.setConfig(next))
        const priorRejected = previous.setConfig(valid),
          alive = Boolean(host.shadowRoot?.querySelector('button'))
        current.destroy()
        host.remove()
        return { accepted, upperSpeed, rejected, priorRejected, alive }
      }, config('diagonal-fill'))
      expect(result).toEqual({
        accepted: true,
        upperSpeed: true,
        rejected: [false, false, false, false, false],
        priorRejected: false,
        alive: true
      })
    } finally {
      await runtime.dispose()
    }
  })

  test('applies transition speed once and reduces blurred text to a readable static state', async ({
    page
  }) => {
    const runtime = await runtimeFixture(page)
    try {
      const result = await runtime.evaluate(
        async (mount, configs) => {
          const host = document.createElement('div')
          host.style.cssText = 'width:320px;height:180px'
          document.body.append(host)
          const diagonal = mount(host, configs.diagonal)
          const button = host.shadowRoot?.querySelector<HTMLButtonElement>('button')
          if (!button) throw new Error('Missing speed-test button')
          button.focus()
          void button.offsetWidth
          const surface = host.shadowRoot?.querySelector<HTMLElement>('[data-effect-pick-surface]')
          diagonal.play()
          const transitions =
            surface
              ?.getAnimations({ subtree: true })
              .filter((animation) => animation instanceof CSSTransition) ?? []
          await Promise.all(transitions.map((animation) => animation.ready))
          const timing = transitions.map((animation) => ({
            rate: animation.playbackRate,
            duration: animation.effect?.getTiming().duration
          }))
          diagonal.destroy()
          const blur = mount(host, configs.blur)
          const word = host.shadowRoot?.querySelector<HTMLElement>('.focus-word')
          if (!word) throw new Error('Missing reduced-motion word')
          const animation = word.getAnimations()[0]
          if (!animation) throw new Error('Missing blur animation')
          await animation.ready
          animation.pause()
          animation.currentTime = 1840
          const before = getComputedStyle(word).filter
          blur.setReducedMotion(true)
          const after = getComputedStyle(word).filter
          const remaining = word.getAnimations().length
          blur.destroy()
          host.remove()
          return { timing, before, after, remaining }
        },
        { diagonal: { ...config('diagonal-fill'), speed: 2 }, blur: config('blur-focus') }
      )
      expect(result.timing.length).toBeGreaterThan(0)
      expect(result.timing.every((timing) => timing.rate === 1 && timing.duration === 225)).toBe(
        true
      )
      expect(result.before).toBe('blur(8px)')
      expect(result.after).toBe('none')
      expect(result.remaining).toBe(0)
    } finally {
      await runtime.dispose()
    }
  })

  test('pauses CSS animation and honors app reduced motion', async ({ page }) => {
    const runtime = await runtimeFixture(page)
    const controller = await runtime.evaluateHandle((mount, authored) => {
      const host = document.createElement('div')
      host.style.cssText = 'width:320px;height:180px'
      document.body.append(host)
      return { controller: mount(host, authored), host }
    }, config('animated-gradient'))
    try {
      const paused = await controller.evaluate(({ controller, host }) => {
        controller.pause()
        return host.shadowRoot
          ?.querySelector<HTMLElement>('[data-effect-pick-surface]')
          ?.getAnimations({ subtree: true })
          .map((animation) => animation.playState)
      })
      expect(paused?.length).toBeGreaterThan(0)
      expect(paused?.every((state) => state === 'paused')).toBe(true)
      const reduced = await controller.evaluate(({ controller, host }) => {
        controller.replay()
        controller.setReducedMotion(true)
        const states = host.shadowRoot
          ?.querySelector<HTMLElement>('[data-effect-pick-surface]')
          ?.getAnimations({ subtree: true })
          .map((animation) => animation.playState)
        controller.destroy()
        host.remove()
        return states
      })
      expect(reduced?.every((state) => state === 'paused')).toBe(true)
    } finally {
      await controller.dispose()
      await runtime.dispose()
    }
  })
})

for (const target of ['react', 'vue'] as const) {
  test(`EffectPick ${target} export updates document state on click`, async ({ page }) => {
    const remoteRequests: string[] = []
    page.on('request', (request) => {
      if (
        /^https?:/.test(request.url()) &&
        !['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url()).hostname)
      )
        remoteRequests.push(request.url())
    })
    await withEffectPickExport(page, target, async () => {
      const defaultButton = page.getByRole('button', { name: '开始创作', exact: true })
      await expect(defaultButton).toBeVisible()
      const layout = await defaultButton.evaluate((button) => {
        const label = button.querySelector('.fx-label')
        if (!(label instanceof HTMLElement)) throw new Error('EffectPick label is missing')
        const range = document.createRange()
        range.selectNodeContents(label)
        return {
          lines: range.getClientRects().length,
          horizontalOverflow: label.scrollWidth > label.clientWidth + 1,
          verticalOverflow: label.scrollHeight > label.clientHeight + 1
        }
      })
      expect(layout).toEqual({ lines: 1, horizontalOverflow: false, verticalOverflow: false })
      await expect(page.getByText('Effect clicks: 0', { exact: true })).toBeVisible()
      const button = page.getByRole('button', { name: 'Count effect clicks' })
      await button.click()
      await expect(page.getByText('Effect clicks: 1', { exact: true })).toBeVisible()
      await button.click()
      await expect(page.getByText('Effect clicks: 2', { exact: true })).toBeVisible()
      expect(remoteRequests).toEqual([])
    })
  })
}
