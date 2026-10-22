import { useRafFn, watchThrottled } from '@vueuse/core'
import { onScopeDispose, watch } from 'vue'

import type { SkiaRenderer } from '@open-pencil/core/canvas'
import type { Editor, EditorState } from '@open-pencil/core/editor'
import { readShaderPaints, shaderPresetKey, type ShaderPreset } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { shaderFrames } from '#vue/canvas/surface/shader/frames'
import { canDrawShaders } from '#vue/canvas/surface/shader/rasterizer'

import { initializationQueue, untilAborted } from './queue'
import { playerResources, type PlayerRenderer, type ContentPresetFactory } from './renderer'
import { shadersOnPage, isCurrentInput, type PlaybackSource } from './sources'

/** At most four content textures play; other layers retain their saved frames. */
const MAX_CONTENT_PLAYERS = 4

/** The longest side a playing shader is drawn at, however large it is on screen. */
const MAX_PLAY_EDGE = 1024
/**
 * How long a frame may spend drawing shaders and handing them to the canvas. A browser where
 * that is slow, such as Safari, which copies each WebGPU canvas into WebGL synchronously, draws
 * as many as fit and the rest on the next frames, in turn, rather than stalling every frame.
 */
const FRAME_BUDGET_MS = 8
/** The least time between frames where each frame is copied. */
const COPY_FRAME_MS = 1000 / 30
/** How often what is on screen is checked while the view moves. */
const VIEW_CHECK_MS = 200
/** How much a shader's size on screen may change before it is drawn at the new size. */
const RESIZE_FACTOR = 1.5

/** A shader playing on its own WebGPU canvas, shown wherever its image is painted. */
interface Player {
  preset: string
  source: PlaybackSource
  controller: AbortController
  close: () => void
  nodeIds: Set<string>
  canvas: HTMLCanvasElement
  renderer: PlayerRenderer | null
  /** Whether it is on screen, the only time it draws. */
  visible: boolean
  disposed: boolean
  /** The copy of its last frame shown, where frames are copied, closed when the next replaces it. */
  copied: ImageBitmap | null
  /** When it last drew, so its clock advances by the time since then however often it draws. */
  drawnAt: number
  /** How far its animation has run, in seconds, so a player that replaces it goes on from there. */
  elapsed: number
}

/**
 * Plays the shader paints on screen while the editor previews a page: each runs on a WebGPU
 * canvas at about its size on screen, and its frames replace the still frame wherever the canvas
 * paints that image, so the layers above, masks, and clipping draw as usual. A shader scrolled
 * out of view pauses; leaving preview shows the still frames again. Without WebGPU the still
 * frames stay.
 */
