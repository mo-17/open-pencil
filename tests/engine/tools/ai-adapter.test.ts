import { describe, expect, test } from 'bun:test'

import { tool } from 'ai'
import * as v from 'valibot'

import { ALL_TOOLS, FigmaAPI, SceneGraph, toolsToAI } from '#core/index'
import { defineTool, isToolExposed } from '#core/tools/schema'

import { expectDefined, expectFills } from '#tests/helpers/assert'

type AdapterTool = {
  description: string
  execute(
    args: Record<string, unknown>,
    execution?: { abortSignal?: AbortSignal; toolCallId?: string }
  ): Promise<unknown>
}
type SDKTool = {
  execute(
    args: Record<string, unknown>,
    call: { toolCallId: string; abortSignal?: AbortSignal }
  ): Promise<unknown>
  description: string
}

interface PageTreeToolResult {
  page: unknown
  children: unknown[]
}

/** Calls a tool as the AI SDK does, with the call's options. */
function adapterTool(tools: Record<string, unknown>, name: string): AdapterTool {
  const sdkTool = tools[name] as SDKTool
  return {
    description: sdkTool.description,
    execute: (args, execution) =>
      sdkTool.execute(args, {
        ...execution,
        toolCallId: execution?.toolCallId ?? `${name}-call`
      })
  }
}

function setup() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)

  const tools = toolsToAI(
    ALL_TOOLS,
    {
      getFigma: () => figma,
      onAfterExecute: () => undefined
    },
    { tool }
  )

  return { graph, figma, tools }
}

