import type { Locator } from '@playwright/test'

import {
  TEAM_MOTION_LIBRARY_FORMAT,
  TEAM_MOTION_LIBRARY_SCHEMA_VERSION,
  exportTeamMotionPublicKey,
  serializeTeamMotionLibraryManifest,
  signTeamMotionLibraryManifest,
  type MotionSpec,
  type MotionTrack,
  type TeamMotionLibraryPayload
} from '@open-pencil/scene-graph'

import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { readMotionActionSnapshot, readSelectedMotion } from '#tests/helpers/motion'
import { chooseAppSelect, propertySection } from '#tests/helpers/properties'

const editor = useEditorSetupWithClear()

async function createRectangles(count: number) {
  return editor.page.evaluate((total) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const ids = Array.from({ length: total }, (_, index) =>
      store.createShape('RECTANGLE', 120 + index * 140, 120, 100, 80)
    )
    store.select(ids)
    store.state.sceneVersion++
    return ids
  }, count)
}

const selectedMotion = () => readSelectedMotion(editor.page)

async function signedTeamMotionFixture(libraryId: string) {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const payload: TeamMotionLibraryPayload = {
    format: TEAM_MOTION_LIBRARY_FORMAT,
    schemaVersion: TEAM_MOTION_LIBRARY_SCHEMA_VERSION,
    publisher: { id: 'e2e-motion-team', name: 'E2E Motion Team', keyId: 'e2e-motion-key' },
    library: { id: libraryId, name: 'E2E Team Motion' },
    version: '1.0.0',
    engineRange: '>=0.13.0 <1.0.0',
    source: { kind: 'url', ref: 'https://example.com/e2e-team-motion.json' },
    entries: [
      {
        kind: 'preset',
        preset: {
          id: 'user-e2e-team-rise',
          revision: 1,
          name: 'Team rise',
          category: 'entrance',
          motion: {
            version: 3,
            tracks: [
              {
                id: 'team-rise',
                trigger: 'mount',
                keyframes: [
                  { offset: 0, y: 24, opacity: 0 },
                  { offset: 1, y: 0, opacity: 1 }
                ],
                timing: { durationMs: 420 },
                composition: { mode: 'replace' }
              }
            ]
          }
        }
      }
    ]
  }
  const manifest = await signTeamMotionLibraryManifest(payload, keyPair.privateKey)
  return {
    manifestJson: serializeTeamMotionLibraryManifest(manifest),
    publicKeyPem: await exportTeamMotionPublicKey(keyPair.publicKey)
  }
}

async function setupMotionActions() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page not found')

    const firstTarget = store.graph.createNode('RECTANGLE', page.id, {
      name: 'Card motion',
      x: 120,
      y: 120,
      width: 100,
      height: 80,
      motion: {
        version: 1,
        tracks: [
          {
            id: 'fade',
            trigger: 'mount',
            keyframes: [
              { offset: 0, opacity: 0 },
              { offset: 1, opacity: 1 }
            ],
            timing: { durationMs: 240 }
          }
        ]
      }
    })
    const secondTarget = store.graph.createNode('RECTANGLE', page.id, {
      name: 'Panel motion',
      x: 260,
      y: 120,
      width: 100,
      height: 80,
      motion: {
        version: 1,
        tracks: [
          {
            id: 'rise',
            trigger: 'click',
            keyframes: [
              { offset: 0, y: 0 },
              { offset: 1, y: -12 }
            ],
            timing: { durationMs: 320 }
          }
        ]
      }
    })
    store.graph.createNode('RECTANGLE', page.id, {
      name: 'No motion',
      x: 400,
      y: 120,
      width: 100,
      height: 80
    })
    const button = store.graph.createNode('BUTTON', page.id, {
      name: 'Motion controls',
      x: 120,
      y: 240,
      width: 160,
      height: 44
    })
    store.graph.updateNode(store.graph.rootId, {
      lowcodeWorkflows: [{ id: 'wf-motion', name: 'Motion workflow', actions: [] }]
    })
    store.select([button.id])
    store.requestRender()
    return {
      buttonId: button.id,
      firstTargetId: firstTarget.id,
      secondTargetId: secondTarget.id
    }
  })
}

async function openMotionTimeline(): Promise<Locator> {
  await createRectangles(1)
  await editor.canvas.waitForRender()
  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await section.getByTestId('motion-preset-apply-builtin:slide-up').click()
  const timeline = section.getByTestId('motion-timeline')
  await timeline.scrollIntoViewIfNeeded()
  return timeline
}

async function selectedMotionSpec(): Promise<MotionSpec> {
  const motion = (await selectedMotion())[0]
  if (!motion) throw new Error('Expected selected node motion')
  return motion
}

async function selectedMotionTrack(index = 0): Promise<MotionTrack> {
  const track = (await selectedMotionSpec()).tracks.at(index)
  if (!track) throw new Error(`Expected selected motion track ${index}`)
  return track
}

async function dragAndDuplicateTimelineKeyframe(timeline: Locator): Promise<void> {
  await timeline.getByTestId('motion-playhead').fill('200')
  await timeline.getByTestId('motion-add-keyframe').click()
  const marker = timeline.getByTestId('motion-keyframe-slide-up-1')
  const rail = marker.locator('..')
  await marker.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
  const railBox = await rail.boundingBox()
  const markerBox = await marker.boundingBox()
  if (!railBox || !markerBox) throw new Error('Expected timeline marker geometry')
  await editor.page.mouse.move(
    markerBox.x + markerBox.width / 2,
    markerBox.y + markerBox.height / 2
  )
  await editor.page.mouse.down()
  await editor.page.mouse.move(railBox.x + railBox.width * 0.55, railBox.y + railBox.height / 2, {
    steps: 4
  })
  await editor.page.mouse.up()

  expect((await selectedMotionTrack()).keyframes[1]?.offset).toBeCloseTo(0.55, 1)
  await editor.canvas.undo()
  expect((await selectedMotionTrack()).keyframes[1]?.offset).toBe(0.4)

  await timeline.getByTestId('motion-keyframe-slide-up-1').click()
  await timeline.getByTestId('motion-duplicate-keyframe').click()
  expect((await selectedMotionTrack()).keyframes.map((keyframe) => keyframe.offset)).toEqual([
    0, 0.4, 0.7, 1
  ])
}

async function editTimelineCubicEasing(timeline: Locator): Promise<void> {
  await chooseAppSelect(editor.page, timeline.getByTestId('motion-keyframe-easing'), 'Cubic Bézier')
  await expect(timeline.getByTestId('motion-keyframe-easing-curve')).toBeVisible()
  expect((await selectedMotionTrack()).keyframes[2]?.easing).toMatchObject({ type: 'cubicBezier' })

  const curve = timeline.getByTestId('motion-keyframe-easing-curve')
  const control = timeline.getByTestId('motion-keyframe-easing-control-1')
  const curveBox = await curve.boundingBox()
  const controlBox = await control.boundingBox()
  if (!curveBox || !controlBox) throw new Error('Expected cubic Bézier editor geometry')
  await editor.page.mouse.move(
    controlBox.x + controlBox.width / 2,
    controlBox.y + controlBox.height / 2
  )
  await editor.page.mouse.down()
  await editor.page.mouse.move(
    curveBox.x + curveBox.width * 0.45,
    curveBox.y + curveBox.height * 0.4,
    { steps: 3 }
  )
  await editor.page.mouse.up()
  const draggedEasing = (await selectedMotionTrack()).keyframes[2]?.easing
  const draggedX1 = typeof draggedEasing === 'object' ? draggedEasing.x1 : undefined
  expect(draggedX1).toBeGreaterThan(0.25)
  expect(draggedX1).toBeLessThanOrEqual(1)

  const preciseX1 = timeline.locator('[data-property="motion-keyframe-easing-x1"]')
  await preciseX1.click()
  await preciseX1.locator('input[data-slot="input"]').fill('0.42')
  await preciseX1.locator('input[data-slot="input"]').press('Enter')
  const preciseEasing = (await selectedMotionTrack()).keyframes[2]?.easing
  expect(typeof preciseEasing === 'object' ? preciseEasing.x1 : undefined).toBe(0.42)
}

async function organizeTimelineTracks(timeline: Locator): Promise<void> {
  const name = timeline.getByTestId('motion-track-name')
  await name.fill('intro')
  await name.press('Enter')
  expect((await selectedMotionTrack()).id).toBe('intro')

  await timeline.getByTestId('motion-duplicate-track').click()
  expect((await selectedMotionSpec()).tracks.map((track) => track.id)).toEqual(['intro', 'track-1'])
  await timeline.getByTestId('motion-move-track-up').click()
  expect((await selectedMotionSpec()).tracks.map((track) => track.id)).toEqual(['track-1', 'intro'])
}