export function useShaderPlayback(options: {
  editor: Pick<
    Editor,
    | 'graph'
    | 'state'
    | 'onEditorEvent'
    | 'reportShaderPlaybackFailure'
    | 'reportShaderPlaybackReady'
    | 'captureShaderContent'
  >
  getRenderer: () => Pick<SkiaRenderer, 'setLiveImage'> | null
  /** The view this canvas draws: its pan, zoom, page, and whether it previews. */
  getView: () => Pick<EditorState, 'panX' | 'panY' | 'zoom' | 'currentPageId' | 'play'>
  getViewport: () => { width: number; height: number }
  markDirty: () => void
  createRenderer?: (preset: ShaderPreset) => Promise<PlayerRenderer>
  prepareContent?: ContentPresetFactory
}) {
  const { editor, getRenderer, getView, getViewport, markDirty } = options
  const createRenderer =
    options.createRenderer ??
    (async (preset: ShaderPreset) => {
      const shaders = await import('shaders/core')
      return shaders.createRendererFromJSON(structuredClone(preset))
    })
  const frames = shaderFrames(editor)
  const players = new Map<string, Player>()
  const initializers = initializationQueue()
  let syncedVersion = -1
  /** Players starting at a new size beside the ones they replace, by image. */
  const replacing = new Map<string, Player>()
  /**
   * Sizes a replacement failed to start at, by image, with the preset it was for. The player it
   * would have replaced plays on, and no replacement is tried again near that size until the
   * preset changes or the view moves well away from it.
   */
  const failedSizes = new Map<string, { preset: string; size: { width: number; height: number } }>()
  /** Failed preset/content keys wait for a source edit or explicit retry. */
  const failed = new Map<string, string>()
  /** Renderers to let go of once the frame being drawn is done with them. */
  const retired: Player[] = []
  let graph = editor.graph
  let last = 0
  let stepping = false
  /** Where the next frame starts drawing, when the last one ran out of time. */
  let turn = 0
  /** Whether this browser needs each frame copied before the canvas can show it. */
  let copyFrames = false

  function fail(hash: string, player: Player) {
    failed.set(hash, player.source.key)
    editor.reportShaderPlaybackFailure(hash, player.preset)
  }

  function release() {
    for (const player of retired.splice(0)) {
      player.close()
      player.copied?.close()
    }
  }

  function stop(hash: string) {
    failedSizes.delete(hash)
    const replacement = replacing.get(hash)
    if (replacement) {
      replacement.disposed = true
      replacement.controller.abort()
      retired.push(replacement)
      replacing.delete(hash)
    }
    const player = players.get(hash)
    if (!player) return
    player.disposed = true
    player.controller.abort()
    players.delete(hash)
    getRenderer()?.setLiveImage(hash, null, player.nodeIds)
    frames.publish(hash, null)
    markDirty()
    retired.push(player)
    if (!stepping) release()
  }

  /** How many pixels a shader painted over `bounds` covers on screen, at most. */
  function screenSize(
    bounds: Rect[],
    input?: PlaybackSource['input']
  ): { width: number; height: number } {
    const scale = getView().zoom * (window.devicePixelRatio || 1)
    const width = (input?.width ?? Math.max(...bounds.map((rect) => rect.width))) * scale
    const height = (input?.height ?? Math.max(...bounds.map((rect) => rect.height))) * scale
    const fit = Math.min(1, MAX_PLAY_EDGE / Math.max(width, height, 1))
    return {
      width: Math.max(1, Math.round(width * fit)),
      height: Math.max(1, Math.round(height * fit))
    }
  }

  function onScreen(bounds: Rect[]): boolean {
    const { panX, panY, zoom } = getView()
    const view = getViewport()
    return bounds.some(
      (rect) =>
        rect.x * zoom + panX < view.width &&
        (rect.x + rect.width) * zoom + panX > 0 &&
        rect.y * zoom + panY < view.height &&
        (rect.y + rect.height) * zoom + panY > 0
    )
  }

  /**
   * Starts playing `hash`'s shader at `size`. A player that `replaces` one already playing, at
   * another size, starts beside it: the old one keeps drawing until the new one is ready, and the
   * new one takes over at the same point in the animation, so a zoom neither flashes the still
   * frame nor starts the animation over.
   */
  async function start(
    hash: string,
    source: PlaybackSource,
    size: { width: number; height: number },
    replaces?: Player
  ) {
    const canvas = document.createElement('canvas')
    // The renderer sizes its buffer at the device pixel ratio itself.
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(size.width / ratio))
    canvas.height = Math.max(1, Math.round(size.height / ratio))
    const player: Player = {
      preset: shaderPresetKey(source.preset),
      source,
      controller: new AbortController(),
      close() {
        /* Resources are installed when initialization starts. */
      },
      nodeIds: source.nodeIds,
      canvas,
      renderer: null,
      visible: true,
      disposed: false,
      copied: null,
      drawnAt: 0,
      elapsed: 0
    }
    if (replaces) replacing.set(hash, player)
    else players.set(hash, player)
    const current = () =>
      !player.disposed &&
      graph === editor.graph &&
      getView().play !== null &&
      isCurrentInput(editor.graph, hash, source)
    const unavailable = () => {
      if (players.get(hash) === player) {
        stop(hash)
        if (isCurrentInput(editor.graph, hash, source)) fail(hash, player)
      } else if (replacing.get(hash) === player) {
        replacing.delete(hash)
        player.disposed = true
        player.controller.abort()
        failedSizes.set(hash, { preset: source.key, size })
        retired.push(player)
        if (!stepping) release()
      }
    }
    const prepare = () => {
      const resources = playerResources({
        source,
        image: hash,
        canvas,
        signal: player.controller.signal,
        capture: editor.captureShaderContent,
        create: createRenderer,
        texture: options.prepareContent,
        unavailable
      })
      player.close = resources.close
      return resources.ready
    }
    const timeout = setTimeout(() => player.controller.abort(), 10_000)
    try {
      player.renderer = await (source.input
        ? initializers.run(prepare, player.controller.signal)
        : untilAborted(prepare(), player.controller.signal))
      if (!current()) {
        if (players.get(hash) === player) stop(hash)
        player.close()
        return
      }
    } catch (error) {
      const failedCurrent = current()
      if (failedCurrent) console.warn('Could not play a shader', error)
      if (replacing.get(hash) === player) {
        replacing.delete(hash)
        if (failedCurrent) failedSizes.set(hash, { preset: source.key, size })
      } else if (players.get(hash) === player) {
        stop(hash)
        if (failedCurrent) fail(hash, player)
      }
      player.disposed = true
      player.controller.abort()
      player.close()
      return
    } finally {
      clearTimeout(timeout)
    }
    if (replacing.get(hash) !== player) return
    replacing.delete(hash)
    const previous = players.get(hash)
    // The one it replaces may have stopped meanwhile, as when preview ended; then so does this.
    if (!previous || previous !== replaces) {
      player.disposed = true
      retired.push(player)
      if (!stepping) release()
      return
    }
    player.nodeIds = previous.nodeIds
    player.visible = previous.visible
    // The old player kept drawing while this one started, so it takes over from there.
    player.elapsed = previous.elapsed
    players.set(hash, player)
    // Its frame replaces the old one's at the next draw, so the canvas never shows the still.
    previous.disposed = true
    previous.controller.abort()
    retired.push(previous)
    if (!stepping) release()
  }

  /** Whether `size` is far enough from `from`, in pixels, to draw at again. */
  function differs(from: number, size: { width: number; height: number }) {
    const factor = size.width / Math.max(1, from)
    return factor > RESIZE_FACTOR || factor < 1 / RESIZE_FACTOR
  }

  function resized(canvas: HTMLCanvasElement, size: { width: number; height: number }) {
    return differs(canvas.width * (window.devicePixelRatio || 1), size)
  }

  /** Whether a replacement for `hash` failed at about `size`, for the preset it plays now. */
  function failedNear(hash: string, preset: string, size: { width: number; height: number }) {
    const failure = failedSizes.get(hash)
    if (!failure) return false
    if (failure.preset === preset && !differs(failure.size.width, size)) return true
    failedSizes.delete(hash)
    return false
  }

  function syncPlayer(hash: string, shader: PlaybackSource) {
    if (failed.get(hash) !== shader.key) failed.delete(hash)
    const visible = onScreen(shader.bounds)
    const size = screenSize(shader.bounds, shader.input)
    const existing = players.get(hash)
    if (
      existing &&
      visible &&
      !replacing.has(hash) &&
      resized(existing.canvas, size) &&
      !failedNear(hash, shader.key, size)
    ) {
      void start(hash, shader, size, existing)
    }
    if (shader.input && !visible) {
      if (existing) stop(hash)
      return
    }
    const contentCount = [...players.values()].filter((player) => player.source.input).length
    if (
      !players.has(hash) &&
      visible &&
      !failed.has(hash) &&
      (!shader.input || contentCount < MAX_CONTENT_PLAYERS)
    )
      void start(hash, shader, size)
    const player = players.get(hash)
    if (!player) return
    player.nodeIds = shader.nodeIds
    player.visible = visible
  }

  function sync() {
    if (editor.graph !== graph) {
      for (const hash of Array.from(players.keys())) stop(hash)
      failed.clear()
      graph = editor.graph
    }
    syncedVersion = editor.state.sceneVersion
    const view = getView()
    const playing = view.play !== null && canDrawShaders()
    const wanted = playing ? shadersOnPage(editor, view.currentPageId) : new Map()
    for (const [hash, player] of players) {
      const shader = wanted.get(hash)
      if (!shader || shader.key !== player.source.key) stop(hash)
    }
    for (const [hash, shader] of wanted) syncPlayer(hash, shader)
    if (players.size > 0) resume()
    else {
      pause()
      last = 0
    }
  }

  const { pause, resume } = useRafFn(
    ({ timestamp }) => {
      if (stepping || (copyFrames && last !== 0 && timestamp - last < COPY_FRAME_MS)) return
      last = timestamp
      stepping = true
      void step(timestamp).finally(() => {
        stepping = false
        release()
      })
    },
    { immediate: false }
  )

  async function drawPlayer(hash: string, player: Player, now: number): Promise<boolean> {
    // A player's first frame jumps to where the one it replaced had got to.
    const version = editor.state.sceneVersion
    const delta = player.drawnAt === 0 ? player.elapsed : (now - player.drawnAt) / 1000
    if (player.drawnAt !== 0) player.elapsed += delta
    player.drawnAt = now
    const renderer = player.renderer
    if (!renderer) return false
    try {
      await untilAborted(
        renderer.renderFrame({ deltaSeconds: delta, waitForGpu: false }),
        player.controller.signal
      )
      if (renderer.getFailureReason() !== null)
        throw new Error('Shader renderer became unavailable')
    } catch (error) {
      // A stopped driver may finish late. It must not hold retirement or the next document open.
      if (player.controller.signal.aborted || player.disposed) return false
      console.warn('Could not draw a playing shader', error)
      if (players.get(hash) === player) {
        stop(hash)
        fail(hash, player)
      }
      return false
    }
    const ready =
      !player.disposed &&
      graph === editor.graph &&
      getView().play !== null &&
      version === editor.state.sceneVersion &&
      version === syncedVersion
    if (ready) editor.reportShaderPlaybackReady(hash, player.preset)
    return ready
  }

  /**
   * Draws every visible shader and shows its frame. The WebGPU canvas itself is uploaded right
   * after drawing, in the same task, since it keeps its frame only until that task ends. A
   * browser that cannot upload a WebGPU canvas gets a copy of each frame instead, which costs a
   * readback, so frames then come at most every `COPY_FRAME_MS`.
   */
  async function step(now: number) {
    if (syncedVersion !== editor.state.sceneVersion || graph !== editor.graph) sync()
    const version = editor.state.sceneVersion
    const renderer = getRenderer()
    if (!renderer) return
    const copies: Promise<{ hash: string; player: Player; frame: ImageBitmap } | null>[] = []
    let drew = false
    const drawing = [...players].filter(([, player]) => player.visible && player.renderer)
    const started = performance.now()
    for (let index = 0; index < drawing.length; index++) {
      const [hash, player] = drawing[(turn + index) % drawing.length]
      if (!(await drawPlayer(hash, player, now))) continue
      // Preview's islands draw their shader layers from this frame, in this same task.
      frames.publish(hash, player.canvas)
      if (!copyFrames && uploads(renderer, hash, player)) drew = true
      else {
        copyFrames = true
        copies.push(
          createImageBitmap(player.canvas)
            .then((frame) => ({ hash, player, frame }))
            .catch(() => {
              if (players.get(hash) === player) {
                stop(hash)
                fail(hash, player)
              }
              return null
            })
        )
      }
      // The next frame starts with the shaders this one had no time for.
      if (performance.now() - started > FRAME_BUDGET_MS) {
        turn = (turn + index + 1) % drawing.length
        break
      }
    }
    for (const copy of await Promise.all(copies)) {
      if (!copy) continue
      const { hash, player, frame } = copy
      if (
        player.disposed ||
        graph !== editor.graph ||
        getView().play === null ||
        version !== editor.state.sceneVersion
      ) {
        frame.close()
        continue
      }
      try {
        renderer.setLiveImage(hash, frame, player.nodeIds)
      } catch {
        frame.close()
        if (players.get(hash) === player) {
          stop(hash)
          fail(hash, player)
        }
        continue
      }
      player.copied?.close()
      player.copied = frame
      drew = true
    }
    if (drew) markDirty()
    if (players.size === 0) pause()
  }

  /** Whether the canvas shows `player`'s WebGPU canvas uploaded as it is. */
  function uploads(
    renderer: Pick<SkiaRenderer, 'setLiveImage'>,
    hash: string,
    player: Player
  ): boolean {
    try {
      return renderer.setLiveImage(hash, player.canvas, player.nodeIds)
    } catch {
      return false
    }
  }

  watch(() => [getView().play !== null, getView().currentPageId, editor.state.sceneVersion], sync, {
    immediate: true
  })
  // The view moving or the canvas resizing, as it does when preview hides the panels, changes
  // what is on screen.
  watchThrottled(
    () => [
      getView().panX,
      getView().panY,
      getView().zoom,
      getViewport().width,
      getViewport().height
    ],
    sync,
    { throttle: VIEW_CHECK_MS }
  )

  const stopGraph = editor.onEditorEvent('graph:replaced', () => {
    for (const hash of Array.from(players.keys())) stop(hash)
    failed.clear()
    graph = editor.graph
  })
  const stopRetry = editor.onEditorEvent('shader:retry-requested', (ids) => {
    for (const id of ids) {
      const node = editor.graph.getNode(id)
      for (const shader of node ? readShaderPaints(node) : []) {
        failed.delete(shader.image)
        failedSizes.delete(shader.image)
      }
    }
    sync()
  })
  onScopeDispose(() => {
    stopGraph()
    stopRetry()
    pause()
    for (const hash of Array.from(players.keys())) stop(hash)
    release()
  })
}
