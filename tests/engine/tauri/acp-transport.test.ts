/* oxlint-disable eslint/max-lines -- ACP process and prompt lifecycle scenarios share one protocol fixture. */
import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import type { FileUIPart, UIMessageChunk } from 'ai'

import { encodeBase64 } from '@open-pencil/core/bytes'
import { ACP_AGENTS } from '@open-pencil/core/constants'

import {
  ACPChatTransport,
  buildACPMCPServerConfigs,
  buildOpenPencilMCPServerConfig,
  type ACPSessionOpenedEvent,
  type ACPSessionSetupEvent
} from '@/app/ai/acp/transport'
import { createACPTransport } from '@/app/ai/chat/transports'
import * as automationMCP from '@/app/automation/mcp/spawn'

import { clearTauriMocks, mockTauriIPC } from '#tests/helpers/tauri/mocks'

const TEST_AUTOMATION_AUTH_TOKEN = 'test-automation-token'
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = new Uint8Array([0xff, 0xd8, 0xff])
const TEST_CODEX_AGENT = ACP_AGENTS.find((agent) => agent.id === 'codex')
if (!TEST_CODEX_AGENT) throw new Error('Missing Codex ACP agent fixture')

beforeEach(() => {
  vi.spyOn(automationMCP, 'getAutomationAuthToken').mockResolvedValue(TEST_AUTOMATION_AUTH_TOKEN)
})

afterEach(async () => {
  await clearTauriMocks()
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
})

type JSONRPCRequest = {
  id: number
  method: string
  params: Record<string, unknown>
}

type JSONRPCReply = {
  respond(result: unknown): void
  reject(message: string): void
}

async function installFakeACPAgent() {
  const requests: JSONRPCRequest[] = []
  let onEvent: ((event: unknown) => void) | null = null
  let requestHandler: (request: JSONRPCRequest, reply: JSONRPCReply) => void = () => undefined
  let pid = 100
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  function emit(message: unknown, target = onEvent) {
    target?.({
      event: 'Stdout',
      payload: [...encoder.encode(`${JSON.stringify(message)}\n`)]
    })
  }

  await mockTauriIPC((cmd, args) => {
    if (cmd === 'plugin:path|resolve_directory') return '/Users/tester'
    if (cmd === 'plugin:shell|spawn') {
      onEvent = (args as { onEvent: { onmessage: (event: unknown) => void } }).onEvent.onmessage
      pid += 1
      return pid
    }
    if (cmd === 'plugin:shell|stdin_write') {
      const target = onEvent
      const raw = decoder.decode(new Uint8Array((args as { buffer: number[] }).buffer))
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        const request = JSON.parse(line) as JSONRPCRequest
        requests.push(request)
        requestHandler(request, {
          respond: (result) => emit({ id: request.id, result }, target),
          reject: (message) => emit({ id: request.id, error: { code: -32_603, message } }, target)
        })
      }
    }
    return null
  })

  return {
    requests,
    handleRequests(handler: typeof requestHandler) {
      requestHandler = handler
    },
    notify(params: unknown) {
      emit({ method: 'session/update', params })
    },
    terminate() {
      onEvent?.({ event: 'Terminated', payload: { code: 1, signal: null } })
    }
  }
}

async function waitForRequest(
  requests: readonly JSONRPCRequest[],
  method: string,
  occurrence = 1
): Promise<JSONRPCRequest> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const matches = requests.filter((request) => request.method === method)
    const request = matches[occurrence - 1]
    if (request) return request
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  }
  throw new Error(`Timed out waiting for ${method} request #${occurrence}`)
}

async function readChunks(
  stream: ReadableStream<UIMessageChunk>,
  onChunk: (chunk: UIMessageChunk) => void = () => undefined
): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = []
  const reader = stream.getReader()
  while (true) {
    const result = await reader.read()
    if (result.done) return chunks
    chunks.push(result.value)
    onChunk(result.value)
  }
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  }
  throw new Error('Timed out waiting for ACP stream output')
}

function userMessage(text: string, abortSignal?: AbortSignal) {
  return {
    trigger: 'submit-message' as const,
    chatId: 'chat-1',
    messageId: undefined,
    messages: [
      { id: `user-${text}`, role: 'user' as const, parts: [{ type: 'text' as const, text }] }
    ],
    abortSignal
  }
}

function dataURL(mediaType: string, bytes: Uint8Array): string {
  return `data:${mediaType};base64,${encodeBase64(bytes)}`
}

function pngBytes(byteLength = PNG_SIGNATURE.byteLength): Uint8Array {
  const bytes = new Uint8Array(byteLength)
  bytes.set(PNG_SIGNATURE)
  return bytes
}

function filePart(overrides: Partial<FileUIPart> = {}): FileUIPart {
  return {
    type: 'file',
    mediaType: 'image/png',
    filename: 'reference.png',
    url: dataURL('image/png', PNG_SIGNATURE),
    ...overrides
  }
}

function imageUserMessage(
  text: string,
  files: FileUIPart[] = [filePart()],
  references: Array<{ source: 'file' | 'selection'; canvasNodeIds?: string[] }> = files.map(() => ({
    source: 'file'
  })),
  abortSignal?: AbortSignal
) {
  return {
    trigger: 'submit-message' as const,
    chatId: 'chat-1',
    messageId: undefined,
    messages: [
      {
        id: `user-image-${text}`,
        role: 'user' as const,
        metadata: {
          visualAttachments: references
        },
        parts: [{ type: 'text' as const, text }, ...files]
      }
    ],
    abortSignal
  }
}