async function editTimelineV2Easings(timeline: Locator): Promise<void> {
  await expect(timeline.getByTestId('motion-v2-channels')).toHaveCount(0)
  await timeline.getByTestId('motion-v2-upgrade-button').click()
  expect((await selectedMotionSpec()).version).toBe(2)
  await expect(timeline.getByTestId('motion-v2-channels')).toBeVisible()

  await chooseAppSelect(editor.page, timeline.getByTestId('motion-track-easing'), 'Hold')
  expect((await selectedMotionTrack()).timing.easing).toEqual({ type: 'hold' })
  await expect(timeline.getByTestId('motion-easing-curve')).toHaveCount(0)

  await chooseAppSelect(editor.page, timeline.getByTestId('motion-track-easing'), 'Steps')
  await expect(timeline.getByTestId('motion-easing-steps')).toBeVisible()
  const stepCount = timeline.locator('[data-property="motion-easing-steps-count"]')
  await stepCount.click()
  await stepCount.locator('input[data-slot="input"]').fill('7')
  await stepCount.locator('input[data-slot="input"]').press('Enter')
  await chooseAppSelect(editor.page, timeline.getByTestId('motion-easing-steps-position'), 'Start')
  expect((await selectedMotionTrack()).timing.easing).toEqual({
    type: 'steps',
    steps: 7,
    position: 'start'
  })

  await chooseAppSelect(editor.page, timeline.getByTestId('motion-track-easing'), 'Spring')
  await expect(timeline.getByTestId('motion-easing-spring')).toBeVisible()
  const springMass = timeline.locator('[data-property="motion-easing-spring-mass"]')
  await springMass.click()
  await springMass.locator('input[data-slot="input"]').fill('2.5')
  await springMass.locator('input[data-slot="input"]').press('Enter')
  expect((await selectedMotionTrack()).timing.easing).toMatchObject({ type: 'spring', mass: 2.5 })

  await chooseAppSelect(editor.page, timeline.getByTestId('motion-track-easing'), 'Inertia')
  await expect(timeline.getByTestId('motion-easing-inertia')).toBeVisible()
  const deceleration = timeline.locator('[data-property="motion-easing-inertia-deceleration"]')
  await deceleration.click()
  await deceleration.locator('input[data-slot="input"]').fill('0.2')
  await deceleration.locator('input[data-slot="input"]').press('Enter')
  expect((await selectedMotionTrack()).timing.easing).toEqual({
    type: 'inertia',
    velocity: 0,
    deceleration: 0.2
  })
}

async function upgradeMotionTimeline(timeline: Locator): Promise<void> {
  await expect(timeline.getByTestId('motion-v2-upgrade')).toBeVisible()
  await expect(timeline.getByTestId('motion-v2-channels')).toHaveCount(0)
  await expect(timeline.getByTestId('motion-path-controls')).toHaveCount(0)
  await timeline.getByTestId('motion-v2-upgrade-button').click()
  expect((await selectedMotionSpec()).version).toBe(2)
  await editor.canvas.undo()
  expect((await selectedMotionSpec()).version).toBe(1)
  await expect(timeline.getByTestId('motion-v2-channels')).toHaveCount(0)
  await editor.canvas.redo()
  expect((await selectedMotionSpec()).version).toBe(2)
}

async function expectMotionV2ChannelControls(timeline: Locator): Promise<void> {
  const numericChannels = [
    'originX',
    'originY',
    'width',
    'height',
    'cornerRadius',
    'strokeWidth',
    'blur',
    'shadowX',
    'shadowY',
    'shadowBlur',
    'shadowSpread',
    'trimStart',
    'trimEnd',
    'trimOffset',
    'gap',
    'rowGap',
    'columnGap',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft'
  ]
  for (const channel of numericChannels) {
    await expect(timeline.getByTestId(`motion-v2-toggle-${channel}`)).toHaveCount(1)
  }
  for (const channel of ['fillColor', 'strokeColor', 'shadowColor']) {
    await expect(timeline.getByTestId(`motion-v2-${channel}`)).toHaveCount(1)
  }

  await expect(timeline.getByTestId('motion-v2-fillColor').getByRole('checkbox')).toBeEnabled()
  await expect(timeline.getByTestId('motion-v2-strokeColor').getByRole('checkbox')).toBeDisabled()
  await expect(timeline.getByTestId('motion-v2-toggle-strokeWidth')).toBeDisabled()
  await expect(timeline.getByTestId('motion-v2-toggle-cornerRadius')).toBeEnabled()
  await expect(timeline.getByTestId('motion-v2-toggle-trimStart')).toBeDisabled()
  await expect(timeline.getByTestId('motion-v2-toggle-gap')).toBeDisabled()
  await expect(timeline.getByTestId('motion-v2-channel-gap')).toHaveAttribute(
    'data-capability-disabled',
    'true'
  )
  await expect(timeline.getByTestId('motion-v2-toggle-gap')).toHaveAttribute(
    'aria-description',
    /\S+/
  )
  await timeline.getByTestId('motion-v2-channel-gap').hover()
  await expect(timeline.page().getByRole('tooltip')).toHaveText(/\S+/)
  await expect(timeline.getByTestId('motion-v2-toggle-blur')).toBeEnabled()
  await expect(timeline.getByTestId('motion-v2-shadowColor').getByRole('checkbox')).toBeEnabled()
}

async function editMotionV2WidthAndFill(timeline: Locator): Promise<void> {
  await timeline.getByTestId('motion-v2-toggle-width').check()
  expect((await selectedMotionTrack()).keyframes.map((keyframe) => keyframe.width)).toEqual([
    100, 100
  ])
  const width = timeline.locator('[data-property="motion-v2-width"]')
  await width.click()
  await width.locator('input[data-slot="input"]').fill('160')
  await width.locator('input[data-slot="input"]').press('Enter')
  expect((await selectedMotionTrack()).keyframes.map((keyframe) => keyframe.width)).toEqual([
    160, 100
  ])

  await timeline.getByTestId('motion-v2-fillColor').getByRole('checkbox').check()
  const fillRed = timeline.locator('[data-property="motion-v2-fillColor-r"]')
  await fillRed.click()
  await fillRed.locator('input[data-slot="input"]').fill('0.4')
  await fillRed.locator('input[data-slot="input"]').press('Enter')
  const keyframes = (await selectedMotionTrack()).keyframes
  expect(keyframes[0]?.fillColor?.r).toBe(0.4)
  expect(keyframes.every((keyframe) => keyframe.fillColor !== undefined)).toBe(true)
}

async function editMotionPathAndInsertKeyframe(timeline: Locator): Promise<void> {
  await timeline.getByTestId('motion-path-enabled').check()
  await timeline.getByTestId('motion-path-auto-rotate').check()
  await timeline.getByTestId('motion-path-add-point').click()
  const pathX = timeline.locator('[data-property="motion-path-point-2-x"]')
  await pathX.click()
  await pathX.locator('input[data-slot="input"]').fill('180')
  await pathX.locator('input[data-slot="input"]').press('Enter')
  const progress = timeline.locator('[data-property="motion-v2-pathProgress"]')
  await progress.click()
  await progress.locator('input[data-slot="input"]').fill('0.25')
  await progress.locator('input[data-slot="input"]').press('Enter')
  let track = await selectedMotionTrack()
  expect(track.path).toMatchObject({
    autoRotate: true,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 180, y: 0 }
    ]
  })
  expect(track.keyframes.map((keyframe) => keyframe.pathProgress)).toEqual([0.25, 1])

  await timeline.getByTestId('motion-playhead').fill('250')
  await timeline.getByTestId('motion-add-keyframe').click()
  track = await selectedMotionTrack()
  expect(track.keyframes.map((keyframe) => keyframe.offset)).toEqual([0, 0.5, 1])
  expect(track.keyframes.every((keyframe) => keyframe.width !== undefined)).toBe(true)
  expect(track.keyframes.every((keyframe) => keyframe.fillColor !== undefined)).toBe(true)
  expect(track.keyframes.every((keyframe) => keyframe.pathProgress !== undefined)).toBe(true)
  const middle = track.keyframes.at(1)
  if (!middle) throw new Error('Expected interpolated advanced keyframe')
  expect(middle.width).toBeGreaterThan(100)
  expect(middle.width).toBeLessThan(160)
  expect(middle.pathProgress).toBeGreaterThan(0.25)
  expect(middle.pathProgress).toBeLessThan(1)

  await timeline.getByTestId('motion-path-enabled').uncheck()
  track = await selectedMotionTrack()
  expect(track.path).toBeUndefined()
  expect(track.keyframes.every((keyframe) => keyframe.pathProgress === undefined)).toBe(true)
}

test.beforeEach(async () => {
  await editor.page.evaluate(() => {
    const storageName = 'localStorage'
    window[storageName].removeItem('open-pencil:inspector-section:motion')
    window[storageName].removeItem('open-pencil:motion-preset-library:v1')
  })
  await editor.page.reload()
  await editor.canvas.waitForInit()
})

test('single-selection presets are keyboard accessible and expose motion controls', async () => {
  await createRectangles(1)
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await expect(section).toBeVisible()
  await expect(section.getByRole('group', { name: 'Presets' })).toBeVisible()
  await expect(section.getByTestId(/^motion-preset-apply-builtin:/)).toHaveCount(8)

  const fadeIn = section.getByTestId('motion-preset-apply-builtin:fade-in')
  await fadeIn.focus()
  await expect(fadeIn).toBeFocused()
  await fadeIn.press('Space')
  await editor.canvas.waitForRender()

  await expect(fadeIn).toHaveAttribute('aria-pressed', 'true')
  await expect(section.getByTestId('motion-timeline')).toBeVisible()
  expect((await selectedMotion())[0]?.preset?.id).toBe('fade-in')
  await expect(section.getByTestId('motion-trigger')).toBeEnabled()
  await expect(section.getByRole('spinbutton', { name: 'Duration', exact: true })).toBeEnabled()
  await expect(section.getByRole('spinbutton', { name: 'Delay', exact: true })).toBeEnabled()
  await expect(section.getByRole('combobox', { name: 'Reduced motion' })).toBeEnabled()
  const preview = section.getByTestId('motion-preview')
  await expect(preview).toBeEnabled()
  await preview.click()
  const stopPreview = section.getByRole('button', { name: 'Stop preview', exact: true })
  await expect(stopPreview).toBeVisible()
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().isMotionPreviewActive())
  ).toBe(true)
  await expect(preview).toBeVisible({ timeout: 2_000 })
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().isMotionPreviewActive())
  ).toBe(false)

  await preview.click()
  await expect(stopPreview).toBeVisible()
  await stopPreview.click()
  await expect(preview).toBeVisible()
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().isMotionPreviewActive())
  ).toBe(false)
  await expect(section.getByRole('button', { name: 'Clear motion' })).toBeEnabled()
})

