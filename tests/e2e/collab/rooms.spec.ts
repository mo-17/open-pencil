import { expect, test, type Page } from '@playwright/test'

import {
  collaborationErrors,
  connect,
  createPeer,
  roomStatus,
  ROOM_ID,
  SECOND_ROOM_ID,
  share,
  startRelay,
  type Peer
} from '#tests/helpers/collab/room'

/** Adds a named rectangle to the active tab's first page and returns its ID. */
function addRectangle(page: Page, name: string) {
  return page.evaluate((layerName) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const pageId = store.graph.getPages()[0]?.id
    if (!pageId) throw new Error('No page')
    return store.graph.createNode('RECTANGLE', pageId, { name: layerName, width: 80, height: 60 })
      .id
  }, name)
}

function layerName(page: Page, id: string) {
  return page.evaluate((nodeId) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().graph.getNode(nodeId)?.name
  }, id)
}

async function closeAll(peers: (Peer | null)[], relay: { close: () => Promise<void> }) {
  for (const peer of peers) await peer?.context.close()
  await relay.close()
}

test('a share link opens the room in its own tab, waiting until someone with it is online', async ({
  browser
}) => {
  test.setTimeout(90_000)
  const relay = await startRelay()
  let host: Peer | null = null
  let guest: Peer | null = null
  try {
    host = await createPeer(browser, 'Host', relay.url)
    const invite = await share(host)
    // The invitation is real, but the relay has not introduced its owner to the guest.
    // No document or presence can arrive until the owner becomes reachable below.
    relay.pause()
    guest = await createPeer(browser, 'Guest', relay.url, { path: invite })
    const screen = guest.page.getByTestId('room-screen')
    // It connects and looks for people before it says nobody who has the file is here.
    await expect(screen).toHaveAttribute('data-status', /^(connecting|looking)$/)
    await expect(screen).toHaveAttribute('data-status', 'waiting', { timeout: 15_000 })
    await expect(
      guest.page.getByRole('heading', { name: 'Waiting for someone who has this file' })
    ).toBeVisible()
    // A browser on a computer can hand the room to the desktop app, or point to its download.
    await expect(guest.page.getByRole('link', { name: 'Open in desktop app' })).toHaveAttribute(
      'href',
      new RegExp(`^openpencil://join\\?room=${ROOM_ID}#k=[a-z0-9]{48}$`)
    )
    expect(
      await guest.page
        .getByRole('link', { name: 'Open in desktop app' })
        .evaluate(
          (element, fragment) => new URL(element.getAttribute('href') ?? '').hash === fragment,
          new URL(invite, 'https://fixture.invalid').hash
        )
    ).toBe(true)
    await expect(guest.page.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      'https://github.com/open-pencil/open-pencil/releases/latest'
    )

    await guest.context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await guest.page.getByTestId('room-screen-copy-link').click()
    const guestPage = guest.page
    await expect
      .poll(() =>
        guestPage.evaluate(async (invitation) => {
          const copied = new URL(await navigator.clipboard.readText())
          const expected = new URL(invitation, location.origin)
          return {
            room: copied.pathname === expected.pathname,
            key: copied.hash === expected.hash,
            fragmentOnly: !copied.searchParams.has('k')
          }
        }, invite)
      )
      .toEqual({ room: true, key: true, fragmentOnly: true })

    const nodeId = await addRectangle(host.page, 'Shared card')
    relay.resume()

    await expect(screen).toHaveCount(0)
    await expect.poll(() => roomStatus(guest as Peer)).toBe('live')
    await expect.poll(() => layerName((guest as Peer).page, nodeId)).toBe('Shared card')
    await expect(guest.page).toHaveURL(new RegExp(`/share/${ROOM_ID}\\?`))
    expect(collaborationErrors(guest)).toEqual([])
  } finally {
    await closeAll([guest, host], relay)
  }
})

