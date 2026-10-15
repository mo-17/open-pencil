import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { WebSocketServer, type WebSocket } from 'ws'

import { CanvasHelper } from '#tests/helpers/canvas'

/** Two-browser collaboration: a local WebSocket relay and peers connected through it. */
export const ROOM_ID = 'e2ecollaborationroom000000000000'
/** A second room, for a peer in two rooms at once. */
export const SECOND_ROOM_ID = 'e2ecollaborationroom111111111111'

export type { TestRelay } from './test-relay'
import type { TestRelay } from './test-relay'

/** The sender of a relayed frame; frames that are not JSON are still forwarded. */
function senderOf(text: string): string | undefined {
  try {
    const message: unknown = JSON.parse(text)
    return typeof message === 'object' && message !== null && 'senderId' in message
      ? String(message.senderId)
      : undefined
  } catch {
    return undefined
  }
}

export async function startRelay(): Promise<TestRelay> {
  const rooms = new Map<string, Set<WebSocket>>()
  const sockets = new Map<WebSocket, { room: Set<WebSocket>; peerId: string | null }>()
  const queuedMessages: Array<{ sender: WebSocket; room: Set<WebSocket>; text: string }> = []
  let paused = false
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  server.on('connection', (socket, request) => {
    const roomId = new URL(request.url ?? '/', 'ws://127.0.0.1').searchParams.get('roomId') ?? ''
    let room = rooms.get(roomId)
    if (!room) {
      room = new Set()
      rooms.set(roomId, room)
    }
    room.add(socket)
    sockets.set(socket, { room, peerId: null })
    socket.on('message', (data) => {
      const text = data.toString()
      const state = sockets.get(socket)
      const senderId = senderOf(text)
      if (state && senderId) state.peerId = senderId
      if (paused) {
        queuedMessages.push({ sender: socket, room, text })
        return
      }
      for (const peer of room) {
        if (peer !== socket && peer.readyState === peer.OPEN) peer.send(text)
      }
    })
    socket.on('close', () => {
      const state = sockets.get(socket)
      room?.delete(socket)
      sockets.delete(socket)
      if (!state?.peerId) return
      const leave = JSON.stringify({ type: 'leave', senderId: state.peerId })
      for (const peer of state.room) if (peer.readyState === peer.OPEN) peer.send(leave)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve())
    server.once('error', reject)
  })
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('Test relay unavailable')
  return {
    url: `ws://127.0.0.1:${address.port}`,
    pause: () => {
      paused = true
    },
    resume: () => {
      paused = false
      for (const message of queuedMessages.splice(0)) {
        for (const peer of message.room) {
          if (peer !== message.sender && peer.readyState === peer.OPEN) peer.send(message.text)
        }
      }
    },
    queuedCount: () => queuedMessages.length,
    close: async () => {
      for (const room of rooms.values()) for (const socket of room) socket.terminate()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  }
}

export type Peer = {
  context: BrowserContext
  page: Page
  canvas: CanvasHelper
}

/** The app URL for a path, on the test transport through the given relay. */
export function relayURLFor(path: string, relayURL: string): string {
  const url = new URL(path, 'http://fixture.invalid')
  url.searchParams.set('test', '')
  url.searchParams.set('collabTransport', 'test')
  url.searchParams.set('collabRelay', relayURL)
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * A browser with the app open at `path`: `/` by default, or a share link. A share link shows the
 * room's screen instead of a canvas until the room's document arrives, so only `/` waits for the
 * canvas.
 */
export async function createPeer(
  browser: Browser,
  name: string,
  relayURL: string,
  { path = '/' }: { path?: string } = {}
): Promise<Peer> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  try {
    const page = await context.newPage()
    await page.goto(relayURLFor(path, relayURL))
    await page.waitForFunction(() => window.openPencil?.test?.collab !== undefined)
    await page.evaluate(
      (localName) => window.openPencil?.test?.collab?.setLocalName(localName),
      name
    )
    const canvas = new CanvasHelper(page)
    if (path === '/') await canvas.waitForInit()
    canvas.errors.length = 0
    return { context, page, canvas }
  } catch (error) {
    await context.close()
    throw error
  }
}

export function collaborationErrors(peer: Peer): string[] {
  return peer.canvas.errors.filter((error) => !error.includes('127.0.0.1:7600'))
}

/** Joins the room in a tab of its own, as pasting its link does. */
export async function connect(peer: Peer, invite: string) {
  await peer.page.evaluate((input) => {
    const collab = window.openPencil?.test?.collab
    if (!collab) throw new Error('Collaboration bridge unavailable')
    if (!collab.connect(input)) throw new Error('Room invitation rejected')
  }, invite)
}

/** Shares through the app, then reads its actual random-key invitation from the address bar. */
export async function share(peer: Peer, roomId = ROOM_ID) {
  await peer.page.evaluate((id) => {
    const collab = window.openPencil?.test?.collab
    if (!collab) throw new Error('Collaboration bridge unavailable')
    collab.share(id)
  }, roomId)
  await expect
    .poll(() =>
      peer.page.evaluate((id) => {
        const key = new URLSearchParams(location.hash.slice(1)).get('k')
        return location.pathname === `/share/${id}` && key !== null && /^[a-z0-9]{48}$/.test(key)
      }, roomId)
    )
    .toBe(true)
  const url = new URL(peer.page.url())
  return `${url.pathname}${url.hash}`
}

/** The active tab's room status, from the test bridge. */
export function roomStatus(peer: Peer) {
  return peer.page.evaluate(() => window.openPencil?.test?.collab?.status() ?? null)
}