test('Figma native adapter exposes only compatible Motion as a safe selection script', async () => {
  await createRectangles(1)
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await section.getByTestId('motion-preset-apply-builtin:fade-in').click()

  const adapter = section.getByTestId('figma-motion-adapter')
  await expect(adapter).toBeVisible()
  await expect(adapter.getByTestId('figma-motion-status')).toContainText('Compatible')
  const copy = adapter.getByTestId('figma-motion-copy-script')
  await expect(copy).toBeEnabled()

  await editor.page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value: string) {
          Object.assign(window, { __figmaMotionScript: value })
          return Promise.resolve()
        }
      }
    })
  })
  await copy.click()
  await expect(copy).toHaveText('Copied')
  expect(
    await editor.page.evaluate(
      () => (window as typeof window & { __figmaMotionScript?: string }).__figmaMotionScript
    )
  ).toContain('"conflictPolicy": "replace-owned"')

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const id = store ? [...store.state.selectedIds][0] : undefined
    const node = id ? store?.graph.getNode(id) : undefined
    const motion = node?.motion
    const track = motion?.tracks[0]
    if (!store || !node || !motion || !track) throw new Error('Expected selected Motion node')
    store.graph.updateNode(node.id, {
      motion: { ...motion, tracks: [{ ...track, trigger: 'hover' }] }
    })
    store.requestRender()
  })

  await expect(adapter.getByTestId('figma-motion-status')).toContainText('cannot be converted')
  await expect(copy).toBeDisabled()
})

test('preset cards preview without authoring and stop on pointer leave or Escape', async () => {
  await createRectangles(1)
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  const slideUp = section.getByTestId('motion-preset-apply-builtin:slide-up')
  const undoLabelBeforePreview = await editor.page.evaluate(
    () => window.openPencil?.getStore?.().undo.undoLabel
  )

  await slideUp.hover()
  expect((await selectedMotion())[0]).toBeUndefined()
  expect(
    await editor.page.evaluate(() => {
      const store = window.openPencil?.getStore?.()
      return {
        active: store?.hasMotionPreview(),
        targetSpec: store?.state.motionPreview?.targets[0]?.spec,
        undoLabel: store?.undo.undoLabel
      }
    })
  ).toMatchObject({
    active: true,
    targetSpec: { preset: { id: 'slide-up' } },
    undoLabel: undoLabelBeforePreview
  })

  await slideUp.dispatchEvent('pointerleave')
  expect(await editor.page.evaluate(() => window.openPencil?.getStore?.().hasMotionPreview())).toBe(
    false
  )
  expect((await selectedMotion())[0]).toBeUndefined()

  await slideUp.focus()
  expect(await editor.page.evaluate(() => window.openPencil?.getStore?.().hasMotionPreview())).toBe(
    true
  )
  await editor.page.keyboard.press('Escape')
  expect(await editor.page.evaluate(() => window.openPencil?.getStore?.().hasMotionPreview())).toBe(
    false
  )
  expect((await selectedMotion())[0]).toBeUndefined()
})

test('preset library searches, persists favorites, and exchanges Chinese personal presets', async () => {
  await createRectangles(1)
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  const search = section.getByTestId('motion-preset-search')
  await search.fill('slide')
  await expect(section.getByTestId(/^motion-preset-card-/)).toHaveCount(1)
  await section.getByTestId('motion-preset-apply-builtin:slide-up').click()

  await search.fill('')
  await section.getByTestId('motion-preset-favorite-builtin:slide-up').click()
  await chooseAppSelect(editor.page, section.getByTestId('motion-preset-category'), 'Favorites')
  await expect(section.getByTestId('motion-preset-card-builtin:slide-up')).toBeVisible()
  expect(
    await editor.page.evaluate(() => {
      const storageName = 'localStorage'
      return window[storageName].getItem('open-pencil:motion-preset-library:v1') ?? ''
    })
  ).toContain('builtin:slide-up')

  await section.getByTestId('motion-preset-save-current').click()
  const dialog = editor.page.getByTestId('motion-preset-custom-dialog')
  await dialog.getByTestId('motion-preset-custom-name').fill('卡片入场')
  await dialog.getByTestId('motion-preset-custom-submit').click()

  await chooseAppSelect(editor.page, section.getByTestId('motion-preset-category'), 'My presets')
  const userCard = section.getByTestId(/^motion-preset-card-user:user-/)
  await expect(userCard).toHaveCount(1)
  await expect(userCard).toContainText('卡片入场')

  await section.getByTestId('motion-preset-json-toggle').click()
  await section.getByTestId('motion-preset-export-json').click()
  const exported = await section.getByTestId('motion-preset-export-output').inputValue()
  expect(exported).toContain('卡片入场')
  expect(exported).toContain('openpencil-motion-presets')
  expect(JSON.parse(exported)).not.toHaveProperty('favorites')

  await editor.page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: undefined,
      configurable: true
    })
  })
  const [download] = await Promise.all([
    editor.page.waitForEvent('download'),
    section.getByTestId('motion-preset-export-file').click()
  ])
  expect(download.suggestedFilename()).toBe('openpencil-motion-presets.json')

  await editor.page.reload()
  await editor.canvas.waitForInit()
  await createRectangles(1)
  await editor.canvas.waitForRender()

  const restoredSection = propertySection(editor.page, 'Motion')
  await restoredSection.scrollIntoViewIfNeeded()
  await chooseAppSelect(
    editor.page,
    restoredSection.getByTestId('motion-preset-category'),
    'Favorites'
  )
  await expect(restoredSection.getByTestId('motion-preset-card-builtin:slide-up')).toBeVisible()
  await chooseAppSelect(
    editor.page,
    restoredSection.getByTestId('motion-preset-category'),
    'My presets'
  )
  const restoredUserCard = restoredSection.getByTestId(/^motion-preset-card-user:user-/)
  await expect(restoredUserCard).toContainText('卡片入场')
  await restoredUserCard.getByTestId(/^motion-preset-apply-user:user-/).click()
  const appliedSnapshot = (await selectedMotion())[0]
  expect(appliedSnapshot?.preset?.id).toMatch(/^user-/)

  await restoredUserCard.getByTestId(/^motion-preset-rename-/).click()
  await dialog.getByTestId('motion-preset-custom-name').fill('卡片入场 2')
  await dialog.getByTestId('motion-preset-custom-description').fill('用于共享卡片的强调动效')
  await chooseAppSelect(
    editor.page,
    dialog.getByTestId('motion-preset-custom-category'),
    'Emphasis'
  )
  await dialog.getByTestId('motion-preset-custom-submit').click()
  await expect(restoredUserCard).toContainText('卡片入场 2')
  await expect(restoredUserCard).toContainText('用于共享卡片的强调动效')

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const id = store ? [...store.state.selectedIds][0] : undefined
    const node = id ? store?.graph.getNode(id) : undefined
    const motion = node?.motion
    const track = motion?.tracks[0]
    if (!store || !node || !motion || !track) throw new Error('Expected selected motion')
    store.graph.updateNode(node.id, {
      motion: { ...motion, tracks: [{ ...track, timing: { ...track.timing, durationMs: 777 } }] }
    })
    store.requestRender()
  })
  await restoredUserCard.getByTestId(/^motion-preset-update-current-/).click()
  await restoredUserCard.getByTestId(/^motion-preset-apply-user:user-/).click()
  expect((await selectedMotion())[0]?.tracks[0]?.timing.durationMs).toBe(777)
  const updatedAppliedSnapshot = (await selectedMotion())[0]

  await restoredSection.getByTestId('motion-preset-json-toggle').click()
  await restoredSection.getByTestId('motion-preset-export-json').click()
  const editedExport = await restoredSection.getByTestId('motion-preset-export-output').inputValue()
  expect(editedExport).toContain('用于共享卡片的强调动效')
  expect(editedExport).toContain('"category": "emphasis"')

  await restoredUserCard.getByTestId(/^motion-preset-delete-/).click()
  await editor.page.getByTestId('motion-preset-delete-confirm').click()
  await expect(restoredUserCard).toHaveCount(0)
  expect((await selectedMotion())[0]).toEqual(updatedAppliedSnapshot)

  await restoredSection.getByTestId('motion-preset-json-input').fill('{"unexpected":true}')
  await restoredSection.getByTestId('motion-preset-import-json').click()
  await expect(restoredSection.getByRole('alert')).toContainText(/motion preset/i)
  await expect(restoredUserCard).toHaveCount(0)

  await restoredSection.getByTestId('motion-preset-import-file-input').setInputFiles({
    name: 'openpencil-motion-presets.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exported)
  })
  await expect(restoredSection.getByTestId(/^motion-preset-card-user:user-/)).toContainText(
    '卡片入场'
  )
  expect((await selectedMotion())[0]).toEqual(updatedAppliedSnapshot)
})