test('joining from a document opens a new tab and leaves that document alone', async ({
  browser
}) => {
  const relay = await startRelay()
  let host: Peer | null = null
  let guest: Peer | null = null
  try {
    host = await createPeer(browser, 'Host', relay.url)
    const hostNode = await addRectangle(host.page, 'Room card')
    const invite = await share(host)

    guest = await createPeer(browser, 'Guest', relay.url)
    const ownNode = await addRectangle(guest.page, 'My own work')
    await guest.page.getByTestId('collab-share-button').click()
    await guest.page
      .getByTestId('collab-join-input')
      .fill(`https://example.test${invite.replace('#', '/#')}`)
    await guest.page.getByTestId('collab-join-room-button').click()

    await expect.poll(() => layerName((guest as Peer).page, hostNode)).toBe('Room card')
    expect(await layerName(guest.page, ownNode)).toBeUndefined()
    await expect(guest.page.getByTestId('tabbar-tab')).toHaveCount(2)

    await guest.page.getByTestId('tabbar-tab').first().click()
    await expect.poll(() => layerName((guest as Peer).page, ownNode)).toBe('My own work')
    expect(await roomStatus(guest)).toBeNull()
    await expect(guest.page).not.toHaveURL(/\/share\//)
    await expect
      .poll(() =>
        host?.page.evaluate(() => {
          if (!window.openPencil) throw new Error('Editor test API is unavailable')
          return window.openPencil?.test?.collab?.peerCount()
        })
      )
      .toBe(1)
    expect(await layerName(host.page, ownNode)).toBeUndefined()
  } finally {
    await closeAll([guest, host], relay)
  }
})

test('a pasted link that is not a room says so and joins nothing', async ({ browser }) => {
  const relay = await startRelay()
  let guest: Peer | null = null
  try {
    guest = await createPeer(browser, 'Guest', relay.url)
    await guest.page.getByTestId('collab-share-button').click()
    await guest.page.getByTestId('collab-join-input').fill('https://example.test/share/nope')
    await guest.page.getByTestId('collab-join-room-button').click()
    await expect(guest.page.getByTestId('collab-join-error')).toBeVisible()
    await expect(guest.page.getByTestId('tabbar-tab')).toHaveCount(1)
    expect(await roomStatus(guest)).toBeNull()
  } finally {
    await closeAll([guest], relay)
  }
})

test('reloading a room tab rejoins it, and leaving keeps an unsaved copy', async ({ browser }) => {
  test.setTimeout(90_000)
  const relay = await startRelay()
  let host: Peer | null = null
  let guest: Peer | null = null
  try {
    host = await createPeer(browser, 'Host', relay.url)
    const nodeId = await addRectangle(host.page, 'Kept card')
    const invite = await share(host)

    guest = await createPeer(browser, 'Guest', relay.url, { path: invite })
    await expect.poll(() => layerName((guest as Peer).page, nodeId)).toBe('Kept card')

    await guest.page.reload()
    expect(
      await guest.page.evaluate(
        (fragment) => location.hash === fragment,
        new URL(invite, 'https://fixture.invalid').hash
      )
    ).toBe(true)
    await expect.poll(() => roomStatus(guest as Peer)).toBe('live')
    await expect.poll(() => layerName((guest as Peer).page, nodeId)).toBe('Kept card')

    await guest.page.getByTestId('collab-share-button').click()
    await guest.page.getByTestId('collab-leave').click()
    await expect(guest.page.getByTestId('left-room-notice')).toBeVisible()
    expect(await roomStatus(guest)).toBeNull()
    expect(await layerName(guest.page, nodeId)).toBe('Kept card')
    expect(
      await guest.page.evaluate(() => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
        return window.openPencil?.getStore?.().hasUnsavedChanges()
      })
    ).toBe(true)
    await expect(guest.page).not.toHaveURL(/\/share\//)
    await expect
      .poll(() =>
        host?.page.evaluate(() => {
          if (!window.openPencil) throw new Error('Editor test API is unavailable')
          return window.openPencil?.test?.collab?.peerCount()
        })
      )
      .toBe(0)
  } finally {
    await closeAll([guest, host], relay)
  }
})

test('two room tabs stay live at once, each syncing with its own room', async ({ browser }) => {
  const relay = await startRelay()
  let hostA: Peer | null = null
  let hostB: Peer | null = null
  let guest: Peer | null = null
  try {
    hostA = await createPeer(browser, 'Host A', relay.url)
    const inviteA = await share(hostA, ROOM_ID)
    hostB = await createPeer(browser, 'Host B', relay.url)
    const inviteB = await share(hostB, SECOND_ROOM_ID)

    guest = await createPeer(browser, 'Guest', relay.url)
    await connect(guest, inviteA)
    await expect.poll(() => roomStatus(guest as Peer)).toBe('live')
    const inRoomA = await addRectangle(guest.page, 'For A')
    await connect(guest, inviteB)
    await expect.poll(() => roomStatus(guest as Peer)).toBe('live')
    await expect(guest.page).toHaveURL(new RegExp(`/share/${SECOND_ROOM_ID}\\?`))

    await expect.poll(() => layerName((hostA as Peer).page, inRoomA)).toBe('For A')
    expect(await layerName(hostB.page, inRoomA)).toBeUndefined()
    for (const host of [hostA, hostB]) {
      await expect
        .poll(() =>
          host.page.evaluate(() => {
            if (!window.openPencil) throw new Error('Editor test API is unavailable')
            return window.openPencil?.test?.collab?.peerCount()
          })
        )
        .toBe(1)
    }
  } finally {
    await closeAll([guest, hostA, hostB], relay)
  }
})

test("a guest's page list shows which page the sharer is on, and who is there on hover", async ({
  browser
}) => {
  test.setTimeout(90_000)
  const relay = await startRelay()
  let host: Peer | null = null
  let guest: Peer | null = null
  try {
    host = await createPeer(browser, 'Host', relay.url)
    await addRectangle(host.page, 'Card')
    const invite = await share(host)
    guest = await createPeer(browser, 'Guest', relay.url, { path: invite })
    await expect(guest.page.getByTestId('room-screen')).toHaveCount(0, { timeout: 15_000 })
    await expect.poll(() => roomStatus(guest as Peer)).toBe('live')

    // A real pointer over the canvas, as people move it, not the test hook.
    const box = await host.canvas.canvas.boundingBox()
    if (!box) throw new Error('Canvas has no bounding box')
    await host.page.mouse.move(box.x + 120, box.y + 80)
    await host.page.mouse.move(box.x + 160, box.y + 100, { steps: 4 })

    const marker = guest.page.getByTestId('pages-item').getByTestId('presence-markers')
    await expect(marker).toHaveAttribute('aria-label', 'Host')

    // Hovering the page shows who is there and lets the guest follow them.
    await guest.page.getByTestId('pages-item').hover()
    const card = guest.page.getByTestId('page-presence-card')
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: 'Follow Host' })).toBeVisible()
    expect(collaborationErrors(guest)).toEqual([])
  } finally {
    await closeAll([guest, host], relay)
  }
})
