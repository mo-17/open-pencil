import { WebSocketServer, type WebSocket } from 'ws'

export type TestRelay = {
  url: string
  pause: () => void
  resume: () => void
  queuedCount: () => number
  close: () => Promise<void>
}

type QueuedRelayMessage = {
  sender: WebSocket
  room: Set<WebSocket>
  text: string
}

export async function startRelay(): Promise<TestRelay> {
  const rooms = new Map<string, Set<WebSocket>>()
  const sockets = new Map<WebSocket, { room: Set<WebSocket>; peerId: string | null }>()
  const queuedMessages: QueuedRelayMessage[] = []
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
      let text: string
      if (Array.isArray(data)) text = Buffer.concat(data).toString('utf8')
      else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString('utf8')
      else text = data.toString('utf8')
      const message = JSON.parse(text) as { senderId?: string }
      const state = sockets.get(socket)
      if (state && message.senderId) state.peerId = message.senderId
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
      room.delete(socket)
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