test('shared presets expose source status and require explicit acceptance before updates', async () => {
  await createRectangles(1)
  await editor.canvas.waitForRender()

  const sourceURL = 'https://presets.example/travel-motion.json'
  const manifest = (sourceVersion: string, durationMs: number) => ({
    format: 'openpencil-shared-motion-presets',
    schemaVersion: 1,
    publisher: { id: 'design-team', name: '设计团队' },
    library: { id: 'travel-motion', name: '旅行产品动效' },
    source: { kind: 'url', ref: sourceURL },
    readonly: true,
    sourceVersion,
    presets: [
      {
        id: 'user-shared-enter',
        revision: sourceVersion === 'v1' ? 1 : 2,
        name: '共享进入',
        description: '团队只读预设',
        category: 'entrance',
        motion: {
          version: 1,
          tracks: [
            {
              id: 'shared-fade',
              trigger: 'mount',
              keyframes: [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ],
              timing: { durationMs }
            }
          ]
        }
      }
    ]
  })

  const currentManifest = manifest('v2', 480)
  await editor.page.route(sourceURL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(currentManifest)
    })
  })

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await section.getByTestId('motion-shared-toggle').click()
  await section.getByTestId('motion-shared-json-input').fill(JSON.stringify(manifest('v1', 240)))
  await section.getByTestId('motion-shared-accept-json').click()

  const library = section.getByTestId('motion-shared-library-travel-motion')
  await expect(library).toContainText('旅行产品动效')
  await expect(section.getByTestId('motion-shared-source-travel-motion')).toContainText(sourceURL)
  await expect(section.getByTestId('motion-shared-status-travel-motion')).toContainText(
    'Up to date'
  )

  await chooseAppSelect(editor.page, section.getByTestId('motion-preset-category'), 'Shared')
  const card = section.getByTestId('motion-preset-card-shared:travel-motion:user-shared-enter')
  await expect(card).toContainText('团队只读预设')
  await expect(card).toContainText('Read only')
  await expect(card.getByTestId(/^motion-preset-rename-/)).toHaveCount(0)
  await expect(card.getByTestId(/^motion-preset-update-current-/)).toHaveCount(0)
  await card.getByTestId('motion-preset-apply-shared:travel-motion:user-shared-enter').click()
  expect((await selectedMotion())[0]).toMatchObject({
    preset: {
      id: 'user-shared-enter',
      parameters: { libraryId: 'travel-motion', sourceVersion: 'v1' }
    },
    tracks: [{ timing: { durationMs: 240 } }]
  })

  await section.getByTestId('motion-shared-check-travel-motion').click()
  await expect(section.getByTestId('motion-shared-status-travel-motion')).toContainText(
    'Update available'
  )
  await card.getByTestId('motion-preset-apply-shared:travel-motion:user-shared-enter').click()
  expect((await selectedMotion())[0]?.tracks[0]?.timing.durationMs).toBe(240)

  await section.getByTestId('motion-shared-accept-travel-motion').click()
  await expect(section.getByTestId('motion-shared-status-travel-motion')).toContainText(
    'Up to date'
  )
  await card.getByTestId('motion-preset-apply-shared:travel-motion:user-shared-enter').click()
  expect((await selectedMotion())[0]).toMatchObject({
    preset: { parameters: { sourceVersion: 'v2' } },
    tracks: [{ timing: { durationMs: 480 } }]
  })

  await section.getByTestId('motion-shared-remove-travel-motion').click()
  await expect(card).toHaveCount(0)
  expect((await selectedMotion())[0]?.tracks[0]?.timing.durationMs).toBe(480)
})

test('multi-selection preset stagger follows spatial order and remains one undo step', async () => {
  const ids = await createRectangles(3)
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await section.getByTestId('motion-stagger-enabled').check()
  const step = section.getByTestId('motion-stagger-step')
  await step.click()
  const stepInput = step.locator('input[data-slot="input"]')
  await stepInput.fill('40')
  await stepInput.press('Enter')
  await chooseAppSelect(editor.page, section.getByTestId('motion-stagger-direction'), 'Reverse')
  await chooseAppSelect(editor.page, section.getByTestId('motion-stagger-rhythm'), 'Linear')
  await section.getByTestId('motion-preset-apply-builtin:slide-up').click()

  expect(
    await editor.page.evaluate((nodeIds) => {
      const store = window.openPencil?.getStore?.()
      return nodeIds.map((id) => ({
        delay: store?.graph.getNode(id)?.motion?.tracks[0]?.timing.delayMs,
        provenanceDelay: store?.graph.getNode(id)?.motion?.preset?.parameters.delayMs
      }))
    }, ids)
  ).toEqual([
    { delay: 80, provenanceDelay: 80 },
    { delay: 40, provenanceDelay: 40 },
    { delay: 0, provenanceDelay: 0 }
  ])
  expect(await editor.page.evaluate(() => window.openPencil?.getStore?.().undo.undoLabel)).toBe(
    'Apply motion preset'
  )

  await editor.canvas.undo()
  expect(await selectedMotion()).toEqual(ids.map(() => undefined))
  await editor.canvas.redo()
  expect((await selectedMotion()).map((motion) => motion?.tracks[0]?.timing.delayMs)).toEqual([
    80, 40, 0
  ])
})

test('single-selection timeline scrubs, authors keyframes, and manages multiple tracks', async () => {
  await createRectangles(1)
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await section.getByTestId('motion-preset-apply-builtin:slide-up').click()

  const timeline = section.getByTestId('motion-timeline')
  await timeline.scrollIntoViewIfNeeded()
  await expect(timeline.getByTestId('motion-track-list').locator('> div')).toHaveCount(1)
  await expect(timeline.getByRole('combobox', { name: 'Fill' })).toContainText('Both')

  await timeline.getByTestId('motion-preview-track').click()
  expect(
    await editor.page.evaluate(() => {
      const preview = window.openPencil?.getStore?.().state.motionPreview
      return {
        playing: preview?.playing,
        trackIds: preview?.targets[0]?.spec.tracks.map((track) => track.id)
      }
    })
  ).toEqual({ playing: true, trackIds: ['slide-up'] })
  await timeline.getByTestId('motion-stop-track-preview').click()
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().state.motionPreview)
  ).toBeNull()

  const playhead = timeline.getByTestId('motion-playhead')
  await playhead.fill('200')
  expect(
    await editor.page.evaluate(() => {
      const preview = window.openPencil?.getStore?.().state.motionPreview
      return preview
        ? {
            playing: preview.playing,
            elapsedMs: preview.elapsedMs,
            startedAtMs: preview.startedAtMs
          }
        : null
    })
  ).toEqual({ playing: false, elapsedMs: 200, startedAtMs: null })
  await expect(section.getByTestId('motion-stop-preview')).toBeVisible()
  await section.getByTestId('motion-stop-preview').click()
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().state.motionPreview)
  ).toBeNull()

  await timeline.getByTestId('motion-add-keyframe').click()
  let motion = (await selectedMotion())[0]
  expect(motion?.preset).toBeUndefined()
  expect(motion?.tracks[0]?.keyframes.map((keyframe) => keyframe.offset)).toEqual([0, 0.4, 1])

  await timeline.getByTestId('motion-add-track').click()
  motion = (await selectedMotion())[0]
  expect(motion?.tracks).toHaveLength(2)
  await expect(timeline.getByTestId('motion-track-list').locator('> div')).toHaveCount(2)

  await timeline.getByRole('checkbox', { name: 'X', exact: true }).click()
  motion = (await selectedMotion())[0]
  expect(motion?.tracks[1]?.keyframes[0]?.x).toBe(0)

  await timeline.getByTestId('motion-remove-track').click()
  expect((await selectedMotion())[0]?.tracks).toHaveLength(1)
  await editor.canvas.undo()
  expect((await selectedMotion())[0]?.tracks).toHaveLength(2)
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().state.motionPreview)
  ).toBeNull()
  await editor.canvas.redo()
  expect((await selectedMotion())[0]?.tracks).toHaveLength(1)
})

test('timeline drags and duplicates keyframes, edits easing curves, and organizes tracks', async () => {
  const timeline = await openMotionTimeline()
  await dragAndDuplicateTimelineKeyframe(timeline)
  await editTimelineCubicEasing(timeline)
  await organizeTimelineTracks(timeline)
  await editTimelineV2Easings(timeline)
})

test('timeline explicitly upgrades and authors every MotionSpec v2 channel family', async () => {
  const timeline = await openMotionTimeline()
  await upgradeMotionTimeline(timeline)
  await expectMotionV2ChannelControls(timeline)
  await editMotionV2WidthAndFill(timeline)
  await editMotionPathAndInsertKeyframe(timeline)
})