const TEST_CONFIG_OPTIONS: SessionConfigOption[] = [
  {
    type: 'select',
    id: 'model',
    name: 'Model',
    category: 'model',
    currentValue: 'gpt-5.6-sol',
    options: [{ value: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]
  },
  {
    type: 'select',
    id: 'reasoning_effort',
    name: 'Reasoning effort',
    category: 'thought_level',
    currentValue: 'high',
    options: [{ value: 'high', name: 'High' }]
  }
]

describe('Tauri ACP transport', () => {
  test('connects ACP agents to the authenticated desktop HTTP MCP server', () => {
    expect(buildOpenPencilMCPServerConfig(TEST_AUTOMATION_AUTH_TOKEN)).toEqual({
      type: 'http',
      name: 'open-pencil',
      url: 'http://127.0.0.1:7600/mcp',
      headers: [{ name: 'Authorization', value: `Bearer ${TEST_AUTOMATION_AUTH_TOKEN}` }]
    })
  })

  test('omits the authorization header when MCP authentication is disabled', () => {
    expect(buildOpenPencilMCPServerConfig(null)).toEqual({
      type: 'http',
      name: 'open-pencil',
      url: 'http://127.0.0.1:7600/mcp',
      headers: []
    })
  })

  test('appends selected remote MCP servers to ACP session configuration', () => {
    const remote = {
      type: 'http' as const,
      name: 'remote-mcp-0123456789abcdef',
      url: 'https://mcp.example.com/tools',
      headers: [{ name: 'Authorization', value: 'Bearer runtime-only' }]
    }
    expect(buildACPMCPServerConfigs(TEST_AUTOMATION_AUTH_TOKEN, [remote])).toEqual([
      buildOpenPencilMCPServerConfig(TEST_AUTOMATION_AUTH_TOKEN),
      remote
    ])
  })

  test('uses Tauri home directory for transport cwd', async () => {
    await mockTauriIPC((cmd, args) => {
      expect(cmd).toBe('plugin:path|resolve_directory')
      expect(args).toEqual({ directory: 21 })
      return '/Users/tester'
    })

    const transport = (await createACPTransport('acp:claude-code')) as ACPChatTransport & {
      cwd: string
    }

    expect(transport.cwd).toBe('/Users/tester')
  })

  test('publishes negotiated session setup exactly once when connect succeeds', async () => {
    const agent = await installFakeACPAgent()
    const setups: ACPSessionSetupEvent[] = []
    const opened: ACPSessionOpenedEvent[] = []
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: { list: {}, resume: {} }
          }
        })
      } else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'setup-session', configOptions: TEST_CONFIG_OPTIONS })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project',
      onSessionSetup: (event) => setups.push(event),
      onSessionOpened: (event) => opened.push(event)
    })

    await Promise.all([transport.connect(), transport.connect()])
    await transport.connect()

    expect(setups).toEqual([
      {
        sessionId: 'setup-session',
        method: 'new',
        capabilities: { list: true, resume: true, load: true }
      }
    ])
    expect(opened).toEqual([])
    expect(agent.requests.map((request) => request.method)).toEqual(['initialize', 'session/new'])
    await transport.destroy()
  })

  test('fails closed when strict resume is unsupported', async () => {
    const agent = await installFakeACPAgent()
    const setups: ACPSessionSetupEvent[] = []
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') reply.respond({ protocolVersion: 1 })
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project',
      initialSessionId: 'strict-session',
      resumeFallback: 'error',
      onSessionSetup: (event) => setups.push(event)
    })

    await expect(transport.connect()).rejects.toThrow('does not support session/resume')

    expect(agent.requests.map((request) => request.method)).toEqual(['initialize'])
    expect(setups).toEqual([])
    await transport.destroy()
  })

  test('fails closed when a strict resume request fails', async () => {
    const agent = await installFakeACPAgent()
    const setups: ACPSessionSetupEvent[] = []
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { resume: {} } }
        })
      } else if (request.method === 'session/resume') {
        reply.reject('Selected session is unavailable')
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project',
      initialSessionId: 'strict-session',
      resumeFallback: 'error',
      onSessionSetup: (event) => setups.push(event)
    })

    await expect(transport.connect()).rejects.toThrow('Selected session is unavailable')

    expect(agent.requests.map((request) => request.method)).toEqual([
      'initialize',
      'session/resume'
    ])
    expect(agent.requests.some((request) => request.method === 'session/new')).toBe(false)
    expect(setups).toEqual([])
    await transport.destroy()
  })

  test('rejects session listing when the agent does not advertise support', async () => {
    const agent = await installFakeACPAgent()
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') reply.respond({ protocolVersion: 1 })
      else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'active-session', configOptions: TEST_CONFIG_OPTIONS })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project'
    })

    await transport.connect()
    await expect(transport.listSessions()).rejects.toThrow('does not support session/list')

    expect(agent.requests.some((request) => request.method === 'session/list')).toBe(false)
    await transport.destroy()
  })

  test('lists bounded same-cwd sessions with pagination, deduplication, and sanitization', async () => {
    const agent = await installFakeACPAgent()
    const longTitle = `Long ${'x'.repeat(600)}`
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { list: {} } }
        })
      } else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'active-session', configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/list' && request.params.cursor === undefined) {
        reply.respond({
          sessions: [
            {
              sessionId: 'same-cwd-1',
              cwd: '/Users/tester/project',
              title: '  First\n\t session  ',
              updatedAt: '2026-08-03T08:00:00+08:00',
              _meta: { secret: 'must-not-leak' }
            },
            {
              sessionId: 'same-cwd-1',
              cwd: '/Users/tester/project',
              title: 'Duplicate must not replace first'
            },
            {
              sessionId: 'other-cwd',
              cwd: '/Users/tester/other',
              title: 'Filtered'
            },
            { sessionId: '', cwd: '/Users/tester/project', title: 'Invalid ID' },
            { sessionId: ' padded ', cwd: '/Users/tester/project', title: 'Padded ID' },
            { sessionId: 'control\nid', cwd: '/Users/tester/project', title: 'Control ID' }
          ],
          nextCursor: 'page-2',
          _meta: { server: 'private' }
        })
      } else if (request.method === 'session/list' && request.params.cursor === 'page-2') {
        reply.respond({
          sessions: [
            {
              sessionId: 'same-cwd-2',
              cwd: '/Users/tester/project',
              title: longTitle,
              updatedAt: 'not-a-date',
              _meta: { secret: 'must-not-leak' }
            },
            {
              sessionId: 'same-cwd-3',
              cwd: '/Users/tester/project',
              title: null,
              updatedAt: null
            }
          ],
          nextCursor: null
        })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project'
    })

    await transport.connect()
    const sessions = await transport.listSessions()

    expect(
      agent.requests
        .filter((request) => request.method === 'session/list')
        .map((request) => request.params)
    ).toEqual([
      { cwd: '/Users/tester/project' },
      { cwd: '/Users/tester/project', cursor: 'page-2' }
    ])
    expect(sessions).toEqual([
      {
        sessionId: 'same-cwd-1',
        cwd: '/Users/tester/project',
        title: 'First session',
        updatedAt: '2026-08-03T00:00:00.000Z'
      },
      {
        sessionId: 'same-cwd-2',
        cwd: '/Users/tester/project',
        title: longTitle.trim().slice(0, 512),
        updatedAt: null
      },
      {
        sessionId: 'same-cwd-3',
        cwd: '/Users/tester/project',
        title: null,
        updatedAt: null
      }
    ])
    expect(Object.keys(sessions[0] ?? {}).sort()).toEqual([
      'cwd',
      'sessionId',
      'title',
      'updatedAt'
    ])
    await transport.destroy()
  })

  test('fails closed when session listing repeats a pagination cursor', async () => {
    const agent = await installFakeACPAgent()
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { list: {} } }
        })
      } else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'active-session', configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/list') {
        reply.respond({ sessions: [], nextCursor: 'repeated-cursor' })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project'
    })

    await transport.connect()
    await expect(transport.listSessions()).rejects.toThrow('repeated session/list cursor')

    expect(agent.requests.filter((request) => request.method === 'session/list')).toHaveLength(2)
    await transport.destroy()
  })

  test('rejects a pending session listing when the transport is destroyed', async () => {
    const agent = await installFakeACPAgent()
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { list: {} } }
        })
      } else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'active-session', configOptions: TEST_CONFIG_OPTIONS })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project'
    })

    await transport.connect()
    const pendingList = transport.listSessions()
    await waitForRequest(agent.requests, 'session/list')
    const pendingDestroy = transport.destroy()

    await expect(pendingList).rejects.toThrow('ACP transport was destroyed.')
    await pendingDestroy
  })

  test('does not publish a prewarmed new session that exits before its first prompt', async () => {
    const agent = await installFakeACPAgent()
    const opened: ACPSessionOpenedEvent[] = []
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') reply.respond({ protocolVersion: 1 })
      else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'unused-session', configOptions: TEST_CONFIG_OPTIONS })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project',
      onSessionOpened: (event) => opened.push(event)
    })

    await transport.connect()

    expect(agent.requests.map((request) => request.method)).toEqual(['initialize', 'session/new'])
    expect(opened).toEqual([])
    await transport.destroy()
    expect(agent.requests.some((request) => request.method === 'session/prompt')).toBe(false)
  })

  test('does not publish a new session until its first prompt succeeds', async () => {
    const agent = await installFakeACPAgent()
    const opened: ACPSessionOpenedEvent[] = []
    let failPrompt = true
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') reply.respond({ protocolVersion: 1 })
      else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'prompted-session', configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/prompt') {
        if (failPrompt) reply.reject('Prompt failed before completion')
        else reply.respond({ stopReason: 'end_turn' })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project',
      onSessionOpened: (event) => opened.push(event)
    })

    await transport.connect()
    await readChunks(await transport.sendMessages(userMessage('first attempt')))

    expect(opened).toEqual([])
    failPrompt = false
    await readChunks(await transport.sendMessages(userMessage('second attempt')))

    const promptRequests = agent.requests.filter((request) => request.method === 'session/prompt')
    expect(promptRequests).toHaveLength(2)
    for (const request of promptRequests) {
      const promptText = (request.params.prompt as Array<{ type: string; text: string }>)[0]?.text
      expect(promptText).toContain('You are a design assistant inside a vector design editor.')
    }
    expect(opened).toEqual([{ sessionId: 'prompted-session', method: 'new' }])
    await transport.destroy()
  })

  test('resumes a persisted session only when the agent advertises resume support', async () => {
    const agent = await installFakeACPAgent()
    const opened: ACPSessionOpenedEvent[] = []
    const configSnapshots: Array<readonly SessionConfigOption[]> = []
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { resume: {} } }
        })
      } else if (request.method === 'session/resume') {
        reply.respond({ configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/prompt') {
        reply.respond({ stopReason: 'end_turn' })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project',
      initialSessionId: 'persisted-session',
      onConfigOptionsChange: (options) => configSnapshots.push(options),
      onSessionOpened: (event) => opened.push(event)
    })

    await transport.connect()

    expect(agent.requests.map((request) => request.method)).toEqual([
      'initialize',
      'session/resume'
    ])
    expect(agent.requests.at(-1)?.params).toEqual({
      cwd: '/Users/tester/project',
      mcpServers: [buildOpenPencilMCPServerConfig(TEST_AUTOMATION_AUTH_TOKEN)],
      sessionId: 'persisted-session'
    })
    expect(configSnapshots.at(-1)).toEqual(TEST_CONFIG_OPTIONS)
    expect(opened).toEqual([])

    await readChunks(await transport.sendMessages(userMessage('continue the design')))

    expect(opened).toEqual([{ sessionId: 'persisted-session', method: 'resume' }])
    await transport.destroy()
  })

  test('creates a new session when a persisted ID exists but resume is not advertised', async () => {
    const agent = await installFakeACPAgent()
    const setups: ACPSessionSetupEvent[] = []
    const opened: ACPSessionOpenedEvent[] = []
    const restoreError = `The ACP agent "${TEST_CODEX_AGENT.name}" does not support session/resume.`
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') reply.respond({ protocolVersion: 1 })
      else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'new-session', configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/prompt') {
        reply.respond({ stopReason: 'end_turn' })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project',
      initialSessionId: 'unsupported-session',
      onSessionSetup: (event) => setups.push(event),
      onSessionOpened: (event) => opened.push(event)
    })

    await transport.connect()

    expect(agent.requests.map((request) => request.method)).toEqual(['initialize', 'session/new'])
    expect(setups).toEqual([
      {
        sessionId: 'new-session',
        method: 'new',
        restoreError,
        capabilities: { list: false, resume: false, load: false }
      }
    ])
    expect(opened).toEqual([])

    await readChunks(await transport.sendMessages(userMessage('start the design')))

    expect(opened).toEqual([{ sessionId: 'new-session', method: 'new', restoreError }])
    await transport.destroy()
  })

  test('falls back to one new session after resume fails and reports the restore error', async () => {
    const agent = await installFakeACPAgent()
    const setups: ACPSessionSetupEvent[] = []
    const opened: ACPSessionOpenedEvent[] = []
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { resume: {} } }
        })
      } else if (request.method === 'session/resume') {
        reply.reject('Stored session is unavailable')
      } else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'replacement-session', configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/prompt') {
        reply.respond({ stopReason: 'end_turn' })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project',
      initialSessionId: 'stale-session',
      onSessionSetup: (event) => setups.push(event),
      onSessionOpened: (event) => opened.push(event)
    })

    await transport.connect()

    expect(agent.requests.map((request) => request.method)).toEqual([
      'initialize',
      'session/resume',
      'session/new'
    ])
    expect(setups).toEqual([
      {
        sessionId: 'replacement-session',
        method: 'new',
        restoreError: 'Stored session is unavailable',
        capabilities: { list: false, resume: true, load: false }
      }
    ])
    expect(opened).toEqual([])

    await readChunks(await transport.sendMessages(userMessage('start a replacement session')))

    expect(opened).toEqual([
      {
        sessionId: 'replacement-session',
        method: 'new',
        restoreError: 'Stored session is unavailable'
      }
    ])
    await transport.destroy()
  })

  test('does not publish or replace a persisted ID when resume and fallback creation both fail', async () => {
    const agent = await installFakeACPAgent()
    const opened: ACPSessionOpenedEvent[] = []
    let failSetup = true
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { resume: {} } }
        })
      } else if (request.method === 'session/resume') {
        if (failSetup) reply.reject('Stored session is unavailable')
        else reply.respond({ configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/new') {
        reply.reject('Cannot create replacement session')
      } else if (request.method === 'session/prompt') {
        reply.respond({ stopReason: 'end_turn' })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project',
      initialSessionId: 'preserved-session',
      onSessionOpened: (event) => opened.push(event)
    })

    await expect(transport.connect()).rejects.toThrow('Cannot create replacement session')
    expect(opened).toEqual([])

    failSetup = false
    await transport.connect()
    const resumeRequests = agent.requests.filter((request) => request.method === 'session/resume')
    expect(resumeRequests).toHaveLength(2)
    expect(resumeRequests[1]?.params.sessionId).toBe('preserved-session')
    expect(opened).toEqual([])

    await readChunks(await transport.sendMessages(userMessage('retry the preserved session')))

    expect(opened).toEqual([{ sessionId: 'preserved-session', method: 'resume' }])
    await transport.destroy()
  })

  test('refreshes runtime context without repeating the system prompt after resume', async () => {
    const agent = await installFakeACPAgent()
    const opened: ACPSessionOpenedEvent[] = []
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { resume: {} } }
        })
      } else if (request.method === 'session/resume') {
        reply.respond({ configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/prompt') {
        reply.respond({ stopReason: 'end_turn' })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project',
      initialSessionId: 'persisted-session',
      onSessionOpened: (event) => opened.push(event)
    })

    await readChunks(await transport.sendMessages(userMessage('continue the design')))

    const promptRequest = agent.requests.find((request) => request.method === 'session/prompt')
    const promptText = promptRequest
      ? (promptRequest.params.prompt as Array<{ type: string; text: string }>)[0]?.text
      : undefined
    expect(promptText).toContain('# ACP runtime metadata')
    expect(promptText).toContain('continue the design')
    expect(promptText).not.toContain('You are a design assistant inside a vector design editor.')
    expect(opened).toEqual([{ sessionId: 'persisted-session', method: 'resume' }])
    await transport.destroy()
  })

  test('does not publish a session that becomes stale while resume is pending', async () => {
    const agent = await installFakeACPAgent()
    const opened: ACPSessionOpenedEvent[] = []
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { resume: {} } }
        })
      }
    })
    const transport = new ACPChatTransport({
      agentDef: TEST_CODEX_AGENT,
      cwd: '/Users/tester/project',
      initialSessionId: 'persisted-session',
      onSessionOpened: (event) => opened.push(event)
    })

    const pendingConnect = transport.connect()
    await waitForRequest(agent.requests, 'session/resume')
    const pendingDestroy = transport.destroy()

    await expect(pendingConnect).rejects.toThrow('ACP transport was destroyed.')
    await pendingDestroy
    expect(opened).toEqual([])
    expect(agent.requests.some((request) => request.method === 'session/new')).toBe(false)
  })

  test('connects before the first prompt and updates model configuration through ACP', async () => {
    const initialOptions: SessionConfigOption[] = [
      {
        type: 'select',
        id: 'model',
        name: 'Model',
        category: 'model',
        currentValue: 'gpt-5.6-sol',
        options: [
          { value: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
          { value: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' }
        ]
      },
      {
        type: 'select',
        id: 'reasoning_effort',
        name: 'Reasoning effort',
        category: 'thought_level',
        currentValue: 'high',
        options: [
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' }
        ]
      }
    ]
    const refreshedOptions: SessionConfigOption[] = [
      { ...initialOptions[0], currentValue: 'gpt-5.6-terra' },
      {
        ...initialOptions[1],
        currentValue: 'medium',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' }
        ]
      }
    ]
    const startupUpdateOptions: SessionConfigOption[] = [
      { ...initialOptions[0], currentValue: 'gpt-5.6-terra' },
      { ...initialOptions[1], currentValue: 'medium' }
    ]
    const requests: Array<{ id: number; method: string; params: Record<string, unknown> }> = []
    const configSnapshots: Array<readonly SessionConfigOption[]> = []
    let onEvent: ((event: unknown) => void) | null = null
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    function respond(id: number, result: unknown) {
      onEvent?.({
        event: 'Stdout',
        payload: [...encoder.encode(`${JSON.stringify({ id, result })}\n`)]
      })
    }

    function reject(id: number, message: string) {
      onEvent?.({
        event: 'Stdout',
        payload: [
          ...encoder.encode(`${JSON.stringify({ id, error: { code: -32602, message } })}\n`)
        ]
      })
    }

    function notify(params: unknown) {
      onEvent?.({
        event: 'Stdout',
        payload: [...encoder.encode(`${JSON.stringify({ method: 'session/update', params })}\n`)]
      })
    }

    await mockTauriIPC((cmd, args) => {
      if (cmd === 'plugin:path|resolve_directory') return '/Users/tester'
      if (cmd === 'plugin:shell|spawn') {
        onEvent = (args as { onEvent: { onmessage: (event: unknown) => void } }).onEvent.onmessage
        return 77
      }
      if (cmd === 'plugin:shell|stdin_write') {
        const raw = decoder.decode(new Uint8Array((args as { buffer: number[] }).buffer))
        for (const line of raw.trim().split('\n')) {
          const request = JSON.parse(line) as (typeof requests)[number]
          requests.push(request)
          if (request.method === 'initialize') respond(request.id, { protocolVersion: 1 })
          else if (request.method === 'session/new') {
            notify({
              sessionId: 'session-1',
              update: {
                sessionUpdate: 'config_option_update',
                configOptions: startupUpdateOptions
              }
            })
            respond(request.id, { sessionId: 'session-1', configOptions: initialOptions })
          } else if (request.method === 'session/set_config_option') {
            if (request.params.value === 'invalid') reject(request.id, 'Invalid model')
            else respond(request.id, { configOptions: refreshedOptions })
          }
        }
      }
      return null
    })

    const transport = await createACPTransport('acp:codex', (options) => {
      configSnapshots.push(options)
    })

    await transport.connect()
    expect(automationMCP.getAutomationAuthToken).toHaveBeenCalledTimes(1)
    expect(requests.map((request) => request.method)).toEqual(['initialize', 'session/new'])
    expect(requests.find((request) => request.method === 'session/new')?.params).toMatchObject({
      cwd: '/Users/tester',
      mcpServers: [buildOpenPencilMCPServerConfig(TEST_AUTOMATION_AUTH_TOKEN)]
    })
    expect(configSnapshots.at(-1)).toEqual(startupUpdateOptions)

    await transport.setSessionConfigOption('model', 'gpt-5.6-terra')
    expect(requests.at(-1)).toMatchObject({
      method: 'session/set_config_option',
      params: {
        sessionId: 'session-1',
        configId: 'model',
        value: 'gpt-5.6-terra'
      }
    })
    expect(configSnapshots.at(-1)).toEqual(refreshedOptions)
    expect(configSnapshots.at(-1)?.[1]?.currentValue).toBe('medium')

    const snapshotCount = configSnapshots.length
    await expect(transport.setSessionConfigOption('model', 'invalid')).rejects.toThrow(
      'Invalid model'
    )
    expect(configSnapshots).toHaveLength(snapshotCount)

    await transport.destroy()
  })

  test('rejects pending session setup when the agent process exits', async () => {
    const agent = await installFakeACPAgent()
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') reply.respond({ protocolVersion: 1 })
    })
    const transport = await createACPTransport('acp:codex')

    const pendingConnect = transport.connect()
    await waitForRequest(agent.requests, 'session/new')
    agent.terminate()

    await expect(pendingConnect).rejects.toThrow('Agent process exited unexpectedly.')
    await transport.destroy()
  })

  test('rejects a pending config change when the transport is destroyed', async () => {
    const agent = await installFakeACPAgent()
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') reply.respond({ protocolVersion: 1 })
      else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'session-1', configOptions: TEST_CONFIG_OPTIONS })
      }
    })
    const transport = await createACPTransport('acp:codex')
    await transport.connect()

    const pendingChange = transport.setSessionConfigOption('model', 'gpt-5.6-terra')
    await waitForRequest(agent.requests, 'session/set_config_option')
    const pendingDestroy = transport.destroy()

    await expect(pendingChange).rejects.toThrow('ACP transport was destroyed.')
    await pendingDestroy
  })

  test('maps image file parts to ACP image content when the agent advertises support', async () => {
    const agent = await installFakeACPAgent()
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: { promptCapabilities: { image: true } }
        })
      } else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'session-1', configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/prompt') {
        reply.respond({ stopReason: 'end_turn' })
      }
    })
    const transport = await createACPTransport('acp:codex')

    const jpeg = filePart({
      filename: 'paperclip.jpg',
      mediaType: 'image/jpeg',
      url: dataURL('image/jpeg', JPEG_SIGNATURE)
    })
    await readChunks(
      await transport.sendMessages(
        imageUserMessage(
          'Use both references',
          [filePart(), jpeg],
          [{ source: 'selection', canvasNodeIds: ['0:42'] }, { source: 'file' }]
        )
      )
    )

    const request = await waitForRequest(agent.requests, 'session/prompt')
    const prompt = request.params.prompt as Array<{
      type: string
      text?: string
      data?: string
      mimeType?: string
    }>
    expect(prompt).toHaveLength(3)
    expect(prompt[0]?.text).toContain('Use both references')
    expect(prompt[0]?.text).toContain('[BEGIN_OPENPENCIL_VISUAL_REFERENCE_SOURCE_CONTEXT]')
    expect(prompt[0]?.text).toContain(
      '{"schema":"openpencil.visual-reference-source.v1","references":[{"attachmentIndex":0,"source":"selection","canvasNodeIds":["0:42"]},{"attachmentIndex":1,"source":"file"}]}'
    )
    expect(prompt[0]?.text).not.toContain('iVBORw0KGgo=')
    expect(prompt[1]).toEqual({
      type: 'image',
      data: 'iVBORw0KGgo=',
      mimeType: 'image/png'
    })
    expect(prompt[2]).toEqual({
      type: 'image',
      data: '/9j/',
      mimeType: 'image/jpeg'
    })
    await transport.destroy()
  })

  test('rejects image prompts without sending them when the agent lacks image support', async () => {
    const agent = await installFakeACPAgent()
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: { promptCapabilities: { image: false } }
        })
      } else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'session-1', configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/prompt') {
        reply.respond({ stopReason: 'end_turn' })
      }
    })
    const transport = await createACPTransport('acp:codex')

    await expect(transport.sendMessages(imageUserMessage('Use this reference'))).rejects.toThrow(
      'does not support image prompts'
    )
    expect(agent.requests.some((request) => request.method === 'session/prompt')).toBe(false)

    await readChunks(await transport.sendMessages(userMessage('Retry without the image')))
    const retry = await waitForRequest(agent.requests, 'session/prompt')
    const retryText = (retry.params.prompt as Array<{ type: string; text?: string }>)[0]?.text
    expect(retryText).toContain('You are a design assistant inside a vector design editor.')
    expect(retryText).toContain('Retry without the image')
    await transport.destroy()
  })

  test('fails closed for invalid base64, MIME, magic bytes, and non-image files', async () => {
    const agent = await installFakeACPAgent()
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') {
        reply.respond({
          protocolVersion: 1,
          agentCapabilities: { promptCapabilities: { image: true } }
        })
      } else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'session-1', configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/prompt') {
        reply.respond({ stopReason: 'end_turn' })
      }
    })
    const transport = await createACPTransport('acp:codex')
    const invalidCases: Array<{ name: string; part: FileUIPart; error: string }> = [
      {
        name: 'invalid base64',
        part: filePart({ url: 'data:image/png;base64,iVBORw0KGgo!' }),
        error: 'contains invalid base64 data'
      },
      {
        name: 'empty base64',
        part: filePart({ url: 'data:image/png;base64,' }),
        error: 'is empty'
      },
      {
        name: 'non-canonical base64',
        part: filePart({ url: 'data:image/png;base64,AB==' }),
        error: 'contains non-canonical base64 data'
      },
      {
        name: 'MIME mismatch',
        part: filePart({ url: dataURL('image/jpeg', JPEG_SIGNATURE) }),
        error: 'data URL contains "image/jpeg"'
      },
      {
        name: 'magic mismatch',
        part: filePart({ url: dataURL('image/png', JPEG_SIGNATURE) }),
        error: 'contents do not match its declared media type'
      },
      {
        name: 'non-image file',
        part: filePart({
          mediaType: 'application/pdf',
          filename: 'reference.pdf',
          url: 'data:application/pdf;base64,JVBERg=='
        }),
        error: 'Only PNG, JPEG, and WebP image attachments are supported'
      }
    ]

    for (const invalid of invalidCases) {
      await expect(
        transport.sendMessages(imageUserMessage(invalid.name, [invalid.part]))
      ).rejects.toThrow(invalid.error)
    }
    expect(agent.requests).toEqual([])

    await readChunks(await transport.sendMessages(userMessage('Retry after invalid image')))
    const retry = await waitForRequest(agent.requests, 'session/prompt')
    const retryText = (retry.params.prompt as Array<{ type: string; text?: string }>)[0]?.text
    expect(retryText).toContain('You are a design assistant inside a vector design editor.')
    expect(retryText).toContain('Retry after invalid image')
    await transport.destroy()
  })

  test('fails closed for image count, per-image size, and combined size limits', async () => {
    const agent = await installFakeACPAgent()
    const transport = await createACPTransport('acp:codex')

    const tooMany = Array.from({ length: 5 }, (_, index) =>
      filePart({ filename: `reference-${index}.png` })
    )
    await expect(
      transport.sendMessages(imageUserMessage('Too many images', tooMany))
    ).rejects.toThrow('up to 4 image attachments')

    const oversized = filePart({
      filename: 'oversized.png',
      url: dataURL('image/png', pngBytes(2 * 1024 * 1024 + 1))
    })
    await expect(
      transport.sendMessages(imageUserMessage('Oversized image', [oversized]))
    ).rejects.toThrow('exceeds the 2 MiB ACP image limit')

    const maximumImageURL = dataURL('image/png', pngBytes(2 * 1024 * 1024))
    const overCombinedLimit = [
      filePart({ filename: 'maximum-1.png', url: maximumImageURL }),
      filePart({ filename: 'maximum-2.png', url: maximumImageURL }),
      filePart({ filename: 'maximum-3.png', url: maximumImageURL }),
      filePart({ filename: 'extra.png' })
    ]
    await expect(
      transport.sendMessages(imageUserMessage('Too many bytes', overCombinedLimit))
    ).rejects.toThrow('combined ACP image attachments exceed the 6 MiB limit')

    expect(agent.requests).toEqual([])
    await transport.destroy()
  })

  test('settles a pending prompt stream when the agent process exits', async () => {
    const agent = await installFakeACPAgent()
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') reply.respond({ protocolVersion: 1 })
      else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'session-1', configOptions: TEST_CONFIG_OPTIONS })
      }
    })
    const transport = await createACPTransport('acp:codex')
    await transport.connect()

    const stream = await transport.sendMessages(userMessage('pending prompt'))
    let sawRunningTool = false
    const chunksPromise = readChunks(stream, (chunk) => {
      if (chunk.type === 'tool-input-available' && chunk.toolCallId === 'render-running') {
        sawRunningTool = true
      }
    })
    await waitForRequest(agent.requests, 'session/prompt')
    agent.notify({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'render-running',
        title: 'Render',
        kind: 'edit',
        status: 'in_progress',
        rawInput: { jsx: '<Frame />' }
      }
    })
    await waitFor(() => sawRunningTool)
    agent.terminate()

    const chunks = await chunksPromise
    const toolErrorIndex = chunks.findIndex(
      (chunk) => chunk.type === 'tool-output-error' && chunk.toolCallId === 'render-running'
    )
    const transportErrorIndex = chunks.findIndex((chunk) => chunk.type === 'error')
    expect(toolErrorIndex).toBeGreaterThanOrEqual(0)
    expect(toolErrorIndex).toBeLessThan(transportErrorIndex)
    expect(chunks[toolErrorIndex]).toEqual({
      type: 'tool-output-error',
      toolCallId: 'render-running',
      errorText: 'Agent process exited unexpectedly.',
      providerExecuted: true
    })
    expect(chunks).toContainEqual({
      type: 'error',
      errorText: 'Agent process exited unexpectedly.'
    })
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'error' })
    await transport.destroy()
  })

  test('drains the cancelled prompt before closing its stream or starting the next turn', async () => {
    const agent = await installFakeACPAgent()
    let firstPromptReply: JSONRPCReply | null = null
    let promptCount = 0
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') reply.respond({ protocolVersion: 1 })
      else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'session-1', configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/prompt') {
        promptCount += 1
        if (promptCount === 1) firstPromptReply = reply
        else reply.respond({ stopReason: 'end_turn' })
      }
    })
    const transport = await createACPTransport('acp:codex')
    await transport.connect()

    const controller = new AbortController()
    const stream = await transport.sendMessages(userMessage('cancel prompt', controller.signal))
    const chunksPromise = readChunks(stream)
    await waitForRequest(agent.requests, 'session/prompt')
    controller.abort()

    await waitForRequest(agent.requests, 'session/cancel')
    const nextStreamPromise = transport.sendMessages(userMessage('next prompt'))
    const beforeCancelledReply = await Promise.race([
      chunksPromise.then(() => 'closed'),
      nextStreamPromise.then(() => 'next-started'),
      new Promise<'draining'>((resolve) => {
        setTimeout(() => resolve('draining'), 20)
      })
    ])
    expect(beforeCancelledReply).toBe('draining')
    expect(agent.requests.filter((request) => request.method === 'session/prompt')).toHaveLength(1)

    if (!firstPromptReply) throw new Error('Missing first prompt reply handle')
    firstPromptReply.respond({ stopReason: 'cancelled' })
    const chunks = await chunksPromise
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'stop' })
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(false)
    await readChunks(await nextStreamPromise)
    expect(agent.requests.filter((request) => request.method === 'session/prompt')).toHaveLength(2)
    await transport.destroy()
  })

  test('invalidates an ACP session when cancellation does not settle before the drain timeout', async () => {
    const agent = await installFakeACPAgent()
    let sessionCount = 0
    let promptCount = 0
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') reply.respond({ protocolVersion: 1 })
      else if (request.method === 'session/new') {
        sessionCount += 1
        reply.respond({
          sessionId: `session-${sessionCount}`,
          configOptions: TEST_CONFIG_OPTIONS
        })
      } else if (request.method === 'session/prompt') {
        promptCount += 1
        if (promptCount > 1) reply.respond({ stopReason: 'end_turn' })
      }
    })
    const agentDef = ACP_AGENTS.find((candidate) => candidate.id === 'codex')
    if (!agentDef) throw new Error('Missing Codex ACP agent definition')
    const transport = new ACPChatTransport({
      agentDef,
      cwd: '/Users/tester',
      cancelDrainTimeoutMs: 20
    })

    const controller = new AbortController()
    const chunksPromise = readChunks(
      await transport.sendMessages(userMessage('stuck prompt', controller.signal))
    )
    await waitForRequest(agent.requests, 'session/prompt')
    controller.abort()

    const chunks = await chunksPromise
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'stop' })
    await readChunks(await transport.sendMessages(userMessage('replacement prompt')))
    expect(sessionCount).toBe(2)
    expect(promptCount).toBe(2)
    await transport.destroy()
  })

  test('restores system and runtime context after a prompt failure', async () => {
    const agent = await installFakeACPAgent()
    let promptCount = 0
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') reply.respond({ protocolVersion: 1 })
      else if (request.method === 'session/new') {
        reply.respond({ sessionId: 'session-1', configOptions: TEST_CONFIG_OPTIONS })
      } else if (request.method === 'session/prompt') {
        promptCount += 1
        if (promptCount === 1) reply.reject('Prompt failed')
        else reply.respond({ stopReason: 'end_turn' })
      }
    })
    const transport = await createACPTransport('acp:codex')
    await transport.connect()

    const failedChunks = await readChunks(
      await transport.sendMessages(userMessage('first request'))
    )
    expect(failedChunks).toContainEqual({ type: 'error', errorText: 'Prompt failed' })
    await readChunks(await transport.sendMessages(userMessage('second request')))

    const prompts = agent.requests
      .filter((request) => request.method === 'session/prompt')
      .map(
        (request) => (request.params.prompt as Array<{ type: string; text: string }>)[0]?.text ?? ''
      )
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) {
      expect(prompt).toContain('You are a design assistant inside a vector design editor.')
      expect(prompt).toContain('# ACP runtime metadata')
    }
    await transport.destroy()
  })

  test('sends system and runtime context again after creating a replacement session', async () => {
    const agent = await installFakeACPAgent()
    let sessionCount = 0
    agent.handleRequests((request, reply) => {
      if (request.method === 'initialize') reply.respond({ protocolVersion: 1 })
      else if (request.method === 'session/new') {
        sessionCount += 1
        reply.respond({
          sessionId: `session-${sessionCount}`,
          configOptions: TEST_CONFIG_OPTIONS
        })
      } else if (request.method === 'session/prompt') {
        reply.respond({ stopReason: 'end_turn' })
      }
    })
    const transport = await createACPTransport('acp:codex')

    await readChunks(await transport.sendMessages(userMessage('first session')))
    agent.terminate()
    await readChunks(await transport.sendMessages(userMessage('replacement session')))

    const prompts = agent.requests
      .filter((request) => request.method === 'session/prompt')
      .map(
        (request) => (request.params.prompt as Array<{ type: string; text: string }>)[0]?.text ?? ''
      )
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) {
      expect(prompt).toContain('You are a design assistant inside a vector design editor.')
      expect(prompt).toContain('# ACP runtime metadata')
    }
    await transport.destroy()
  })
})