describe('AI adapter', () => {
  test('reports an already committed atomic edit when cancellation arrives during presentation work', async () => {
    const { figma } = setup()
    const node = figma.createRectangle()
    const controller = new AbortController()
    const def = defineTool({
      name: 'committed-property-edit',
      description: 'Committed property edit',
      input: v.object({}),
      execution: { kind: 'sync', mutation: 'properties' },
      execute: () => {
        node.opacity = 0.5
        return { id: node.id }
      }
    })
    const tools = toolsToAI(
      [def],
      {
        getFigma: () => figma,
        onAfterExecute: () => {
          controller.abort()
        }
      },
      { tool }
    )
    expect(
      await adapterTool(tools, def.name).execute({}, { abortSignal: controller.signal })
    ).toEqual({ id: node.id })
    expect(node.opacity).toBe(0.5)
  })

  test('honors AI exclusions independently of MCP and WebMCP exposure', () => {
    const base = ALL_TOOLS[0]
    const { figma } = setup()
    const tools = toolsToAI(
      [
        { ...base, name: 'default', exposure: {} },
        { ...base, name: 'hidden', exposure: { ai: false } },
        {
          ...base,
          name: 'other-interface',
          exposure: { webmcp: false, mcp: false }
        }
      ],
      { getFigma: () => figma },
      { tool }
    )
    expect(Object.keys(tools)).toEqual(['default', 'other-interface'])
  })

  test('generates tool for every definition', () => {
    const { tools } = setup()
    const exposed = ALL_TOOLS.filter((def) => isToolExposed(def, 'ai'))
    for (const def of exposed) {
      expect(tools[def.name]).toBeDefined()
    }
    expect(Object.keys(tools).length).toBe(exposed.length)
  })

  test('each tool has description and execute', () => {
    const { tools } = setup()
    for (const aiTool of Object.values(tools)) {
      expect(aiTool.description).toBeTruthy()
      expect(typeof aiTool.execute).toBe('function')
    }
  })

  test('passes the AI request AbortSignal into ToolCtx', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    let received: AbortSignal | undefined
    const tools = toolsToAI(
      [
        defineTool({
          name: 'observe_abort_signal',
          description: 'test',
          params: {},
          execute: (_figma, _args, ctx) => {
            received = ctx?.signal
            return { ok: true }
          }
        })
      ],
      { getFigma: () => figma },
      { tool }
    )
    const controller = new AbortController()
    await adapterTool(tools, 'observe_abort_signal').execute({}, { abortSignal: controller.signal })
    expect(received).toBe(controller.signal)
  })

  test('reports cancellation and skips mutation flashes after an ignored abort', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const controller = new AbortController()
    const flashes: string[][] = []
    let afterContext: { status?: string; signal?: AbortSignal } | undefined
    const tools = toolsToAI(
      [
        defineTool({
          name: 'ignore_abort_signal',
          description: 'test',
          params: {},
          mutates: true,
          execute: () => {
            controller.abort()
            return { id: 'created-after-stop' }
          }
        })
      ],
      {
        getFigma: () => figma,
        onFlashNodes: (ids) => flashes.push(ids),
        onAfterExecute: (_def, context) => {
          afterContext = context
        }
      },
      { tool }
    )

    const outcome = adapterTool(tools, 'ignore_abort_signal')
      .execute({}, { abortSignal: controller.signal })
      .catch((error: Error) => error)

    const error = await outcome
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(flashes).toEqual([])
    expect(afterContext).toMatchObject({
      status: 'aborted',
      signal: controller.signal
    })
  })

  test('reports cancellation when abort arrives during the after-execute hook', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const controller = new AbortController()
    const flashes: string[][] = []
    const tools = toolsToAI(
      [
        defineTool({
          name: 'abort_during_after',
          description: 'test',
          params: {},
          mutates: true,
          execute: () => ({ id: 'created-before-stop' })
        })
      ],
      {
        getFigma: () => figma,
        onAfterExecute: () => controller.abort(),
        onFlashNodes: (ids) => flashes.push(ids)
      },
      { tool }
    )

    const error = await adapterTool(tools, 'abort_during_after')
      .execute({}, { abortSignal: controller.signal })
      .catch((reason: Error) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(flashes).toEqual([])
  })

  test('finish-started commits the active call and rejects a stopped queued call', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const controller = new AbortController()
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const executed: string[] = []
    const completed: string[] = []
    const def = defineTool({
      name: 'finish_started',
      description: 'test',
      input: v.object({ id: v.string() }),
      execution: { kind: 'async', mutation: 'document' },
      execute: async (_figma, args) => {
        executed.push(args.id)
        started.resolve(undefined)
        await release.promise
        return { id: args.id }
      }
    })
    const tools = toolsToAI(
      [def],
      {
        getFigma: () => figma,
        startedCallCancellation: 'finish',
        onAfterExecute: (_def, context) => {
          completed.push(context.status)
        }
      },
      { tool }
    )
    const mutation = adapterTool(tools, def.name)
    const active = mutation.execute({ id: 'active' }, { abortSignal: controller.signal })
    await started.promise
    const queued = mutation
      .execute({ id: 'queued' }, { abortSignal: controller.signal })
      .catch((error: Error) => error)
    controller.abort()
    release.resolve(undefined)
    expect(await active).toEqual({ id: 'active' })
    expect(await queued).toMatchObject({ name: 'AbortError' })
    expect(executed).toEqual(['active'])
    expect(completed).toEqual(['success'])
  })

  test('finish-started still reports an explicit AbortError as cancellation', async () => {
    const def = defineTool({
      name: 'explicit_abort',
      description: 'test',
      input: v.object({}),
      execution: { kind: 'async', mutation: 'document' },
      execute: async () => {
        throw new DOMException('tool aborted', 'AbortError')
      }
    })
    const tools = toolsToAI(
      [def],
      {
        getFigma: () => new FigmaAPI(new SceneGraph()),
        startedCallCancellation: 'finish'
      },
      { tool }
    )
    await expect(adapterTool(tools, def.name).execute({})).rejects.toMatchObject({
      name: 'AbortError'
    })
  })

  test('captures the originating host context before a mutating call waits in the queue', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let sessionChanged = false
    const seen: boolean[] = []
    const def = defineTool({
      name: 'capture_session',
      description: 'test',
      input: v.object({}),
      execution: { kind: 'async', mutation: 'document' },
      execute: async (_figma, _args, context) => {
        seen.push(context?.deferLayout ?? true)
        entered.resolve(undefined)
        await release.promise
        return { ok: true }
      }
    })
    const tools = toolsToAI(
      [def],
      {
        getFigma: () => figma,
        getToolContext: () => ({ deferLayout: sessionChanged })
      },
      { tool }
    )
    const mutation = adapterTool(tools, def.name)
    const first = mutation.execute({})
    await entered.promise
    const second = mutation.execute({})
    sessionChanged = true
    release.resolve(undefined)
    await Promise.all([first, second])
    expect(seen).toEqual([false, false])
  })

  test('serializes mutating tools through their after-execute hooks', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    let active = 0
    let maxActive = 0
    const order: string[] = []
    const tools = toolsToAI(
      [
        defineTool({
          name: 'serialized_mutation',
          description: 'test',
          params: { id: { type: 'string', description: 'ID', required: true } },
          mutates: true,
          execute: async (_figma, args) => {
            active++
            maxActive = Math.max(maxActive, active)
            order.push(`start:${String(args.id)}`)
            await new Promise((resolve) => {
              setTimeout(resolve, 5)
            })
            active--
            return { id: args.id }
          }
        })
      ],
      {
        getFigma: () => figma,
        onAfterExecute: async (_def, context) => {
          order.push(`after:${String((context.result as { id?: string } | undefined)?.id)}`)
          await new Promise((resolve) => {
            setTimeout(resolve, 5)
          })
        }
      },
      { tool }
    )

    const mutation = adapterTool(tools, 'serialized_mutation')
    await Promise.all([mutation.execute({ id: 'one' }), mutation.execute({ id: 'two' })])

    expect(maxActive).toBe(1)
    expect(order).toEqual(['start:one', 'after:one', 'start:two', 'after:two'])
  })

  test('serializes separate adapter instances that share a mutation key', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const mutationKey = {}
    let active = 0
    let maxActive = 0
    const def = defineTool({
      name: 'shared_serialized_mutation',
      description: 'test',
      params: {},
      mutates: true,
      execute: async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => {
          setTimeout(resolve, 5)
        })
        active--
        return { ok: true }
      }
    })
    const makeTools = () => toolsToAI([def], { getFigma: () => figma, mutationKey }, { tool })

    await Promise.all([
      adapterTool(makeTools(), def.name).execute({}),
      adapterTool(makeTools(), def.name).execute({})
    ])

    expect(maxActive).toBe(1)
  })

  test('treats ok false as a rejected result without flashing or replacing the result', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const flashes: string[][] = []
    let status: string | undefined
    const tools = toolsToAI(
      [
        defineTool({
          name: 'rejected_mutation',
          description: 'test',
          params: {},
          mutates: true,
          execute: () => ({
            ok: false,
            error: 'invalid input',
            id: 'not-created'
          })
        })
      ],
      {
        getFigma: () => figma,
        onAfterExecute: (_def, context) => {
          status = context.status
        },
        onFlashNodes: (ids) => flashes.push(ids)
      },
      { tool }
    )

    const result = await adapterTool(tools, 'rejected_mutation').execute({})
    expect(result).toEqual({
      ok: false,
      error: 'invalid input',
      id: 'not-created'
    })
    expect(status).toBe('error')
    expect(flashes).toEqual([])
  })

  test('treats the legacy bare error envelope as a rejected result', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    let status: string | undefined
    const tools = toolsToAI(
      [
        defineTool({
          name: 'legacy_rejected_mutation',
          description: 'test',
          params: {},
          mutates: true,
          execute: () => ({ error: 'missing node' })
        })
      ],
      {
        getFigma: () => figma,
        onAfterExecute: (_def, context) => {
          status = context.status
        }
      },
      { tool }
    )

    const result = await adapterTool(tools, 'legacy_rejected_mutation').execute({})
    expect(result).toEqual({ error: 'missing node' })
    expect(status).toBe('error')
  })

  test('passes successful tool results to the after-execute hook', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    let afterContext: { status?: string; result?: unknown } | undefined
    const tools = toolsToAI(
      [
        defineTool({
          name: 'return_result',
          description: 'test',
          params: {},
          execute: () => ({ ok: true, value: 42 })
        })
      ],
      {
        getFigma: () => figma,
        onAfterExecute: (_def, context) => {
          afterContext = context
        }
      },
      { tool }
    )

    await adapterTool(tools, 'return_result').execute({})
    expect(afterContext).toMatchObject({
      status: 'success',
      result: { ok: true, value: 42 }
    })
  })

  test('create_shape tool works through adapter', async () => {
    const { tools, figma } = setup()
    const createShape = adapterTool(tools, 'create_shape')
    const result = (await createShape.execute({
      type: 'RECTANGLE',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      name: 'Test Rect'
    })) as { id: string; type: string; name: string }

    expect(result.id).toBeTruthy()
    expect(result.type).toBe('RECTANGLE')
    expect(result.name).toBe('Test Rect')

    const node = expectDefined(figma.getNodeById(result.id), 'created node')
    expect(node.x).toBe(10)
    expect(node.y).toBe(20)
    expect(node.width).toBe(100)
  })

  test('set_fill tool works through adapter', async () => {
    const { tools, figma } = setup()
    const rect = figma.createRectangle()
    rect.resize(100, 100)

    const setFill = adapterTool(tools, 'set_fill')
    await setFill.execute({ id: rect.id, color: '#00ff00' })

    const fills = expectFills(expectDefined(figma.getNodeById(rect.id), 'filled rectangle').fills)
    expect(fills.length).toBe(1)
    expect(fills[0].color.g).toBeCloseTo(1)
  })

  test('get_page_tree tool returns structure', async () => {
    const { tools, figma } = setup()
    const frame = figma.createFrame()
    frame.name = 'TestFrame'
    frame.resize(200, 200)
    const rect = figma.createRectangle()
    rect.resize(50, 50)
    frame.appendChild(rect)

    const getTree = adapterTool(tools, 'get_page_tree')
    const result = (await getTree.execute({})) as PageTreeToolResult
    expect(result.page).toBeTruthy()
    expect(result.children.length).toBeGreaterThan(0)
  })

  test('uses an execution wrapper when provided', async () => {
    const calls: string[] = []
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const createShape = ALL_TOOLS.find((candidate) => candidate.name === 'create_shape')
    if (!createShape) throw new Error('create_shape tool missing')
    const tools = toolsToAI(
      [createShape],
      {
        getFigma: () => figma,
        executeTool: async (def, target, args) => {
          calls.push(def.name)
          return def.execute(target, args)
        }
      },
      { tool }
    )

    await adapterTool(tools, 'create_shape').execute({ type: 'RECTANGLE' })

    expect(calls).toEqual(['create_shape'])
  })

  test('onBeforeExecute and onAfterExecute are called', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const calls: string[] = []

    const tools = toolsToAI(
      ALL_TOOLS,
      {
        getFigma: () => figma,
        onBeforeExecute: () => {
          calls.push('before')
        },
        onAfterExecute: () => {
          calls.push('after')
        }
      },
      { tool }
    )

    const listPages = adapterTool(tools, 'list_pages')
    await listPages.execute({})

    expect(calls).toEqual(['before', 'after'])
  })

  test('onAfterExecute called even on error', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    let afterCalled = false

    const tools = toolsToAI(
      ALL_TOOLS,
      {
        getFigma: () => figma,
        onAfterExecute: () => {
          afterCalled = true
        }
      },
      { tool }
    )

    const evalTool = adapterTool(tools, 'eval')
    try {
      await evalTool.execute({ code: 'throw new Error("test")' })
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }

    expect(afterCalled).toBe(true)
  })

  test('find_nodes works through adapter', async () => {
    const { tools, figma } = setup()
    figma.createRectangle().name = 'Button'
    figma.createText().name = 'Label'
    figma.createRectangle().name = 'Button Secondary'

    const findNodes = adapterTool(tools, 'find_nodes')
    const result = (await findNodes.execute({ name: 'button' })) as {
      count: number
    }
    expect(result.count).toBe(2)
  })

  test('set_layout works through adapter', async () => {
    const { tools, figma } = setup()
    const frame = figma.createFrame()
    frame.resize(300, 200)

    const setLayout = adapterTool(tools, 'set_layout')
    await setLayout.execute({
      id: frame.id,
      direction: 'HORIZONTAL',
      spacing: 8,
      padding: 16
    })

    const node = expectDefined(figma.getNodeById(frame.id), 'layout frame')
    expect(node.layoutMode).toBe('HORIZONTAL')
    expect(node.itemSpacing).toBe(8)
    expect(node.paddingLeft).toBe(16)
  })

  test('render JSX works through adapter', async () => {
    const { tools } = setup()
    const render = adapterTool(tools, 'render')
    const result = (await render.execute({
      jsx: '<Frame name="Card" w={200} h={100}><Text>Hello</Text></Frame>'
    })) as { name: string; type: string }
    expect(result.name).toBe('Card')
    expect(result.type).toBe('FRAME')
  })

  test('delete + get returns error for removed node', async () => {
    const { tools, figma } = setup()
    const rect = figma.createRectangle()
    const id = rect.id

    const deleteTool = adapterTool(tools, 'delete_node')
    await deleteTool.execute({ id })

    const getNode = adapterTool(tools, 'get_node')
    const result = (await getNode.execute({ id })) as { error: string }
    expect(result.error).toContain('not found')
  })
})