test('timeline explicitly upgrades and edits MotionSpec v3 track composition', async () => {
  const timeline = await openMotionTimeline()
  await expect(timeline.getByTestId('motion-composition-upgrade')).toBeVisible()
  expect((await selectedMotionSpec()).version).toBe(1)

  await timeline.getByTestId('motion-composition-upgrade').getByRole('button').click()
  expect((await selectedMotionSpec()).version).toBe(3)
  await expect(timeline.getByTestId('motion-composition')).toBeVisible()

  await chooseAppSelect(editor.page, timeline.getByTestId('motion-composition-mode'), 'Add')
  const weight = timeline.locator('[data-property="motion-composition-weight"]')
  await weight.click()
  await weight.locator('input[data-slot="input"]').fill('0.4')
  await weight.locator('input[data-slot="input"]').press('Enter')
  const priority = timeline.locator('[data-property="motion-composition-priority"]')
  await priority.click()
  await priority.locator('input[data-slot="input"]').fill('12')
  await priority.locator('input[data-slot="input"]').press('Enter')

  expect((await selectedMotionTrack()).composition).toEqual({
    mode: 'add',
    weight: 0.4,
    priority: 12
  })
  await editor.canvas.undo()
  expect((await selectedMotionTrack()).composition?.priority).toBeUndefined()
  await editor.canvas.redo()
  expect((await selectedMotionTrack()).composition?.priority).toBe(12)
})

test('timeline authors structured MotionSpec v3 channels from the normal inspector', async () => {
  const timeline = await openMotionTimeline()
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = [...store.state.selectedIds][0]
    if (!id) throw new Error('Expected selected rectangle')
    store.graph.updateNode(id, {
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    store.state.sceneVersion++
  })

  await timeline.getByTestId('motion-v2-upgrade-button').click()
  const structured = timeline.getByTestId('motion-structured-channels-root')
  await structured.scrollIntoViewIfNeeded()
  await expect(structured.getByTestId('motion-v3-upgrade')).toBeVisible()
  await structured.getByTestId('motion-v3-upgrade-button').click()
  expect((await selectedMotionSpec()).version).toBe(3)

  await editor.canvas.undo()
  expect((await selectedMotionSpec()).version).toBe(2)
  await editor.canvas.redo()
  expect((await selectedMotionSpec()).version).toBe(3)

  const paintToggle = structured.getByTestId('motion-structured-toggle-paints')
  await paintToggle.check()
  expect(
    (await selectedMotionTrack()).keyframes.every(
      (keyframe) => keyframe.paints?.[0]?.kind === 'fill' && keyframe.paints[0].index === 0
    )
  ).toBe(true)

  const textReveal = structured.getByTestId('motion-structured-textReveal')
  await expect(textReveal).toHaveAttribute('data-capability-reason', /.+/)
  await expect(textReveal.getByTestId('motion-structured-toggle-textReveal')).toBeDisabled()

  const opacity = structured.locator('[data-property="motion-structured-paints-0-opacity"]')
  await opacity.scrollIntoViewIfNeeded()
  await opacity.click()
  await opacity.locator('input[data-slot="input"]').fill('0.35')
  await opacity.locator('input[data-slot="input"]').press('Enter')
  expect((await selectedMotionTrack()).keyframes[0].paints?.[0]?.opacity).toBe(0.35)
  expect((await selectedMotionTrack()).keyframes[1].paints?.[0]?.opacity).toBe(1)

  await editor.canvas.undo()
  expect((await selectedMotionTrack()).keyframes[0].paints?.[0]?.opacity).toBe(1)
  await editor.canvas.redo()
  expect((await selectedMotionTrack()).keyframes[0].paints?.[0]?.opacity).toBe(0.35)

  await paintToggle.uncheck()
  expect((await selectedMotionTrack()).keyframes.every((keyframe) => !keyframe.paints)).toBe(true)
})

test('timeline keeps an imported unsupported corner-radius channel removable', async () => {
  const outlineVectorId = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const outlineBlob = new Uint8Array(1 + 4 * 9 + 1)
    const outlineView = new DataView(outlineBlob.buffer)
    const outlinePoints = [
      { command: 1, x: 4, y: 4 },
      { command: 2, x: 96, y: 4 },
      { command: 2, x: 96, y: 76 },
      { command: 2, x: 4, y: 76 }
    ]
    let outlineOffset = 0
    for (const point of outlinePoints) {
      outlineBlob[outlineOffset] = point.command
      outlineView.setFloat32(outlineOffset + 1, point.x, true)
      outlineView.setFloat32(outlineOffset + 5, point.y, true)
      outlineOffset += 9
    }
    outlineBlob[outlineOffset] = 0
    const vector = store.graph.createNode('VECTOR', store.state.currentPageId, {
      name: 'Imported vector corner radius',
      x: 120,
      y: 120,
      width: 100,
      height: 80,
      strokeGeometry: [{ windingRule: 'NONZERO', commandsBlob: outlineBlob }],
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          weight: 2,
          align: 'CENTER'
        }
      ],
      motion: {
        version: 2,
        tracks: [
          {
            id: 'imported-vector',
            trigger: 'mount',
            keyframes: [
              {
                offset: 0,
                cornerRadius: 4,
                strokeWidth: 2,
                trimStart: 0,
                trimEnd: 0.5,
                trimOffset: 0
              },
              {
                offset: 1,
                cornerRadius: 12,
                strokeWidth: 8,
                trimStart: 0.5,
                trimEnd: 1,
                trimOffset: 0.5
              }
            ],
            timing: { durationMs: 300 }
          }
        ]
      }
    })
    store.select([vector.id])
    store.requestRender()
    return vector.id
  })
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  const timeline = section.getByTestId('motion-timeline')
  const channel = timeline.getByTestId('motion-v2-channel-cornerRadius')
  const toggle = timeline.getByTestId('motion-v2-toggle-cornerRadius')
  await expect(channel).toHaveAttribute('data-capability-disabled', 'true')
  await expect(toggle).toHaveAttribute('aria-description', /box-shaped/i)
  await expect(toggle).toBeEnabled()
  await expect(toggle).toBeChecked()

  const fillColor = timeline.getByTestId('motion-v2-fillColor')
  await expect(fillColor).toHaveAttribute('data-capability-disabled', 'true')
  const fillColorToggle = timeline.getByRole('checkbox', { name: 'Fill color' })
  await expect(fillColorToggle).toHaveAttribute('aria-description', /visible solid fill/i)
  await expect(fillColorToggle).toBeDisabled()
  await expect(timeline.getByTestId('motion-v2-strokeColor')).not.toHaveAttribute(
    'data-capability-disabled'
  )
  await expect(timeline.getByRole('checkbox', { name: 'Stroke color' })).toBeEnabled()
  for (const unsupportedChannel of ['strokeWidth', 'trimStart', 'trimEnd', 'trimOffset'] as const) {
    const unsupported = timeline.getByTestId(`motion-v2-channel-${unsupportedChannel}`)
    const unsupportedToggle = timeline.getByTestId(`motion-v2-toggle-${unsupportedChannel}`)
    await expect(unsupported).toHaveAttribute('data-capability-disabled', 'true')
    await expect(unsupportedToggle).toHaveAttribute(
      'aria-description',
      /editable centerline stroke/i
    )
    await expect(unsupportedToggle).toBeEnabled()
    await expect(unsupportedToggle).toBeChecked()
    await unsupportedToggle.uncheck()
    expect(
      (await selectedMotionTrack()).keyframes.every(
        (frame) => frame[unsupportedChannel] === undefined
      )
    ).toBe(true)
    await expect(unsupportedToggle).toBeDisabled()
  }

  await toggle.uncheck()
  expect(
    (await selectedMotionTrack()).keyframes.every((frame) => frame.cornerRadius === undefined)
  ).toBe(true)
  await expect(toggle).toBeDisabled()

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const emptyVector = store.graph.createNode('VECTOR', store.state.currentPageId, {
      name: 'Imported empty vector paint',
      x: 260,
      y: 120,
      width: 100,
      height: 80,
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.2, g: 0.4, b: 0.6, a: 1 },
          opacity: 1,
          visible: true
        }
      ],
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          weight: 2,
          align: 'CENTER'
        }
      ],
      motion: {
        version: 2,
        tracks: [
          {
            id: 'imported-empty-vector',
            trigger: 'mount',
            keyframes: [
              {
                offset: 0,
                fillColor: { r: 0.2, g: 0.4, b: 0.6, a: 1 },
                strokeColor: { r: 0, g: 0, b: 0, a: 1 }
              },
              {
                offset: 1,
                fillColor: { r: 0.8, g: 0.6, b: 0.4, a: 1 },
                strokeColor: { r: 1, g: 0, b: 0, a: 1 }
              }
            ],
            timing: { durationMs: 300 }
          }
        ]
      }
    })
    store.select([emptyVector.id])
    store.requestRender()
  })
  await editor.canvas.waitForRender()

  for (const [colorChannel, label] of [
    ['fillColor', 'Fill color'],
    ['strokeColor', 'Stroke color']
  ] as const) {
    const colorControl = timeline.getByTestId(`motion-v2-${colorChannel}`)
    const colorToggle = colorControl.getByRole('checkbox', { name: label })
    await expect(colorControl).toHaveAttribute('data-capability-disabled', 'true')
    await expect(colorToggle).toHaveAttribute('aria-description', /drawable vector geometry/i)
    await expect(colorToggle).toBeEnabled()
    await expect(colorToggle).toBeChecked()
    await colorToggle.uncheck()
    expect(
      (await selectedMotionTrack()).keyframes.every((frame) => frame[colorChannel] === undefined)
    ).toBe(true)
    await expect(colorToggle).toBeDisabled()
  }

  await editor.page.evaluate((sourceId) => {
    const store = window.openPencil?.getStore?.()
    const source = store?.graph.getNode(sourceId)
    const geometry = source?.strokeGeometry[0]
    if (!store || !geometry) throw new Error('Expected imported outline geometry')
    const fillOutline = store.graph.createNode('VECTOR', store.state.currentPageId, {
      name: 'Imported fill outline with static stroke',
      x: 380,
      y: 120,
      width: 100,
      height: 80,
      fillGeometry: [{ ...geometry, commandsBlob: new Uint8Array(geometry.commandsBlob) }],
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          weight: 2,
          align: 'CENTER'
        }
      ],
      motion: {
        version: 2,
        tracks: [
          {
            id: 'imported-fill-outline',
            trigger: 'mount',
            keyframes: [
              { offset: 0, strokeColor: { r: 0, g: 0, b: 0, a: 1 } },
              { offset: 1, strokeColor: { r: 1, g: 0, b: 0, a: 1 } }
            ],
            timing: { durationMs: 300 }
          }
        ]
      }
    })
    store.select([fillOutline.id])
    store.requestRender()
  }, outlineVectorId)
  await editor.canvas.waitForRender()

  const fillOutlineStroke = timeline.getByTestId('motion-v2-strokeColor')
  const fillOutlineStrokeToggle = fillOutlineStroke.getByRole('checkbox', {
    name: 'Stroke color'
  })
  await expect(fillOutlineStroke).toHaveAttribute('data-capability-disabled', 'true')
  await expect(fillOutlineStrokeToggle).toHaveAttribute(
    'aria-description',
    /drawable vector geometry/i
  )
  await expect(fillOutlineStrokeToggle).toBeEnabled()
  await expect(fillOutlineStrokeToggle).toBeChecked()
  await fillOutlineStrokeToggle.uncheck()
  expect(
    (await selectedMotionTrack()).keyframes.every((frame) => frame.strokeColor === undefined)
  ).toBe(true)
  await expect(fillOutlineStrokeToggle).toBeDisabled()

  const booleanId = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const boolean = store.graph.createNode('BOOLEAN_OPERATION', store.state.currentPageId, {
      name: 'Unresolved Boolean Motion',
      x: 120,
      y: 120,
      width: 100,
      height: 80,
      motion: {
        version: 1,
        tracks: [
          {
            id: 'unresolved-boolean',
            trigger: 'mount',
            keyframes: [
              { offset: 0, opacity: 0 },
              { offset: 1, opacity: 1 }
            ],
            timing: { durationMs: 300 }
          }
        ]
      }
    })
    store.select([boolean.id])
    store.requestRender()
    return boolean.id
  })
  await editor.canvas.waitForRender()

  await section.scrollIntoViewIfNeeded()
  await expect(section.getByTestId('motion-node-capability-warning')).toContainText(
    /resolved final geometry/i
  )
  await expect(section.getByTestId('motion-preset-apply-builtin:fade-in')).toBeDisabled()
  await expect(section.getByTestId('motion-preset-save-current')).toBeDisabled()
  await expect(section.getByTestId('motion-trigger')).toBeDisabled()
  await expect(section.getByTestId('motion-preview')).toBeDisabled()
  await expect(section.getByTestId('motion-timeline')).toHaveCount(0)
  await expect(section.getByTestId('motion-clear')).toBeEnabled()

  await section.getByTestId('motion-clear').click()
  expect((await selectedMotion())[0]).toBeUndefined()

  await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.graph.updateNode(id, {
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([0]) }]
    })
    store.requestRender()
  }, booleanId)
  await editor.canvas.waitForRender()

  await expect(section.getByTestId('motion-node-capability-warning')).toHaveCount(0)
  await expect(section.getByTestId('motion-preset-apply-builtin:fade-in')).toBeEnabled()
  await section.getByTestId('motion-preset-apply-builtin:fade-in').click()
  expect((await selectedMotion())[0]?.preset?.id).toBe('fade-in')
  await expect(section.getByTestId('motion-timeline')).toBeVisible()
})

