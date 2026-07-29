import { describe, expect, test } from 'bun:test'

import { buildRemotePeers } from '@/app/collab/awareness'
import type { PresenceEditingTarget } from '@/app/collab/types'

/**
 * Phase 3 §4.4 — lowcode-aware presence. A peer broadcasts which lowcode
 * property panel it is editing via a new `editing` awareness field
 * ({ kind, nodeId? }). `buildRemotePeers` must surface it on `RemotePeer.editing`
 * alongside the existing cursor/selection, skip the local client, and tolerate
 * peers with no editing target.
 *
 * Single-process scope (experience K boundary): this asserts the payload
 * build/parse contract. The real two-peer awareness propagation over WebRTC is
 * deferred to two-machine verification, same as §4.1/§4.2.
 */

const LOCAL_CLIENT = 1
const REMOTE_CLIENT = 2

function user(name: string) {
  return { name, color: { r: 0.2, g: 0.4, b: 0.6, a: 1 } }
}

describe('buildRemotePeers — editing target (Phase 3 §4.4)', () => {
  test('surfaces a node-scoped editing target on the remote peer', () => {
    const editing: PresenceEditingTarget = { kind: 'events', nodeId: 'node-42' }
    const states = new Map<number, Record<string, unknown>>([
      [LOCAL_CLIENT, { user: user('Me') }],
      [REMOTE_CLIENT, { user: user('Alice'), editing }]
    ])

    const peers = buildRemotePeers(states, LOCAL_CLIENT)

    expect(peers).toHaveLength(1)
    expect(peers[0].editing).toEqual({ kind: 'events', nodeId: 'node-42' })
  })

  test('surfaces a document-level editing target (no nodeId)', () => {
    const editing: PresenceEditingTarget = { kind: 'docState' }
    const states = new Map<number, Record<string, unknown>>([
      [REMOTE_CLIENT, { user: user('Bob'), editing }]
    ])

    const peers = buildRemotePeers(states, LOCAL_CLIENT)

    expect(peers[0].editing).toEqual({ kind: 'docState' })
    expect(peers[0].editing?.nodeId).toBeUndefined()
  })

  test('leaves editing undefined when the peer is not editing a lowcode panel', () => {
    const states = new Map<number, Record<string, unknown>>([
      [REMOTE_CLIENT, { user: user('Carol'), selection: ['n1'] }]
    ])

    const peers = buildRemotePeers(states, LOCAL_CLIENT)

    expect(peers[0].editing).toBeUndefined()
  })

  test('does not surface the local client own editing target', () => {
    const editing: PresenceEditingTarget = { kind: 'supabaseConfig' }
    const states = new Map<number, Record<string, unknown>>([
      [LOCAL_CLIENT, { user: user('Me'), editing }]
    ])

    const peers = buildRemotePeers(states, LOCAL_CLIENT)

    expect(peers).toHaveLength(0)
  })

  test('surfaces bounded Motion timeline playhead and selection presence', () => {
    const states = new Map<number, Record<string, unknown>>([
      [
        REMOTE_CLIENT,
        {
          user: user('Dana'),
          motionTimeline: {
            scope: 'node',
            ownerId: 'node-42',
            trackIds: ['enter', 'enter'],
            keyframeIds: ['kf_a'],
            cueIds: [],
            playheadMs: 240,
            playing: true
          }
        }
      ]
    ])

    expect(buildRemotePeers(states, LOCAL_CLIENT)[0].motionTimeline).toEqual({
      scope: 'node',
      ownerId: 'node-42',
      trackIds: ['enter'],
      keyframeIds: ['kf_a'],
      cueIds: [],
      playheadMs: 240,
      playing: true
    })
  })

  test('drops malformed Motion awareness instead of growing peer state', () => {
    const states = new Map<number, Record<string, unknown>>([
      [
        REMOTE_CLIENT,
        {
          user: user('Eve'),
          motionTimeline: {
            scope: 'node',
            ownerId: '../unsafe',
            trackIds: Array.from({ length: 1_000 }, () => 'x'),
            playheadMs: Number.POSITIVE_INFINITY
          }
        }
      ]
    ])

    expect(buildRemotePeers(states, LOCAL_CLIENT)[0].motionTimeline).toBeUndefined()
  })
})