test('switching nodes with the same track id resets timeline state and static preview', async () => {
  const ids = await createRectangles(2)
  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await section.getByTestId('motion-preset-apply-builtin:slide-up').click()
  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), ids[0])

  const timeline = section.getByTestId('motion-timeline')
  const playhead = timeline.getByTestId('motion-playhead')
  await playhead.fill('200')
  await expect(playhead).toHaveValue('200')
  expect(await editor.page.evaluate(() => window.openPencil?.getStore?.().hasMotionPreview())).toBe(
    true
  )

  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), ids[1])
  await expect(playhead).toHaveValue('0')
  expect(await editor.page.evaluate(() => window.openPencil?.getStore?.().hasMotionPreview())).toBe(
    false
  )
})

test('multi-selection preset apply and clear are atomic and undoable', async () => {
  const ids = await createRectangles(2)
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await section.getByTestId('motion-preset-apply-builtin:slide-up').click()
  await editor.canvas.waitForRender()

  expect((await selectedMotion()).map((motion) => motion?.preset?.id)).toEqual([
    'slide-up',
    'slide-up'
  ])
  const undoLabel = await editor.page.evaluate(() => window.openPencil?.getStore?.().undo.undoLabel)
  expect(undoLabel).toBe('Apply motion preset')

  await editor.canvas.undo()
  expect(await selectedMotion()).toEqual(ids.map(() => undefined))
  await editor.canvas.redo()
  expect((await selectedMotion()).map((motion) => motion?.preset?.id)).toEqual([
    'slide-up',
    'slide-up'
  ])

  await section.getByRole('button', { name: 'Clear motion' }).click()
  await editor.canvas.waitForRender()
  expect(await selectedMotion()).toEqual(ids.map(() => undefined))
  await editor.canvas.undo()
  expect((await selectedMotion()).map((motion) => motion?.preset?.id)).toEqual([
    'slide-up',
    'slide-up'
  ])
})

test('mixed selection is explicit and applying a preset resolves it', async () => {
  const ids = await createRectangles(2)
  await editor.page.evaluate(
    ([firstId, secondId]) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      store.graph.updateNode(firstId, {
        motion: {
          version: 1,
          tracks: [
            {
              id: 'first',
              trigger: 'mount',
              keyframes: [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ],
              timing: { durationMs: 300 }
            }
          ]
        }
      })
      store.graph.updateNode(secondId, {
        motion: {
          version: 1,
          tracks: [
            {
              id: 'second',
              trigger: 'hover',
              keyframes: [
                { offset: 0, y: 0 },
                { offset: 1, y: -8 }
              ],
              timing: { durationMs: 180 }
            }
          ]
        }
      })
      store.state.sceneVersion++
    },
    ids as [string, string]
  )
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await expect(section.getByTestId('motion-status')).toHaveText('Mixed motion values')
  await expect(section.getByRole('combobox', { name: 'Trigger' })).toContainText('Mixed')
  await expect(section.getByRole('spinbutton', { name: 'Duration' })).toHaveAttribute(
    'data-mixed',
    ''
  )
  await expect(section.getByTestId('motion-preview')).toBeDisabled()
  await expect(section.getByTestId('motion-timeline')).toHaveCount(0)

  await section.getByTestId('motion-preset-apply-builtin:float').click()
  await editor.canvas.waitForRender()
  expect((await selectedMotion()).map((motion) => motion?.preset?.id)).toEqual(['float', 'float'])
  await expect(section.getByTestId('motion-status')).toHaveCount(0)
})

test('motion filter keywords match both single and multi selection', async () => {
  await createRectangles(1)
  await editor.canvas.waitForRender()
  const filter = editor.page.getByTestId('inspector-filter-input')

  await filter.fill('animation')
  await expect(editor.page.getByTestId('inspector-section-motion')).toBeVisible()
  await expect(editor.page.getByTestId('inspector-section-position')).not.toBeVisible()

  await editor.page.getByTestId('inspector-filter-clear').click()
  await createRectangles(2)
  await editor.canvas.waitForRender()
  await filter.fill('动画')
  await expect(editor.page.getByTestId('design-panel-multi')).toBeVisible()
  await expect(editor.page.getByTestId('inspector-section-motion')).toBeVisible()
  await expect(editor.page.getByTestId('inspector-section-appearance')).not.toBeVisible()
})

test('captures and atomically reapplies a multi-node Motion Recipe from the panel', async () => {
  const ids = await createRectangles(2)
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await section.getByTestId('motion-preset-apply-builtin:slide-up').click()
  const expectedTracks = (await selectedMotion()).map((motion) => motion?.tracks)

  const recipes = section.getByTestId('motion-recipes')
  await recipes.scrollIntoViewIfNeeded()
  await recipes.getByTestId('motion-recipe-name').fill(`Panel recipe ${Date.now()}`)
  await recipes.getByTestId('motion-recipe-create').click()
  await expect(recipes.getByTestId('motion-recipe-apply')).toBeEnabled()

  await section.getByRole('button', { name: 'Clear motion' }).click()
  await editor.canvas.waitForRender()
  expect(await selectedMotion()).toEqual(ids.map(() => undefined))

  await recipes.getByTestId('motion-recipe-apply').click()
  await editor.canvas.waitForRender()
  expect((await selectedMotion()).map((motion) => motion?.tracks)).toEqual(expectedTracks)
  expect(await editor.page.evaluate(() => window.openPencil?.getStore?.().undo.undoLabel)).toBe(
    'Apply recipe'
  )

  await editor.canvas.undo()
  expect(await selectedMotion()).toEqual(ids.map(() => undefined))
})

test('verifies and applies a signed team Motion library from the panel', async () => {
  const libraryId = `e2eTeam${Date.now()}`
  const signed = await signedTeamMotionFixture(libraryId)
  await createRectangles(1)
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  const team = section.getByTestId('motion-team-libraries')
  await team.scrollIntoViewIfNeeded()
  await team.getByTestId('motion-team-toggle').click()
  await team.getByTestId('motion-team-manifest').fill(signed.manifestJson)
  await team.getByTestId('motion-team-public-key').fill(signed.publicKeyPem)
  await expect(team.getByTestId('motion-team-stage')).toBeEnabled()
  await team.getByTestId('motion-team-stage').click()

  const library = team.getByTestId(`motion-team-library-${libraryId}`)
  await expect(library).toBeVisible()
  await expect(library).toContainText('Verified')
  await library.getByTestId('motion-team-apply-user-e2e-team-rise').click()
  expect((await selectedMotionSpec()).tracks[0]).toMatchObject({
    id: 'team-rise',
    timing: { durationMs: 420 }
  })
  expect(await editor.page.evaluate(() => window.openPencil?.getStore?.().undo.undoLabel)).toBe(
    'Apply motion preset'
  )

  await editor.canvas.undo()
  expect((await selectedMotion())[0]).toBeUndefined()
  await library.getByTestId(`motion-team-remove-${libraryId}`).click()
  await expect(library).toHaveCount(0)
})

test('authors, previews, and atomically undoes a page Motion scene from the panel', async () => {
  const fixture = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      name: 'Scene card',
      x: 120,
      y: 120,
      width: 100,
      height: 80,
      motion: {
        version: 3,
        tracks: [
          {
            id: 'scene-rise',
            name: 'Scene rise',
            trigger: 'pageEnter',
            keyframes: [
              { offset: 0, y: 24, opacity: 0 },
              { offset: 1, y: 0, opacity: 1 }
            ],
            timing: { durationMs: 600, easing: 'ease-out' },
            composition: { mode: 'replace' }
          }
        ]
      }
    })
    store.select([node.id])
    store.requestRender()
    return { nodeId: node.id, pageId: store.state.currentPageId }
  })
  await editor.canvas.waitForRender()

  const timeline = propertySection(editor.page, 'Motion').getByTestId('motion-scene-timeline')
  await timeline.scrollIntoViewIfNeeded()
  await expect(timeline.getByTestId('motion-scene-available-track')).toBeVisible()
  await timeline.getByTestId('motion-scene-add-cue').click()

  const authored = await editor.page.evaluate(({ pageId }) => {
    const store = window.openPencil?.getStore?.()
    return store?.graph.getNode(pageId)?.motionScene
  }, fixture)
  expect(authored?.sequences[0]?.cues[0]).toMatchObject({
    targetNodeId: fixture.nodeId,
    trackId: 'scene-rise',
    startMs: 0
  })

  await timeline.getByTestId('motion-scene-playhead').fill('300')
  expect(
    await editor.page.evaluate(({ pageId }) => {
      const store = window.openPencil?.getStore?.()
      return {
        cueCount: store?.graph.getNode(pageId)?.motionScene?.sequences[0]?.cues.length ?? -1,
        undoLabel: store?.undo.undoLabel ?? null,
        preview: store?.state.motionPreview
          ? {
              id: store.state.motionPreview.id,
              elapsedMs: store.state.motionPreview.elapsedMs,
              targetCount: store.state.motionPreview.targets.length
            }
          : null
      }
    }, fixture)
  ).toMatchObject({ cueCount: 1, undoLabel: 'Update scene timeline' })
  await timeline.getByTestId('motion-scene-auto-keyframe').check()
  await chooseAppSelect(
    editor.page,
    timeline.getByTestId('motion-scene-auto-keyframe-channel'),
    'Y'
  )
  const autoKeyframeValue = timeline.getByTestId('motion-scene-auto-keyframe-value')
  await autoKeyframeValue.click()
  await autoKeyframeValue.getByRole('spinbutton').fill('42')
  await autoKeyframeValue.getByRole('spinbutton').press('Enter')
  await timeline.getByTestId('motion-scene-stop').click()
  expect(
    await editor.page.evaluate(
      ({ nodeId }) =>
        window.openPencil?.getStore?.().graph.getNode(nodeId)?.motion?.tracks[0]?.keyframes,
      fixture
    )
  ).toContainEqual(expect.objectContaining({ offset: 0.5, y: 42 }))
  await editor.canvas.undo()
  expect(
    await editor.page.evaluate(
      ({ nodeId }) =>
        window.openPencil?.getStore?.().graph.getNode(nodeId)?.motion?.tracks[0]?.keyframes,
      fixture
    )
  ).toHaveLength(2)

  await timeline.getByTestId('motion-scene-play').click()
  expect(await editor.page.evaluate(() => window.openPencil?.getStore?.().hasMotionPreview())).toBe(
    true
  )
  await timeline.getByTestId('motion-scene-stop').click()
  await editor.canvas.undo()
  expect(
    await editor.page.evaluate(
      ({ pageId }) => window.openPencil?.getStore?.().graph.getNode(pageId)?.motionScene,
      fixture
    )
  ).toBeUndefined()

  await editor.canvas.redo()
  await timeline.getByTestId('motion-scene-playhead').fill('300')
  await timeline.getByTestId('motion-scene-add-marker').click()
  expect(
    await editor.page.evaluate(
      ({ pageId }) =>
        window.openPencil?.getStore?.().graph.getNode(pageId)?.motionScene?.sequences[0]?.markers,
      fixture
    )
  ).toEqual([expect.objectContaining({ timeMs: 300 })])
})

test('zooms, snaps, and transforms multi-selected scene cues from the mounted timeline', async () => {
  const fixture = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const pageId = store.state.currentPageId
    const first = store.graph.createNode('RECTANGLE', pageId, {
      name: 'Scene card A',
      x: 120,
      y: 120,
      width: 100,
      height: 80,
      motion: {
        version: 3,
        tracks: [
          {
            id: 'scene-motion-a',
            name: 'Scene motion A',
            trigger: 'pageEnter',
            keyframes: [
              { offset: 0, x: 0 },
              { offset: 1, x: 40 }
            ],
            timing: { durationMs: 200 },
            composition: { mode: 'replace' }
          }
        ]
      }
    })
    const second = store.graph.createNode('RECTANGLE', pageId, {
      name: 'Scene card B',
      x: 260,
      y: 120,
      width: 100,
      height: 80,
      motion: {
        version: 3,
        tracks: [
          {
            id: 'scene-motion-b',
            name: 'Scene motion B',
            trigger: 'pageEnter',
            keyframes: [
              { offset: 0, opacity: 0 },
              { offset: 1, opacity: 1 }
            ],
            timing: { durationMs: 200 },
            composition: { mode: 'replace' }
          }
        ]
      }
    })
    store.graph.updateNode(pageId, {
      motionScene: {
        version: 1,
        id: 'scene-mounted-timeline',
        sequences: [
          {
            id: 'sequence-mounted-timeline',
            trigger: 'pageEnter',
            cues: [
              {
                id: 'cue-mounted-a',
                targetNodeId: first.id,
                trackId: 'scene-motion-a',
                startMs: 0
              },
              {
                id: 'cue-mounted-b',
                targetNodeId: second.id,
                trackId: 'scene-motion-b',
                startMs: 400
              }
            ]
          }
        ]
      }
    })
    store.select([first.id])
    store.requestRender()
    return { pageId }
  })
  await editor.canvas.waitForRender()

  const readCueStarts = () =>
    editor.page.evaluate((pageId) => {
      const store = window.openPencil?.getStore?.()
      return (
        store?.graph
          .getNode(pageId)
          ?.motionScene?.sequences[0]?.cues.map(({ startMs }) => startMs) ?? []
      )
    }, fixture.pageId)
  const timeline = propertySection(editor.page, 'Motion').getByTestId('motion-scene-timeline')
  await timeline.scrollIntoViewIfNeeded()

  const content = timeline.locator('[data-scene-timeline-content]')
  const zoom = timeline.getByTestId('motion-scene-zoom')
  await expect.poll(() => content.evaluate((element) => element.style.width)).toBe('100%')
  await zoom.fill('2')
  await expect(zoom).toHaveValue('2')
  await expect.poll(() => content.evaluate((element) => element.style.width)).toBe('200%')
  await expect(timeline.getByRole('checkbox', { name: 'Snap', exact: true })).toBeChecked()

  const firstCue = timeline.getByTestId('motion-scene-cue-cue-mounted-a')
  await firstCue.scrollIntoViewIfNeeded()
  const contentBox = await content.boundingBox()
  const cueBox = await firstCue.boundingBox()
  if (!contentBox || !cueBox) throw new Error('Expected mounted scene timeline geometry')
  const cueCenterX = cueBox.x + cueBox.width / 2
  const cueCenterY = cueBox.y + cueBox.height / 2
  await editor.page.mouse.move(cueCenterX, cueCenterY)
  await editor.page.mouse.down()
  await editor.page.mouse.move(cueCenterX + contentBox.width * 0.19, cueCenterY)
  await editor.page.mouse.up()

  await expect.poll(readCueStarts).toEqual([200, 400])
  await expect(firstCue).toHaveAttribute('aria-pressed', 'true')

  await timeline.getByTestId('motion-scene-select-all').click()
  await expect(timeline.getByTestId('motion-scene-cue-cue-mounted-a')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(timeline.getByTestId('motion-scene-cue-cue-mounted-b')).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  await timeline.getByTestId('motion-scene-translate').click()
  await expect.poll(readCueStarts).toEqual([300, 500])
  await timeline.getByTestId('motion-scene-playhead').fill('100')
  const scale = timeline.getByRole('spinbutton', {
    name: 'Scale selected cue timing around the playhead',
    exact: true
  })
  await scale.focus()
  const scaleInput = timeline.locator('input[data-slot="input"]')
  await scaleInput.fill('2')
  await scaleInput.press('Enter')
  await timeline.getByTestId('motion-scene-scale').click()
  await expect.poll(readCueStarts).toEqual([500, 900])

  await timeline.getByTestId('motion-scene-stop').click()
})

test('authors and removes a bounded generated effect from the Motion panel', async () => {
  const [nodeId] = await createRectangles(1)
  await editor.canvas.waitForRender()

  const generated = propertySection(editor.page, 'Motion').getByTestId('motion-generated-effect')
  await generated.scrollIntoViewIfNeeded()
  await generated.getByTestId('motion-generated-effect-add').click()
  await generated.getByTestId('motion-generated-effect-preset').selectOption('particles')
  await generated.getByTestId('motion-generated-effect-seed').fill('42')
  await generated.getByTestId('motion-generated-effect-seed').blur()
  await generated.getByTestId('motion-generated-effect-reduced-motion').selectOption('disable')

  expect(
    await editor.page.evaluate(
      (id) => window.openPencil?.getStore?.().graph.getNode(id)?.generatedEffect,
      nodeId
    )
  ).toMatchObject({
    version: 1,
    params: { preset: 'particles' },
    uniforms: { seed: 42 },
    reducedMotion: { mode: 'disable' }
  })

  await generated.getByTestId('motion-generated-effect-remove').click()
  expect(
    await editor.page.evaluate(
      (id) => window.openPencil?.getStore?.().graph.getNode(id)?.generatedEffect,
      nodeId
    )
  ).toBeUndefined()
  await editor.canvas.undo()
  expect(
    await editor.page.evaluate(
      (id) => window.openPencil?.getStore?.().graph.getNode(id)?.generatedEffect?.params.preset,
      nodeId
    )
  ).toBe('particles')
})

test('authors, previews, and restores a continuous Motion driver from the panel', async () => {
  const fixture = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const frame = store.graph.createNode('FRAME', store.state.currentPageId, {
      name: 'Driver owner',
      x: 80,
      y: 80,
      width: 360,
      height: 240
    })
    const target = store.graph.createNode('RECTANGLE', frame.id, {
      name: 'Driven card',
      x: 40,
      y: 40,
      width: 120,
      height: 80,
      motion: {
        version: 3,
        tracks: [
          {
            id: 'driver-progress',
            trigger: 'mount',
            keyframes: [
              { offset: 0, x: 0, opacity: 0.2 },
              { offset: 1, x: 120, opacity: 1 }
            ],
            timing: { durationMs: 500 },
            composition: { mode: 'replace' }
          }
        ]
      }
    })
    store.select([frame.id])
    store.requestRender()
    return { frameId: frame.id, targetId: target.id }
  })
  await editor.canvas.waitForRender()

  const drivers = editor.page.getByTestId('motion-drivers-panel')
  await drivers.scrollIntoViewIfNeeded()
  await drivers.getByTestId('motion-driver-add').click()
  await expect
    .poll(() =>
      editor.page.evaluate(
        ({ frameId }) => window.openPencil?.getStore?.().graph.getNode(frameId)?.motionDrivers,
        fixture
      )
    )
    .toMatchObject({ version: 1, drivers: [{ id: 'driver-1' }] })
  await chooseAppSelect(editor.page, drivers.getByTestId('motion-driver-source-kind'), 'Pointer')

  expect(
    await editor.page.evaluate(
      ({ frameId }) => window.openPencil?.getStore?.().graph.getNode(frameId)?.motionDrivers,
      fixture
    )
  ).toMatchObject({
    version: 1,
    drivers: [
      {
        id: 'driver-1',
        source: { kind: 'pointer', axis: 'x', space: 'local' },
        target: { targetNodeId: fixture.targetId, trackId: 'driver-progress' }
      }
    ]
  })

  await drivers.getByTestId('motion-driver-preview').fill('0.65')
  expect(await editor.page.evaluate(() => window.openPencil?.getStore?.().hasMotionPreview())).toBe(
    true
  )
  await drivers.getByTestId('motion-driver-preview-stop').click()
  expect(await editor.page.evaluate(() => window.openPencil?.getStore?.().hasMotionPreview())).toBe(
    false
  )

  await drivers.getByTestId('motion-driver-delete').click()
  expect(
    await editor.page.evaluate(
      ({ frameId }) => window.openPencil?.getStore?.().graph.getNode(frameId)?.motionDrivers,
      fixture
    )
  ).toBeUndefined()
  await editor.canvas.undo()
  expect(
    await editor.page.evaluate(
      ({ frameId }) => window.openPencil?.getStore?.().graph.getNode(frameId)?.motionDrivers,
      fixture
    )
  ).toMatchObject({ drivers: [{ source: { kind: 'pointer' } }] })
})

test('authors Prototype navigation and an explicit Smart Match key from the Motion panel', async () => {
  const fixture = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const source = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      name: 'Prototype source',
      x: 120,
      y: 120,
      width: 100,
      height: 80
    })
    const target = store.graph.createNode('FRAME', store.state.currentPageId, {
      name: 'Prototype destination',
      x: 280,
      y: 120,
      width: 160,
      height: 120
    })
    store.select([source.id])
    store.requestRender()
    return { sourceId: source.id, targetId: target.id }
  })
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  const prototype = section.getByTestId('motion-prototype-authoring')
  await prototype.scrollIntoViewIfNeeded()
  const transitionKey = prototype.getByTestId('motion-transition-key')
  await transitionKey.fill('shared-hero')
  await transitionKey.press('Enter')
  await prototype.getByTestId('motion-prototype-add').click()

  await prototype.getByTestId('motion-prototype-action-connection-1').selectOption('navigate')
  await prototype.getByTestId('motion-prototype-target-connection-1').selectOption(fixture.targetId)
  await prototype.getByTestId('motion-prototype-transition-connection-1').selectOption('smartMatch')

  const authored = await editor.page.evaluate((sourceId) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(sourceId)
    return { prototype: node?.prototype, transitionKey: node?.transitionKey }
  }, fixture.sourceId)
  expect(authored.transitionKey).toBe('shared-hero')
  expect(authored.prototype?.connections[0]).toMatchObject({
    id: 'connection-1',
    trigger: { kind: 'click' },
    action: { kind: 'navigate', targetNodeId: fixture.targetId },
    transition: { kind: 'smartMatch', fallback: 'dissolve' },
    interruption: 'replace',
    playback: 'forward'
  })
})

test('event and workflow editors persist playMotion and stopMotion targets and tracks', async () => {
  const { buttonId, firstTargetId, secondTargetId } = await setupMotionActions()
  await editor.canvas.waitForRender()

  const events = editor.page.getByTestId('lowcode-events-section')
  await events.scrollIntoViewIfNeeded()
  await events.getByTestId('lowcode-action-add').click()
  const eventAction = events.getByTestId('lowcode-action-row')
  await eventAction.getByTestId('lowcode-action-kind').selectOption('playMotion')
  await expect(eventAction.getByTestId('lowcode-action-motion-target')).toHaveValue(firstTargetId)
  await expect(
    eventAction.getByTestId('lowcode-action-motion-target').locator('option')
  ).toHaveCount(2)
  await eventAction.getByTestId('lowcode-action-motion-target').selectOption(secondTargetId)
  await eventAction.getByTestId('lowcode-action-motion-track').selectOption('rise')

  expect(await readMotionActionSnapshot(editor.page, buttonId)).toMatchObject({
    events: {
      onClick: [{ kind: 'playMotion', targetNodeId: secondTargetId, trackId: 'rise' }]
    }
  })

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.select([])
    store.requestRender()
  })
  await editor.canvas.waitForRender()

  const workflows = editor.page.getByTestId('lowcode-workflows-section')
  await workflows.scrollIntoViewIfNeeded()
  const workflow = workflows.getByTestId('lowcode-workflow-row')
  await workflow.getByTestId('lowcode-workflow-action-add').click()
  const workflowAction = workflow.getByTestId('lowcode-action-row')
  await workflowAction.getByTestId('lowcode-action-kind').selectOption('stopMotion')
  await workflowAction.getByTestId('lowcode-action-motion-target').selectOption(secondTargetId)
  await workflowAction.getByTestId('lowcode-action-motion-track').selectOption('rise')

  expect(await readMotionActionSnapshot(editor.page, buttonId)).toMatchObject({
    workflows: [
      {
        id: 'wf-motion',
        actions: [{ kind: 'stopMotion', targetNodeId: secondTargetId, trackId: 'rise' }]
      }
    ]
  })
})
